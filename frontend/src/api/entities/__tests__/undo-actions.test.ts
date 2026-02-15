import { describe, expect, it, vi, beforeEach } from "vitest";

const { apiGetMock, apiPostMock, apiPutMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  apiPutMock: vi.fn(),
}));

vi.mock("../../client", () => ({
  apiGet: apiGetMock,
  apiPost: apiPostMock,
  apiPut: apiPutMock,
}));

import {
  getPersonSameNameCandidates,
  mergePersons,
  undoPersonAction,
  updatePerson,
} from "../persons";
import {
  getPlaceSameNameCandidates,
  mergePlaces,
  undoPlaceAction,
  updatePlace,
} from "../places";
import { backfillAdminRelationshipsFromLetters } from "../relationships";

describe("entity undo API actions", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    apiPutMock.mockReset();
  });

  it("calls person rename endpoint and exposes undoActionId", async () => {
    apiPutMock.mockResolvedValue({
      person: { id: "p1", canonicalName: "Jane Doe" },
      undoActionId: "undo-1",
    });

    const response = await updatePerson("p1", { canonicalName: "Jane Doe" });

    expect(apiPutMock).toHaveBeenCalledWith("/admin/entities/persons/p1", {
      canonicalName: "Jane Doe",
    });
    expect(response.undoActionId).toBe("undo-1");
  });

  it("calls person merge and undo endpoints", async () => {
    apiPostMock
      .mockResolvedValueOnce({ message: "ok", undoActionId: "undo-merge-1" })
      .mockResolvedValueOnce({ message: "undone" });

    const mergeResponse = await mergePersons("keep", "merge");
    await undoPersonAction("undo-merge-1", "merge");

    expect(apiPostMock).toHaveBeenNthCalledWith(1, "/admin/entities/persons/merge", {
      keepId: "keep",
      mergeId: "merge",
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/admin/entities/persons/actions/undo-merge-1/undo",
      { actionType: "merge" },
    );
    expect(mergeResponse.undoActionId).toBe("undo-merge-1");
  });

  it("calls place rename/merge undo endpoints", async () => {
    apiPutMock.mockResolvedValue({
      place: { id: "pl1", canonicalName: "London" },
      undoActionId: "undo-place-rename",
    });
    apiPostMock
      .mockResolvedValueOnce({ message: "ok", undoActionId: "undo-place-merge" })
      .mockResolvedValueOnce({ message: "undone" });

    const renameResponse = await updatePlace("pl1", { canonicalName: "London" });
    const mergeResponse = await mergePlaces("keep-place", "merge-place");
    await undoPlaceAction("undo-place-merge", "merge");

    expect(apiPutMock).toHaveBeenCalledWith("/admin/entities/places/pl1", {
      canonicalName: "London",
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(1, "/admin/entities/places/merge", {
      keepId: "keep-place",
      mergeId: "merge-place",
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/admin/entities/places/actions/undo-place-merge/undo",
      { actionType: "merge" },
    );
    expect(renameResponse.undoActionId).toBe("undo-place-rename");
    expect(mergeResponse.undoActionId).toBe("undo-place-merge");
  });

  it("calls same-name candidate endpoints for person and place", async () => {
    apiGetMock
      .mockResolvedValueOnce({ candidates: [] })
      .mockResolvedValueOnce({ candidates: [] });

    await getPersonSameNameCandidates("person-1");
    await getPlaceSameNameCandidates("place-1");

    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      "/admin/entities/persons/person-1/same-name-candidates",
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/admin/entities/places/place-1/same-name-candidates",
    );
  });

  it("calls relationship metadata backfill endpoint", async () => {
    apiPostMock.mockResolvedValue({
      scannedLetters: 12,
      created: 3,
      updated: 2,
      skipped: 7,
    });

    const response = await backfillAdminRelationshipsFromLetters();

    expect(apiPostMock).toHaveBeenCalledWith("/admin/relationships/backfill-from-letters");
    expect(response).toEqual({
      scannedLetters: 12,
      created: 3,
      updated: 2,
      skipped: 7,
    });
  });
});
