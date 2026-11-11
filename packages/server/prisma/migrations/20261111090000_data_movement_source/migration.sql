BEGIN TRY

BEGIN TRAN;

-- Data movement: where a file came from, whether it was copied or moved, and who was signed in
-- (new nullable columns only; events recorded before this stay as they are).

-- AlterTable
ALTER TABLE [dbo].[DataMovementEvent] ADD [sourcePath] NVARCHAR(1000),
[operation] NVARCHAR(10),
[userName] NVARCHAR(200);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
