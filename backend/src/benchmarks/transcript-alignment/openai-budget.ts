import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const rateSchema = z.object({
  inputUsdPerMillion: z.number().positive(),
  cachedInputUsdPerMillion: z.number().nonnegative(),
  cacheWriteUsdPerMillion: z.number().nonnegative(),
  outputUsdPerMillion: z.number().positive(),
}).strict();

export const openAiBudgetPolicySchema = z.object({
  schemaVersion: z.literal(1),
  authorizedUsd: z.number().positive(),
  safetyReserveUsd: z.number().nonnegative(),
  pricingCapturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  pricingSource: z.string().url(),
  longContextThresholdTokens: z.number().int().positive(),
  longContextInputMultiplier: z.number().min(1),
  longContextOutputMultiplier: z.number().min(1),
  models: z.record(z.string().min(1), rateSchema),
}).strict().superRefine((policy, context) => {
  if (policy.safetyReserveUsd >= policy.authorizedUsd) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['safetyReserveUsd'],
      message: 'Safety reserve must be smaller than the authorized budget',
    });
  }
});

const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
}).strict().superRefine((usage, context) => {
  if (
    usage.cachedInputTokens + usage.cacheWriteInputTokens
    > usage.inputTokens
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['inputTokens'],
      message: 'Cached and cache-write tokens cannot exceed total input tokens',
    });
  }
  if (usage.reasoningOutputTokens > usage.outputTokens) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reasoningOutputTokens'],
      message: 'Reasoning tokens must be included in total output tokens',
    });
  }
});

const reservationSchema = z.object({
  id: z.string().uuid(),
  experiment: z.string().min(1),
  model: z.string().min(1),
  maximumInputTokens: z.number().int().positive(),
  maximumOutputTokens: z.number().int().positive(),
  reservedUsd: z.number().nonnegative(),
  status: z.enum([
    'reserved',
    'dispatched',
    'settled',
    'failed',
    'unresolved',
  ]),
  createdAt: z.string().datetime({ offset: true }),
  dispatchedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  responseId: z.string().nullable(),
  usage: tokenUsageSchema.nullable(),
  actualUsd: z.number().nonnegative().nullable(),
  errorCode: z.string().nullable(),
}).strict();

const reserveInputSchema = z.object({
  experiment: z.string().trim().min(1),
  model: z.string().trim().min(1),
  maximumInputTokens: z.number().int().positive(),
  maximumOutputTokens: z.number().int().positive(),
}).strict();

const reservationIdInputSchema = z.object({
  reservationId: z.string().uuid(),
}).strict();

const settleInputSchema = z.object({
  reservationId: z.string().uuid(),
  responseId: z.string().trim().min(1),
  usage: tokenUsageSchema,
}).strict();

const failureInputSchema = z.object({
  reservationId: z.string().uuid(),
  errorCode: z.string().trim().min(1),
}).strict();

export const openAiBudgetLedgerSchema = z.object({
  schemaVersion: z.literal(1),
  authorizedUsd: z.number().positive(),
  safetyReserveUsd: z.number().nonnegative(),
  usableUsd: z.number().positive(),
  pricingCapturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  pricingSource: z.string().url(),
  spentUsd: z.number().nonnegative(),
  openReservedUsd: z.number().nonnegative(),
  calls: z.array(reservationSchema),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export type OpenAiBudgetPolicy = z.infer<typeof openAiBudgetPolicySchema>;
export type OpenAiTokenUsage = z.infer<typeof tokenUsageSchema>;
export type OpenAiBudgetLedger = z.infer<typeof openAiBudgetLedgerSchema>;
export type OpenAiReservation = z.infer<typeof reservationSchema>;

const roundUsd = (value: number): number => Number(value.toFixed(8));

export function calculateOpenAiCost(
  policy: OpenAiBudgetPolicy,
  model: string,
  usageInput: OpenAiTokenUsage,
): number {
  const usage = tokenUsageSchema.parse(usageInput);
  const rates = policy.models[model];
  if (!rates) {
    throw new Error(`No checked pricing is configured for model ${model}`);
  }
  const uncachedInputTokens = usage.inputTokens
    - usage.cachedInputTokens
    - usage.cacheWriteInputTokens;
  const isLongContext = usage.inputTokens > policy.longContextThresholdTokens;
  const inputMultiplier = isLongContext
    ? policy.longContextInputMultiplier
    : 1;
  const outputMultiplier = isLongContext
    ? policy.longContextOutputMultiplier
    : 1;
  const inputCost = (
    (uncachedInputTokens * rates.inputUsdPerMillion)
    + (usage.cachedInputTokens * rates.cachedInputUsdPerMillion)
    + (usage.cacheWriteInputTokens * rates.cacheWriteUsdPerMillion)
  ) * inputMultiplier / 1_000_000;
  const outputCost = (
    usage.outputTokens
    * rates.outputUsdPerMillion
    * outputMultiplier
    / 1_000_000
  );
  return roundUsd(inputCost + outputCost);
}

export function calculateWorstCaseOpenAiCost(
  policy: OpenAiBudgetPolicy,
  model: string,
  maximumInputTokens: number,
  maximumOutputTokens: number,
): number {
  const rates = policy.models[model];
  if (!rates) {
    throw new Error(`No checked pricing is configured for model ${model}`);
  }
  const mostExpensiveInputKind = [
    ['uncached', rates.inputUsdPerMillion],
    ['cached', rates.cachedInputUsdPerMillion],
    ['cache-write', rates.cacheWriteUsdPerMillion],
  ].sort((left, right) => Number(right[1]) - Number(left[1]))[0]?.[0];
  return calculateOpenAiCost(policy, model, {
    inputTokens: maximumInputTokens,
    cachedInputTokens:
      mostExpensiveInputKind === 'cached' ? maximumInputTokens : 0,
    cacheWriteInputTokens:
      mostExpensiveInputKind === 'cache-write' ? maximumInputTokens : 0,
    outputTokens: maximumOutputTokens,
    reasoningOutputTokens: 0,
  });
}

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

async function withFileLock<T>(
  lockPath: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx');
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!handle) {
    throw new Error(`Timed out acquiring OpenAI budget lock ${lockPath}`);
  }
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

function emptyLedger(policy: OpenAiBudgetPolicy): OpenAiBudgetLedger {
  const usableUsd = roundUsd(
    policy.authorizedUsd - policy.safetyReserveUsd,
  );
  return {
    schemaVersion: 1,
    authorizedUsd: policy.authorizedUsd,
    safetyReserveUsd: policy.safetyReserveUsd,
    usableUsd,
    pricingCapturedAt: policy.pricingCapturedAt,
    pricingSource: policy.pricingSource,
    spentUsd: 0,
    openReservedUsd: 0,
    calls: [],
    updatedAt: new Date().toISOString(),
  };
}

function assertLedgerMatchesPolicy(
  ledger: OpenAiBudgetLedger,
  policy: OpenAiBudgetPolicy,
): void {
  const usableUsd = roundUsd(
    policy.authorizedUsd - policy.safetyReserveUsd,
  );
  if (
    ledger.authorizedUsd !== policy.authorizedUsd
    || ledger.safetyReserveUsd !== policy.safetyReserveUsd
    || ledger.usableUsd !== usableUsd
    || ledger.pricingCapturedAt !== policy.pricingCapturedAt
    || ledger.pricingSource !== policy.pricingSource
  ) {
    throw new Error(
      'OpenAI budget ledger does not match the checked budget policy',
    );
  }
}

export class OpenAiBudgetGuard {
  readonly policyPath: string;
  readonly ledgerPath: string;
  readonly lockPath: string;

  constructor(policyPath: string, ledgerPath: string) {
    this.policyPath = policyPath;
    this.ledgerPath = ledgerPath;
    this.lockPath = `${ledgerPath}.lock`;
  }

  async loadPolicy(): Promise<OpenAiBudgetPolicy> {
    return openAiBudgetPolicySchema.parse(await loadJson(this.policyPath));
  }

  private async loadOrCreateLedger(
    policy: OpenAiBudgetPolicy,
  ): Promise<OpenAiBudgetLedger> {
    let ledger: OpenAiBudgetLedger;
    try {
      ledger = openAiBudgetLedgerSchema.parse(await loadJson(this.ledgerPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ledger = emptyLedger(policy);
    }
    assertLedgerMatchesPolicy(ledger, policy);
    return ledger;
  }

  async inspect(): Promise<OpenAiBudgetLedger> {
    const policy = await this.loadPolicy();
    return this.loadOrCreateLedger(policy);
  }

  async reserve(input: {
    experiment: string;
    model: string;
    maximumInputTokens: number;
    maximumOutputTokens: number;
  }): Promise<OpenAiReservation> {
    const request = reserveInputSchema.parse(input);
    return withFileLock(this.lockPath, async () => {
      const policy = await this.loadPolicy();
      const ledger = await this.loadOrCreateLedger(policy);
      const reservedUsd = calculateWorstCaseOpenAiCost(
        policy,
        request.model,
        request.maximumInputTokens,
        request.maximumOutputTokens,
      );
      const projectedUsd = roundUsd(
        ledger.spentUsd + ledger.openReservedUsd + reservedUsd,
      );
      if (projectedUsd > ledger.usableUsd) {
        throw new Error(
          `OpenAI budget guard refused ${request.experiment}: `
          + `$${projectedUsd.toFixed(6)} projected exceeds `
          + `$${ledger.usableUsd.toFixed(2)} usable budget`,
        );
      }
      const reservation = reservationSchema.parse({
        id: randomUUID(),
        experiment: request.experiment,
        model: request.model,
        maximumInputTokens: request.maximumInputTokens,
        maximumOutputTokens: request.maximumOutputTokens,
        reservedUsd,
        status: 'reserved',
        createdAt: new Date().toISOString(),
        dispatchedAt: null,
        completedAt: null,
        responseId: null,
        usage: null,
        actualUsd: null,
        errorCode: null,
      });
      ledger.calls.push(reservation);
      ledger.openReservedUsd = roundUsd(
        ledger.openReservedUsd + reservedUsd,
      );
      ledger.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.ledgerPath, ledger);
      return reservation;
    });
  }

  async markDispatched(input: {
    reservationId: string;
  }): Promise<OpenAiReservation> {
    const request = reservationIdInputSchema.parse(input);
    return withFileLock(this.lockPath, async () => {
      const policy = await this.loadPolicy();
      const ledger = await this.loadOrCreateLedger(policy);
      const callIndex = ledger.calls.findIndex(
        ({ id }) => id === request.reservationId,
      );
      const call = ledger.calls[callIndex];
      if (!call) throw new Error('OpenAI budget reservation was not found');
      if (call.status !== 'reserved') {
        throw new Error('OpenAI budget reservation was already dispatched');
      }
      const dispatched = reservationSchema.parse({
        ...call,
        status: 'dispatched',
        dispatchedAt: new Date().toISOString(),
      });
      ledger.calls[callIndex] = dispatched;
      ledger.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.ledgerPath, ledger);
      return dispatched;
    });
  }

  async settle(input: {
    reservationId: string;
    responseId: string;
    usage: OpenAiTokenUsage;
  }): Promise<OpenAiReservation> {
    const request = settleInputSchema.parse(input);
    return withFileLock(this.lockPath, async () => {
      const policy = await this.loadPolicy();
      const ledger = await this.loadOrCreateLedger(policy);
      const callIndex = ledger.calls.findIndex(
        ({ id }) => id === request.reservationId,
      );
      const call = ledger.calls[callIndex];
      if (!call) throw new Error('OpenAI budget reservation was not found');
      if (!['dispatched', 'unresolved'].includes(call.status)) {
        throw new Error('OpenAI budget reservation is already terminal');
      }
      const usage = request.usage;
      if (
        usage.inputTokens > call.maximumInputTokens
        || usage.outputTokens > call.maximumOutputTokens
      ) {
        throw new Error(
          'Actual OpenAI usage exceeded the reservation token ceiling',
        );
      }
      const actualUsd = calculateOpenAiCost(
        policy,
        call.model,
        usage,
      );
      if (actualUsd > call.reservedUsd) {
        throw new Error(
          'Actual OpenAI cost exceeded the pre-call reservation',
        );
      }
      const settled = reservationSchema.parse({
        ...call,
        status: 'settled',
        completedAt: new Date().toISOString(),
        responseId: request.responseId,
        usage,
        actualUsd,
      });
      ledger.calls[callIndex] = settled;
      ledger.spentUsd = roundUsd(ledger.spentUsd + actualUsd);
      ledger.openReservedUsd = roundUsd(
        ledger.openReservedUsd - call.reservedUsd,
      );
      ledger.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.ledgerPath, ledger);
      return settled;
    });
  }

  async cancelBeforeDispatch(input: {
    reservationId: string;
    errorCode: string;
  }): Promise<OpenAiReservation> {
    const request = failureInputSchema.parse(input);
    return withFileLock(this.lockPath, async () => {
      const policy = await this.loadPolicy();
      const ledger = await this.loadOrCreateLedger(policy);
      const callIndex = ledger.calls.findIndex(
        ({ id }) => id === request.reservationId,
      );
      const call = ledger.calls[callIndex];
      if (!call) throw new Error('OpenAI budget reservation was not found');
      if (call.status !== 'reserved' || call.dispatchedAt !== null) {
        throw new Error(
          'Dispatched OpenAI reservations cannot be released as unbilled',
        );
      }
      const failed = reservationSchema.parse({
        ...call,
        status: 'failed',
        completedAt: new Date().toISOString(),
        errorCode: request.errorCode,
        actualUsd: 0,
      });
      ledger.calls[callIndex] = failed;
      ledger.openReservedUsd = roundUsd(
        ledger.openReservedUsd - call.reservedUsd,
      );
      ledger.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.ledgerPath, ledger);
      return failed;
    });
  }

  async markUnresolved(input: {
    reservationId: string;
    errorCode: string;
  }): Promise<OpenAiReservation> {
    const request = failureInputSchema.parse(input);
    return withFileLock(this.lockPath, async () => {
      const policy = await this.loadPolicy();
      const ledger = await this.loadOrCreateLedger(policy);
      const callIndex = ledger.calls.findIndex(
        ({ id }) => id === request.reservationId,
      );
      const call = ledger.calls[callIndex];
      if (!call) throw new Error('OpenAI budget reservation was not found');
      if (call.status !== 'dispatched') {
        throw new Error(
          'Only a dispatched OpenAI reservation can become unresolved',
        );
      }
      const unresolved = reservationSchema.parse({
        ...call,
        status: 'unresolved',
        completedAt: new Date().toISOString(),
        errorCode: request.errorCode,
      });
      ledger.calls[callIndex] = unresolved;
      ledger.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.ledgerPath, ledger);
      return unresolved;
    });
  }
}
