import { Routes, Route, Navigate } from "react-router-dom";
import { ToastProvider } from "./context/ToastContext";
import ToastContainer from "./components/Toast";
import Login from "./pages/Login";
import Library from "./pages/Library";
import SeriesDetail from "./pages/SeriesDetail";
import Schedule from "./pages/Schedule";
import Calendar from "./pages/Calendar";
import Files from "./pages/Files";
import Settings from "./pages/Settings";
import AdminUsers from "./pages/AdminUsers";
import Requests from "./pages/Requests";
import SubtitleEditorPage from "./pages/SubtitleEditorPage";
import Navbar from "./components/Navbar";
import { THEME } from "./v1design";

function RequireAuth({ children }) {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
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
                height: '100vh',
                background: THEME.bg,
                color: THEME.text,
                overflow: 'hidden',
              }}>
                <Navbar theme={THEME} />
                <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <Routes>
                    <Route path="/"           element={<Library theme={THEME} />} />
                    <Route path="/series/:id" element={<SeriesDetail theme={THEME} />} />
                    <Route path="/schedule"   element={<Schedule theme={THEME} />} />
                    <Route path="/calendar"   element={<Calendar theme={THEME} />} />
                    <Route path="/requests"   element={<Requests theme={THEME} />} />
                    <Route path="/files"      element={<Files theme={THEME} />} />
                    <Route path="/settings"   element={<Settings theme={THEME} />} />
                    <Route path="/subtitles"  element={<SubtitleEditorPage />} />
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
  );
}
