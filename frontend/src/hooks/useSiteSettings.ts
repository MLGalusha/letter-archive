import { useEffect, useSyncExternalStore } from 'react';
import { fetchSettings, getCachedSettings, subscribeToSettings, type SiteSettings } from '../services/siteSettings';
export type { SiteSettings } from '../services/siteSettings';

const getServerSettings = () => null;

export function useSiteSettings(): SiteSettings | null {
  const settings = useSyncExternalStore(subscribeToSettings, getCachedSettings, getServerSettings);
  useEffect(() => {
    fetchSettings().catch((err) => console.warn('[SiteSettings] Failed to load:', err));
  }, []);
  return settings;
}
