import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TranscriptionSection from "../TranscriptionSection";

const buildProps = (overrides: Partial<ComponentProps<typeof TranscriptionSection>> = {}) => ({
  letter: {
    transcriptStatus: "EMPTY",
    transcript: { fullText: "" },
  },
  transcriptText: overrides?.letter?.transcript?.fullText ?? "",
  letterTranscribeState: "idle" as const,
  letterTranscribeMessage: null,
  isTranscriptEditing: false,
  transcriptFontSize: "1rem",
  showEditTooltip: false,
  tooltipPosition: { x: 100, y: 100 },
  editTooltipRef: createRef<HTMLDivElement>(),
  saving: false,
  editorRef: createRef<HTMLDivElement>(),
  onTranscribeLetter: vi.fn(),
  onVerifyTranscript: vi.fn(),
  onTranscriptClick: vi.fn(),
  onTranscriptDoubleClick: vi.fn(),
  onTranscriptInput: vi.fn(),
  readingViewOpen: false,
  onReadingViewOpenChange: vi.fn(),
  readerText: "",
  onGenerateReadingView: vi.fn(),
  readingViewGenerating: false,
  ...overrides,
});

describe("TranscriptionSection", () => {
  afterEach(() => {
    document.body.style.overflow = "";
    window.getSelection()?.removeAllRanges();
  });

  it("shows transcribe and verify actions while unverified", () => {
    render(<TranscriptionSection {...buildProps()} />);

    expect(screen.getByRole("button", { name: "Transcribe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument();
  });

  it("shows verified info and read-only editor when verified", () => {
    render(
      <TranscriptionSection
        {...buildProps({
          letter: {
            transcriptStatus: "VERIFIED",
            transcriptVerifiedAt: "2024-01-01T00:00:00.000Z",
            transcript: { fullText: "verified text" },
          },
        })}
      />,
    );

    expect(screen.getByText(/Verified on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Transcribe" })).not.toBeInTheDocument();
    const editor = document.querySelector(".transcript-editor");
    expect(editor).toHaveAttribute("contenteditable", "false");
  });

  it("calls handlers for editor interaction and transcription", () => {
    const props = buildProps();
    const { container } = render(<TranscriptionSection {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    const editorContainer = container.querySelector(".editor-container");
    expect(editorContainer).toBeInTheDocument();
    fireEvent.click(editorContainer!);
    fireEvent.doubleClick(editorContainer!);

    const editor = container.querySelector(".transcript-editor") as HTMLDivElement;
    editor.innerText = "updated transcript";
    fireEvent.input(editor);

    expect(props.onTranscribeLetter).toHaveBeenCalledTimes(1);
    expect(props.onVerifyTranscript).toHaveBeenCalledTimes(1);
    expect(props.onTranscriptClick).toHaveBeenCalledTimes(1);
    expect(props.onTranscriptDoubleClick).toHaveBeenCalledTimes(1);
    expect(props.onTranscriptInput).toHaveBeenCalledWith("updated transcript");
  });

  it("projects markers and clears stale DOM when authoritative text becomes empty", () => {
    const props = buildProps({
      transcriptText: "Dear [unclear: Molly]\n--- Page 2 ---\nGoodbye",
    });
    const { container, rerender } = render(
      <TranscriptionSection {...props} />,
    );
    const editor = container.querySelector(
      ".transcript-editor",
    ) as HTMLDivElement;

    const marker = editor.querySelector(
      ".transcript-marker.transcript-marker--unclear",
    );
    expect(marker).toHaveTextContent("[unclear: Molly]");
    expect(marker).toHaveAttribute(
      "title",
      "Unclear — best guess shown",
    );
    const separator = editor.querySelector(".page-sep");
    expect(separator).toHaveAttribute("contenteditable", "false");
    expect(separator).toHaveAttribute("data-page", "2");

    rerender(
      <TranscriptionSection
        {...props}
        transcriptText=""
      />,
    );

    expect(editor.innerHTML).toBe("");
  });

  it("owns Tab insertion inside the transcript editor", () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(
      document,
      "execCommand",
    );
    const execCommand = vi.fn();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    try {
      const { container } = render(
        <TranscriptionSection {...buildProps()} />,
      );
      const editor = container.querySelector(
        ".transcript-editor",
      ) as HTMLDivElement;
      expect(fireEvent.keyDown(editor, { key: "Tab" })).toBe(false);
      expect(execCommand).toHaveBeenCalledWith(
        "insertText",
        false,
        "    ",
      );
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(
          document,
          "execCommand",
          originalExecCommand,
        );
      } else {
        Reflect.deleteProperty(document, "execCommand");
      }
    }
  });

  it.each([
    {
      key: "Backspace",
      focus: (separator: Element) => separator.nextSibling,
      offset: () => 0,
    },
    {
      key: "Delete",
      focus: (separator: Element) => separator.previousSibling,
      offset: (node: Node) => node.textContent?.length ?? 0,
    },
  ])("protects a page separator from $key", ({
    key,
    focus,
    offset,
  }) => {
    const { container } = render(
      <TranscriptionSection
        {...buildProps({
          transcriptText: "Before\n--- Page 2 ---\nAfter",
        })}
      />,
    );
    const editor = container.querySelector(
      ".transcript-editor",
    ) as HTMLDivElement;
    const separator = editor.querySelector(".page-sep")!;
    const focusNode = focus(separator)!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(focusNode, offset(focusNode));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(fireEvent.keyDown(editor, { key })).toBe(false);

    range.setStart(focusNode, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(fireEvent.keyDown(editor, { key })).toBe(true);
  });

  it("renders Reading View from its controlled owner", () => {
    const onReadingViewOpenChange = vi.fn();
    const props = buildProps({
      letter: {
        transcriptStatus: "EMPTY",
        transcript: { fullText: "Dear Molly,\n\nWe made it home." },
      },
      onReadingViewOpenChange,
      readerText: "Dear Molly,\n\nWe made it home.",
    });

    const { rerender } = render(<TranscriptionSection {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Reading view" }));
    expect(onReadingViewOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog", { name: "Reading view" })).not.toBeInTheDocument();

    rerender(
      <TranscriptionSection
        {...props}
        readingViewOpen
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Reading view" });
    expect(dialog).toBeInTheDocument();
    expect(dialog.querySelector(".reading-view-text")).toHaveTextContent("Dear Molly,");
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <TranscriptionSection
        {...props}
        readingViewOpen
        readingViewGenerating
      />,
    );
    expect(
      screen.getByRole("button", { name: "Generating..." }),
    ).toBeDisabled();

    rerender(<TranscriptionSection {...props} readingViewOpen />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onReadingViewOpenChange).toHaveBeenLastCalledWith(false);
    rerender(
      <TranscriptionSection
        {...props}
        readingViewOpen={false}
      />,
    );
    expect(screen.queryByRole("dialog", { name: "Reading view" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("routes Escape and backdrop close through the owner and restores body overflow", () => {
    document.body.style.overflow = "scroll";
    const onReadingViewOpenChange = vi.fn();
    const props = buildProps({
      letter: {
        transcriptStatus: "EMPTY",
        transcript: { fullText: "Dear Molly" },
      },
      readingViewOpen: true,
      onReadingViewOpenChange,
      readerText: "Dear Molly",
    });
    const { rerender, unmount } = render(
      <TranscriptionSection {...props} />,
    );

    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onReadingViewOpenChange).toHaveBeenLastCalledWith(false);
    rerender(
      <TranscriptionSection {...props} readingViewOpen={false} />,
    );
    expect(document.body.style.overflow).toBe("scroll");

    onReadingViewOpenChange.mockClear();
    rerender(<TranscriptionSection {...props} />);
    fireEvent.mouseDown(document.querySelector(".reading-view-overlay")!);
    expect(onReadingViewOpenChange).toHaveBeenLastCalledWith(false);
    rerender(
      <TranscriptionSection {...props} readingViewOpen={false} />,
    );
    expect(document.body.style.overflow).toBe("scroll");

    onReadingViewOpenChange.mockClear();
    rerender(<TranscriptionSection {...props} />);
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Reading view" }));
    expect(onReadingViewOpenChange).not.toHaveBeenCalled();

    unmount();
    expect(document.body.style.overflow).toBe("scroll");
  });
});
