/**
 * SetupWizard — first-run onboarding, shown instead of Login when the DB has
 * zero users (see backend/app/routers/auth.py::setup_status and App.jsx's
 * SetupGate). Four steps:
 *   0) create the admin account,
 *   1) connect services straight into the registry (Sonarr required; Prowlarr,
 *      qBittorrent, Emby/Jellyfin optional),
 *   2) create the first library linked to the Sonarr service,
 *   3) kick off the initial sync and hand off to the dashboard.
 *
 * Unlike the old wizard, this writes to the service registry (POST /services)
 * and creates a Library (POST /libraries) rather than the legacy global
 * sonarr_host setting — so what you configure here actually shows up in
 * Připojení → Služby and Knihovny, and sync runs immediately.
 */
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  register, login, createService, testServiceUnsaved,
  createLibrary, syncLibrary,
} from "../api/client";
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
const okBox = {
  ...errBox,
  background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac',
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

const N_STEPS = 4;

function StepDots({ step }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 18 }}>
      {Array.from({ length: N_STEPS }).map((_, i) => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: i <= step ? T.accent : T.border,
        }}/>
      ))}
    </div>
  );
}

// A single connection block inside the services step. `cred` is either
// "api_key" (Sonarr/Prowlarr/Emby) or "userpass" (qBittorrent).
function ServiceBlock({ svc, state, setState, t }) {
  const set = (patch) => setState({ ...state, ...patch, test: null });
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    try {
      const body = { type: svc.type, host: state.host, api_key: state.api_key || "" };
      const res = await testServiceUnsaved(body);
      setState({ ...state, test: res.data });
    } catch {
      setState({ ...state, test: { connected: false, reason: t("setup_test_failed") } });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{
      border: `1px solid ${T.border}`, borderRadius: 10, padding: 14,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ font: '600 14px "Space Grotesk"', color: T.text }}>{svc.label}</span>
        {svc.required
          ? <span style={{ font: '500 10px "Space Grotesk"', color: T.accent }}>{t("setup_required")}</span>
          : <span style={{ font: '500 10px "Space Grotesk"', color: T.textMute }}>{t("setup_optional")}</span>}
      </div>
      <div style={field}>
        <label style={label}>{t("setup_host_label")}</label>
        <input value={state.host} onChange={e => set({ host: e.target.value })}
          type="text" placeholder={svc.hostPlaceholder} style={inp}/>
      </div>
      {svc.cred === "api_key" && (
        <div style={field}>
          <label style={label}>{t("setup_apikey_label")}</label>
          <input value={state.api_key} onChange={e => set({ api_key: e.target.value })}
            type="password" placeholder="••••••••••••••••" style={inp}/>
        </div>
      )}
      {svc.cred === "userpass" && (
        <>
          <div style={field}>
            <label style={label}>{t("setup_username_label")}</label>
            <input value={state.username} onChange={e => set({ username: e.target.value })}
              type="text" placeholder="admin" style={inp}/>
          </div>
          <div style={field}>
            <label style={label}>{t("setup_password_label")}</label>
            <input value={state.password} onChange={e => set({ password: e.target.value })}
              type="password" placeholder="••••••••" style={inp}/>
          </div>
        </>
      )}
      {state.test && (
        <div style={state.test.connected ? okBox : errBox}>
          {state.test.connected
            ? t("setup_test_ok")
            : `${t("setup_test_fail")}: ${state.test.reason || "?"}`}
        </div>
      )}
      <button type="button" onClick={handleTest}
        disabled={testing || !state.host}
        style={{ ...btnGhost, padding: '7px 0', opacity: (testing || !state.host) ? 0.5 : 1 }}>
        {testing ? t("setup_testing") : t("setup_test_btn")}
      </button>
    </div>
  );
}

const SERVICE_DEFS = [
  { type: "sonarr",      label: "Sonarr",          cred: "api_key",  required: true,  hostPlaceholder: "192.168.1.10:8989" },
  { type: "prowlarr",    label: "Prowlarr",        cred: "api_key",  required: false, hostPlaceholder: "192.168.1.10:9696" },
  { type: "qbittorrent", label: "qBittorrent",     cred: "userpass", required: false, hostPlaceholder: "192.168.1.10:8080" },
  { type: "emby",        label: "Emby / Jellyfin", cred: "api_key",  required: false, hostPlaceholder: "http://192.168.1.10:8096" },
];

const emptyServiceState = () =>
  Object.fromEntries(SERVICE_DEFS.map(s => [s.type, { host: "", api_key: "", username: "", password: "", test: null }]));

export default function SetupWizard() {
  const navigate = useNavigate();
  const t = useT();
  const [step, setStep] = useState(0); // 0=account 1=services 2=library 3=done
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
  const emailRef = useRef(null);

  const [svcState, setSvcState] = useState(emptyServiceState);
  const [sonarrServiceId, setSonarrServiceId] = useState(null);
  const [libName, setLibName] = useState("Anime");
  const [createdLibId, setCreatedLibId] = useState(null);
  const [syncNote, setSyncNote] = useState("");

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

  // Create every filled-in service in the registry. Sonarr is required and
  // becomes the default instance of its type; its new id feeds the library step.
  async function handleSaveServices() {
    setError("");
    const sonarr = svcState.sonarr;
    if (!sonarr.host) {
      setError(t("setup_sonarr_required"));
      return;
    }
    setLoading(true);
    try {
      let sonarrId = null;
      for (const def of SERVICE_DEFS) {
        const s = svcState[def.type];
        if (!s.host) continue;  // optional services left blank are skipped
        const payload = {
          name: def.label,
          type: def.type,
          host: s.host,
          api_key: s.api_key || undefined,
          username: s.username || undefined,
          password: s.password || undefined,
          is_default: true,   // first instance of each type is the default
        };
        const res = await createService(payload);
        if (def.type === "sonarr") sonarrId = res.data?.id ?? null;
      }
      setSonarrServiceId(sonarrId);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.detail || t("setup_save_error"));
    } finally {
      setLoading(false);
    }
  }

  // Create the library linked to the Sonarr service, then kick off its sync.
  async function handleCreateLibrary() {
    setError("");
    setLoading(true);
    try {
      const res = await createLibrary({
        name: libName.trim() || "Anime",
        media_type: "anime",
        sonarr_service_id: sonarrServiceId ?? undefined,
      });
      const libId = res.data?.id ?? null;
      setCreatedLibId(libId);
      // Fire the initial sync — don't block the wizard on its completion.
      if (libId != null) {
        try {
          await syncLibrary(libId);
          setSyncNote(t("setup_sync_started"));
        } catch {
          setSyncNote(t("setup_sync_failed_note"));
        }
      }
      setStep(3);
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
      <div style={{ width: '100%', maxWidth: 440 }}>
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
            {step === 2 && t("setup_step_library_sub")}
            {step === 3 && t("setup_step_done_sub")}
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
              {t("setup_services_intro")}
            </div>
            {SERVICE_DEFS.map(def => (
              <ServiceBlock key={def.type} svc={def} t={t}
                state={svcState[def.type]}
                setState={(next) => setSvcState({ ...svcState, [def.type]: next })}/>
            ))}
            <button type="button" onClick={handleSaveServices} disabled={loading}
              style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
              {loading ? t("setup_saving") : t("setup_continue_btn")}
            </button>
          </div>
        )}

        {step === 2 && (
          <div style={card}>
            {error && <div style={errBox}>{error}</div>}
            <div style={{ font: '500 13px "Space Grotesk"', color: T.textDim, lineHeight: 1.6 }}>
              {t("setup_library_intro")}
            </div>
            <div style={field}>
              <label style={label}>{t("setup_library_name_label")}</label>
              <input value={libName} onChange={e => setLibName(e.target.value)}
                type="text" placeholder="Anime" style={inp}/>
            </div>
            <button type="button" onClick={handleCreateLibrary} disabled={loading || !libName.trim()}
              style={{ ...btnPrimary, opacity: (loading || !libName.trim()) ? 0.6 : 1 }}>
              {loading ? t("setup_creating") : t("setup_create_library_btn")}
            </button>
          </div>
        )}

        {step === 3 && (
          <div style={card}>
            <div style={{ textAlign: 'center', font: '500 13px "Space Grotesk"', color: T.textDim, lineHeight: 1.6 }}>
              {t("setup_done_text")}
            </div>
            {syncNote && <div style={okBox}>{syncNote}</div>}
            <button type="button" onClick={() => navigate("/")} style={btnPrimary}>
              {t("setup_enter_app_btn")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
