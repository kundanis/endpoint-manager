BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[DataDiscoveryScanState] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [filesScanned] INT NOT NULL,
    [lastScannedAt] DATETIME2 NOT NULL CONSTRAINT [DataDiscoveryScanState_lastScannedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DataDiscoveryScanState_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DataDiscoveryScanState_agentId_policyId_key] UNIQUE NONCLUSTERED ([agentId],[policyId])
);

-- AddForeignKey
ALTER TABLE [dbo].[DataDiscoveryScanState] ADD CONSTRAINT [DataDiscoveryScanState_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DataDiscoveryScanState] ADD CONSTRAINT [DataDiscoveryScanState_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[DataDiscoveryPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
