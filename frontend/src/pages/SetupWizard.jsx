/**
 * SetupWizard — first-run onboarding, shown instead of Login when the DB has
 * zero users (see backend/app/routers/auth.py::setup_status and App.jsx's
 * SetupGate). Three steps: create the admin account, optionally configure
 * Sonarr (the one integration this whole app is built around), then hand
 * off to the dashboard. Every other service (Emby, Seerr, Ollama, subtitle
 * providers...) stays in Settings — this wizard only front-loads the one
 * connection nothing else works without.
 */
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { register, login, updateSettings, testConnection } from "../api/client";
import { T } from "../theme";
import { useT } from "../i18n/I18nContext";

const inp = {
  width: '100%', padding: '9px 12px',
  background: T.sunken, color: T.text,
  border: `1px solid ${T.border}`, borderRadius: 8,
  outline: 'none', font: '500 14px "Space Grotesk"',
};
const label = { font: '500 12px "Space Grotesk"', color: T.textDim };
const field = { display: 'flex', flexDirection: 'column', gap: 6 };
const card = {
  background: T.panel, border: `1px solid ${T.border}`,
  borderRadius: 14, padding: 24,
  display: 'flex', flexDirection: 'column', gap: 14,
};
const errBox = {
  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
  color: '#fca5a5', font: '500 13px "Space Grotesk"',
  padding: '8px 12px', borderRadius: 7,
};
const btnPrimary = {
  padding: '10px 0', background: T.accent, color: '#fff', border: 'none',
  borderRadius: 8, font: '600 14px "Space Grotesk"', cursor: 'pointer',
};
const btnGhost = {
  padding: '10px 0', background: 'transparent', color: T.textDim,
  border: `1px solid ${T.border}`, borderRadius: 8,
  font: '600 14px "Space Grotesk"', cursor: 'pointer',
};

function StepDots({ step }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 18 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: i <= step ? T.accent : T.border,
        }}/>
      ))}
    </div>
  );
}

export default function SetupWizard() {
  const navigate = useNavigate();
  const t = useT();
  const [step, setStep] = useState(0); // 0=account, 1=services, 2=done
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
  const emailRef = useRef(null);
  const [sonarrHost, setSonarrHost] = useState("");
  const [sonarrKey, setSonarrKey] = useState("");
  const [testResult, setTestResult] = useState(null);

  async function handleCreateAccount(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const u = usernameRef.current?.value ?? "";
    const p = passwordRef.current?.value ?? "";
    const em = emailRef.current?.value || undefined;
    try {
      await register(u, p, em);
      const res = await login(u, p);
      localStorage.setItem("token", res.data.access_token);
      setStep(1);
    } catch (err) {
      setError(err.response?.data?.detail || t("login_error_generic"));
    } finally {
      setLoading(false);
    }
  }

  async function handleTestSonarr() {
    setLoading(true);
    setTestResult(null);
    try {
      const res = await testConnection("sonarr", { host: sonarrHost, api_key: sonarrKey });
      setTestResult(res.data);
    } catch {
      setTestResult({ connected: false, reason: t("setup_test_failed") });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSonarr() {
    setLoading(true);
    setError("");
    try {
      if (sonarrHost || sonarrKey) {
        await updateSettings({ sonarr_host: sonarrHost, sonarr_api_key: sonarrKey });
      }
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.detail || t("setup_save_error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100dvh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      position: 'relative',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <svg width={44} height={44} viewBox="0 0 24 24" fill="none"
            stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ marginBottom: 12 }}>
            <rect x="2" y="4" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="18" x2="12" y2="21"/>
          </svg>
          <div style={{ font: '700 22px "Space Grotesk"', color: T.text }}>{t("setup_title")}</div>
          <div style={{ font: '500 13px "Space Grotesk"', color: T.textMute, marginTop: 4 }}>
            {step === 0 && t("setup_step_account_sub")}
            {step === 1 && t("setup_step_services_sub")}
            {step === 2 && t("setup_step_done_sub")}
          </div>
        </div>

        <StepDots step={step}/>

        {step === 0 && (
          <form onSubmit={handleCreateAccount} style={card}>
            {error && <div style={errBox}>{error}</div>}
            <div style={field}>
              <label style={label}>{t("login_username")}</label>
              <input ref={usernameRef} type="text" name="username"
                autoFocus autoComplete="username" placeholder="admin" style={inp}/>
            </div>
            <div style={field}>
              <label style={label}>{t("login_password")}</label>
              <input ref={passwordRef} type="password" name="password"
                autoComplete="new-password" placeholder="••••••••" style={inp}/>
            </div>
            <div style={field}>
              <label style={label}>{t("login_email_optional")}</label>
              <input ref={emailRef} type="email" name="email"
                autoComplete="email" placeholder="you@example.com" style={inp}/>
            </div>
            <button type="submit" disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
              {loading ? t("login_register_submitting") : t("setup_create_account_btn")}
            </button>
          </form>
        )}

        {step === 1 && (
          <div style={card}>
            {error && <div style={errBox}>{error}</div>}
            <div style={{ font: '500 13px "Space Grotesk"', color: T.textDim, lineHeight: 1.6 }}>
              {t("setup_sonarr_intro")}
            </div>
            <div style={field}>
              <label style={label}>{t("setup_sonarr_host_label")}</label>
              <input value={sonarrHost} onChange={e => setSonarrHost(e.target.value)}
                type="text" placeholder="192.168.1.10:8989" style={inp}/>
            </div>
            <div style={field}>
              <label style={label}>{t("setup_sonarr_key_label")}</label>
              <input value={sonarrKey} onChange={e => setSonarrKey(e.target.value)}
                type="password" placeholder="••••••••••••••••" style={inp}/>
            </div>
            {testResult && (
              <div style={testResult.connected
                ? { ...errBox, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac' }
                : errBox}>
                {testResult.connected
                  ? `${t("setup_test_ok")} (v${testResult.version})`
                  : `${t("setup_test_fail")}: ${testResult.reason || "?"}`}
              </div>
            )}
            <button type="button" onClick={handleTestSonarr} disabled={loading || !sonarrHost || !sonarrKey}
              style={{ ...btnGhost, opacity: (loading || !sonarrHost || !sonarrKey) ? 0.5 : 1 }}>
              {t("setup_test_btn")}
            </button>
            {/* One button, not two — a separate "Skip" next to filled-in fields
                was ambiguous and (confirmed in practice) let people lose data
                they'd just typed by clicking the wrong one. This always does
                the right thing: saves if there's anything to save, just
                advances if the fields are empty. */}
            <button type="button" onClick={handleSaveSonarr} disabled={loading}
              style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
              {(sonarrHost || sonarrKey) ? t("setup_continue_btn") : t("setup_skip_btn")}
            </button>
          </div>
        )}

        {step === 2 && (
          <div style={card}>
            <div style={{ textAlign: 'center', font: '500 13px "Space Grotesk"', color: T.textDim, lineHeight: 1.6 }}>
              {t("setup_done_text")}
            </div>
            <button type="button" onClick={() => navigate("/")} style={btnPrimary}>
              {t("setup_enter_app_btn")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
