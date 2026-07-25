import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReviewPage.tsx',
);
const transcriptEditingPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useTranscriptEditing.ts',
);
const metadataFormStatePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useMetadataFormState.ts',
);
const metadataVerificationActionsPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useMetadataVerificationActions.ts',
);
const autoSavePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useAutoSave.ts',
);
const sourceConflictPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useLetterSourceConflict.ts',
);
const guardedLetterStatePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useGuardedLetterState.ts',
);
const reviewVisitPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useLetterReviewVisit.ts',
);
const autoSaveCoordinatorPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/letterReviewAutosaveCoordinator.ts',
);
const mutationExecutorPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useLetterReviewMutationExecutor.ts',
);
const structuredNoteActionsPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useStructuredNoteActions.ts',
);
const transcriptionSectionPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/TranscriptionSection.tsx',
);
const photoDescriptionSectionPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/PhotoDescriptionSection.tsx',
);
const photoDescriptionWorkspacePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/usePhotoDescriptionWorkspace.ts',
);
const extraContentSectionPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/ExtraContentSection.tsx',
);
const extraContentWorkspacePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useExtraContentWorkspace.ts',
);
const readingViewWorkspacePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useReadingViewWorkspace.ts',
);
const letterTranscriptionWorkspacePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useLetterTranscriptionWorkspace.ts',
);
const analysisRegenerationWorkspacePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useAnalysisRegenerationWorkspace.ts',
);
const transcriptConfirmationWorkspacePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useTranscriptConfirmationWorkspace.ts',
);
const lineReviewWorkspacePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useLineReviewWorkspace.ts',
);
const reviewableDynamicEditorPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/ReviewableDynamicEditor.tsx',
);
const lineReviewPath = path.resolve(
  process.cwd(),
  'src/components/LineReviewMode/LineReviewMode.tsx',
);

function callbackBlock(source: string, name: string): string {
  const start = source.indexOf(`const ${name}`);
  if (start === -1) {
    throw new Error(`Could not find callback ${name}`);
  }
  const next = source.indexOf('\n  const ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('Letter Review source-conflict ownership', () => {
  it('routes every direct source-bound mutation through one terminal owner', async () => {
    const [
      page,
      transcriptionSection,
      photoDescriptionSection,
      photoDescriptionWorkspace,
      extraContentSection,
      extraContentWorkspace,
      readingViewWorkspace,
      letterTranscriptionWorkspace,
      analysisRegenerationWorkspace,
      transcriptConfirmationWorkspace,
      reviewableDynamicEditor,
      mutationExecutor,
      structuredNoteActions,
    ] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(transcriptionSectionPath, 'utf8'),
      readFile(photoDescriptionSectionPath, 'utf8'),
      readFile(photoDescriptionWorkspacePath, 'utf8'),
      readFile(extraContentSectionPath, 'utf8'),
      readFile(extraContentWorkspacePath, 'utf8'),
      readFile(readingViewWorkspacePath, 'utf8'),
      readFile(letterTranscriptionWorkspacePath, 'utf8'),
      readFile(analysisRegenerationWorkspacePath, 'utf8'),
      readFile(transcriptConfirmationWorkspacePath, 'utf8'),
      readFile(reviewableDynamicEditorPath, 'utf8'),
      readFile(mutationExecutorPath, 'utf8'),
      readFile(structuredNoteActionsPath, 'utf8'),
    ]);

    expect(page).toContain('useLetterSourceConflict(showToast, visit)');
    expect(callbackBlock(page, 'handleDelete')).toContain(
      'handleMutationError(',
    );
    expect(transcriptConfirmationWorkspace).toContain(
      'executeLetterMutation({',
    );
    expect(transcriptConfirmationWorkspace).toContain(
      'resolveTranscriptConfirmationOutcome({',
    );
    expect(callbackBlock(
      analysisRegenerationWorkspace,
      'regenerate',
    )).toContain('executeLetterMutation({');
    for (const callback of [
      'handleVisibilityChange',
      'handleContentPublishToggle',
      'handleFlagToggle',
    ]) {
      expect(callbackBlock(page, callback)).toContain(
        'executeLetterMutation({',
      );
    }
    expect(mutationExecutor).toContain(
      'handleMutationError(error, failureMessage)',
    );
    expect(mutationExecutor).toContain('tryAdoptLetter(updatedLetter)');
    expect(mutationExecutor).toContain(
      'hydrateAdoptedLetter(updatedLetter)',
    );
    expect(page).toContain('useStructuredNoteActions({');
    expect(structuredNoteActions).toContain(
      'executeLetterMutation({',
    );
    expect(page).toContain('useReadingViewWorkspace({');
    expect(callbackBlock(readingViewWorkspace, 'generate')).toContain(
      'executeLetterMutation({',
    );
    expect(page).toContain('useLetterTranscriptionWorkspace({');
    expect(callbackBlock(letterTranscriptionWorkspace, 'transcribe')).toContain(
      'executeLetterMutation({',
    );
    expect(letterTranscriptionWorkspace).toContain(
      "scheduleStatusReset('transcription'",
    );
    expect(letterTranscriptionWorkspace).not.toContain('setTimeout(');
    expect(page).not.toMatch(/\btranscribeLetter\b/);
    expect(page).not.toContain('handleTranscribeLetter');
    expect(page).not.toContain('letterTranscribeState');
    expect(page).not.toContain('letterTranscribeMessage');
    expect(page).not.toContain('transcriptViewMode');
    expect(page).not.toContain('setReaderText');
    expect(page).not.toContain('handleReaderTextChange');
    expect(page).not.toContain('handleGenerateReadingView');
    expect(transcriptionSection).not.toContain('onReaderTextChange');
    for (const callback of ['transcribe', 'toggleVerification']) {
      expect(callbackBlock(extraContentWorkspace, callback)).toContain(
        'executeLetterMutation({',
      );
    }
    for (const callback of ['describe', 'toggleVerification']) {
      expect(callbackBlock(photoDescriptionWorkspace, callback)).toContain(
        'handleMutationError(',
      );
    }
    expect(callbackBlock(page, 'handleDelete')).toContain(
      'deleteLetter(letterId, primarySourceRevision)',
    );
    expect(structuredNoteActions).toContain(
      'letter.primarySourceRevision',
    );
    expect(photoDescriptionSection).toContain(
      'onRequestEdit={onVerifyPhotoDescription}',
    );
    expect(extraContentSection).toContain(
      'onRequestEdit={onVerifyExtraContent}',
    );
    expect(page).toContain(
      '<PhotoDescriptionSection {...photoDescriptionWorkspace.sectionProps} />',
    );
    const sectionSlot = page.indexOf('<PhotoDescriptionSection');
    const splitPaneEnd = page.indexOf('</ResizableSplitPane>');
    const dialogSlot = page.indexOf('<PhotoDescriptionContextModal');
    expect(sectionSlot).toBeLessThan(splitPaneEnd);
    expect(dialogSlot).toBeGreaterThan(splitPaneEnd);
    expect(photoDescriptionWorkspace).toContain(
      "letter.photoDescriptionStatus === 'VERIFIED'",
    );
    expect(photoDescriptionWorkspace).toContain('tryAdoptLetter(');
    expect(page).not.toMatch(
      /\b(describePhoto|updatePhotoDescription|verifyPhotoDescription|unverifyPhotoDescription)\b/,
    );
    expect(page).toContain(
      '<ExtraContentSection {...extraContentWorkspace.sectionProps} />',
    );
    expect(page).not.toMatch(
      /\b(transcribeExtras|updateExtraContent|verifyExtraContent|unverifyExtraContent)\b/,
    );
    expect(reviewableDynamicEditor).toContain(
      'if (!verified || disabled) return',
    );
    expect(reviewableDynamicEditor).toContain(
      'readOnly={verified || disabled}',
    );
    expect(reviewableDynamicEditor).toContain('onRequestEdit();');
    expect(reviewableDynamicEditor).not.toMatch(/api\//);
    expect(page).toContain('sourceConflict &&');
    expect(page).toContain('Reload latest source');
  });

  it('passes the same owner into debounced, metadata, and transcript editing', async () => {
    const page = await readFile(pagePath, 'utf8');
    const ownerPasses = page.match(/\bhandleMutationError,\n/g) ?? [];

    expect(ownerPasses.length).toBeGreaterThanOrEqual(4);
    expect(page).toMatch(
      /<LineReviewMode[\s\S]*?handleMutationError=\{handleMutationError\}/,
    );
    expect(page).toContain('mutationsBlocked={mutationsBlocked}');
  });

  it('keeps transcript editor DOM projection in the section boundary', async () => {
    const [
      page,
      transcriptEditing,
      transcriptionSection,
    ] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(transcriptEditingPath, 'utf8'),
      readFile(transcriptionSectionPath, 'utf8'),
    ]);

    expect(transcriptionSection).toContain(
      'highlightTranscriptMarkers(transcriptText)',
    );
    expect(transcriptionSection).toContain(
      'document.execCommand("insertText", false, "    ")',
    );
    expect(transcriptionSection).toContain(
      'classList.contains("page-sep")',
    );
    expect(transcriptionSection).not.toContain('onEditorKeyDown');
    expect(page).not.toContain('highlightTranscriptMarkers');
    expect(page).not.toContain('onEditorKeyDown');
    expect(page).not.toContain('handleEditorKeyDown');
    expect(page).not.toContain('isPageSepNode');
    expect(transcriptEditing).not.toContain('innerHTML');
    expect(transcriptEditing).not.toContain('editorRef');
  });

  it('keys terminal and queued ownership to an opaque route visit', async () => {
    const [
      page,
      autoSave,
      sourceConflict,
      guardedLetterState,
      reviewVisit,
      autoSaveCoordinator,
      lineReview,
      lineReviewWorkspace,
    ] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(autoSavePath, 'utf8'),
      readFile(sourceConflictPath, 'utf8'),
      readFile(guardedLetterStatePath, 'utf8'),
      readFile(reviewVisitPath, 'utf8'),
      readFile(autoSaveCoordinatorPath, 'utf8'),
      readFile(lineReviewPath, 'utf8'),
      readFile(lineReviewWorkspacePath, 'utf8'),
    ]);

    expect(page).toContain('const visit = useLetterReviewVisit(letterId)');
    expect(page).toContain('useLetterSourceConflict(showToast, visit)');
    expect(page).toContain(
      'useGuardedLetterState(markSourceConflict, visit)',
    );
    expect(page).not.toContain(
      'primarySourceRevision: letter?.primarySourceRevision',
    );
    expect(reviewVisit).toContain('activeVisitRef.current === nextVisit');
    expect(reviewVisit).toContain('activeVisitRef.current = null');
    expect(sourceConflict).toContain('visit: LetterReviewVisit');
    expect(sourceConflict).toContain('conflictState?.visit === visit');
    expect(sourceConflict).toContain('visit.isActive()');
    expect(sourceConflict).toContain('markSourceConflict');
    expect(sourceConflict).toContain(
      'conflictStateRef.current?.visit === visit',
    );
    expect(sourceConflict).toContain('conflictStateRef.current');
    expect(page.match(/setAuthoritativeLetter\(/g)).toHaveLength(1);
    expect(page).toContain('loadCurrentLetter({');
    expect(page).toContain('isCurrent: () => requestIsCurrent');
    expect(page).toContain('requestIsCurrent = false');
    expect(guardedLetterState).toContain('if (!visit.isActive())');
    expect(guardedLetterState).toContain(
      'nextLetter.id !== visit.letterId',
    );
    expect(guardedLetterState).toContain(
      'currentLetter.primarySourceRevision',
    );
    expect(guardedLetterState).toContain(
      '!== nextLetter.primarySourceRevision',
    );
    expect(guardedLetterState).toContain(
      'markSourceConflict(SOURCE_REFRESH_CONFLICT)',
    );
    expect(autoSave).toContain('useLetterReviewAutosaveCoordinator({');
    expect(autoSave).toContain(
      'new Map<LetterReviewVisit, PendingLetterFields>()',
    );
    expect(autoSaveCoordinator).toContain(
      'queuedByLane: Map<LetterReviewAutosaveLane, Job>',
    );
    expect(autoSaveCoordinator).toContain(
      'if (next.visit.isActive() && next.isMutationBlocked())',
    );
    expect(autoSaveCoordinator).toContain(
      'this.cancelQueuedTarget(owner.targetKey)',
    );
    expect(lineReview).toContain('mutationsBlockedRef.current');
    expect(lineReview).toContain('clearTimeout(autoSaveTimerRef.current)');
    expect(page).toContain('toggleLetterFlag(letter.id, newFlagged)');
    expect(page).not.toMatch(
      /getAdminLetterById\(letterId\)\.then[\s\S]*?setLetter\(updated\)/,
    );
    expect(lineReviewWorkspace).toContain(
      'getAdminLetterById(targetLetterId)',
    );
    expect(lineReviewWorkspace).toContain('visit.isActive()');
    expect(lineReviewWorkspace).toContain(
      'tryAdoptLetter(updatedLetter)',
    );
    expect(page).toContain('window.location.reload();');
  });

  it('flushes pending lanes before source-dependent transitions', async () => {
    const [
      page,
      autoSave,
      transcriptEditing,
      metadataVerificationActions,
      photoDescriptionWorkspace,
      extraContentWorkspace,
      readingViewWorkspace,
      letterTranscriptionWorkspace,
      analysisRegenerationWorkspace,
      transcriptConfirmationWorkspace,
      autoSaveCoordinator,
      mutationExecutor,
      structuredNoteActions,
    ] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(autoSavePath, 'utf8'),
      readFile(transcriptEditingPath, 'utf8'),
      readFile(metadataVerificationActionsPath, 'utf8'),
      readFile(photoDescriptionWorkspacePath, 'utf8'),
      readFile(extraContentWorkspacePath, 'utf8'),
      readFile(readingViewWorkspacePath, 'utf8'),
      readFile(letterTranscriptionWorkspacePath, 'utf8'),
      readFile(analysisRegenerationWorkspacePath, 'utf8'),
      readFile(transcriptConfirmationWorkspacePath, 'utf8'),
      readFile(autoSaveCoordinatorPath, 'utf8'),
      readFile(mutationExecutorPath, 'utf8'),
      readFile(structuredNoteActionsPath, 'utf8'),
    ]);

    expect(autoSave).toContain(
      'flushDebouncedSaves(ALL_LETTER_REVIEW_AUTOSAVE_LANES)',
    );
    expect(autoSave).toContain(
      'if (!visit.isActive() || !target) return false',
    );
    expect(page).toContain('flushPendingSaves,');
    expect(transcriptConfirmationWorkspace).toContain(
      'executeLetterMutation({',
    );
    expect(transcriptConfirmationWorkspace).not.toContain(
      'flushPendingSaves',
    );
    expect(transcriptConfirmationWorkspace).not.toContain(
      'hydrateAdoptedLetter',
    );
    const regenerationBlock = callbackBlock(
      analysisRegenerationWorkspace,
      'regenerate',
    );
    expect(regenerationBlock).toContain('executeLetterMutation({');
    expect(regenerationBlock).not.toContain('await flushPendingSaves()');
    expect(regenerationBlock).not.toContain('hydrateAdoptedLetter(');
    expect(callbackBlock(readingViewWorkspace, 'generate')).toContain(
      'executeLetterMutation({',
    );
    expect(callbackBlock(letterTranscriptionWorkspace, 'transcribe')).toContain(
      'executeLetterMutation({',
    );
    expect(autoSave).not.toContain('readingText?:');
    for (const callback of [
      'handleVisibilityChange',
      'handleContentPublishToggle',
      'handleFlagToggle',
    ]) {
      const block = callbackBlock(page, callback);
      expect(block).toContain('executeLetterMutation({');
      expect(block).not.toContain('await flushPendingSaves()');
    }
    expect(mutationExecutor).toContain('if (!visit.isActive())');
    expect(mutationExecutor).toContain('await flushPendingSaves()');
    expect(mutationExecutor).toContain(
      'hydrateAdoptedLetter(updatedLetter)',
    );
    expect(structuredNoteActions).toContain(
      'executeLetterMutation({',
    );
    for (const callback of [
      'handleVerifyMetadata',
      'handleMetadataFieldDoubleClick',
    ]) {
      const block = callbackBlock(metadataVerificationActions, callback);
      expect(block).toContain('executeLetterMutation({');
      expect(block).not.toContain('await flushPendingSaves()');
      expect(block).not.toContain('applyLetterMetadata(');
    }
    for (const callback of ['transcribe', 'toggleVerification']) {
      const block = callbackBlock(extraContentWorkspace, callback);
      expect(block).toContain('executeLetterMutation({');
      expect(block).not.toContain('await flushPendingSaves()');
    }
    const deleteBlock = callbackBlock(page, 'handleDelete');
    expect(deleteBlock).toContain(
      'if (!visit.isActive() || !await flushPendingSaves())',
    );
    expect(deleteBlock).toContain('if (!visit.isActive()) return');
    expect(deleteBlock).toContain(
      'if (visit.isActive()) navigate("/admin")',
    );
    for (const [source, callback] of [
      [transcriptEditing, 'handleVerifyTranscript'],
      [transcriptEditing, 'handleTranscriptDoubleClick'],
      [photoDescriptionWorkspace, 'describe'],
      [photoDescriptionWorkspace, 'toggleVerification'],
    ] as const) {
      expect(callbackBlock(source, callback)).toContain(
        'await flushPendingSaves()',
      );
    }
    expect(autoSaveCoordinator).toContain(
      'if (!this.active || target.running) return',
    );
    expect(autoSaveCoordinator).toContain(
      '.sort((left, right) => left.sequence - right.sequence)[0]',
    );
    expect(callbackBlock(transcriptEditing, 'handleVerifyTranscript')).toContain(
      'setTranscript(updated.transcript.fullText)',
    );
    expect(callbackBlock(photoDescriptionWorkspace, 'toggleVerification')).toContain(
      'hydratePersistedLetter(updated)',
    );
    for (const callback of ['transcribe', 'toggleVerification']) {
      expect(callbackBlock(extraContentWorkspace, callback)).toContain(
        'hydratePersistedLetter(updatedLetter)',
      );
    }
  });

  it('routes transcript and metadata verification removal through that owner', async () => {
    const [transcriptEditing, metadataVerificationActions] = await Promise.all([
      readFile(transcriptEditingPath, 'utf8'),
      readFile(metadataVerificationActionsPath, 'utf8'),
    ]);

    const transcriptStart = transcriptEditing.indexOf(
      'const updated = await unverifyTranscript(',
    );
    expect(transcriptStart).toBeGreaterThan(-1);
    const transcriptBlock = transcriptEditing.slice(
      transcriptStart,
      transcriptEditing.indexOf('} finally {', transcriptStart),
    );
    expect(transcriptBlock).toContain('letter.primarySourceRevision');
    expect(transcriptBlock).toContain('handleMutationError(');

    const metadataBlock = callbackBlock(
      metadataVerificationActions,
      'handleMetadataFieldDoubleClick',
    );
    expect(metadataBlock).toContain('unverifyMetadata(');
    expect(metadataBlock).toContain('target.primarySourceRevision');
    expect(metadataBlock).toContain('executeLetterMutation({');
    expect(metadataBlock).not.toContain('handleMutationError(');
  });

  it('keeps metadata form state request-free and removes the hook-order bridge', async () => {
    const [page, metadataFormState, metadataVerificationActions] =
      await Promise.all([
        readFile(pagePath, 'utf8'),
        readFile(metadataFormStatePath, 'utf8'),
        readFile(metadataVerificationActionsPath, 'utf8'),
      ]);

    expect(metadataFormState).not.toContain('/api/');
    for (const dependency of [
      'LetterReviewVisit',
      'BeginLetterSaving',
      'ExecuteLetterReviewMutation',
      'handleMutationError',
      'showToast',
    ]) {
      expect(metadataFormState).not.toContain(dependency);
    }
    expect(metadataVerificationActions).toContain(
      'executeLetterMutation({',
    );
    expect(metadataVerificationActions).not.toContain(
      'applyLetterMetadata(',
    );
    expect(page).not.toContain('identityMetadataSyncRef');
    expect(page).not.toContain('syncIdentityMetadataForAutoSave');
    expect(page.indexOf('useMetadataFormState()')).toBeLessThan(
      page.indexOf('useAutoSave({'),
    );
    expect(page.indexOf('useLetterReviewMutationExecutor({')).toBeLessThan(
      page.indexOf('useMetadataVerificationActions({'),
    );
  });

  it('routes every line-review source write through that owner', async () => {
    const lineReview = await readFile(lineReviewPath, 'utf8');

    for (const fallback of [
      'Failed to save segment edits',
      'Failed to verify segments',
      'Failed to unverify segments',
    ]) {
      expect(lineReview).toContain(`handleMutationError(err, '${fallback}')`);
    }
    expect(lineReview).toContain(
      "handleMutationError(error, 'Failed to save segment mapping')",
    );
  });
});
