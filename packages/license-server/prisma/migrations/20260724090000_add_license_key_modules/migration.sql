BEGIN TRY

BEGIN TRAN;

-- AlterTable
-- NOT NULL + DEFAULT in the same statement backfills every existing row with the
-- default value (SQL Server does this automatically for ADD COLUMN) - existing keys
-- retroactively get every module rather than none, since they were issued before this
-- feature existed and shouldn't suddenly lose access to features they already had.
ALTER TABLE [dbo].[LicenseKey] ADD [modules] NVARCHAR(1000) NOT NULL CONSTRAINT [LicenseKey_modules_df] DEFAULT '["ENDPOINT_MANAGER","NETWORK_MANAGER","SOFTWARE_MANAGER","SECURITY_MANAGER","DATA_MANAGER","USER_MANAGER"]';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
