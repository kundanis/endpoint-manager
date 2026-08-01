BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[SecurityBenchmark] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [source] NVARCHAR(20) NOT NULL,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SecurityBenchmark_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SecurityBenchmark_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SecurityBenchmarkRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [benchmarkId] NVARCHAR(1000) NOT NULL,
    [ruleKey] NVARCHAR(50) NOT NULL,
    [title] NVARCHAR(300) NOT NULL,
    [description] NVARCHAR(2000),
    [severity] NVARCHAR(20) NOT NULL,
    [checkPowerShell] NVARCHAR(max) NOT NULL,
    [operator] NVARCHAR(20) NOT NULL,
    [expectedValue] NVARCHAR(500) NOT NULL,
    [remediationPowerShell] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SecurityBenchmarkRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SecurityBenchmarkRule_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SecurityBenchmarkRule_benchmarkId_ruleKey_key] UNIQUE NONCLUSTERED ([benchmarkId],[ruleKey])
);

-- CreateTable
CREATE TABLE [dbo].[SecurityBenchmarkAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [benchmarkId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SecurityBenchmarkAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SecurityBenchmarkAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SecurityBenchmarkFinding] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [benchmarkId] NVARCHAR(1000) NOT NULL,
    [ruleId] NVARCHAR(1000) NOT NULL,
    [actualValue] NVARCHAR(2000),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [SecurityBenchmarkFinding_status_df] DEFAULT 'FAIL',
    [detectedAt] DATETIME2 NOT NULL CONSTRAINT [SecurityBenchmarkFinding_detectedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [SecurityBenchmarkFinding_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    [resolvedAt] DATETIME2,
    CONSTRAINT [SecurityBenchmarkFinding_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SecurityBenchmarkFinding_agentId_ruleId_key] UNIQUE NONCLUSTERED ([agentId],[ruleId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SecurityBenchmarkAssignment_agentId_idx] ON [dbo].[SecurityBenchmarkAssignment]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SecurityBenchmarkAssignment_groupId_idx] ON [dbo].[SecurityBenchmarkAssignment]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SecurityBenchmarkFinding_agentId_status_idx] ON [dbo].[SecurityBenchmarkFinding]([agentId], [status]);

-- AddForeignKey
ALTER TABLE [dbo].[SecurityBenchmarkRule] ADD CONSTRAINT [SecurityBenchmarkRule_benchmarkId_fkey] FOREIGN KEY ([benchmarkId]) REFERENCES [dbo].[SecurityBenchmark]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[SecurityBenchmarkAssignment] ADD CONSTRAINT [SecurityBenchmarkAssignment_benchmarkId_fkey] FOREIGN KEY ([benchmarkId]) REFERENCES [dbo].[SecurityBenchmark]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[SecurityBenchmarkAssignment] ADD CONSTRAINT [SecurityBenchmarkAssignment_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[SecurityBenchmarkAssignment] ADD CONSTRAINT [SecurityBenchmarkAssignment_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[AssetGroup]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[SecurityBenchmarkFinding] ADD CONSTRAINT [SecurityBenchmarkFinding_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[SecurityBenchmarkFinding] ADD CONSTRAINT [SecurityBenchmarkFinding_benchmarkId_fkey] FOREIGN KEY ([benchmarkId]) REFERENCES [dbo].[SecurityBenchmark]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SecurityBenchmarkFinding] ADD CONSTRAINT [SecurityBenchmarkFinding_ruleId_fkey] FOREIGN KEY ([ruleId]) REFERENCES [dbo].[SecurityBenchmarkRule]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
