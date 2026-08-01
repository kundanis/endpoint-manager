BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[EnrollmentToken] ADD [groupId] NVARCHAR(1000);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EnrollmentToken_groupId_idx] ON [dbo].[EnrollmentToken]([groupId]);

-- AddForeignKey
ALTER TABLE [dbo].[EnrollmentToken] ADD CONSTRAINT [EnrollmentToken_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
