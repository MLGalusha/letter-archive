import React from "react";
import { Icon } from "../../../components/common";
import { ReviewableDynamicEditor } from "./ReviewableDynamicEditor";

interface PhotoDescriptionSectionProps {
  letter: {
    photoDescriptionStatus?: string;
    photoDescriptionVerifiedAt?: string | null;
    photoDescriptionContext?: string;
  };
  photoDescription: string;
  photoDescriptionGenerating: boolean;
  saving: boolean;
  onDescribePhoto: () => void;
  onVerifyPhotoDescription: () => void;
  onPhotoDescriptionChange: (value: string) => void;
}

export const PhotoDescriptionSection = React.memo(function PhotoDescriptionSection({
  letter,
  photoDescription,
  photoDescriptionGenerating,
  saving,
  onDescribePhoto,
  onVerifyPhotoDescription,
  onPhotoDescriptionChange,
}: PhotoDescriptionSectionProps) {
  const hasSavedContext = Boolean(letter.photoDescriptionContext?.trim());
  const photoDescriptionStatus = letter.photoDescriptionStatus ?? "EMPTY";

  return (
    <div className="editor-section photo-description-section">
      <div className="editor-header">
        <h2>
          Photo Description
          {hasSavedContext && (
            <span className="photo-context-badge">AI context saved</span>
          )}
        </h2>
        <div className="header-right">
          {photoDescriptionStatus !== "VERIFIED" && (
            <button
              className="action-btn transcribe-btn"
              onClick={onDescribePhoto}
              disabled={saving || photoDescriptionGenerating}
              title={photoDescription.trim()
                ? "Regenerate photo description with optional AI context"
                : "Describe this photo with optional AI context"}
            >
              {photoDescriptionGenerating ? (
                <>
                  <Icon
                    name="process"
                    size={14}
                    className="spinning"
                  />
                  <span>{photoDescription.trim() ? "Regenerating..." : "Describing..."}</span>
                </>
              ) : (
                <>
                  <Icon name="file" size={14} />
                  <span>{photoDescription.trim() ? "Regenerate" : "Describe Photo"}</span>
                </>
              )}
            </button>
          )}

          {photoDescriptionStatus === "VERIFIED" ? (
            <div
              className="verified-info"
              onClick={onVerifyPhotoDescription}
              style={{ cursor: "pointer" }}
              title="Click to unverify"
            >
              <Icon name="check" size={14} />
              <span>
                Verified
                {letter.photoDescriptionVerifiedAt &&
                  ` on ${new Date(letter.photoDescriptionVerifiedAt).toLocaleDateString()}`}
              </span>
            </div>
          ) : (
            photoDescriptionStatus !== "EMPTY" && (
              <button
                className="verify-btn"
                onClick={onVerifyPhotoDescription}
                disabled={saving}
                title="Mark photo description verified"
              >
                Verify
              </button>
            )
          )}
        </div>
      </div>
      <ReviewableDynamicEditor
        value={photoDescription}
        verified={photoDescriptionStatus === "VERIFIED"}
        onChange={onPhotoDescriptionChange}
        onRequestEdit={onVerifyPhotoDescription}
        placeholder="Describe what is visible in this photo, or generate an AI draft."
      />
    </div>
  );
});

PhotoDescriptionSection.displayName = "PhotoDescriptionSection";
