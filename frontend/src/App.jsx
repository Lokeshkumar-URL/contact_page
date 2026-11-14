import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAdmin, RequireAuth } from './auth/RouteGuards.jsx';
import AppShell from './components/AppShell.jsx';
import AcceptInvitePage from './pages/AcceptInvitePage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RunDetailsPage from './pages/RunDetailsPage.jsx';
import RunHistoryPage from './pages/RunHistoryPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/runs/:runId" element={<RunDetailsPage />} />
          <Route path="/runs" element={<RunHistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<RequireAdmin />}><Route path="/admin" element={<AdminPage />} /></Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
