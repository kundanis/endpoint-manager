BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[IpBlockPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [IpBlockPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IpBlockPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [IpBlockPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[IpBlockRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [ruleType] NVARCHAR(30) NOT NULL,
    [value] NVARCHAR(64) NOT NULL,
    [label] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IpBlockRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [IpBlockRule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[IpBlockPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IpBlockPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSyncedAt] DATETIME2,
    [lastSyncStatus] NVARCHAR(20),
    [lastSyncError] NVARCHAR(1000),
    CONSTRAINT [IpBlockPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IpBlockPolicyAssignment_agentId_idx] ON [dbo].[IpBlockPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IpBlockPolicyAssignment_groupId_idx] ON [dbo].[IpBlockPolicyAssignment]([groupId]);

-- AddForeignKey
ALTER TABLE [dbo].[IpBlockRule] ADD CONSTRAINT [IpBlockRule_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[IpBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[IpBlockPolicyAssignment] ADD CONSTRAINT [IpBlockPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[IpBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[IpBlockPolicyAssignment] ADD CONSTRAINT [IpBlockPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[IpBlockPolicyAssignment] ADD CONSTRAINT [IpBlockPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
