import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const modulePath = fileURLToPath(new URL('../fatal-errors.ts', import.meta.url));

describe('fatal process errors', () => {
  for (const trigger of [
    'setImmediate(() => { throw new Error("fatal fixture"); });',
    'Promise.reject(new Error("fatal fixture"));',
  ]) {
    it(`logs and exits nonzero: ${trigger}`, async () => {
      const child = await exec(process.execPath, [
        '--import', 'tsx', '--unhandled-rejections=warn', '--input-type=module', '-e',
        `import { installFatalErrorLogging } from ${JSON.stringify(modulePath)};
         installFatalErrorLogging({ fatal: () => process.stderr.write('FATAL_OBSERVED\\n') });
         setInterval(() => {}, 1000);
         ${trigger}`,
      ], { timeout: 5_000 }).then(
        () => ({ code: 0, stderr: '', killed: false }),
        (error) => error as { code: number; stderr: string; killed: boolean },
      );
      expect(child.killed).toBe(false);
      expect(child.code).toBe(1);
      expect(child.stderr).toContain('FATAL_OBSERVED');
      expect(child.stderr).toContain('fatal fixture');
    });
  }
});
