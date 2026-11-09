BEGIN TRY

BEGIN TRAN;

-- Microsoft Security Update Guide data: which build of a Microsoft product fixes each CVE
-- (new tables only).

-- CreateTable
CREATE TABLE [dbo].[MsrcDocument] (
    [id] NVARCHAR(20) NOT NULL,
    [currentReleaseDate] DATETIME2 NOT NULL,
    [mappingVersion] INT NOT NULL,
    [fixCount] INT NOT NULL CONSTRAINT [MsrcDocument_fixCount_df] DEFAULT 0,
    [syncedAt] DATETIME2 NOT NULL CONSTRAINT [MsrcDocument_syncedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [MsrcDocument_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MsrcProductFix] (
    [id] NVARCHAR(1000) NOT NULL,
    [documentId] NVARCHAR(20) NOT NULL,
    [cveId] NVARCHAR(32) NOT NULL,
    [vulnerabilityDefinitionId] NVARCHAR(36) NOT NULL,
    [familyKey] NVARCHAR(100) NOT NULL,
    [productName] NVARCHAR(300) NOT NULL,
    [fixedBuild] NVARCHAR(100) NOT NULL,
    [kbArticle] NVARCHAR(50),
    CONSTRAINT [MsrcProductFix_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MsrcProductFix_familyKey_idx] ON [dbo].[MsrcProductFix]([familyKey]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MsrcProductFix_documentId_idx] ON [dbo].[MsrcProductFix]([documentId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
