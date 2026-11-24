BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[ConsentNotice] (
    [id] NVARCHAR(1000) NOT NULL,
    [version] INT NOT NULL,
    [required] BIT NOT NULL CONSTRAINT [ConsentNotice_required_df] DEFAULT 0,
    [title] NVARCHAR(200) NOT NULL,
    [body] NVARCHAR(max) NOT NULL,
    [grievanceContact] NVARCHAR(500) NOT NULL,
    [createdByAdminId] NVARCHAR(64),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ConsentNotice_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ConsentNotice_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ConsentNotice_version_key] UNIQUE NONCLUSTERED ([version])
);

-- CreateTable
CREATE TABLE [dbo].[EndpointUserConsent] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [account] NVARCHAR(300) NOT NULL,
    [decision] NVARCHAR(10) NOT NULL CONSTRAINT [EndpointUserConsent_decision_df] DEFAULT 'PENDING',
    [noticeVersion] INT,
    [decidedAt] DATETIME2,
    [lastActiveAt] DATETIME2 NOT NULL CONSTRAINT [EndpointUserConsent_lastActiveAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EndpointUserConsent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [EndpointUserConsent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EndpointUserConsent_agentId_account_key] UNIQUE NONCLUSTERED ([agentId],[account])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EndpointUserConsent_agentId_idx] ON [dbo].[EndpointUserConsent]([agentId]);

-- AddForeignKey
ALTER TABLE [dbo].[EndpointUserConsent] ADD CONSTRAINT [EndpointUserConsent_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

