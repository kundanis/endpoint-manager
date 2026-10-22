BEGIN TRY

BEGIN TRAN;

-- Identity Governance -> User Risk: per-user activity stream, rule alerts, settings.

-- CreateTable
CREATE TABLE [dbo].[UserActivityEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [userKey] NVARCHAR(200) NOT NULL,
    [username] NVARCHAR(300) NOT NULL,
    [agentId] NVARCHAR(1000),
    [hostname] NVARCHAR(255),
    [type] NVARCHAR(40) NOT NULL,
    [summary] NVARCHAR(500) NOT NULL,
    [detail] NVARCHAR(2000) NOT NULL CONSTRAINT [UserActivityEvent_detail_df] DEFAULT '{}',
    [occurredAt] DATETIME2 NOT NULL,
    [sourceTable] NVARCHAR(40) NOT NULL,
    [sourceId] NVARCHAR(100) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UserActivityEvent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [UserActivityEvent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UserActivityEvent_sourceTable_sourceId_type_key] UNIQUE NONCLUSTERED ([sourceTable],[sourceId],[type])
);

-- CreateTable
CREATE TABLE [dbo].[UserRiskAlert] (
    [id] NVARCHAR(1000) NOT NULL,
    [dedupeKey] NVARCHAR(400) NOT NULL,
    [userKey] NVARCHAR(200) NOT NULL,
    [username] NVARCHAR(300) NOT NULL,
    [ruleKey] NVARCHAR(60) NOT NULL,
    [severity] NVARCHAR(10) NOT NULL,
    [points] INT NOT NULL,
    [title] NVARCHAR(300) NOT NULL,
    [detail] NVARCHAR(2000) NOT NULL,
    [eventCount] INT NOT NULL,
    [eventIds] NVARCHAR(max) NOT NULL CONSTRAINT [UserRiskAlert_eventIds_df] DEFAULT '[]',
    [windowStart] DATETIME2 NOT NULL,
    [windowEnd] DATETIME2 NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [UserRiskAlert_status_df] DEFAULT 'NEW',
    [notes] NVARCHAR(max) NOT NULL CONSTRAINT [UserRiskAlert_notes_df] DEFAULT '[]',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UserRiskAlert_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [UserRiskAlert_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UserRiskAlert_dedupeKey_key] UNIQUE NONCLUSTERED ([dedupeKey])
);

-- CreateTable
CREATE TABLE [dbo].[UserRiskConfig] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [UserRiskConfig_id_df] DEFAULT 'singleton',
    [settings] NVARCHAR(max) NOT NULL CONSTRAINT [UserRiskConfig_settings_df] DEFAULT '{}',
    [cursors] NVARCHAR(max) NOT NULL CONSTRAINT [UserRiskConfig_cursors_df] DEFAULT '{}',
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [UserRiskConfig_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserActivityEvent_userKey_occurredAt_idx] ON [dbo].[UserActivityEvent]([userKey], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserActivityEvent_occurredAt_idx] ON [dbo].[UserActivityEvent]([occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserRiskAlert_userKey_createdAt_idx] ON [dbo].[UserRiskAlert]([userKey], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserRiskAlert_status_createdAt_idx] ON [dbo].[UserRiskAlert]([status], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[UserActivityEvent] ADD CONSTRAINT [UserActivityEvent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
