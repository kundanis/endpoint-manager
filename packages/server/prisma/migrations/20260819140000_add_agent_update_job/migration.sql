BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[AgentUpdateJob] (
    [id] NVARCHAR(1000) NOT NULL,
    [targetVersion] NVARCHAR(50) NOT NULL,
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [targetGroupIds] NVARCHAR(1000) NOT NULL CONSTRAINT [AgentUpdateJob_targetGroupIds_df] DEFAULT '[]',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AgentUpdateJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AgentUpdateJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AgentUpdateTask] (
    [id] NVARCHAR(1000) NOT NULL,
    [jobId] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [AgentUpdateTask_status_df] DEFAULT 'PENDING',
    [message] NVARCHAR(max),
    [dispatchedAt] DATETIME2,
    [completedAt] DATETIME2,
    CONSTRAINT [AgentUpdateTask_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[AgentUpdateTask] ADD CONSTRAINT [AgentUpdateTask_jobId_fkey] FOREIGN KEY ([jobId]) REFERENCES [dbo].[AgentUpdateJob]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AgentUpdateTask] ADD CONSTRAINT [AgentUpdateTask_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
