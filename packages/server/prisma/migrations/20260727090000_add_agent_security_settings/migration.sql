BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[AgentSecuritySettings] (
    [id] NVARCHAR(1000) NOT NULL,
    [uninstallPasswordHash] NVARCHAR(200),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AgentSecuritySettings_pkey] PRIMARY KEY CLUSTERED ([id])
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
