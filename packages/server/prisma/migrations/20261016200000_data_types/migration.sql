BEGIN TRY

BEGIN TRAN;

-- Admin-defined data types (Data Governance -> Data types).
CREATE TABLE [dbo].[DataType] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [category] NVARCHAR(100),
    [description] NVARCHAR(1000),
    [kind] NVARCHAR(20) NOT NULL,
    [values] NVARCHAR(max) NOT NULL,
    [createdByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DataType_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [DataType_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DataType_name_key] UNIQUE NONCLUSTERED ([name])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
