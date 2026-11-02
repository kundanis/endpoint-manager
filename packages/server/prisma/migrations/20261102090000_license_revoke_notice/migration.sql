BEGIN TRY

BEGIN TRAN;

-- Licensing: no more periodic re-validation or offline grace window - the License Server
-- pushes revoke notices instead, to the address this deployment registers with it.

-- AlterTable
ALTER TABLE [dbo].[LicenseActivation] ADD [callbackUrls] NVARCHAR(2000),
[revocationSecretHash] NVARCHAR(128),
[callbackRegisteredAt] DATETIME2,
[callbackRegistrationError] NVARCHAR(1000);

-- A leftover "License Server unreachable" from the old re-validation loop no longer means
-- anything, and the console would still show it as an issue.
EXEC('UPDATE [dbo].[LicenseActivation] SET [lastRevalidationError] = NULL WHERE [status] = ''ACTIVATED''');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
