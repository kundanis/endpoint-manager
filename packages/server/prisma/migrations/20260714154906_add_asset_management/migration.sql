BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Agent] ADD [lifecycleStatus] NVARCHAR(20) NOT NULL CONSTRAINT [Agent_lifecycleStatus_df] DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE [dbo].[CommandJob] ADD [targetGroupIds] NVARCHAR(1000) NOT NULL CONSTRAINT [CommandJob_targetGroupIds_df] DEFAULT '[]';

-- AlterTable
ALTER TABLE [dbo].[DeploymentJob] ADD [targetGroupIds] NVARCHAR(1000) NOT NULL CONSTRAINT [DeploymentJob_targetGroupIds_df] DEFAULT '[]';

-- AlterTable
ALTER TABLE [dbo].[PatchJob] ADD [targetGroupIds] NVARCHAR(1000) NOT NULL CONSTRAINT [PatchJob_targetGroupIds_df] DEFAULT '[]';

-- CreateTable
CREATE TABLE [dbo].[AssetGroup] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AssetGroup_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AssetGroup_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AssetGroup_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[AgentGroupMembership] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [groupId] NVARCHAR(1000) NOT NULL,
    [addedAt] DATETIME2 NOT NULL CONSTRAINT [AgentGroupMembership_addedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AgentGroupMembership_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AgentGroupMembership_agentId_groupId_key] UNIQUE NONCLUSTERED ([agentId],[groupId])
);

-- CreateTable
CREATE TABLE [dbo].[CustomFieldDefinition] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [fieldType] NVARCHAR(20) NOT NULL,
    [options] NVARCHAR(1000) NOT NULL CONSTRAINT [CustomFieldDefinition_options_df] DEFAULT '[]',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CustomFieldDefinition_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CustomFieldDefinition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CustomFieldDefinition_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[AgentCustomFieldValue] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [fieldDefinitionId] NVARCHAR(1000) NOT NULL,
    [value] NVARCHAR(1000) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [AgentCustomFieldValue_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AgentCustomFieldValue_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AgentCustomFieldValue_agentId_fieldDefinitionId_key] UNIQUE NONCLUSTERED ([agentId],[fieldDefinitionId])
);

-- CreateTable
CREATE TABLE [dbo].[AssetNote] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [body] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AssetNote_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AssetNote_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AgentGroupMembership_groupId_idx] ON [dbo].[AgentGroupMembership]([groupId]);

-- AddForeignKey
ALTER TABLE [dbo].[AgentGroupMembership] ADD CONSTRAINT [AgentGroupMembership_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AgentGroupMembership] ADD CONSTRAINT [AgentGroupMembership_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AgentCustomFieldValue] ADD CONSTRAINT [AgentCustomFieldValue_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AgentCustomFieldValue] ADD CONSTRAINT [AgentCustomFieldValue_fieldDefinitionId_fkey] FOREIGN KEY ([fieldDefinitionId]) REFERENCES [dbo].[CustomFieldDefinition]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AssetNote] ADD CONSTRAINT [AssetNote_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AssetNote] ADD CONSTRAINT [AssetNote_createdByAdminId_fkey] FOREIGN KEY ([createdByAdminId]) REFERENCES [dbo].[AdminUser]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
