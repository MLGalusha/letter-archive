import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = (relativePath: string) => path.resolve(
  process.cwd(),
  "src",
  relativePath,
);

describe("reviewable dynamic editor ownership", () => {
  it("keeps verified editor mechanics out of the Letter Review route", async () => {
    const page = await readFile(
      sourcePath("pages/admin/LetterReviewPage.tsx"),
      "utf8",
    );

    for (const removedOwner of [
      "DynamicEditorRef",
      "useTooltip",
      "photoDescriptionRef",
      "extraContentRef",
      "handlePhotoDescriptionKeyDown",
      "handlePhotoDescriptionClick",
      "handlePhotoDescriptionDoubleClick",
      "handleExtraContentKeyDown",
      "handleExtraContentClick",
      "handleExtraContentDoubleClick",
    ]) {
      expect(page).not.toContain(removedOwner);
    }

    expect(page).toMatch(
      /const handleImageClick[\s\S]*?isPhotoDescriptionEditing[\s\S]*?isExtraContentEditing/,
    );
  });

  it("shares one UI-only interaction owner across both domain sections", async () => {
    const [reviewableEditor, photoSection, extraSection] = await Promise.all([
      readFile(
        sourcePath("pages/admin/LetterReview/ReviewableDynamicEditor.tsx"),
        "utf8",
      ),
      readFile(
        sourcePath("pages/admin/LetterReview/PhotoDescriptionSection.tsx"),
        "utf8",
      ),
      readFile(
        sourcePath("pages/admin/LetterReview/ExtraContentSection.tsx"),
        "utf8",
      ),
    ]);

    expect(photoSection).toContain("<ReviewableDynamicEditor");
    expect(extraSection).toContain("<ReviewableDynamicEditor");
    expect(reviewableEditor).toContain("useTooltip()");
    expect(reviewableEditor).toContain(
      'document.execCommand("insertText", false, "    ")',
    );
    expect(reviewableEditor).not.toMatch(/api\/|primarySourceRevision|setLetter/);
  });

  it("removes the unused imperative DynamicEditor contract", async () => {
    const [dynamicEditor, commonExports] = await Promise.all([
      readFile(sourcePath("components/common/DynamicEditor.tsx"), "utf8"),
      readFile(sourcePath("components/common/index.ts"), "utf8"),
    ]);

    expect(dynamicEditor).not.toMatch(
      /forwardRef|useImperativeHandle|DynamicEditorRef/,
    );
    expect(commonExports).not.toContain("DynamicEditorRef");
  });
});
