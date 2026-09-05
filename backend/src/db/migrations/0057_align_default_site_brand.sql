-- The original admin UI wrote custom titles under siteTitle. Preserve those.
-- The previous public header already displays Voices That Remain.
-- Keep updated_at unchanged so a newer legacy customization retains precedence.
UPDATE site_settings
SET value = 'Voices That Remain'
WHERE key = 'site_title' AND value = 'Letter Archive'
  AND NOT EXISTS (SELECT 1 FROM site_settings WHERE key = 'siteTitle');
