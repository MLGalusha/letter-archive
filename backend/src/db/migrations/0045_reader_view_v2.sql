-- Reader View V2: segment classifications and derived reader blocks
ALTER TABLE "letter_pages" ADD COLUMN "segment_classifications" jsonb;
ALTER TABLE "letters" ADD COLUMN "reader_blocks" jsonb;
ALTER TABLE "letters" ADD COLUMN "reader_decisions" jsonb;
