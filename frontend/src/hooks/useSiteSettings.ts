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

export function useSiteSettings(): SiteSettings | null {
  const [settings, setSettings] = useState<SiteSettings | null>(cachedSettings);

  useEffect(() => {
    if (cachedSettings) return;
    apiGet<SiteSettings>('/settings/public')
      .then((data) => {
        cachedSettings = data;
        setSettings(data);
      })
      .catch(() => {});
  }, []);

  return settings;
}
