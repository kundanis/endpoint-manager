BEGIN TRY

BEGIN TRAN;

-- AlterTable: features within the licensed modules (null = everything in them)
ALTER TABLE [dbo].[LicenseActivation] ADD [features] NVARCHAR(2000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
