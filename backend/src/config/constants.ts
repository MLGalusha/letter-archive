/**
 * Centralized constants used across services and pipelines.
 */

/**
 * Maximum automatic retries for a job (transcription / metadata / entity extraction)
 * before the letter is flagged `dead_letter` and excluded from auto-pickup.
 * Manual retry from the admin UI clears the flag.
 */
export const MAX_JOB_ATTEMPTS = 3;
