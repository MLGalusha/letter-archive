import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFile(
  path.resolve(process.cwd(), 'src/pages/admin/LetterReview', file),
  'utf8',
);

describe('Letter Review analysis regeneration ownership', () => {
  it('keeps one visit-owned workspace and one dedicated dialog boundary', async () => {
    const [
      page,
      workspace,
      statusResets,
    ] = await Promise.all([
      readFile(
        path.resolve(
          process.cwd(),
          'src/pages/admin/LetterReviewPage.tsx',
        ),
        'utf8',
      ),
      source('useAnalysisRegenerationWorkspace.ts'),
      source('useLetterReviewStatusResets.ts'),
    ]);

    expect(page).toContain('useAnalysisRegenerationWorkspace({');
    expect(page).toContain(
      '<AnalysisRegenerationDialog',
    );
    expect(page).toContain(
      '{...analysisRegenerationWorkspace.metadataSectionProps}',
    );
    expect(page).toContain(
      '{...analysisRegenerationWorkspace.entitySectionProps}',
    );
    expect(page).toContain(
      '{...analysisRegenerationWorkspace.dialogProps}',
    );

    for (const retiredOwner of [
      'showMetadataRegeneratePopup',
      'regenerateState',
      'entityReExtractState',
      'reExtractState',
      'setReExtractState',
      'executeMetadataRegenerate',
      'handleRegenerateMetadata',
      'handleReExtractEntities',
      'const handleReExtract',
    ]) {
      expect(page).not.toContain(retiredOwner);
    }
    expect(page).not.toMatch(/\bregenerateMetadata\b/);
    expect(page).not.toMatch(/\breExtractLetter\b/);
    expect(page).toContain('confirmationSender');
    expect(page).toContain('confirmationRecipient');
    expect(page).not.toContain('extractionSender');
    expect(page).not.toContain('extractionRecipient');

    expect(workspace).toContain('executeLetterMutation({');
    expect(workspace).toContain('regenerateMetadata(');
    expect(workspace).toContain('reExtractLetter(');
    expect(workspace).not.toContain("mode: 'metadata_only'");
    expect(workspace).not.toContain('flushPendingSaves');
    expect(workspace).not.toContain('tryAdoptLetter');
    expect(workspace).not.toContain('hydrateAdoptedLetter');
    expect(workspace).not.toContain('handleMutationError');

    expect(statusResets).not.toContain('metadata-reextract');
  });
});
