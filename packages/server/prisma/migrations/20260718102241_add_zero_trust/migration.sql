BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[ZeroTrustPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ZeroTrustPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ZeroTrustPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ZeroTrustCondition] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [conditionKey] NVARCHAR(50) NOT NULL,
    [title] NVARCHAR(300) NOT NULL,
    [description] NVARCHAR(2000),
    [checkPowerShell] NVARCHAR(max) NOT NULL,
    [operator] NVARCHAR(20) NOT NULL,
    [expectedValue] NVARCHAR(500) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ZeroTrustCondition_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ZeroTrustCondition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ZeroTrustCondition_policyId_conditionKey_key] UNIQUE NONCLUSTERED ([policyId],[conditionKey])
);

-- CreateTable
CREATE TABLE [dbo].[ZeroTrustPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ZeroTrustPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ZeroTrustPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ZeroTrustFinding] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [conditionId] NVARCHAR(1000) NOT NULL,
    [actualValue] NVARCHAR(2000),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [ZeroTrustFinding_status_df] DEFAULT 'FAIL',
    [detectedAt] DATETIME2 NOT NULL CONSTRAINT [ZeroTrustFinding_detectedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [ZeroTrustFinding_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ZeroTrustFinding_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ZeroTrustFinding_agentId_conditionId_key] UNIQUE NONCLUSTERED ([agentId],[conditionId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ZeroTrustPolicyAssignment_agentId_idx] ON [dbo].[ZeroTrustPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ZeroTrustPolicyAssignment_groupId_idx] ON [dbo].[ZeroTrustPolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ZeroTrustFinding_agentId_status_idx] ON [dbo].[ZeroTrustFinding]([agentId], [status]);

-- AddForeignKey
ALTER TABLE [dbo].[ZeroTrustCondition] ADD CONSTRAINT [ZeroTrustCondition_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[ZeroTrustPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ZeroTrustPolicyAssignment] ADD CONSTRAINT [ZeroTrustPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[ZeroTrustPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ZeroTrustPolicyAssignment] ADD CONSTRAINT [ZeroTrustPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ZeroTrustPolicyAssignment] ADD CONSTRAINT [ZeroTrustPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ZeroTrustFinding] ADD CONSTRAINT [ZeroTrustFinding_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ZeroTrustFinding] ADD CONSTRAINT [ZeroTrustFinding_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[ZeroTrustPolicy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ZeroTrustFinding] ADD CONSTRAINT [ZeroTrustFinding_conditionId_fkey] FOREIGN KEY ([conditionId]) REFERENCES [dbo].[ZeroTrustCondition]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
