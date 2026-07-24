import type { ParsedFilename } from "../../../utils/filename-parser";

export interface UploadedImage {
  id: string;
  file: File;
  url: string;
  originalFilename: string;
  parsed: ParsedFilename | null;
  isDuplicate: boolean;
  sourceExpectation: import("../../../api/admin").UploadSourceExpectation | null;
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
  mode: "organize" | "delete";
  selectedCollection: string | null;
  selectedImageIds: Set<string>;
  newCollectionCode: string;
  deletionImageIds: Set<string>;
}

export interface LightboxState {
  images: UploadedImage[];
  currentIndex: number;
}

export interface UploadProgress {
  current: number;
  total: number;
  collectionCode: string;
}

export interface UploadResultsState {
  uploaded: import("../../../api/admin").UploadResult[];
  replaced: import("../../../api/admin").UploadResult[];
  unchanged: import("../../../api/admin").UploadResult[];
  failed: import("../../../api/admin").UploadError[];
  show: boolean;
}

export interface DeleteDialogState {
  show: boolean;
  type: "collection" | "letter" | "image" | "bulk";
  collectionCode: string;
  letterKey?: string;
  imageId?: string;
  itemName: string;
}
