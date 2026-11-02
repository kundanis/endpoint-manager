BEGIN TRY

BEGIN TRAN;

-- AlterTable
-- NOT NULL + DEFAULT in one statement backfills every existing row, so all keys issued
-- before this column existed are recorded as Endpoint One keys.
ALTER TABLE [dbo].[LicenseKey] ADD [product] NVARCHAR(20) NOT NULL CONSTRAINT [LicenseKey_product_df] DEFAULT 'ENDPOINT_ONE';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
