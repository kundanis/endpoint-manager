BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[LicenseChangeNotice] (
    [id] NVARCHAR(1000) NOT NULL,
    [remoteId] NVARCHAR(100) NOT NULL,
    [kind] NVARCHAR(20) NOT NULL,
    [status] NVARCHAR(20) NOT NULL,
    [message] NVARCHAR(1000),
    [currentTerms] NVARCHAR(2000),
    [proposedTerms] NVARCHAR(2000),
    [requestedAt] DATETIME2 NOT NULL,
    [autoApplyAt] DATETIME2,
    [receivedAt] DATETIME2 NOT NULL CONSTRAINT [LicenseChangeNotice_receivedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [respondedAt] DATETIME2,
    [respondedByAdminId] NVARCHAR(64),
    [responseReason] NVARCHAR(1000),
    [appliedAt] DATETIME2,
    CONSTRAINT [LicenseChangeNotice_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LicenseChangeNotice_remoteId_key] UNIQUE NONCLUSTERED ([remoteId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LicenseChangeNotice_status_idx] ON [dbo].[LicenseChangeNotice]([status]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

