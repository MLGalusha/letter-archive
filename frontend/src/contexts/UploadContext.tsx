import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
  uploadFiles,
  type UploadResult,
  type UploadError,
  type UploadSourceExpectation,
} from '../api/admin';
import { ApiError } from '../api/client';
import { parseFilename } from '../utils/filename-parser';
import { useToast } from './ToastContext';

const BATCH_SIZE = 5;
const UPLOAD_SOURCE_REVISION_CHANGED_CODE = 'SOURCE_REVISION_CHANGED';
const SOURCE_CONFLICT_MESSAGE =
  'The archive source changed after duplicate confirmation. The file was kept; check duplicates again before choosing Replace.';

export interface QueuedFile {
  file: File;
  force: boolean;
  sourceExpectation: UploadSourceExpectation | null;
}

export type FileStatus = 'pending' | 'uploading' | 'success' | 'failed';

export interface FileProgress {
  filename: string;
  status: FileStatus;
  error?: string;
  result?: UploadResult;
}

export type UploadJobStatus = 'idle' | 'uploading' | 'complete';

export interface UploadJob {
  status: UploadJobStatus;
  files: FileProgress[];
  totalFiles: number;
  completedFiles: number;
  successCount: number;
  failedCount: number;
  results: UploadResult[];
  errors: UploadError[];
}

interface UploadContextValue {
  job: UploadJob | null;
  startUpload: (files: QueuedFile[]) => void;
  clearJob: () => void;
  isUploading: boolean;
}

const UploadContext = createContext<UploadContextValue | null>(null);

function makeInitialJob(files: QueuedFile[]): UploadJob {
  return {
    status: 'uploading',
    files: files.map(f => ({ filename: f.file.name, status: 'pending' as const })),
    totalFiles: files.length,
    completedFiles: 0,
    successCount: 0,
    failedCount: 0,
    results: [],
    errors: [],
  };
}

function correspondenceSourceKey(filename: string): string | null {
  const parsed = parseFilename(filename);
  if (!parsed) return null;
  return [
    parsed.collectionCode,
    parsed.dateRaw,
    parsed.typeSequence,
  ].join('\u0000');
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const [job, setJob] = useState<UploadJob | null>(null);
  const processingRef = useRef(false);

  const processQueue = useCallback(async (queued: QueuedFile[]) => {
    if (processingRef.current) return;
    processingRef.current = true;

    // Group by force flag so we batch new and replace files separately
    const newFiles = queued.filter(f => !f.force);
    const replaceFiles = queued.filter(f => f.force);
    const groups: { files: QueuedFile[]; force: boolean }[] = [];
    for (let i = 0; i < newFiles.length; i += BATCH_SIZE) {
      groups.push({ files: newFiles.slice(i, i + BATCH_SIZE), force: false });
    }
    // A force request is deliberately one file so a stale confirmation can
    // retain the normal HTTP 409 contract without hiding partial successes.
    for (const replaceFile of replaceFiles) {
      groups.push({ files: [replaceFile], force: true });
    }
    // Every committed page change advances the complete correspondence
    // source epoch. Preserve each page's frozen pointer/checksum expectation,
    // but carry a response's successor epoch into later files from the same
    // user-confirmed upload run so our own first replacement cannot make the
    // second one stale.
    const successorSourceRevisions = new Map<string, number>();

    for (const group of groups) {
      const batch = group.files;
      const force = group.force;
      const batchFilenames = new Set(batch.map(f => f.file.name));

      // Mark batch as uploading
      setJob(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          files: prev.files.map(f =>
            batchFilenames.has(f.filename) ? { ...f, status: 'uploading' as const } : f
          ),
        };
      });

      try {
        const sourceExpectations = force
          ? Object.fromEntries(batch.flatMap((queuedFile) => (
              queuedFile.sourceExpectation
                ? [[
                    queuedFile.file.name,
                    {
                      ...queuedFile.sourceExpectation,
                      primarySourceRevision:
                        successorSourceRevisions.get(
                          correspondenceSourceKey(queuedFile.file.name) ?? '',
                        )
                        ?? queuedFile.sourceExpectation.primarySourceRevision,
                    },
                  ] as const]
                : []
            )))
          : undefined;
        const response = await uploadFiles(
          batch.map(b => b.file),
          force,
          sourceExpectations,
        );
        for (const result of response.results) {
          // Only a source mutation committed by this upload establishes a
          // successor epoch. An unchanged success may merely observe another
          // writer's revision and must not silently refresh a force token.
          if (!result.changed) continue;
          const sourceKey = correspondenceSourceKey(result.filename);
          if (sourceKey) {
            successorSourceRevisions.set(
              sourceKey,
              result.primarySourceRevision,
            );
          }
        }

        const successNames = new Set(response.results.map(r => r.filename));
        const errorMap = new Map((response.errors ?? []).map(e => [e.filename, e.error]));
        if ((response.errors ?? []).some(
          (error) => error.code === UPLOAD_SOURCE_REVISION_CHANGED_CODE,
        )) {
          showToast(SOURCE_CONFLICT_MESSAGE, 'error');
        }

        setJob(prev => {
          if (!prev) return prev;
          const updatedFiles = prev.files.map(f => {
            if (!batchFilenames.has(f.filename)) return f;
            if (successNames.has(f.filename)) {
              return { ...f, status: 'success' as const, result: response.results.find(r => r.filename === f.filename) };
            }
            if (errorMap.has(f.filename)) {
              return { ...f, status: 'failed' as const, error: errorMap.get(f.filename) };
            }
            return { ...f, status: 'success' as const };
          });
          return {
            ...prev,
            files: updatedFiles,
            completedFiles: updatedFiles.filter(f => f.status === 'success' || f.status === 'failed').length,
            successCount: updatedFiles.filter(f => f.status === 'success').length,
            failedCount: updatedFiles.filter(f => f.status === 'failed').length,
            results: [...prev.results, ...response.results],
            errors: [...prev.errors, ...(response.errors ?? [])],
          };
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Upload failed';
        const errorCode = err instanceof ApiError ? err.code : undefined;
        if (errorCode === UPLOAD_SOURCE_REVISION_CHANGED_CODE) {
          showToast(SOURCE_CONFLICT_MESSAGE, 'error');
        }
        setJob(prev => {
          if (!prev) return prev;
          const updatedFiles = prev.files.map(f =>
            batchFilenames.has(f.filename) ? { ...f, status: 'failed' as const, error: errorMsg } : f
          );
          return {
            ...prev,
            files: updatedFiles,
            completedFiles: updatedFiles.filter(f => f.status === 'success' || f.status === 'failed').length,
            successCount: updatedFiles.filter(f => f.status === 'success').length,
            failedCount: updatedFiles.filter(f => f.status === 'failed').length,
            errors: [
              ...prev.errors,
              ...batch.map(b => ({
                filename: b.file.name,
                error: errorMsg,
                ...(errorCode ? { code: errorCode } : {}),
              })),
            ],
          };
        });
      }
    }

    // Mark complete
    setJob(prev => prev ? { ...prev, status: 'complete' } : prev);
    processingRef.current = false;
  }, [showToast]);

  const startUpload = useCallback((files: QueuedFile[]) => {
    if (processingRef.current || files.length === 0) return;
    setJob(makeInitialJob(files));
    processQueue(files);
  }, [processQueue]);

  const clearJob = useCallback(() => {
    if (!processingRef.current) setJob(null);
  }, []);

  const isUploading = job?.status === 'uploading';

  return (
    <UploadContext.Provider value={{ job, startUpload, clearJob, isUploading }}>
      {children}
    </UploadContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within UploadProvider');
  return ctx;
}
