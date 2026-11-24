BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[AiGuardPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [AiGuardPolicy_enabled_df] DEFAULT 1,
    [defaultAction] NVARCHAR(10) NOT NULL CONSTRAINT [AiGuardPolicy_defaultAction_df] DEFAULT 'ALLOW',
    [appActions] NVARCHAR(max) NOT NULL CONSTRAINT [AiGuardPolicy_appActions_df] DEFAULT '{}',
    [createdByAdminId] NVARCHAR(64),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AiGuardPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AiGuardPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AiGuardPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AiGuardPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AiGuardPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AiGuardCustomApp] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [category] NVARCHAR(40) NOT NULL,
    [risk] NVARCHAR(10) NOT NULL CONSTRAINT [AiGuardCustomApp_risk_df] DEFAULT 'MEDIUM',
    [domains] NVARCHAR(2000) NOT NULL CONSTRAINT [AiGuardCustomApp_domains_df] DEFAULT '[]',
    [executables] NVARCHAR(1000) NOT NULL CONSTRAINT [AiGuardCustomApp_executables_df] DEFAULT '[]',
    [createdByAdminId] NVARCHAR(64),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AiGuardCustomApp_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AiGuardCustomApp_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiGuardPolicyAssignment_policyId_idx] ON [dbo].[AiGuardPolicyAssignment]([policyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiGuardPolicyAssignment_agentId_idx] ON [dbo].[AiGuardPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiGuardPolicyAssignment_groupId_idx] ON [dbo].[AiGuardPolicyAssignment]([groupId]);

-- AddForeignKey
ALTER TABLE [dbo].[AiGuardPolicyAssignment] ADD CONSTRAINT [AiGuardPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[AiGuardPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AiGuardPolicyAssignment] ADD CONSTRAINT [AiGuardPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AiGuardPolicyAssignment] ADD CONSTRAINT [AiGuardPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

