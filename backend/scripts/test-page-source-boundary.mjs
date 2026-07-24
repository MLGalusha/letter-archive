import assert from 'node:assert/strict';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const ids = {
  collection: '54000000-0000-4000-8000-000000000001',
  primary: '54000000-0000-4000-8000-000000000002',
  companion: '54000000-0000-4000-8000-000000000003',
  page: '54000000-0000-4000-8000-000000000004',
  version: '54000000-0000-4000-8000-000000000005',
};
const checksumA = 'a'.repeat(64);
const checksumB = 'b'.repeat(64);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const source = postgres(databaseUrl, { max: 1 });
const contender = postgres(databaseUrl, { max: 1 });
const observer = postgres(databaseUrl, { max: 1 });

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

async function resetFixture({
  primaryRevision = 0,
  companionRevision = 0,
  profileRevision = 0,
  checksum = checksumA,
} = {}) {
  await observer.begin(async (tx) => {
    await tx`
      update collections
      set profile_revision = ${profileRevision}::integer,
          profile_status = 'VERIFIED'
      where id = ${ids.collection}
    `;
    await tx`
      update letters
      set primary_source_revision = case
            when id = ${ids.primary} then ${primaryRevision}::integer
            else ${companionRevision}::integer
          end,
          visibility = 'HIDDEN',
          transcript_status = 'VERIFIED',
          metadata_content_status = 'VERIFIED',
          transcript_published = false,
          metadata_published = false,
          reviewed_at = null,
          reviewed_by = null,
          transcription_status = 'SUCCESS',
          transcription_text = 'old transcript',
          reading_text = null
      where id in (${ids.primary}, ${ids.companion})
    `;
    await tx`
      update letter_pages
      set checksum_sha256 = ${checksum},
          line_segments = '[{"line":1,"isMapped":true}]'::jsonb,
          segment_trust_state = 'trusted'
      where id = ${ids.page}
    `;
    await tx`
      update letter_versions
      set primary_source_revision = ${primaryRevision}::integer,
          content = '{"text":"old transcript"}'::jsonb
      where id = ${ids.version}
    `;
  });
}

async function publishCorrespondence(tx, { failAfterWrites = false } = {}) {
  await tx`
    select id
    from collections
    where id = ${ids.collection}
    for update
  `;
  const group = await tx`
    select id, primary_source_revision, visibility, transcript_status,
           metadata_content_status
    from letters
    where collection_id = ${ids.collection}
      and date_raw = '19470810'
      and type_sequence = 1
    order by id
    for update
  `;
  const primary = group.find((row) => row.id === ids.primary);
  if (!primary || primary.primary_source_revision !== 0) return false;

  const visibilityChanged = group.some(
    (row) => row.visibility !== 'PUBLISHED',
  );
  if (primary.visibility !== 'PUBLISHED') {
    await tx`
      update letters
      set visibility = 'PUBLISHED',
          transcript_published = ${primary.transcript_status === 'VERIFIED'},
          metadata_published = ${primary.metadata_content_status === 'VERIFIED'},
          reviewed_by = 'native-publication-test',
          reviewed_at = now()
      where id = ${ids.primary}
    `;
  }
  await tx`
    update letters
    set visibility = 'PUBLISHED',
        reviewed_by = 'native-publication-test',
        reviewed_at = now()
    where collection_id = ${ids.collection}
      and date_raw = '19470810'
      and type_sequence = 1
      and visibility <> 'PUBLISHED'
  `;
  if (visibilityChanged) {
    await tx`
      update collections
      set profile_revision = profile_revision + 1,
          profile_status = case
            when profile_status = 'VERIFIED' then 'EDITED'::content_status
            else profile_status
          end
      where id = ${ids.collection}
    `;
  }

  if (failAfterWrites) {
    throw new Error('deliberate publication rollback');
  }
  return true;
}

async function assertPublicationState({
  visibility,
  transcriptPublished,
  metadataPublished,
  profileRevision,
  profileStatus,
}) {
  const rows = await observer`
    select id, visibility, transcript_published, metadata_published
    from letters
    where id in (${ids.primary}, ${ids.companion})
    order by id
  `;
  assert.ok(rows.every((row) => row.visibility === visibility));
  const primary = rows.find((row) => row.id === ids.primary);
  assert.equal(primary.transcript_published, transcriptPublished);
  assert.equal(primary.metadata_published, metadataPublished);

  const [collection] = await observer`
    select profile_revision, profile_status
    from collections
    where id = ${ids.collection}
  `;
  assert.equal(collection.profile_revision, profileRevision);
  assert.equal(collection.profile_status, profileStatus);
}

async function publicationTransactionBoundary() {
  await resetFixture();
  assert.equal(
    await source.begin((tx) => publishCorrespondence(tx)),
    true,
  );
  await assertPublicationState({
    visibility: 'PUBLISHED',
    transcriptPublished: true,
    metadataPublished: true,
    profileRevision: 1,
    profileStatus: 'EDITED',
  });

  await resetFixture();
  await assert.rejects(
    source.begin((tx) => publishCorrespondence(tx, {
      failAfterWrites: true,
    })),
    /deliberate publication rollback/,
  );
  await assertPublicationState({
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    profileRevision: 0,
    profileStatus: 'VERIFIED',
  });

  await resetFixture();
  await observer`
    update letters
    set visibility = case
          when id = ${ids.primary} then 'PUBLISHED'::visibility_state
          else 'HIDDEN'::visibility_state
        end,
        transcript_published = (id = ${ids.primary}),
        metadata_published = (id = ${ids.primary})
    where id in (${ids.primary}, ${ids.companion})
  `;
  assert.equal(
    await source.begin((tx) => publishCorrespondence(tx)),
    true,
  );
  await assertPublicationState({
    visibility: 'PUBLISHED',
    transcriptPublished: true,
    metadataPublished: true,
    profileRevision: 1,
    profileStatus: 'EDITED',
  });
}

async function invalidateSource(tx, options = {}) {
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
      and date_raw = '19470810'
      and type_sequence = 1
    order by id
    for update
  `;
  options.locked?.resolve();
  if (options.release) await options.release.promise;

  const nextRevision = Math.max(
    ...group.map((row) => row.primary_source_revision),
  ) + 1;
  await tx`
    update letter_pages
    set checksum_sha256 = ${checksumB},
        line_segments = null,
        segment_trust_state = 'unverified'
    where id = ${ids.page}
  `;
  await tx`
    update letters
    set primary_source_revision = ${nextRevision}::integer,
        visibility = 'HIDDEN',
        reviewed_at = null,
        reviewed_by = null
    where collection_id = ${ids.collection}
      and date_raw = '19470810'
      and type_sequence = 1
  `;
  await tx`
    update letters
    set transcription_status = 'PENDING',
        reading_text = null
    where id = ${ids.primary}
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
}

async function assertFinalInvalidated(expectedRevision) {
  const rows = await observer`
    select id, primary_source_revision, visibility, reading_text
    from letters
    where id in (${ids.primary}, ${ids.companion})
    order by id
  `;
  assert.deepEqual(
    rows.map((row) => row.primary_source_revision),
    [expectedRevision, expectedRevision],
  );
  assert.ok(rows.every((row) => row.visibility === 'HIDDEN'));
  assert.equal(rows[0].reading_text, null);

  const [page] = await observer`
    select checksum_sha256, line_segments, segment_trust_state
    from letter_pages
    where id = ${ids.page}
  `;
  assert.equal(page.checksum_sha256, checksumB);
  assert.equal(page.line_segments, null);
  assert.equal(page.segment_trust_state, 'unverified');
}

async function sourceFirstPublication() {
  await resetFixture();
  const locked = deferred();
  const release = deferred();
  const sourceWork = source.begin((tx) => invalidateSource(tx, { locked, release }));
  await locked.promise;

  const contenderPid = await backendPid(contender);
  const publication = Promise.resolve(contender`
    update letters
    set visibility = 'PUBLISHED'
    where id = ${ids.primary}
      and primary_source_revision = 0
    returning id
  `);
  await waitForBlocked(contenderPid, 'stale publication');
  release.resolve();

  const [, published] = await Promise.all([sourceWork, publication]);
  assert.equal(published.length, 0);
  await assertFinalInvalidated(1);
}

async function publicationFirstSource() {
  await resetFixture();
  const published = deferred();
  const release = deferred();
  const publication = contender.begin(async (tx) => {
    const rows = await tx`
      update letters
      set visibility = 'PUBLISHED'
      where id = ${ids.primary}
        and primary_source_revision = 0
      returning id
    `;
    assert.equal(rows.length, 1);
    published.resolve();
    await release.promise;
  });
  await published.promise;

  const sourcePid = await backendPid(source);
  const sourceWork = source.begin((tx) => invalidateSource(tx));
  await waitForBlocked(sourcePid, 'source invalidation after publication');
  release.resolve();

  await Promise.all([publication, sourceWork]);
  await assertFinalInvalidated(1);
}

async function sourceFirstAnnotation() {
  await resetFixture();
  const locked = deferred();
  const release = deferred();
  const sourceWork = source.begin((tx) => invalidateSource(tx, { locked, release }));
  await locked.promise;

  const contenderPid = await backendPid(contender);
  const annotation = contender.begin(async (tx) => {
    const [letter] = await tx`
      select primary_source_revision
      from letters
      where id = ${ids.primary}
      for update
    `;
    if (letter.primary_source_revision !== 0) return false;
    const updated = await tx`
      update letter_pages
      set line_segments = '[{"line":1,"mappedText":"stale"}]'::jsonb
      where id = ${ids.page}
        and checksum_sha256 = ${checksumA}
      returning id
    `;
    return updated.length === 1;
  });
  await waitForBlocked(contenderPid, 'stale annotation');
  release.resolve();

  const [, annotationSaved] = await Promise.all([sourceWork, annotation]);
  assert.equal(annotationSaved, false);
  await assertFinalInvalidated(1);
}

async function annotationFirstSource() {
  await resetFixture();
  const annotated = deferred();
  const release = deferred();
  const annotation = contender.begin(async (tx) => {
    await tx`
      select id
      from letters
      where id = ${ids.primary}
      for update
    `;
    await tx`
      update letter_pages
      set line_segments = '[{"line":1,"mappedText":"new"}]'::jsonb,
          segment_trust_state = 'trusted'
      where id = ${ids.page}
        and checksum_sha256 = ${checksumA}
    `;
    annotated.resolve();
    await release.promise;
  });
  await annotated.promise;

  const sourcePid = await backendPid(source);
  const sourceWork = source.begin((tx) => invalidateSource(tx));
  await waitForBlocked(sourcePid, 'source invalidation after annotation');
  release.resolve();

  await Promise.all([annotation, sourceWork]);
  await assertFinalInvalidated(1);
}

async function sourceFirstVersionRestore() {
  await resetFixture();
  const locked = deferred();
  const release = deferred();
  const sourceWork = source.begin((tx) => invalidateSource(tx, { locked, release }));
  await locked.promise;

  const contenderPid = await backendPid(contender);
  const restore = contender.begin(async (tx) => {
    const [letter] = await tx`
      select primary_source_revision
      from letters
      where id = ${ids.primary}
      for update
    `;
    const [version] = await tx`
      select primary_source_revision, content
      from letter_versions
      where id = ${ids.version}
    `;
    if (
      letter.primary_source_revision !== 0
      || version.primary_source_revision !== 0
    ) {
      return false;
    }
    const restored = await tx`
      update letters
      set transcription_text = ${version.content.text}
      where id = ${ids.primary}
        and primary_source_revision = 0
      returning id
    `;
    return restored.length === 1;
  });
  await waitForBlocked(contenderPid, 'stale version restore');
  release.resolve();

  const [, restored] = await Promise.all([sourceWork, restore]);
  assert.equal(restored, false);
  await assertFinalInvalidated(1);
}

async function versionRestoreFirstSource() {
  await resetFixture();
  const restored = deferred();
  const release = deferred();
  const restore = contender.begin(async (tx) => {
    const [letter] = await tx`
      select primary_source_revision
      from letters
      where id = ${ids.primary}
      for update
    `;
    const [version] = await tx`
      select primary_source_revision, content
      from letter_versions
      where id = ${ids.version}
    `;
    assert.equal(letter.primary_source_revision, 0);
    assert.equal(version.primary_source_revision, 0);
    await tx`
      update letters
      set transcription_text = ${version.content.text}
      where id = ${ids.primary}
        and primary_source_revision = 0
    `;
    restored.resolve();
    await release.promise;
  });
  await restored.promise;

  const sourcePid = await backendPid(source);
  const sourceWork = source.begin((tx) => invalidateSource(tx));
  await waitForBlocked(sourcePid, 'source invalidation after version restore');
  release.resolve();

  await Promise.all([restore, sourceWork]);
  await assertFinalInvalidated(1);
}

async function sourceFirstProfileSave() {
  await resetFixture();
  const locked = deferred();
  const release = deferred();
  const sourceWork = source.begin((tx) => invalidateSource(tx, { locked, release }));
  await locked.promise;

  const contenderPid = await backendPid(contender);
  const profileSave = Promise.resolve(contender`
    update collections
    set profile_status = 'VERIFIED',
        profile_revision = profile_revision + 1
    where id = ${ids.collection}
      and profile_revision = 0
    returning id
  `);
  await waitForBlocked(contenderPid, 'stale profile save');
  release.resolve();

  const [, saved] = await Promise.all([sourceWork, profileSave]);
  assert.equal(saved.length, 0);
  const [collection] = await observer`
    select profile_revision, profile_status
    from collections
    where id = ${ids.collection}
  `;
  assert.equal(collection.profile_revision, 1);
  assert.equal(collection.profile_status, 'EDITED');
}

async function profileSaveFirstSource() {
  await resetFixture();
  const saved = deferred();
  const release = deferred();
  const profileSave = contender.begin(async (tx) => {
    await tx`
      update collections
      set profile_status = 'VERIFIED',
          profile_revision = profile_revision + 1
      where id = ${ids.collection}
        and profile_revision = 0
    `;
    saved.resolve();
    await release.promise;
  });
  await saved.promise;

  const sourcePid = await backendPid(source);
  const sourceWork = source.begin((tx) => invalidateSource(tx));
  await waitForBlocked(sourcePid, 'source invalidation after profile save');
  release.resolve();

  await Promise.all([profileSave, sourceWork]);
  const [collection] = await observer`
    select profile_revision, profile_status
    from collections
    where id = ${ids.collection}
  `;
  assert.equal(collection.profile_revision, 2);
  assert.equal(collection.profile_status, 'EDITED');
}

async function run() {
  await observer.begin(async (tx) => {
    await tx`
      delete from letter_pages
      where letter_id in (${ids.primary}, ${ids.companion})
    `;
    await tx`
      delete from letter_versions
      where letter_id in (${ids.primary}, ${ids.companion})
    `;
    await tx`
      delete from letters
      where id in (${ids.primary}, ${ids.companion})
    `;
    await tx`delete from collections where id = ${ids.collection}`;
    await tx`
      insert into collections (
        id, collection_code, profile_status
      ) values (
        ${ids.collection}, 'S54', 'VERIFIED'
      )
    `;
    await tx`
      insert into letters (
        id, collection_id, date_raw, type, type_sequence
      ) values
        (${ids.primary}, ${ids.collection}, '19470810', 'L', 1),
        (${ids.companion}, ${ids.collection}, '19470810', 'C', 1)
    `;
    await tx`
      insert into letter_pages (
        id, letter_id, page_number, storage_path, original_filename,
        checksum_sha256
      ) values (
        ${ids.page}, ${ids.primary}, 1, 'objects/source-a.jpg',
        'S54-19470810-L01-01.jpg', ${checksumA}
      )
    `;
    await tx`
      insert into letter_versions (
        id, letter_id, field_type, version_number, content, source
      ) values (
        ${ids.version}, ${ids.primary}, 'transcript', 1,
        '{"text":"old transcript"}'::jsonb, 'human'
      )
    `;
    await tx`
      update collections
      set profile_source_fingerprint =
        compute_collection_profile_source_fingerprint(id)
      where id = ${ids.collection}
    `;
  });

  const [defaults] = await observer`
    select c.profile_revision,
           c.profile_source_fingerprint,
           l.primary_source_revision,
           v.primary_source_revision as version_source_revision
    from collections c
    join letters l on l.collection_id = c.id
    join letter_versions v on v.letter_id = l.id
    where c.id = ${ids.collection}
      and l.id = ${ids.primary}
  `;
  assert.equal(defaults.profile_revision, 0);
  assert.match(defaults.profile_source_fingerprint, /^[0-9a-f]{32}$/);
  assert.equal(defaults.primary_source_revision, 0);
  assert.equal(defaults.version_source_revision, 0);
  await assert.rejects(
    observer`
      update collections
      set profile_revision = -1
      where id = ${ids.collection}
    `,
    (error) => error?.code === '23514',
  );
  await assert.rejects(
    observer`
      update letters
      set primary_source_revision = -1
      where id = ${ids.primary}
    `,
    (error) => error?.code === '23514',
  );
  await assert.rejects(
    observer`
      update letter_versions
      set primary_source_revision = -1
      where id = ${ids.version}
    `,
    (error) => error?.code === '23514',
  );
  await assert.rejects(
    observer`
      update collections
      set profile_source_fingerprint = 'not-a-fingerprint'
      where id = ${ids.collection}
    `,
    (error) => error?.code === '23514',
  );

  const [emptyCorpus] = await observer`
    select compute_collection_profile_source_fingerprint(
      ${ids.collection}
    ) as fingerprint
  `;
  await observer`
    update letters
    set visibility = 'PUBLISHED',
        metadata_published = true,
        sender = 'Fingerprint sender'
    where id = ${ids.primary}
  `;
  const [publishedCorpus] = await observer`
    select compute_collection_profile_source_fingerprint(
      ${ids.collection}
    ) as fingerprint
  `;
  assert.notEqual(emptyCorpus.fingerprint, publishedCorpus.fingerprint);

  await publicationTransactionBoundary();

  await resetFixture({
    primaryRevision: 7,
    companionRevision: 2,
    profileRevision: 4,
  });
  await source.begin((tx) => invalidateSource(tx));
  await assertFinalInvalidated(8);
  const [normalizedProfile] = await observer`
    select profile_revision, profile_status
    from collections
    where id = ${ids.collection}
  `;
  assert.equal(normalizedProfile.profile_revision, 5);
  assert.equal(normalizedProfile.profile_status, 'EDITED');

  await sourceFirstPublication();
  await publicationFirstSource();
  await sourceFirstAnnotation();
  await annotationFirstSource();
  await sourceFirstVersionRestore();
  await versionRestoreFirstSource();
  await sourceFirstProfileSave();
  await profileSaveFirstSource();
}

try {
  await run();
  console.log('Page source boundary database interleavings passed.');
} finally {
  await Promise.allSettled([
    source.end({ timeout: 1 }),
    contender.end({ timeout: 1 }),
    observer.end({ timeout: 1 }),
  ]);
}
