import React, { type RefObject } from "react";
import { Icon, DynamicEditor, type DynamicEditorRef } from "../../../components/common";

interface ExtraContentSectionProps {
  letter: {
    extraContentStatus?: string;
    extraContentVerifiedAt?: string | null;
  };
  extraContent: string;
  extraContentTranscribing: boolean;
  isExtraContentEditing: boolean;
  showExtraContentTooltip: boolean;
  extraContentTooltipPosition: { x: number; y: number };
  extraContentTooltipRef: RefObject<HTMLDivElement | null>;
  saving: boolean;
  extraContentRef: RefObject<DynamicEditorRef | null>;
  onTranscribeExtras: () => void;
  onVerifyExtraContent: () => void;
  onExtraContentChange: (value: string) => void;
  onExtraContentKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onExtraContentClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onExtraContentDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const ExtraContentSection = React.memo(function ExtraContentSection({
  letter,
  extraContent,
  extraContentTranscribing,
  isExtraContentEditing,
  showExtraContentTooltip,
  extraContentTooltipPosition,
  extraContentTooltipRef,
  saving,
  extraContentRef,
  onTranscribeExtras,
  onVerifyExtraContent,
  onExtraContentChange,
  onExtraContentKeyDown,
  onExtraContentClick,
  onExtraContentDoubleClick,
}: ExtraContentSectionProps) {
  return (
    <div className="editor-section extra-content-section">
      <div className="editor-header">
        <h2>Extra Content</h2>
        <div className="header-right">
          {/* Transcribe button - hidden when verified */}
          {(letter.extraContentStatus !== "VERIFIED" ||
            isExtraContentEditing) && (
            <button
              className="action-btn transcribe-btn"
              onClick={() => onTranscribeExtras()}
              disabled={saving || extraContentTranscribing}
              title={extraContent.trim()
                ? "Regenerate extra content transcription"
                : "Transcribe telegrams, covers, and ephemera"}
            >
              {extraContentTranscribing ? (
                <>
                  <Icon
                    name="process"
                    size={14}
                    className="spinning"
                  />
                  <span>{extraContent.trim() ? "Regenerating..." : "Transcribing..."}</span>
                </>
              ) : (
                <>
                  <Icon name="process" size={14} />
                  <span>{extraContent.trim() ? "Regenerate" : "Transcribe"}</span>
                </>
              )}
            </button>
          )}

          {/* Verification UI */}
          {letter.extraContentStatus === "VERIFIED" ? (
            <div
              className="verified-info"
              onClick={onVerifyExtraContent}
              style={{ cursor: "pointer" }}
              title="Click to unverify"
            >
              <Icon name="check" size={14} />
              <span>
                Verified
                {letter.extraContentVerifiedAt &&
                  ` on ${new Date(letter.extraContentVerifiedAt).toLocaleDateString()}`}
              </span>
            </div>
          ) : (
            letter.extraContentStatus !== "EMPTY" && (
              <button
                className="verify-btn"
                onClick={onVerifyExtraContent}
                disabled={saving}
                title="Mark extra content verified"
              >
                Verify
              </button>
            )
          )}
        </div>
      </div>
      <div className="extra-content-container">
        <DynamicEditor
          ref={extraContentRef}
          value={extraContent}
          onChange={onExtraContentChange}
          onKeyDown={onExtraContentKeyDown}
          onClick={onExtraContentClick}
          onDoubleClick={onExtraContentDoubleClick}
          placeholder=""
          readOnly={
            letter.extraContentStatus === "VERIFIED" &&
            !isExtraContentEditing
          }
          verified={
            letter.extraContentStatus === "VERIFIED" &&
            !isExtraContentEditing
          }
          baseFontSize={1.0}
          minHeight={180}
        />

        {/* Double-click to edit tooltip for extra content */}
        {showExtraContentTooltip && (
          <div
            ref={extraContentTooltipRef}
            className="edit-tooltip"
            style={{
              left: Math.min(
                extraContentTooltipPosition.x,
                window.innerWidth - 280,
              ),
              top: extraContentTooltipPosition.y + 10,
            }}
          >
            Verified. Double-click to edit and unverify.
          </div>
        )}
      </div>
    </div>
  );
});

ExtraContentSection.displayName = "ExtraContentSection";
