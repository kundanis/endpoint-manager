BEGIN TRY

BEGIN TRAN;

-- The vendor's description of each update, shown under its title on the Patches page so an
-- admin knows why a patch is needed before dispatching it.
ALTER TABLE [dbo].[PatchDefinition] ADD [description] NVARCHAR(2000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
