BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[AiGuardPolicy] ADD [promptAction] NVARCHAR(10) NOT NULL CONSTRAINT [AiGuardPolicy_promptAction_df] DEFAULT 'WARN',
[promptDataTypes] NVARCHAR(max) NOT NULL CONSTRAINT [AiGuardPolicy_promptDataTypes_df] DEFAULT '[]',
[promptProtection] BIT NOT NULL CONSTRAINT [AiGuardPolicy_promptProtection_df] DEFAULT 0;

-- CreateTable
CREATE TABLE [dbo].[AiGuardPromptEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000),
    [appKey] NVARCHAR(100),
    [host] NVARCHAR(255) NOT NULL,
    [channel] NVARCHAR(10) NOT NULL,
    [action] NVARCHAR(30) NOT NULL,
    [dataTypes] NVARCHAR(1000) NOT NULL CONSTRAINT [AiGuardPromptEvent_dataTypes_df] DEFAULT '[]',
    [maskedSample] NVARCHAR(500),
    [fileName] NVARCHAR(300),
    [username] NVARCHAR(300),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [AiGuardPromptEvent_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AiGuardPromptEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiGuardPromptEvent_occurredAt_idx] ON [dbo].[AiGuardPromptEvent]([occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiGuardPromptEvent_agentId_idx] ON [dbo].[AiGuardPromptEvent]([agentId]);

-- AddForeignKey
ALTER TABLE [dbo].[AiGuardPromptEvent] ADD CONSTRAINT [AiGuardPromptEvent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AiGuardPromptEvent] ADD CONSTRAINT [AiGuardPromptEvent_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[AiGuardPolicy]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

