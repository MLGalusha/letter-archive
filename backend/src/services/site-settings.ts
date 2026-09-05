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
  // A legacy alias records an explicit admin choice. Preserve it even when
  // the chosen text matches an obsolete seed; normalize only untouched defaults.
  if (!rows.some((row) => row.key === 'siteTitle') && settings.site_title === 'Letter Archive') {
    settings.site_title = 'Voices That Remain';
  }
  if (!rows.some((row) => row.key === 'siteDescription') && settings.site_description === 'A digital archive preserving personal letters and historical correspondence.') {
    settings.site_description = 'A digital archive of personal letters and historical correspondence, preserved for future generations.';
  }
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

/** Mirror aliases so older clients and explicit choices remain compatible. */
export function siteSettingWrites(input: Record<string, string>) {
  const canonical = new Map(Object.entries(input).map(([key, value]) => [canonicalSettingKey(key), value]));
  return [...canonical].flatMap(([key, value]) => {
    const alias = Object.entries(LEGACY_KEYS).find(([, target]) => target === key)?.[0];
    return alias ? [{ key, value }, { key: alias, value }] : [{ key, value }];
  });
}
