BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[ZeroTrustCheckOverride] (
    [id] NVARCHAR(1000) NOT NULL,
    [agentId] NVARCHAR(1000) NOT NULL,
    [conditionKey] NVARCHAR(50) NOT NULL,
    [appliedByAdminId] NVARCHAR(1000) NOT NULL,
    [appliedAt] DATETIME2 NOT NULL CONSTRAINT [ZeroTrustCheckOverride_appliedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ZeroTrustCheckOverride_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE UNIQUE NONCLUSTERED INDEX [ZeroTrustCheckOverride_agentId_conditionKey_key] ON [dbo].[ZeroTrustCheckOverride]([agentId], [conditionKey]);

-- AddForeignKey
ALTER TABLE [dbo].[ZeroTrustCheckOverride] ADD CONSTRAINT [ZeroTrustCheckOverride_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[Agent]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
