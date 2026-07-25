import assert from 'node:assert/strict';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const ids = {
  collection: '54400000-0000-4000-8000-000000000001',
  primary: '54400000-0000-4000-8000-000000000002',
  companion: '54400000-0000-4000-8000-000000000003',
  primaryPage: '54400000-0000-4000-8000-000000000004',
  companionPage1: '54400000-0000-4000-8000-000000000005',
  companionPage2: '54400000-0000-4000-8000-000000000006',
};
const observedRevision = 7;
const checksumA = 'a'.repeat(64);
const checksumB = 'b'.repeat(64);
const checksumC = 'c'.repeat(64);

const source = postgres(databaseUrl, { max: 1 });
const contender = postgres(databaseUrl, { max: 1 });
const observer = postgres(databaseUrl, { max: 1 });

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForTransactionSignal(signal, work, label) {
  let timeout;
  const result = await Promise.race([
    signal.promise.then(() => ({ kind: 'signaled' })),
    work.then(
      () => ({ kind: 'completed' }),
      (error) => ({ kind: 'failed', error }),
    ),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ kind: 'timed_out' }), 3_000);
    }),
  ]);
  clearTimeout(timeout);

  if (result.kind === 'failed') throw result.error;
  if (result.kind === 'completed') {
    throw new Error(`${label} completed before emitting its database signal`);
  }
  if (result.kind === 'timed_out') {
    throw new Error(`${label} did not emit its database signal within 3000ms`);
  }
}

async function backendPid(sql) {
  const [row] = await sql`select pg_backend_pid()::int as pid`;
  return row.pid;
}

async function waitForBlocked(pid, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await observer`
      select wait_event_type
      from pg_stat_activity
      where pid = ${pid}
    `;
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${label} never blocked on the expected database lock`);
}

async function cleanup(sql = observer) {
  await sql`
    delete from letters
    where collection_id = ${ids.collection}
  `;
  await sql`delete from collections where id = ${ids.collection}`;
}

async function reset({ includeCompanion = false } = {}) {
  await observer.begin(async (tx) => {
    await cleanup(tx);
    await tx`
      insert into collections (
        id, collection_code, profile_revision, profile_status
      ) values (
        ${ids.collection}, 'S44', 0, 'VERIFIED'
      )
    `;
    await tx`
      insert into letters (
        id, collection_id, date_raw, type, type_sequence,
        primary_source_revision, visibility,
        transcript_published, metadata_published
      ) values (
        ${ids.primary}, ${ids.collection}, '19470811', 'L', 1,
        ${observedRevision}, 'PUBLISHED', true, true
      )
    `;
    await tx`
      insert into letter_pages (
        id, letter_id, page_number, storage_path, original_filename,
        checksum_sha256
      ) values (
        ${ids.primaryPage}, ${ids.primary}, 1, 'objects/atomic-primary.jpg',
        'S44-19470811-L01-01.jpg', ${checksumA}
      )
    `;
    if (includeCompanion) {
      await tx`
        insert into letters (
          id, collection_id, date_raw, type, type_sequence,
          primary_source_revision, visibility
        ) values (
          ${ids.companion}, ${ids.collection}, '19470811', 'C', 1,
          ${observedRevision}, 'PUBLISHED'
        )
      `;
    }
  });
}

async function commitCompanionPage(tx, {
  ownerObservation,
  pageId = ids.companionPage1,
  pageNumber = 1,
  storagePath = 'objects/atomic-companion-1.jpg',
  originalFilename = 'S44-19470811-C01-01.jpg',
  checksum = checksumB,
  failAfterPageWrites = false,
  written,
  release,
}) {
  const collections = await tx`
    select id
    from collections
    where id = ${ids.collection}
    for update
  `;
  if (collections.length === 0) return { kind: 'missing_collection' };

  const group = await tx`
    select id, type, primary_source_revision
    from letters
    where collection_id = ${ids.collection}
      and date_raw = '19470811'
      and type_sequence = 1
    order by id
    for update
  `;
  const currentOwner = group.find((row) => row.type === 'C');
  if (
    ownerObservation.kind === 'present'
    && currentOwner?.id !== ownerObservation.letterId
  ) {
    return { kind: 'source_changed' };
  }

  const currentRevision = Math.max(
    0,
    ...group.map((row) => row.primary_source_revision),
  );
  const nextRevision = currentRevision + 1;
  let ownerId = currentOwner?.id;
  if (!ownerId) {
    const [created] = await tx`
      insert into letters (
        id, collection_id, date_raw, type, type_sequence,
        primary_source_revision
      ) values (
        ${ids.companion}, ${ids.collection}, '19470811', 'C', 1,
        ${currentRevision}
      )
      returning id
    `;
    ownerId = created.id;
  }

  const [existingPage] = await tx`
    select id
    from letter_pages
    where letter_id = ${ownerId}
      and page_number = ${pageNumber}
  `;
  if (existingPage) {
    return {
      kind: 'unchanged',
      ownerId,
      pageId: existingPage.id,
      primarySourceRevision: currentRevision,
    };
  }

  await tx`
    insert into letter_pages (
      id, letter_id, page_number, storage_path, original_filename,
      checksum_sha256
    ) values (
      ${pageId}, ${ownerId}, ${pageNumber}, ${storagePath},
      ${originalFilename}, ${checksum}
    )
  `;
  if (failAfterPageWrites) {
    throw new Error('deliberate atomic member/page rollback');
  }

  await tx`
    update letters
    set primary_source_revision = ${nextRevision},
        visibility = 'HIDDEN',
        transcript_published = false,
        metadata_published = false,
        reviewed_at = null,
        reviewed_by = null
    where collection_id = ${ids.collection}
      and date_raw = '19470811'
      and type_sequence = 1
  `;
  await tx`
    update collections
    set profile_revision = profile_revision + 1,
        profile_status = case
          when profile_status = 'VERIFIED' then 'EDITED'::content_status
          else profile_status
        end
    where id = ${ids.collection}
  `;

  written?.resolve();
  if (release) await release.promise;
  return {
    kind: 'committed',
    ownerId,
    pageId,
    primarySourceRevision: nextRevision,
  };
}

async function deleteGroup(tx, {
  targetId,
  expectedRevision,
  deleted,
  release,
}) {
  await tx`
    select id
    from collections
    where id = ${ids.collection}
    for update
  `;
  const group = await tx`
    select id, primary_source_revision
    from letters
    where collection_id = ${ids.collection}
      and date_raw = '19470811'
      and type_sequence = 1
    order by id
    for update
  `;
  if (
    !group.some((row) => row.id === targetId)
    || group.some((row) => row.primary_source_revision !== expectedRevision)
  ) {
    return { kind: 'source_changed' };
  }

  const removed = await tx`
    delete from letters
    where id = any(${group.map((row) => row.id)}::uuid[])
    returning id
  `;
  assert.equal(removed.length, group.length);
  deleted?.resolve();
  if (release) await release.promise;
  return { kind: 'deleted', deletedCount: removed.length };
}

async function snapshot() {
  const letters = await observer`
    select id, primary_source_revision
    from letters
    where collection_id = ${ids.collection}
    order by id
  `;
  const pages = await observer`
    select id
    from letter_pages
    where letter_id = any(${letters.map((letter) => letter.id)}::uuid[])
    order by id
  `;
  const [collection] = await observer`
    select profile_revision
    from collections
    where id = ${ids.collection}
  `;
  return { letters, pages, profileRevision: collection.profile_revision };
}

function assertSnapshot(
  state,
  { letterIds, revisions, pageIds, profileRevision },
) {
  assert.deepEqual(state.letters.map((row) => row.id), [...letterIds].sort());
  assert.deepEqual(
    state.letters.map((row) => row.primary_source_revision),
    revisions,
  );
  assert.deepEqual(state.pages.map((row) => row.id), [...pageIds].sort());
  assert.equal(state.profileRevision, profileRevision);
}

// 1. A new member, first page, and N+1 invalidation become visible together.
async function memberAndFirstPageCommitTogether() {
  await reset();
  const written = deferred();
  const release = deferred();
  const upload = source.begin((tx) => commitCompanionPage(tx, {
    ownerObservation: { kind: 'absent' },
    written,
    release,
  }));
  await waitForTransactionSignal(written, upload, 'atomic member/page upload');
  try {
    assertSnapshot(await snapshot(), {
      letterIds: [ids.primary],
      revisions: [observedRevision],
      pageIds: [ids.primaryPage],
      profileRevision: 0,
    });
  } finally {
    release.resolve();
  }

  assert.deepEqual(await upload, {
    kind: 'committed',
    ownerId: ids.companion,
    pageId: ids.companionPage1,
    primarySourceRevision: observedRevision + 1,
  });
  assertSnapshot(await snapshot(), {
    letterIds: [ids.primary, ids.companion],
    revisions: [observedRevision + 1, observedRevision + 1],
    pageIds: [ids.primaryPage, ids.companionPage1],
    profileRevision: 1,
  });
}

// 2. Failure after both inserts rolls the member and page back together.
async function memberAndFirstPageRollbackTogether() {
  await reset();
  await assert.rejects(
    source.begin((tx) => commitCompanionPage(tx, {
      ownerObservation: { kind: 'absent' },
      failAfterPageWrites: true,
    })),
    /deliberate atomic member\/page rollback/,
  );
  assertSnapshot(await snapshot(), {
    letterIds: [ids.primary],
    revisions: [observedRevision],
    pageIds: [ids.primaryPage],
    profileRevision: 0,
  });
}

// 3a. Concurrent first uploads for the same page keep the winner unchanged.
async function concurrentSamePageKeepsWinner() {
  await reset();
  const written = deferred();
  const release = deferred();
  const firstUpload = source.begin((tx) => commitCompanionPage(tx, {
    ownerObservation: { kind: 'absent' },
    written,
    release,
  }));
  await waitForTransactionSignal(
    written,
    firstUpload,
    'same-page first upload',
  );

  const contenderPid = await backendPid(contender);
  const secondUpload = contender.begin((tx) => commitCompanionPage(tx, {
    ownerObservation: { kind: 'absent' },
    pageId: ids.companionPage2,
    storagePath: 'objects/losing-same-page-upload.jpg',
  }));
  try {
    await waitForBlocked(contenderPid, 'same-page second upload');
  } finally {
    release.resolve();
  }

  const [firstResult, secondResult] = await Promise.all([
    firstUpload,
    secondUpload,
  ]);
  assert.deepEqual(firstResult, {
    kind: 'committed',
    ownerId: ids.companion,
    pageId: ids.companionPage1,
    primarySourceRevision: observedRevision + 1,
  });
  assert.deepEqual(secondResult, {
    kind: 'unchanged',
    ownerId: ids.companion,
    pageId: ids.companionPage1,
    primarySourceRevision: observedRevision + 1,
  });
  assertSnapshot(await snapshot(), {
    letterIds: [ids.primary, ids.companion],
    revisions: [observedRevision + 1, observedRevision + 1],
    pageIds: [ids.primaryPage, ids.companionPage1],
    profileRevision: 1,
  });
}

// 3b. Concurrent first uploads for different pages reuse one member and reach N+2.
async function concurrentDifferentPagesAdvanceTwice() {
  await reset();
  const written = deferred();
  const release = deferred();
  const firstUpload = source.begin((tx) => commitCompanionPage(tx, {
    ownerObservation: { kind: 'absent' },
    written,
    release,
  }));
  await waitForTransactionSignal(
    written,
    firstUpload,
    'different-page first upload',
  );

  const contenderPid = await backendPid(contender);
  const secondUpload = contender.begin((tx) => commitCompanionPage(tx, {
    ownerObservation: { kind: 'absent' },
    pageId: ids.companionPage2,
    pageNumber: 2,
    storagePath: 'objects/atomic-companion-2.jpg',
    originalFilename: 'S44-19470811-C01-02.jpg',
    checksum: checksumC,
  }));
  try {
    await waitForBlocked(contenderPid, 'different-page second upload');
  } finally {
    release.resolve();
  }

  const [firstResult, secondResult] = await Promise.all([
    firstUpload,
    secondUpload,
  ]);
  assert.deepEqual(firstResult, {
    kind: 'committed',
    ownerId: ids.companion,
    pageId: ids.companionPage1,
    primarySourceRevision: observedRevision + 1,
  });
  assert.deepEqual(secondResult, {
    kind: 'committed',
    ownerId: ids.companion,
    pageId: ids.companionPage2,
    primarySourceRevision: observedRevision + 2,
  });
  assertSnapshot(await snapshot(), {
    letterIds: [ids.primary, ids.companion],
    revisions: [observedRevision + 2, observedRevision + 2],
    pageIds: [
      ids.primaryPage,
      ids.companionPage1,
      ids.companionPage2,
    ],
    profileRevision: 2,
  });
}

// 4. Upload linearizes first; a deletion from revision N blocks then rejects.
async function uploadFirstRejectsStaleDeletion() {
  await reset();
  const written = deferred();
  const release = deferred();
  const upload = source.begin((tx) => commitCompanionPage(tx, {
    ownerObservation: { kind: 'absent' },
    written,
    release,
  }));
  await waitForTransactionSignal(written, upload, 'upload-first transaction');

  const contenderPid = await backendPid(contender);
  const deletion = contender.begin((tx) => deleteGroup(tx, {
    targetId: ids.primary,
    expectedRevision: observedRevision,
  }));
  try {
    await waitForBlocked(contenderPid, 'stale deletion after member upload');
  } finally {
    release.resolve();
  }

  const [uploadResult, deletionResult] = await Promise.all([upload, deletion]);
  assert.equal(uploadResult.kind, 'committed');
  assert.deepEqual(deletionResult, { kind: 'source_changed' });
  assertSnapshot(await snapshot(), {
    letterIds: [ids.primary, ids.companion],
    revisions: [observedRevision + 1, observedRevision + 1],
    pageIds: [ids.primaryPage, ids.companionPage1],
    profileRevision: 1,
  });
}

async function holdDeletion(targetId) {
  const deleted = deferred();
  const release = deferred();
  const work = source.begin((tx) => deleteGroup(tx, {
    targetId,
    expectedRevision: observedRevision,
    deleted,
    release,
  }));
  await waitForTransactionSignal(deleted, work, 'correspondence deletion');
  return { work, release };
}

// 5a. Deletion linearizes first; a stale exact-owner upload cannot recreate it.
async function deletionFirstRejectsPresentOwnerUpload() {
  await reset({ includeCompanion: true });
  const [observedOwner] = await observer`
    select id
    from letters
    where collection_id = ${ids.collection}
      and date_raw = '19470811'
      and type = 'C'
      and type_sequence = 1
  `;
  assert.equal(observedOwner.id, ids.companion);

  const deletion = await holdDeletion(ids.companion);
  const contenderPid = await backendPid(contender);
  const upload = contender.begin((tx) => commitCompanionPage(tx, {
    ownerObservation: { kind: 'present', letterId: observedOwner.id },
  }));
  try {
    await waitForBlocked(contenderPid, 'present-owner upload after deletion');
  } finally {
    deletion.release.resolve();
  }

  assert.deepEqual(await deletion.work, { kind: 'deleted', deletedCount: 2 });
  assert.deepEqual(await upload, { kind: 'source_changed' });
  assertSnapshot(await snapshot(), {
    letterIds: [],
    revisions: [],
    pageIds: [],
    profileRevision: 0,
  });
}

// 5b. Deletion linearizes first; an absent-owner upload is a new revision-1 unit.
async function deletionFirstAllowsAbsentOwnerUpload() {
  await reset();
  const deletion = await holdDeletion(ids.primary);
  const contenderPid = await backendPid(contender);
  const upload = contender.begin((tx) => commitCompanionPage(tx, {
    ownerObservation: { kind: 'absent' },
  }));
  try {
    await waitForBlocked(contenderPid, 'absent-owner upload after deletion');
  } finally {
    deletion.release.resolve();
  }

  assert.deepEqual(await deletion.work, { kind: 'deleted', deletedCount: 1 });
  assert.deepEqual(await upload, {
    kind: 'committed',
    ownerId: ids.companion,
    pageId: ids.companionPage1,
    primarySourceRevision: 1,
  });
  assertSnapshot(await snapshot(), {
    letterIds: [ids.companion],
    revisions: [1],
    pageIds: [ids.companionPage1],
    profileRevision: 1,
  });
}

try {
  await memberAndFirstPageCommitTogether();
  await memberAndFirstPageRollbackTogether();
  await concurrentSamePageKeepsWinner();
  await concurrentDifferentPagesAdvanceTwice();
  await uploadFirstRejectsStaleDeletion();
  await deletionFirstRejectsPresentOwnerUpload();
  await deletionFirstAllowsAbsentOwnerUpload();
  console.log('Correspondence membership database interleavings passed.');
} finally {
  await cleanup().catch(() => {});
  await Promise.allSettled([
    source.end({ timeout: 1 }),
    contender.end({ timeout: 1 }),
    observer.end({ timeout: 1 }),
  ]);
}
