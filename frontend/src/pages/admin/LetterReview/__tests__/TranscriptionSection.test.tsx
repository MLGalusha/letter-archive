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
  onEditorKeyDown: vi.fn(),
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
    fireEvent.keyDown(editor, { key: "Tab" });

    expect(props.onTranscribeLetter).toHaveBeenCalledTimes(1);
    expect(props.onVerifyTranscript).toHaveBeenCalledTimes(1);
    expect(props.onTranscriptClick).toHaveBeenCalledTimes(1);
    expect(props.onTranscriptDoubleClick).toHaveBeenCalledTimes(1);
    expect(props.onTranscriptInput).toHaveBeenCalledWith("updated transcript");
    expect(props.onEditorKeyDown).toHaveBeenCalledTimes(1);
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
