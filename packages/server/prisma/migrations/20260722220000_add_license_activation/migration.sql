BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[LicenseActivation] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [LicenseActivation_id_df] DEFAULT 'singleton',
    [deploymentId] NVARCHAR(100) NOT NULL,
    [entityName] NVARCHAR(200) NOT NULL,
    [maxAgents] INT NOT NULL,
    [validityType] NVARCHAR(20) NOT NULL,
    [validUntil] DATETIME2,
    [keyStringEncrypted] NVARCHAR(500) NOT NULL,
    [bindingTokenEncrypted] NVARCHAR(500) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [LicenseActivation_status_df] DEFAULT 'ACTIVATED',
    [activatedAt] DATETIME2 NOT NULL,
    [lastRevalidatedAt] DATETIME2,
    [lastRevalidationError] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LicenseActivation_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LicenseActivation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LicenseActivation_deploymentId_key] UNIQUE NONCLUSTERED ([deploymentId])
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
