import path from 'node:path';

export function countDiagnostics(results, root) {
  const counts = {};
  for (const result of results) {
    for (const message of result.messages) {
      if (message.fatal) throw new Error(`${result.filePath}: ${message.message}`);
      const key = `${path.relative(root, result.filePath).split(path.sep).join('/')} :: ${message.ruleId} :: ${message.severity}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function increasedDiagnostics(current, baseline) {
  return Object.entries(current).filter(([key, count]) => count > (baseline[key] ?? 0));
}
