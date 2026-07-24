import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { login, register } from "../api/client";
import { T } from "../theme";
import { useT } from "../i18n/I18nContext";
import LangSwitcher from "../components/LangSwitcher";

export default function Login() {
  const navigate = useNavigate();
  const t = useT();
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
  const emailRef = useRef(null);
  const [mode,     setMode]      = useState("login"); // "login" | "register"
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
      if (mode === "register") {
        const em = emailRef.current?.value || undefined;
        await register(u, p, em);
        // Registering (only possible pre-auth when the DB has zero users —
        // see backend/app/routers/auth.py) makes this account admin. Log
        // straight in with the same credentials rather than bouncing the
        // person back to a second form.
      }
      const res = await login(u, p);
      localStorage.setItem("token", res.data.access_token);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.detail || t("login_error_generic"));
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
      position: 'relative',
    }}>
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <LangSwitcher/>
      </div>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <svg width={44} height={44} viewBox="0 0 24 24" fill="none"
            stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ marginBottom: 12 }}>
            <rect x="2" y="4" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="18" x2="12" y2="21"/>
          </svg>
          <div style={{ font: '700 22px "Space Grotesk"', color: T.text }}>{t("login_title")}</div>
          <div style={{ font: '500 13px "Space Grotesk"', color: T.textMute, marginTop: 4 }}>
            {mode === "register" ? t("login_register_title") : t("login_subtitle")}
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
              {t("login_username")}
            </label>
            <input ref={usernameRef} type="text" name="username"
              autoFocus autoComplete="username" placeholder="admin" style={inp}/>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ font: '500 12px "Space Grotesk"', color: T.textDim }}>
              {t("login_password")}
            </label>
            <input ref={passwordRef} type="password" name="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder="••••••••" style={inp}/>
          </div>

          {mode === "register" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ font: '500 12px "Space Grotesk"', color: T.textDim }}>
                {t("login_email_optional")}
              </label>
              <input ref={emailRef} type="email" name="email"
                autoComplete="email" placeholder="you@example.com" style={inp}/>
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            marginTop: 4, padding: '10px 0',
            background: T.accent, color: '#fff', border: 'none',
            borderRadius: 8, font: '600 14px "Space Grotesk"', cursor: 'pointer',
            opacity: loading ? 0.6 : 1,
          }}>
            {mode === "register"
              ? (loading ? t("login_register_submitting") : t("login_register_submit"))
              : (loading ? t("login_submitting") : t("login_submit"))}
          </button>

          <div style={{ textAlign: 'center', font: '500 13px "Space Grotesk"', color: T.textMute }}>
            {mode === "login" ? (
              <>
                {t("login_register_prompt")}{" "}
                <button type="button" onClick={() => { setMode("register"); setError(""); }}
                  style={{ background: 'none', border: 'none', color: T.accent, cursor: 'pointer', font: 'inherit', padding: 0 }}>
                  {t("login_register_link")}
                </button>
              </>
            ) : (
              <>
                {t("login_have_account")}{" "}
                <button type="button" onClick={() => { setMode("login"); setError(""); }}
                  style={{ background: 'none', border: 'none', color: T.accent, cursor: 'pointer', font: 'inherit', padding: 0 }}>
                  {t("login_login_link")}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
