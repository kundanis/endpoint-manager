BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[ZeroTrustCondition] ADD [enabled] BIT NOT NULL CONSTRAINT [ZeroTrustCondition_enabled_df] DEFAULT 1;

-- AlterTable
ALTER TABLE [dbo].[ZeroTrustPolicy] ADD [enabled] BIT NOT NULL CONSTRAINT [ZeroTrustPolicy_enabled_df] DEFAULT 1;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
