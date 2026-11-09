ALTER TABLE "TransformJob"
  ADD COLUMN "resultDelivery" TEXT NOT NULL DEFAULT 'callback',
  ADD COLUMN "pollingEndpoint" TEXT,
  ADD COLUMN "nextPollAt" TIMESTAMP(3),
  ADD COLUMN "pollLeaseToken" TEXT,
  ADD COLUMN "pollLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "pollFailureCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "TransformJob_resultDelivery_status_nextPollAt_idx"
  ON "TransformJob"("resultDelivery", "status", "nextPollAt");
