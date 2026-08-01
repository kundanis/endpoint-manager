BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[UsbControlPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [UsbControlPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UsbControlPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [UsbControlPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[UsbControlRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [ruleType] NVARCHAR(30) NOT NULL,
    [value] NVARCHAR(100) NOT NULL,
    [label] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UsbControlRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [UsbControlRule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[UsbControlPolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UsbControlPolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSyncedAt] DATETIME2,
    [lastSyncStatus] NVARCHAR(20),
    [lastSyncError] NVARCHAR(1000),
    CONSTRAINT [UsbControlPolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[UsbControlEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000),
    [serialNumber] NVARCHAR(100) NOT NULL,
    [deviceDescription] NVARCHAR(300),
    [action] NVARCHAR(20) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [UsbControlEvent_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [UsbControlEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PolicyAccessException] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyType] NVARCHAR(30) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [reason] NVARCHAR(1000) NOT NULL,
    [durationMinutes] INT NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [PolicyAccessException_status_df] DEFAULT 'PENDING',
    [requestedByAdminId] NVARCHAR(1000) NOT NULL,
    [approvedByAdminId] NVARCHAR(1000),
    [resolvedAt] DATETIME2,
    [resolutionNote] NVARCHAR(1000),
    [expiresAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PolicyAccessException_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PolicyAccessException_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UsbControlPolicyAssignment_agentId_idx] ON [dbo].[UsbControlPolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UsbControlPolicyAssignment_groupId_idx] ON [dbo].[UsbControlPolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UsbControlEvent_agentId_idx] ON [dbo].[UsbControlEvent]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PolicyAccessException_agentId_idx] ON [dbo].[PolicyAccessException]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PolicyAccessException_policyType_policyId_idx] ON [dbo].[PolicyAccessException]([policyType], [policyId]);

-- AddForeignKey
ALTER TABLE [dbo].[UsbControlRule] ADD CONSTRAINT [UsbControlRule_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[UsbControlPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UsbControlPolicyAssignment] ADD CONSTRAINT [UsbControlPolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[UsbControlPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UsbControlPolicyAssignment] ADD CONSTRAINT [UsbControlPolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UsbControlPolicyAssignment] ADD CONSTRAINT [UsbControlPolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UsbControlEvent] ADD CONSTRAINT [UsbControlEvent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UsbControlEvent] ADD CONSTRAINT [UsbControlEvent_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[UsbControlPolicy]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PolicyAccessException] ADD CONSTRAINT [PolicyAccessException_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
