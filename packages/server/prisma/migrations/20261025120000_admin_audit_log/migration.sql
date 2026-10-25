BEGIN TRY

BEGIN TRAN;

-- Identity Governance -> Admin logs: append-only record of admin actions, and its retention.

-- CreateTable
CREATE TABLE [dbo].[AdminAuditLog] (
    [id] NVARCHAR(1000) NOT NULL,
    [at] DATETIME2 NOT NULL CONSTRAINT [AdminAuditLog_at_df] DEFAULT CURRENT_TIMESTAMP,
    [adminId] NVARCHAR(1000),
    [adminEmail] NVARCHAR(320) NOT NULL,
    [ipAddress] NVARCHAR(64),
    [category] NVARCHAR(40) NOT NULL,
    [action] NVARCHAR(60) NOT NULL,
    [module] NVARCHAR(60),
    [summary] NVARCHAR(500) NOT NULL,
    [targetId] NVARCHAR(100),
    [method] NVARCHAR(10),
    [path] NVARCHAR(500),
    [statusCode] INT,
    [success] BIT NOT NULL,
    [detail] NVARCHAR(max) NOT NULL CONSTRAINT [AdminAuditLog_detail_df] DEFAULT '{}',
    CONSTRAINT [AdminAuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AdminAuditConfig] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [AdminAuditConfig_id_df] DEFAULT 'singleton',
    [retentionDays] INT NOT NULL CONSTRAINT [AdminAuditConfig_retentionDays_df] DEFAULT 365,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AdminAuditConfig_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AdminAuditLog_at_idx] ON [dbo].[AdminAuditLog]([at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AdminAuditLog_adminEmail_at_idx] ON [dbo].[AdminAuditLog]([adminEmail], [at]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
