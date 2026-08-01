BEGIN TRY

BEGIN TRAN;

-- DropForeignKey
ALTER TABLE [dbo].[CommandTask] DROP CONSTRAINT [CommandTask_agentId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[DeploymentTask] DROP CONSTRAINT [DeploymentTask_agentId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[InventorySnapshot] DROP CONSTRAINT [InventorySnapshot_agentId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[PatchTask] DROP CONSTRAINT [PatchTask_agentId_fkey];

-- AddForeignKey
ALTER TABLE [dbo].[InventorySnapshot] ADD CONSTRAINT [InventorySnapshot_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[CommandTask] ADD CONSTRAINT [CommandTask_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DeploymentTask] ADD CONSTRAINT [DeploymentTask_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PatchTask] ADD CONSTRAINT [PatchTask_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
