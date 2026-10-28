-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "bootstrapKey" TEXT,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "impersonatedBy" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TempFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "encIv" TEXT NOT NULL,
    "encTag" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "TempFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "nodes" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "edges" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "thumbnail" TEXT,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "edgeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastOpenedAt" TIMESTAMP(3),

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'run',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "inputType" TEXT NOT NULL,
    "inputValue" TEXT NOT NULL,
    "graphId" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "entityCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastOpenedAt" TIMESTAMP(3),

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseEntity" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "label" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "CaseEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseEntitySource" (
    "id" TEXT NOT NULL,
    "caseEntityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "graphId" TEXT,
    "graphNodeId" TEXT,
    "pluginId" TEXT,
    "transformId" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "CaseEntitySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseTarget" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseEntityId" TEXT NOT NULL,
    "name" TEXT,
    "color" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'confirmed',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseTargetEntityLink" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "caseEntityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "CaseTargetEntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseRelation" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'medium',
    "confidenceScore" INTEGER,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseRelationSource" (
    "id" TEXT NOT NULL,
    "caseRelationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "graphId" TEXT,
    "graphEdgeId" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseRelationSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseTargetRelationLink" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "caseRelationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "CaseTargetRelationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseDerivedRelationDismissal" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "dismissedByUserId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseDerivedRelationDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseArtifact" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "graphId" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '/',
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "storageKey" TEXT,
    "content" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastOpenedAt" TIMESTAMP(3),

    CONSTRAINT "CaseArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseTargetArtifactLink" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "CaseTargetArtifactLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseArtifactLink" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "caseEntityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseArtifactLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "actorUserId" TEXT,
    "occurredAt" TIMESTAMP(3),
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Graph" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "nodes" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "edges" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "thumbnail" TEXT,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "edgeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastOpenedAt" TIMESTAMP(3),

    CONSTRAINT "Graph_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphAgentLease" (
    "graphId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "runId" TEXT,
    "userId" TEXT,
    "token" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GraphAgentLease_pkey" PRIMARY KEY ("graphId")
);

-- CreateTable
CREATE TABLE "AgentWorker" (
    "id" TEXT NOT NULL,
    "protocolVersion" INTEGER NOT NULL,
    "queueName" TEXT NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "graphId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "approvalMode" TEXT NOT NULL DEFAULT 'guarded',
    "parentRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "workerStartedAt" TIMESTAMP(3),
    "startRequestHash" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "contextCheckpoint" JSONB,
    "contextUsage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("runId","sequence")
);

-- CreateTable
CREATE TABLE "WorkspaceAgentSetting" (
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAgentSetting_pkey" PRIMARY KEY ("workspaceId","provider")
);

-- CreateTable
CREATE TABLE "OrgPluginSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgPluginSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPluginSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPluginSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,
    "autoLayout" BOOLEAN NOT NULL DEFAULT true,
    "showGrid" BOOLEAN NOT NULL DEFAULT true,
    "showMiniMap" BOOLEAN NOT NULL DEFAULT true,
    "defaultEdgeType" TEXT NOT NULL DEFAULT 'default',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "lastGraphId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomPlugin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "code" TEXT NOT NULL,
    "inputTypes" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "installs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomPlugin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityPluginInstall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityPluginInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgAddonInstall" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,
    "manifestUrl" TEXT NOT NULL,
    "manifestVersion" TEXT NOT NULL,
    "manifestData" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "webhookSecret" TEXT NOT NULL,
    "config" TEXT,

    CONSTRAINT "OrgAddonInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransformJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "graphId" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,
    "transformId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "inputEntity" TEXT NOT NULL,
    "config" TEXT,
    "result" TEXT,
    "error" TEXT,
    "externalJobId" TEXT,
    "webhookUrl" TEXT NOT NULL,
    "progress" INTEGER,
    "progressMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TransformJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransformWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransformWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'kasm',
    "browser" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "containerId" TEXT,
    "hostPort" INTEGER,
    "vncPassword" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTING',
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "WorkspaceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_bootstrapKey_key" ON "User"("bootstrapKey");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "TempFile_organizationId_createdAt_idx" ON "TempFile"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "TempFile_expiresAt_idx" ON "TempFile"("expiresAt");

-- CreateIndex
CREATE INDEX "Flow_organizationId_idx" ON "Flow"("organizationId");

-- CreateIndex
CREATE INDEX "Flow_organizationId_updatedAt_idx" ON "Flow"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "FlowRun_organizationId_idx" ON "FlowRun"("organizationId");

-- CreateIndex
CREATE INDEX "FlowRun_flowId_startedAt_idx" ON "FlowRun"("flowId", "startedAt");

-- CreateIndex
CREATE INDEX "Case_organizationId_lastOpenedAt_idx" ON "Case"("organizationId", "lastOpenedAt");

-- CreateIndex
CREATE INDEX "Case_organizationId_updatedAt_idx" ON "Case"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "CaseEntity_caseId_type_idx" ON "CaseEntity"("caseId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CaseEntity_caseId_type_normalizedValue_key" ON "CaseEntity"("caseId", "type", "normalizedValue");

-- CreateIndex
CREATE INDEX "CaseEntitySource_graphId_idx" ON "CaseEntitySource"("graphId");

-- CreateIndex
CREATE INDEX "CaseTarget_caseId_idx" ON "CaseTarget"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseTarget_caseId_caseEntityId_key" ON "CaseTarget"("caseId", "caseEntityId");

-- CreateIndex
CREATE INDEX "CaseTargetEntityLink_caseEntityId_idx" ON "CaseTargetEntityLink"("caseEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseTargetEntityLink_targetId_caseEntityId_key" ON "CaseTargetEntityLink"("targetId", "caseEntityId");

-- CreateIndex
CREATE INDEX "CaseRelation_caseId_idx" ON "CaseRelation"("caseId");

-- CreateIndex
CREATE INDEX "CaseTargetRelationLink_caseRelationId_idx" ON "CaseTargetRelationLink"("caseRelationId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseTargetRelationLink_targetId_caseRelationId_key" ON "CaseTargetRelationLink"("targetId", "caseRelationId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDerivedRelationDismissal_caseId_fingerprint_key" ON "CaseDerivedRelationDismissal"("caseId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "CaseArtifact_graphId_key" ON "CaseArtifact"("graphId");

-- CreateIndex
CREATE INDEX "CaseArtifact_caseId_type_idx" ON "CaseArtifact"("caseId", "type");

-- CreateIndex
CREATE INDEX "CaseArtifact_caseId_type_lastOpenedAt_idx" ON "CaseArtifact"("caseId", "type", "lastOpenedAt");

-- CreateIndex
CREATE INDEX "CaseArtifact_caseId_path_idx" ON "CaseArtifact"("caseId", "path");

-- CreateIndex
CREATE INDEX "CaseTargetArtifactLink_artifactId_idx" ON "CaseTargetArtifactLink"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseTargetArtifactLink_targetId_artifactId_key" ON "CaseTargetArtifactLink"("targetId", "artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseArtifactLink_artifactId_caseEntityId_key" ON "CaseArtifactLink"("artifactId", "caseEntityId");

-- CreateIndex
CREATE INDEX "CaseEvent_caseId_createdAt_idx" ON "CaseEvent"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "CaseEvent_caseId_occurredAt_idx" ON "CaseEvent"("caseId", "occurredAt");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE INDEX "OrganizationMember_organizationId_idx" ON "OrganizationMember"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_userId_organizationId_key" ON "OrganizationMember"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "Graph_userId_idx" ON "Graph"("userId");

-- CreateIndex
CREATE INDEX "Graph_organizationId_idx" ON "Graph"("organizationId");

-- CreateIndex
CREATE INDEX "Graph_caseId_idx" ON "Graph"("caseId");

-- CreateIndex
CREATE INDEX "Graph_userId_updatedAt_idx" ON "Graph"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Graph_organizationId_visibility_idx" ON "Graph"("organizationId", "visibility");

-- CreateIndex
CREATE INDEX "GraphAgentLease_expiresAt_idx" ON "GraphAgentLease"("expiresAt");

-- CreateIndex
CREATE INDEX "AgentWorker_protocolVersion_queueName_expiresAt_idx" ON "AgentWorker"("protocolVersion", "queueName", "expiresAt");

-- CreateIndex
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_graphId_createdAt_idx" ON "AgentRun"("graphId", "createdAt");

-- CreateIndex
CREATE INDEX "OrgPluginSetting_organizationId_idx" ON "OrgPluginSetting"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgPluginSetting_organizationId_pluginId_key" ON "OrgPluginSetting"("organizationId", "pluginId");

-- CreateIndex
CREATE INDEX "UserPluginSetting_userId_idx" ON "UserPluginSetting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPluginSetting_userId_pluginId_key" ON "UserPluginSetting"("userId", "pluginId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "CustomPlugin_userId_idx" ON "CustomPlugin"("userId");

-- CreateIndex
CREATE INDEX "CustomPlugin_isPublic_idx" ON "CustomPlugin"("isPublic");

-- CreateIndex
CREATE INDEX "CommunityPluginInstall_userId_idx" ON "CommunityPluginInstall"("userId");

-- CreateIndex
CREATE INDEX "CommunityPluginInstall_pluginId_idx" ON "CommunityPluginInstall"("pluginId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityPluginInstall_userId_pluginId_key" ON "CommunityPluginInstall"("userId", "pluginId");

-- CreateIndex
CREATE INDEX "OrgAddonInstall_organizationId_idx" ON "OrgAddonInstall"("organizationId");

-- CreateIndex
CREATE INDEX "OrgAddonInstall_addonId_idx" ON "OrgAddonInstall"("addonId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgAddonInstall_organizationId_addonId_key" ON "OrgAddonInstall"("organizationId", "addonId");

-- CreateIndex
CREATE INDEX "TransformJob_organizationId_idx" ON "TransformJob"("organizationId");

-- CreateIndex
CREATE INDEX "TransformJob_graphId_idx" ON "TransformJob"("graphId");

-- CreateIndex
CREATE INDEX "TransformJob_status_idx" ON "TransformJob"("status");

-- CreateIndex
CREATE INDEX "TransformJob_addonId_idx" ON "TransformJob"("addonId");

-- CreateIndex
CREATE UNIQUE INDEX "TransformWebhookEvent_eventId_key" ON "TransformWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "TransformWebhookEvent_jobId_receivedAt_idx" ON "TransformWebhookEvent"("jobId", "receivedAt");

-- CreateIndex
CREATE INDEX "WorkspaceSession_organizationId_status_idx" ON "WorkspaceSession"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceSession_createdByUserId_idx" ON "WorkspaceSession"("createdByUserId");

-- CreateIndex
CREATE INDEX "WorkspaceSession_expiresAt_idx" ON "WorkspaceSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TempFile" ADD CONSTRAINT "TempFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEntity" ADD CONSTRAINT "CaseEntity_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEntitySource" ADD CONSTRAINT "CaseEntitySource_caseEntityId_fkey" FOREIGN KEY ("caseEntityId") REFERENCES "CaseEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTarget" ADD CONSTRAINT "CaseTarget_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTarget" ADD CONSTRAINT "CaseTarget_caseEntityId_fkey" FOREIGN KEY ("caseEntityId") REFERENCES "CaseEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTargetEntityLink" ADD CONSTRAINT "CaseTargetEntityLink_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "CaseTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTargetEntityLink" ADD CONSTRAINT "CaseTargetEntityLink_caseEntityId_fkey" FOREIGN KEY ("caseEntityId") REFERENCES "CaseEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRelation" ADD CONSTRAINT "CaseRelation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRelation" ADD CONSTRAINT "CaseRelation_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "CaseEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRelation" ADD CONSTRAINT "CaseRelation_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "CaseEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseRelationSource" ADD CONSTRAINT "CaseRelationSource_caseRelationId_fkey" FOREIGN KEY ("caseRelationId") REFERENCES "CaseRelation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTargetRelationLink" ADD CONSTRAINT "CaseTargetRelationLink_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "CaseTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTargetRelationLink" ADD CONSTRAINT "CaseTargetRelationLink_caseRelationId_fkey" FOREIGN KEY ("caseRelationId") REFERENCES "CaseRelation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseArtifact" ADD CONSTRAINT "CaseArtifact_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseArtifact" ADD CONSTRAINT "CaseArtifact_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "Graph"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTargetArtifactLink" ADD CONSTRAINT "CaseTargetArtifactLink_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "CaseTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTargetArtifactLink" ADD CONSTRAINT "CaseTargetArtifactLink_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "CaseArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseArtifactLink" ADD CONSTRAINT "CaseArtifactLink_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "CaseArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseArtifactLink" ADD CONSTRAINT "CaseArtifactLink_caseEntityId_fkey" FOREIGN KEY ("caseEntityId") REFERENCES "CaseEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Graph" ADD CONSTRAINT "Graph_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Graph" ADD CONSTRAINT "Graph_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphAgentLease" ADD CONSTRAINT "GraphAgentLease_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "Graph"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "Graph"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAgentSetting" ADD CONSTRAINT "WorkspaceAgentSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPluginSetting" ADD CONSTRAINT "OrgPluginSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAddonInstall" ADD CONSTRAINT "OrgAddonInstall_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransformJob" ADD CONSTRAINT "TransformJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransformJob" ADD CONSTRAINT "TransformJob_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "Graph"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransformJob" ADD CONSTRAINT "TransformJob_organizationId_addonId_fkey" FOREIGN KEY ("organizationId", "addonId") REFERENCES "OrgAddonInstall"("organizationId", "addonId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransformWebhookEvent" ADD CONSTRAINT "TransformWebhookEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TransformJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSession" ADD CONSTRAINT "WorkspaceSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integrity constraints not represented by Prisma schema syntax.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"GraphAgentLease"'::regclass AND conname = 'GraphAgentLease_generation_check') THEN
    ALTER TABLE "GraphAgentLease" ADD CONSTRAINT "GraphAgentLease_generation_check" CHECK ("generation" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"GraphAgentLease"'::regclass AND conname = 'GraphAgentLease_complete_check') THEN
    ALTER TABLE "GraphAgentLease" ADD CONSTRAINT "GraphAgentLease_complete_check" CHECK (
      ("runId" IS NULL AND "userId" IS NULL AND "token" IS NULL AND "expiresAt" IS NULL)
      OR ("runId" IS NOT NULL AND "userId" IS NOT NULL AND "token" IS NOT NULL AND "expiresAt" IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"AgentRun"'::regclass AND conname = 'AgentRun_status_check') THEN
    ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_status_check" CHECK ("status" IN ('running', 'completed', 'cancelled', 'failed', 'interrupted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"AgentRun"'::regclass AND conname = 'AgentRun_eventCount_check') THEN
    ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_eventCount_check" CHECK ("eventCount" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"AgentEvent"'::regclass AND conname = 'AgentEvent_sequence_check') THEN
    ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_sequence_check" CHECK ("sequence" > 0);
  END IF;
END $$;

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_approvalMode_check" CHECK ("approvalMode" IN ('ask', 'guarded', 'auto'));
