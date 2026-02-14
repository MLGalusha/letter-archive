import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EditableEntityItem from "../EditableEntityItem";

describe("EditableEntityItem", () => {
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
});

