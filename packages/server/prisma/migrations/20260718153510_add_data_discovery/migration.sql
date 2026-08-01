BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[DataDiscoveryPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [regulation] NVARCHAR(10) NOT NULL,
    [targetPaths] NVARCHAR(max) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [DataDiscoveryPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DataDiscoveryPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DataDiscoveryPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DataDiscoveryPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DataDiscoveryPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DataDiscoveryPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DataDiscoveryFinding] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [filePath] NVARCHAR(1000) NOT NULL,
    [fileSizeBytes] BIGINT NOT NULL,
    [fileModifiedAt] DATETIME2 NOT NULL,
    [matchedPatternKeys] NVARCHAR(500) NOT NULL CONSTRAINT [DataDiscoveryFinding_matchedPatternKeys_df] DEFAULT '[]',
    [matchCounts] NVARCHAR(1000) NOT NULL CONSTRAINT [DataDiscoveryFinding_matchCounts_df] DEFAULT '{}',
    [detectedAt] DATETIME2 NOT NULL CONSTRAINT [DataDiscoveryFinding_detectedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [DataDiscoveryFinding_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DataDiscoveryFinding_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DataDiscoveryFinding_agentId_policyId_filePath_key] UNIQUE NONCLUSTERED ([agentId],[policyId],[filePath])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DataDiscoveryPolicyAssignment_agentId_idx] ON [dbo].[DataDiscoveryPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DataDiscoveryPolicyAssignment_groupId_idx] ON [dbo].[DataDiscoveryPolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DataDiscoveryFinding_agentId_idx] ON [dbo].[DataDiscoveryFinding]([agentId]);

-- AddForeignKey
ALTER TABLE [dbo].[DataDiscoveryPolicyAssignment] ADD CONSTRAINT [DataDiscoveryPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[DataDiscoveryPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DataDiscoveryPolicyAssignment] ADD CONSTRAINT [DataDiscoveryPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DataDiscoveryPolicyAssignment] ADD CONSTRAINT [DataDiscoveryPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DataDiscoveryFinding] ADD CONSTRAINT [DataDiscoveryFinding_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DataDiscoveryFinding] ADD CONSTRAINT [DataDiscoveryFinding_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[DataDiscoveryPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
