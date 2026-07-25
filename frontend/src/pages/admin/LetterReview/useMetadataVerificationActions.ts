import {
  useCallback,
  useEffect,
  type MouseEvent,
} from 'react';
import { unverifyMetadata, verifyMetadata } from '../../../api/admin';
import { useTooltip } from '../../../hooks/useTooltip';
import type { Letter } from '../../../types/Letter';
import type { ExecuteLetterReviewMutation } from './useLetterReviewMutationExecutor';
import type { LetterReviewVisit } from './useLetterReviewVisit';

interface UseMetadataVerificationActionsOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  executeLetterMutation: ExecuteLetterReviewMutation;
  showToast: (
    message: string,
    type: 'success' | 'error' | 'info',
  ) => void;
}

/**
 * Owns metadata verification requests and verified-field tooltip interaction.
 */
export function useMetadataVerificationActions({
  visit,
  letter,
  executeLetterMutation,
  showToast,
}: UseMetadataVerificationActionsOptions) {
  const {
    show: showMetadataTooltip,
    position: metadataTooltipPosition,
    ref: metadataTooltipRef,
    showAt: showMetadataTooltipAt,
    close: closeMetadataTooltip,
  } = useTooltip();

  useEffect(() => {
    closeMetadataTooltip();
  }, [closeMetadataTooltip, visit]);

  const handleVerifyMetadata = useCallback(async () => {
    if (!letter) return;
    const target = {
      letterId: letter.id,
      primarySourceRevision: letter.primarySourceRevision,
    };

    await executeLetterMutation({
      request: () => verifyMetadata(
        target.letterId,
        target.primarySourceRevision,
      ),
      failureMessage: 'Failed to verify metadata',
      afterAdopt: () => {
        showToast('Metadata verified', 'success');
      },
    });
  }, [executeLetterMutation, letter, showToast]);

  const handleMetadataFieldClick = useCallback(
    (event: MouseEvent) => {
      if (
        !visit.isActive()
        || letter?.metadataContentStatus !== 'VERIFIED'
      ) {
        return;
      }

      showMetadataTooltipAt(event.clientX, event.clientY);
    },
    [letter?.metadataContentStatus, showMetadataTooltipAt, visit],
  );

  const handleMetadataFieldDoubleClick = useCallback(async () => {
    if (
      !visit.isActive()
      || letter?.metadataContentStatus !== 'VERIFIED'
    ) {
      return;
    }

    closeMetadataTooltip();
    const target = {
      letterId: letter.id,
      primarySourceRevision: letter.primarySourceRevision,
    };
    await executeLetterMutation({
      request: () => unverifyMetadata(
        target.letterId,
        target.primarySourceRevision,
      ),
      failureMessage: 'Failed to unverify metadata',
      afterAdopt: () => {
        showToast('Verification removed', 'info');
      },
    });
  }, [
    closeMetadataTooltip,
    executeLetterMutation,
    letter,
    showToast,
    visit,
  ]);

  return {
    handleMetadataFieldClick,
    handleMetadataFieldDoubleClick,
    handleVerifyMetadata,
    metadataTooltipPosition,
    metadataTooltipRef,
    showMetadataTooltip,
  } as const;
}
