BEGIN TRY

BEGIN TRAN;

-- Replace the status-only index with two that cover the OPEN-finding aggregations the
-- dashboard, endpoints list and vulnerability summary run (COUNT per agent / per CVE).
DROP INDEX [VulnerabilityFinding_status_idx] ON [dbo].[VulnerabilityFinding];

CREATE NONCLUSTERED INDEX [VulnerabilityFinding_status_agentId_idx]
  ON [dbo].[VulnerabilityFinding]([status], [agentId]);

CREATE NONCLUSTERED INDEX [VulnerabilityFinding_status_vulnerabilityDefinitionId_agentId_idx]
  ON [dbo].[VulnerabilityFinding]([status], [vulnerabilityDefinitionId], [agentId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
