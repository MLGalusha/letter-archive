import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Router } from 'express';
import type { Sql } from 'postgres';
import { invokeRouter } from '../../test/express-test-utils.js';

// Opt-in real SQL coverage. Owns a disposable Docker database; never connects to
// DATABASE_URL from the developer's shell or the application environment.
// ARCHIVE_SEARCH_POSTGRES_TEST=1 npm test -- archive-search.postgres.test.ts
const enabled = process.env.ARCHIVE_SEARCH_POSTGRES_TEST === '1';
describe.skipIf(!enabled)('public archive search against PostgreSQL', () => {
  let container: string;
  let client: Sql;
  let router: Router;
  let closeDatabase: () => Promise<void>;
  const collection = '10000000-0000-0000-0000-000000000001';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=fixture', '-e', 'POSTGRES_DB=archive_fixture', '-p', '127.0.0.1::5432', 'postgres:16-alpine'], { encoding: 'utf8' }).trim();
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
    return response.body as { total: number; letters: Array<{ id: string; searchPreview?: { matchedFieldLabel: string; matchCount: number; excerpt: string } }> };
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

  it('explains compact date matches using the matching date text', async () => {
    const response = await search({ search: '19470810' });
    expect(response.letters.find((item) => item.id === ids.transcript)?.searchPreview).toMatchObject({ matchedFieldLabel: 'Date', excerpt: '19470810', matchCount: 1 });
  });
});
