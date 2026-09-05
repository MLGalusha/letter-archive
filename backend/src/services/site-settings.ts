const LEGACY_KEYS: Record<string, string> = {
  siteTitle: 'site_title', siteDescription: 'site_description',
  donationOneTimeUrl: 'donate_onetime_url', donationMonthlyUrl: 'donate_monthly_url',
  contactGeneral: 'contact_general_email', contactContribute: 'contact_contribute_email',
  contactResearch: 'contact_research_email', contactVolunteer: 'contact_volunteer_email',
};

export function canonicalSettingKey(key: string): string {
  return LEGACY_KEYS[key] ?? key;
}

/** Resolve old admin aliases without discarding a more recent saved value. */
export function readSiteSettings(rows: Array<{ key: string; value: string; updatedAt: Date | string }>) {
  const settings: Record<string, string> = {};
  const ordered = [...rows].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  for (const row of ordered) settings[canonicalSettingKey(row.key)] = row.value;
  return settings;
}

/** Existing admin bundles still read camelCase fields during rolling releases. */
export function readAdminSiteSettings(rows: Parameters<typeof readSiteSettings>[0]) {
  const settings = readSiteSettings(rows);
  for (const [legacy, canonical] of Object.entries(LEGACY_KEYS)) {
    if (canonical in settings) settings[legacy] = settings[canonical];
  }
  return settings;
}
