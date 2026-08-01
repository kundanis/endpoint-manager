BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[DlpPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [regulation] NVARCHAR(10) NOT NULL,
    [enforcementMode] NVARCHAR(20) NOT NULL CONSTRAINT [DlpPolicy_enforcementMode_df] DEFAULT 'ALERT_ONLY',
    [removableMediaOnly] BIT NOT NULL CONSTRAINT [DlpPolicy_removableMediaOnly_df] DEFAULT 1,
    [enabled] BIT NOT NULL CONSTRAINT [DlpPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DlpPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DlpPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DlpPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DlpPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DlpPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DlpEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [filePath] NVARCHAR(1000) NOT NULL,
    [processName] NVARCHAR(300),
    [destinationIsRemovable] BIT NOT NULL CONSTRAINT [DlpEvent_destinationIsRemovable_df] DEFAULT 0,
    [action] NVARCHAR(20) NOT NULL,
    [matchedPatternKeys] NVARCHAR(500) NOT NULL CONSTRAINT [DlpEvent_matchedPatternKeys_df] DEFAULT '[]',
    [maskedSamples] NVARCHAR(2000) NOT NULL CONSTRAINT [DlpEvent_maskedSamples_df] DEFAULT '{}',
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [DlpEvent_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DlpEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DlpPolicyAssignment_agentId_idx] ON [dbo].[DlpPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DlpPolicyAssignment_groupId_idx] ON [dbo].[DlpPolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DlpEvent_agentId_idx] ON [dbo].[DlpEvent]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DlpEvent_policyId_idx] ON [dbo].[DlpEvent]([policyId]);

-- AddForeignKey
ALTER TABLE [dbo].[DlpPolicyAssignment] ADD CONSTRAINT [DlpPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[DlpPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DlpPolicyAssignment] ADD CONSTRAINT [DlpPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DlpPolicyAssignment] ADD CONSTRAINT [DlpPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DlpEvent] ADD CONSTRAINT [DlpEvent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DlpEvent] ADD CONSTRAINT [DlpEvent_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[DlpPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
