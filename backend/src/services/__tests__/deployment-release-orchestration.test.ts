import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const promoteServiceScript = path.join(
  repositoryRoot,
  'deploy/cloudrun/promote-service.sh',
);
const releaseFullScript = path.join(
  repositoryRoot,
  'deploy/cloudrun/release-full.sh',
);
const acquireReleaseLockScript = path.join(
  repositoryRoot,
  'deploy/cloudrun/acquire-release-lock.sh',
);
const ensureJobInvokerScript = path.join(
  repositoryRoot,
  'deploy/cloudrun/ensure-job-invoker.sh',
);
const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function writeExecutable(
  directory: string,
  name: string,
  source: string,
): void {
  const executablePath = path.join(directory, name);
  writeFileSync(executablePath, source);
  chmodSync(executablePath, 0o755);
}

function readLog(logPath: string): string[] {
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('production release shell orchestration', () => {
  it('retries and verifies Cloud Run job invoker IAM updates', () => {
    const temporaryRoot = createTemporaryDirectory(
      'letter-archive-job-invoker-',
    );
    const fakeBin = path.join(temporaryRoot, 'bin');
    mkdirSync(fakeBin);

    const statePath = path.join(temporaryRoot, 'gcloud-state.json');
    writeFileSync(statePath, JSON.stringify({ addAttempts: 0, reads: 0 }));

    writeExecutable(fakeBin, 'sleep', '#!/usr/bin/env node\n');
    writeExecutable(fakeBin, 'gcloud', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const statePath = process.env.FAKE_GCLOUD_STATE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

if (args.slice(0, 3).join(' ') === 'run jobs get-iam-policy') {
  const expected = [
    'run',
    'jobs',
    'get-iam-policy',
    'letter-archive-worker',
    '--project=test-project',
    '--region=us-east1',
    '--format=json',
  ];
  if (JSON.stringify(args) !== JSON.stringify(expected)) {
    process.stderr.write('Unexpected policy read arguments: ' + args.join(' ') + '\\n');
    process.exit(96);
  }
  state.reads += 1;
  fs.writeFileSync(statePath, JSON.stringify(state));
  const members = state.addAttempts >= 2
    ? ['serviceAccount:worker@test-project.iam.gserviceaccount.com']
    : [];
  process.stdout.write(JSON.stringify({
    bindings: [{ role: 'roles/run.invoker', members }],
  }));
  process.exit(0);
}

if (args.slice(0, 3).join(' ') === 'run jobs add-iam-policy-binding') {
  const expected = [
    'run',
    'jobs',
    'add-iam-policy-binding',
    'letter-archive-worker',
    '--project=test-project',
    '--region=us-east1',
    '--member=serviceAccount:worker@test-project.iam.gserviceaccount.com',
    '--role=roles/run.invoker',
    '--quiet',
  ];
  if (JSON.stringify(args) !== JSON.stringify(expected)) {
    process.stderr.write('Unexpected IAM arguments: ' + args.join(' ') + '\\n');
    process.exit(97);
  }
  state.addAttempts += 1;
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.exit(state.addAttempts === 1 ? 9 : 0);
}

process.stderr.write('Unexpected fake gcloud call: ' + args.join(' ') + '\\n');
process.exit(98);
`);

    const result = spawnSync('bash', [ensureJobInvokerScript], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        FAKE_GCLOUD_STATE: statePath,
        LETTER_ARCHIVE_PROJECT_ID: 'test-project',
        LETTER_ARCHIVE_REGION: 'us-east1',
        LETTER_ARCHIVE_JOB_NAME: 'letter-archive-worker',
        LETTER_ARCHIVE_INVOKER_SERVICE_ACCOUNT:
          'worker@test-project.iam.gserviceaccount.com',
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
      addAttempts: 2,
      reads: 3,
    });
  });

  it('fails closed when a Cloud Run job invoker binding never appears', () => {
    const temporaryRoot = createTemporaryDirectory(
      'letter-archive-job-invoker-exhausted-',
    );
    const fakeBin = path.join(temporaryRoot, 'bin');
    mkdirSync(fakeBin);

    const statePath = path.join(temporaryRoot, 'gcloud-state.json');
    writeFileSync(statePath, JSON.stringify({ addAttempts: 0 }));

    writeExecutable(fakeBin, 'sleep', '#!/usr/bin/env node\n');
    writeExecutable(fakeBin, 'gcloud', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const statePath = process.env.FAKE_GCLOUD_STATE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

if (args.slice(0, 3).join(' ') === 'run jobs get-iam-policy') {
  const expected = [
    'run',
    'jobs',
    'get-iam-policy',
    'letter-archive-worker',
    '--project=test-project',
    '--region=us-east1',
    '--format=json',
  ];
  if (JSON.stringify(args) !== JSON.stringify(expected)) {
    process.stderr.write('Unexpected policy read arguments: ' + args.join(' ') + '\\n');
    process.exit(96);
  }
  process.stdout.write(JSON.stringify({ bindings: [] }));
  process.exit(0);
}

if (args.slice(0, 3).join(' ') === 'run jobs add-iam-policy-binding') {
  state.addAttempts += 1;
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.exit(0);
}

process.stderr.write('Unexpected fake gcloud call: ' + args.join(' ') + '\\n');
process.exit(98);
`);

    const result = spawnSync('bash', [ensureJobInvokerScript], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        FAKE_GCLOUD_STATE: statePath,
        LETTER_ARCHIVE_PROJECT_ID: 'test-project',
        LETTER_ARCHIVE_REGION: 'us-east1',
        LETTER_ARCHIVE_JOB_NAME: 'letter-archive-worker',
        LETTER_ARCHIVE_INVOKER_SERVICE_ACCOUNT:
          'worker@test-project.iam.gserviceaccount.com',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Failed to verify serviceAccount:worker@test-project.iam.gserviceaccount.com on letter-archive-worker',
    );
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
      addAttempts: 5,
    });
  });

  it('rejects job invoker identities outside the release project', () => {
    const result = spawnSync('bash', [ensureJobInvokerScript], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        LETTER_ARCHIVE_PROJECT_ID: 'test-project',
        LETTER_ARCHIVE_REGION: 'us-east1',
        LETTER_ARCHIVE_JOB_NAME: 'letter-archive-worker',
        LETTER_ARCHIVE_INVOKER_SERVICE_ACCOUNT:
          'worker@other-project.iam.gserviceaccount.com',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Invoker service account is invalid for the release project',
    );
  });

  it('rolls back and probes the previous revision after an ambiguous promotion failure', () => {
    const temporaryRoot = createTemporaryDirectory(
      'letter-archive-promotion-rollback-',
    );
    const fakeBin = path.join(temporaryRoot, 'bin');
    const renderedDirectory = path.join(temporaryRoot, 'rendered');
    mkdirSync(fakeBin);
    mkdirSync(renderedDirectory);

    const statePath = path.join(temporaryRoot, 'gcloud-state.json');
    const logPath = path.join(temporaryRoot, 'calls.log');
    writeFileSync(statePath, JSON.stringify({ phase: 'initial' }));

    writeExecutable(fakeBin, 'gcloud', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const statePath = process.env.FAKE_GCLOUD_STATE;
const logPath = process.env.FAKE_CALL_LOG;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const log = (message) => fs.appendFileSync(logPath, message + '\\n');
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const has = (prefix) => args.some((argument) => argument.startsWith(prefix));
log('gcloud ' + args.join(' '));

if (args.slice(0, 4).join(' ') === 'artifacts docker images describe') {
  process.stdout.write('sha256:' + 'd'.repeat(64) + '\\n');
  process.exit(0);
}

if (args.slice(0, 3).join(' ') === 'run services describe') {
  const previous = {
    revisionName: 'letter-archive-frontend-r-prev',
    percent: 100,
  };
  if (state.phase === 'candidate') {
    process.stdout.write(JSON.stringify({
      status: {
        traffic: [
          previous,
          {
            revisionName:
              'letter-archive-frontend-r-aaaaaaaaaa-bbbbbbbb',
            percent: 0,
            tag: 'c-aaaaaaaa-bbbbbbbb',
            url: 'https://candidate.test',
          },
        ],
      },
    }));
  } else {
    process.stdout.write(JSON.stringify({
      status: { traffic: [previous] },
    }));
  }
  process.exit(0);
}

if (args.slice(0, 3).join(' ') === 'run services replace') {
  state.phase = 'candidate';
  save();
  process.exit(0);
}

if (args.slice(0, 3).join(' ') === 'run services update-traffic') {
  if (has('--to-tags=')) {
    // Model the important ambiguous boundary: production accepted the traffic
    // mutation, but the CLI lost the success response and exits nonzero.
    state.phase = 'promoted';
    save();
    process.exit(9);
  }
  if (has('--to-revisions=letter-archive-frontend-r-prev=100')) {
    state.phase = 'restored';
    save();
    process.exit(0);
  }
}

process.stderr.write('Unexpected fake gcloud call: ' + args.join(' ') + '\\n');
process.exit(98);
`);

    writeExecutable(fakeBin, 'curl', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const url = args[args.length - 1];
fs.appendFileSync(process.env.FAKE_CALL_LOG, 'curl ' + url + '\\n');
if (url === 'https://candidate.test/version.json') {
  process.stdout.write(
    '{"releaseSha":"' + process.env.FAKE_RELEASE_SHA + '"}',
  );
}
`);

    const imageRepository =
      'us-east1-docker.pkg.dev/test-project/repo/frontend';
    const releaseSha = 'a'.repeat(40);
    const serviceAccount =
      'frontend@test-project.iam.gserviceaccount.com';
    const manifestPath = path.join(
      renderedDirectory,
      'frontend-service.yaml',
    );
    writeFileSync(manifestPath, `apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: letter-archive-frontend
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "0"
    spec:
      serviceAccountName: ${serviceAccount}
      containers:
        - image: ${imageRepository}@sha256:${'d'.repeat(64)}
          resources:
            limits:
              memory: 256Mi
  traffic:
    - percent: 100
      latestRevision: true
`);

    const result = spawnSync('/bin/bash', [promoteServiceScript], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        FAKE_CALL_LOG: logPath,
        FAKE_GCLOUD_STATE: statePath,
        FAKE_RELEASE_SHA: releaseSha,
        LETTER_ARCHIVE_PROJECT_ID: 'test-project',
        LETTER_ARCHIVE_REGION: 'us-east1',
        LETTER_ARCHIVE_SERVICE: 'letter-archive-frontend',
        LETTER_ARCHIVE_SERVICE_ACCOUNT: serviceAccount,
        LETTER_ARCHIVE_IMAGE_REPOSITORY: imageRepository,
        LETTER_ARCHIVE_RELEASE_SHA: releaseSha,
        LETTER_ARCHIVE_BUILD_ID: 'bbbbbbbb-bbbb-bbbb',
        LETTER_ARCHIVE_PRODUCTION_URL: 'https://prod.test',
        LETTER_ARCHIVE_SERVICE_MANIFEST: manifestPath,
      },
    });

    expect(result.status, result.stderr).toBe(9);
    expect(result.stderr).toContain(
      'Release failed after promotion; restoring '
      + 'letter-archive-frontend-r-prev',
    );
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
      phase: 'restored',
    });

    const calls = readLog(logPath);
    const ambiguousPromotion = calls.findIndex((call) =>
      call.includes(
        'run services update-traffic letter-archive-frontend',
      )
      && call.includes('--to-tags=c-aaaaaaaa-bbbbbbbb=100')
    );
    const rollback = calls.findIndex((call) =>
      call.includes(
        '--to-revisions=letter-archive-frontend-r-prev=100',
      )
    );
    const restoredProbe = calls.findIndex(
      (call) => call === 'curl https://prod.test/admin-login',
    );
    expect(ambiguousPromotion).toBeGreaterThan(-1);
    expect(rollback).toBeGreaterThan(ambiguousPromotion);
    expect(restoredProbe).toBeGreaterThan(rollback);
  }, 30_000);

  it.each([
    {
      failureStage: 'backend',
      expectedStatus: 41,
      shouldRestoreJobs: true,
    },
    {
      failureStage: 'frontend',
      expectedStatus: 42,
      shouldRestoreJobs: false,
    },
  ])(
    'restores release jobs only before the backend commit ($failureStage failure)',
    ({ failureStage, expectedStatus, shouldRestoreJobs }) => {
      const temporaryRoot = createTemporaryDirectory(
        `letter-archive-full-release-${failureStage}-`,
      );
      const fakeBin = path.join(temporaryRoot, 'bin');
      const renderedDirectory = path.join(
        temporaryRoot,
        'rendered/cloudrun',
      );
      mkdirSync(fakeBin);
      mkdirSync(renderedDirectory, { recursive: true });

      const statePath = path.join(temporaryRoot, 'gcloud-state.json');
      const logPath = path.join(temporaryRoot, 'calls.log');
      writeFileSync(statePath, JSON.stringify({
        workerImage: 'registry.test/backend@sha256:oldworker',
        backfillImage: 'registry.test/backend@sha256:oldbackfill',
        scheduler: 'ENABLED',
        iamRemoved: false,
      }));

      writeExecutable(fakeBin, 'bash', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(
  process.env.FAKE_CALL_LOG,
  'bash ' + process.env.LETTER_ARCHIVE_SERVICE + ' ' + args.join(' ') + '\\n',
);
if (args[0] === 'deploy/cloudrun/promote-service.sh') {
  if (
    process.env.FAKE_FAILURE_STAGE === 'backend'
    && process.env.LETTER_ARCHIVE_SERVICE === 'letter-archive-backend'
  ) process.exit(41);
  if (
    process.env.FAKE_FAILURE_STAGE === 'frontend'
    && process.env.LETTER_ARCHIVE_SERVICE === 'letter-archive-frontend'
  ) process.exit(42);
  process.exit(0);
}
process.stderr.write('Unexpected fake bash call: ' + args.join(' ') + '\\n');
process.exit(97);
`);

      writeExecutable(fakeBin, 'gcloud', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const statePath = process.env.FAKE_GCLOUD_STATE;
const logPath = process.env.FAKE_CALL_LOG;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const log = (message) => fs.appendFileSync(logPath, message + '\\n');
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const command = args.slice(0, 3).join(' ');
log('gcloud ' + args.join(' '));

if (command === 'run jobs describe') {
  const job = args[3];
  if (args.includes('--format=export')) {
    process.stdout.write(
      'apiVersion: run.googleapis.com/v1\\n'
      + 'kind: Job\\nmetadata:\\n  name: ' + job + '\\n',
    );
  } else if (job === 'letter-archive-worker') {
    process.stdout.write(state.workerImage + '\\n');
  } else if (job === 'letter-archive-backfill-dimensions') {
    process.stdout.write(state.backfillImage + '\\n');
  }
  process.exit(0);
}

if (command === 'run jobs get-iam-policy') {
  if (state.iamRemoved) {
    process.stdout.write('{"bindings":[]}');
  } else {
    process.stdout.write(JSON.stringify({
      bindings: [{
        role: 'roles/run.invoker',
        members: [
          'serviceAccount:backend@test-project.iam.gserviceaccount.com',
          'serviceAccount:worker@test-project.iam.gserviceaccount.com',
        ],
      }],
    }));
  }
  process.exit(0);
}

if (command === 'run jobs remove-iam-policy-binding') {
  state.iamRemoved = true;
  save();
  process.exit(0);
}

if (command === 'run jobs set-iam-policy') {
  state.iamRemoved = false;
  save();
  process.exit(0);
}

if (command === 'run jobs replace') {
  const manifest = args[3];
  if (manifest === 'rendered/cloudrun/backend-worker-job.yaml') {
    state.workerImage = 'registry.test/backend@sha256:newworker';
  } else if (
    manifest === 'rendered/cloudrun/backend-backfill-dimensions-job.yaml'
  ) {
    state.backfillImage = 'registry.test/backend@sha256:newbackfill';
  } else if (manifest === 'rendered/release-state/worker.yaml') {
    state.workerImage = 'registry.test/backend@sha256:oldworker';
  } else if (manifest === 'rendered/release-state/backfill.yaml') {
    state.backfillImage = 'registry.test/backend@sha256:oldbackfill';
  }
  save();
  process.exit(0);
}

if (command === 'run jobs execute') process.exit(0);

if (args.slice(0, 3).join(' ') === 'services list --project=test-project') {
  process.stdout.write('cloudscheduler.googleapis.com\\n');
  process.exit(0);
}

if (args.slice(0, 3).join(' ') === 'scheduler jobs describe') {
  process.stdout.write(state.scheduler + '\\n');
  process.exit(0);
}

if (args.slice(0, 3).join(' ') === 'scheduler jobs pause') {
  state.scheduler = 'PAUSED';
  save();
  process.exit(0);
}

if (args.slice(0, 3).join(' ') === 'scheduler jobs resume') {
  state.scheduler = 'ENABLED';
  save();
  process.exit(0);
}

process.stderr.write('Unexpected fake gcloud call: ' + args.join(' ') + '\\n');
process.exit(98);
`);

      const result = spawnSync('/bin/bash', [releaseFullScript], {
        cwd: temporaryRoot,
        encoding: 'utf8',
        env: {
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          FAKE_CALL_LOG: logPath,
          FAKE_FAILURE_STAGE: failureStage,
          FAKE_GCLOUD_STATE: statePath,
          LETTER_ARCHIVE_PROJECT_ID: 'test-project',
          LETTER_ARCHIVE_REGION: 'us-east1',
          LETTER_ARCHIVE_RELEASE_SHA: 'a'.repeat(40),
          LETTER_ARCHIVE_BUILD_ID: 'bbbbbbbb-bbbb-bbbb',
          LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT:
            'backend@test-project.iam.gserviceaccount.com',
          LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT:
            'frontend@test-project.iam.gserviceaccount.com',
          LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT:
            'worker@test-project.iam.gserviceaccount.com',
          LETTER_ARCHIVE_BACKEND_IMAGE_REPOSITORY:
            'us-east1-docker.pkg.dev/test-project/repo/backend',
          LETTER_ARCHIVE_FRONTEND_IMAGE_REPOSITORY:
            'us-east1-docker.pkg.dev/test-project/repo/frontend',
          LETTER_ARCHIVE_BACKEND_PRODUCTION_URL:
            'https://api.prod.test',
          LETTER_ARCHIVE_FRONTEND_PRODUCTION_URL:
            'https://prod.test',
        },
      });

      expect(result.status).toBe(expectedStatus);
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
        workerImage: string;
        backfillImage: string;
        scheduler: string;
        iamRemoved: boolean;
      };
      expect(state.scheduler).toBe('ENABLED');

      const calls = readLog(logPath);
      const restoredWorker = calls.some((call) =>
        call.includes(
          'run jobs replace rendered/release-state/worker.yaml',
        )
      );
      const restoredBackfill = calls.some((call) =>
        call.includes(
          'run jobs replace rendered/release-state/backfill.yaml',
        )
      );
      const restoredPolicy = calls.some((call) =>
        call.includes('run jobs set-iam-policy letter-archive-worker')
      );
      expect(restoredWorker).toBe(shouldRestoreJobs);
      expect(restoredBackfill).toBe(shouldRestoreJobs);
      expect(restoredPolicy).toBe(shouldRestoreJobs);

      if (shouldRestoreJobs) {
        expect(state.workerImage).toContain('oldworker');
        expect(state.backfillImage).toContain('oldbackfill');
        expect(state.iamRemoved).toBe(false);
      } else {
        expect(state.workerImage).toContain('newworker');
        expect(state.backfillImage).toContain('newbackfill');
      }
    },
    30_000,
  );

  it('reaps only a terminal lock owner using generation preconditions', () => {
    const temporaryRoot = createTemporaryDirectory(
      'letter-archive-release-lock-',
    );
    const fakeBin = path.join(temporaryRoot, 'bin');
    mkdirSync(fakeBin);

    const statePath = path.join(temporaryRoot, 'gcloud-state.json');
    const logPath = path.join(temporaryRoot, 'calls.log');
    writeFileSync(statePath, JSON.stringify({
      locked: true,
      statusCalls: 0,
    }));

    writeExecutable(fakeBin, 'sleep', `#!/usr/bin/env node
require('node:fs').appendFileSync(
  process.env.FAKE_CALL_LOG,
  'sleep ' + process.argv.slice(2).join(' ') + '\\n',
);
`);

    writeExecutable(fakeBin, 'gcloud', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const statePath = process.env.FAKE_GCLOUD_STATE;
const logPath = process.env.FAKE_CALL_LOG;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const log = (message) => fs.appendFileSync(logPath, message + '\\n');
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
log('gcloud ' + args.join(' '));

if (args.slice(0, 2).join(' ') === 'storage cp') {
  fs.readFileSync(0, 'utf8');
  if (state.locked) process.exit(1);
  log('ACQUIRED');
  process.exit(0);
}

if (args.slice(0, 2).join(' ') === 'storage cat') {
  if (!args.includes(
    'gs://test-project-release-lock/production.lock#7',
  )) process.exit(95);
  process.stdout.write(
    '11111111-1111-1111-1111-111111111111 ' + 'c'.repeat(40),
  );
  process.exit(0);
}

if (args.slice(0, 2).join(' ') === 'builds describe') {
  state.statusCalls += 1;
  const status = state.statusCalls === 1 ? 'WORKING' : 'FAILURE';
  save();
  log('STATUS ' + status);
  process.stdout.write(status + '\\n');
  process.exit(0);
}

if (args.slice(0, 3).join(' ') === 'storage objects describe') {
  process.stdout.write('7\\n');
  process.exit(0);
}

if (args.slice(0, 2).join(' ') === 'storage rm') {
  if (!args.includes('--if-generation-match=7')) process.exit(96);
  state.locked = false;
  save();
  process.exit(0);
}

process.stderr.write('Unexpected fake gcloud call: ' + args.join(' ') + '\\n');
process.exit(98);
`);

    const result = spawnSync('/bin/bash', [acquireReleaseLockScript], {
      cwd: temporaryRoot,
      encoding: 'utf8',
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        FAKE_CALL_LOG: logPath,
        FAKE_GCLOUD_STATE: statePath,
        LETTER_ARCHIVE_PROJECT_ID: 'test-project',
        LETTER_ARCHIVE_REGION: 'us-east1',
        LETTER_ARCHIVE_RELEASE_SHA: 'a'.repeat(40),
        LETTER_ARCHIVE_BUILD_ID:
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        LETTER_ARCHIVE_RELEASE_LOCK_BUCKET:
          'test-project-release-lock',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Acquired production release lock');

    const calls = readLog(logPath);
    const workingStatus = calls.indexOf('STATUS WORKING');
    const terminalStatus = calls.indexOf('STATUS FAILURE');
    const generationRead = calls.findIndex((call) =>
      call.startsWith('gcloud storage objects describe')
    );
    const versionedPayloadReads = calls.filter((call) =>
      call.startsWith('gcloud storage cat')
    );
    const removal = calls.findIndex((call) =>
      call.startsWith('gcloud storage rm')
    );
    const acquisition = calls.indexOf('ACQUIRED');
    expect(workingStatus).toBeGreaterThan(-1);
    expect(terminalStatus).toBeGreaterThan(workingStatus);
    expect(generationRead).toBeGreaterThan(-1);
    expect(workingStatus).toBeGreaterThan(generationRead);
    expect(versionedPayloadReads).toHaveLength(2);
    expect(versionedPayloadReads.every((call) =>
      call.includes('production.lock#7')
    )).toBe(true);
    expect(removal).toBeGreaterThan(terminalStatus);
    expect(calls[removal]).toContain('--if-generation-match=7');
    expect(acquisition).toBeGreaterThan(removal);
    expect(calls.filter((call) =>
      call.startsWith('gcloud storage rm')
    )).toHaveLength(1);
    expect(calls.filter((call) =>
      call.startsWith('gcloud storage cp')
    ).every((call) => call.includes('--if-generation-match=0'))).toBe(true);
  }, 30_000);
});
