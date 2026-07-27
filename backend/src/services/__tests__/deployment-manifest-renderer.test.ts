import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const manifestTemplateDirectory = path.join(
  repositoryRoot,
  'deploy/cloudrun',
);
const rendererPath = path.join(
  manifestTemplateDirectory,
  'render-manifests.sh',
);
const candidateRendererPath = path.join(
  manifestTemplateDirectory,
  'prepare-candidate-manifest.sh',
);

const manifestNames = [
  'backend-backfill-dimensions-job.yaml',
  'backend-migrate-job.yaml',
  'backend-service.yaml',
  'backend-worker-job.yaml',
  'frontend-service.yaml',
] as const;

const validRenderEnvironment = {
  LETTER_ARCHIVE_PROJECT_ID: 'letter-archive-test',
  LETTER_ARCHIVE_REGION: 'us-east1',
  LETTER_ARCHIVE_CLOUD_SQL_INSTANCE: 'letter-archive-db',
  LETTER_ARCHIVE_ARCHIVE_BUCKET: 'letter-archive-test-archive',
  LETTER_ARCHIVE_DOMAIN: 'example.test',
  LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT:
    'letter-archive-backend@letter-archive-test.iam.gserviceaccount.com',
  LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT:
    'letter-archive-frontend@letter-archive-test.iam.gserviceaccount.com',
  LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT:
    'letter-archive-worker@letter-archive-test.iam.gserviceaccount.com',
  LETTER_ARCHIVE_MIGRATE_SERVICE_ACCOUNT:
    'letter-archive-migrate@letter-archive-test.iam.gserviceaccount.com',
  LETTER_ARCHIVE_BACKFILL_SERVICE_ACCOUNT:
    'letter-archive-backfill@letter-archive-test.iam.gserviceaccount.com',
  LETTER_ARCHIVE_MIGRATION_RELEASE_MODE: 'automatic',
  LETTER_ARCHIVE_RELEASE_SHA:
    '0123456789abcdef0123456789abcdef01234567',
  LETTER_ARCHIVE_BACKEND_IMAGE:
    'us-east1-docker.pkg.dev/letter-archive-test/archive/backend:abc123',
  LETTER_ARCHIVE_FRONTEND_IMAGE:
    'us-east1-docker.pkg.dev/letter-archive-test/archive/frontend:abc123',
};

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function executeRenderer(
  templateDirectory: string,
  outputDirectory: string,
  environment: NodeJS.ProcessEnv = validRenderEnvironment,
): void {
  execFileSync(
    'bash',
    [rendererPath, templateDirectory, outputDirectory],
    {
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH,
        ...environment,
      },
      stdio: 'pipe',
    },
  );
}

function renderManifestTemplates(): Map<string, string> {
  const temporaryRoot = createTemporaryDirectory(
    'letter-archive-cloudrun-render-',
  );
  const outputDirectory = path.join(temporaryRoot, 'rendered');

  executeRenderer(manifestTemplateDirectory, outputDirectory);

  return new Map(
    readdirSync(outputDirectory)
      .filter((file) => file.endsWith('.yaml'))
      .map((file) => [
        file,
        readFileSync(path.join(outputDirectory, file), 'utf8'),
      ]),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Cloud Run deployment manifest renderer', () => {
  it('renders every manifest field without mutating environment variable names', () => {
    const manifests = renderManifestTemplates();
    const combinedSource = [...manifests.values()].join('\n');
    const backendImage =
      'us-east1-docker.pkg.dev/letter-archive-test/archive/backend:abc123';
    const frontendImage =
      'us-east1-docker.pkg.dev/letter-archive-test/archive/frontend:abc123';
    const cloudSql =
      'letter-archive-test:us-east1:letter-archive-db';

    expect([...manifests.keys()].sort()).toEqual([...manifestNames].sort());
    expect(combinedSource).not.toMatch(/__[A-Z][A-Z0-9_]*__/);
    expect(combinedSource).not.toMatch(
      /(^|[^A-Z0-9_])(PROJECT_NUMBER|PROJECT_ID|REGION|CLOUD_SQL_INSTANCE|ARCHIVE_BUCKET|YOUR_DOMAIN|SERVICE_ACCOUNT_EMAIL|BACKEND_IMAGE|FRONTEND_IMAGE)([^A-Z0-9_]|$)/m,
    );
    expect(combinedSource).not.toContain('CLOUD_RUN_us-east1');

    for (const file of manifestNames) {
      const manifest = manifests.get(file);
      expect(manifest, file).toContain('namespace: letter-archive-test');
      expect(manifest, file).toContain(
        'cloud.googleapis.com/location: us-east1',
      );
    }

    const serviceAccounts = new Map([
      [
        'backend-backfill-dimensions-job.yaml',
        'letter-archive-backfill',
      ],
      ['backend-migrate-job.yaml', 'letter-archive-migrate'],
      ['backend-service.yaml', 'letter-archive-backend'],
      ['backend-worker-job.yaml', 'letter-archive-worker'],
      ['frontend-service.yaml', 'letter-archive-frontend'],
    ]);
    for (const [file, account] of serviceAccounts) {
      expect(manifests.get(file), file).toContain(
        `serviceAccountName: ${account}`
        + '@letter-archive-test.iam.gserviceaccount.com',
      );
    }

    for (const file of [
      'backend-backfill-dimensions-job.yaml',
      'backend-migrate-job.yaml',
      'backend-service.yaml',
      'backend-worker-job.yaml',
    ]) {
      const manifest = manifests.get(file);
      expect(manifest, file).toContain(`image: ${backendImage}`);
      expect(manifest, file).toContain(
        `run.googleapis.com/cloudsql-instances: ${cloudSql}`,
      );
    }

    const databaseSecrets = new Map([
      ['backend-backfill-dimensions-job.yaml', 'database-url-backfill'],
      ['backend-migrate-job.yaml', 'database-url-migrate'],
      ['backend-service.yaml', 'database-url-api'],
      ['backend-worker-job.yaml', 'database-url-worker'],
    ]);
    for (const [file, secret] of databaseSecrets) {
      const manifest = manifests.get(file);
      expect(manifest, file).toContain(`name: ${secret}`);
      expect(manifest, file).not.toMatch(/\bname: database-url\s/);
      for (const otherSecret of databaseSecrets.values()) {
        if (otherSecret !== secret) {
          expect(manifest, file).not.toContain(`name: ${otherSecret}`);
        }
      }
    }

    for (const file of [
      'backend-backfill-dimensions-job.yaml',
      'backend-service.yaml',
      'backend-worker-job.yaml',
    ]) {
      expect(manifests.get(file), file).toContain(
        'bucketName: letter-archive-test-archive',
      );
    }

    for (const file of [
      'backend-service.yaml',
      'backend-worker-job.yaml',
    ]) {
      expect(manifests.get(file), file).toMatch(
        /name: CLOUD_RUN_REGION\s+value: us-east1/,
      );
    }

    const backendService = manifests.get('backend-service.yaml');
    expect(backendService).toContain('kind: Service');
    expect(backendService).toContain('name: letter-archive-backend');
    expect(backendService).toContain('value: https://example.test');
    expect(backendService).toMatch(
      /name: RELEASE_SHA\s+value: 0123456789abcdef0123456789abcdef01234567/,
    );

    const frontendService = manifests.get('frontend-service.yaml');
    expect(frontendService).toContain('kind: Service');
    expect(frontendService).toContain('name: letter-archive-frontend');
    expect(frontendService).toContain(`image: ${frontendImage}`);
    expect(frontendService).not.toContain('cloudsql-instances');
    expect(frontendService).not.toContain('bucketName:');

    expect(manifests.get('backend-migrate-job.yaml')).not.toContain(
      'bucketName:',
    );
    expect(manifests.get('backend-migrate-job.yaml')).toMatch(
      /name: MIGRATION_RELEASE_MODE\s+value: automatic/,
    );
  });

  it('fails closed when a required render value is missing', () => {
    const temporaryRoot = createTemporaryDirectory(
      'letter-archive-cloudrun-render-missing-',
    );
    const outputDirectory = path.join(temporaryRoot, 'rendered');

    expect(() => executeRenderer(
      manifestTemplateDirectory,
      outputDirectory,
      {
        LETTER_ARCHIVE_PROJECT_ID: 'letter-archive-test',
      },
    )).toThrow();
    expect(existsSync(outputDirectory)).toBe(false);
  });

  it('can render only the frontend manifest with frontend-scoped values', () => {
    const temporaryRoot = createTemporaryDirectory(
      'letter-archive-cloudrun-render-frontend-',
    );
    const outputDirectory = path.join(temporaryRoot, 'rendered');

    execFileSync(
      'bash',
      [
        rendererPath,
        manifestTemplateDirectory,
        outputDirectory,
        'frontend-service.yaml',
      ],
      {
        cwd: repositoryRoot,
        env: {
          PATH: process.env.PATH,
          LETTER_ARCHIVE_PROJECT_ID:
            validRenderEnvironment.LETTER_ARCHIVE_PROJECT_ID,
          LETTER_ARCHIVE_REGION:
            validRenderEnvironment.LETTER_ARCHIVE_REGION,
          LETTER_ARCHIVE_DOMAIN:
            validRenderEnvironment.LETTER_ARCHIVE_DOMAIN,
          LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT:
            validRenderEnvironment.LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT,
          LETTER_ARCHIVE_FRONTEND_IMAGE:
            validRenderEnvironment.LETTER_ARCHIVE_FRONTEND_IMAGE,
        },
        stdio: 'pipe',
      },
    );

    expect(readdirSync(outputDirectory)).toEqual(['frontend-service.yaml']);
    expect(
      readFileSync(path.join(outputDirectory, 'frontend-service.yaml'), 'utf8'),
    ).toContain(validRenderEnvironment.LETTER_ARCHIVE_FRONTEND_IMAGE);
  });

  it('creates a zero-traffic candidate with the complete service template', () => {
    const temporaryRoot = createTemporaryDirectory(
      'letter-archive-cloudrun-candidate-',
    );
    const renderedDirectory = path.join(temporaryRoot, 'rendered');
    executeRenderer(manifestTemplateDirectory, renderedDirectory);
    const source = path.join(renderedDirectory, 'frontend-service.yaml');
    const candidate = path.join(renderedDirectory, 'frontend-candidate.yaml');

    execFileSync('bash', [candidateRendererPath, source, candidate], {
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH,
        LETTER_ARCHIVE_SERVICE: 'letter-archive-frontend',
        LETTER_ARCHIVE_PREVIOUS_REVISION:
          'letter-archive-frontend-r-previous',
        LETTER_ARCHIVE_CANDIDATE_REVISION:
          'letter-archive-frontend-r-candidate',
        LETTER_ARCHIVE_CANDIDATE_TAG: 'c-release-build',
      },
      stdio: 'pipe',
    });

    const candidateSource = readFileSync(candidate, 'utf8');
    expect(candidateSource).toContain(
      'name: letter-archive-frontend-r-candidate',
    );
    expect(candidateSource).toContain(
      'revisionName: letter-archive-frontend-r-previous',
    );
    expect(candidateSource).toMatch(
      /revisionName: letter-archive-frontend-r-candidate\s+percent: 0\s+tag: c-release-build/,
    );
    expect(candidateSource).not.toContain('latestRevision: true');
    expect(candidateSource).toContain(
      validRenderEnvironment.LETTER_ARCHIVE_FRONTEND_IMAGE,
    );
    expect(candidateSource).toContain('memory: 256Mi');
  });

  it('rejects values that could alter shell or YAML structure', () => {
    for (const unsafeDomain of [
      'example.test # truncated',
      'example.test: bad',
      'example.test\\bad',
      'example.test\r',
      'example.test\tbad',
    ]) {
      const temporaryRoot = createTemporaryDirectory(
        'letter-archive-cloudrun-render-unsafe-',
      );
      const outputDirectory = path.join(temporaryRoot, 'rendered');

      expect(() => executeRenderer(
        manifestTemplateDirectory,
        outputDirectory,
        {
          ...validRenderEnvironment,
          LETTER_ARCHIVE_DOMAIN: unsafeDomain,
        },
      ), unsafeDomain).toThrow();
      expect(existsSync(outputDirectory), unsafeDomain).toBe(false);
    }
  });

  it('rejects a rerun without changing existing rendered output', () => {
    const temporaryRoot = createTemporaryDirectory(
      'letter-archive-cloudrun-render-rerun-',
    );
    const outputDirectory = path.join(temporaryRoot, 'rendered');

    executeRenderer(manifestTemplateDirectory, outputDirectory);

    const originalOutput = new Map(manifestNames.map((file) => [
      file,
      readFileSync(path.join(outputDirectory, file), 'utf8'),
    ]));

    expect(() => executeRenderer(
      manifestTemplateDirectory,
      outputDirectory,
      {
        ...validRenderEnvironment,
        LETTER_ARCHIVE_PROJECT_ID: 'letter-archive-next',
        LETTER_ARCHIVE_ARCHIVE_BUCKET: 'letter-archive-next-archive',
        LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT:
          'letter-archive-backend@letter-archive-next.iam.gserviceaccount.com',
        LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT:
          'letter-archive-frontend@letter-archive-next.iam.gserviceaccount.com',
        LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT:
          'letter-archive-worker@letter-archive-next.iam.gserviceaccount.com',
        LETTER_ARCHIVE_MIGRATE_SERVICE_ACCOUNT:
          'letter-archive-migrate@letter-archive-next.iam.gserviceaccount.com',
        LETTER_ARCHIVE_BACKFILL_SERVICE_ACCOUNT:
          'letter-archive-backfill@letter-archive-next.iam.gserviceaccount.com',
        LETTER_ARCHIVE_BACKEND_IMAGE:
          'us-east1-docker.pkg.dev/letter-archive-next/archive/backend:def456',
        LETTER_ARCHIVE_FRONTEND_IMAGE:
          'us-east1-docker.pkg.dev/letter-archive-next/archive/frontend:def456',
      },
    )).toThrow();

    for (const [file, originalContents] of originalOutput) {
      expect(
        readFileSync(path.join(outputDirectory, file), 'utf8'),
        file,
      ).toBe(originalContents);
    }
    expect(
      readdirSync(temporaryRoot).filter((entry) => (
        entry.startsWith('.cloudrun-render.')
      )),
    ).toEqual([]);
  });

  it('leaves every template unchanged after a late validation failure', () => {
    const temporaryRoot = createTemporaryDirectory(
      'letter-archive-cloudrun-render-atomic-',
    );
    const templateCopy = path.join(temporaryRoot, 'templates');
    const outputDirectory = path.join(temporaryRoot, 'rendered');
    cpSync(manifestTemplateDirectory, templateCopy, { recursive: true });

    appendFileSync(
      path.join(templateCopy, 'frontend-service.yaml'),
      '\n# __UNKNOWN_PLACEHOLDER__\n',
    );

    const originals = new Map(manifestNames.map((file) => {
      const absolutePath = path.join(templateCopy, file);
      return [file, {
        contents: readFileSync(absolutePath, 'utf8'),
        mode: statSync(absolutePath).mode,
      }];
    }));

    expect(() => executeRenderer(templateCopy, outputDirectory)).toThrow();
    expect(existsSync(outputDirectory)).toBe(false);

    for (const [file, original] of originals) {
      const absolutePath = path.join(templateCopy, file);
      expect(readFileSync(absolutePath, 'utf8'), file).toBe(
        original.contents,
      );
      expect(statSync(absolutePath).mode, file).toBe(original.mode);
    }

    expect(
      readdirSync(temporaryRoot).filter((entry) => (
        entry.startsWith('.cloudrun-render.')
      )),
    ).toEqual([]);
  });
});
