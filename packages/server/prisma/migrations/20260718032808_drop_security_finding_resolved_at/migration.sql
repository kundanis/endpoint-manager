/*
  Warnings:

  - You are about to drop the column `resolvedAt` on the `SecurityBenchmarkFinding` table. All the data in the column will be lost.

*/
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[SecurityBenchmarkFinding] DROP COLUMN [resolvedAt];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
