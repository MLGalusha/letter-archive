/** Production comparisons require a verifiable revision; local previews may lack one. */
export async function readFrontendRelease(base, { required, fetcher = fetch }) {
  try {
    const response = await fetcher(`${base}/version.json`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Version endpoint returned ${response.status}`);
    const value = await response.json();
    if (typeof value?.releaseSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.releaseSha)) throw new Error('Invalid release revision');
    return { releaseSha: value.releaseSha };
  } catch (cause) {
    if (required) throw new Error('Cannot verify production revision; aborting benchmark', { cause });
    return null;
  }
}

export function cacheDescription(reuseContext) {
  return reuseContext
    ? 'shared context per viewport/path; first visit fresh, later visits reuse browser cache; origin cache uncontrolled'
    : 'fresh browser context per run; origin cache uncontrolled';
}
