BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[UserProductivityDailyLog] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [username] NVARCHAR(300) NOT NULL,
    [logDate] DATETIME2 NOT NULL,
    [firstLoginAt] DATETIME2 NOT NULL,
    [lastLogoutAt] DATETIME2,
    [activeSecondsTotal] INT NOT NULL CONSTRAINT [UserProductivityDailyLog_activeSecondsTotal_df] DEFAULT 0,
    [idleSecondsTotal] INT NOT NULL CONSTRAINT [UserProductivityDailyLog_idleSecondsTotal_df] DEFAULT 0,
    CONSTRAINT [UserProductivityDailyLog_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UserProductivityDailyLog_agentId_username_logDate_key] UNIQUE NONCLUSTERED ([agentId],[username],[logDate])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserProductivityDailyLog_agentId_idx] ON [dbo].[UserProductivityDailyLog]([agentId]);

-- AddForeignKey
ALTER TABLE [dbo].[UserProductivityDailyLog] ADD CONSTRAINT [UserProductivityDailyLog_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
