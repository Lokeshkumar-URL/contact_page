import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import RunDetailsPage from './pages/RunDetailsPage.jsx';
import RunHistoryPage from './pages/RunHistoryPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/runs/:runId" element={<RunDetailsPage />} />
        <Route path="/runs" element={<RunHistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
