import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../api/client";
import EditableEntityItem from "../EditableEntityItem";

const { showToastMock } = vi.hoisted(() => ({
  showToastMock: vi.fn(),
}));

vi.mock("../../../../contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

describe("EditableEntityItem", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("opens linked entity when open button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenEntity = vi.fn();

    render(
      <EditableEntityItem
        id="lp-1"
        name="Ada Lovelace"
        role="mentioned"
        confidence={88}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onOpenEntity={onOpenEntity}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Ada Lovelace" }));
    expect(onOpenEntity).toHaveBeenCalledTimes(1);
  });

  it("saves edited name on enter", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <EditableEntityItem
        id="lp-2"
        name="Old Name"
        role="mentioned"
        confidence={75}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByText("Old Name"));
    const input = screen.getByDisplayValue("Old Name");
    await user.clear(input);
    await user.type(input, "New Name{enter}");

    expect(onSave).toHaveBeenCalledWith("New Name");
  });

  it("shows the request id when saving fails", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(
      new ApiError(500, "Entity save failed", undefined, "req-entity-save-500"),
    );

    render(
      <EditableEntityItem
        id="lp-3"
        name="Old Name"
        role="mentioned"
        confidence={75}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByText("Old Name"));
    const input = screen.getByDisplayValue("Old Name");
    await user.clear(input);
    await user.type(input, "New Name{enter}");

    expect(showToastMock).toHaveBeenCalledWith(
      "Entity save failed (Request ID: req-entity-save-500)",
      "error",
    );
    expect(screen.getByDisplayValue("Old Name")).toBeInTheDocument();
  });
});
