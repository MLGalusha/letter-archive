CREATE TABLE IF NOT EXISTS "site_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Seed defaults
INSERT INTO "site_settings" ("key", "value") VALUES
  ('site_title', 'Letter Archive'),
  ('site_description', 'A digital archive preserving personal letters and historical correspondence.'),
  ('donate_onetime_url', ''),
  ('donate_monthly_url', ''),
  ('contact_general_email', 'info@letterarchive.org'),
  ('contact_contribute_email', 'contribute@letterarchive.org'),
  ('contact_research_email', 'research@letterarchive.org'),
  ('contact_volunteer_email', 'volunteer@letterarchive.org')
ON CONFLICT ("key") DO NOTHING;
