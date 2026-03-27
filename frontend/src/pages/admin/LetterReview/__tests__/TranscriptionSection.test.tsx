import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
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
  hasTranscriptChanges: false,
  originalTranscriptText: null,
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
  ...overrides,
});

describe("TranscriptionSection", () => {
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
});
