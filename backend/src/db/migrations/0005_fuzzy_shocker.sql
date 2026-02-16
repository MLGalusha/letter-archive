CREATE TYPE "public"."emotional_tone" AS ENUM('joyful', 'hopeful', 'neutral', 'anxious', 'sad', 'angry', 'desperate');--> statement-breakpoint
CREATE TYPE "public"."relationship_type" AS ENUM('spouse', 'fiancé/fiancée', 'romantic-partner', 'parent', 'child', 'sibling', 'grandparent', 'grandchild', 'aunt/uncle', 'nephew/niece', 'cousin', 'in-law', 'friend', 'acquaintance', 'business-associate', 'employer', 'employee', 'unknown');--> statement-breakpoint
ALTER TABLE "letters" DROP CONSTRAINT IF EXISTS "published_requires_review";--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "emotional_tone" "emotional_tone";--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "sender_recipient_relationship" "relationship_type";--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "primary_topics" text[];--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "metadata_v2_json" jsonb;--> statement-breakpoint
CREATE INDEX "idx_letters_emotional_tone" ON "letters" USING btree ("emotional_tone");--> statement-breakpoint
CREATE INDEX "idx_letters_primary_topics" ON "letters" USING gin ("primary_topics");--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "published_requires_verified" CHECK (visibility <> 'PUBLISHED' OR (transcript_status = 'VERIFIED' AND metadata_content_status = 'VERIFIED'));