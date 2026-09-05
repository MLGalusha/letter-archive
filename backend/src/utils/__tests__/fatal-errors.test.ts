import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const modulePath = fileURLToPath(new URL('../logger.ts', import.meta.url));

describe('fatal process errors', () => {
  for (const trigger of [
    'setImmediate(() => { throw new Error("fatal fixture"); });',
    'Promise.reject(new Error("fatal fixture"));',
  ]) {
    it(`logs and exits nonzero: ${trigger}`, async () => {
      const child = await exec(process.execPath, [
        '--import', 'tsx', '--unhandled-rejections=warn', '--input-type=module', '-e',
        `import ${JSON.stringify(modulePath)};
         setInterval(() => {}, 1000);
         ${trigger}`,
      ], { timeout: 5_000, env: { ...process.env, NODE_ENV: 'production', LOG_TO_FILES: 'false' } }).then(
        () => ({ code: 0, stderr: '', stdout: '', killed: false }),
        (error) => error as { code: number; stderr: string; stdout: string; killed: boolean },
      );
      expect(child.killed).toBe(false);
      expect(child.code).toBe(1);
      const fatalRecords = child.stdout.split('\n').filter((line) => line.includes('CRITICAL'));
      expect(fatalRecords).toHaveLength(1);
      expect(child.stderr).toContain('fatal fixture');
    });
  }
});
