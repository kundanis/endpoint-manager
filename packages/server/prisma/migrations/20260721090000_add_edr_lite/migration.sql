BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Agent] ADD [edrEnabled] BIT NOT NULL CONSTRAINT [Agent_edrEnabled_df] DEFAULT 1;

-- CreateTable
CREATE TABLE [dbo].[EdrEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(20) NOT NULL,
    [ruleKey] NVARCHAR(50),
    [severity] NVARCHAR(10) NOT NULL,
    [summary] NVARCHAR(300) NOT NULL,
    [detail] NVARCHAR(2000) NOT NULL,
    [killed] BIT NOT NULL CONSTRAINT [EdrEvent_killed_df] DEFAULT 0,
    [detectedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EdrEvent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [EdrEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EdrEvent_agentId_idx] ON [dbo].[EdrEvent]([agentId]);

-- AddForeignKey
ALTER TABLE [dbo].[EdrEvent] ADD CONSTRAINT [EdrEvent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE [dbo].[EdrPersistenceBaseline] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [location] NVARCHAR(300) NOT NULL,
    [name] NVARCHAR(300) NOT NULL,
    [seenAt] DATETIME2 NOT NULL CONSTRAINT [EdrPersistenceBaseline_seenAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [EdrPersistenceBaseline_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EdrPersistenceBaseline_agentId_location_name_key] UNIQUE NONCLUSTERED ([agentId],[location],[name])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EdrPersistenceBaseline_agentId_idx] ON [dbo].[EdrPersistenceBaseline]([agentId]);

-- AddForeignKey
ALTER TABLE [dbo].[EdrPersistenceBaseline] ADD CONSTRAINT [EdrPersistenceBaseline_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
