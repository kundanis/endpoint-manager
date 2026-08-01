BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[LicenseAdmin] (
    [id] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(255) NOT NULL,
    [passwordHash] NVARCHAR(100) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LicenseAdmin_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastLoginAt] DATETIME2,
    CONSTRAINT [LicenseAdmin_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LicenseAdmin_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Entity] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [contactEmail] NVARCHAR(255),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Entity_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Entity_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[LicenseKey] (
    [id] NVARCHAR(1000) NOT NULL,
    [keyStringHash] NVARCHAR(128) NOT NULL,
    [keySuffix] NVARCHAR(10) NOT NULL,
    [entityId] NVARCHAR(1000) NOT NULL,
    [maxAgents] INT NOT NULL,
    [validityType] NVARCHAR(20) NOT NULL,
    [validUntil] DATETIME2,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [LicenseKey_status_df] DEFAULT 'ISSUED',
    [boundDeploymentId] NVARCHAR(100),
    [bindingTokenHash] NVARCHAR(128),
    [issuedByAdminId] NVARCHAR(1000) NOT NULL,
    [issuedAt] DATETIME2 NOT NULL CONSTRAINT [LicenseKey_issuedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [activatedAt] DATETIME2,
    [revokedAt] DATETIME2,
    CONSTRAINT [LicenseKey_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LicenseKey_keyStringHash_key] UNIQUE NONCLUSTERED ([keyStringHash]),
    CONSTRAINT [LicenseKey_bindingTokenHash_key] UNIQUE NONCLUSTERED ([bindingTokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[UnlockRequest] (
    [id] NVARCHAR(1000) NOT NULL,
    [licenseKeyId] NVARCHAR(1000) NOT NULL,
    [requestingDeploymentId] NVARCHAR(100) NOT NULL,
    [reason] NVARCHAR(2000) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [UnlockRequest_status_df] DEFAULT 'PENDING',
    [requestedAt] DATETIME2 NOT NULL CONSTRAINT [UnlockRequest_requestedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [resolvedAt] DATETIME2,
    [resolvedByAdminId] NVARCHAR(1000),
    [resolutionNote] NVARCHAR(1000),
    CONSTRAINT [UnlockRequest_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LicenseKey_entityId_idx] ON [dbo].[LicenseKey]([entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UnlockRequest_licenseKeyId_idx] ON [dbo].[UnlockRequest]([licenseKeyId]);

-- AddForeignKey
ALTER TABLE [dbo].[LicenseKey] ADD CONSTRAINT [LicenseKey_entityId_fkey] FOREIGN KEY ([entityId]) REFERENCES [dbo].[Entity]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[UnlockRequest] ADD CONSTRAINT [UnlockRequest_licenseKeyId_fkey] FOREIGN KEY ([licenseKeyId]) REFERENCES [dbo].[LicenseKey]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
