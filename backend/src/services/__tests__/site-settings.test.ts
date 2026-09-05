import { expect, it } from 'vitest';
import { canonicalSettingKey, readSiteSettings } from '../site-settings.js';

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
