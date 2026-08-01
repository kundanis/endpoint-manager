BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[AdminUser] (
    [id] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(255) NOT NULL,
    [passwordHash] NVARCHAR(100) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AdminUser_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastLoginAt] DATETIME2,
    CONSTRAINT [AdminUser_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AdminUser_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[EnrollmentToken] (
    [id] NVARCHAR(1000) NOT NULL,
    [tokenHash] NVARCHAR(128) NOT NULL,
    [label] NVARCHAR(1000) NOT NULL,
    [usesRemaining] INT NOT NULL CONSTRAINT [EnrollmentToken_usesRemaining_df] DEFAULT 1,
    [expiresAt] DATETIME2 NOT NULL,
    [revoked] BIT NOT NULL CONSTRAINT [EnrollmentToken_revoked_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EnrollmentToken_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [EnrollmentToken_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EnrollmentToken_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[Agent] (
    [id] NVARCHAR(1000) NOT NULL,
    [hostname] NVARCHAR(1000) NOT NULL,
    [apiKeyHash] NVARCHAR(128) NOT NULL,
    [osPlatform] NVARCHAR(1000) NOT NULL,
    [osVersion] NVARCHAR(1000) NOT NULL,
    [osArch] NVARCHAR(1000) NOT NULL,
    [agentVersion] NVARCHAR(1000) NOT NULL,
    [ipAddress] NVARCHAR(1000),
    [macAddress] NVARCHAR(1000),
    [tags] NVARCHAR(1000) NOT NULL CONSTRAINT [Agent_tags_df] DEFAULT '[]',
    [lastCheckinAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Agent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Agent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Agent_apiKeyHash_key] UNIQUE NONCLUSTERED ([apiKeyHash])
);

-- CreateTable
CREATE TABLE [dbo].[InventorySnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [cpuModel] NVARCHAR(1000),
    [cpuCores] INT,
    [totalMemBytes] BIGINT,
    [osInfo] NVARCHAR(max) NOT NULL,
    [diskInfo] NVARCHAR(max) NOT NULL,
    [installedSoftware] NVARCHAR(max) NOT NULL,
    [collectedAt] DATETIME2 NOT NULL CONSTRAINT [InventorySnapshot_collectedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [InventorySnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [InventorySnapshot_agentId_key] UNIQUE NONCLUSTERED ([agentId])
);

-- CreateTable
CREATE TABLE [dbo].[CommandJob] (
    [id] NVARCHAR(1000) NOT NULL,
    [shell] NVARCHAR(1000) NOT NULL,
    [script] NVARCHAR(max) NOT NULL,
    [timeoutSec] INT NOT NULL CONSTRAINT [CommandJob_timeoutSec_df] DEFAULT 120,
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CommandJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CommandJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CommandTask] (
    [id] NVARCHAR(1000) NOT NULL,
    [jobId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [CommandTask_status_df] DEFAULT 'PENDING',
    [exitCode] INT,
    [stdout] NVARCHAR(max),
    [stderr] NVARCHAR(max),
    [dispatchedAt] DATETIME2,
    [completedAt] DATETIME2,
    CONSTRAINT [CommandTask_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Package] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [version] NVARCHAR(1000) NOT NULL,
    [filename] NVARCHAR(1000) NOT NULL,
    [storagePath] NVARCHAR(1000) NOT NULL,
    [fileSizeBytes] INT NOT NULL,
    [sha256] NVARCHAR(1000) NOT NULL,
    [installerType] NVARCHAR(1000) NOT NULL,
    [silentArgs] NVARCHAR(1000) NOT NULL,
    [uploadedByAdminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Package_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Package_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DeploymentJob] (
    [id] NVARCHAR(1000) NOT NULL,
    [packageId] NVARCHAR(1000) NOT NULL,
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DeploymentJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DeploymentJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DeploymentTask] (
    [id] NVARCHAR(1000) NOT NULL,
    [jobId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [DeploymentTask_status_df] DEFAULT 'PENDING',
    [exitCode] INT,
    [message] NVARCHAR(max),
    [dispatchedAt] DATETIME2,
    [completedAt] DATETIME2,
    CONSTRAINT [DeploymentTask_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[InventorySnapshot] ADD CONSTRAINT [InventorySnapshot_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[CommandTask] ADD CONSTRAINT [CommandTask_jobId_fkey] FOREIGN KEY ([jobId]) REFERENCES [dbo].[CommandJob]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[CommandTask] ADD CONSTRAINT [CommandTask_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DeploymentJob] ADD CONSTRAINT [DeploymentJob_packageId_fkey] FOREIGN KEY ([packageId]) REFERENCES [dbo].[Package]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DeploymentTask] ADD CONSTRAINT [DeploymentTask_jobId_fkey] FOREIGN KEY ([jobId]) REFERENCES [dbo].[DeploymentJob]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DeploymentTask] ADD CONSTRAINT [DeploymentTask_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
