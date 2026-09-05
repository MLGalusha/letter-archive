import { expect, it } from 'vitest';
import { canonicalSettingKey, readAdminSiteSettings, readSiteSettings, siteSettingWrites } from '../site-settings.js';

it('preserves the newest value across legacy admin aliases and public keys', () => {
  expect(readSiteSettings([
    { key: 'siteTitle', value: 'Saved title', updatedAt: '2026-09-02' },
    { key: 'site_title', value: 'Seeded title', updatedAt: '2026-09-01' },
    { key: 'contactGeneral', value: 'old@example.test', updatedAt: '2026-09-01' },
    { key: 'contact_general_email', value: 'new@example.test', updatedAt: '2026-09-03' },
  ])).toEqual({ site_title: 'Saved title', contact_general_email: 'new@example.test' });
});

it('normalizes legacy writes while preserving unrelated settings', () => {
  expect(canonicalSettingKey('siteTitle')).toBe('site_title');
  expect(canonicalSettingKey('auto_transcribe')).toBe('auto_transcribe');
});

it('keeps old admin bundles populated through a rolling backend release', () => {
  expect(readAdminSiteSettings([
    { key: 'site_title', value: 'Current title', updatedAt: '2026-09-02' },
    { key: 'siteTitle', value: 'Previous title', updatedAt: '2026-09-01' },
    { key: 'contact_general_email', value: 'contact@example.test', updatedAt: '2026-09-02' },
  ])).toEqual({
    site_title: 'Current title', siteTitle: 'Current title',
    contact_general_email: 'contact@example.test', contactGeneral: 'contact@example.test',
  });
});

it('normalizes untouched seeds in responses without mutating stored rows', () => {
  const rows = [
    { key: 'site_title', value: 'Letter Archive', updatedAt: '2026-09-01' },
    { key: 'site_description', value: 'A digital archive preserving personal letters and historical correspondence.', updatedAt: '2026-09-01' },
  ];
  expect(readSiteSettings(rows)).toEqual({
    site_title: 'Voices That Remain',
    site_description: 'A digital archive of personal letters and historical correspondence, preserved for future generations.',
  });
  expect(rows[0].value).toBe('Letter Archive');
});

it('preserves an explicit choice of old default text in either admin client', () => {
  for (const key of ['site_title', 'siteTitle']) {
    const writes = siteSettingWrites({ [key]: 'Letter Archive' });
    expect(writes).toEqual([{ key: 'site_title', value: 'Letter Archive' }, { key: 'siteTitle', value: 'Letter Archive' }]);
    expect(readSiteSettings(writes.map((row) => ({ ...row, updatedAt: '2026-09-04' })))).toEqual({ site_title: 'Letter Archive' });
  }
});

it('deduplicates mixed-client writes and leaves unrelated settings alone', () => {
  expect(siteSettingWrites({ site_title: 'Old', siteTitle: 'Edited', auto_transcribe: 'false' })).toEqual([
    { key: 'site_title', value: 'Edited' }, { key: 'siteTitle', value: 'Edited' },
    { key: 'auto_transcribe', value: 'false' },
  ]);
});
