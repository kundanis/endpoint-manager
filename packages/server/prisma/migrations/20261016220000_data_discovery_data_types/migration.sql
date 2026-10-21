BEGIN TRY

BEGIN TRAN;

-- Data discovery policies pick data categories from the Data types library (JSON array of data
-- type ids) instead of a regulation. NULL on older policies, which keep scanning by regulation.
ALTER TABLE [dbo].[DataDiscoveryPolicy] ADD [dataTypeIds] NVARCHAR(max);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
