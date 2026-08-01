BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[CommandBlockPolicy] ADD [enforcementMode] NVARCHAR(20) NOT NULL CONSTRAINT [CommandBlockPolicy_enforcementMode_df] DEFAULT 'BLOCK';

-- AlterTable
ALTER TABLE [dbo].[CommandBlockEvent] ADD [action] NVARCHAR(20) NOT NULL CONSTRAINT [CommandBlockEvent_action_df] DEFAULT 'BLOCKED';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
