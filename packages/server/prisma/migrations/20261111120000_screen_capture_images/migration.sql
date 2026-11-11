BEGIN TRY

BEGIN TRAN;

-- Screen capture: optionally keep the screenshot image itself (super admins only can see it).
-- New columns only; existing policies keep images off.

-- AlterTable
ALTER TABLE [dbo].[ScreenCapturePolicy] ADD [saveImages] BIT NOT NULL CONSTRAINT [ScreenCapturePolicy_saveImages_df] DEFAULT 0,
[saveImagesAllEndpoints] BIT NOT NULL CONSTRAINT [ScreenCapturePolicy_saveImagesAllEndpoints_df] DEFAULT 1,
[saveImagesAgentIds] NVARCHAR(max) NOT NULL CONSTRAINT [ScreenCapturePolicy_saveImagesAgentIds_df] DEFAULT '[]',
[imageRetentionDays] INT NOT NULL CONSTRAINT [ScreenCapturePolicy_imageRetentionDays_df] DEFAULT 30;

-- AlterTable
ALTER TABLE [dbo].[ScreenCaptureEvent] ADD [imageFile] NVARCHAR(300),
[imageSizeBytes] BIGINT,
[imageSavedAt] DATETIME2;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
