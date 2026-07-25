import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = (relativePath: string) => path.resolve(
  process.cwd(),
  'src',
  relativePath,
);

describe('Line Review workspace ownership', () => {
  it('keeps visit-bearing Line Review state out of the route', async () => {
    const [page, workspace] = await Promise.all([
      readFile(sourcePath('pages/admin/LetterReviewPage.tsx'), 'utf8'),
      readFile(
        sourcePath('pages/admin/LetterReview/useLineReviewWorkspace.ts'),
        'utf8',
      ),
    ]);

    expect(page).toContain('useLineReviewWorkspace({');
    expect(page).toContain('active: lineReviewActive');
    expect(page).toContain('modeProps: lineReviewModeProps');
    expect(page).toContain('viewerProps: lineReviewViewerProps');
    expect(page).toContain(
      'onClick={lineReviewHeaderControls.toggleDebugMode}',
    );
    expect(page).toContain(
      'onClick={lineReviewHeaderControls.reloadSegments}',
    );
    expect(page).toContain(
      'disabled={lineReviewHeaderControls.reloadDisabled}',
    );

    for (const stateName of [
      'currentFilename',
      'reviewMode',
      'segmentFirstMode',
      'debugMode',
      'viewerPageIndex',
      'selectedText',
      'mappingText',
      'currentLineIndex',
    ]) {
      expect(page).not.toMatch(new RegExp(
        `const \\[\\s*${stateName}\\b[^\\]]*\\]\\s*=\\s*useState`,
      ));
    }

    for (const removedOwner of [
      'segmentFirstTriggeredRef',
      'setReviewMode(',
      'setSegmentFirstMode(',
      'setDebugMode(',
      'setViewerPageIndex(',
      'setSelectedText(',
      'setMappingText(',
      'setCurrentFilename(',
      'setCurrentLineIndex(',
    ]) {
      expect(page).not.toContain(removedOwner);
    }

    expect(page).not.toContain('addEventListener("selectionchange"');
    expect(page).not.toContain('window.getSelection()');
    expect(page).not.toContain('const handleImageClick =');
    expect(page).not.toContain(
      'const handleTranscriptFromLineReview =',
    );
    expect(page).not.toContain('const handleLineReviewAutoSave =');
    expect(page).not.toContain('LineReviewModeHandle');
    expect(page).not.toContain('lineReviewRef');
    expect(page).not.toMatch(
      /getAdminLetterById\(letterId\)\.then[\s\S]*?setLetter\(updated\)/,
    );

    expect(workspace).toContain('visit: LetterReviewVisit');
    expect(workspace).toContain('interface LineReviewEntryOwner');
    expect(workspace).toContain('LineReviewModeHandle');
    expect(workspace).toContain('visit.isActive()');
    expect(workspace).toContain(
      'current.entry.owner === mappingOwner',
    );
    expect(workspace).toContain(
      'mappingOwner.isCurrentRefresh(refresh)',
    );
    expect(workspace).toContain('tryAdoptLetter(updated');
    expect(workspace).toContain('addEventListener("selectionchange"');
  });
});
