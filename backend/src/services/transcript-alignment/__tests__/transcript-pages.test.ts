import { describe, expect, it } from 'vitest';
import {
  parseTranscriptPages,
  sha256,
} from '../transcript-pages.js';

describe('production transcript page parsing', () => {
  it('preserves exact UTF-8 content identity and stable physical line IDs', () => {
    const transcript = '--- Page 1 ---\n\nCafé\n\n--- Page 2 ---\nSecond';
    const pages = parseTranscriptPages({
      letterKey: '003-18880810-L01',
      transcript,
      expectedPageNumbers: [1, 2],
      allowUnmarkedSinglePage: false,
    });

    expect(pages[0].content).toMatchObject({
      text: '\nCafé\n\n',
      byteLength: Buffer.byteLength('\nCafé\n\n'),
      sha256: sha256(Buffer.from('\nCafé\n\n', 'utf8')),
    });
    expect(pages.flatMap(({ lines }) => lines).map(({ id }) => id)).toEqual([
      '003-18880810-L01-transcript-line-0002',
      '003-18880810-L01-transcript-line-0003',
      '003-18880810-L01-transcript-line-0004',
      '003-18880810-L01-transcript-line-0006',
    ]);
  });

  it('keeps decorative page numbers out of alignment without hiding body numbers', () => {
    const [page] = parseTranscriptPages({
      letterKey: '009-19470830-L01',
      transcript: [
        '--- Page 1 ---',
        '     5',
        'Body before',
        '   24',
        'Body after',
        '— 4 —',
      ].join('\n'),
      expectedPageNumbers: [1],
      allowUnmarkedSinglePage: false,
    });

    expect(page.lines.map(({ text, alignable }) => ({
      text,
      alignable,
    }))).toEqual([
      { text: '     5', alignable: false },
      { text: 'Body before', alignable: true },
      { text: '   24', alignable: true },
      { text: 'Body after', alignable: true },
      { text: '— 4 —', alignable: false },
    ]);
  });

  it('fails closed on malformed or incomplete page delimiters', () => {
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
  });
});
