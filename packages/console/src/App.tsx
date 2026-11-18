import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import EventsPage from "./pages/EventsPage";
import AgentsPage from "./pages/AgentsPage";
import AgentDetailPage from "./pages/AgentDetailPage";
import EnrollmentTokensPage from "./pages/EnrollmentTokensPage";
import CommandsPage from "./pages/CommandsPage";
import PackagesPage from "./pages/PackagesPage";
import AgentUpdatesPage from "./pages/AgentUpdatesPage";
import PatchesPage from "./pages/PatchesPage";
import VulnerabilitiesPage from "./pages/VulnerabilitiesPage";
import AssetSettingsPage from "./pages/AssetSettingsPage";
import SoftwareLicensesPage from "./pages/SoftwareLicensesPage";
import NetworkScanPage from "./pages/NetworkScanPage";
import SecurityConfigPage from "./pages/SecurityConfigPage";
import ZeroTrustPage from "./pages/ZeroTrustPage";
import DataDiscoveryPage from "./pages/DataDiscoveryPage";
import DlpPage from "./pages/DlpPage";
import DlpContentPoliciesPage from "./pages/DlpContentPoliciesPage";
import ScreenCapturePage from "./pages/ScreenCapturePage";
import UserRiskPage, { UserRiskAlertsTab, UserRiskSettingsTab, UserRiskUsersTab } from "./pages/UserRiskPage";
import UserRiskUserPage from "./pages/UserRiskUserPage";
import AdminLogsPage from "./pages/AdminLogsPage";
import HelpCenterPage from "./pages/HelpCenterPage";
import DataMovementPage from "./pages/DataMovementPage";
import DataMovementLayout from "./pages/DataMovementLayout";
import EpmPage from "./pages/EpmPage";
import DataTypesPage from "./pages/DataTypesPage";
import AppControlPage from "./pages/AppControlPage";
import WebBlockPage from "./pages/WebBlockPage";
import PiiBlockPage from "./pages/PiiBlockPage";
import EmailAttachmentBlockPage from "./pages/EmailAttachmentBlockPage";
import CommandBlockPage from "./pages/CommandBlockPage";
import IpBlockPage from "./pages/IpBlockPage";
import UsbControlPage from "./pages/UsbControlPage";
import ScreenshotBlockPage from "./pages/ScreenshotBlockPage";
import { ThreatActivityPage, ThreatOverviewPage, ThreatPoliciesPage, ThreatsPage } from "./pages/ThreatProtectionPage";
import AccessExceptionsPage from "./pages/AccessExceptionsPage";
import UserProductivityPage from "./pages/UserProductivityPage";
import EdrPage from "./pages/EdrPage";
import LicenseActivationPage from "./pages/LicenseActivationPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import RequireAuth from "./components/RequireAuth";
import RequireModule from "./components/RequireModule";
import RequireSuperAdmin from "./components/RequireSuperAdmin";
import Layout from "./components/Layout";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/help" element={<HelpCenterPage />} />
        <Route path="/endpoints" element={<RequireModule module="ENDPOINT_MANAGER"><AgentsPage /></RequireModule>} />
        <Route path="/endpoints/:id" element={<RequireModule module="ENDPOINT_MANAGER"><AgentDetailPage /></RequireModule>} />
        <Route path="/enrollment-tokens" element={<RequireModule module="ENDPOINT_MANAGER"><EnrollmentTokensPage /></RequireModule>} />
        <Route path="/commands" element={<RequireModule module="ENDPOINT_MANAGER"><CommandsPage /></RequireModule>} />
        <Route path="/packages" element={<RequireModule module="ENDPOINT_MANAGER"><PackagesPage /></RequireModule>} />
        <Route path="/agent-updates" element={<RequireModule module="ENDPOINT_MANAGER"><AgentUpdatesPage /></RequireModule>} />
        <Route path="/asset-settings" element={<RequireModule module="ENDPOINT_MANAGER"><AssetSettingsPage /></RequireModule>} />
        <Route path="/patches" element={<RequireModule module="SECURITY_MANAGER"><PatchesPage /></RequireModule>} />
        <Route path="/vulnerabilities" element={<RequireModule module="SECURITY_MANAGER"><VulnerabilitiesPage /></RequireModule>} />
        <Route path="/security-config" element={<RequireModule module="SECURITY_MANAGER"><SecurityConfigPage /></RequireModule>} />
        <Route path="/zero-trust" element={<RequireModule module="SECURITY_MANAGER"><ZeroTrustPage /></RequireModule>} />
        <Route path="/edr" element={<RequireModule module="SECURITY_MANAGER"><EdrPage /></RequireModule>} />
        <Route path="/software-licenses" element={<RequireModule module="SOFTWARE_MANAGER"><SoftwareLicensesPage /></RequireModule>} />
        <Route path="/network-scan" element={<RequireModule module="NETWORK_MANAGER"><NetworkScanPage /></RequireModule>} />
        <Route path="/data-types" element={<RequireModule module="DATA_MANAGER"><DataTypesPage /></RequireModule>} />
        <Route path="/data-discovery" element={<RequireModule module="DATA_MANAGER"><DataDiscoveryPage /></RequireModule>} />
        <Route path="/dlp" element={<RequireModule module="DATA_MANAGER"><DlpPage /></RequireModule>}>
          <Route index element={<Navigate to="content-policies" replace />} />
          <Route path="content-policies" element={<DlpContentPoliciesPage />} />
          <Route path="pii-block" element={<PiiBlockPage />} />
          {/* Moved: email attachment blocking to EPM, screen capture to Data movement. Old links still work. */}
          <Route path="email-attachment-block" element={<Navigate to="/epm/email-attachment-block" replace />} />
          <Route path="screen-capture" element={<Navigate to="/data-movement/screen-capture" replace />} />
        </Route>
        <Route path="/data-movement" element={<RequireModule module="DATA_MANAGER"><DataMovementLayout /></RequireModule>}>
          <Route index element={<Navigate to="files" replace />} />
          <Route path="files" element={<DataMovementPage />} />
          <Route path="screen-capture" element={<ScreenCapturePage />} />
        </Route>
        <Route path="/threat-protection" element={<Navigate to="/threat-protection/overview" replace />} />
        <Route path="/threat-protection/overview" element={<RequireModule module="THREAT_PROTECTION"><ThreatOverviewPage /></RequireModule>} />
        <Route path="/threat-protection/threats" element={<RequireModule module="THREAT_PROTECTION"><ThreatsPage /></RequireModule>} />
        <Route path="/threat-protection/activity" element={<RequireModule module="THREAT_PROTECTION"><ThreatActivityPage /></RequireModule>} />
        <Route path="/threat-protection/policies" element={<RequireModule module="THREAT_PROTECTION"><ThreatPoliciesPage /></RequireModule>} />
        <Route path="/epm" element={<RequireModule module="DATA_MANAGER"><EpmPage /></RequireModule>}>
          <Route index element={<Navigate to="app-control" replace />} />
          <Route path="app-control" element={<AppControlPage />} />
          <Route path="web-block" element={<WebBlockPage />} />
          <Route path="email-attachment-block" element={<EmailAttachmentBlockPage />} />
          {/* PII data blocking moved to DLP; old links still work. */}
          <Route path="pii-block" element={<Navigate to="/dlp/pii-block" replace />} />
          <Route path="command-block" element={<CommandBlockPage />} />
          <Route path="ip-block" element={<IpBlockPage />} />
          <Route path="usb-control" element={<UsbControlPage />} />
          <Route path="screenshot-block" element={<ScreenshotBlockPage />} />
        </Route>
        <Route path="/access-exceptions" element={<RequireModule module="DATA_MANAGER"><AccessExceptionsPage /></RequireModule>} />
        <Route path="/user-productivity" element={<RequireModule module="USER_MANAGER"><UserProductivityPage /></RequireModule>} />
        <Route path="/user-risk" element={<RequireModule module="USER_MANAGER" permission="USER_RISK"><UserRiskPage /></RequireModule>}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<UserRiskUsersTab />} />
          <Route path="alerts" element={<UserRiskAlertsTab />} />
          <Route path="settings" element={<UserRiskSettingsTab />} />
        </Route>
        <Route path="/admin-logs" element={<RequireModule module="USER_MANAGER" superAdminOnly><AdminLogsPage /></RequireModule>} />
        <Route path="/user-risk/user/:userKey" element={<RequireModule module="USER_MANAGER" permission="USER_RISK"><UserRiskUserPage /></RequireModule>} />
        <Route path="/licensing" element={<LicenseActivationPage />} />
        <Route path="/admin-users" element={<RequireSuperAdmin><AdminUsersPage /></RequireSuperAdmin>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
