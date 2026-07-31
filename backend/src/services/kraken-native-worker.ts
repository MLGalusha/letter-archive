import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface, type Interface } from 'node:readline';

const PROTOCOL = 'kraken-native-layout-ndjson';
const PROTOCOL_VERSION = 2;
const STDERR_LIMIT = 64 * 1024;

export type KrakenTextDirection =
  | 'horizontal-lr'
  | 'horizontal-rl'
  | 'vertical-lr'
  | 'vertical-rl';

export type KrakenRotationDegrees = readonly [0, 90, 270];

export interface KrakenNativeWorkerOptions {
  executablePath: string;
  scriptPath: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

interface PendingRequest {
  id: string;
  resolve: (layout: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * A single sequential Kraken process for one detection CLI invocation.
 *
 * The transport deliberately returns `unknown`: the caller owns the native
 * PageLayout schema and validates every result before upload. Keeping framing
 * and domain validation separate makes protocol failures distinguishable from
 * provider-contract failures.
 */
export class KrakenNativeWorker {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #lines: Interface;
  readonly #ready = deferred();
  readonly #stopped = deferred();
  readonly #exited: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>;
  readonly #requestTimeoutMs: number;
  readonly #shutdownTimeoutMs: number;

  #pending: PendingRequest | null = null;
  #stderr = '';
  #readySettled = false;
  #stoppedSettled = false;
  #failed: Error | null = null;
  #acceptingRequests = true;
  #operationChain: Promise<void> = Promise.resolve();
  #closePromise: Promise<void> | null = null;
  #shutdownId: string | null = null;

  private constructor(options: KrakenNativeWorkerOptions) {
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
    this.#child = spawn(
      options.executablePath,
      [options.scriptPath, '--worker-native-json'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.#lines = createInterface({ input: this.#child.stdout });
    this.#lines.on('line', (line) => this.#handleLine(line));
    this.#child.stderr.on('data', (chunk: Buffer | string) => {
      this.#stderr = `${this.#stderr}${chunk.toString()}`.slice(-STDERR_LIMIT);
    });
    // Writable streams emit errors separately from the child process. Without
    // this listener, a worker that exits or is OOM-killed between our writable
    // check and write can surface EPIPE as an uncaught process-level error.
    this.#child.stdin.on('error', (error) => {
      this.#fail(new Error(
        `Kraken native worker stdin failed: ${error.message}`
        + this.#stderrSuffix(),
      ));
    });
    this.#child.once('error', (error) => {
      this.#fail(new Error(
        `Could not start Kraken native worker: ${error.message}`,
      ));
    });
    this.#exited = new Promise((resolve) => {
      this.#child.once('exit', (code, signal) => {
        resolve({ code, signal });
        if (!this.#stoppedSettled) {
          this.#fail(new Error(
            `Kraken native worker exited before clean shutdown `
            + `(code=${String(code)}, signal=${String(signal)})`
            + this.#stderrSuffix(),
          ));
        }
      });
    });
  }

  static async start(
    options: KrakenNativeWorkerOptions,
  ): Promise<KrakenNativeWorker> {
    const worker = new KrakenNativeWorker(options);
    const startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
    const timeout = setTimeout(() => {
      worker.#fail(new Error(
        `Kraken native worker did not become ready within ${startupTimeoutMs}ms`
        + worker.#stderrSuffix(),
      ));
    }, startupTimeoutMs);
    try {
      await worker.#ready.promise;
      return worker;
    } catch (error) {
      worker.#child.kill('SIGTERM');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  detect(
    imagePath: string,
    textDirection: KrakenTextDirection = 'horizontal-lr',
    rotationsDegrees?: KrakenRotationDegrees,
  ): Promise<unknown> {
    if (!this.#acceptingRequests) {
      return Promise.reject(new Error(
        'Kraken native worker is closing and no longer accepts requests',
      ));
    }
    const operation = this.#operationChain.then(() => (
      this.#detectOne(imagePath, textDirection, rotationsDegrees)
    ));
    this.#operationChain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  close(): Promise<void> {
    if (!this.#closePromise) {
      this.#closePromise = this.#close();
    }
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    this.#acceptingRequests = false;
    await this.#operationChain;
    if (this.#failed || this.#child.exitCode !== null) {
      return;
    }

    const id = `shutdown-${randomUUID()}`;
    this.#shutdownId = id;
    this.#write({ type: 'shutdown', id });
    const timeout = setTimeout(() => {
      this.#fail(new Error(
        `Kraken native worker did not stop within ${this.#shutdownTimeoutMs}ms`
        + this.#stderrSuffix(),
      ));
    }, this.#shutdownTimeoutMs);
    try {
      await this.#stopped.promise;
      if (this.#failed) {
        throw this.#failed;
      }
      this.#child.stdin.end();
      let exitTimeout: ReturnType<typeof setTimeout> | undefined;
      const exit = await Promise.race([
        this.#exited,
        new Promise<never>((_, reject) => {
          exitTimeout = setTimeout(() => reject(new Error(
            'Kraken native worker acknowledged shutdown but did not exit',
          )), this.#shutdownTimeoutMs);
        }),
      ]).finally(() => {
        if (exitTimeout) clearTimeout(exitTimeout);
      });
      if (exit.code !== 0) {
        throw new Error(
          `Kraken native worker exited with code ${String(exit.code)}`
          + this.#stderrSuffix(),
        );
      }
    } finally {
      clearTimeout(timeout);
      this.#lines.close();
      if (this.#child.exitCode === null) {
        this.#child.kill('SIGTERM');
      }
    }
  }

  abort(): void {
    this.#acceptingRequests = false;
    this.#child.kill('SIGTERM');
  }

  #detectOne(
    imagePath: string,
    textDirection: KrakenTextDirection,
    rotationsDegrees?: KrakenRotationDegrees,
  ): Promise<unknown> {
    if (this.#failed) {
      return Promise.reject(this.#failed);
    }
    if (!imagePath) {
      return Promise.reject(new Error('Kraken image path cannot be empty'));
    }
    if (this.#pending) {
      return Promise.reject(new Error(
        'Kraken worker protocol supports one sequential request at a time',
      ));
    }

    const id = `detect-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error(
          `Kraken detection ${id} exceeded ${this.#requestTimeoutMs}ms`
          + this.#stderrSuffix(),
        );
        this.#pending = null;
        reject(error);
        this.#fail(error);
      }, this.#requestTimeoutMs);
      this.#pending = { id, resolve, reject, timeout };
      try {
        this.#write({
          type: 'detect',
          id,
          imagePath,
          textDirection,
          ...(rotationsDegrees !== undefined
            ? { rotationsDegrees: [...rotationsDegrees] }
            : {}),
        });
      } catch (error) {
        clearTimeout(timeout);
        this.#pending = null;
        reject(error);
      }
    });
  }

  #write(message: Record<string, unknown>): void {
    if (!this.#child.stdin.writable) {
      throw new Error(
        'Kraken native worker stdin is not writable' + this.#stderrSuffix(),
      );
    }
    this.#child.stdin.write(
      `${JSON.stringify(message)}\n`,
      (error: Error | null | undefined) => {
        if (error) {
          this.#fail(new Error(
            `Kraken native worker stdin failed: ${error.message}`
            + this.#stderrSuffix(),
          ));
        }
      },
    );
  }

  #handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.#fail(new Error(
        `Kraken native worker emitted non-JSON stdout: ${line.slice(0, 500)}`,
      ));
      return;
    }
    const message = objectValue(parsed);
    if (!message || typeof message.type !== 'string') {
      this.#fail(new Error('Kraken native worker emitted an invalid message'));
      return;
    }

    if (message.type === 'fatal') {
      const error = objectValue(message.error);
      this.#fail(new Error(
        `Kraken native worker failed during startup: `
        + `${String(error?.type ?? 'Error')}: `
        + `${String(error?.message ?? 'unknown error')}`
        + this.#stderrSuffix(),
      ));
      return;
    }

    if (!this.#readySettled) {
      if (
        message.type !== 'ready'
        || message.protocol !== PROTOCOL
        || message.version !== PROTOCOL_VERSION
      ) {
        this.#fail(new Error(
          'Kraken native worker did not send the expected ready handshake',
        ));
        return;
      }
      this.#readySettled = true;
      this.#ready.resolve();
      return;
    }

    if (message.type === 'stopped') {
      if (
        this.#shutdownId === null
        || message.id !== this.#shutdownId
        || message.protocol !== PROTOCOL
        || message.version !== PROTOCOL_VERSION
      ) {
        this.#fail(new Error(
          'Kraken native worker sent an invalid shutdown acknowledgement',
        ));
        return;
      }
      this.#stoppedSettled = true;
      this.#stopped.resolve();
      return;
    }

    if (message.type !== 'result') {
      this.#fail(new Error(
        `Kraken native worker emitted unexpected message type ${message.type}`,
      ));
      return;
    }
    const pending = this.#pending;
    if (!pending || message.id !== pending.id) {
      this.#fail(new Error(
        `Kraken native worker response id ${String(message.id)} `
        + 'does not match the active request',
      ));
      return;
    }
    clearTimeout(pending.timeout);
    this.#pending = null;
    if (message.ok === true && 'layout' in message) {
      pending.resolve(message.layout);
      return;
    }
    if (message.ok === false) {
      const providerError = objectValue(message.error);
      pending.reject(new Error(
        `Kraken detection failed: `
        + `${String(providerError?.type ?? 'Error')}: `
        + `${String(providerError?.message ?? 'unknown error')}`,
      ));
      return;
    }
    pending.reject(new Error(
      'Kraken native worker emitted an invalid result envelope',
    ));
  }

  #fail(error: Error): void {
    if (this.#failed) return;
    this.#failed = error;
    this.#acceptingRequests = false;
    if (!this.#readySettled) {
      this.#readySettled = true;
      this.#ready.reject(error);
    }
    if (this.#pending) {
      clearTimeout(this.#pending.timeout);
      this.#pending.reject(error);
      this.#pending = null;
    }
    if (!this.#stoppedSettled) {
      this.#stoppedSettled = true;
      this.#stopped.resolve();
    }
    if (this.#child.exitCode === null) {
      this.#child.kill('SIGTERM');
    }
  }

  #stderrSuffix(): string {
    const stderr = this.#stderr.trim();
    return stderr ? `; stderr: ${stderr.slice(-2_000)}` : '';
  }
}
