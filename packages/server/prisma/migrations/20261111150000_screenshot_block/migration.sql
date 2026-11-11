BEGIN TRY

BEGIN TRAN;

-- EPM -> Screenshot blocking (new tables only).

-- CreateTable
CREATE TABLE [dbo].[ScreenshotBlockPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [blockKeys] BIT NOT NULL CONSTRAINT [ScreenshotBlockPolicy_blockKeys_df] DEFAULT 1,
    [blockTools] BIT NOT NULL CONSTRAINT [ScreenshotBlockPolicy_blockTools_df] DEFAULT 1,
    [blockClipboardImages] BIT NOT NULL CONSTRAINT [ScreenshotBlockPolicy_blockClipboardImages_df] DEFAULT 0,
    [extraTools] NVARCHAR(2000) NOT NULL CONSTRAINT [ScreenshotBlockPolicy_extraTools_df] DEFAULT '[]',
    [enabled] BIT NOT NULL CONSTRAINT [ScreenshotBlockPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ScreenshotBlockPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ScreenshotBlockPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ScreenshotBlockPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ScreenshotBlockPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSyncedAt] DATETIME2,
    [lastSyncStatus] NVARCHAR(20),
    [lastSyncError] NVARCHAR(1000),
    CONSTRAINT [ScreenshotBlockPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ScreenshotBlockEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [username] NVARCHAR(200) NOT NULL,
    [kind] NVARCHAR(20) NOT NULL,
    [detail] NVARCHAR(300) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [detectedAt] DATETIME2 NOT NULL CONSTRAINT [ScreenshotBlockEvent_detectedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ScreenshotBlockEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ScreenshotBlockPolicyAssignment_agentId_idx] ON [dbo].[ScreenshotBlockPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ScreenshotBlockPolicyAssignment_groupId_idx] ON [dbo].[ScreenshotBlockPolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ScreenshotBlockEvent_agentId_occurredAt_idx] ON [dbo].[ScreenshotBlockEvent]([agentId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ScreenshotBlockEvent_occurredAt_idx] ON [dbo].[ScreenshotBlockEvent]([occurredAt]);

-- AddForeignKey
ALTER TABLE [dbo].[ScreenshotBlockPolicyAssignment] ADD CONSTRAINT [ScreenshotBlockPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[ScreenshotBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ScreenshotBlockPolicyAssignment] ADD CONSTRAINT [ScreenshotBlockPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ScreenshotBlockPolicyAssignment] ADD CONSTRAINT [ScreenshotBlockPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ScreenshotBlockEvent] ADD CONSTRAINT [ScreenshotBlockEvent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
