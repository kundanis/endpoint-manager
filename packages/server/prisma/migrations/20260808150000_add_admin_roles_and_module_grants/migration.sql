BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[AdminUser] ADD [role] NVARCHAR(20) NOT NULL CONSTRAINT [AdminUser_role_df] DEFAULT 'ADMIN',
[createdByAdminId] NVARCHAR(64);

-- CreateTable
CREATE TABLE [dbo].[AdminModuleGrant] (
    [id] NVARCHAR(1000) NOT NULL,
    [adminUserId] NVARCHAR(1000) NOT NULL,
    [moduleKey] NVARCHAR(30) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AdminModuleGrant_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AdminModuleGrant_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AdminModuleGrant_adminUserId_moduleKey_key] UNIQUE NONCLUSTERED ([adminUserId],[moduleKey])
);

-- AddForeignKey
ALTER TABLE [dbo].[AdminModuleGrant] ADD CONSTRAINT [AdminModuleGrant_adminUserId_fkey] FOREIGN KEY ([adminUserId]) REFERENCES [dbo].[AdminUser]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- The pre-existing bootstrap admin (seeded from ADMIN_EMAIL/ADMIN_PASSWORD) must become a
-- super admin - otherwise no account could ever create the first super admin post-migration.
-- Wrapped in dynamic SQL: referencing [role] directly here would fail to compile within
-- this same batch (SQL Server resolves column names for the whole batch up front, before
-- the ALTER TABLE above has taken effect) - EXEC() defers compilation to runtime, by
-- which point the column exists.
EXEC(N'UPDATE [dbo].[AdminUser] SET [role] = ''SUPER_ADMIN''');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
