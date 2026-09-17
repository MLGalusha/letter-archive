import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Router } from 'express';
import type { Sql } from 'postgres';
import { archiveTermRanges, archiveWordSimilarity } from '../../services/archive-search-matching.js';
import { invokeRouter } from '../../test/express-test-utils.js';

// Opt-in real SQL coverage. Owns a disposable Docker database; never connects to
// DATABASE_URL from the developer's shell or the application environment.
// ARCHIVE_SEARCH_POSTGRES_TEST=1 npm test -- archive-search.postgres.test.ts
const enabled = process.env.ARCHIVE_SEARCH_POSTGRES_TEST === '1';
const icu = process.env.ARCHIVE_SEARCH_POSTGRES_ICU === '1';
describe.skipIf(!enabled)('public archive search against PostgreSQL', () => {
  let container: string;
  let client: Sql;
  let router: Router;
  let closeDatabase: () => Promise<void>;
  const collection = '10000000-0000-0000-0000-000000000001';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=fixture', '-e', 'POSTGRES_DB=archive_fixture', ...(icu ? ['-e', 'POSTGRES_INITDB_ARGS=--locale-provider=icu --icu-locale=en --encoding=UTF8'] : []), '-p', '127.0.0.1::5432', 'postgres:16-alpine'], { encoding: 'utf8' }).trim();
    const binding = execFileSync('docker', ['port', container, '5432'], { encoding: 'utf8' }).trim();
    const url = `postgresql://postgres:fixture@${binding}/archive_fixture`;
    vi.stubEnv('DATABASE_URL', url);
    const postgres = (await import('postgres')).default;
    client = postgres(url, { max: 1 });
    for (let attempt = 0; ; attempt++) {
      try { await client`SELECT 1`; break; } catch (error) {
        if (attempt >= 30) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    await client.unsafe(`
      CREATE EXTENSION pg_trgm;
      CREATE TYPE letter_type AS ENUM ('L','C','P','E','V','A','D','N','T');
      CREATE TABLE collections (id uuid PRIMARY KEY, collection_code text, title text);
      CREATE TABLE letters (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), collection_id uuid,
        date_raw text, type_sequence int DEFAULT 1, type letter_type DEFAULT 'L',
        visibility text DEFAULT 'PUBLISHED', metadata_published boolean DEFAULT true,
        transcript_published boolean DEFAULT true, transcript_status text DEFAULT 'VERIFIED',
        extra_content_status text DEFAULT 'VERIFIED', photo_description_status text DEFAULT 'VERIFIED',
        metadata_content_status text DEFAULT 'VERIFIED',
        sender text, recipient text, location_written text, hook text, summary text,
        tags text[], primary_topics text[], emotional_tone text, sender_recipient_relationship text,
        photo_description text, extra_content_transcript text, transcription_text text,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE letter_pages (id uuid, letter_id uuid, page_number int, checksum_sha256 text);
    `);
    await client`INSERT INTO collections VALUES (${collection}, 'quartz', 'quartz')`;
    const fixtures = [
      { key: 'transcript', transcription_text: 'The quartz arrived.', sender: 'quartz quartz quartz', date_raw: '19470810' },
      { key: 'sender', sender: 'quartz', date_raw: '19470811' },
      { key: 'recipient', recipient: 'quartz', date_raw: '19470812' },
      { key: 'location', location_written: 'quartz', date_raw: '19470813' },
      { key: 'excluded', hook: 'quartz', summary: 'quartz', tags: ['quartz'], primary_topics: ['quartz'], emotional_tone: 'quartz', sender_recipient_relationship: 'quartz', photo_description: 'quartz', date_raw: '19470814' },
      { key: 'unpublished', transcription_text: 'quartz', transcript_published: false, date_raw: '19470815' },
      { key: 'hidden', transcription_text: 'quartz', visibility: 'HIDDEN', date_raw: '19470816' },
      { key: 'extra', extra_content_transcript: 'quartz', date_raw: '19470817' },
      { key: 'draftExtra', extra_content_transcript: 'quartz', extra_content_status: 'DRAFT', date_raw: '19470818' },
      { key: 'privateMetadata', sender: 'quartz', metadata_published: false, date_raw: '19470819' },
      { key: 'groupRoot', date_raw: '19470820' },
      { key: 'groupAttachment', type: 'C', transcription_text: 'quartz', date_raw: '19470820' },
      { key: 'orphanAttachment', type: 'C', transcription_text: 'quartz', date_raw: '19470821' },
      { key: 'formatOnly', type: 'E', date_raw: '19470822' },
      { key: 'formatRoot', date_raw: '19470822' },
      { key: 'percent', transcription_text: 'A 5% discount.', date_raw: '19500101' },
      { key: 'underscore', transcription_text: 'Code oak_leaf.', date_raw: '19500102' },
      { key: 'backslash', transcription_text: String.raw`Path C:\letters.`, date_raw: '19500103' },
      { key: 'apostrophe', transcription_text: "O'Neil wrote.", date_raw: '19500104' },
      { key: 'greek', transcription_text: 'ζήτα', date_raw: '19500105' },
      { key: 'phrase', transcription_text: 'red lantern', date_raw: '19500106' },
      { key: 'separated', transcription_text: 'lantern glowing red', date_raw: '19500107' },
      { key: 'crossField', transcription_text: 'red', sender: 'lantern', date_raw: '19500108' },
      { key: 'typoName', sender: 'Molly', date_raw: '19500109' },
      { key: 'typoTranscript', transcription_text: 'Molly', date_raw: '19500110' },
      { key: 'operators', transcription_text: 'fox OR goose and fox -goose', date_raw: '19500111' },
      { key: 'noOperators', transcription_text: 'fox goose', date_raw: '19500112' },
      { key: 'hyphen', sender: 'Anne-Marie', date_raw: '19500113' },
      { key: 'quote', transcription_text: 'She said "lantern".', date_raw: '19500114' },
      { key: 'spaces', transcription_text: 'blue  marble', date_raw: '19500117' },
      { key: 'turkish', transcription_text: 'İstanbul', date_raw: '19500120' },
      { key: 'foldedOffsets', transcription_text: 'İ𐐀 📨 nebula', date_raw: '19500123' },
      { key: 'sigma', transcription_text: 'ΟΣ', date_raw: '19500121' },
      { key: 'nbspMarker', transcription_text: 'amber--- Page\u00a01 ---lamp', date_raw: '19500122' },
      { key: 'accent', sender: 'Éléonore', date_raw: '19500115' },
      { key: 'pageSeparator', transcription_text: '--- Page 77 ---\nDocument', date_raw: '19500116' },
    ];
    for (const { key, ...fixture } of fixtures) {
      const rows = await client`INSERT INTO letters ${client({ collection_id: collection, ...fixture })} RETURNING id`;
      ids[key] = rows[0]!.id;
    }
    ({ default: router } = await import('../letters.js'));
    ({ closeDatabase } = await import('../../db/index.js'));
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await client?.end();
    if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' });
    vi.unstubAllEnvs();
  });

  async function search(query: Record<string, string>) {
    const response = await invokeRouter(router, { method: 'GET', url: '/letters/search', query, timeoutMs: 15_000 });
    expect(response.statusCode).toBe(200);
    return response.body as { total: number; facets: Record<string, Array<{ value: string; count: number }>> & { truncated: string[] }; letters: Array<{ id: string; searchPreview?: { matchedFieldLabel: string; matchCount: number; excerpt: string; highlightRanges: Array<{ start: number; end: number }> } }> };
  }

  it('restricts SQL eligibility to published permitted fields and grouped public roots', async () => {
    const response = await search({ search: 'quartz', limit: '100' });
    expect(response.letters.map((item) => item.id).sort()).toEqual(['transcript', 'sender', 'recipient', 'location', 'extra', 'groupRoot'].map((key) => ids[key]).sort());
    expect(response.letters.find((item) => item.id === ids.transcript)?.searchPreview).toMatchObject({ matchedFieldLabel: 'Transcript', matchCount: 1 });
    expect(response.letters.find((item) => item.id === ids.groupRoot)?.searchPreview?.matchedFieldLabel).toBe('Transcript');
    expect(response.letters.find((item) => item.id === ids.extra)?.searchPreview?.matchedFieldLabel).toBe('Transcript');
  });

  it('keeps format filters independent from typed matching and sorting', async () => {
    expect((await search({ search: 'ephemera' })).total).toBe(0);
    expect((await search({ format: 'ephemera' })).letters.map((item) => item.id)).toEqual([ids.formatRoot]);
    expect((await search({ search: 'quartz', format: 'cover' })).letters.map((item) => item.id)).toEqual([ids.groupRoot]);
    const expected = (await search({ search: 'quartz' })).letters.map((item) => item.id).sort();
    expect((await search({ search: 'quartz', sort: 'letterDate', sortOrder: 'asc' })).letters.map((item) => item.id).sort()).toEqual(expected);
  });

  it('does not explain a sender match with an unsearched formatted date', async () => {
    const [inserted] = await client`INSERT INTO letters ${client({ collection_id: collection, date_raw: '19470810', type_sequence: 2, sender: 'August' })} RETURNING id`;
    try {
      const response = await search({ search: 'August' });
      expect(response.letters.find((item) => item.id === inserted!.id)?.searchPreview)
        .toMatchObject({ matchedFieldLabel: 'Sender', excerpt: 'August', matchCount: 1 });
    } finally {
      await client`DELETE FROM letters WHERE id = ${inserted!.id}`;
    }
  });

  it('explains compact date matches using the matching date text', async () => {
    const response = await search({ search: '19470810' });
    expect(response.letters.find((item) => item.id === ids.transcript)?.searchPreview).toMatchObject({ matchedFieldLabel: 'Date', excerpt: '19470810', matchCount: 1 });
  });
  it.each([
    ['%', ['percent']], ['_', ['underscore']], [String.fromCharCode(92), ['backslash']],
    ["O'Neil", ['apostrophe']], ['ζ', ['greek']], ['ζή', ['greek']],
    ['red lantern', ['phrase', 'separated']], ['lantern red red', ['phrase', 'separated']],
    ['Mollly', ['typoName']], ['fox OR goose', ['operators']], ['fox -goose', ['operators']],
    ['Anne-Marie', ['hyphen']], ['"lantern"', ['quote']], ['ÉLÉONORE', ['accent']],
    ['İstanbul', ['turkish']], ['istanbul', icu ? [] : ['turkish']], ['οσ', icu ? [] : ['sigma']], ['ος', icu ? ['sigma'] : []], ['Page', ['nbspMarker']],
    ['77', []], ['quartz%', []], ['\"quartz\"', []],
  ] as Array<[string, string[]]>)('agrees on literal input and previews for %s', async (query, keys) => {
    const response = await search({ search: query, limit: '100' });
    expect(response.letters.map((item) => item.id).sort()).toEqual(keys.map((key) => ids[key]).sort());
    for (const item of response.letters) {
      expect(item.searchPreview?.highlightRanges.length).toBeGreaterThan(0);
      if (['%', '_', String.fromCharCode(92), "O'Neil", 'ζ', 'ζή', 'Anne-Marie', '"lantern"'].includes(query)) {
        const preview = item.searchPreview!;
        expect(preview.highlightRanges.map((range) => preview.excerpt.slice(range.start, range.end)))
          .toContain(query);
      }
      if (query === 'Mollly') expect(item.searchPreview).toMatchObject({ matchedFieldLabel: 'Sender', excerpt: 'Molly', highlightRanges: [{ start: 0, end: 5 }] });
      for (const range of item.searchPreview!.highlightRanges) {
        expect(range.end).toBeGreaterThan(range.start);
        expect(range.start).toBeGreaterThanOrEqual(0);
        expect(range.end).toBeLessThanOrEqual(item.searchPreview!.excerpt.length);
      }
    }
  });

  it('maps database lowercase expansions back to original transcript coordinates', async () => {
    const [database] = await client`SELECT lower('İ') AS folded`;
    expect(database!.folded).toBe(icu ? 'i\u0307' : 'i');
    for (const [query, highlighted] of [['İ𐐀', 'İ𐐀'], ['nebula', 'nebula']]) {
      const response = await search({ search: query! });
      const preview = response.letters.find((item) => item.id === ids.foldedOffsets)?.searchPreview;
      expect(preview?.highlightRanges.map((range) => preview.excerpt.slice(range.start, range.end))).toContain(highlighted);
    }
  });

  it('maps contextual Lithuanian and Turkish ICU folds without changing casing policy', async () => {
    const lithuanian = 'I\u0301 📨 nebula';
    const turkish = 'I\u0307 📨 nebula';
    const [folded] = await client`SELECT
      lower(${lithuanian} COLLATE "lt-x-icu") AS lithuanian,
      lower(${turkish} COLLATE "tr-x-icu") AS turkish`;
    expect(folded!.lithuanian).toBe('i\u0307\u0301 📨 nebula');
    expect(folded!.turkish).toBe('i 📨 nebula');
    for (const [original, normalized, firstTerm] of [
      [lithuanian, folded!.lithuanian, 'i\u0307'],
      [turkish, folded!.turkish, 'i'],
    ]) {
      expect(archiveTermRanges(original, firstTerm, false, normalized)
        .map((range) => original.slice(range.start, range.end))).toEqual([original.slice(0, 2)]);
      expect(archiveTermRanges(original, 'nebula', false, normalized)
        .map((range) => original.slice(range.start, range.end))).toEqual(['nebula']);
    }
  });

  it('uses the same whole-word trigram similarity as PostgreSQL', async () => {
    for (const [left, right] of [['Molly', 'Mollly'], ['word', 'words'], ['Éléonore', 'Éléonorre'], ['aaaa', 'aaaab'], ['東京大学', '東京大學']]) {
      const [row] = await client`SELECT similarity(lower(${left}), lower(${right})) AS score`;
      expect(archiveWordSimilarity(left!, right!)).toBeCloseTo(row!.score, 6);
    }
  });

  it.each([
    ['red lantern', ['phrase']], ['red  lantern', []], ['Mollly', []],
    ['blue  marble', ['spaces']], ['blue marble', []],
    ['İstanbul', ['turkish']], ['i\u0307stanbul', icu ? ['turkish'] : []],
    ['istanbul', icu ? [] : ['turkish']], ['οσ', icu ? [] : ['sigma']], ['ος', icu ? ['sigma'] : []], ['Page', ['nbspMarker']],
    ['%', ['percent']], ['ζ', ['greek']], ['quartz%', []],
  ] as Array<[string, string[]]>)('narrows exact phrase search for %s', async (query, keys) => {
    const response = await search({ search: query, exact: 'true', limit: '100' });
    expect(response.letters.map((item) => item.id).sort()).toEqual(keys.map((key) => ids[key]).sort());
    for (const item of response.letters) {
      const preview = item.searchPreview!;
      expect(preview.highlightRanges.map((range) => preview.excerpt.slice(range.start, range.end).toLowerCase()))
        .toContain(['istanbul', 'İstanbul'].includes(query) ? 'i̇stanbul' : query === 'οσ' ? 'ος' : query.toLowerCase());
    }
  });

  it('keeps exact mode through pagination/filter/sort and restores ordinary mode', async () => {
    const params = { search: 'quartz', exact: 'true', limit: '2', sort: 'letterDate', sortOrder: 'asc' };
    const first = await search({ ...params, page: '1' });
    const second = await search({ ...params, page: '2' });
    expect(first.total).toBe(6);
    expect(second.total).toBe(6);
    expect(new Set([...first.letters, ...second.letters].map((item) => item.id)).size).toBe(4);
    expect((await search({ ...params, format: 'cover' })).letters.map((item) => item.id)).toEqual([ids.groupRoot]);
    expect((await search({ search: 'red lantern', exact: 'false' })).letters).toHaveLength(2);
  });

  it('retains exact totals without exposing an empty-page placeholder', async () => {
    for (const query of ['quartz', 'qu']) {
      expect(await search({ search: query, exact: 'true', page: '99', limit: '2' }))
        .toMatchObject({ total: 6, letters: [] });
    }
    expect(await search({ search: 'unfindablezzzz', exact: 'true', page: '99' }))
      .toMatchObject({ total: 0, letters: [] });
  });

  it('preserves original-term fuzzy eligibility through database case expansion', async () => {
    const [sender] = await client`INSERT INTO letters ${client({ collection_id: collection, date_raw: '19510101', sender: 'stanbul' })} RETURNING id`;
    try {
      for (const query of ['İstanbul', 'İstanbul İstanbul', 'İstanbul İSTANBUL']) {
        const response = await search({ search: query });
        const match = response.letters.find((item) => item.id === sender!.id);
        if (icu) {
          expect(match?.searchPreview).toMatchObject({ matchedFieldLabel: 'Sender', excerpt: 'stanbul', highlightRanges: [{ start: 0, end: 7 }] });
        } else {
          expect(match).toBeUndefined();
        }
      }
      for (const query of ['i\u0307stanbul', 'İst', 'İstan-bul', 'İstanbul i\u0307stanbul']) {
        expect((await search({ search: query })).letters.some((item) => item.id === sender!.id)).toBe(false);
      }
      expect((await search({ search: 'İstanbul', exact: 'true' })).letters.some((item) => item.id === sender!.id)).toBe(false);
      if (icu) {
        await client`UPDATE letters SET recipient = 'İstanbul' WHERE id = ${sender!.id}`;
        const response = await search({ search: 'İstanbul i\u0307stanbul' });
        expect(response.letters.find((item) => item.id === sender!.id)?.searchPreview)
          .toMatchObject({ matchedFieldLabel: 'Recipient', excerpt: 'İstanbul', highlightRanges: [{ start: 0, end: 8 }] });
        const exact = await search({ search: 'İstanbul', exact: 'true' });
        expect(exact.letters.find((item) => item.id === sender!.id)?.searchPreview)
          .toMatchObject({ matchedFieldLabel: 'Recipient', excerpt: 'İstanbul', highlightRanges: [{ start: 0, end: 8 }] });
      }
      const [normalized] = await client`SELECT lower('İstanbul') AS query, similarity('stanbul', lower('İstanbul')) AS score`;
      expect(archiveWordSimilarity('stanbul', normalized!.query)).toBeCloseTo(normalized!.score, 6);
    } finally {
      await client`DELETE FROM letters WHERE id = ${sender!.id}`;
    }
  });

  it('uses PostgreSQL word boundaries for a superscript number beside a name', async () => {
    const [sender] = await client`INSERT INTO letters ${client({ collection_id: collection, date_raw: '19510102', sender: 'Molly²' })} RETURNING id`;
    try {
      const response = await search({ search: 'Mollly' });
      const match = response.letters.find((item) => item.id === sender!.id);
      expect(match).toBeDefined();
      expect(match?.searchPreview)
        .toMatchObject({ matchedFieldLabel: 'Sender', excerpt: 'Molly²', highlightRanges: [{ start: 0, end: 5 }] });
      const [comparison] = await client`SELECT similarity(lower('Molly²'), lower('Mollly')) AS score`;
      expect(archiveWordSimilarity('Molly²', 'Mollly')).toBeCloseTo(comparison!.score, 6);
    } finally {
      await client`DELETE FROM letters WHERE id = ${sender!.id}`;
    }
  });

  it('uses provider-owned words for Roman numerals and sanitized metadata', async () => {
    const [roman] = await client`INSERT INTO letters ${client({ collection_id: collection, date_raw: '19510103', sender: 'MollyⅣ', recipient: 'Mollly' })} RETURNING id`;
    const [marker] = await client`INSERT INTO letters ${client({ collection_id: collection, date_raw: '19510104', sender: 'Molly--- Page 77 ---' })} RETURNING id`;
    try {
      const response = await search({ search: 'Mollly' });
      const romanMatch = response.letters.find((item) => item.id === roman!.id);
      expect(romanMatch?.searchPreview).toMatchObject(icu
        ? { matchedFieldLabel: 'Sender', excerpt: 'MollyⅣ', highlightRanges: [{ start: 0, end: 5 }] }
        : { matchedFieldLabel: 'Recipient', excerpt: 'Mollly', highlightRanges: [{ start: 0, end: 6 }] });
      expect(romanMatch).not.toHaveProperty('searchWordMap');
      expect(response.letters.find((item) => item.id === marker!.id)?.searchPreview)
        .toMatchObject({ matchedFieldLabel: 'Sender', excerpt: 'Molly', highlightRanges: [{ start: 0, end: 5 }] });
      const words = await client`SELECT word, similarity(word, lower('Mollly')) AS score
        FROM regexp_split_to_table(lower('MollyⅣ'), '[^[:alnum:]]+') AS word`;
      for (const token of words) {
        expect(archiveWordSimilarity('unused', 'unused', { source: [token.word], term: ['mollly'] }))
          .toBeCloseTo(token.score, 6);
      }
    } finally {
      await client`DELETE FROM letters WHERE id IN (${roman!.id}, ${marker!.id})`;
    }
  });

  it('keeps totals on empty pages and gives every tied sort a stable group order', async () => {
    const tiedIds: Record<number, string> = {};
    for (const sequence of [5, 1, 7, 2, 6, 3, 4]) {
      const rows = await client`INSERT INTO letters
        (collection_id, date_raw, type_sequence, transcription_text, created_at)
        VALUES (${collection}, '19300101', ${sequence}, 'paginationneedle', '2020-01-01T00:00:00Z')
        RETURNING id`;
      tiedIds[sequence] = rows[0]!.id;
    }
    try {
      for (const sort of ['relevance', 'letterDate', 'createdAt', 'sender', 'recipient', 'collection']) {
        for (const sortOrder of ['asc', 'desc']) {
          const query = { search: 'paginationneedle', sort, sortOrder, limit: '3' };
          const seen: string[] = [];
          for (let page = 1; page <= 4; page++) {
            const result = await search({ ...query, page: String(page) });
            expect(result.total).toBe(7);
            seen.push(...result.letters.map((item) => item.id));
            if (page === 4) expect(result.letters).toEqual([]);
          }
          const sequences = [1, 2, 3, 4, 5, 6, 7];
          // Preserve chronology's existing direction for its complete group key.
          if (sort === 'letterDate' && sortOrder === 'desc') sequences.reverse();
          expect(seen, `${sort} ${sortOrder}`).toEqual(sequences.map((sequence) => tiedIds[sequence]));
          expect(new Set(seen).size).toBe(7);
        }
      }
      const literalEmptyPage = await search({ search: 'pa', year: '1930', page: '99' });
      expect(literalEmptyPage).toMatchObject({ letters: [], total: 7 });
      const empty = await search({ search: 'unfindablezzzz', page: '99' });
      expect(empty).toMatchObject({ letters: [], total: 0 });
      // Later requests see publication changes, not a cached historical total.
      // Offset pagination intentionally does not promise a cross-request snapshot.
      await client`UPDATE letters SET visibility = 'HIDDEN' WHERE id = ${tiedIds[1]!}`;
      const changed = await search({ search: 'paginationneedle', limit: '3', page: '3' });
      expect(changed).toMatchObject({ letters: [], total: 6 });
    } finally {
      await client`DELETE FROM letters WHERE transcription_text = 'paginationneedle'`;
    }
  });

  it('uses role-specific partial-name counts and independent OR facet dimensions', async () => {
    const rows = [
      { type_sequence: 1, sender: 'Ann', recipient: 'Molly', primary_topics: ['work/engineering', 'work/travel'], emotional_tone: 'hopeful', sender_recipient_relationship: 'friend' },
      { type_sequence: 2, sender: 'Anna', recipient: 'Molly', primary_topics: ['family/home'], emotional_tone: 'hopeful', sender_recipient_relationship: 'sibling' },
      { type_sequence: 3, sender: 'Chris', recipient: 'Molly', primary_topics: ['work/study'], emotional_tone: 'sad', sender_recipient_relationship: 'sibling' },
      { type_sequence: 4, sender: 'Dana', recipient: 'Other', primary_topics: ['homework/test'], emotional_tone: 'hopeful', sender_recipient_relationship: 'friend' },
    ];
    for (const row of rows) await client`INSERT INTO letters ${client({ collection_id: collection, date_raw: '19200101', transcription_text: 'facetneedle', ...row })}`;
    for (const type of ['C', 'P', 'E', 'V', 'A', 'D', 'N', 'T']) await client`INSERT INTO letters ${client({ collection_id: collection, date_raw: '19200101', type_sequence: 1, type, sender: 'Ann', primary_topics: ['work/engineering'] })}`;
    try {
      const initial = await search({ search: 'facetneedle' });
      expect(initial.facets.senders).toContainEqual({ value: 'Ann', count: 2 });
      expect(initial.facets.senders.some((facet) => facet.value === 'Molly')).toBe(false);
      expect(initial.facets.recipients).toContainEqual({ value: 'Molly', count: 3 });
      expect((await search({ search: 'facetneedle', sender: 'Ann' })).total).toBe(2);
      expect((await search({ search: 'facetneedle', recipient: 'Molly' })).total).toBe(3);
      expect(initial.facets.formats).toHaveLength(9);
      expect(initial.facets.formats.find((facet) => facet.value === 'cover')?.count).toBe(1);
      expect(initial.facets.topics).toContainEqual({ value: 'work', count: 2 });
      expect((await search({ search: 'facetneedle', topic: 'work' })).total).toBe(2);
      expect((await search({ search: 'facetneedle', topic: 'work,family' })).total).toBe(3);
      const selected = await search({ search: 'facetneedle', topic: 'work', tone: 'hopeful' });
      expect(selected.total).toBe(1);
      expect(selected.facets.topics).toContainEqual({ value: 'family', count: 1 });
      expect(selected.facets.tones).toContainEqual({ value: 'sad', count: 1 });
      const relationship = await search({ search: 'facetneedle', topic: 'work', relationship: 'friend' });
      expect(relationship.facets.relationships).toContainEqual({ value: 'sibling', count: 1 });
      const format = await search({ search: 'facetneedle', format: 'cover' });
      expect(format.total).toBe(1);
      expect(format.facets.formats.find((facet) => facet.value === 'letter')?.count).toBe(4);
    } finally {
      await client`DELETE FROM letters WHERE date_raw = '19200101'`;
    }
  });

  it('keeps literal partial-place counts and unique collection suggestions honest', async () => {
    const other = '10000000-0000-0000-0000-000000000002';
    await client`INSERT INTO collections VALUES (${other}, 'quartz-other', 'quartz')`;
    for (const [index, place] of ['Paris', 'Paris, France', '100% Town', '100X Town'].entries()) {
      await client`INSERT INTO letters ${client({ collection_id: index === 1 ? other : collection, date_raw: '19050101', type_sequence: index + 1, location_written: place, transcription_text: 'placefacetneedle' })}`;
    }
    try {
      const initial = await search({ search: 'placefacetneedle' });
      expect(initial.facets.places).toContainEqual({ value: 'Paris', count: 2 });
      expect((await search({ search: 'placefacetneedle', place: 'Paris' })).total).toBe(2);
      expect(initial.facets.places).toContainEqual({ value: '100% Town', count: 1 });
      expect((await search({ search: 'placefacetneedle', place: '100% Town' })).total).toBe(1);
      expect(initial.facets.collections).toContainEqual({ value: 'quartz', label: 'quartz', count: 3 });
      expect((await search({ search: 'placefacetneedle', collection: 'quartz' })).total).toBe(3);
      expect((await search({ search: 'placefacetneedle', collection: 'quartz-other' })).total).toBe(1);
      // Unknown complete codes remain free text, including shared title/code fragments.
      expect((await search({ search: 'placefacetneedle', collection: 'quar' })).total).toBe(4);
    } finally {
      await client`DELETE FROM letters WHERE date_raw = '19050101'`;
      await client`DELETE FROM collections WHERE id = ${other}`;
    }
  });

  it('reports truncated suggestions while omitted literal categories remain filterable', async () => {
    const topics = [...Array.from({ length: 53 }, (_, index) => `category${String(index).padStart(2, '0')}/detail`), 'literal%/detail'];
    await client`INSERT INTO letters ${client({ collection_id: collection, date_raw: '19100101', transcription_text: 'boundedneedle', primary_topics: topics })}`;
    try {
      const result = await search({ search: 'boundedneedle' });
      expect(result.facets.topics).toHaveLength(50);
      expect(result.facets.truncated).toContain('topics');
      expect((await search({ search: 'boundedneedle', topic: 'category52' })).total).toBe(1);
      expect((await search({ search: 'boundedneedle', topic: 'category5' })).total).toBe(0);
      expect((await search({ search: 'boundedneedle', topic: 'literal%' })).total).toBe(1);
      expect((await search({ search: 'boundedneedle', topic: 'literal_' })).total).toBe(0);
    } finally {
      await client`DELETE FROM letters WHERE date_raw = '19100101'`;
    }
  });

});
