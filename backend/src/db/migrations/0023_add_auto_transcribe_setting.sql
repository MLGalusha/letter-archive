INSERT INTO "site_settings" ("key", "value") VALUES
  ('auto_transcribe', 'false')
ON CONFLICT ("key") DO NOTHING;
