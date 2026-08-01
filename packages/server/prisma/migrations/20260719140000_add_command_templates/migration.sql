BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[CommandTemplate] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(150) NOT NULL,
    [description] NVARCHAR(500),
    [shell] NVARCHAR(20) NOT NULL,
    [script] NVARCHAR(max) NOT NULL,
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CommandTemplate_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CommandTemplate_pkey] PRIMARY KEY CLUSTERED ([id])
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
