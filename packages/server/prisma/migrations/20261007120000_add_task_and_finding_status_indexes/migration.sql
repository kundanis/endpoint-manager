BEGIN TRY

BEGIN TRAN;

-- Per-agent PENDING-task lookups run on every agent checkin; without these each was a full
-- table scan of all historical task rows, per agent, every poll.
CREATE NONCLUSTERED INDEX [CommandTask_agentId_status_idx] ON [dbo].[CommandTask]([agentId], [status]);
CREATE NONCLUSTERED INDEX [DeploymentTask_agentId_status_idx] ON [dbo].[DeploymentTask]([agentId], [status]);
CREATE NONCLUSTERED INDEX [PatchTask_agentId_status_idx] ON [dbo].[PatchTask]([agentId], [status]);
CREATE NONCLUSTERED INDEX [AgentUpdateTask_agentId_status_idx] ON [dbo].[AgentUpdateTask]([agentId], [status]);

-- Fleet-wide status-only scans (dashboard summary + agents list) can't seek the existing
-- [agentId, status] index when filtering on status alone.
CREATE NONCLUSTERED INDEX [VulnerabilityFinding_status_idx] ON [dbo].[VulnerabilityFinding]([status]);
CREATE NONCLUSTERED INDEX [ZeroTrustFinding_status_idx] ON [dbo].[ZeroTrustFinding]([status]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
