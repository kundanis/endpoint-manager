BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[PiiBlockPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [PiiBlockPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PiiBlockPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PiiBlockPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PiiBlockRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [ruleType] NVARCHAR(30) NOT NULL,
    [value] NVARCHAR(255) NOT NULL,
    [label] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PiiBlockRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PiiBlockRule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PiiBlockPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PiiBlockPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSyncedAt] DATETIME2,
    [lastSyncStatus] NVARCHAR(20),
    [lastSyncError] NVARCHAR(1000),
    CONSTRAINT [PiiBlockPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PiiBlockPolicyAssignment_agentId_idx] ON [dbo].[PiiBlockPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PiiBlockPolicyAssignment_groupId_idx] ON [dbo].[PiiBlockPolicyAssignment]([groupId]);

-- AddForeignKey
ALTER TABLE [dbo].[PiiBlockRule] ADD CONSTRAINT [PiiBlockRule_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[PiiBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PiiBlockPolicyAssignment] ADD CONSTRAINT [PiiBlockPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[PiiBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PiiBlockPolicyAssignment] ADD CONSTRAINT [PiiBlockPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PiiBlockPolicyAssignment] ADD CONSTRAINT [PiiBlockPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
