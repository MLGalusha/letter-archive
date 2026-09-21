import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const full = (reason, changes = []) => ({ runBrowser: true, reason, changes });

// These suites run a frontend dev server with mocked APIs, not the backend.
// backend/storage is deliberately NOT allowed: browser fixtures read its images.
export function selectBrowserChecks(changes) {
  if (!changes.length) return full('No changes identified; run the full coverage.');
  for (const { status, path } of changes) {
    if (!['A', 'M'].includes(status)) {
      return full('Deletion, rename, or file-type change requires full coverage.', changes);
    }
    const backendSource = path.startsWith('backend/src/') && path.endsWith('.ts')
      && !path.startsWith('backend/src/contracts/');
    const documentation = path.startsWith('docs/') && path.endsWith('.md');
    if (!backendSource && !documentation) {
      return full('A browser input, shared contract, or unclassified path changed.', changes);
    }
  }
  return {
    runBrowser: false,
    reason: 'Only backend TypeScript outside shared contracts and/or Markdown documentation changed. Quality and backend-connected smoke still run.',
    changes,
  };
}

export function selectFromGit({ eventName, base, head, cwd = process.cwd() }) {
  if (eventName !== 'pull_request') return full('Main and manual runs retain full coverage.');
  if (![base, head].every(sha => /^[0-9a-f]{40}$/.test(sha ?? ''))) {
    return full('Missing or invalid comparison revision; run full coverage.');
  }
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    if (git('rev-parse', 'HEAD').trim() !== head) return full('Checkout differs from event revision; run full coverage.');
    git('merge-base', '--is-ancestor', base, head);
    // Compare the tested PR merge tree to its base, not only the last commit.
    // Disabling rename detection exposes both deletion and addition, falling back.
    const fields = git('diff', '--name-status', '--no-renames', '-z', base, head, '--').split('\0');
    if (fields.pop() !== '' || fields.length % 2) return full('Unrecognized diff; run full coverage.');
    const changes = [];
    for (let i = 0; i < fields.length; i += 2) changes.push({ status: fields[i], path: fields[i + 1] });
    return selectBrowserChecks(changes);
  } catch {
    return full('Comparison history unavailable; run full coverage.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const decision = selectFromGit({
    eventName: process.env.GITHUB_EVENT_NAME,
    base: process.env.PR_BASE_SHA,
    head: process.env.GITHUB_SHA,
  });
  console.log(JSON.stringify(decision, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run_browser=${decision.runBrowser}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Browser coverage\n\n${decision.reason}\n\nChanged paths: ${decision.changes.length}.\n`);
  }
  if (process.env.BROWSER_SCOPE_REPORT) writeFileSync(process.env.BROWSER_SCOPE_REPORT, JSON.stringify({
    base: process.env.PR_BASE_SHA ?? null,
    head: process.env.GITHUB_SHA ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? null,
    ...decision,
  }, null, 2));
}
