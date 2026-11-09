ALTER TABLE "TransformJob" ADD COLUMN "agentRunId" TEXT;
CREATE INDEX "TransformJob_agentRunId_status_idx" ON "TransformJob"("agentRunId", "status");
ALTER TABLE "TransformJob" ADD CONSTRAINT "TransformJob_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
