BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[AgentConnectionSettings] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [AgentConnectionSettings_id_df] DEFAULT 'singleton',
    [localUrl] NVARCHAR(500),
    [webUrl] NVARCHAR(500),
    [publicUrl] NVARCHAR(500),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentConnectionSettings_pkey] PRIMARY KEY CLUSTERED ([id])
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
