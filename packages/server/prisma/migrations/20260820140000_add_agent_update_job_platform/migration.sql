BEGIN TRY

BEGIN TRAN;

-- AlterTable
-- Default 'win32' backfills every job created before the Linux agent existed - all of them
-- were implicitly Windows-only, since no other platform's build could ever have been staged.
ALTER TABLE [dbo].[AgentUpdateJob] ADD [platform] NVARCHAR(20) NOT NULL CONSTRAINT [AgentUpdateJob_platform_df] DEFAULT 'win32';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
