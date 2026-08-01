BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Agent] ADD [deviceTypeOverride] NVARCHAR(20);

-- AlterTable
ALTER TABLE [dbo].[InventorySnapshot] ADD [pcSystemType] INT;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
