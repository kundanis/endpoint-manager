BEGIN TRY

BEGIN TRAN;

-- The token value itself, encrypted with FIELD_ENCRYPTION_KEY, so a token's setup file can
-- be downloaded again later from the token list. NULL for tokens created before this
-- (only their hash was ever stored - they keep working, but can't be re-downloaded).
ALTER TABLE [dbo].[EnrollmentToken] ADD [tokenEncrypted] NVARCHAR(500);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
