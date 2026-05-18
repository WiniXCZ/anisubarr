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
              <div className="min-h-screen flex flex-col bg-bg">
                <Navbar />
                <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">
                  <Routes>
                    <Route path="/"           element={<Library />} />
                    <Route path="/series/:id" element={<SeriesDetail />} />
                    <Route path="/schedule"   element={<Schedule />} />
                    <Route path="/calendar"   element={<Calendar />} />
                    <Route path="/requests"   element={<Requests />} />
                    <Route path="/files"      element={<Files />} />
                    <Route path="/settings"    element={<Settings />} />
                    <Route path="/subtitles"   element={<SubtitleEditorPage />} />
                    <Route path="/admin/users" element={<AdminUsers />} />
                    <Route path="*"            element={<Navigate to="/" replace />} />
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
