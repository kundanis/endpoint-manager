BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[AiGuardAlertSettings] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [AiGuardAlertSettings_id_df] DEFAULT 'singleton',
    [enabled] BIT NOT NULL CONSTRAINT [AiGuardAlertSettings_enabled_df] DEFAULT 0,
    [recipients] NVARCHAR(4000) NOT NULL CONSTRAINT [AiGuardAlertSettings_recipients_df] DEFAULT '[]',
    [alertOnPrompts] BIT NOT NULL CONSTRAINT [AiGuardAlertSettings_alertOnPrompts_df] DEFAULT 1,
    [alertOnBlockedApps] BIT NOT NULL CONSTRAINT [AiGuardAlertSettings_alertOnBlockedApps_df] DEFAULT 1,
    [weeklySummary] BIT NOT NULL CONSTRAINT [AiGuardAlertSettings_weeklySummary_df] DEFAULT 0,
    [lastAlertAt] DATETIME2,
    [lastAlertSentAt] DATETIME2,
    [lastWeeklySentAt] DATETIME2,
    [lastError] NVARCHAR(500),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AiGuardAlertSettings_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AgentAiComponent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(20) NOT NULL,
    [host] NVARCHAR(20) NOT NULL,
    [identifier] NVARCHAR(200) NOT NULL,
    [name] NVARCHAR(300) NOT NULL,
    [version] NVARCHAR(100),
    [userName] NVARCHAR(300),
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [AgentAiComponent_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AgentAiComponent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AgentAiComponent_agentId_idx] ON [dbo].[AgentAiComponent]([agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AgentAiComponent_kind_identifier_idx] ON [dbo].[AgentAiComponent]([kind], [identifier]);

-- AddForeignKey
ALTER TABLE [dbo].[AgentAiComponent] ADD CONSTRAINT [AgentAiComponent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

