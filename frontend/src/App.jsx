import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ToastProvider } from "./context/ToastContext";
import { I18nProvider } from "./i18n/I18nContext";
import ToastContainer from "./components/Toast";
import { getSetupStatus } from "./api/client";
import Login from "./pages/Login";
import SetupWizard from "./pages/SetupWizard";
import Dashboard from "./pages/Dashboard";
import Library from "./pages/Library";
import SeriesDetail from "./pages/SeriesDetail";
import Calendar from "./pages/Calendar";
import Files from "./pages/Files";
import Settings from "./pages/Settings";
import AdminUsers from "./pages/AdminUsers";
import Requests from "./pages/Requests";
import SubtitleEditorComingSoon from "./pages/SubtitleEditorComingSoon";
import PlayerPage from "./pages/PlayerPage";
import Discover from "./pages/Discover";
import Navbar from "./components/Navbar";
import GlobalSearch from "./components/GlobalSearch";
import { T } from "./theme";

function RequireAuth({ children }) {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" replace />;
}

// Forces first-run installs to the setup wizard instead of the bare login
// screen. needs_setup is true exactly while the users table is empty (see
// backend/app/routers/auth.py::setup_status) — as soon as the wizard creates
// the first account, this flips to false and never redirects again, so
// there's no risk of it kicking in mid-use of an already-configured install.
function SetupGate({ children }) {
  const location = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => getSetupStatus().then(r => r.data),
    retry: false,
    staleTime: 30_000,
  });
  if (isLoading) return null;
  if (data?.needs_setup && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }
  return children;
}

export default function App() {
  return (
    <I18nProvider>
    <ToastProvider>
      <SetupGate>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100vw',
                height: '100dvh',
                background: T.bg,
                color: T.text,
                overflow: 'hidden',
              }}>
                <Navbar />
                <GlobalSearch />
                <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <Routes>
                    <Route path="/"           element={<Dashboard />} />
                    <Route path="/library"    element={<Library />} />
                    <Route path="/series/:id" element={<SeriesDetail />} />
                    <Route path="/calendar"   element={<Calendar />} />
                    <Route path="/requests"   element={<Requests />} />
                    <Route path="/files"      element={<Files />} />
                    <Route path="/settings"   element={<Settings />} />
                    <Route path="/subtitles"  element={<SubtitleEditorComingSoon />} />
                    <Route path="/player/:seriesId/:episodeId" element={<PlayerPage />} />
                    <Route path="/discover"    element={<Discover />} />
                    <Route path="/admin/users" element={<AdminUsers />} />
                    <Route path="*"           element={<Navigate to="/" replace />} />
                  </Routes>
                </main>
              </div>
            </RequireAuth>
          }
        />
      </Routes>
      </SetupGate>
      <ToastContainer />
    </ToastProvider>
    </I18nProvider>
  );
}
