import { apiGet } from '../api/client';

export interface SiteSettings {
  [key: string]: string | undefined;
  site_title?: string;
  site_description?: string;
  donate_onetime_url?: string;
  donate_monthly_url?: string;
  contact_general_email?: string;
  contact_contribute_email?: string;
  contact_research_email?: string;
  contact_volunteer_email?: string;
}

export let cachedSettings: SiteSettings | null = null;
let pendingFetch: Promise<SiteSettings> | null = null;

export function fetchSettings(): Promise<SiteSettings> {
  if (cachedSettings) return Promise.resolve(cachedSettings);
  if (pendingFetch) return pendingFetch;
  const request = apiGet<SiteSettings>('/settings/public')
    .then((data) => {
      if (pendingFetch === request) cachedSettings = data;
      return data;
    })
    .finally(() => { if (pendingFetch === request) pendingFetch = null; });
  pendingFetch = request;
  return request;
}

export function invalidateSiteSettings() {
  cachedSettings = null;
  pendingFetch = null;
}
