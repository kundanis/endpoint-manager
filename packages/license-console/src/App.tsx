import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import EntitiesPage from "./pages/EntitiesPage";
import LicenseKeysPage from "./pages/LicenseKeysPage";
import UnlockRequestsPage from "./pages/UnlockRequestsPage";
import RequireAuth from "./components/RequireAuth";
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
        <Route path="/" element={<Navigate to="/entities" replace />} />
        <Route path="/entities" element={<EntitiesPage />} />
        <Route path="/license-keys" element={<LicenseKeysPage />} />
        <Route path="/unlock-requests" element={<UnlockRequestsPage />} />
        <Route path="*" element={<Navigate to="/entities" replace />} />
      </Route>
    </Routes>
  );
}
