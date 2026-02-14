import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AddEntityModal from "../AddEntityModal";

describe("AddEntityModal", () => {
  it("does not render when closed", () => {
    render(
      <AddEntityModal
        type="person"
        isOpen={false}
        isAdding={false}
        onClose={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByText("Add Linked Person")).not.toBeInTheDocument();
  });

  it("submits entered name with default role", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(undefined);

    render(
      <AddEntityModal
        type="person"
        isOpen
        isAdding={false}
        onClose={vi.fn()}
        onAdd={onAdd}
      />,
    );

    await user.type(screen.getByLabelText("Name"), "Jane Doe");
    await user.click(screen.getByRole("button", { name: "Add Person" }));

    expect(onAdd).toHaveBeenCalledWith("Jane Doe", "mentioned");
  });

  it("allows changing place role before submit", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(undefined);

    render(
      <AddEntityModal
        type="place"
        isOpen
        isAdding={false}
        onClose={vi.fn()}
        onAdd={onAdd}
      />,
    );

    await user.type(screen.getByLabelText("Name"), "Manchester");
    await user.selectOptions(screen.getByLabelText("Role"), "destination");
    await user.click(screen.getByRole("button", { name: "Add Place" }));

    expect(onAdd).toHaveBeenCalledWith("Manchester", "destination");
  });
});
