BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[RemoteInstallJob] (
    [id] NVARCHAR(1000) NOT NULL,
    [tokenId] NVARCHAR(1000),
    [serverUrl] NVARCHAR(1000) NOT NULL,
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RemoteInstallJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [RemoteInstallJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[RemoteInstallTask] (
    [id] NVARCHAR(1000) NOT NULL,
    [jobId] NVARCHAR(1000) NOT NULL,
    [target] NVARCHAR(255) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [RemoteInstallTask_status_df] DEFAULT 'PENDING',
    [output] NVARCHAR(max),
    [errorMessage] NVARCHAR(max),
    [startedAt] DATETIME2,
    [completedAt] DATETIME2,
    CONSTRAINT [RemoteInstallTask_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[RemoteInstallJob] ADD CONSTRAINT [RemoteInstallJob_tokenId_fkey] FOREIGN KEY ([tokenId]) REFERENCES [dbo].[EnrollmentToken]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[RemoteInstallTask] ADD CONSTRAINT [RemoteInstallTask_jobId_fkey] FOREIGN KEY ([jobId]) REFERENCES [dbo].[RemoteInstallJob]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
