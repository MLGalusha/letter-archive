import { createHash } from 'node:crypto';

export type TranscriptSourceLine = {
  alignable: boolean;
  byteEndExclusive: number;
  byteStart: number;
  id: string;
  sha256: string;
  sourceLineNumber: number;
  text: string;
};

export type TranscriptPageSlice = {
  content: {
    byteEndExclusive: number;
    byteLength: number;
    byteStart: number;
    characterCount: number;
    sha256: string;
    text: string;
  };
  lines: TranscriptSourceLine[];
  marker: {
    byteEndExclusive: number;
    byteStart: number;
    text: string;
  } | null;
  pageNumber: number;
  section: {
    byteEndExclusive: number;
    byteLength: number;
    byteStart: number;
    sha256: string;
  };
};

type Marker = {
  codeUnitEndExclusive: number;
  codeUnitStart: number;
  pageNumber: number;
  text: string;
};

const EXACT_PAGE_MARKER = /^--- Page ([1-9]\d*) ---$/;
const PAGE_MARKER_PREFIX = /^--- Page\b/;
const DECORATED_PAGE_NUMBER =
  /^[\t ]*\p{Pd}[\t ]*[1-9]\d{0,2}[\t ]*\p{Pd}[\t ]*$/u;
const CENTERED_BARE_PAGE_NUMBER = /^(?: {3,}|\t+)[1-9]\d{0,2}[\t ]*$/u;

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function byteOffset(text: string, codeUnitOffset: number): number {
  return Buffer.byteLength(text.slice(0, codeUnitOffset), 'utf8');
}

function physicalLineNumberAt(text: string, codeUnitOffset: number): number {
  let lineNumber = 1;
  for (let index = 0; index < codeUnitOffset; index += 1) {
    if (text.charCodeAt(index) === 10) lineNumber += 1;
  }
  return lineNumber;
}

function isDecorativePageNumber(
  text: string,
  isPageEdge: boolean,
): boolean {
  return (
    DECORATED_PAGE_NUMBER.test(text)
    || (isPageEdge && CENTERED_BARE_PAGE_NUMBER.test(text))
  );
}

function isAlignableSourceLine(
  text: string,
  isPageEdge: boolean,
): boolean {
  return text.trim().length > 0
    && !isDecorativePageNumber(text, isPageEdge);
}

function buildLines(
  letterKey: string,
  transcript: string,
  contentStart: number,
  contentEnd: number,
): TranscriptSourceLine[] {
  const lines: TranscriptSourceLine[] = [];
  let codeUnitStart = contentStart;
  let sourceLineNumber = physicalLineNumberAt(transcript, contentStart);

  while (codeUnitStart < contentEnd) {
    const nextNewline = transcript.indexOf('\n', codeUnitStart);
    const codeUnitEnd = nextNewline === -1 || nextNewline >= contentEnd
      ? contentEnd
      : nextNewline;
    const text = transcript.slice(codeUnitStart, codeUnitEnd);
    const byteStart = byteOffset(transcript, codeUnitStart);
    const byteEndExclusive = byteOffset(transcript, codeUnitEnd);
    lines.push({
      id: `${letterKey}-transcript-line-${String(sourceLineNumber).padStart(4, '0')}`,
      sourceLineNumber,
      text,
      alignable: text.trim().length > 0,
      byteStart,
      byteEndExclusive,
      sha256: sha256(Buffer.from(text, 'utf8')),
    });
    if (codeUnitEnd === contentEnd) break;
    codeUnitStart = codeUnitEnd + 1;
    sourceLineNumber += 1;
  }
  const nonblankIndexes = lines.flatMap(({ text }, index) => (
    text.trim().length > 0 ? [index] : []
  ));
  const firstNonblankIndex = nonblankIndexes[0] ?? -1;
  const lastNonblankIndex = nonblankIndexes.at(-1) ?? -1;
  return lines.map((line, index) => ({
    ...line,
    alignable: isAlignableSourceLine(
      line.text,
      index === firstNonblankIndex || index === lastNonblankIndex,
    ),
  }));
}

function scanMarkers(transcript: string): Marker[] {
  const markers: Marker[] = [];
  let lineStart = 0;
  let physicalLineNumber = 1;
  while (lineStart <= transcript.length) {
    const newline = transcript.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? transcript.length : newline;
    const line = transcript.slice(lineStart, lineEnd);
    const exact = EXACT_PAGE_MARKER.exec(line);
    if (exact) {
      markers.push({
        codeUnitStart: lineStart,
        codeUnitEndExclusive: lineEnd,
        pageNumber: Number.parseInt(exact[1], 10),
        text: line,
      });
    } else if (PAGE_MARKER_PREFIX.test(line)) {
      throw new Error(
        `Malformed page marker at physical line ${physicalLineNumber}`,
      );
    }
    if (newline === -1) break;
    lineStart = newline + 1;
    physicalLineNumber += 1;
  }
  return markers;
}

/**
 * Splits an immutable transcript into exact UTF-8 byte ranges. Page markers
 * are provenance delimiters, not transcript content, and therefore never
 * become alignable lines.
 */
export function parseTranscriptPages(input: {
  allowUnmarkedSinglePage: boolean;
  expectedPageNumbers: number[];
  letterKey: string;
  transcript: string;
}): TranscriptPageSlice[] {
  const {
    allowUnmarkedSinglePage,
    expectedPageNumbers,
    letterKey,
    transcript,
  } = input;
  if (expectedPageNumbers.length === 0) {
    throw new Error(`${letterKey} has no expected pages`);
  }
  const markers = scanMarkers(transcript);
  if (allowUnmarkedSinglePage) {
    if (expectedPageNumbers.length !== 1 || expectedPageNumbers[0] !== 1) {
      throw new Error(
        `${letterKey} may only use the single-page exception for Page 1`,
      );
    }
    if (markers.length !== 0) {
      throw new Error(
        `${letterKey} single-page exception unexpectedly contains a page marker`,
      );
    }
    const bytes = Buffer.from(transcript, 'utf8');
    return [{
      pageNumber: 1,
      marker: null,
      section: {
        byteStart: 0,
        byteEndExclusive: bytes.length,
        byteLength: bytes.length,
        sha256: sha256(bytes),
      },
      content: {
        text: transcript,
        byteStart: 0,
        byteEndExclusive: bytes.length,
        byteLength: bytes.length,
        characterCount: transcript.length,
        sha256: sha256(bytes),
      },
      lines: buildLines(letterKey, transcript, 0, transcript.length),
    }];
  }

  if (markers.length !== expectedPageNumbers.length) {
    throw new Error(
      `${letterKey} expected ${expectedPageNumbers.length} exact page markers, found ${markers.length}`,
    );
  }
  if (markers[0]?.codeUnitStart !== 0) {
    throw new Error(`${letterKey} must begin with the exact Page 1 marker`);
  }
  markers.forEach((marker, index) => {
    if (marker.pageNumber !== expectedPageNumbers[index]) {
      throw new Error(
        `${letterKey} page marker ${index + 1} is Page ${marker.pageNumber}, expected Page ${expectedPageNumbers[index]}`,
      );
    }
    if (transcript.charCodeAt(marker.codeUnitEndExclusive) !== 10) {
      throw new Error(
        `${letterKey} Page ${marker.pageNumber} marker must end with LF`,
      );
    }
  });

  return markers.map((marker, index) => {
    const sectionStart = marker.codeUnitStart;
    const sectionEnd = markers[index + 1]?.codeUnitStart ?? transcript.length;
    const contentStart = marker.codeUnitEndExclusive + 1;
    const contentEnd = sectionEnd;
    const sectionBytes = Buffer.from(
      transcript.slice(sectionStart, sectionEnd),
      'utf8',
    );
    const contentText = transcript.slice(contentStart, contentEnd);
    const contentBytes = Buffer.from(contentText, 'utf8');
    const markerByteStart = byteOffset(transcript, marker.codeUnitStart);
    const markerByteEnd = byteOffset(transcript, marker.codeUnitEndExclusive);
    const sectionByteStart = markerByteStart;
    const sectionByteEnd = byteOffset(transcript, sectionEnd);
    const contentByteStart = byteOffset(transcript, contentStart);
    const contentByteEnd = byteOffset(transcript, contentEnd);
    return {
      pageNumber: marker.pageNumber,
      marker: {
        text: marker.text,
        byteStart: markerByteStart,
        byteEndExclusive: markerByteEnd,
      },
      section: {
        byteStart: sectionByteStart,
        byteEndExclusive: sectionByteEnd,
        byteLength: sectionBytes.length,
        sha256: sha256(sectionBytes),
      },
      content: {
        text: contentText,
        byteStart: contentByteStart,
        byteEndExclusive: contentByteEnd,
        byteLength: contentBytes.length,
        characterCount: contentText.length,
        sha256: sha256(contentBytes),
      },
      lines: buildLines(letterKey, transcript, contentStart, contentEnd),
    };
  });
}
