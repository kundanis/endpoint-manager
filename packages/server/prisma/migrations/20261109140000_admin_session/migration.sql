BEGIN TRY

BEGIN TRAN;

-- Server-side console sessions: Sign out, inactivity and password changes end a session on the
-- server, so a captured session cookie stops working (new table only).

-- CreateTable
CREATE TABLE [dbo].[AdminSession] (
    [id] NVARCHAR(1000) NOT NULL,
    [adminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AdminSession_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [AdminSession_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [ipAddress] NVARCHAR(100),
    CONSTRAINT [AdminSession_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AdminSession_adminId_idx] ON [dbo].[AdminSession]([adminId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AdminSession_expiresAt_idx] ON [dbo].[AdminSession]([expiresAt]);

-- AddForeignKey
ALTER TABLE [dbo].[AdminSession] ADD CONSTRAINT [AdminSession_adminId_fkey] FOREIGN KEY ([adminId]) REFERENCES [dbo].[AdminUser]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
