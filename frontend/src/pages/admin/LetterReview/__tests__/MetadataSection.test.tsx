import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MetadataSection from "../MetadataSection";
import type { Letter } from "../../../../types/Letter";

const buildLetter = (overrides: Partial<Letter> = {}): Letter => ({
  id: "letter-1",
  title: "Test Letter",
  images: [],
  transcript: { pages: [], fullText: "sample transcript", verified: false },
  metadata: { verified: false, notableQuotes: [] },
  status: "needs_review",
  workflowState: "REVIEWED",
  visibility: "HIDDEN",
  transcriptPublished: false,
  metadataPublished: false,
  transcriptStatus: "EDITED",
  metadataContentStatus: "EMPTY",
  extraContentStatus: "EMPTY",
  flagged: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  linkedPersons: [],
  linkedPlaces: [],
  ...overrides,
});

const buildProps = (overrides: Partial<ComponentProps<typeof MetadataSection>> = {}) => {
  const letter = overrides.letter ?? buildLetter();

  return {
    letter,
    letterId: letter.id,
    sender: "",
    recipient: "",
    date: "",
    location: "",
    hook: "",
    description: "",
    emotionalTone: "" as const,
    relationship: "" as const,
    primaryTopics: [],
    topicsDropdownOpen: false,
    onSenderChange: vi.fn(),
    onRecipientChange: vi.fn(),
    onDateChange: vi.fn(),
    onLocationChange: vi.fn(),
    onHookChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onEmotionalToneChange: vi.fn(),
    onRelationshipChange: vi.fn(),
    onPrimaryTopicsChange: vi.fn(),
    onTopicsDropdownOpenChange: vi.fn(),
    onTriggerAutoSave: vi.fn(),
    regenerateState: "idle",
    identityUpdateState: "idle" as const,
    identityUpdateSecondsRemaining: 0,
    retagState: "idle" as const,
    onVerifyMetadata: vi.fn(),
    onConfirmTranscript: vi.fn(),
    onRegenerateMetadata: vi.fn(),
    onMetadataFieldClick: vi.fn(),
    onMetadataFieldDoubleClick: vi.fn(),
    showMetadataTooltip: false,
    metadataTooltipPosition: { x: 120, y: 120 },
    metadataTooltipRef: createRef<HTMLDivElement>(),
    saving: false,
    showToast: vi.fn(),
    ...overrides,
  };
};

describe("MetadataSection", () => {
  it("uses generate action when metadata is empty", async () => {
    const user = userEvent.setup();
    const onConfirmTranscript = vi.fn();
    const props = buildProps({
      letter: buildLetter({ metadataContentStatus: "EMPTY" }),
      onConfirmTranscript,
    });

    render(<MetadataSection {...props} />);

    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(onConfirmTranscript).toHaveBeenCalledTimes(1);
  });

  it("uses regenerate action when metadata exists", async () => {
    const user = userEvent.setup();
    const onRegenerateMetadata = vi.fn();
    const props = buildProps({
      letter: buildLetter({ metadataContentStatus: "EDITED" }),
      onRegenerateMetadata,
    });

    render(<MetadataSection {...props} />);

    await user.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(onRegenerateMetadata).toHaveBeenCalledTimes(1);
  });

  it("triggers autosave on sender change", async () => {
    const onSenderChange = vi.fn();
    const onTriggerAutoSave = vi.fn();
    const props = buildProps({
      onSenderChange,
      onTriggerAutoSave,
    });

    render(<MetadataSection {...props} />);

    fireEvent.change(screen.getByLabelText("Sender"), { target: { value: "Ada" } });

    expect(onSenderChange).toHaveBeenCalledWith("Ada");
    expect(onTriggerAutoSave).toHaveBeenCalledWith({ sender: "Ada" });
  });

  it("shows verified metadata as read-only", () => {
    const props = buildProps({
      letter: buildLetter({
        metadataContentStatus: "VERIFIED",
        metadataVerifiedAt: "2024-01-01T00:00:00.000Z",
      }),
    });

    const { container } = render(<MetadataSection {...props} />);

    expect(screen.getByText(/Verified on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(container.querySelector(".metadata-form")).toHaveClass("verified");
    expect(screen.getByLabelText("Sender")).toHaveAttribute("readonly");
  });

  it("shows pending identity update feedback", () => {
    const props = buildProps({
      identityUpdateState: "pending",
      identityUpdateSecondsRemaining: 10,
    });

    render(<MetadataSection {...props} />);

    expect(screen.getByText("Updating in 10s...")).toBeInTheDocument();
  });

  it("shows identity save progress feedback", () => {
    const props = buildProps({
      identityUpdateState: "saving",
    });

    render(<MetadataSection {...props} />);

    expect(screen.getByText("Saving name...")).toBeInTheDocument();
  });

  it("shows retagging feedback under sender and recipient", () => {
    const props = buildProps({
      retagState: "retagging",
    });

    render(<MetadataSection {...props} />);

    expect(screen.getByText("Updating references...")).toBeInTheDocument();
  });

  it("shows retag completion feedback", () => {
    const props = buildProps({
      retagState: "done",
    });

    render(<MetadataSection {...props} />);

    expect(screen.getByText("References updated")).toBeInTheDocument();
  });
});
