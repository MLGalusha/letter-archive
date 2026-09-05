import { useState, useEffect } from 'react';
import { cachedSettings, fetchSettings, type SiteSettings } from '../services/siteSettings';
export type { SiteSettings } from '../services/siteSettings';

export function useSiteSettings(): SiteSettings | null {
  const [settings, setSettings] = useState<SiteSettings | null>(cachedSettings);

  useEffect(() => {
    if (cachedSettings) return;
    fetchSettings()
      .then(setSettings)
      .catch((err) => console.warn('[SiteSettings] Failed to load:', err));
  }, []);

  return settings;
}
