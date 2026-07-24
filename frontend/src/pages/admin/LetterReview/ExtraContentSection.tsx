import React from "react";
import { Icon } from "../../../components/common";
import { ReviewableDynamicEditor } from "./ReviewableDynamicEditor";

interface ExtraContentSectionProps {
  letter: {
    extraContentStatus?: string;
    extraContentVerifiedAt?: string | null;
  };
  extraContent: string;
  extraContentTranscribing: boolean;
  saving: boolean;
  onTranscribeExtras: () => void;
  onVerifyExtraContent: () => void;
  onExtraContentChange: (value: string) => void;
}

export const ExtraContentSection = React.memo(function ExtraContentSection({
  letter,
  extraContent,
  extraContentTranscribing,
  saving,
  onTranscribeExtras,
  onVerifyExtraContent,
  onExtraContentChange,
}: ExtraContentSectionProps) {
  return (
    <div className="editor-section extra-content-section">
      <div className="editor-header">
        <h2>Extra Content</h2>
        <div className="header-right">
          {/* Transcribe button - hidden when verified */}
          {letter.extraContentStatus !== "VERIFIED" && (
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
      <ReviewableDynamicEditor
        value={extraContent}
        verified={letter.extraContentStatus === "VERIFIED"}
        onChange={onExtraContentChange}
        onRequestEdit={onVerifyExtraContent}
        placeholder=""
      />
    </div>
  );
});

ExtraContentSection.displayName = "ExtraContentSection";
