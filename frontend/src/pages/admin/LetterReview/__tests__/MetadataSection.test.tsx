import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MetadataSection from "../MetadataSection";
import type { Letter } from "../../../../types/Letter";

const buildLetter = (overrides: Partial<Letter> = {}): Letter => ({
  id: "letter-1",
  title: "Test Letter",
  primarySourceRevision: 0,
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
    confirmationReplayBlocked: false,
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
      letter: buildLetter({
        metadataJobStatus: "PENDING",
        metadataContentStatus: "EMPTY",
        transcriptConfirmedAt: undefined,
      }),
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

  it("reports explicit regeneration progress ahead of durable job state", () => {
    const props = buildProps({
      letter: buildLetter({
        metadataJobStatus: "PENDING",
        metadataContentStatus: "EDITED",
        transcriptConfirmedAt: "2026-07-24T12:00:00.000Z",
      }),
      regenerateState: "regenerating",
    });

    render(<MetadataSection {...props} />);

    expect(screen.getByRole("button", {
      name: "Regenerating...",
    })).toBeDisabled();
  });

  it("disables generation while empty metadata is extracting", async () => {
    const user = userEvent.setup();
    const onConfirmTranscript = vi.fn();
    const onRegenerateMetadata = vi.fn();
    const props = buildProps({
      letter: buildLetter({
        workflowState: "TRANSCRIBED",
        metadataJobStatus: "RUNNING",
        metadataContentStatus: "EMPTY",
        transcriptConfirmedAt: "2026-07-24T12:00:00.000Z",
      }),
      onConfirmTranscript,
      onRegenerateMetadata,
    });

    render(<MetadataSection {...props} />);

    const extracting = screen.getByRole("button", {
      name: "Extracting...",
    });
    expect(extracting).toBeDisabled();
    await user.click(extracting);
    expect(onConfirmTranscript).not.toHaveBeenCalled();
    expect(onRegenerateMetadata).not.toHaveBeenCalled();
  });

  it("disables queued metadata even before workflow advances", async () => {
    const user = userEvent.setup();
    const onConfirmTranscript = vi.fn();
    const onRegenerateMetadata = vi.fn();
    const props = buildProps({
      letter: buildLetter({
        workflowState: "TRANSCRIBED",
        metadataJobStatus: "PENDING",
        metadataContentStatus: "EMPTY",
        transcriptConfirmedAt: "2026-07-24T12:00:00.000Z",
      }),
      onConfirmTranscript,
      onRegenerateMetadata,
    });

    render(<MetadataSection {...props} />);

    const queued = screen.getByRole("button", { name: "Queued" });
    expect(queued).toBeDisabled();
    await user.click(queued);
    expect(onConfirmTranscript).not.toHaveBeenCalled();
    expect(onRegenerateMetadata).not.toHaveBeenCalled();
  });

  it("retries metadata instead of replaying confirmation when empty is confirmed", async () => {
    const user = userEvent.setup();
    const onConfirmTranscript = vi.fn();
    const onRegenerateMetadata = vi.fn();
    const props = buildProps({
      letter: buildLetter({
        workflowState: "TRANSCRIBED",
        metadataJobStatus: "FAILED",
        metadataContentStatus: "EMPTY",
        transcriptConfirmedAt: "2026-07-24T12:00:00.000Z",
      }),
      onConfirmTranscript,
      onRegenerateMetadata,
    });

    render(<MetadataSection {...props} />);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onConfirmTranscript).not.toHaveBeenCalled();
    expect(onRegenerateMetadata).toHaveBeenCalledOnce();
  });

  it("blocks an unresolved confirmation outcome until reload", async () => {
    const user = userEvent.setup();
    const onConfirmTranscript = vi.fn();
    const props = buildProps({
      confirmationReplayBlocked: true,
      onConfirmTranscript,
    });

    render(<MetadataSection {...props} />);

    const generate = screen.getByRole("button", { name: "Generate" });
    expect(generate).toBeDisabled();
    await user.click(generate);
    expect(onConfirmTranscript).not.toHaveBeenCalled();
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

  it("autosaves date, tone, and relationship changes", () => {
    const onTriggerAutoSave = vi.fn();
    const props = buildProps({ onTriggerAutoSave });

    render(<MetadataSection {...props} />);

    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "1920-03-15" },
    });
    fireEvent.change(screen.getByLabelText("Emotional Tone"), {
      target: { value: "matter-of-fact" },
    });
    fireEvent.change(screen.getByLabelText("Relationship"), {
      target: { value: "parent-child" },
    });

    expect(onTriggerAutoSave).toHaveBeenCalledWith({
      extractedDate: "1920-03-15",
    });
    expect(onTriggerAutoSave).toHaveBeenCalledWith({
      emotionalTone: "matter-of-fact",
    });
    expect(onTriggerAutoSave).toHaveBeenCalledWith({
      senderRecipientRelationship: "parent-child",
    });
  });

  it("autosaves topic additions and removals", async () => {
    const user = userEvent.setup();
    const onPrimaryTopicsChange = vi.fn();
    const onTriggerAutoSave = vi.fn();
    const { rerender } = render(
      <MetadataSection
        {...buildProps({
          onPrimaryTopicsChange,
          onTriggerAutoSave,
          topicsDropdownOpen: true,
        })}
      />,
    );

    await user.click(screen.getByText("family / marriage"));
    expect(onPrimaryTopicsChange).toHaveBeenCalledWith([
      "family/marriage",
    ]);
    expect(onTriggerAutoSave).toHaveBeenCalledWith({
      primaryTopics: ["family/marriage"],
    });

    rerender(
      <MetadataSection
        {...buildProps({
          onPrimaryTopicsChange,
          onTriggerAutoSave,
          primaryTopics: ["family/marriage"],
        })}
      />,
    );
    await user.click(screen.getByTitle("Remove topic"));
    expect(onPrimaryTopicsChange).toHaveBeenCalledWith([]);
    expect(onTriggerAutoSave).toHaveBeenCalledWith({
      primaryTopics: null,
    });
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
