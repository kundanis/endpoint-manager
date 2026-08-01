BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[DataMovementPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [monitorUsb] BIT NOT NULL CONSTRAINT [DataMovementPolicy_monitorUsb_df] DEFAULT 1,
    [monitorCloudSync] BIT NOT NULL CONSTRAINT [DataMovementPolicy_monitorCloudSync_df] DEFAULT 1,
    [monitorNetworkShare] BIT NOT NULL CONSTRAINT [DataMovementPolicy_monitorNetworkShare_df] DEFAULT 1,
    [extraCloudSyncPaths] NVARCHAR(max) NOT NULL CONSTRAINT [DataMovementPolicy_extraCloudSyncPaths_df] DEFAULT '[]',
    [enabled] BIT NOT NULL CONSTRAINT [DataMovementPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DataMovementPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DataMovementPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DataMovementPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DataMovementPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DataMovementPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DataMovementEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [filePath] NVARCHAR(1000) NOT NULL,
    [fileSizeBytes] BIGINT NOT NULL,
    [fileModifiedAt] DATETIME2 NOT NULL,
    [channel] NVARCHAR(20) NOT NULL,
    [channelDetail] NVARCHAR(1000) NOT NULL CONSTRAINT [DataMovementEvent_channelDetail_df] DEFAULT '{}',
    [detectedAt] DATETIME2 NOT NULL CONSTRAINT [DataMovementEvent_detectedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DataMovementEvent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DataMovementEvent_agentId_policyId_filePath_channel_fileModifiedAt_key] UNIQUE NONCLUSTERED ([agentId],[policyId],[filePath],[channel],[fileModifiedAt])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DataMovementPolicyAssignment_agentId_idx] ON [dbo].[DataMovementPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DataMovementPolicyAssignment_groupId_idx] ON [dbo].[DataMovementPolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DataMovementEvent_agentId_idx] ON [dbo].[DataMovementEvent]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DataMovementEvent_policyId_idx] ON [dbo].[DataMovementEvent]([policyId]);

-- AddForeignKey
ALTER TABLE [dbo].[DataMovementPolicyAssignment] ADD CONSTRAINT [DataMovementPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[DataMovementPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DataMovementPolicyAssignment] ADD CONSTRAINT [DataMovementPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DataMovementPolicyAssignment] ADD CONSTRAINT [DataMovementPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DataMovementEvent] ADD CONSTRAINT [DataMovementEvent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DataMovementEvent] ADD CONSTRAINT [DataMovementEvent_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[DataMovementPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
