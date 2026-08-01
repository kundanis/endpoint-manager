BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[NetworkScanRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [cidr] NVARCHAR(50) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [NetworkScanRun_status_df] DEFAULT 'RUNNING',
    [hostsScanned] INT NOT NULL CONSTRAINT [NetworkScanRun_hostsScanned_df] DEFAULT 0,
    [hostsFound] INT NOT NULL CONSTRAINT [NetworkScanRun_hostsFound_df] DEFAULT 0,
    [errorMessage] NVARCHAR(max),
    [triggeredByAdminId] NVARCHAR(1000) NOT NULL,
    [startedAt] DATETIME2 NOT NULL CONSTRAINT [NetworkScanRun_startedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [completedAt] DATETIME2,
    CONSTRAINT [NetworkScanRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DiscoveredHost] (
    [id] NVARCHAR(1000) NOT NULL,
    [scanRunId] NVARCHAR(1000) NOT NULL,
    [ipAddress] NVARCHAR(45) NOT NULL,
    [macAddress] NVARCHAR(20),
    [hostname] NVARCHAR(255),
    [openPorts] NVARCHAR(500) NOT NULL CONSTRAINT [DiscoveredHost_openPorts_df] DEFAULT '[]',
    [responseTimeMs] INT,
    [matchedAgentId] NVARCHAR(1000),
    [discoveredAt] DATETIME2 NOT NULL CONSTRAINT [DiscoveredHost_discoveredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DiscoveredHost_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DiscoveredHost_scanRunId_idx] ON [dbo].[DiscoveredHost]([scanRunId]);

-- AddForeignKey
ALTER TABLE [dbo].[DiscoveredHost] ADD CONSTRAINT [DiscoveredHost_scanRunId_fkey] FOREIGN KEY ([scanRunId]) REFERENCES [dbo].[NetworkScanRun]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[DiscoveredHost] ADD CONSTRAINT [DiscoveredHost_matchedAgentId_fkey] FOREIGN KEY ([matchedAgentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
