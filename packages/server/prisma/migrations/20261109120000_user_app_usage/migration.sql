BEGIN TRY

BEGIN TRAN;

-- User productivity: time per application and per website, per user per day (new table only).

-- CreateTable
CREATE TABLE [dbo].[UserAppUsageDaily] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [username] NVARCHAR(300) NOT NULL,
    [logDate] DATETIME2 NOT NULL,
    [kind] NVARCHAR(10) NOT NULL,
    [key] NVARCHAR(255) NOT NULL,
    [label] NVARCHAR(300) NOT NULL,
    [activeSeconds] INT NOT NULL CONSTRAINT [UserAppUsageDaily_activeSeconds_df] DEFAULT 0,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [UserAppUsageDaily_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UserAppUsageDaily_agentId_username_logDate_kind_key_key] UNIQUE NONCLUSTERED ([agentId],[username],[logDate],[kind],[key])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserAppUsageDaily_logDate_kind_idx] ON [dbo].[UserAppUsageDaily]([logDate], [kind]);

-- AddForeignKey
ALTER TABLE [dbo].[UserAppUsageDaily] ADD CONSTRAINT [UserAppUsageDaily_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
