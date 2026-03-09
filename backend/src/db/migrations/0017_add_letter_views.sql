CREATE TABLE letter_views (
  letter_id uuid PRIMARY KEY REFERENCES letters(id) ON DELETE CASCADE,
  last_opened_at timestamptz NOT NULL DEFAULT now()
);
