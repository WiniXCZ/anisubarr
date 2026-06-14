import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client";
import { T } from "../theme";

export default function Login() {
  const navigate = useNavigate();
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // Read directly from DOM refs to capture browser-autofilled values
    // that Chrome may not expose via React's synthetic onChange
    const u = usernameRef.current?.value ?? "";
    const p = passwordRef.current?.value ?? "";
    try {
      const res = await login(u, p);
      localStorage.setItem("token", res.data.access_token);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.detail || "Přihlášení selhalo");
    } finally {
      setLoading(false);
    }
  }

  const inp = {
    width: '100%', padding: '9px 12px',
    background: T.sunken, color: T.text,
    border: `1px solid ${T.border}`, borderRadius: 8,
    outline: 'none', font: '500 14px "Space Grotesk"',
  };

  return (
    <div style={{
      minHeight: '100dvh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <svg width={44} height={44} viewBox="0 0 24 24" fill="none"
            stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ marginBottom: 12 }}>
            <rect x="2" y="4" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="18" x2="12" y2="21"/>
          </svg>
          <div style={{ font: '700 22px "Space Grotesk"', color: T.text }}>Anisubarr</div>
          <div style={{ font: '500 13px "Space Grotesk"', color: T.textMute, marginTop: 4 }}>
            Správa anime titulků
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{
          background: T.panel, border: `1px solid ${T.border}`,
          borderRadius: 14, padding: 24,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5', font: '500 13px "Space Grotesk"',
              padding: '8px 12px', borderRadius: 7,
            }}>{error}</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ font: '500 12px "Space Grotesk"', color: T.textDim }}>
              Uživatelské jméno
            </label>
            <input ref={usernameRef} type="text" name="username"
              autoFocus autoComplete="username" placeholder="admin" style={inp}/>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ font: '500 12px "Space Grotesk"', color: T.textDim }}>
              Heslo
            </label>
            <input ref={passwordRef} type="password" name="password"
              autoComplete="current-password" placeholder="••••••••" style={inp}/>
          </div>

          <button type="submit" disabled={loading} style={{
            marginTop: 4, padding: '10px 0',
            background: T.accent, color: '#fff', border: 'none',
            borderRadius: 8, font: '600 14px "Space Grotesk"', cursor: 'pointer',
            opacity: loading ? 0.6 : 1,
          }}>
            {loading ? "Přihlašuji…" : "Přihlásit se"}
          </button>
        </form>
      </div>
    </div>
  );
}
