import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReviewPage.tsx',
);
const workspacePath = path.resolve(
  process.cwd(),
  'src/pages/admin/LetterReview/useTranscriptConfirmationWorkspace.ts',
);

describe('Letter Review transcript confirmation ownership', () => {
  it('keeps one visit-owned workspace and one shared presentation boundary', async () => {
    const [page, workspace] = await Promise.all([
      readFile(pagePath, 'utf8'),
      readFile(workspacePath, 'utf8'),
    ]);

    expect(page).toContain('useTranscriptConfirmationWorkspace({');
    expect(page).toContain(
      'onClick={transcriptConfirmationWorkspace.openDialog}',
    );
    expect(page).toContain(
      'transcriptConfirmationWorkspace.openDialog',
    );
    expect(page).toContain(
      '{...transcriptConfirmationWorkspace.dialogProps}',
    );

    for (const retiredOwner of [
      'showTranscriptConfirmationPopup',
      'setShowTranscriptConfirmationPopup',
      'confirmationSender',
      'setConfirmationSender',
      'confirmationRecipient',
      'setConfirmationRecipient',
      'handleConfirmTranscript',
      'executeConfirmTranscript',
    ]) {
      expect(page).not.toContain(retiredOwner);
    }
    expect(page).not.toMatch(/\bconfirmTranscript\b/);

    expect(workspace).toContain('visit: LetterReviewVisit');
    expect(workspace).toContain('executeLetterMutation({');
    expect(workspace).toContain('confirmTranscript(');
    expect(workspace).toContain('letter.primarySourceRevision');
    expect(workspace).toContain(
      "'Transcript confirmed — metadata extracted'",
    );
    for (const competingOwner of [
      'beginSaving',
      'flushPendingSaves',
      'tryAdoptLetter',
      'hydrateAdoptedLetter',
      'handleMutationError',
    ]) {
      expect(workspace).not.toContain(competingOwner);
    }
  });
});
