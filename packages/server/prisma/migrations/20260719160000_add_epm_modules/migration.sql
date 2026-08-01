BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[AppControlPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [AppControlPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AppControlPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AppControlPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AppControlRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [ruleType] NVARCHAR(30) NOT NULL,
    [value] NVARCHAR(500) NOT NULL,
    [label] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AppControlRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AppControlRule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AppControlPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AppControlPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AppControlPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AppControlEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000),
    [ruleId] NVARCHAR(1000),
    [matchedPath] NVARCHAR(1000),
    [processName] NVARCHAR(300),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [AppControlEvent_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AppControlEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[WebBlockPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [WebBlockPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [WebBlockPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [WebBlockPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[WebBlockRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [ruleType] NVARCHAR(30) NOT NULL,
    [value] NVARCHAR(255) NOT NULL,
    [label] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [WebBlockRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [WebBlockRule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[WebBlockPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [WebBlockPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSyncedAt] DATETIME2,
    [lastSyncStatus] NVARCHAR(20),
    [lastSyncError] NVARCHAR(1000),
    CONSTRAINT [WebBlockPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CommandBlockPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [CommandBlockPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CommandBlockPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CommandBlockPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CommandBlockRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [ruleType] NVARCHAR(30) NOT NULL,
    [value] NVARCHAR(500) NOT NULL,
    [label] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CommandBlockRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CommandBlockRule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CommandBlockPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CommandBlockPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CommandBlockPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CommandBlockEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000),
    [ruleId] NVARCHAR(1000) NOT NULL,
    [matchedCommandLine] NVARCHAR(2000) NOT NULL,
    [processName] NVARCHAR(300),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [CommandBlockEvent_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CommandBlockEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AppControlPolicyAssignment_agentId_idx] ON [dbo].[AppControlPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AppControlPolicyAssignment_groupId_idx] ON [dbo].[AppControlPolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AppControlEvent_agentId_idx] ON [dbo].[AppControlEvent]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WebBlockPolicyAssignment_agentId_idx] ON [dbo].[WebBlockPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WebBlockPolicyAssignment_groupId_idx] ON [dbo].[WebBlockPolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CommandBlockPolicyAssignment_agentId_idx] ON [dbo].[CommandBlockPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CommandBlockPolicyAssignment_groupId_idx] ON [dbo].[CommandBlockPolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CommandBlockEvent_agentId_idx] ON [dbo].[CommandBlockEvent]([agentId]);

-- AddForeignKey
ALTER TABLE [dbo].[AppControlRule] ADD CONSTRAINT [AppControlRule_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[AppControlPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AppControlPolicyAssignment] ADD CONSTRAINT [AppControlPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[AppControlPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AppControlPolicyAssignment] ADD CONSTRAINT [AppControlPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AppControlPolicyAssignment] ADD CONSTRAINT [AppControlPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AppControlEvent] ADD CONSTRAINT [AppControlEvent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AppControlEvent] ADD CONSTRAINT [AppControlEvent_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[AppControlPolicy]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[WebBlockRule] ADD CONSTRAINT [WebBlockRule_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[WebBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[WebBlockPolicyAssignment] ADD CONSTRAINT [WebBlockPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[WebBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[WebBlockPolicyAssignment] ADD CONSTRAINT [WebBlockPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[WebBlockPolicyAssignment] ADD CONSTRAINT [WebBlockPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[CommandBlockRule] ADD CONSTRAINT [CommandBlockRule_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[CommandBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[CommandBlockPolicyAssignment] ADD CONSTRAINT [CommandBlockPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[CommandBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[CommandBlockPolicyAssignment] ADD CONSTRAINT [CommandBlockPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[CommandBlockPolicyAssignment] ADD CONSTRAINT [CommandBlockPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[CommandBlockEvent] ADD CONSTRAINT [CommandBlockEvent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[CommandBlockEvent] ADD CONSTRAINT [CommandBlockEvent_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[CommandBlockPolicy]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
