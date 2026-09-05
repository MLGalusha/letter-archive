import { expect, it } from 'vitest';
import { canonicalSettingKey, readAdminSiteSettings, readSiteSettings } from '../site-settings.js';

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
