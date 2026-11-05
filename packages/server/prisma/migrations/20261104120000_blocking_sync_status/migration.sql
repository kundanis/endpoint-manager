BEGIN TRY

BEGIN TRAN;

-- Sync status tab for Application control and Command blocking: when each assignment's
-- endpoint last applied the rules, and whether it worked (as WebBlockPolicyAssignment has).

-- AlterTable
ALTER TABLE [dbo].[AppControlPolicyAssignment] ADD [lastSyncedAt] DATETIME2,
[lastSyncStatus] NVARCHAR(20),
[lastSyncError] NVARCHAR(1000);

-- AlterTable
ALTER TABLE [dbo].[CommandBlockPolicyAssignment] ADD [lastSyncedAt] DATETIME2,
[lastSyncStatus] NVARCHAR(20),
[lastSyncError] NVARCHAR(1000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
