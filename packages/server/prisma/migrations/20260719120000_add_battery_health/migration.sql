BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[InventorySnapshot] ADD [batteryAcConnected] BIT,
[batteryChargePercent] INT,
[batteryCharging] BIT,
[batteryCycleCount] INT,
[batteryDesignCapacityMwh] INT,
[batteryFullChargeCapacityMwh] INT,
[batteryPresent] BIT NOT NULL CONSTRAINT [InventorySnapshot_batteryPresent_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
