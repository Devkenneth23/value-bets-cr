-- AlterTable: add outcomeName and bookmakerKey columns with defaults
ALTER TABLE "opportunities" ADD COLUMN "outcomeName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "opportunities" ADD COLUMN "bookmakerKey" TEXT NOT NULL DEFAULT '';

-- Truncate existing data (duplicates from the bug, repopulated on next detection cycle)
TRUNCATE TABLE "opportunities";

-- CreateIndex: unique constraint for deduplication via upsert
CREATE UNIQUE INDEX "opportunities_eventId_marketKey_outcomeName_bookmakerKey_type_key" ON "opportunities"("eventId", "marketKey", "outcomeName", "bookmakerKey", "type");
