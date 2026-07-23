import { beforeEach, describe, expect, it, vi } from "vitest";

const listCollectionsMock = vi.fn();

vi.mock("../../../api/collections", () => ({
  listCollections: (...args: unknown[]) => listCollectionsMock(...args),
}));

import { listNavigableCollections } from "../collectionNavigation";

describe("collection navigation list", () => {
  beforeEach(() => {
    listCollectionsMock.mockReset();
  });

  it("returns sorted collections", async () => {
    listCollectionsMock.mockResolvedValue([
      { id: "c3", collectionCode: "003", letterCount: 5 },
      { id: "c1", collectionCode: "001", letterCount: 10 },
      { id: "c2", collectionCode: "002", letterCount: 3 },
    ]);

    const result = await listNavigableCollections();

    expect(result.map((collection) => collection.collectionCode)).toEqual([
      "001",
      "002",
      "003",
    ]);
  });

  it("filters collections without published letters", async () => {
    listCollectionsMock.mockResolvedValue([
      { id: "c1", collectionCode: "001", letterCount: 10 },
      { id: "c2", collectionCode: "002", letterCount: 0 },
      { id: "c3", collectionCode: "003" },
    ]);

    const result = await listNavigableCollections();

    expect(result.map((collection) => collection.id)).toEqual(["c1"]);
  });

  it("fetches a fresh list so revoked collections are not retained", async () => {
    listCollectionsMock
      .mockResolvedValueOnce([
        { id: "c1", collectionCode: "001", letterCount: 3 },
        { id: "c2", collectionCode: "002", letterCount: 2 },
      ])
      .mockResolvedValueOnce([
        { id: "c1", collectionCode: "001", letterCount: 3 },
      ]);

    const first = await listNavigableCollections();
    const second = await listNavigableCollections();

    expect(first.map((collection) => collection.id)).toEqual(["c1", "c2"]);
    expect(second.map((collection) => collection.id)).toEqual(["c1"]);
    expect(listCollectionsMock).toHaveBeenCalledTimes(2);
  });

  it("propagates request failures and retries on the next call", async () => {
    listCollectionsMock.mockRejectedValueOnce(new Error("Network error"));
    listCollectionsMock.mockResolvedValueOnce([
      { id: "c1", collectionCode: "001", letterCount: 4 },
    ]);

    await expect(listNavigableCollections()).rejects.toThrow("Network error");
    await expect(listNavigableCollections()).resolves.toHaveLength(1);
    expect(listCollectionsMock).toHaveBeenCalledTimes(2);
  });

  it("sorts non-numeric collection codes alphabetically", async () => {
    listCollectionsMock.mockResolvedValue([
      { id: "c2", collectionCode: "BBB", letterCount: 2 },
      { id: "c1", collectionCode: "AAA", letterCount: 3 },
      { id: "c3", collectionCode: "CCC", letterCount: 1 },
    ]);

    const result = await listNavigableCollections();

    expect(result.map((collection) => collection.collectionCode)).toEqual([
      "AAA",
      "BBB",
      "CCC",
    ]);
  });
});
