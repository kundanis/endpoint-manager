BEGIN TRY

BEGIN TRAN;

-- DropIndex
-- The original CONSTRAINT ... UNIQUE ([bindingTokenHash]) is a plain unique index,
-- which in SQL Server permits at most ONE NULL row across the whole table. Every
-- not-yet-activated LicenseKey has bindingTokenHash = NULL, so this broke on the
-- second unactivated key ever created ("Unique constraint failed" on every issue
-- after the first). Replaced below with a FILTERED unique index that only applies
-- to non-null values, which is the correct way to express "unique when set" in SQL
-- Server (Prisma's schema-level @unique cannot express this, so this column is no
-- longer marked @unique in schema.prisma - uniqueness now lives only here).
ALTER TABLE [dbo].[LicenseKey] DROP CONSTRAINT [LicenseKey_bindingTokenHash_key];

-- CreateIndex
CREATE UNIQUE NONCLUSTERED INDEX [LicenseKey_bindingTokenHash_key] ON [dbo].[LicenseKey]([bindingTokenHash]) WHERE [bindingTokenHash] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
