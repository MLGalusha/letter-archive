import { useState, useEffect } from 'react';
import { apiGet } from '../api/client';

export interface SiteSettings {
  site_title?: string;
  site_description?: string;
  donate_onetime_url?: string;
  donate_monthly_url?: string;
  contact_general_email?: string;
  contact_contribute_email?: string;
  contact_research_email?: string;
  contact_volunteer_email?: string;
}

let cachedSettings: SiteSettings | null = null;
let pendingFetch: Promise<SiteSettings> | null = null;

function fetchSettings(): Promise<SiteSettings> {
  if (cachedSettings) return Promise.resolve(cachedSettings);
  if (pendingFetch) return pendingFetch;
  pendingFetch = apiGet<SiteSettings>('/settings/public')
    .then((data) => {
      cachedSettings = data;
      pendingFetch = null;
      return data;
    })
    .catch((err) => {
      pendingFetch = null;
      throw err;
    });
  return pendingFetch;
}

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
