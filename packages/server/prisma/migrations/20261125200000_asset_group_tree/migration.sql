BEGIN TRY

BEGIN TRAN;

-- DropUniqueConstraint (group names become unique per parent)
ALTER TABLE [dbo].[AssetGroup] DROP CONSTRAINT [AssetGroup_name_key];

-- AlterTable
ALTER TABLE [dbo].[AssetGroup] ADD [parentId] NVARCHAR(1000);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AssetGroup_parentId_idx] ON [dbo].[AssetGroup]([parentId]);

-- CreateIndex
ALTER TABLE [dbo].[AssetGroup] ADD CONSTRAINT [AssetGroup_parentId_name_key] UNIQUE NONCLUSTERED ([parentId], [name]);

-- AddForeignKey
ALTER TABLE [dbo].[AssetGroup] ADD CONSTRAINT [AssetGroup_parentId_fkey] FOREIGN KEY ([parentId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

