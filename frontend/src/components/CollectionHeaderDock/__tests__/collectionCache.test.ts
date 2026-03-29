import { beforeEach, describe, expect, it, vi } from "vitest";

const listCollectionsMock = vi.fn();

vi.mock("../../../api/collections", () => ({
  listCollections: (...args: unknown[]) => listCollectionsMock(...args),
}));

// Import after mock so the module picks up the mocked listCollections
// We need to re-import on each test to reset the module-level cache
let fetchAllCollections: typeof import("../collectionCache").fetchAllCollections;
let getCachedCollections: typeof import("../collectionCache").getCachedCollections;

describe("collectionCache", () => {
  beforeEach(async () => {
    listCollectionsMock.mockReset();
    // Reset the module cache so each test starts with fresh module-level state
    vi.resetModules();
    const mod = await import("../collectionCache");
    fetchAllCollections = mod.fetchAllCollections;
    getCachedCollections = mod.getCachedCollections;
  });

  it("fetchAllCollections returns sorted collections", async () => {
    listCollectionsMock.mockResolvedValue([
      { id: "c3", collectionCode: "003", letterCount: 5 },
      { id: "c1", collectionCode: "001", letterCount: 10 },
      { id: "c2", collectionCode: "002", letterCount: 3 },
    ]);

    const result = await fetchAllCollections();

    expect(result).toHaveLength(3);
    expect(result[0].collectionCode).toBe("001");
    expect(result[1].collectionCode).toBe("002");
    expect(result[2].collectionCode).toBe("003");
  });

  it("filters out collections with 0 letters", async () => {
    listCollectionsMock.mockResolvedValue([
      { id: "c1", collectionCode: "001", letterCount: 10 },
      { id: "c2", collectionCode: "002", letterCount: 0 },
      { id: "c3", collectionCode: "003", letterCount: 7 },
    ]);

    const result = await fetchAllCollections();

    expect(result).toHaveLength(2);
    expect(result.map((c: { id: string }) => c.id)).toEqual(["c1", "c3"]);
  });

  it("filters out collections with undefined letterCount", async () => {
    listCollectionsMock.mockResolvedValue([
      { id: "c1", collectionCode: "001", letterCount: 5 },
      { id: "c2", collectionCode: "002" }, // no letterCount
    ]);

    const result = await fetchAllCollections();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("caches results after first fetch", async () => {
    listCollectionsMock.mockResolvedValue([
      { id: "c1", collectionCode: "001", letterCount: 3 },
    ]);

    const first = await fetchAllCollections();
    const second = await fetchAllCollections();

    // Same reference — served from cache
    expect(first).toBe(second);
    // listCollections should only be called once
    expect(listCollectionsMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent fetches", async () => {
    listCollectionsMock.mockResolvedValue([
      { id: "c1", collectionCode: "001", letterCount: 2 },
    ]);

    // Fire two fetches concurrently
    const [a, b] = await Promise.all([fetchAllCollections(), fetchAllCollections()]);

    expect(a).toBe(b);
    expect(listCollectionsMock).toHaveBeenCalledTimes(1);
  });

  it("clears pendingFetch on error so retries work", async () => {
    listCollectionsMock.mockRejectedValueOnce(new Error("Network error"));
    listCollectionsMock.mockResolvedValueOnce([
      { id: "c1", collectionCode: "001", letterCount: 4 },
    ]);

    // First fetch fails
    await expect(fetchAllCollections()).rejects.toThrow("Network error");

    // Second fetch should retry (not stuck on the failed pending promise)
    const result = await fetchAllCollections();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
    expect(listCollectionsMock).toHaveBeenCalledTimes(2);
  });

  it("getCachedCollections returns null before first fetch", () => {
    expect(getCachedCollections()).toBeNull();
  });

  it("getCachedCollections returns cached data after fetch", async () => {
    listCollectionsMock.mockResolvedValue([
      { id: "c1", collectionCode: "001", letterCount: 1 },
    ]);

    await fetchAllCollections();

    const cached = getCachedCollections();
    expect(cached).not.toBeNull();
    expect(cached).toHaveLength(1);
    expect(cached![0].collectionCode).toBe("001");
  });

  it("sorts non-numeric collection codes alphabetically", async () => {
    listCollectionsMock.mockResolvedValue([
      { id: "c2", collectionCode: "BBB", letterCount: 2 },
      { id: "c1", collectionCode: "AAA", letterCount: 3 },
      { id: "c3", collectionCode: "CCC", letterCount: 1 },
    ]);

    const result = await fetchAllCollections();

    expect(result[0].collectionCode).toBe("AAA");
    expect(result[1].collectionCode).toBe("BBB");
    expect(result[2].collectionCode).toBe("CCC");
  });
});
