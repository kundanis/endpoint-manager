BEGIN TRY

BEGIN TRAN;

-- DLP -> Screen capture monitoring: policies, their assignments and one row per screenshot.

-- CreateTable
CREATE TABLE [dbo].[ScreenCapturePolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [dailyThreshold] INT NOT NULL CONSTRAINT [ScreenCapturePolicy_dailyThreshold_df] DEFAULT 10,
    [quickDeleteMinutes] INT NOT NULL CONSTRAINT [ScreenCapturePolicy_quickDeleteMinutes_df] DEFAULT 10,
    [monitorWindows] BIT NOT NULL CONSTRAINT [ScreenCapturePolicy_monitorWindows_df] DEFAULT 1,
    [monitorSnippingTool] BIT NOT NULL CONSTRAINT [ScreenCapturePolicy_monitorSnippingTool_df] DEFAULT 1,
    [monitorGameBar] BIT NOT NULL CONSTRAINT [ScreenCapturePolicy_monitorGameBar_df] DEFAULT 1,
    [monitorThirdParty] BIT NOT NULL CONSTRAINT [ScreenCapturePolicy_monitorThirdParty_df] DEFAULT 1,
    [extraPaths] NVARCHAR(max) NOT NULL CONSTRAINT [ScreenCapturePolicy_extraPaths_df] DEFAULT '[]',
    [trackOpenedBy] BIT NOT NULL CONSTRAINT [ScreenCapturePolicy_trackOpenedBy_df] DEFAULT 1,
    [enabled] BIT NOT NULL CONSTRAINT [ScreenCapturePolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ScreenCapturePolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ScreenCapturePolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ScreenCapturePolicyAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ScreenCapturePolicyAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ScreenCapturePolicyAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ScreenCaptureEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [username] NVARCHAR(200) NOT NULL,
    [source] NVARCHAR(20) NOT NULL,
    [filePath] NVARCHAR(1000) NOT NULL,
    [fileSizeBytes] BIGINT NOT NULL,
    [capturedAt] DATETIME2 NOT NULL,
    [captureDay] NVARCHAR(10) NOT NULL,
    [deletedAt] DATETIME2,
    [openedBy] NVARCHAR(2000) NOT NULL CONSTRAINT [ScreenCaptureEvent_openedBy_df] DEFAULT '[]',
    [detectedAt] DATETIME2 NOT NULL CONSTRAINT [ScreenCaptureEvent_detectedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ScreenCaptureEvent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ScreenCaptureEvent_agentId_filePath_capturedAt_key] UNIQUE NONCLUSTERED ([agentId],[filePath],[capturedAt])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ScreenCapturePolicyAssignment_agentId_idx] ON [dbo].[ScreenCapturePolicyAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ScreenCapturePolicyAssignment_groupId_idx] ON [dbo].[ScreenCapturePolicyAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ScreenCaptureEvent_agentId_captureDay_idx] ON [dbo].[ScreenCaptureEvent]([agentId], [captureDay]);

-- AddForeignKey
ALTER TABLE [dbo].[ScreenCapturePolicyAssignment] ADD CONSTRAINT [ScreenCapturePolicyAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[ScreenCapturePolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ScreenCapturePolicyAssignment] ADD CONSTRAINT [ScreenCapturePolicyAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ScreenCapturePolicyAssignment] ADD CONSTRAINT [ScreenCapturePolicyAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ScreenCaptureEvent] ADD CONSTRAINT [ScreenCaptureEvent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
