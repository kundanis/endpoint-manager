BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[LicenseKey] ADD [callbackUrls] NVARCHAR(2000),
[revocationSecret] NVARCHAR(128),
[revokeNoticeDeliveredAt] DATETIME2,
[revokeNoticeLastError] NVARCHAR(1000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
