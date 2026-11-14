BEGIN TRY

BEGIN TRAN;

-- Remote install account (Asset settings): two optional columns on the existing singleton
-- settings row. No other table or data changes; both start empty.

-- AlterTable
ALTER TABLE [dbo].[AgentSecuritySettings] ADD [remoteInstallPasswordEncrypted] NVARCHAR(1000),
[remoteInstallUsername] NVARCHAR(200);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
