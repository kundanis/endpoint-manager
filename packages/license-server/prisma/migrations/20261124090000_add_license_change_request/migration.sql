BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[LicenseChangeRequest] (
    [id] NVARCHAR(1000) NOT NULL,
    [licenseKeyId] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(20) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [LicenseChangeRequest_status_df] DEFAULT 'PENDING',
    [message] NVARCHAR(1000),
    [currentTerms] NVARCHAR(2000) NOT NULL,
    [proposedTerms] NVARCHAR(2000) NOT NULL,
    [autoApplyAt] DATETIME2,
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LicenseChangeRequest_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [deliveredStatus] NVARCHAR(20),
    [deliveredAt] DATETIME2,
    [lastDeliveryError] NVARCHAR(1000),
    [respondedAt] DATETIME2,
    [responseReason] NVARCHAR(1000),
    [appliedAt] DATETIME2,
    CONSTRAINT [LicenseChangeRequest_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LicenseChangeRequest_licenseKeyId_idx] ON [dbo].[LicenseChangeRequest]([licenseKeyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LicenseChangeRequest_status_idx] ON [dbo].[LicenseChangeRequest]([status]);

-- AddForeignKey
ALTER TABLE [dbo].[LicenseChangeRequest] ADD CONSTRAINT [LicenseChangeRequest_licenseKeyId_fkey] FOREIGN KEY ([licenseKeyId]) REFERENCES [dbo].[LicenseKey]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

