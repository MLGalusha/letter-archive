import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import postgres from 'postgres';
import {
  cohortSchema,
  runManifestSchema,
  type CohortLetter,
  type LayoutRunManifest,
} from '../src/benchmarks/layout/schemas.js';
import {
  DEVELOPMENT_STUB_TRANSCRIPTION_SHA256,
  isDevelopmentStubTranscription,
} from '../src/ai/openai/transcription-stub.js';
import {
  assertBenchmarkTranscriptPageEligible,
  assertLocalDatabaseUrl,
  assertPathInside,
} from '../src/benchmarks/transcript-alignment/snapshot-source.js';
import {
  parseTranscriptPages,
  sha256,
} from '../src/services/transcript-alignment/transcript-pages.js';

type UsableLetter = {
  collectionCode: string;
  dateRaw: string;
  pageCount: number;
  type: 'L';
  typeSequence: number;
};

type TranscriptSourceRow = {
  has_matching_human_version: boolean;
  id: string;
  latest_version_created_at: Date | string | null;
  latest_version_id: string | null;
  latest_version_primary_source_revision: number | null;
  latest_version_source: string | null;
  latest_version_text: string | null;
  latest_version_version_number: number | null;
  primary_source_revision: number;
  transcript_confirmation_id: string | null;
  transcript_confirmation_source_revision: number | null;
  transcript_confirmation_transcript_digest: string | null;
  transcript_confirmed_at: Date | string | null;
  transcript_confirmed_by: string | null;
  transcript_status: string;
  transcription_status: string;
  transcription_text: string | null;
  collection_code: string;
  date_raw: string;
  type: string;
  type_sequence: number;
};

type PageSourceRow = {
  checksum_sha256: string | null;
  created_at: Date | string;
  height: number | null;
  id: string;
  letter_id: string;
  original_filename: string;
  page_layout_checksum_sha256: string | null;
  page_number: number;
  segment_trust_state: string;
  storage_path: string;
  updated_at: Date | string;
  width: number | null;
  collection_code: string;
  date_raw: string;
  type: string;
  type_sequence: number;
};

type VerifiedFile = {
  path: string;
  sha256: string;
  sizeBytes: number;
};

const BACKEND_ROOT = resolve(import.meta.dirname, '..');
const RESULT_ROOT = resolve(
  BACKEND_ROOT,
  'test-results/transcript-alignment',
);
const DEFAULT_COHORT_PATH = resolve(
  BACKEND_ROOT,
  'benchmarks/layout/cohort.v1.json',
);
const LAYOUT_RUN_ID = 'kraken7-blla-v2-full-20260728';
const LAYOUT_RUN_ROOT = resolve(
  BACKEND_ROOT,
  'test-results/layout-benchmark/runs',
  LAYOUT_RUN_ID,
);
const LAYOUT_RUN_MANIFEST_PATH = resolve(LAYOUT_RUN_ROOT, 'run.v2.json');
const DEFAULT_OUTPUT_PATH = resolve(
  RESULT_ROOT,
  'cohorts/usable-transcripts.v1.json',
);
const EXPECTED_COHORT_ID = 'handwriting-layout-v1';
const EXPECTED_INCLUDED_LETTERS = 6;
const EXPECTED_INCLUDED_PAGES = 26;
const MINIMUM_TRANSCRIPT_CHARACTERS = 100;

const USABLE_LETTERS = [
  {
    collectionCode: '003',
    dateRaw: '18880810',
    type: 'L',
    typeSequence: 1,
    pageCount: 4,
  },
  {
    collectionCode: '005',
    dateRaw: '19150813',
    type: 'L',
    typeSequence: 1,
    pageCount: 1,
  },
  {
    collectionCode: '007',
    dateRaw: '19181119',
    type: 'L',
    typeSequence: 1,
    pageCount: 8,
  },
  {
    collectionCode: '008',
    dateRaw: '18850922',
    type: 'L',
    typeSequence: 1,
    pageCount: 2,
  },
  {
    collectionCode: '009',
    dateRaw: '19470830',
    type: 'L',
    typeSequence: 1,
    pageCount: 9,
  },
  {
    collectionCode: '011',
    dateRaw: '19450424',
    type: 'L',
    typeSequence: 1,
    pageCount: 2,
  },
] as const satisfies readonly UsableLetter[];

type Arguments = {
  outputPath: string;
  replace: boolean;
};

function parseArguments(values: string[]): Arguments {
  let outputPath = DEFAULT_OUTPUT_PATH;
  let outputSeen = false;
  let replace = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--output') {
      if (outputSeen) throw new Error('--output may be supplied only once');
      const output = values[index + 1];
      if (!output || output.startsWith('--')) {
        throw new Error('--output requires a path');
      }
      outputPath = resolve(output);
      outputSeen = true;
      index += 1;
    } else if (value === '--replace') {
      if (replace) throw new Error('--replace may be supplied only once');
      replace = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  assertPathInside(RESULT_ROOT, outputPath);
  if (extname(outputPath) !== '.json') {
    throw new Error('Snapshot output must be a .json file');
  }
  return { outputPath, replace };
}

function identityKey(input: {
  collectionCode: string;
  dateRaw: string;
  type: string;
  typeSequence: number;
}): string {
  return [
    input.collectionCode,
    input.dateRaw,
    `${input.type}${String(input.typeSequence).padStart(2, '0')}`,
  ].join('-');
}

function rowIdentityKey(input: {
  collection_code: string;
  date_raw: string;
  type: string;
  type_sequence: number;
}): string {
  return identityKey({
    collectionCode: input.collection_code,
    dateRaw: input.date_raw,
    type: input.type,
    typeSequence: input.type_sequence,
  });
}

function pageKey(letterKey: string, pageNumber: number): string {
  return `${letterKey}-${String(pageNumber).padStart(2, '0')}`;
}

function isoTimestamp(value: Date | string | null): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid database timestamp: ${value}`);
  return parsed.toISOString();
}

function sourceTrust(
  row: TranscriptSourceRow,
  transcriptSha256: string,
): {
  confirmationIdentityCurrent: boolean;
  explanation: string;
  tier: 'modern-confirmed' | 'legacy-confirmed' | 'human-edited' | 'ai-draft';
} {
  const confirmationIdentityCurrent = Boolean(
    row.transcript_confirmation_id
    && row.transcript_confirmation_source_revision
      === row.primary_source_revision
    && row.transcript_confirmation_transcript_digest === transcriptSha256,
  );
  const confirmedAt = row.transcript_confirmed_at
    ? new Date(row.transcript_confirmed_at).valueOf()
    : null;
  const latestVersionCreatedAt = row.latest_version_created_at
    ? new Date(row.latest_version_created_at).valueOf()
    : null;
  const legacyConfirmationCurrent = Boolean(
    confirmedAt !== null
    && Number.isFinite(confirmedAt)
    && (
      latestVersionCreatedAt === null
      || (
        Number.isFinite(latestVersionCreatedAt)
        && confirmedAt >= latestVersionCreatedAt
      )
    ),
  );
  if (confirmationIdentityCurrent) {
    return {
      tier: 'modern-confirmed',
      explanation: 'Current text is bound to a complete confirmation identity.',
      confirmationIdentityCurrent,
    };
  }
  if (legacyConfirmationCurrent) {
    return {
      tier: 'legacy-confirmed',
      explanation:
        'A reviewer confirmed this text before modern digest/revision binding existed.',
      confirmationIdentityCurrent,
    };
  }
  if (row.has_matching_human_version) {
    return {
      tier: 'human-edited',
      explanation: row.transcript_confirmed_at
        ? 'Current text matches a saved human version created after the legacy confirmation.'
        : 'Current text exactly matches a saved human transcript version.',
      confirmationIdentityCurrent,
    };
  }
  return {
    tier: 'ai-draft',
    explanation: 'Current text is an unconfirmed AI draft.',
    confirmationIdentityCurrent,
  };
}

function sameValues(actual: unknown[], expected: unknown[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function assertExactUsableConstants(): void {
  const keys = USABLE_LETTERS.map(identityKey);
  if (USABLE_LETTERS.length !== EXPECTED_INCLUDED_LETTERS) {
    throw new Error('Usable-letter contract must contain exactly 6 letters');
  }
  if (new Set(keys).size !== keys.length) {
    throw new Error('Usable-letter contract contains a duplicate letter key');
  }
  const pages = USABLE_LETTERS.reduce(
    (count, letter) => count + letter.pageCount,
    0,
  );
  if (pages !== EXPECTED_INCLUDED_PAGES) {
    throw new Error('Usable-letter contract must contain exactly 26 pages');
  }
}

async function hashRegularFile(path: string): Promise<VerifiedFile> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Expected a regular non-symlink file: ${path}`);
  }
  const hash = await new Promise<string>((resolveHash, reject) => {
    const digest = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    digest.on('error', reject);
    digest.on('finish', () => resolveHash(digest.read().toString('hex')));
    stream.pipe(digest);
  });
  return { path, sha256: hash, sizeBytes: metadata.size };
}

async function resolveRegularFileInside(
  root: string,
  relativePath: string,
): Promise<string> {
  const target = assertPathInside(root, resolve(root, relativePath));
  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(target),
  ]);
  assertPathInside(realRoot, realTarget);
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Artifact is not a regular non-symlink file: ${relativePath}`);
  }
  return target;
}

async function verifyDeclaredFile(
  root: string,
  relativePath: string,
  declaration: { sha256: string; sizeBytes: number },
): Promise<VerifiedFile> {
  const path = await resolveRegularFileInside(root, relativePath);
  const actual = await hashRegularFile(path);
  if (
    actual.sha256 !== declaration.sha256
    || actual.sizeBytes !== declaration.sizeBytes
  ) {
    throw new Error(`Artifact hash/size mismatch: ${relativePath}`);
  }
  return { ...actual, path: relativePath };
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'ENOENT';
}

async function ensureDirectoryTreeInside(
  root: string,
  directory: string,
): Promise<void> {
  const target = resolve(directory);
  const pathFromRoot = relative(root, target);
  if (
    target !== resolve(root)
    && (
      pathFromRoot === '..'
      || pathFromRoot.startsWith(`..${sep}`)
    )
  ) {
    throw new Error(`Directory must remain below ${root}`);
  }
  const rootMetadata = await lstat(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(`Trusted output root is not a regular directory: ${root}`);
  }
  let current = resolve(root);
  for (const segment of pathFromRoot.split(sep).filter(Boolean)) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error: unknown) {
      if (!isMissingFileError(error)) throw error;
      await mkdir(current);
      metadata = await lstat(current);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Output directory component is unsafe: ${current}`);
    }
  }
  const [realRoot, realDirectory] = await Promise.all([
    realpath(root),
    realpath(target),
  ]);
  if (realDirectory !== realRoot) assertPathInside(realRoot, realDirectory);
}

async function ensureSafeOutputParent(outputPath: string): Promise<void> {
  await ensureDirectoryTreeInside(BACKEND_ROOT, RESULT_ROOT);
  await ensureDirectoryTreeInside(RESULT_ROOT, dirname(outputPath));
  const [realRoot, realParent] = await Promise.all([
    realpath(RESULT_ROOT),
    realpath(dirname(outputPath)),
  ]);
  assertPathInside(realRoot, join(realParent, basename(outputPath)));
}

async function atomicWriteJson(
  path: string,
  value: unknown,
  replace: boolean,
): Promise<void> {
  await ensureSafeOutputParent(path);
  if (!replace) {
    try {
      await lstat(path);
      throw new Error(
        `Snapshot already exists; rerun with --replace to overwrite it: ${path}`,
      );
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        // Expected.
      } else {
        throw error;
      }
    }
  }

  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await writeFile(temporaryPath, bytes, { flag: 'wx' });
  try {
    if (replace) {
      await rename(temporaryPath, path);
    } else {
      await link(temporaryPath, path);
      await unlink(temporaryPath);
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    if (
      !replace
      && error instanceof Error
      && 'code' in error
      && error.code === 'EEXIST'
    ) {
      throw new Error(
        `Snapshot already exists; rerun with --replace to overwrite it: ${path}`,
      );
    }
    throw error;
  }
}

async function readDatabaseSnapshot(
  databaseUrl: string,
): Promise<{
  letters: TranscriptSourceRow[];
  pages: PageSourceRow[];
}> {
  const client = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    connection: {
      application_name: 'letter-archive-transcript-snapshot-read-only',
      default_transaction_read_only: 'on',
    },
    onnotice: () => {},
  });
  try {
    return await client.begin(
      'isolation level repeatable read read only',
      async (transaction) => {
        const letters = await transaction<TranscriptSourceRow[]>`
          SELECT
            l.id,
            c.collection_code,
            l.date_raw,
            l.type,
            l.type_sequence,
            l.primary_source_revision,
            l.transcript_status,
            l.transcription_status,
            l.transcription_text,
            l.transcript_confirmed_at,
            l.transcript_confirmed_by,
            l.transcript_confirmation_id,
            l.transcript_confirmation_source_revision,
            l.transcript_confirmation_transcript_digest,
            latest_version.id AS latest_version_id,
            latest_version.version_number AS latest_version_version_number,
            latest_version.source AS latest_version_source,
            latest_version.primary_source_revision
              AS latest_version_primary_source_revision,
            latest_version.created_at AS latest_version_created_at,
            latest_version.content->>'text' AS latest_version_text,
            EXISTS (
              SELECT 1
              FROM letter_versions matching_version
              WHERE matching_version.letter_id = l.id
                AND matching_version.field_type = 'transcript'
                AND matching_version.source = 'human'
                AND matching_version.content->>'text' = l.transcription_text
            ) AS has_matching_human_version
          FROM letters l
          INNER JOIN collections c ON c.id = l.collection_id
          LEFT JOIN LATERAL (
            SELECT
              version.id,
              version.version_number,
              version.source,
              version.primary_source_revision,
              version.created_at,
              version.content
            FROM letter_versions version
            WHERE version.letter_id = l.id
              AND version.field_type = 'transcript'
            ORDER BY version.version_number DESC
            LIMIT 1
          ) latest_version ON true
          WHERE concat(
            c.collection_code,
            '-',
            l.date_raw,
            '-',
            l.type,
            lpad(l.type_sequence::text, 2, '0')
          ) = ANY(${transaction.array(
            USABLE_LETTERS.map(identityKey),
          )}::text[])
          ORDER BY c.collection_code, l.date_raw, l.type, l.type_sequence
        `;
        const pages = await transaction<PageSourceRow[]>`
          SELECT
            page.id,
            page.letter_id,
            page.page_number,
            page.storage_path,
            page.original_filename,
            page.checksum_sha256,
            page.width,
            page.height,
            page.page_layout_checksum_sha256,
            page.segment_trust_state,
            page.created_at,
            page.updated_at,
            c.collection_code,
            l.date_raw,
            l.type,
            l.type_sequence
          FROM letter_pages page
          INNER JOIN letters l ON l.id = page.letter_id
          INNER JOIN collections c ON c.id = l.collection_id
          WHERE concat(
            c.collection_code,
            '-',
            l.date_raw,
            '-',
            l.type,
            lpad(l.type_sequence::text, 2, '0')
          ) = ANY(${transaction.array(
            USABLE_LETTERS.map(identityKey),
          )}::text[])
          ORDER BY c.collection_code, l.date_raw, l.type, l.type_sequence,
            page.page_number
        `;
        return { letters: [...letters], pages: [...pages] };
      },
    );
  } finally {
    await client.end({ timeout: 3 });
  }
}

function selectCohortLetters(
  cohortLetters: CohortLetter[],
): Map<string, CohortLetter> {
  const allCohortLetters = new Map(
    cohortLetters.map((letter) => [identityKey(letter.identity), letter]),
  );
  const selected = new Map<string, CohortLetter>();
  for (const expected of USABLE_LETTERS) {
    const key = identityKey(expected);
    const letter = allCohortLetters.get(key);
    if (!letter) throw new Error(`Usable letter is absent from cohort: ${key}`);
    const expectedPages = Array.from(
      { length: expected.pageCount },
      (_, index) => index + 1,
    );
    const actualPages = letter.pages.map((page) => page.pageNumber);
    if (!sameValues(actualPages, expectedPages)) {
      throw new Error(`${key} cohort pages are not exactly ${expectedPages.join(', ')}`);
    }
    selected.set(key, letter);
  }
  if (
    selected.size !== EXPECTED_INCLUDED_LETTERS
    || [...selected.values()].reduce(
      (sum, letter) => sum + letter.pages.length,
      0,
    ) !== EXPECTED_INCLUDED_PAGES
  ) {
    throw new Error('Selected cohort is not exactly 6 letters / 26 pages');
  }
  return selected;
}

async function verifyRunAndSources(input: {
  cohortBytes: Buffer;
  cohortId: string;
  selectedCohort: Map<string, CohortLetter>;
  run: LayoutRunManifest;
}): Promise<Map<string, {
  artifacts: Record<string, VerifiedFile>;
  prepared: VerifiedFile;
  source: VerifiedFile;
}>> {
  const {
    cohortBytes,
    cohortId,
    selectedCohort,
    run,
  } = input;
  const cohortSha256 = sha256(cohortBytes);
  if (
    run.runId !== LAYOUT_RUN_ID
    || run.state !== 'completed'
    || run.cohort.id !== cohortId
    || run.cohort.sha256 !== cohortSha256
    || run.cohort.manifestPath !== 'benchmarks/layout/cohort.v1.json'
  ) {
    throw new Error('Layout run is not bound to the expected completed cohort');
  }
  if (run.cohort.selection.scope !== 'full') {
    throw new Error('Transcript snapshot requires the complete 66-page layout run');
  }

  const cohortSnapshot = run.sourceSnapshot.files[run.cohort.manifestPath];
  if (
    !cohortSnapshot
    || cohortSnapshot.sha256 !== cohortSha256
    || cohortSnapshot.sizeBytes !== cohortBytes.length
  ) {
    throw new Error('Run source snapshot is not bound to the current cohort bytes');
  }
  await verifyDeclaredFile(
    LAYOUT_RUN_ROOT,
    cohortSnapshot.snapshotPath,
    cohortSnapshot,
  );

  const runPages = new Map(run.pages.map((page) => [page.pageKey, page]));
  const verification = new Map<string, {
    artifacts: Record<string, VerifiedFile>;
    prepared: VerifiedFile;
    source: VerifiedFile;
  }>();
  for (const [key, letter] of selectedCohort) {
    for (const page of letter.pages) {
      const keyForPage = pageKey(key, page.pageNumber);
      const runPage = runPages.get(keyForPage);
      if (
        !runPage
        || runPage.status !== 'succeeded'
        || runPage.source.filename !== page.originalFilename
        || runPage.source.sha256 !== page.checksumSha256
        || runPage.source.width !== page.width
        || runPage.source.height !== page.height
        || !runPage.prepared
      ) {
        throw new Error(`Run/cohort source identity mismatch for ${keyForPage}`);
      }
      const sourcePath = await resolveRegularFileInside(
        BACKEND_ROOT,
        runPage.source.relativePath,
      );
      const source = await hashRegularFile(sourcePath);
      if (source.sha256 !== page.checksumSha256) {
        throw new Error(`Current source image hash mismatch for ${keyForPage}`);
      }
      const preparedDeclaration = run.integrity.artifacts[
        runPage.prepared.artifact
      ];
      if (
        !preparedDeclaration
        || preparedDeclaration.sha256 !== runPage.prepared.sha256
      ) {
        throw new Error(`Prepared artifact declaration mismatch for ${keyForPage}`);
      }
      const prepared = await verifyDeclaredFile(
        LAYOUT_RUN_ROOT,
        runPage.prepared.artifact,
        preparedDeclaration,
      );
      const artifacts: Record<string, VerifiedFile> = {};
      for (const [kind, artifactPath] of Object.entries(runPage.artifacts)) {
        if (!artifactPath) continue;
        const declaration = run.integrity.artifacts[artifactPath];
        if (!declaration) {
          throw new Error(`Missing ${kind} integrity declaration for ${keyForPage}`);
        }
        artifacts[kind] = await verifyDeclaredFile(
          LAYOUT_RUN_ROOT,
          artifactPath,
          declaration,
        );
      }
      verification.set(keyForPage, {
        source: {
          ...source,
          path: relative(BACKEND_ROOT, source.path),
        },
        prepared,
        artifacts,
      });
    }
  }
  if (verification.size !== EXPECTED_INCLUDED_PAGES) {
    throw new Error('Verified run does not contain exactly 26 selected pages');
  }
  return verification;
}

function assertSnapshotTranscriptBytes(snapshot: {
  letters: Array<{
    transcript: { byteLength: number; sha256: string; text: string };
    pages: Array<{
      transcript: {
        byteEndExclusive: number;
        byteStart: number;
        sha256: string;
        text: string;
      };
    }>;
  }>;
}): void {
  for (const letter of snapshot.letters) {
    const bytes = Buffer.from(letter.transcript.text, 'utf8');
    if (
      bytes.length !== letter.transcript.byteLength
      || sha256(bytes) !== letter.transcript.sha256
    ) {
      throw new Error('Serialized transcript bytes failed their stored digest');
    }
    for (const page of letter.pages) {
      const pageBytes = Buffer.from(page.transcript.text, 'utf8');
      if (
        sha256(pageBytes) !== page.transcript.sha256
        || !pageBytes.equals(bytes.subarray(
          page.transcript.byteStart,
          page.transcript.byteEndExclusive,
        ))
      ) {
        throw new Error('Serialized page transcript bytes failed their stored range/digest');
      }
    }
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Transcript source snapshots are forbidden in NODE_ENV=production');
  }
  assertExactUsableConstants();
  const args = parseArguments(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL
    ?? 'postgresql://app:app@localhost:5432/app';
  assertLocalDatabaseUrl(databaseUrl);

  const [cohortBytes, runManifestBytes, databaseSnapshot] = await Promise.all([
    readFile(DEFAULT_COHORT_PATH),
    readFile(LAYOUT_RUN_MANIFEST_PATH),
    readDatabaseSnapshot(databaseUrl),
  ]);
  const cohort = cohortSchema.parse(JSON.parse(cohortBytes.toString('utf8')));
  const run = runManifestSchema.parse(
    JSON.parse(runManifestBytes.toString('utf8')),
  );
  if (cohort.cohortId !== EXPECTED_COHORT_ID) {
    throw new Error(`Unexpected cohort ID: ${cohort.cohortId}`);
  }
  const selectedCohort = selectCohortLetters(cohort.letters);
  const verifiedFiles = await verifyRunAndSources({
    cohortBytes,
    cohortId: cohort.cohortId,
    selectedCohort,
    run,
  });

  const candidateKeys = USABLE_LETTERS.map(identityKey);
  const letterRows = new Map(
    databaseSnapshot.letters.map((row) => [rowIdentityKey(row), row]),
  );
  if (
    databaseSnapshot.letters.length !== EXPECTED_INCLUDED_LETTERS
    || !sameValues([...letterRows.keys()], candidateKeys)
  ) {
    throw new Error('Local database does not contain exactly the six usable letter rows');
  }
  const pageRowsByLetter = new Map<string, PageSourceRow[]>();
  for (const page of databaseSnapshot.pages) {
    const key = rowIdentityKey(page);
    pageRowsByLetter.set(key, [...(pageRowsByLetter.get(key) ?? []), page]);
  }
  if (databaseSnapshot.pages.length !== EXPECTED_INCLUDED_PAGES) {
    throw new Error('Local database does not contain exactly the 26 usable page rows');
  }

  const letters = [];
  const quarantinedLetters: Array<{
    expectedStubSha256: string;
    letterKey: string;
    pageNumbers: number[];
    pages: Array<{
      pageNumber: number;
      transcriptSha256: string;
    }>;
    primarySourceRevision: number;
    reason: 'known-development-stub-transcript';
    transcriptSha256: string;
  }> = [];
  for (const expected of USABLE_LETTERS) {
    const key = identityKey(expected);
    const row = letterRows.get(key);
    const cohortLetter = selectedCohort.get(key);
    const databasePages = pageRowsByLetter.get(key) ?? [];
    if (!row || !cohortLetter) throw new Error(`Missing selected source: ${key}`);
    if (
      row.transcription_status !== 'SUCCESS'
      || row.transcription_text === null
      || row.transcription_text.length < MINIMUM_TRANSCRIPT_CHARACTERS
    ) {
      throw new Error(`${key} no longer satisfies the usable-transcript contract`);
    }
    const expectedPageNumbers = Array.from(
      { length: expected.pageCount },
      (_, index) => index + 1,
    );
    if (!sameValues(
      databasePages.map((page) => page.page_number),
      expectedPageNumbers,
    )) {
      throw new Error(`${key} database pages are not exactly ${expectedPageNumbers.join(', ')}`);
    }

    const text = row.transcription_text;
    const transcriptBytes = Buffer.from(text, 'utf8');
    const transcriptSha256 = sha256(transcriptBytes);
    cohortLetter.pages.forEach((cohortPage, index) => {
      const databasePage = databasePages[index];
      const keyForPage = pageKey(key, cohortPage.pageNumber);
      const runPage = run.pages.find((page) => page.pageKey === keyForPage);
      const verified = verifiedFiles.get(keyForPage);
      if (!databasePage || !runPage || !verified) {
        throw new Error(`Incomplete source binding for ${keyForPage}`);
      }
      if (
        databasePage.letter_id !== row.id
        || databasePage.page_number !== cohortPage.pageNumber
        || databasePage.original_filename !== cohortPage.originalFilename
        || databasePage.checksum_sha256 !== cohortPage.checksumSha256
        || databasePage.width !== cohortPage.width
        || databasePage.height !== cohortPage.height
        || databasePage.storage_path !== runPage.source.relativePath
      ) {
        throw new Error(`Database/cohort/run page identity mismatch for ${keyForPage}`);
      }
      isoTimestamp(databasePage.created_at);
      isoTimestamp(databasePage.updated_at);
    });
    isoTimestamp(row.transcript_confirmed_at);
    const latestVersionText = row.latest_version_text;
    const latestVersionMetadata = [
      row.latest_version_version_number,
      row.latest_version_source,
      row.latest_version_primary_source_revision,
      row.latest_version_created_at,
      latestVersionText,
    ];
    if (
      row.latest_version_id === null
        ? latestVersionMetadata.some((value) => value !== null)
        : latestVersionMetadata.some((value) => value === null)
    ) {
      throw new Error(`${key} latest transcript version metadata is incomplete`);
    }
    const latestVersion = row.latest_version_id === null
      ? null
      : {
          id: row.latest_version_id,
          versionNumber: row.latest_version_version_number,
          source: row.latest_version_source,
          primarySourceRevision:
            row.latest_version_primary_source_revision,
          createdAt: isoTimestamp(row.latest_version_created_at),
          textSha256: latestVersionText === null
            ? null
            : sha256(Buffer.from(latestVersionText, 'utf8')),
          textByteLength: latestVersionText === null
            ? null
            : Buffer.byteLength(latestVersionText, 'utf8'),
          matchesCurrentTranscript: latestVersionText === text,
        };
    const trust = sourceTrust(row, transcriptSha256);
    const pageSlices = parseTranscriptPages({
      letterKey: key,
      transcript: text,
      expectedPageNumbers,
      allowUnmarkedSinglePage: key === '005-19150813-L01',
    });
    const stubPages = pageSlices.filter(
      (page) => isDevelopmentStubTranscription(page.content.text),
    );
    if (stubPages.length > 0) {
      quarantinedLetters.push({
        expectedStubSha256: DEVELOPMENT_STUB_TRANSCRIPTION_SHA256,
        letterKey: key,
        pageNumbers: stubPages.map((page) => page.pageNumber),
        pages: stubPages.map((page) => ({
          pageNumber: page.pageNumber,
          transcriptSha256: page.content.sha256,
        })),
        primarySourceRevision: row.primary_source_revision,
        reason: 'known-development-stub-transcript',
        transcriptSha256,
      });
      continue;
    }
    pageSlices.forEach((page) => {
      assertBenchmarkTranscriptPageEligible({
        letterKey: key,
        pageNumber: page.pageNumber,
        text: page.content.text,
      });
    });
    const pages = cohortLetter.pages.map((cohortPage, index) => {
      const databasePage = databasePages[index];
      const transcript = pageSlices[index];
      const keyForPage = pageKey(key, cohortPage.pageNumber);
      const runPage = run.pages.find((page) => page.pageKey === keyForPage);
      const verified = verifiedFiles.get(keyForPage);
      if (!databasePage || !transcript || !runPage || !verified) {
        throw new Error(`Incomplete source binding for ${keyForPage}`);
      }
      if (
        databasePage.letter_id !== row.id
        || databasePage.page_number !== cohortPage.pageNumber
        || databasePage.original_filename !== cohortPage.originalFilename
        || databasePage.checksum_sha256 !== cohortPage.checksumSha256
        || databasePage.width !== cohortPage.width
        || databasePage.height !== cohortPage.height
        || databasePage.storage_path !== runPage.source.relativePath
      ) {
        throw new Error(`Database/cohort/run page identity mismatch for ${keyForPage}`);
      }
      return {
        pageKey: keyForPage,
        pageNumber: cohortPage.pageNumber,
        originalFilename: cohortPage.originalFilename,
        sourceSha256: cohortPage.checksumSha256,
        width: cohortPage.width,
        height: cohortPage.height,
        challengeTags: cohortPage.challengeTags,
        database: {
          id: databasePage.id,
          letterId: databasePage.letter_id,
          pageNumber: databasePage.page_number,
          storagePath: databasePage.storage_path,
          originalFilename: databasePage.original_filename,
          checksumSha256: databasePage.checksum_sha256,
          width: databasePage.width,
          height: databasePage.height,
          pageLayoutChecksumSha256:
            databasePage.page_layout_checksum_sha256,
          segmentTrustState: databasePage.segment_trust_state,
          createdAt: isoTimestamp(databasePage.created_at),
          updatedAt: isoTimestamp(databasePage.updated_at),
        },
        transcript: {
          text: transcript.content.text,
          sha256: transcript.content.sha256,
          characterCount: transcript.content.characterCount,
          byteLength: transcript.content.byteLength,
          byteStart: transcript.content.byteStart,
          byteEndExclusive: transcript.content.byteEndExclusive,
          marker: transcript.marker,
          section: transcript.section,
          lines: transcript.lines,
        },
        layoutRun: {
          runId: run.runId,
          source: verified.source,
          prepared: verified.prepared,
          artifacts: verified.artifacts,
        },
      };
    });
    letters.push({
      letterKey: key,
      identity: cohortLetter.identity,
      databaseLetterId: row.id,
      primarySourceRevision: row.primary_source_revision,
      pageAssignment: {
        strategy: expected.pageCount === 1
          ? 'single-page-exact'
          : 'exact-page-markers',
        explanation: expected.pageCount === 1
          ? 'The complete transcript belongs to the only page.'
          : 'Exact ordered --- Page N --- delimiters bind transcript bytes to physical pages.',
      },
      transcript: {
        text,
        sha256: transcriptSha256,
        characterCount: text.length,
        byteLength: transcriptBytes.length,
        sourceStatus: {
          transcriptStatus: row.transcript_status,
          transcriptionStatus: row.transcription_status,
          confirmedAt: isoTimestamp(row.transcript_confirmed_at),
          confirmedBy: row.transcript_confirmed_by,
          confirmationId: row.transcript_confirmation_id,
          confirmationSourceRevision:
            row.transcript_confirmation_source_revision,
          confirmationTranscriptDigest:
            row.transcript_confirmation_transcript_digest,
          hasMatchingHumanVersion: row.has_matching_human_version,
          ...trust,
        },
        latestVersion,
        lines: pages.flatMap((page) => page.transcript.lines),
      },
      pages,
    });
  }

  const includedKeys = letters.map((letter) => letter.letterKey);
  const includedPageCount = letters.reduce(
    (sum, letter) => sum + letter.pages.length,
    0,
  );
  const quarantinedKeys = new Set(
    quarantinedLetters.map((letter) => letter.letterKey),
  );
  const quarantinedPageCount = USABLE_LETTERS
    .filter((letter) => quarantinedKeys.has(identityKey(letter)))
    .reduce((sum, letter) => sum + letter.pageCount, 0);
  if (
    letters.length + quarantinedLetters.length !== EXPECTED_INCLUDED_LETTERS
    || includedPageCount + quarantinedPageCount !== EXPECTED_INCLUDED_PAGES
  ) {
    throw new Error(
      'Every benchmark candidate must be included or explicitly quarantined',
    );
  }

  const snapshot = {
    schemaVersion: 1,
    kind: 'transcript-alignment-source-snapshot',
    createdAt: new Date().toISOString(),
    source: {
      cohortId: cohort.cohortId,
      cohortSchemaVersion: cohort.schemaVersion,
      cohortPath: relative(BACKEND_ROOT, DEFAULT_COHORT_PATH),
      cohortSha256: sha256(cohortBytes),
      layoutRunId: run.runId,
      layoutRunManifestPath: relative(
        BACKEND_ROOT,
        LAYOUT_RUN_MANIFEST_PATH,
      ),
      layoutRunManifestSha256: sha256(runManifestBytes),
      databaseAccess:
        'one REPEATABLE READ READ ONLY transaction against guarded local TCP PostgreSQL',
    },
    policy: {
      candidateLetterKeys: candidateKeys,
      exactUsableLetterKeys: includedKeys,
      exactIncludedLetterCount: letters.length,
      exactIncludedPageCount: includedPageCount,
      quarantinedLetters,
      minimumTranscriptCharacters: MINIMUM_TRANSCRIPT_CHARACTERS,
      allowedTranscriptionStatus: 'SUCCESS',
      productionWrites: false,
      pageMarkers: 'exact-ordered-marker-lines-with-single-page-005-exception',
      transcriptBytesPreserved: true,
      sourceAndRunArtifactHashesVerified: true,
      knownDevelopmentStubTranscriptsRejected: true,
      overwriteRequiresReplaceFlag: true,
    },
    summary: {
      includedLetterCount: letters.length,
      includedPageCount,
      quarantinedLetterCount: quarantinedLetters.length,
      quarantinedPageCount,
      trustTiers: Object.fromEntries(
        ['modern-confirmed', 'legacy-confirmed', 'human-edited', 'ai-draft']
          .map((tier) => [
            tier,
            letters.filter(
              (letter) => letter.transcript.sourceStatus.tier === tier,
            ).length,
          ]),
      ),
    },
    letters,
  };
  if (
    snapshot.summary.includedLetterCount !== letters.length
    || snapshot.summary.includedPageCount !== includedPageCount
  ) {
    throw new Error('Final snapshot summary does not match included sources');
  }
  assertSnapshotTranscriptBytes(snapshot);
  await atomicWriteJson(args.outputPath, snapshot, args.replace);
  const outputBytes = await readFile(args.outputPath);
  const parsedOutput = JSON.parse(outputBytes.toString('utf8')) as typeof snapshot;
  assertSnapshotTranscriptBytes(parsedOutput);
  process.stdout.write(`${JSON.stringify({
    outputPath: args.outputPath,
    outputSha256: sha256(outputBytes),
    summary: snapshot.summary,
    replaced: args.replace,
  })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Transcript snapshot failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
