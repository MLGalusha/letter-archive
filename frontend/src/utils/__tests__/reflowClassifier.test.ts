import { describe, it, expect } from "vitest";
import { classifyTranscriptLines, FORCE_CONTINUATION, type ClassifiedLine } from "../reflowClassifier";

function classify(text: string) {
  return classifyTranscriptLines(text).map((c) => c.classification);
}

function groups(text: string) {
  return classifyTranscriptLines(text).map((c) => c.groupIndex);
}

describe("classifyTranscriptLines", () => {
  it("classifies blank lines", () => {
    expect(classify("hello\n\nworld")).toEqual([
      "section-start",
      "blank",
      "section-start",
    ]);
  });

  it("classifies positioned text (3+ leading spaces)", () => {
    expect(classify("   Sept 23rd\nhello")).toEqual([
      "positioned",
      "section-start",
    ]);
  });

  it("classifies single-space marker as section-start", () => {
    expect(classify(" Dear Sadie:\nsome text")).toEqual([
      "section-start",
      "section-start",
    ]);
  });

  it("detects continuation via margin threshold for normal letters", () => {
    // Lines > 30 chars → margin threshold triggers continuation
    const long = "I wanted to write to you today because something remarkable happened";
    const next = "at the office yesterday and I was thrilled";
    const text = `${long}\n${next}`;
    const result = classify(text);
    expect(result).toEqual(["section-start", "continuation"]);
  });

  it("groups continuations with their parent", () => {
    const long = "I wanted to write to you today because something remarkable happened";
    const next = "at the office yesterday and I was thrilled";
    const text = `${long}\n${next}`;
    const g = groups(text);
    expect(g[0]).toBe(g[1]);
  });

  it("detects lowercase continuation for narrow-margin (short-line) text", () => {
    // All lines short → isNarrowMargin = true
    const text = "We\nhave had so much\ngoing on since";
    const result = classify(text);
    expect(result).toEqual(["section-start", "continuation", "continuation"]);
  });

  it("does not join after terminal punctuation in narrow-margin text", () => {
    const text = "and visit me.\nI am going to";
    const result = classify(text);
    // "and visit me." ends with period → next line is section-start
    expect(result[1]).toBe("section-start");
  });

  it("does not join uppercase-starting lines in narrow-margin text", () => {
    const text = "My dear Sadie:\nWe have been well";
    const result = classify(text);
    // "We" starts uppercase → not a lowercase continuation
    expect(result[1]).toBe("section-start");
  });

  it("handles single-space markers preventing continuation", () => {
    // With explicit markers: " We" has 1 space → section-start
    const text = " We\nhave had so much\ngoing on";
    const result = classify(text);
    expect(result).toEqual(["section-start", "continuation", "continuation"]);
  });

  it("assigns different group indices to separate sections", () => {
    const text = " Dear Mom,\n\n We\nhave had so much\ngoing on";
    const g = groups(text);
    // " Dear Mom," = group 0
    // blank = group 1
    // " We" = group 2
    // "have had so much" = group 2 (continuation)
    // "going on" = group 2 (continuation)
    expect(g[0]).not.toBe(g[2]);
    expect(g[2]).toBe(g[3]);
    expect(g[3]).toBe(g[4]);
  });

  it("handles empty text", () => {
    expect(classifyTranscriptLines("")).toEqual([
      { index: 0, classification: "blank", groupIndex: 0 },
    ]);
  });

  it("handles normal letter with mixed content", () => {
    const text = [
      "                         Auburn, Aug. 5, 1888.",
      "",
      "My dear Sadie:—",
      "",
      "I wanted to write to you today because something remarkable happened at the",
      "office yesterday. The new project that we have been working on for months has",
      "finally been approved.",
      "",
      "                                          Your friend,",
      "                                          James",
    ].join("\n");

    const result = classify(text);
    expect(result).toEqual([
      "positioned",    // right-aligned date
      "blank",
      "section-start", // greeting
      "blank",
      "section-start", // first body line
      "continuation",  // margin break
      "continuation",  // margin break
      "blank",
      "positioned",    // closing
      "positioned",    // signature
    ]);
  });

  it("force-continuation marker (U+200B) overrides heuristic to combine", () => {
    // Without marker, "Dear Mom:" would be section-start (starts uppercase, colon)
    const text = `Hello world.\n${FORCE_CONTINUATION}Dear Mom:`;
    const result = classify(text);
    expect(result).toEqual(["section-start", "continuation"]);
  });

  it("force-continuation marker on first line falls back to section-start", () => {
    const text = `${FORCE_CONTINUATION}Hello`;
    const result = classify(text);
    expect(result).toEqual(["section-start"]);
  });

  it("force-continuation marker after blank falls back to section-start", () => {
    const text = `Hello\n\n${FORCE_CONTINUATION}world`;
    const result = classify(text);
    expect(result).toEqual(["section-start", "blank", "section-start"]);
  });

  it("force-continuation marker joins into same group as previous", () => {
    const text = `Hello world\n${FORCE_CONTINUATION}continuation here`;
    const g = groups(text);
    expect(g[0]).toBe(g[1]);
  });

  it("handles mixed: some lines with markers, some without (backward compat)", () => {
    // " We" has marker, continuations don't
    const text = " We\nhave had so much\ngoing on since school\nclosed that my\nmother thought I";
    const result = classify(text);
    expect(result[0]).toBe("section-start");
    // All subsequent lines are continuations (narrow margin, lowercase start)
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBe("continuation");
    }
  });
});
