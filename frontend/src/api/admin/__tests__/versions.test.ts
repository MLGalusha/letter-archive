import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVersion,
  type MetadataVersionSnapshot,
} from "../versions";

const fetchMock = vi.fn();
let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
  consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  consoleDebugSpy.mockRestore();
  consoleInfoSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

function successfulVersionResponse() {
  return new Response(JSON.stringify({
    versionNumber: 4,
    createdAt: "2026-07-24T12:00:00.000Z",
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("admin versions api", () => {
  it("posts the exact discriminated transcript-version request", async () => {
    fetchMock.mockResolvedValueOnce(successfulVersionResponse());

    await createVersion("letter-1", {
      primarySourceRevision: 7,
      fieldType: "transcript",
      content: "Committed transcript",
      source: "human",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3002/admin/letters/letter-1/versions",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          primarySourceRevision: 7,
          fieldType: "transcript",
          content: "Committed transcript",
          source: "human",
        }),
      }),
    );
  });

  it("posts every metadata key and preserves explicit nulls", async () => {
    fetchMock.mockResolvedValueOnce(successfulVersionResponse());
    const content: MetadataVersionSnapshot = {
      sender: "Ada",
      recipient: null,
      extractedDate: "1944-06-06",
      locationWritten: null,
      hook: "A short hook",
      summary: null,
      emotionalTone: "hopeful",
      senderRecipientRelationship: null,
      primaryTopics: ["war/military"],
    };

    await createVersion("letter-1", {
      primarySourceRevision: 7,
      fieldType: "metadata",
      content,
      source: "human",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3002/admin/letters/letter-1/versions",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          primarySourceRevision: 7,
          fieldType: "metadata",
          content: {
            sender: "Ada",
            recipient: null,
            extractedDate: "1944-06-06",
            locationWritten: null,
            hook: "A short hook",
            summary: null,
            emotionalTone: "hopeful",
            senderRecipientRelationship: null,
            primaryTopics: ["war/military"],
          },
          source: "human",
        }),
      }),
    );
  });

  it("represents legacy persisted values without widening the writable form contract", async () => {
    fetchMock.mockResolvedValueOnce(successfulVersionResponse());
    const content: MetadataVersionSnapshot = {
      sender: "Ada",
      recipient: "Charles",
      extractedDate: null,
      locationWritten: "",
      hook: "",
      summary: "",
      emotionalTone: "desperate",
      senderRecipientRelationship: "parent",
      primaryTopics: [],
    };

    await createVersion("letter-1", {
      primarySourceRevision: 7,
      fieldType: "metadata",
      content,
      source: "human",
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      content: {
        emotionalTone: "desperate",
        senderRecipientRelationship: "parent",
      },
    });
  });
});
