-- The original admin UI wrote custom titles under siteTitle. Preserve those.
-- The previous public header already displays Voices That Remain.
-- Keep updated_at unchanged so a newer legacy customization retains precedence.
UPDATE site_settings
SET value = 'Voices That Remain'
WHERE key = 'site_title' AND value = 'Letter Archive'
  AND NOT EXISTS (SELECT 1 FROM site_settings WHERE key = 'siteTitle');
--> statement-breakpoint
UPDATE site_settings
SET value = 'A digital archive of personal letters and historical correspondence, preserved for future generations.'
WHERE key = 'site_description'
  AND value = 'A digital archive preserving personal letters and historical correspondence.'
  AND NOT EXISTS (SELECT 1 FROM site_settings WHERE key = 'siteDescription');
