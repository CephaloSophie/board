import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import ProjectsPage from './pages/ProjectsPage';
import BoardPage from './pages/BoardPage';
import TaskPage from './pages/TaskPage';
import EventsPage from './pages/EventsPage';
import AdminPage, { LegacyAdminRedirect } from './pages/AdminPage';
import ProjectSettingsPage from './pages/ProjectSettingsPage';
import DashboardPage from './pages/DashboardPage';
import PlanningPage from './pages/PlanningPage';
import ActivityPage from './pages/ActivityPage';
import Layout from './components/Layout/Layout';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loadbox">Chargement…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <Protected>
            <Layout>
              <Routes>
                <Route path="/" element={<ProjectsPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:projectKey/board" element={<BoardPage />} />
                <Route path="/projects/:projectKey/dashboards/:dashboardId?" element={<DashboardPage />} />
                <Route path="/projects/:projectKey/events" element={<EventsPage />} />
                <Route path="/projects/:projectKey/planning" element={<PlanningPage />} />
                <Route path="/projects/:projectKey/activity" element={<ActivityPage />} />
                <Route path="/projects/:projectKey/tasks/:taskId" element={<TaskPage />} />
                <Route path="/projects/:projectKey/settings/:tab?" element={<ProjectSettingsPage />} />
                <Route path="/projects/:projectKey/admin" element={<LegacyAdminRedirect />} />
                <Route path="/admin/users" element={<AdminPage />} />
                <Route path="*" element={<Navigate to="/projects" replace />} />
              </Routes>
            </Layout>
          </Protected>
        }
      />
    </Routes>
  );
}
