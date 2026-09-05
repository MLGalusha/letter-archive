import fs from 'node:fs/promises';
import { ESLint } from 'eslint';
import { countDiagnostics, increasedDiagnostics } from './lint-baseline.mjs';

const results = await new ESLint().lintFiles(['.']);
const current = countDiagnostics(results, process.cwd());
const baselineUrl = new URL('../eslint-baseline.json', import.meta.url);
if (process.argv.includes('--update-baseline')) {
  await fs.writeFile(baselineUrl, `${JSON.stringify(current, null, 2)}\n`);
  console.log('Updated the explicit lint baseline. Review its diff before committing.');
} else {
  const baseline = JSON.parse(await fs.readFile(baselineUrl, 'utf8'));
  const increases = increasedDiagnostics(current, baseline);
  for (const [key, count] of increases) console.error(`${key}: ${count} diagnostics (baseline ${baseline[key] ?? 0})`);
  const total = Object.values(current).reduce((sum, count) => sum + count, 0);
  console.log(`Lint: ${total} existing diagnostics; ${increases.length} file/rule increases.`);
  if (increases.length) process.exitCode = 1;
}
