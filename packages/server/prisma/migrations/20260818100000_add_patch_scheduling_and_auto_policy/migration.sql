BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[PatchJob] ADD [scheduledAt] DATETIME2;

-- CreateTable
CREATE TABLE [dbo].[AutoPatchPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [AutoPatchPolicy_enabled_df] DEFAULT 1,
    [minSeverity] NVARCHAR(20) NOT NULL,
    [targetGroupIds] NVARCHAR(1000) NOT NULL CONSTRAINT [AutoPatchPolicy_targetGroupIds_df] DEFAULT '[]',
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AutoPatchPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastRunAt] DATETIME2,
    CONSTRAINT [AutoPatchPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
