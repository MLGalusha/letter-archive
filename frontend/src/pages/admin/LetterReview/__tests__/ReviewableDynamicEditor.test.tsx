import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewableDynamicEditor } from "../ReviewableDynamicEditor";

const buildProps = () => ({
  value: "Envelope note",
  verified: false,
  onChange: vi.fn(),
  onRequestEdit: vi.fn(),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReviewableDynamicEditor", () => {
  it("keeps verified content locked until its owner returns an editable status", () => {
    const props = buildProps();
    const { container, rerender } = render(
      <ReviewableDynamicEditor {...props} verified />,
    );
    const editor = container.querySelector(".dynamic-editor");

    expect(editor).toHaveAttribute("contenteditable", "false");

    fireEvent.click(editor!, { clientX: 100, clientY: 120 });
    expect(
      screen.getByText("Verified. Double-click to edit and unverify."),
    ).toBeInTheDocument();

    fireEvent.doubleClick(editor!, { clientX: 100, clientY: 120 });
    expect(props.onRequestEdit).toHaveBeenCalledTimes(1);
    expect(editor).toHaveAttribute("contenteditable", "false");

    rerender(<ReviewableDynamicEditor {...props} verified={false} />);
    expect(editor).toHaveAttribute("contenteditable", "true");
  });

  it("does not request edit or show a tooltip for editable content", () => {
    const props = buildProps();
    const { container } = render(<ReviewableDynamicEditor {...props} />);
    const editor = container.querySelector(".dynamic-editor");

    fireEvent.click(editor!, { clientX: 100, clientY: 120 });
    fireEvent.doubleClick(editor!, { clientX: 100, clientY: 120 });

    expect(props.onRequestEdit).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Verified. Double-click to edit and unverify."),
    ).not.toBeInTheDocument();
  });

  it("locks edits and verification removal while a transition owns the workspace", () => {
    const props = buildProps();
    const { container, rerender } = render(
      <ReviewableDynamicEditor {...props} disabled />,
    );
    const editor = container.querySelector(".dynamic-editor");

    expect(editor).toHaveAttribute("contenteditable", "false");
    fireEvent.keyDown(editor!, { key: "Tab" });
    expect(props.onChange).not.toHaveBeenCalled();

    rerender(<ReviewableDynamicEditor {...props} verified disabled />);
    fireEvent.click(editor!, { clientX: 100, clientY: 120 });
    fireEvent.doubleClick(editor!, { clientX: 100, clientY: 120 });

    expect(props.onRequestEdit).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Verified. Double-click to edit and unverify."),
    ).not.toBeInTheDocument();
  });

  it("keeps Tab indentation inside the editor and reports the resulting text", () => {
    const props = buildProps();
    const execCommand = vi.fn(
      (_command: string, _showUi: boolean, value: string) => {
        const editor = document.activeElement as HTMLDivElement;
        editor.innerText = `${editor.innerText}${value}`;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
    );
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    const { container } = render(<ReviewableDynamicEditor {...props} />);
    const editor = container.querySelector<HTMLDivElement>(".dynamic-editor")!;
    editor.focus();

    expect(fireEvent.keyDown(editor, { key: "Tab" })).toBe(false);
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "    ");
    expect(props.onChange).toHaveBeenCalledWith("Envelope note    ");
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });
});
