BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Agent] ADD [remoteAccessEnabled] BIT NOT NULL CONSTRAINT [Agent_remoteAccessEnabled_df] DEFAULT 0,
[remoteAccessEnabledAt] DATETIME2,
[remoteAccessAllowedIp] NVARCHAR(45);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
