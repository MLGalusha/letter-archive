import { env } from '../config/env.js';
import { notifyApiError } from './notifications.js';
import { hasActiveWorkerExecutionLease } from './worker-state.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'cloud-run-job' });

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

function getProjectId(): string | null {
  return env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT ?? null;
}

export function shouldUseCloudRunWorkerJob(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    Boolean(getProjectId()) &&
    Boolean(env.CLOUD_RUN_REGION) &&
    Boolean(env.CLOUD_RUN_WORKER_JOB_NAME)
  );
}

async function getAccessToken(): Promise<string> {
  const response = await fetch(METADATA_TOKEN_URL, {
    headers: { 'Metadata-Flavor': 'Google' },
  });

  if (!response.ok) {
    throw new Error(`Metadata server token request failed (${response.status})`);
  }

  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) {
    throw new Error('Metadata server returned no access token');
  }

  return payload.access_token;
}

let triggerInFlight: Promise<void> | null = null;

export async function triggerWorkerJob(reason: string): Promise<boolean> {
  if (!shouldUseCloudRunWorkerJob()) {
    return false;
  }

  if (triggerInFlight) {
    await triggerInFlight;
    return true;
  }

  const projectId = getProjectId();
  if (!projectId || !env.CLOUD_RUN_REGION || !env.CLOUD_RUN_WORKER_JOB_NAME) {
    return false;
  }

  triggerInFlight = (async () => {
    try {
      if (await hasActiveWorkerExecutionLease()) {
        log.info(
          {
            jobName: env.CLOUD_RUN_WORKER_JOB_NAME,
            region: env.CLOUD_RUN_REGION,
            reason,
          },
          'Skipping worker job trigger because another worker execution owns the lease',
        );
        return;
      }

      const accessToken = await getAccessToken();
      const url = `https://run.googleapis.com/v2/projects/${projectId}/locations/${env.CLOUD_RUN_REGION}/jobs/${env.CLOUD_RUN_WORKER_JOB_NAME}:run`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Cloud Run Job execute failed (${response.status}): ${body}`);
      }

      log.info(
        {
          jobName: env.CLOUD_RUN_WORKER_JOB_NAME,
          region: env.CLOUD_RUN_REGION,
          reason,
        },
        'Triggered Cloud Run worker job',
      );
    } catch (error) {
      log.error(
        {
          err: error,
          jobName: env.CLOUD_RUN_WORKER_JOB_NAME,
          region: env.CLOUD_RUN_REGION,
          reason,
        },
        'Failed to trigger Cloud Run worker job',
      );
      notifyApiError({
        service: 'cloud-run',
        endpoint: 'worker_job_execute',
        error,
      });
      throw error;
    }
  })().finally(() => {
    triggerInFlight = null;
  });

  await triggerInFlight;
  return true;
}
