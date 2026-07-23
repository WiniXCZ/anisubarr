import { Routes, Route, Navigate } from "react-router-dom";
import { ToastProvider } from "./context/ToastContext";
import { I18nProvider } from "./i18n/I18nContext";
import ToastContainer from "./components/Toast";
import Login from "./pages/Login";
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

export default function App() {
  return (
    <I18nProvider>
    <ToastProvider>
      <Routes>
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
      <ToastContainer />
    </ToastProvider>
    </I18nProvider>
  );
}
