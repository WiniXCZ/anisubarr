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
import { T } from "./theme";

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
                background: T.bg,
                color: T.text,
                overflow: 'hidden',
              }}>
                <Navbar />
                <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <Routes>
                    <Route path="/"           element={<Library />} />
                    <Route path="/series/:id" element={<SeriesDetail />} />
                    <Route path="/schedule"   element={<Schedule />} />
                    <Route path="/calendar"   element={<Calendar />} />
                    <Route path="/requests"   element={<Requests />} />
                    <Route path="/files"      element={<Files />} />
                    <Route path="/settings"   element={<Settings />} />
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
