BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[ModuleVisibilitySettings] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [ModuleVisibilitySettings_id_df] DEFAULT 'singleton',
    [hiddenModuleKeys] NVARCHAR(1000) NOT NULL CONSTRAINT [ModuleVisibilitySettings_hiddenModuleKeys_df] DEFAULT '[]',
    [hiddenItemPaths] NVARCHAR(2000) NOT NULL CONSTRAINT [ModuleVisibilitySettings_hiddenItemPaths_df] DEFAULT '[]',
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ModuleVisibilitySettings_pkey] PRIMARY KEY CLUSTERED ([id])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
