-- Add new letter type enum values
-- P=Photo, V=Voice, A=Article, D=Diary, N=Card, T=Telegram
ALTER TYPE "public"."letter_type" ADD VALUE IF NOT EXISTS 'P';--> statement-breakpoint
ALTER TYPE "public"."letter_type" ADD VALUE IF NOT EXISTS 'V';--> statement-breakpoint
ALTER TYPE "public"."letter_type" ADD VALUE IF NOT EXISTS 'A';--> statement-breakpoint
ALTER TYPE "public"."letter_type" ADD VALUE IF NOT EXISTS 'D';--> statement-breakpoint
ALTER TYPE "public"."letter_type" ADD VALUE IF NOT EXISTS 'N';--> statement-breakpoint
ALTER TYPE "public"."letter_type" ADD VALUE IF NOT EXISTS 'T';
