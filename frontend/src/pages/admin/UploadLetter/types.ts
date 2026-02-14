import type { ParsedFilename } from "../../../utils/filename-parser";

export interface UploadedImage {
  id: string;
  file: File;
  url: string;
  originalFilename: string;
  parsed: ParsedFilename | null;
}

export interface LetterGroup {
  letterKey: string;
  dateRaw: string;
  letterDate: string | null;
  letterPageCount: number;
  extraCount: number;
  images: UploadedImage[];
}

export interface CollectionGroup {
  collectionCode: string;
  letters: LetterGroup[];
  totalImages: number;
  dateRange: string;
}

export interface EditState {
  active: boolean;
  selectedCollection: string | null;
  selectedImageIds: Set<string>;
  newCollectionCode: string;
}

export interface LightboxState {
  images: UploadedImage[];
  currentIndex: number;
}
