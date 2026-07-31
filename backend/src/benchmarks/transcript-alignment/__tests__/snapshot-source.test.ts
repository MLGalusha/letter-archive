import { describe, expect, it } from 'vitest';
import {
  assertBenchmarkTranscriptPageEligible,
  assertLocalDatabaseUrl,
  assertPathInside,
} from '../snapshot-source.js';
import {
  parseTranscriptPages,
  sha256,
} from '../../../services/transcript-alignment/transcript-pages.js';
import {
  DEVELOPMENT_STUB_TRANSCRIPTION_SHA256,
  DEVELOPMENT_STUB_TRANSCRIPTION_TEXT,
} from '../../../ai/openai/transcription-stub.js';

describe('parseTranscriptPages', () => {
  it('rejects the known development stub even with page-boundary newlines', () => {
    expect(sha256(DEVELOPMENT_STUB_TRANSCRIPTION_TEXT)).toBe(
      DEVELOPMENT_STUB_TRANSCRIPTION_SHA256,
    );
    expect(() => assertBenchmarkTranscriptPageEligible({
      letterKey: '008-18850922-L01',
      pageNumber: 1,
      text: `\n${DEVELOPMENT_STUB_TRANSCRIPTION_TEXT}\n\n`,
    })).toThrow(
      '008-18850922-L01 Page 1 contains the known development stub transcription',
    );
    expect(() => assertBenchmarkTranscriptPageEligible({
      letterKey: '008-18850922-L01',
      pageNumber: 1,
      text: `${DEVELOPMENT_STUB_TRANSCRIPTION_TEXT}\nHuman correction`,
    })).not.toThrow();
  });

  it('parses exact ordered markers and stores UTF-8 byte ranges', () => {
    const transcript = '--- Page 1 ---\n\nCafé\n\n--- Page 2 ---\nSecond';
    const pages = parseTranscriptPages({
      letterKey: '003-18880810-L01',
      transcript,
      expectedPageNumbers: [1, 2],
      allowUnmarkedSinglePage: false,
    });

    expect(pages).toHaveLength(2);
    expect(pages[0].marker?.text).toBe('--- Page 1 ---');
    expect(pages[0].content.text).toBe('\nCafé\n\n');
    expect(pages[0].content.byteLength).toBe(Buffer.byteLength('\nCafé\n\n'));
    expect(pages[0].content.sha256).toBe(
      sha256(Buffer.from('\nCafé\n\n', 'utf8')),
    );
    expect(pages[1].content.text).toBe('Second');
    expect(pages[1].lines.map((line) => line.text)).toEqual(['Second']);
    expect(pages.flatMap((page) => page.lines).map(
      (line) => line.sourceLineNumber,
    )).toEqual([2, 3, 4, 6]);
    expect(pages.flatMap((page) => page.lines).some(
      (line) => line.text.startsWith('--- Page'),
    )).toBe(false);
  });

  it('accepts only the explicit unmarked single-page shape', () => {
    const pages = parseTranscriptPages({
      letterKey: '005-19150813-L01',
      transcript: 'Café\n',
      expectedPageNumbers: [1],
      allowUnmarkedSinglePage: true,
    });
    expect(pages[0].marker).toBeNull();
    expect(pages[0].content.text).toBe('Café\n');
    expect(pages[0].lines.map((line) => line.text)).toEqual(['Café']);
  });

  it('does not align standalone decorative page numbers', () => {
    const transcript = [
      '--- Page 1 ---',
      '     5',
      'Body text',
      '- 3 -',
      'More body text',
      '— 4 —',
      '\t6',
    ].join('\n');
    const [page] = parseTranscriptPages({
      letterKey: '009-19470830-L01',
      transcript,
      expectedPageNumbers: [1],
      allowUnmarkedSinglePage: false,
    });

    expect(page.lines.map(({ text, alignable }) => ({
      text,
      alignable,
    }))).toEqual([
      { text: '     5', alignable: false },
      { text: 'Body text', alignable: true },
      { text: '- 3 -', alignable: false },
      { text: 'More body text', alignable: true },
      { text: '— 4 —', alignable: false },
      { text: '\t6', alignable: false },
    ]);
  });

  it('keeps an indented bare number inside body text alignable', () => {
    const [page] = parseTranscriptPages({
      letterKey: '009-19470830-L01',
      transcript: [
        '--- Page 1 ---',
        'Body before',
        '   24',
        'Body after',
      ].join('\n'),
      expectedPageNumbers: [1],
      allowUnmarkedSinglePage: false,
    });

    expect(page.lines.map(({ text, alignable }) => ({
      text,
      alignable,
    }))).toEqual([
      { text: 'Body before', alignable: true },
      { text: '   24', alignable: true },
      { text: 'Body after', alignable: true },
    ]);
  });

  it('keeps dates, addresses, and numbered body text alignable', () => {
    const transcript = [
      '--- Page 1 ---',
      'August 30, 1947',
      'APO 752,',
      '123 Main Street',
      'I sent 3 letters.',
      '1947',
      '3',
    ].join('\n');
    const [page] = parseTranscriptPages({
      letterKey: '009-19470830-L01',
      transcript,
      expectedPageNumbers: [1],
      allowUnmarkedSinglePage: false,
    });

    expect(page.lines).toHaveLength(6);
    expect(page.lines.every(({ alignable }) => alignable)).toBe(true);
  });

  it('fails closed on missing, malformed, duplicate, or reordered markers', () => {
    const base = {
      letterKey: '003-18880810-L01',
      expectedPageNumbers: [1, 2],
      allowUnmarkedSinglePage: false,
    };
    expect(() => parseTranscriptPages({
      ...base,
      transcript: '--- Page 1 ---\nOnly one',
    })).toThrow('expected 2 exact page markers');
    expect(() => parseTranscriptPages({
      ...base,
      transcript: '--- Page 1 --- \nFirst\n--- Page 2 ---\nSecond',
    })).toThrow('Malformed page marker');
    expect(() => parseTranscriptPages({
      ...base,
      transcript: '--- Page 1 ---\nFirst\n--- Page 1 ---\nAgain',
    })).toThrow('expected Page 2');
    expect(() => parseTranscriptPages({
      ...base,
      transcript: 'prefix\n--- Page 1 ---\nFirst\n--- Page 2 ---\nSecond',
    })).toThrow('must begin');
  });
});

describe('snapshot safety guards', () => {
  it('allows local TCP PostgreSQL and rejects remote or socket targets', () => {
    expect(assertLocalDatabaseUrl(
      'postgresql://app:app@localhost:5432/app',
    ).hostname).toBe('localhost');
    expect(assertLocalDatabaseUrl(
      'postgres://app:app@127.0.0.1:5432/app',
    ).hostname).toBe('127.0.0.1');
    expect(() => assertLocalDatabaseUrl(
      'postgresql://app:app@example.com:5432/app',
    )).toThrow('local TCP');
    expect(() => assertLocalDatabaseUrl(
      'postgresql://app:app@localhost/app?host=/cloudsql/project',
    )).toThrow('local TCP');
  });

  it('allows files below the result root and rejects escape/root targets', () => {
    expect(assertPathInside('/tmp/results', '/tmp/results/cohort.json'))
      .toBe('/tmp/results/cohort.json');
    expect(() => assertPathInside('/tmp/results', '/tmp/elsewhere.json'))
      .toThrow('must be a file below');
    expect(() => assertPathInside('/tmp/results', '/tmp/results'))
      .toThrow('must be a file below');
  });
});
