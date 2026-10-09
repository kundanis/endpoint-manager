BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Agent] ADD [pausedFromQuarantined] BIT NOT NULL CONSTRAINT [Agent_pausedFromQuarantined_df] DEFAULT 0,
[pausedFromRemoteAccessEnabled] BIT NOT NULL CONSTRAINT [Agent_pausedFromRemoteAccessEnabled_df] DEFAULT 0,
[pausedFromRemoteAccessAllowedIp] NVARCHAR(45);

-- AlterTable
ALTER TABLE [dbo].[LicenseActivation] ADD [totalAgentsUninstalled] INT NOT NULL CONSTRAINT [LicenseActivation_totalAgentsUninstalled_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
