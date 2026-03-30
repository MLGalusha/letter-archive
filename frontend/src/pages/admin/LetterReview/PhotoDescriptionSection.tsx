import React, { type RefObject } from "react";
import { Icon, DynamicEditor, type DynamicEditorRef } from "../../../components/common";

interface PhotoDescriptionSectionProps {
  letter: {
    photoDescriptionStatus?: string;
    photoDescriptionVerifiedAt?: string | null;
    photoDescriptionContext?: string;
  };
  photoDescription: string;
  photoDescriptionGenerating: boolean;
  isPhotoDescriptionEditing: boolean;
  showPhotoDescriptionTooltip: boolean;
  photoDescriptionTooltipPosition: { x: number; y: number };
  photoDescriptionTooltipRef: RefObject<HTMLDivElement | null>;
  saving: boolean;
  photoDescriptionRef: RefObject<DynamicEditorRef | null>;
  onDescribePhoto: () => void;
  onVerifyPhotoDescription: () => void;
  onPhotoDescriptionChange: (value: string) => void;
  onPhotoDescriptionKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPhotoDescriptionClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onPhotoDescriptionDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const PhotoDescriptionSection = React.memo(function PhotoDescriptionSection({
  letter,
  photoDescription,
  photoDescriptionGenerating,
  isPhotoDescriptionEditing,
  showPhotoDescriptionTooltip,
  photoDescriptionTooltipPosition,
  photoDescriptionTooltipRef,
  saving,
  photoDescriptionRef,
  onDescribePhoto,
  onVerifyPhotoDescription,
  onPhotoDescriptionChange,
  onPhotoDescriptionKeyDown,
  onPhotoDescriptionClick,
  onPhotoDescriptionDoubleClick,
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
          {(photoDescriptionStatus !== "VERIFIED" ||
            isPhotoDescriptionEditing) && (
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
      <div className="extra-content-container">
        <DynamicEditor
          ref={photoDescriptionRef}
          value={photoDescription}
          onChange={onPhotoDescriptionChange}
          onKeyDown={onPhotoDescriptionKeyDown}
          onClick={onPhotoDescriptionClick}
          onDoubleClick={onPhotoDescriptionDoubleClick}
          placeholder="Describe what is visible in this photo, or generate an AI draft."
          readOnly={
            photoDescriptionStatus === "VERIFIED" &&
            !isPhotoDescriptionEditing
          }
          verified={
            photoDescriptionStatus === "VERIFIED" &&
            !isPhotoDescriptionEditing
          }
          baseFontSize={1.0}
          minHeight={180}
        />

        {showPhotoDescriptionTooltip && (
          <div
            ref={photoDescriptionTooltipRef}
            className="edit-tooltip"
            style={{
              left: Math.min(
                photoDescriptionTooltipPosition.x,
                window.innerWidth - 280,
              ),
              top: photoDescriptionTooltipPosition.y + 10,
            }}
          >
            Verified. Double-click to edit and unverify.
          </div>
        )}
      </div>
    </div>
  );
});

PhotoDescriptionSection.displayName = "PhotoDescriptionSection";
