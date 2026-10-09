import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
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
import DataMovementPage from "./pages/DataMovementPage";
import EpmPage from "./pages/EpmPage";
import AppControlPage from "./pages/AppControlPage";
import WebBlockPage from "./pages/WebBlockPage";
import PiiBlockPage from "./pages/PiiBlockPage";
import EmailAttachmentBlockPage from "./pages/EmailAttachmentBlockPage";
import CommandBlockPage from "./pages/CommandBlockPage";
import IpBlockPage from "./pages/IpBlockPage";
import UsbControlPage from "./pages/UsbControlPage";
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
        <Route path="/data-discovery" element={<RequireModule module="DATA_MANAGER"><DataDiscoveryPage /></RequireModule>} />
        <Route path="/dlp" element={<RequireModule module="DATA_MANAGER"><DlpPage /></RequireModule>}>
          <Route index element={<Navigate to="content-policies" replace />} />
          <Route path="content-policies" element={<DlpContentPoliciesPage />} />
          <Route path="email-attachment-block" element={<EmailAttachmentBlockPage />} />
        </Route>
        <Route path="/data-movement" element={<RequireModule module="DATA_MANAGER"><DataMovementPage /></RequireModule>} />
        <Route path="/epm" element={<RequireModule module="DATA_MANAGER"><EpmPage /></RequireModule>}>
          <Route index element={<Navigate to="app-control" replace />} />
          <Route path="app-control" element={<AppControlPage />} />
          <Route path="web-block" element={<WebBlockPage />} />
          <Route path="pii-block" element={<PiiBlockPage />} />
          <Route path="command-block" element={<CommandBlockPage />} />
          <Route path="ip-block" element={<IpBlockPage />} />
          <Route path="usb-control" element={<UsbControlPage />} />
        </Route>
        <Route path="/access-exceptions" element={<RequireModule module="DATA_MANAGER"><AccessExceptionsPage /></RequireModule>} />
        <Route path="/user-productivity" element={<RequireModule module="USER_MANAGER"><UserProductivityPage /></RequireModule>} />
        <Route path="/licensing" element={<LicenseActivationPage />} />
        <Route path="/admin-users" element={<RequireSuperAdmin><AdminUsersPage /></RequireSuperAdmin>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
