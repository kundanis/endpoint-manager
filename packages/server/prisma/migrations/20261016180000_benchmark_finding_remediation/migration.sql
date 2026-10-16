BEGIN TRY

BEGIN TRAN;

-- Links a failing benchmark rule on an endpoint to its latest fix (CommandJob), so the console
-- can show each fix's status and reason.
ALTER TABLE [dbo].[SecurityBenchmarkFinding] ADD [remediationJobId] NVARCHAR(36);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
