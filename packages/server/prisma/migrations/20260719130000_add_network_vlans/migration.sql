BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[NetworkScanRun] ADD [agentId] NVARCHAR(1000),
[vlanId] NVARCHAR(1000),
[vlanNameSnapshot] NVARCHAR(100);

-- CreateTable
CREATE TABLE [dbo].[NetworkVlan] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [description] NVARCHAR(500),
    [cidr] NVARCHAR(50) NOT NULL,
    [assignedAgentId] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [NetworkVlan_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NetworkVlan_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [NetworkVlan_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[NetworkScanTask] (
    [id] NVARCHAR(1000) NOT NULL,
    [scanRunId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [NetworkScanTask_status_df] DEFAULT 'PENDING',
    [dispatchedAt] DATETIME2,
    [completedAt] DATETIME2,
    CONSTRAINT [NetworkScanTask_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [NetworkScanTask_scanRunId_key] UNIQUE NONCLUSTERED ([scanRunId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NetworkScanRun_vlanId_idx] ON [dbo].[NetworkScanRun]([vlanId]);

-- AddForeignKey
ALTER TABLE [dbo].[NetworkScanRun] ADD CONSTRAINT [NetworkScanRun_vlanId_fkey] FOREIGN KEY ([vlanId]) REFERENCES [dbo].[NetworkVlan]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[NetworkScanTask] ADD CONSTRAINT [NetworkScanTask_scanRunId_fkey] FOREIGN KEY ([scanRunId]) REFERENCES [dbo].[NetworkScanRun]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
