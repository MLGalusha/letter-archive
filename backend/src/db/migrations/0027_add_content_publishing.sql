-- Migration: Add content publishing tables (update_posts and content_pages)

-- Update posts table
CREATE TABLE IF NOT EXISTS "update_posts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "excerpt" text,
  "body_markdown" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "category" text,
  "author_display_name" text,
  "author_role" text,
  "hero_image_url" text,
  "hero_image_alt" text,
  "seo_title" text,
  "seo_description" text,
  "cta_label" text,
  "cta_url" text,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Content pages table
CREATE TABLE IF NOT EXISTS "content_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "content_json" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text
);

-- Indexes for update_posts
CREATE UNIQUE INDEX IF NOT EXISTS "update_posts_slug_unique" ON "update_posts" USING btree ("slug");
CREATE INDEX IF NOT EXISTS "idx_update_posts_status" ON "update_posts" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_update_posts_published_at" ON "update_posts" USING btree ("published_at");
CREATE INDEX IF NOT EXISTS "idx_update_posts_created_at" ON "update_posts" USING btree ("created_at");

-- Indexes for content_pages
CREATE UNIQUE INDEX IF NOT EXISTS "content_pages_slug_unique" ON "content_pages" USING btree ("slug");
