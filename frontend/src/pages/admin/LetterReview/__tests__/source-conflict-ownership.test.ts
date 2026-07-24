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
const metadataEditingPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useMetadataEditing.ts',
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
      readFile(reviewableDynamicEditorPath, 'utf8'),
      readFile(mutationExecutorPath, 'utf8'),
      readFile(structuredNoteActionsPath, 'utf8'),
    ]);

    expect(page).toContain('useLetterSourceConflict(showToast, visit)');
    for (const callback of [
      'handleTranscribeLetter',
      'executeConfirmTranscript',
      'executeMetadataRegenerate',
      'handleReExtract',
      'handleDelete',
    ]) {
      expect(callbackBlock(page, callback)).toContain('handleMutationError(');
    }
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

  it('keys terminal and queued ownership to an opaque route visit', async () => {
    const [
      page,
      autoSave,
      sourceConflict,
      guardedLetterState,
      reviewVisit,
      autoSaveCoordinator,
      lineReview,
    ] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(autoSavePath, 'utf8'),
      readFile(sourceConflictPath, 'utf8'),
      readFile(guardedLetterStatePath, 'utf8'),
      readFile(reviewVisitPath, 'utf8'),
      readFile(autoSaveCoordinatorPath, 'utf8'),
      readFile(lineReviewPath, 'utf8'),
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
    expect(page).toMatch(
      /getAdminLetterById\(letterId\)\.then\(\(updated\) => \{[\s\S]*?setLetter\(updated\)/,
    );
    expect(page).toContain('window.location.reload();');
  });

  it('flushes pending lanes before source-dependent transitions', async () => {
    const [
      page,
      autoSave,
      transcriptEditing,
      metadataEditing,
      photoDescriptionWorkspace,
      extraContentWorkspace,
      readingViewWorkspace,
      autoSaveCoordinator,
      mutationExecutor,
      structuredNoteActions,
    ] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(autoSavePath, 'utf8'),
      readFile(transcriptEditingPath, 'utf8'),
      readFile(metadataEditingPath, 'utf8'),
      readFile(photoDescriptionWorkspacePath, 'utf8'),
      readFile(extraContentWorkspacePath, 'utf8'),
      readFile(readingViewWorkspacePath, 'utf8'),
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
    for (const callback of [
      'handleTranscribeLetter',
      'executeConfirmTranscript',
      'executeMetadataRegenerate',
      'handleReExtract',
    ]) {
      const block = callbackBlock(page, callback);
      expect(block).toContain('await flushPendingSaves()');
      expect(block).toContain(
        'if (!visit.isActive() || !await flushPendingSaves())',
      );
      expect(block).toContain('hydrateAdoptedLetter(');
    }
    expect(callbackBlock(readingViewWorkspace, 'generate')).toContain(
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
      [metadataEditing, 'handleVerifyMetadata'],
      [metadataEditing, 'handleMetadataFieldDoubleClick'],
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
    expect(callbackBlock(metadataEditing, 'handleVerifyMetadata')).toContain(
      'applyLetterMetadata(updated)',
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
    const [transcriptEditing, metadataEditing] = await Promise.all([
      readFile(transcriptEditingPath, 'utf8'),
      readFile(metadataEditingPath, 'utf8'),
    ]);

    for (const [source, mutation] of [
      [transcriptEditing, 'unverifyTranscript'],
      [metadataEditing, 'unverifyMetadata'],
    ] as const) {
      const start = source.indexOf(`const updated = await ${mutation}(`);
      expect(start).toBeGreaterThan(-1);
      const block = source.slice(start, source.indexOf('} finally {', start));
      expect(block).toContain('letter.primarySourceRevision');
      expect(block).toContain('handleMutationError(');
    }
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
