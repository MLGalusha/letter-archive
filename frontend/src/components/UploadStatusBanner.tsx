import { useEffect, useRef } from 'react';
import { useUpload } from '../contexts/UploadContext';
import './UploadStatusBanner.css';

export default function UploadStatusBanner() {
  const { job, clearJob } = useUpload();
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (job?.status === 'complete' && job.failedCount === 0) {
      dismissTimer.current = setTimeout(clearJob, 10_000);
    }
    return () => { if (dismissTimer.current) clearTimeout(dismissTimer.current); };
  }, [job?.status, job?.failedCount, clearJob]);

  if (!job || job.status === 'idle') return null;

  const pct = job.totalFiles > 0 ? Math.round((job.completedFiles / job.totalFiles) * 100) : 0;
  const isComplete = job.status === 'complete';
  const hasFailures = job.failedCount > 0;

  const className = [
    'upload-status-banner',
    isComplete ? 'complete' : '',
    hasFailures ? 'has-failures' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <div className="banner-info">
        <div className="banner-text">
          {isComplete
            ? `Upload complete — ${job.successCount} succeeded${hasFailures ? `, ${job.failedCount} failed` : ''}`
            : `Uploading ${job.completedFiles} of ${job.totalFiles} files…`
          }
        </div>
        {!isComplete && (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {isComplete && (
        <button className="dismiss-btn" onClick={clearJob}>Dismiss</button>
      )}
    </div>
  );
}
