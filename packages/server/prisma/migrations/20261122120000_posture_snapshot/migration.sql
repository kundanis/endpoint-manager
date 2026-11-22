BEGIN TRY

BEGIN TRAN;

-- Organisation security posture history (new table only; no existing table or data changes).

-- CreateTable
CREATE TABLE [dbo].[PostureSnapshot] (
    [id] NVARCHAR(1000) NOT NULL,
    [day] DATE NOT NULL,
    [agentId] NVARCHAR(1000),
    [score] FLOAT(53) NOT NULL,
    [parts] NVARCHAR(2000) NOT NULL,
    [endpointCount] INT,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [PostureSnapshot_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PostureSnapshot_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PostureSnapshot_day_agentId_idx] ON [dbo].[PostureSnapshot]([day], [agentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PostureSnapshot_agentId_day_idx] ON [dbo].[PostureSnapshot]([agentId], [day]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
