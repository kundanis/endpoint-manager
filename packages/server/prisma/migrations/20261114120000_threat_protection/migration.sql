BEGIN TRY

BEGIN TRAN;

-- Threat Protection (new tables only): policies + assignments, endpoint protection status,
-- detections, YARA rule sets, scan and action tasks.

-- CreateTable
CREATE TABLE [dbo].[ThreatProtectionPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [ThreatProtectionPolicy_enabled_df] DEFAULT 1,
    [realTimeProtection] BIT NOT NULL CONSTRAINT [ThreatProtectionPolicy_realTimeProtection_df] DEFAULT 1,
    [cloudProtection] BIT NOT NULL CONSTRAINT [ThreatProtectionPolicy_cloudProtection_df] DEFAULT 1,
    [submitSamples] BIT NOT NULL CONSTRAINT [ThreatProtectionPolicy_submitSamples_df] DEFAULT 1,
    [puaProtection] BIT NOT NULL CONSTRAINT [ThreatProtectionPolicy_puaProtection_df] DEFAULT 1,
    [scanType] NVARCHAR(10) NOT NULL CONSTRAINT [ThreatProtectionPolicy_scanType_df] DEFAULT 'QUICK',
    [scanScheduleDay] INT NOT NULL CONSTRAINT [ThreatProtectionPolicy_scanScheduleDay_df] DEFAULT 0,
    [scanScheduleTime] NVARCHAR(5) NOT NULL CONSTRAINT [ThreatProtectionPolicy_scanScheduleTime_df] DEFAULT '02:00',
    [signatureUpdateHours] INT NOT NULL CONSTRAINT [ThreatProtectionPolicy_signatureUpdateHours_df] DEFAULT 4,
    [excludedPaths] NVARCHAR(max) NOT NULL CONSTRAINT [ThreatProtectionPolicy_excludedPaths_df] DEFAULT '[]',
    [excludedExtensions] NVARCHAR(max) NOT NULL CONSTRAINT [ThreatProtectionPolicy_excludedExtensions_df] DEFAULT '[]',
    [excludedProcesses] NVARCHAR(max) NOT NULL CONSTRAINT [ThreatProtectionPolicy_excludedProcesses_df] DEFAULT '[]',
    [yaraEnabled] BIT NOT NULL CONSTRAINT [ThreatProtectionPolicy_yaraEnabled_df] DEFAULT 0,
    [yaraWatchFolders] NVARCHAR(max) NOT NULL CONSTRAINT [ThreatProtectionPolicy_yaraWatchFolders_df] DEFAULT '[]',
    [yaraScanUsb] BIT NOT NULL CONSTRAINT [ThreatProtectionPolicy_yaraScanUsb_df] DEFAULT 0,
    [yaraScanNewPrograms] BIT NOT NULL CONSTRAINT [ThreatProtectionPolicy_yaraScanNewPrograms_df] DEFAULT 0,
    [yaraAutoQuarantine] BIT NOT NULL CONSTRAINT [ThreatProtectionPolicy_yaraAutoQuarantine_df] DEFAULT 0,
    [yaraRuleSetIds] NVARCHAR(max) NOT NULL CONSTRAINT [ThreatProtectionPolicy_yaraRuleSetIds_df] DEFAULT '[]',
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ThreatProtectionPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ThreatProtectionPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ThreatProtectionPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ThreatProtectionPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSyncedAt] DATETIME2,
    [lastSyncStatus] NVARCHAR(20),
    [lastSyncError] NVARCHAR(2000),
    CONSTRAINT [ThreatProtectionPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[EndpointProtectionStatus] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [antivirusProducts] NVARCHAR(2000) NOT NULL CONSTRAINT [EndpointProtectionStatus_antivirusProducts_df] DEFAULT '[]',
    [defenderMode] NVARCHAR(20) NOT NULL CONSTRAINT [EndpointProtectionStatus_defenderMode_df] DEFAULT 'UNKNOWN',
    [realTimeOn] BIT,
    [behaviorMonitorOn] BIT,
    [cloudProtectionOn] BIT,
    [puaProtectionOn] BIT,
    [tamperProtected] BIT,
    [externallyManaged] BIT NOT NULL CONSTRAINT [EndpointProtectionStatus_externallyManaged_df] DEFAULT 0,
    [productVersion] NVARCHAR(50),
    [engineVersion] NVARCHAR(50),
    [signatureVersion] NVARCHAR(50),
    [signatureUpdatedAt] DATETIME2,
    [lastQuickScanAt] DATETIME2,
    [lastFullScanAt] DATETIME2,
    [activeThreats] INT NOT NULL CONSTRAINT [EndpointProtectionStatus_activeThreats_df] DEFAULT 0,
    [yaraRulesVersion] NVARCHAR(64),
    [reportedAt] DATETIME2 NOT NULL CONSTRAINT [EndpointProtectionStatus_reportedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [EndpointProtectionStatus_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EndpointProtectionStatus_agentId_key] UNIQUE NONCLUSTERED ([agentId])
);

-- CreateTable
CREATE TABLE [dbo].[ThreatDetection] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [source] NVARCHAR(20) NOT NULL,
    [externalKey] NVARCHAR(200) NOT NULL,
    [threatName] NVARCHAR(300) NOT NULL,
    [defenderThreatId] BIGINT,
    [severity] NVARCHAR(20) NOT NULL CONSTRAINT [ThreatDetection_severity_df] DEFAULT 'UNKNOWN',
    [category] NVARCHAR(100),
    [filePath] NVARCHAR(1000),
    [resources] NVARCHAR(max) NOT NULL CONSTRAINT [ThreatDetection_resources_df] DEFAULT '[]',
    [sha256] NVARCHAR(64),
    [username] NVARCHAR(200),
    [processName] NVARCHAR(300),
    [ruleName] NVARCHAR(200),
    [ruleSetName] NVARCHAR(200),
    [ruleAuthor] NVARCHAR(200),
    [ruleLicense] NVARCHAR(100),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [ThreatDetection_status_df] DEFAULT 'ACTIVE',
    [actionDetail] NVARCHAR(500),
    [quarantinePath] NVARCHAR(1000),
    [detectedAt] DATETIME2 NOT NULL,
    [lastSeenAt] DATETIME2 NOT NULL,
    [resolvedAt] DATETIME2,
    [resolvedByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ThreatDetection_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ThreatDetection_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ThreatDetection_agentId_source_externalKey_key] UNIQUE NONCLUSTERED ([agentId],[source],[externalKey])
);

-- CreateTable
CREATE TABLE [dbo].[ThreatYaraRuleSet] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [source] NVARCHAR(20) NOT NULL,
    [sourceName] NVARCHAR(200),
    [license] NVARCHAR(100),
    [author] NVARCHAR(200),
    [version] NVARCHAR(50),
    [rulesText] NVARCHAR(max) NOT NULL,
    [sha256] NVARCHAR(64) NOT NULL,
    [ruleCount] INT NOT NULL CONSTRAINT [ThreatYaraRuleSet_ruleCount_df] DEFAULT 0,
    [disabledRules] NVARCHAR(max) NOT NULL CONSTRAINT [ThreatYaraRuleSet_disabledRules_df] DEFAULT '[]',
    [enabled] BIT NOT NULL CONSTRAINT [ThreatYaraRuleSet_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ThreatYaraRuleSet_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ThreatYaraRuleSet_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ThreatScanTask] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [scanType] NVARCHAR(10) NOT NULL,
    [paths] NVARCHAR(max) NOT NULL CONSTRAINT [ThreatScanTask_paths_df] DEFAULT '[]',
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [ThreatScanTask_status_df] DEFAULT 'PENDING',
    [requestedByAdminId] NVARCHAR(1000),
    [requestedAt] DATETIME2 NOT NULL CONSTRAINT [ThreatScanTask_requestedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [startedAt] DATETIME2,
    [finishedAt] DATETIME2,
    [filesScanned] INT,
    [threatsFound] INT,
    [errorMessage] NVARCHAR(1000),
    CONSTRAINT [ThreatScanTask_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ThreatActionTask] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [detectionId] NVARCHAR(1000),
    [action] NVARCHAR(30) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [ThreatActionTask_status_df] DEFAULT 'PENDING',
    [requestedByAdminId] NVARCHAR(1000),
    [requestedAt] DATETIME2 NOT NULL CONSTRAINT [ThreatActionTask_requestedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [finishedAt] DATETIME2,
    [resultMessage] NVARCHAR(1000),
    CONSTRAINT [ThreatActionTask_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ThreatProtectionPolicyAssignment_agentId_idx] ON [dbo].[ThreatProtectionPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ThreatProtectionPolicyAssignment_groupId_idx] ON [dbo].[ThreatProtectionPolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ThreatDetection_status_idx] ON [dbo].[ThreatDetection]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ThreatDetection_detectedAt_idx] ON [dbo].[ThreatDetection]([detectedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ThreatScanTask_agentId_status_idx] ON [dbo].[ThreatScanTask]([agentId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ThreatActionTask_agentId_status_idx] ON [dbo].[ThreatActionTask]([agentId], [status]);

-- AddForeignKey
ALTER TABLE [dbo].[ThreatProtectionPolicyAssignment] ADD CONSTRAINT [ThreatProtectionPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[ThreatProtectionPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ThreatProtectionPolicyAssignment] ADD CONSTRAINT [ThreatProtectionPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ThreatProtectionPolicyAssignment] ADD CONSTRAINT [ThreatProtectionPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[EndpointProtectionStatus] ADD CONSTRAINT [EndpointProtectionStatus_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ThreatDetection] ADD CONSTRAINT [ThreatDetection_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ThreatScanTask] ADD CONSTRAINT [ThreatScanTask_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ThreatActionTask] ADD CONSTRAINT [ThreatActionTask_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

