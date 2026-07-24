import { Modal } from '../../../components/common';

export interface PhotoDescriptionContextModalProps {
  view: {
    isOpen: boolean;
    hasDescription: boolean;
    hasSavedContext: boolean;
    draftContext: string;
    generating: boolean;
  };
  onContextChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function PhotoDescriptionContextModal({
  view,
  onContextChange,
  onCancel,
  onSubmit,
}: PhotoDescriptionContextModalProps) {
  const action = view.hasDescription ? 'Regenerate' : 'Describe';

  return (
    <Modal
      isOpen={view.isOpen}
      onClose={onCancel}
      title={view.hasDescription
        ? 'Regenerate Photo Description'
        : 'Describe Photo'}
      subtitle="Optional AI context helps the model interpret uncertain people, places, or scenes."
      size="md"
      actions={
        <>
          <button
            className="btn-cancel"
            onClick={onCancel}
            disabled={view.generating}
          >
            Cancel
          </button>
          <button
            className="btn-confirm photo-context-confirm"
            onClick={onSubmit}
            disabled={view.generating}
          >
            {view.generating
              ? 'Describing...'
              : `${action} ${view.hasDescription ? 'Description' : 'Photo'}`}
          </button>
        </>
      }
    >
      <div className="photo-context-modal">
        <p className="photo-context-copy">
          Add optional context that should be sent to the model with this image.
          Leave it blank if the photo should be described on its own.
        </p>
        <div className="photo-context-examples">
          <span>Examples:</span>
          <span className="photo-context-chip">This is likely Jimmy and Molly.</span>
          <span className="photo-context-chip">
            Family porch snapshot, probably at home in Ohio.
          </span>
        </div>
        {view.hasSavedContext && (
          <p className="photo-context-copy photo-context-saved">
            Current saved context will be replaced when you run this action.
          </p>
        )}
        <label className="photo-context-label" htmlFor="photo-description-context">
          AI Context
        </label>
        <textarea
          id="photo-description-context"
          className="photo-context-textarea"
          value={view.draftContext}
          onChange={(event) => onContextChange(event.target.value)}
          placeholder="Add optional context for the AI model"
          rows={6}
          disabled={view.generating}
        />
      </div>
    </Modal>
  );
}
