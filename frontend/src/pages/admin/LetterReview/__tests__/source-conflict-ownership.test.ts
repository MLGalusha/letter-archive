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
const photoDescriptionSectionPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/PhotoDescriptionSection.tsx',
);
const extraContentSectionPath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/ExtraContentSection.tsx',
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
      photoDescriptionSection,
      extraContentSection,
      reviewableDynamicEditor,
    ] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(photoDescriptionSectionPath, 'utf8'),
      readFile(extraContentSectionPath, 'utf8'),
      readFile(reviewableDynamicEditorPath, 'utf8'),
    ]);

    expect(page).toContain('useLetterSourceConflict(showToast, {');
    for (const callback of [
      'handleDescribePhoto',
      'handleTranscribeLetter',
      'handleTranscribeExtrasWithConfirm',
      'handleVisibilityChange',
      'handleContentPublishToggle',
      'executeConfirmTranscript',
      'executeMetadataRegenerate',
      'handleReExtract',
      'handleVerifyPhotoDescription',
      'handleUnverifyPhotoDescription',
      'handleVerifyExtraContent',
      'handleUnverifyExtraContent',
      'handleGenerateReadingView',
      'handleDelete',
      'handleNoteStatusChange',
      'handleAddNote',
    ]) {
      expect(callbackBlock(page, callback)).toContain('handleMutationError(');
    }
    expect(callbackBlock(page, 'handleDelete')).toContain(
      'deleteLetter(letterId, primarySourceRevision)',
    );
    for (const callback of ['handleNoteStatusChange', 'handleAddNote']) {
      expect(callbackBlock(page, callback)).toContain(
        'letter.primarySourceRevision',
      );
    }
    expect(photoDescriptionSection).toContain(
      'onRequestEdit={onVerifyPhotoDescription}',
    );
    expect(extraContentSection).toContain(
      'onRequestEdit={onVerifyExtraContent}',
    );
    expect(page).toMatch(
      /<PhotoDescriptionSection[\s\S]*?onVerifyPhotoDescription=\{[\s\S]*?handleUnverifyPhotoDescription[\s\S]*?: handleVerifyPhotoDescription/,
    );
    expect(page).toMatch(
      /<ExtraContentSection[\s\S]*?onVerifyExtraContent=\{[\s\S]*?handleUnverifyExtraContent[\s\S]*?: handleVerifyExtraContent/,
    );
    expect(reviewableDynamicEditor).toContain('if (!verified) return');
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

  it('keys terminal state to the letter and stops queued writers', async () => {
    const [
      page,
      autoSave,
      sourceConflict,
      guardedLetterState,
      lineReview,
    ] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(autoSavePath, 'utf8'),
      readFile(sourceConflictPath, 'utf8'),
      readFile(guardedLetterStatePath, 'utf8'),
      readFile(lineReviewPath, 'utf8'),
    ]);

    expect(page).toContain('useLetterSourceConflict(showToast, {');
    expect(page).toContain('letterId,');
    expect(page).not.toContain(
      'primarySourceRevision: letter?.primarySourceRevision',
    );
    expect(sourceConflict).toContain('identityKey');
    expect(sourceConflict).toContain("const identityKey = identity.letterId ?? ''");
    expect(sourceConflict).toContain(
      'previousIdentityKeyRef.current === identityKey',
    );
    expect(sourceConflict).toContain('setConflictState(null)');
    expect(sourceConflict).toContain('markSourceConflict');
    expect(sourceConflict).toContain(
      'conflictState?.identityKey === identityKey',
    );
    expect(sourceConflict).toContain('conflictStateRef.current');
    expect(page).toContain(
      'useGuardedLetterState(markSourceConflict, letterId)',
    );
    expect(page.match(/setAuthoritativeLetter\(/g)).toHaveLength(1);
    expect(page).toContain('loadCurrentLetter({');
    expect(page).toContain('isCurrent: () => requestIsCurrent');
    expect(page).toContain('requestIsCurrent = false');
    expect(guardedLetterState).toContain('activeLetterIdRef.current');
    expect(guardedLetterState).toContain(
      'currentLetter.primarySourceRevision',
    );
    expect(guardedLetterState).toContain(
      '!== nextLetter.primarySourceRevision',
    );
    expect(guardedLetterState).toContain(
      'markSourceConflict(SOURCE_REFRESH_CONFLICT)',
    );
    expect(autoSave).toContain('if (isMutationBlocked()) return');
    expect(autoSave).toContain('if (!mutationsBlocked) return');
    expect(lineReview).toContain('mutationsBlockedRef.current');
    expect(lineReview).toContain('clearTimeout(autoSaveTimerRef.current)');
    expect(page).toContain('toggleLetterFlag(letter.id, newFlagged)');
    expect(page).toMatch(
      /getAdminLetterById\(letterId\)\.then\(\(updated\) => \{[\s\S]*?setLetter\(updated\)/,
    );
    expect(page).toContain('window.location.reload();');
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
