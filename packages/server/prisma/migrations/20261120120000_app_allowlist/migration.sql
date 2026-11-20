BEGIN TRY

BEGIN TRAN;

-- Application allowlisting (columns only; no new tables, no data changes). Existing policies get
-- mode 'BLOCK' and keep working as before; existing events get outcome 'BLOCKED'.

-- AlterTable
ALTER TABLE [dbo].[AppControlPolicy] ADD [mode] NVARCHAR(20) NOT NULL CONSTRAINT [AppControlPolicy_mode_df] DEFAULT 'BLOCK',
[allowlistEnforcement] NVARCHAR(10) NOT NULL CONSTRAINT [AppControlPolicy_allowlistEnforcement_df] DEFAULT 'AUDIT',
[allowProgramFiles] BIT NOT NULL CONSTRAINT [AppControlPolicy_allowProgramFiles_df] DEFAULT 1,
[exemptAdministrators] BIT NOT NULL CONSTRAINT [AppControlPolicy_exemptAdministrators_df] DEFAULT 1,
[microsoftSigned] NVARCHAR(10) NOT NULL CONSTRAINT [AppControlPolicy_microsoftSigned_df] DEFAULT 'SELECTED',
[microsoftProducts] NVARCHAR(2000);

-- AlterTable
ALTER TABLE [dbo].[AppControlRule] ADD [publisher] NVARCHAR(500),
[productName] NVARCHAR(300),
[fileName] NVARCHAR(300),
[versionMatch] NVARCHAR(10),
[version] NVARCHAR(50),
[fileSize] BIGINT;

-- AlterTable
ALTER TABLE [dbo].[AppControlEvent] ADD [outcome] NVARCHAR(10) NOT NULL CONSTRAINT [AppControlEvent_outcome_df] DEFAULT 'BLOCKED',
[publisher] NVARCHAR(500),
[productName] NVARCHAR(300),
[fileVersion] NVARCHAR(50),
[fileHash] NVARCHAR(64),
[fileSize] BIGINT,
[userName] NVARCHAR(200);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AppControlEvent_policyId_outcome_idx] ON [dbo].[AppControlEvent]([policyId], [outcome]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
