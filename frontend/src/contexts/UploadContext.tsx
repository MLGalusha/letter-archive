import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { uploadFiles, type UploadResult, type UploadError } from '../api/admin';

const BATCH_SIZE = 5;

export interface QueuedFile {
  file: File;
  force: boolean;
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

export function UploadProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<UploadJob | null>(null);
  const processingRef = useRef(false);

  const processQueue = useCallback(async (queued: QueuedFile[]) => {
    if (processingRef.current) return;
    processingRef.current = true;

    // Group by force flag so we batch new and replace files separately
    const newFiles = queued.filter(f => !f.force);
    const replaceFiles = queued.filter(f => f.force);
    const ordered = [...newFiles, ...replaceFiles];

    for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
      const batch = ordered.slice(i, i + BATCH_SIZE);
      const force = batch[0].force;
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
        const response = await uploadFiles(batch.map(b => b.file), force);

        const successNames = new Set(response.results.map(r => r.filename));
        const errorMap = new Map((response.errors ?? []).map(e => [e.filename, e.error]));

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
            errors: [...prev.errors, ...batch.map(b => ({ filename: b.file.name, error: errorMsg }))],
          };
        });
      }
    }

    // Mark complete
    setJob(prev => prev ? { ...prev, status: 'complete' } : prev);
    processingRef.current = false;
  }, []);

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

export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within UploadProvider');
  return ctx;
}
