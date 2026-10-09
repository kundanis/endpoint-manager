BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[PiiEmailBlockPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(1000),
    [enabled] BIT NOT NULL CONSTRAINT [PiiEmailBlockPolicy_enabled_df] DEFAULT 1,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PiiEmailBlockPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PiiEmailBlockPolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PiiEmailBlockRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [ruleType] NVARCHAR(30) NOT NULL,
    [value] NVARCHAR(255) NOT NULL,
    [label] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PiiEmailBlockRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PiiEmailBlockRule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PiiEmailBlockAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [emailAddress] NVARCHAR(320) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PiiEmailBlockAssignment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PiiEmailBlockAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PiiEmailBlockEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000),
    [senderEmail] NVARCHAR(320) NOT NULL,
    [attachmentName] NVARCHAR(500) NOT NULL,
    [action] NVARCHAR(20) NOT NULL,
    [matchedCategoryLabels] NVARCHAR(1000) NOT NULL CONSTRAINT [PiiEmailBlockEvent_matchedCategoryLabels_df] DEFAULT '[]',
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [PiiEmailBlockEvent_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PiiEmailBlockEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PiiEmailBlockAssignment_policyId_idx] ON [dbo].[PiiEmailBlockAssignment]([policyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PiiEmailBlockAssignment_emailAddress_idx] ON [dbo].[PiiEmailBlockAssignment]([emailAddress]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PiiEmailBlockEvent_senderEmail_idx] ON [dbo].[PiiEmailBlockEvent]([senderEmail]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PiiEmailBlockEvent_policyId_idx] ON [dbo].[PiiEmailBlockEvent]([policyId]);

-- AddForeignKey
ALTER TABLE [dbo].[PiiEmailBlockRule] ADD CONSTRAINT [PiiEmailBlockRule_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[PiiEmailBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PiiEmailBlockAssignment] ADD CONSTRAINT [PiiEmailBlockAssignment_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[PiiEmailBlockPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PiiEmailBlockEvent] ADD CONSTRAINT [PiiEmailBlockEvent_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[PiiEmailBlockPolicy]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
