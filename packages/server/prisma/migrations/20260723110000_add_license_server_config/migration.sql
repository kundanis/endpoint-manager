BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[LicenseServerConfig] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [LicenseServerConfig_id_df] DEFAULT 'singleton',
    [serverUrl] NVARCHAR(500) NOT NULL,
    [lastConnectionCheckAt] DATETIME2,
    [lastConnectionOk] BIT,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LicenseServerConfig_pkey] PRIMARY KEY CLUSTERED ([id])
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
