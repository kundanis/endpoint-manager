BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[UserSession] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [username] NVARCHAR(300) NOT NULL,
    [loginAt] DATETIME2 NOT NULL,
    [lastSeenAt] DATETIME2 NOT NULL,
    [logoutAt] DATETIME2,
    [currentIdleSeconds] INT NOT NULL CONSTRAINT [UserSession_currentIdleSeconds_df] DEFAULT 0,
    [activeSecondsTotal] INT NOT NULL CONSTRAINT [UserSession_activeSecondsTotal_df] DEFAULT 0,
    [idleSecondsTotal] INT NOT NULL CONSTRAINT [UserSession_idleSecondsTotal_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [UserSession_isActive_df] DEFAULT 1,
    CONSTRAINT [UserSession_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UserSession_agentId_username_loginAt_key] UNIQUE NONCLUSTERED ([agentId],[username],[loginAt])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserSession_agentId_idx] ON [dbo].[UserSession]([agentId]);

-- AddForeignKey
ALTER TABLE [dbo].[UserSession] ADD CONSTRAINT [UserSession_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
