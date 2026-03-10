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
    dateConfidence: "unknown" as const,
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
    onDateConfidenceChange: vi.fn(),
    onLocationChange: vi.fn(),
    onHookChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onEmotionalToneChange: vi.fn(),
    onRelationshipChange: vi.fn(),
    onPrimaryTopicsChange: vi.fn(),
    onTopicsDropdownOpenChange: vi.fn(),
    onTriggerAutoSave: vi.fn(),
    onStartSyncTimer: vi.fn(),
    hookRef: createRef<HTMLTextAreaElement>(),
    descriptionRef: createRef<HTMLTextAreaElement>(),
    syncState: "idle",
    syncMessage: null,
    syncCountdown: null,
    showCancelHint: false,
    regenerateState: "idle",
    onAISync: vi.fn(),
    onCountdownClick: vi.fn(),
    onCountdownDoubleClick: vi.fn(),
    onVerifyMetadata: vi.fn(),
    onConfirmTranscript: vi.fn(),
    onRegenerateMetadata: vi.fn(),
    onRegenerateEntities: vi.fn().mockResolvedValue(undefined),
    onMetadataFieldClick: vi.fn(),
    onMetadataFieldDoubleClick: vi.fn(),
    showMetadataTooltip: false,
    metadataTooltipPosition: { x: 120, y: 120 },
    onUpdateLinkedPerson: vi.fn().mockResolvedValue(letter),
    onUpdateLinkedPlace: vi.fn().mockResolvedValue(letter),
    onRemoveLinkedPerson: vi.fn().mockResolvedValue(letter),
    onRemoveLinkedPlace: vi.fn().mockResolvedValue(letter),
    onSetLetter: vi.fn(),
    onShowAddPersonModal: vi.fn(),
    onShowAddPlaceModal: vi.fn(),
    onOpenLinkedPerson: vi.fn(),
    onOpenLinkedPlace: vi.fn(),
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
    expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
  });

  it("uses regenerate and sync actions when metadata exists", async () => {
    const user = userEvent.setup();
    const onRegenerateMetadata = vi.fn();
    const onAISync = vi.fn();
    const props = buildProps({
      letter: buildLetter({ metadataContentStatus: "EDITED" }),
      onRegenerateMetadata,
      onAISync,
    });

    render(<MetadataSection {...props} />);

    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await user.click(screen.getByRole("button", { name: "Sync" }));

    expect(onRegenerateMetadata).toHaveBeenCalledTimes(1);
    expect(onAISync).toHaveBeenCalledTimes(1);
  });

  it("triggers autosave and sync timer on sender change", async () => {
    const onSenderChange = vi.fn();
    const onTriggerAutoSave = vi.fn();
    const onStartSyncTimer = vi.fn();
    const props = buildProps({
      onSenderChange,
      onTriggerAutoSave,
      onStartSyncTimer,
    });

    render(<MetadataSection {...props} />);

    fireEvent.change(screen.getByLabelText("Sender"), { target: { value: "Ada" } });

    expect(onSenderChange).toHaveBeenCalledWith("Ada");
    expect(onTriggerAutoSave).toHaveBeenCalledWith({ sender: "Ada" });
    expect(onStartSyncTimer).toHaveBeenCalled();
  });

  it("lets operators sync immediately while a countdown is active", async () => {
    const user = userEvent.setup();
    const onAISync = vi.fn();
    const props = buildProps({
      letter: buildLetter({ metadataContentStatus: "EDITED" }),
      syncCountdown: 175,
      onAISync,
    });

    render(<MetadataSection {...props} />);

    const syncButton = screen.getByRole("button", { name: /2:55/i });
    await user.click(syncButton);

    expect(onAISync).toHaveBeenCalledTimes(1);
  });

  it("keeps double-click cancellation available while countdown is active", () => {
    const onCountdownDoubleClick = vi.fn();
    const props = buildProps({
      letter: buildLetter({ metadataContentStatus: "EDITED" }),
      syncCountdown: 175,
      onCountdownDoubleClick,
    });

    render(<MetadataSection {...props} />);

    fireEvent.doubleClick(screen.getByRole("button", { name: /2:55/i }));

    expect(onCountdownDoubleClick).toHaveBeenCalledTimes(1);
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
});
