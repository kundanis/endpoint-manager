BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[PatchDefinition] (
    [id] NVARCHAR(1000) NOT NULL,
    [updateId] NVARCHAR(64) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [title] NVARCHAR(500) NOT NULL,
    [severity] NVARCHAR(50),
    [kbArticleIds] NVARCHAR(1000) NOT NULL CONSTRAINT [PatchDefinition_kbArticleIds_df] DEFAULT '[]',
    [categories] NVARCHAR(1000) NOT NULL CONSTRAINT [PatchDefinition_categories_df] DEFAULT '[]',
    [sizeBytes] BIGINT,
    [firstSeenAt] DATETIME2 NOT NULL CONSTRAINT [PatchDefinition_firstSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [PatchDefinition_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PatchDefinition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PatchDefinition_updateId_key] UNIQUE NONCLUSTERED ([updateId])
);

-- CreateTable
CREATE TABLE [dbo].[PatchFinding] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [patchDefinitionId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PatchFinding_status_df] DEFAULT 'MISSING',
    [detectedAt] DATETIME2 NOT NULL CONSTRAINT [PatchFinding_detectedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [PatchFinding_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    [installedAt] DATETIME2,
    CONSTRAINT [PatchFinding_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PatchFinding_agentId_patchDefinitionId_key] UNIQUE NONCLUSTERED ([agentId],[patchDefinitionId])
);

-- CreateTable
CREATE TABLE [dbo].[PatchJob] (
    [id] NVARCHAR(1000) NOT NULL,
    [updateIds] NVARCHAR(max) NOT NULL,
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PatchJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PatchJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PatchTask] (
    [id] NVARCHAR(1000) NOT NULL,
    [jobId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PatchTask_status_df] DEFAULT 'PENDING',
    [rebootRequired] BIT NOT NULL CONSTRAINT [PatchTask_rebootRequired_df] DEFAULT 0,
    [results] NVARCHAR(max),
    [message] NVARCHAR(max),
    [dispatchedAt] DATETIME2,
    [completedAt] DATETIME2,
    CONSTRAINT [PatchTask_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[PatchFinding] ADD CONSTRAINT [PatchFinding_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PatchFinding] ADD CONSTRAINT [PatchFinding_patchDefinitionId_fkey] FOREIGN KEY ([patchDefinitionId]) REFERENCES [dbo].[PatchDefinition]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PatchTask] ADD CONSTRAINT [PatchTask_jobId_fkey] FOREIGN KEY ([jobId]) REFERENCES [dbo].[PatchJob]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PatchTask] ADD CONSTRAINT [PatchTask_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
