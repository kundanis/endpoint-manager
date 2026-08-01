BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[DataDiscoveryScanState] DROP CONSTRAINT [DataDiscoveryScanState_lastScannedAt_df];
ALTER TABLE [dbo].[DataDiscoveryScanState] ALTER COLUMN [filesScanned] INT NULL;
ALTER TABLE [dbo].[DataDiscoveryScanState] ALTER COLUMN [lastScannedAt] DATETIME2 NULL;
ALTER TABLE [dbo].[DataDiscoveryScanState] ADD [scanRequested] BIT NOT NULL CONSTRAINT [DataDiscoveryScanState_scanRequested_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
