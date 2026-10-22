import { Link } from "react-router-dom";
import { useIsItemHidden, useLicenseStatus, useMe, useUserRiskOverview, useUserRiskUsers } from "../api/hooks";
import { RiskBadge, userPath } from "../pages/UserRiskPage";
import { Badge, Card } from "./ui";

// Dashboard: the riskiest users and open alerts, for admins who may see User risk (licence,
// module visibility, Identity Governance access and the separate User risk grant).
export default function UserRiskDashboardCard() {
  const { data: me } = useMe();
  const { data: license } = useLicenseStatus();
  const hidden = useIsItemHidden("/user-risk");
  const licensed = !license?.enforcementEnabled || (license.modules ?? []).includes("USER_MANAGER");
  const allowed =
    !!me && !hidden && licensed && (me.role === "SUPER_ADMIN" || (me.moduleGrants.includes("USER_MANAGER") && me.moduleGrants.includes("USER_RISK")));

  const { data: overview } = useUserRiskOverview(allowed);
  const { data: users } = useUserRiskUsers(7, allowed);
  if (!allowed) return null;

  const top = (users ?? []).filter((u) => u.score > 0).slice(0, 5);
  const open = Object.values(overview?.openAlerts ?? {}).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <Card
      title="User risk"
      hint="Riskiest users, last 7 days"
      actions={
        <Link className="ep-link" to="/user-risk/alerts">
          {open > 0 ? <Badge tone="high">{open} open alerts</Badge> : "No open alerts"}
        </Link>
      }
    >
      {top.length === 0 ? (
        <span className="ep-nodata">No user is at risk right now</span>
      ) : (
        <table className="ep-tbl">
          <tbody>
            {top.map((u) => (
              <tr key={u.userKey}>
                <td>
                  <Link className="ep-link" to={userPath(u.userKey)}>
                    {u.username}
                  </Link>
                  {u.topRules[0] && <span className="app-row-sub">{u.topRules[0].title}</span>}
                </td>
                <td style={{ textAlign: "right" }}>
                  <RiskBadge score={u.score} level={u.level} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
