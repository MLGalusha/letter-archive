// A bounded recovery window for transient image overload/network failures.
// Keep the same URL and resolution so retrying cannot download an original scan.
export const IMAGE_RETRY_DELAYS_MS = [1000, 2000] as const;
