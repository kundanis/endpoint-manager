BEGIN TRY

BEGIN TRAN;

-- Endpoint History tab: installed-software changes per endpoint (installs, removals, updates).

-- CreateTable
CREATE TABLE [dbo].[AgentSoftwareChange] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [change] NVARCHAR(20) NOT NULL,
    [name] NVARCHAR(500) NOT NULL,
    [version] NVARCHAR(200),
    [oldVersion] NVARCHAR(200),
    [publisher] NVARCHAR(300),
    [detectedAt] DATETIME2 NOT NULL CONSTRAINT [AgentSoftwareChange_detectedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AgentSoftwareChange_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AgentSoftwareChange_agentId_detectedAt_idx] ON [dbo].[AgentSoftwareChange]([agentId], [detectedAt]);

-- AddForeignKey
ALTER TABLE [dbo].[AgentSoftwareChange] ADD CONSTRAINT [AgentSoftwareChange_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
