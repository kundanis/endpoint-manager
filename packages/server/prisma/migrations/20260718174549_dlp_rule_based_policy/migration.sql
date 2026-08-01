/*
  Warnings:

  - You are about to drop the column `matchedPatternKeys` on the `DlpEvent` table. All the data in the column will be lost.
  - You are about to drop the column `regulation` on the `DlpPolicy` table. All the data in the column will be lost.

*/
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[DlpEvent] DROP CONSTRAINT [DlpEvent_matchedPatternKeys_df];
ALTER TABLE [dbo].[DlpEvent] DROP COLUMN [matchedPatternKeys];
ALTER TABLE [dbo].[DlpEvent] ADD [matchedRuleIds] NVARCHAR(500) NOT NULL CONSTRAINT [DlpEvent_matchedRuleIds_df] DEFAULT '[]';

-- AlterTable
ALTER TABLE [dbo].[DlpPolicy] DROP COLUMN [regulation];

-- CreateTable
CREATE TABLE [dbo].[DlpRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [ruleType] NVARCHAR(30) NOT NULL,
    [value] NVARCHAR(500) NOT NULL,
    [label] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DlpRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DlpRule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[DlpRule] ADD CONSTRAINT [DlpRule_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[DlpPolicy]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
