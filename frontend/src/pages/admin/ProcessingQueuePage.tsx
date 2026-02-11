import { useState, useEffect, useCallback } from 'react';
import {
  getProcessingStatus,
  startTranscription,
  startMetadataExtraction,
  pauseProcessing,
  resumeProcessing,
  abortProcessing,
  type ProcessingStatus,
} from '../../api/admin';
import { Button } from '../../components/common';
import { useToast } from '../../contexts/ToastContext';
import './ProcessingQueuePage.css';

export default function ProcessingQueuePage() {
  const { showToast } = useToast();
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getProcessingStatus();
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch processing status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll for status updates
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleStartTranscription = async () => {
    try {
      const result = await startTranscription();
      showToast(`Started transcription for ${result.total} letters`, 'success');
      fetchStatus();
    } catch (err) {
      showToast('Failed to start transcription', 'error');
    }
  };

  const handleStartMetadata = async () => {
    try {
      const result = await startMetadataExtraction();
      showToast(`Started metadata extraction for ${result.total} letters`, 'success');
      fetchStatus();
    } catch (err) {
      showToast('Failed to start metadata extraction', 'error');
    }
  };

  const handlePause = async () => {
    try {
      await pauseProcessing();
      showToast('Processing paused', 'info');
      fetchStatus();
    } catch (err) {
      showToast('Failed to pause processing', 'error');
    }
  };

  const handleResume = async () => {
    try {
      await resumeProcessing();
      showToast('Processing resumed', 'success');
      fetchStatus();
    } catch (err) {
      showToast('Failed to resume processing', 'error');
    }
  };

  const handleAbort = async () => {
    try {
      await abortProcessing();
      showToast('Processing aborted', 'warning');
      fetchStatus();
    } catch (err) {
      showToast('Failed to abort processing', 'error');
    }
  };

  if (loading) {
    return (
      <div className="processing-queue-page">
        <div className="loading-state">Loading processing status...</div>
      </div>
    );
  }

  const isIdle = !status?.isRunning && !status?.isPaused;
  const progress = status?.total ? Math.round((status.completed / status.total) * 100) : 0;

  return (
    <div className="processing-queue-page">
      {/* Status Card */}
      <div className="status-card">
        <div className="status-header">
          <h2>Processing Status</h2>
          <span className={`status-badge ${status?.isRunning ? 'running' : status?.isPaused ? 'paused' : 'idle'}`}>
            {status?.isRunning ? 'Running' : status?.isPaused ? 'Paused' : 'Idle'}
          </span>
        </div>

        {status?.currentJob && (
          <div className="current-job">
            <span className="job-label">Current Job:</span>
            <span className="job-type">{status.currentJob.type}</span>
            <span className="job-id">{status.currentJob.letterId.slice(0, 8)}...</span>
          </div>
        )}

        {status?.total ? (
          <div className="progress-section">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-stats">
              <span>{status.completed} / {status.total} completed</span>
              <span>{status.failed} failed</span>
            </div>
          </div>
        ) : null}

        {/* Action Buttons */}
        <div className="action-buttons">
          {isIdle ? (
            <>
              <Button onClick={handleStartTranscription}>
                Start Transcription
              </Button>
              <Button onClick={handleStartMetadata} variant="secondary">
                Start Metadata Extraction
              </Button>
            </>
          ) : (
            <>
              {status?.isPaused ? (
                <Button onClick={handleResume}>Resume</Button>
              ) : (
                <Button onClick={handlePause} variant="secondary">Pause</Button>
              )}
              <Button onClick={handleAbort} variant="danger">Abort</Button>
            </>
          )}
        </div>
      </div>

      {/* Error Log */}
      {status?.errors && status.errors.length > 0 && (
        <div className="error-card">
          <h3>Recent Errors ({status.errors.length})</h3>
          <div className="error-list">
            {status.errors.map((error, index) => (
              <div key={index} className="error-item">{error}</div>
            ))}
          </div>
        </div>
      )}

      {/* Help Text */}
      <div className="help-card">
        <h3>About Processing</h3>
        <ul>
          <li><strong>Transcription:</strong> Converts letter images to text using AI vision</li>
          <li><strong>Metadata Extraction:</strong> Extracts sender, recipient, date, and other metadata from transcripts</li>
          <li>Processing runs in the background and can be paused or stopped at any time</li>
          <li>Letters with EMPTY transcripts are eligible for transcription</li>
          <li>Letters with completed transcripts but EMPTY metadata are eligible for extraction</li>
        </ul>
      </div>
    </div>
  );
}
