import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings as SettingsIcon, Users, Activity, Server, Link2, Key,
  Loader2, CheckCircle2, XCircle, Trash2, Plus, KeyRound,
  RefreshCw, Clock, AlertTriangle, ExternalLink, Copy, Eye, EyeOff,
  FileText, List, ChevronUp, ChevronDown, GripVertical, BellOff,
} from "lucide-react";
import {
  getUsers, createUser, updateUser, deleteUser, getJobs,
  overseerrStatus, overseerrRequests, overseerrIssues,
  getApiKeys, createApiKey, deleteApiKey,
  embyStatus, smbTest, sonarrHealth,
  autoUnmonitor, refreshCounts,
} from "../api/client";
import api from "../api/client";
import clsx from "clsx";
import { useToast } from "../context/ToastContext";

const TABS = [
  { id: "app",         label: "Aplikace",      Icon: Server },
  { id: "connections", label: "Propojení",     Icon: Link2 },
  { id: "providers",   label: "Poskytovatelé", Icon: List },
  { id: "subtitles",   label: "Titulky",       Icon: FileText },
  { id: "apikeys",     label: "API klíče",     Icon: Key },
  { id: "users",       label: "Uživatelé",     Icon: Users },
  { id: "activity",    label: "Aktivita",      Icon: Activity },
];

// ── App Config ────────────────────────────────────────────────────────────────

function RateLimitsSection() {
  const qc = useQueryClient();

  const { data: cfg = {} } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
  });

  async function saveSettings(payload) {
    await api.put("/settings", payload);
    qc.invalidateQueries(["app-settings"]);
  }

  return (
    <EditableConnectionSection
      title="Limity stahování"
      service={null}
      testBodyKeys={null}
      initialValues={{ subtitle_download_delay: cfg.subtitle_download_delay ?? "2" }}
      fields={[
        {
          key: "subtitle_download_delay",
          label: "Zpoždění mezi stahováním titulků (sekundy)",
          placeholder: "2",
        },
      ]}
      onSave={saveSettings}
    />
  );
}

function AutoUnmonitorSection() {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [runningCounts, setRunningCounts] = useState(false);

  async function handleAutoUnmonitor() {
    setRunning(true);
    try {
      await autoUnmonitor();
      toast.success("Auto-unmonitor spuštěn na pozadí — výsledek uvidíš v Activity logu.");
    } catch {
      toast.error("Chyba při spouštění auto-unmonitoru.");
    } finally {
      setRunning(false);
    }
  }

  async function handleRefreshCounts() {
    setRunningCounts(true);
    try {
      await refreshCounts();
      toast.success("Refresh počtů spuštěn na pozadí.");
    } catch {
      toast.error("Chyba při refresh counts.");
    } finally {
      setRunningCounts(false);
    }
  }

  return (
    <Section
      title="Sonarr automatizace"
      subtitle="Správa monitorování na základě stavu titulků"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-4 p-4 rounded-lg bg-bg border border-border">
          <BellOff size={18} className="mt-0.5 text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text mb-0.5">Auto-unmonitor podle titulků</div>
            <div className="text-xs text-muted leading-relaxed">
              Projde všechny série a epizody. Epizody s&nbsp;českými titulky označí v&nbsp;Sonarru
              jako <em>unmonitored</em>. Pokud má celé anime všechny díly pokryté, odmonitoruje celou sérii.
            </div>
          </div>
          <button
            onClick={handleAutoUnmonitor}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <BellOff size={14} />}
            {running ? "Spouštím…" : "Spustit"}
          </button>
        </div>

        <div className="flex items-start gap-4 p-4 rounded-lg bg-bg border border-border">
          <RefreshCw size={18} className="mt-0.5 text-muted flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text mb-0.5">Refresh počtů epizod a titulků</div>
            <div className="text-xs text-muted leading-relaxed">
              Přepočítá počty epizod, souborů a&nbsp;českých titulků pro všechny série.
              Spusť po ruční změně souborů nebo po aktualizaci Sonarru.
            </div>
          </div>
          <button
            onClick={handleRefreshCounts}
            disabled={runningCounts}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-border text-text hover:bg-border/80 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {runningCounts ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {runningCounts ? "Spouštím…" : "Spustit"}
          </button>
        </div>
      </div>
    </Section>
  );
}


function AppConfig() {
  const { data, isLoading } = useQuery({
    queryKey: ["paths-config"],
    queryFn: () => api.get("/paths/config").then(r => r.data),
  });

  const rows = data ? [
    ["Platforma",        data.platform],
    ["Sonarr prefix",    data.path_sonarr_prefix],
    ["Lokální prefix",   data.path_local_prefix  || "— nenastaveno"],
    ["SMB host",         data.smb_host           || "—"],
    ["SMB uživatel",     data.smb_username        || "— (není)"],
    ["SMB",              data.smb_configured ? "✅ nakonfigurováno" : "❌ nenastaveno"],
    ["Režim cest",       data.mode],
  ] : [];

  return (
    <div className="flex flex-col gap-6">
      <Section title="Konfigurace cest">
        {isLoading ? <Spin /> : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 text-muted w-48">{k}</td>
                  <td className="py-2 font-mono text-text">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <OverseerrStatus />

      <RateLimitsSection />

      <AutoUnmonitorSection />

      <Section title="Nastavení v .env" subtitle="Edituj soubor backend/.env a restartuj server">
        <div className="text-xs text-muted font-mono bg-bg rounded-lg p-4 leading-relaxed">
          {[
            "SONARR_HOST=192.168.x.x:8989",
            "SONARR_API_KEY=...",
            "PATH_SONARR_PREFIX=/data",
            "PATH_LOCAL_PREFIX=\\\\server\\data",
            "SMB_HOST=192.168.x.x",
            "SMB_USERNAME=user",
            "SMB_PASSWORD=pass",
            "HIYORI_USERNAME=...",
            "HIYORI_PASSWORD=...",
            "HNS_USERNAME=...",
            "HNS_PASSWORD=...",
            "OLLAMA_HOST=192.168.x.x:11434",
            "MEDIA_ROOT=\\\\server\\data\\media",
            "# Overseerr / Jellyseerr",
            "OVERSEERR_HOST=http://192.168.x.x:5055",
            "OVERSEERR_API_KEY=...",
            "# Emby / Jellyfin",
            "EMBY_HOST=http://192.168.x.x:8096",
            "EMBY_API_KEY=...",
            "EMBY_EXTERNAL_URL=https://emby.mojadomena.cz",
            "# Webhooks",
            "WEBHOOK_SECRET=",
          ].map(line => (
            <div key={line} className={line.startsWith("#") ? "text-muted/50 mt-2" : ""}>{line}</div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ── Overseerr status widget ───────────────────────────────────────────────────

const ISSUE_STATUS_COLOR = { 1: "text-yellow-400", 2: "text-green-400" };

function OverseerrStatus() {
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["overseerr-status"],
    queryFn: () => overseerrStatus().then(r => r.data),
    staleTime: 30_000,
  });

  const { data: issuesData } = useQuery({
    queryKey: ["overseerr-issues"],
    queryFn: () => overseerrIssues({ take: 50, status: 1 }).then(r => r.data),
    enabled: status?.connected === true,
    staleTime: 60_000,
  });

  const { data: reqData } = useQuery({
    queryKey: ["overseerr-requests"],
    queryFn: () => overseerrRequests("pending").then(r => r.data),
    enabled: status?.connected === true,
    staleTime: 60_000,
  });

  if (statusLoading) return null;
  if (!status || status.reason === "not_configured") {
    return (
      <Section title="Overseerr / Jellyseerr" subtitle="Nastav OVERSEERR_HOST a OVERSEERR_API_KEY v .env">
        <p className="text-sm text-muted">Není nakonfigurováno.</p>
      </Section>
    );
  }

  const subIssues = (issuesData?.results || []).filter(i => i.type === 3);
  const pendingRequests = (reqData?.results || []).length;

  return (
    <Section title="Overseerr / Jellyseerr">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          {status.connected
            ? <CheckCircle2 size={14} className="text-green-400" />
            : <XCircle      size={14} className="text-red-400" />}
          <span className={clsx("text-sm", status.connected ? "text-green-400" : "text-red-400")}>
            {status.connected ? `Připojeno — ${status.version || ""}` : `Nepřipojeno: ${status.reason}`}
          </span>
        </div>
        {status.connected && (
          <>
            <div className="flex gap-4 text-sm">
              <StatBox label="čekající požadavky" value={pendingRequests} />
              <StatBox label="problémy s titulky"  value={subIssues.length} warn={subIssues.length > 0} />
              <StatBox label="otevřené problémy"   value={issuesData?.totalResults || 0} warn={(issuesData?.totalResults || 0) > 0} warnColor="text-orange-400" />
            </div>
            {subIssues.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-text uppercase tracking-wide">Otevřené problémy s titulky</p>
                <div className="bg-bg border border-border rounded-xl overflow-hidden">
                  {subIssues.slice(0, 10).map(issue => (
                    <div key={issue.id} className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-0 text-xs">
                      <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0" />
                      <span className="flex-1 text-text-dim truncate">{issue.message || "Bez popisu"}</span>
                      <span className={clsx("flex-shrink-0", ISSUE_STATUS_COLOR[issue.status] || "text-muted")}>{issue.status_label}</span>
                      {issue.overseerr_url && (
                        <a href={issue.overseerr_url} target="_blank" rel="noreferrer" className="text-muted hover:text-accent flex-shrink-0">
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

function StatBox({ label, value, warn, warnColor = "text-yellow-400" }) {
  return (
    <div className="flex flex-col items-center px-3 py-2 bg-bg rounded-lg border border-border min-w-[72px]">
      <span className={clsx("font-bold", warn ? warnColor : "text-text")}>{value}</span>
      <span className="text-xs text-muted text-center">{label}</span>
    </div>
  );
}

// ── Connections Tab ───────────────────────────────────────────────────────────

/** Jednoduchý input pro textové pole nastavení */
function SettingInput({ label, value, onChange, placeholder = "" }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-text font-mono focus:outline-none focus:border-accent"
      />
    </div>
  );
}

/** Input pro API klíče / hesla — zobrazuje maskovanou hodnotu, po "Změnit" se vyprázdní */
function SecretInput({ label, maskedValue, value, onChange, onReset, isEditing }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted">{label}</label>
      <div className="flex gap-2">
        {isEditing ? (
          <input
            type="password"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="Zadej novou hodnotu…"
            autoFocus
            className="flex-1 bg-bg border border-accent rounded-lg px-3 py-1.5 text-sm text-text font-mono focus:outline-none"
          />
        ) : (
          <div className="flex-1 bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-muted font-mono truncate">
            {maskedValue || "—"}
          </div>
        )}
        <button
          type="button"
          onClick={onReset}
          className="flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 bg-surface border border-border rounded-lg text-muted hover:text-text transition-colors"
        >
          {isEditing ? <EyeOff size={11} /> : <Eye size={11} />}
          {isEditing ? "Zrušit" : "Změnit"}
        </button>
      </div>
    </div>
  );
}

/** Indikátor výsledku testu připojení */
function TestResult({ result }) {
  if (!result) return null;
  const ok = result.connected === true || result.accessible === true;
  return (
    <div className="flex items-center gap-1.5">
      {ok
        ? <CheckCircle2 size={13} className="text-green-400" />
        : <XCircle      size={13} className="text-red-400" />}
      <span className={clsx("text-xs", ok ? "text-green-400" : "text-red-400")}>
        {ok
          ? result.version
            ? `Připojeno — v${result.version}`
            : result.server_name
              ? `Připojeno — ${result.server_name}`
              : result.path
                ? `Dostupné — ${result.path}`
                : "Připojeno"
          : `Chyba: ${result.reason || result.error || "nedostupné"}`}
      </span>
    </div>
  );
}

/**
 * Editovatelná sekce pro jednu službu.
 *
 * fields: [{ key, label, secret?, placeholder? }]
 * service: název pro POST /api/settings/test/{service}
 * testBodyKeys: { host: fieldKey, api_key: fieldKey } — mapování na body pro test
 */
function EditableConnectionSection({ title, fields, service, testBodyKeys, initialValues, onSave }) {
  const toast = useToast();

  // Stav formuláře: { [key]: string }
  const [form, setForm]       = useState(() => {
    const init = {};
    fields.forEach(f => { init[f.key] = initialValues[f.key] ?? ""; });
    return init;
  });
  // Sleduje, která secret pole jsou v "edit" módu
  const [editing, setEditing] = useState({});
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Aktualizuj form při načtení dat
  useState(() => {
    const init = {};
    fields.forEach(f => { init[f.key] = initialValues[f.key] ?? ""; });
    setForm(init);
  });

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }));
    setTestResult(null);
  }

  function toggleSecret(key) {
    setEditing(e => ({ ...e, [key]: !e[key] }));
    if (!editing[key]) {
      // Přechod do edit módu → vymaž field
      setForm(f => ({ ...f, [key]: "" }));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Odešli pouze non-secret fieldy + secret fieldy které jsou v edit módu
      const payload = {};
      fields.forEach(f => {
        if (!f.secret || editing[f.key]) {
          payload[f.key] = form[f.key];
        }
      });
      await onSave(payload);
      toast.success("Nastavení uloženo");
      setEditing({});
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Nepodařilo se uložit");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      // Sestaví test body z aktuálních hodnot formuláře
      const body = {};
      if (testBodyKeys?.host)    body.host    = form[testBodyKeys.host]    || undefined;
      if (testBodyKeys?.api_key) body.api_key = form[testBodyKeys.api_key] || undefined;
      const r = await api.post(`/settings/test/${service}`, body).then(d => d.data);
      setTestResult(r);
    } catch {
      setTestResult({ connected: false, reason: "Chyba při testu" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <TestResult result={testResult} />
          {service && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-border rounded-lg text-muted hover:text-text disabled:opacity-40 transition-colors"
            >
              {testing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Otestovat
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : null}
            Uložit
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3">
        {fields.map(f => f.secret ? (
          <SecretInput
            key={f.key}
            label={f.label}
            maskedValue={initialValues[f.key]}
            value={form[f.key]}
            onChange={val => setField(f.key, val)}
            onReset={() => toggleSecret(f.key)}
            isEditing={!!editing[f.key]}
          />
        ) : (
          <SettingInput
            key={f.key}
            label={f.label}
            value={form[f.key]}
            onChange={val => setField(f.key, val)}
            placeholder={f.placeholder}
          />
        ))}
      </div>
    </div>
  );
}

function ConnectionsTab() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: cfg = {}, isLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
  });

  if (isLoading) return <Spin />;

  async function saveSettings(payload) {
    await api.put("/settings", payload);
    qc.invalidateQueries(["app-settings"]);
  }

  return (
    <div className="flex flex-col gap-6">

      <EditableConnectionSection
        title="Sonarr"
        service="sonarr"
        testBodyKeys={{ host: "sonarr_host", api_key: "sonarr_api_key" }}
        initialValues={cfg}
        fields={[
          { key: "sonarr_host",    label: "Host URL",  placeholder: "192.168.1.x:8989" },
          { key: "sonarr_api_key", label: "API klíč",  secret: true },
        ]}
        onSave={saveSettings}
      />

      <EditableConnectionSection
        title="Overseerr / Jellyseerr"
        service="overseerr"
        testBodyKeys={{ host: "overseerr_host", api_key: "overseerr_api_key" }}
        initialValues={cfg}
        fields={[
          { key: "overseerr_host",    label: "Host URL",  placeholder: "http://192.168.1.x:5055" },
          { key: "overseerr_api_key", label: "API klíč",  secret: true },
        ]}
        onSave={saveSettings}
      />

      <EditableConnectionSection
        title="Emby / Jellyfin"
        service="emby"
        testBodyKeys={{ host: "emby_host", api_key: "emby_api_key" }}
        initialValues={cfg}
        fields={[
          { key: "emby_host",         label: "Interní URL",    placeholder: "http://192.168.1.x:8096" },
          { key: "emby_external_url", label: "Externí doména", placeholder: "https://emby.mojadomena.cz" },
          { key: "emby_api_key",      label: "API klíč",       secret: true },
        ]}
        onSave={saveSettings}
      />

      <EditableConnectionSection
        title="SMB / Síťové sdílení"
        service="smb"
        testBodyKeys={{ host: "smb_host" }}
        initialValues={cfg}
        fields={[
          { key: "smb_host",     label: "SMB host",    placeholder: "192.168.1.x" },
          { key: "smb_username", label: "Uživatel" },
          { key: "smb_password", label: "Heslo",       secret: true },
          { key: "media_root",   label: "Media root",  placeholder: "\\\\server\\data\\media" },
        ]}
        onSave={saveSettings}
      />

      <EditableConnectionSection
        title="Discord oznámení"
        service={null}
        initialValues={cfg}
        fields={[
          {
            key:         "discord_webhook_url",
            label:       "Webhook URL",
            placeholder: "https://discord.com/api/webhooks/...",
            secret:      true,
          },
        ]}
        onSave={saveSettings}
      />

      <div className="bg-surface border border-border rounded-xl p-4 text-xs text-muted flex flex-col gap-1">
        <p className="font-medium text-text">ℹ️ Discord webhook</p>
        <p>Při povýšení nebo degradaci anime (Overseerr issue) bude do zadaného Discord kanálu odeslána zpráva s názvem, plakátem a popisem. Webhook URL najdeš v nastavení Discord serveru → Integrace → Webhooks.</p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-4 text-xs text-muted flex flex-col gap-1">
        <p className="font-medium text-text">ℹ️ Poznámka k restartování</p>
        <p>Změny host URL a API klíčů jsou uloženy do databáze a mají okamžitý efekt pro nová připojení. Pokud se nastavení neprojeví, restartuj backend server.</p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-4 text-xs text-muted">
        Přihlašovací údaje ke zdrojům titulků (Hiyori, HnS, Kamui, GenSubs) a nastavení priority jsou na záložce <strong className="text-text">Poskytovatelé</strong>.
      </div>
    </div>
  );
}

// ── API Keys Tab ──────────────────────────────────────────────────────────────

function ApiKeysTab() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => getApiKeys().then(r => r.data),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newName,    setNewName]    = useState("");
  const [newKey,     setNewKey]     = useState(null); // plaintext po vytvoření
  const [copied,     setCopied]     = useState(false);

  const createMut = useMutation({
    mutationFn: () => createApiKey(newName),
    onSuccess: (r) => {
      qc.invalidateQueries(["api-keys"]);
      setNewKey(r.data.plaintext);
      setNewName("");
      setShowCreate(false);
    },
    onError: () => toast.error("Nepodařilo se vytvořit API klíč"),
  });

  const revokeMut = useMutation({
    mutationFn: (id) => deleteApiKey(id),
    onSuccess: () => {
      qc.invalidateQueries(["api-keys"]);
      toast.success("API klíč byl revokován");
    },
    onError: () => toast.error("Nepodařilo se revokovat klíč"),
  });

  function copyKey() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Zobrazen plaintext klíče po vytvoření */}
      {newKey && (
        <div className="bg-yellow-900/30 border border-yellow-600/40 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-sm font-semibold text-yellow-300">⚠️ Toto je jediná příležitost zkopírovat klíč!</p>
          <p className="text-xs text-yellow-200/70">Po zavření tohoto okna klíč již nelze zobrazit. Uložte ho na bezpečné místo.</p>
          <div className="flex items-center gap-2 bg-bg rounded-lg px-3 py-2 border border-border">
            <code className="flex-1 text-xs font-mono text-accent break-all">{newKey}</code>
            <button
              onClick={copyKey}
              className="flex-shrink-0 flex items-center gap-1 text-xs text-muted hover:text-text transition-colors"
            >
              <Copy size={13} />
              {copied ? "Zkopírováno!" : "Kopírovat"}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="text-xs text-muted hover:text-text self-end transition-colors"
          >
            Zavřít
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{keys.length} aktivních klíčů</span>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
        >
          <Plus size={12} /> Vytvořit klíč
        </button>
      </div>

      {showCreate && (
        <div className="bg-bg border border-border rounded-xl p-4 flex flex-col gap-3">
          <p className="text-sm font-medium text-text">Nový API klíč</p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Název / popis klíče</label>
            <input
              type="text"
              placeholder="např. Home Assistant, n8n, skript"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => createMut.mutate()}
              disabled={!newName.trim() || createMut.isPending}
              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg"
            >
              {createMut.isPending ? <Loader2 size={11} className="animate-spin" /> : null} Vytvořit
            </button>
            <button onClick={() => { setShowCreate(false); setNewName(""); }} className="text-xs px-3 py-1.5 bg-surface border border-border rounded-lg text-muted hover:text-text">
              Zrušit
            </button>
          </div>
        </div>
      )}

      {isLoading ? <Spin /> : (
        keys.length === 0 ? (
          <p className="text-center py-10 text-muted text-sm">Zatím žádné API klíče.</p>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-4 py-2 text-left font-medium">Název</th>
                  <th className="px-4 py-2 text-left font-medium">Prefix</th>
                  <th className="px-4 py-2 text-left font-medium hidden sm:table-cell">Vytvořen</th>
                  <th className="px-4 py-2 text-left font-medium hidden sm:table-cell">Poslední použití</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-text">{k.name}</td>
                    <td className="px-4 py-2.5 font-mono text-muted">{k.key_prefix}…</td>
                    <td className="px-4 py-2.5 text-muted hidden sm:table-cell">{fmtDate(k.created_at)}</td>
                    <td className="px-4 py-2.5 text-muted hidden sm:table-cell">{fmtDate(k.last_used)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => revokeMut.mutate(k.id)}
                        disabled={revokeMut.isPending}
                        title="Revokovat"
                        className="p-1.5 text-muted hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <div className="bg-surface border border-border rounded-xl p-4 text-xs text-muted flex flex-col gap-1">
        <p className="font-medium text-text">Jak používat API klíč</p>
        <p>Přidej header do každého HTTP požadavku:</p>
        <code className="font-mono bg-bg rounded px-2 py-1 text-accent mt-1">X-Api-Key: ansk_...</code>
      </div>
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────

function UsersTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => getUsers().then(r => r.data),
  });

  const [showAdd,   setShowAdd]   = useState(false);
  const [addForm,   setAddForm]   = useState({ username: "", password: "", email: "", is_admin: false });
  const [addErr,    setAddErr]    = useState("");
  const [editPw,    setEditPw]    = useState(null);
  const [deleteId,  setDeleteId]  = useState(null);

  const me = JSON.parse(atob((localStorage.getItem("token") || "").split(".")[1] || "e30=") || "{}");

  const createMut = useMutation({
    mutationFn: () => createUser(addForm),
    onSuccess: () => {
      qc.invalidateQueries(["users"]);
      setShowAdd(false);
      setAddForm({ username: "", password: "", email: "", is_admin: false });
      setAddErr("");
      toast.success("Uživatel vytvořen");
    },
    onError: e => setAddErr(e?.response?.data?.detail || "Chyba"),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, field, val }) => updateUser(id, { [field]: val }),
    onSuccess: () => qc.invalidateQueries(["users"]),
  });

  const pwMut = useMutation({
    mutationFn: ({ id, pw }) => updateUser(id, { password: pw }),
    onSuccess: () => { qc.invalidateQueries(["users"]); setEditPw(null); toast.success("Heslo změněno"); },
  });

  const delMut = useMutation({
    mutationFn: (id) => deleteUser(id),
    onSuccess: () => { qc.invalidateQueries(["users"]); setDeleteId(null); toast.success("Uživatel smazán"); },
    onError: () => toast.error("Nepodařilo se smazat uživatele"),
  });

  if (isLoading) return <Spin />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{users.length} uživatelů</span>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
        >
          <Plus size={12} /> Přidat uživatele
        </button>
      </div>

      {showAdd && (
        <div className="bg-bg border border-border rounded-xl p-4 flex flex-col gap-3">
          <p className="text-sm font-medium text-text">Nový uživatel</p>
          {[
            ["Uživatelské jméno", "username", "text"],
            ["Heslo",             "password", "password"],
            ["E-mail",            "email",    "email"],
          ].map(([label, field, type]) => (
            <div key={field} className="flex flex-col gap-1">
              <label className="text-xs text-muted">{label}</label>
              <input
                type={type}
                value={addForm[field]}
                onChange={e => setAddForm(f => ({ ...f, [field]: e.target.value }))}
                className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
              />
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
            <input
              type="checkbox"
              checked={addForm.is_admin}
              onChange={e => setAddForm(f => ({ ...f, is_admin: e.target.checked }))}
              className="accent-accent"
            />
            Administrátor
          </label>
          {addErr && <p className="text-xs text-red-400">{addErr}</p>}
          <div className="flex gap-2">
            <button onClick={() => createMut.mutate()} disabled={createMut.isPending}
              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg">
              {createMut.isPending ? <Loader2 size={11} className="animate-spin" /> : null} Vytvořit
            </button>
            <button onClick={() => setShowAdd(false)} className="text-xs px-3 py-1.5 bg-surface border border-border rounded-lg text-muted hover:text-text">Zrušit</button>
          </div>
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text">{u.username}</p>
              {u.email && <p className="text-xs text-muted">{u.email}</p>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Toggle label="Admin"  value={u.is_admin}  disabled={u.id === me?.sub} onChange={v => toggleMut.mutate({ id: u.id, field: "is_admin",  val: v })} />
              <Toggle label="Aktivní" value={u.is_active} disabled={u.id === me?.sub} onChange={v => toggleMut.mutate({ id: u.id, field: "is_active", val: v })} />
              <button onClick={() => setEditPw({ id: u.id, pw: "" })} title="Změnit heslo"
                className="p-1.5 text-muted hover:text-text hover:bg-border rounded-lg transition-colors">
                <KeyRound size={14} />
              </button>
              {u.id !== me?.sub && (
                <button onClick={() => setDeleteId(u.id)}
                  className="p-1.5 text-muted hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {editPw && (
        <Modal title="Změna hesla" onClose={() => setEditPw(null)}>
          <input
            type="password" placeholder="Nové heslo"
            value={editPw.pw}
            onChange={e => setEditPw(p => ({ ...p, pw: e.target.value }))}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2 mt-3">
            <button onClick={() => pwMut.mutate(editPw)} disabled={!editPw.pw || pwMut.isPending}
              className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg disabled:opacity-50">Uložit</button>
            <button onClick={() => setEditPw(null)} className="text-xs px-3 py-1.5 bg-surface border border-border rounded-lg text-muted">Zrušit</button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Smazat uživatele?" onClose={() => setDeleteId(null)}>
          <p className="text-sm text-muted">Tato akce je nevratná.</p>
          <div className="flex gap-2 mt-3">
            <button onClick={() => delMut.mutate(deleteId)} disabled={delMut.isPending}
              className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50">Smazat</button>
            <button onClick={() => setDeleteId(null)} className="text-xs px-3 py-1.5 bg-surface border border-border rounded-lg text-muted">Zrušit</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Activity log ──────────────────────────────────────────────────────────────

const STATUS_COLOR = {
  running: "text-blue-400",
  done:    "text-green-400",
  error:   "text-red-400",
};

function ActivityTab() {
  const [statusFilter, setStatusFilter] = useState("");
  const [limit, setLimit] = useState(100);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["jobs", limit],
    queryFn: () => getJobs(limit).then(r => r.data),
    refetchInterval: 5000,
  });

  const allRuns = data?.runs || [];
  const runs = statusFilter ? allRuns.filter(r => r.status === statusFilter) : allRuns;

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit" })
      + " " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">{runs.length} záznamů</span>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="bg-bg border border-border rounded-lg px-2 py-1 text-xs text-muted focus:outline-none focus:border-accent">
            <option value="">Vše</option>
            <option value="running">Běží</option>
            <option value="done">Dokončeno</option>
            <option value="error">Chyba</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            className="bg-bg border border-border rounded-lg px-2 py-1 text-xs text-muted focus:outline-none focus:border-accent">
            <option value={50}>Posledních 50</option>
            <option value={100}>Posledních 100</option>
            <option value={200}>Posledních 200</option>
            <option value={500}>Posledních 500</option>
          </select>
          <button onClick={() => refetch()} className="flex items-center gap-1 text-xs text-muted hover:text-text transition-colors">
            <RefreshCw size={12} /> Obnovit
          </button>
        </div>
      </div>

      {isLoading && <Spin />}
      {!isLoading && runs.length === 0 && (
        <p className="text-center py-12 text-muted text-sm">Žádná aktivita.</p>
      )}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {runs.map((r, i) => (
          <div key={r.run_id || i} className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-0">
            <span className={clsx("text-xs mt-0.5 flex-shrink-0", STATUS_COLOR[r.status] || "text-muted")}>
              {r.status === "running" ? <Loader2 size={13} className="animate-spin" />
               : r.status === "done"  ? <CheckCircle2 size={13} />
               :                        <XCircle size={13} />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text">{r.job_name}</p>
              {r.message && <p className="text-xs text-muted truncate">{r.message}</p>}
            </div>
            <div className="text-xs text-muted/60 flex-shrink-0 flex flex-col items-end gap-0.5">
              <span className="flex items-center gap-0.5">
                <Clock size={10} />
                {fmtDate(r.started_at)}
              </span>
              {r.finished_at && (
                <span className="text-muted/40">
                  {((new Date(r.finished_at) - new Date(r.started_at)) / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────

function Section({ title, subtitle, children }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      <div className="bg-surface border border-border rounded-xl p-4">{children}</div>
    </div>
  );
}

function Toggle({ label, value, onChange, disabled }) {
  return (
    <label className={clsx("flex items-center gap-1.5 text-xs cursor-pointer select-none", disabled && "opacity-40 pointer-events-none")}>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={clsx(
          "relative w-8 h-4 rounded-full transition-colors flex-shrink-0",
          value ? "bg-accent" : "bg-border"
        )}
      >
        <span className={clsx(
          "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
          value ? "translate-x-4" : "translate-x-0.5"
        )} />
      </button>
      <span className="text-muted">{label}</span>
    </label>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold text-text mb-3">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Spin() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 size={20} className="animate-spin text-muted" />
    </div>
  );
}

// ── Subtitle settings tab ─────────────────────────────────────────────────────

// Keys that are stored as "true"/"false" strings in the DB
const SUBTITLE_BOOL_SETTINGS = [
  // ── Zpracování po stažení (Sub-Zero)
  {
    section: "Zpracování titulků po stažení",
    subtitle: "Aplikuje se automaticky po každém stažení titulku",
    items: [
      { key: "subtitle_encode_utf8",   label: "Překódovat na UTF-8",               desc: "Přepíše stažený soubor titulků jako UTF-8 (doporučeno)." },
      { key: "subtitle_remove_tags",   label: "Odebrat stylingové tagy",           desc: "Odstraní HTML tagy (<b>, <font …>) a ASS override bloky ({\\b1})." },
      { key: "subtitle_remove_emoji",  label: "Odebrat emoji a hudební symboly",   desc: "Odstraní emoji znaky a noty (♪ ♫) z textu titulků." },
      { key: "subtitle_ocr_fixes",     label: "Opravit OCR artefakty",             desc: "Opraví typické chyby OCR: typografické uvozovky, pomlčky, nezlomitelné mezery, …" },
      { key: "subtitle_common_fixes",  label: "Obecné opravy (mezery / interpunkce)", desc: "Odstraní zbytečné mezery, zdvojené tečky a mezery před interpunkcí." },
    ],
  },
  // ── Vložené titulky
  {
    section: "Vložené titulky (embedded)",
    subtitle: "Nastavení pro zjišťování vložených stop v mediálních souborech",
    items: [
      { key: "subtitle_treat_embedded_as_dl",   label: "Počítat vložené titulky jako stažené",  desc: "Pokud soubor obsahuje vloženou CS stopu, nebude stahován externí titulek." },
      { key: "subtitle_ignore_embedded_pgs",    label: "Ignorovat vložené PGS titulky",         desc: "Ignoruje obrazové PGS (Blu-ray) stopy při detekci — ty se nedají editovat." },
      { key: "subtitle_ignore_embedded_vobsub", label: "Ignorovat vložené VobSub titulky",      desc: "Ignoruje obrazové VobSub (DVD) stopy při detekci." },
      { key: "subtitle_ignore_embedded_ass",    label: "Ignorovat vložené ASS titulky",         desc: "Ignoruje vložené ASS/SSA stopy při detekci." },
    ],
  },
  // ── alass sync
  {
    section: "Synchronizace časování (alass)",
    subtitle: "Parametry pro automatickou synchronizaci titulků",
    items: [
      { key: "subtitle_auto_sync",         label: "Po stažení automaticky synchronizovat",      desc: "Po každém stažení titulku (ruční i automatické) spustí alass synchronizaci časování." },
      { key: "alass_use_audio_reference",  label: "Vždy použít zvukovou stopu jako referenci", desc: "Místo vloženého titulku používá pro synchronizaci audio (pomalejší, ale přesnější)." },
      { key: "alass_no_fix_framerate",     label: "Neopravovat nesoulad snímkové frekvence",   desc: "Pokud je zapnuto, alass nepokusí se opravit rozdíl FPS mezi referenčním a CS titulkem." },
      { key: "alass_golden_section_search",label: "Zlatý řez pro hledání optimálního FPS",     desc: "Aktivuje golden-section search pro přesnější nalezení poměru snímkových frekvencí." },
    ],
  },
];

function SubtitleSettingsTab() {
  const qc    = useQueryClient();
  const toast = useToast();

  const { data: cfg = {}, isLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (payload) => api.put("/settings", payload),
    onSuccess:  () => { qc.invalidateQueries(["app-settings"]); toast.success("Nastavení titulků uloženo"); },
    onError:    (e) => toast.error(`Chyba uložení: ${e?.response?.data?.detail || e.message}`),
  });

  function toggle(key) {
    const current = cfg[key] === "true";
    saveMutation.mutate({ [key]: current ? "false" : "true" });
  }

  function saveNum(key, val) {
    saveMutation.mutate({ [key]: String(val) });
  }

  if (isLoading) return <Spin />;

  return (
    <div className="flex flex-col gap-6">
      {SUBTITLE_BOOL_SETTINGS.map(({ section, subtitle, items }) => (
        <Section key={section} title={section} subtitle={subtitle}>
          <div className="flex flex-col divide-y divide-border">
            {items.map(({ key, label, desc }) => (
              <div key={key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text">{label}</p>
                  <p className="text-xs text-muted mt-0.5">{desc}</p>
                </div>
                <Toggle
                  value={cfg[key] === "true"}
                  onChange={() => toggle(key)}
                  disabled={saveMutation.isPending}
                />
              </div>
            ))}
          </div>
        </Section>
      ))}

      {/* alass numeric setting */}
      <Section title="Maximální posun (alass)" subtitle="Největší povolený posun titulků v sekundách">
        <AlassOffsetInput
          value={cfg["alass_max_offset_seconds"] || "60"}
          onSave={(v) => saveNum("alass_max_offset_seconds", v)}
          disabled={saveMutation.isPending}
        />
      </Section>

      {/* Rate limit (already in AppConfig but repeat here for convenience) */}
      <Section title="Zpoždění stahování" subtitle="Pauza mezi stahováním titulků (sekundy) — chrání před 429">
        <AlassOffsetInput
          value={cfg["subtitle_download_delay"] || "2"}
          onSave={(v) => saveNum("subtitle_download_delay", v)}
          disabled={saveMutation.isPending}
          unit="s"
          min={0}
          max={30}
        />
      </Section>
    </div>
  );
}

function AlassOffsetInput({ value, onSave, disabled, unit = "s", min = 0, max = 300 }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <div className="flex items-center gap-3">
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        onChange={e => setLocal(e.target.value)}
        className="w-24 bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
      />
      <span className="text-xs text-muted">{unit}</span>
      <button
        onClick={() => onSave(local)}
        disabled={disabled || local === value}
        className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg disabled:opacity-40 hover:bg-accent/80 transition-colors"
      >
        Uložit
      </button>
    </div>
  );
}

// ── Providers Tab ─────────────────────────────────────────────────────────────

const PROVIDER_META = {
  hiyori:  { label: "Hiyori.cz",        desc: "Rozcestník — odkazuje na HnS, Kamui a další",        color: "text-purple-400" },
  hns:     { label: "HnS.sk",           desc: "Česko-slovenské anime titulky, vyžaduje přihlášení", color: "text-blue-400"   },
  kamui:   { label: "Kamui-subs.cz",    desc: "CZ titulky jako zaheslovaný RAR, vyžaduje přihlášení", color: "text-orange-400" },
  gensubs: { label: "GenSubs / TeamNS", desc: "Veřejný zdroj bez přihlášení, stahuje celé série v RAR", color: "text-green-400" },
};

function ProvidersTab() {
  const qc    = useQueryClient();
  const toast = useToast();

  const { data: cfg = {}, isLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
  });

  const DEFAULT_ORDER = ["hiyori", "hns", "kamui", "gensubs"];

  const [order, setOrder] = useState(DEFAULT_ORDER);

  // Sync order from loaded settings
  useEffect(() => {
    if (cfg.subtitle_provider_priority) {
      const saved = cfg.subtitle_provider_priority.split(",").map(s => s.trim()).filter(Boolean);
      // Ensure all known providers appear
      const merged = [...saved, ...DEFAULT_ORDER.filter(p => !saved.includes(p))];
      setOrder(merged);
    }
  }, [cfg.subtitle_provider_priority]);

  async function saveSettings(payload) {
    await api.put("/settings", payload);
    qc.invalidateQueries(["app-settings"]);
  }

  async function saveOrder(newOrder) {
    try {
      await saveSettings({ subtitle_provider_priority: newOrder.join(",") });
      toast.success("Priorita uložena");
    } catch {
      toast.error("Nepodařilo se uložit prioritu");
    }
  }

  function moveUp(idx) {
    if (idx === 0) return;
    const next = [...order];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setOrder(next);
    saveOrder(next);
  }

  function moveDown(idx) {
    if (idx === order.length - 1) return;
    const next = [...order];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setOrder(next);
    saveOrder(next);
  }

  if (isLoading) return <Spin />;

  const skipExternal = cfg.subtitle_skip_external_links === "true";

  return (
    <div className="flex flex-col gap-6">

      {/* ── Priority order ─── */}
      <Section title="Priorita zdrojů" subtitle="Zdroje jsou prohledávány v tomto pořadí — první nalezený titulek se použije">
        <div className="flex flex-col divide-y divide-border">
          {order.map((id, idx) => {
            const meta = PROVIDER_META[id] || { label: id, desc: "", color: "text-muted" };
            return (
              <div key={id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <GripVertical size={14} className="text-border flex-shrink-0" />
                <span className={clsx("text-xs font-bold w-5 text-center flex-shrink-0", meta.color)}>{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text">{meta.label}</p>
                  <p className="text-xs text-muted">{meta.desc}</p>
                </div>
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <button
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0}
                    className="p-1 text-muted hover:text-text disabled:opacity-20 transition-colors rounded"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => moveDown(idx)}
                    disabled={idx === order.length - 1}
                    className="p-1 text-muted hover:text-text disabled:opacity-20 transition-colors rounded"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Behaviour ─── */}
      <Section title="Chování při automatickém stahování">
        <div className="flex items-start justify-between gap-4 py-1">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text">Přeskočit externí odkazy</p>
            <p className="text-xs text-muted mt-0.5">
              Přeskočí výsledky, kde odkaz vede na jiný web než je daný zdroj (např. Hiyori → odkaz na Ulož.to).
              Doporučeno zapnout — zabraňuje chybám 400 při hromadném stahování.
            </p>
          </div>
          <Toggle
            value={skipExternal}
            onChange={() => saveSettings({ subtitle_skip_external_links: skipExternal ? "false" : "true" })
              .then(() => qc.invalidateQueries(["app-settings"]))
              .catch(() => toast.error("Nepodařilo se uložit"))
            }
          />
        </div>
      </Section>

      {/* ── Credentials ─── */}
      <EditableConnectionSection
        title="Hiyori.cz"
        service={null}
        initialValues={cfg}
        fields={[
          { key: "hiyori_username", label: "Uživatelské jméno" },
          { key: "hiyori_password", label: "Heslo", secret: true },
        ]}
        onSave={saveSettings}
      />

      <EditableConnectionSection
        title="HnS.sk"
        service={null}
        initialValues={cfg}
        fields={[
          { key: "hns_username", label: "Uživatelské jméno" },
          { key: "hns_password", label: "Heslo", secret: true },
        ]}
        onSave={saveSettings}
      />

      <EditableConnectionSection
        title="Kamui-subs.cz"
        service={null}
        initialValues={cfg}
        fields={[
          { key: "kamui_username",     label: "Uživatelské jméno" },
          { key: "kamui_password",     label: "Heslo", secret: true },
          { key: "kamui_rar_password", label: "Heslo k RAR archivu", secret: true, placeholder: "kamui" },
        ]}
        onSave={saveSettings}
      />

      <div className="bg-surface border border-border rounded-xl p-4 text-sm">
        <p className="font-medium text-text mb-1">GenSubs / TeamNS (teamns.gensubs.cz)</p>
        <p className="text-xs text-muted">Veřejný web bez nutnosti přihlášení. Stahuje kompletní série v RAR — backend automaticky extrahuje správný díl dle čísla epizody.</p>
      </div>

      <div className="bg-surface border border-border rounded-xl p-4 text-xs text-muted flex flex-col gap-1">
        <p className="font-medium text-text">ℹ️ Jak funguje Hiyori</p>
        <p>Hiyori.cz funguje jako rozcestník — přihlásíš se tam a on vyhledá titulky na HnS, Kamui a dalších serverech. Výsledky z Hiyori mohou mít různý zdroj (hns / kamui / direct).</p>
        <p className="mt-1">Pokud je zapnutá volba "Přeskočit externí odkazy", výsledky kde URL vede na cizí web (source="direct") budou přeskočeny a backend zkusí další zdroj.</p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Settings() {
  const [tab, setTab] = useState("app");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-text flex items-center gap-2">
        <SettingsIcon size={18} className="text-muted" />
        Nastavení
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition-colors -mb-px whitespace-nowrap",
              tab === t.id
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-text"
            )}
          >
            <t.Icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "app"         && <AppConfig />}
      {tab === "connections" && <ConnectionsTab />}
      {tab === "providers"   && <ProvidersTab />}
      {tab === "subtitles"   && <SubtitleSettingsTab />}
      {tab === "apikeys"     && <ApiKeysTab />}
      {tab === "users"       && <UsersTab />}
      {tab === "activity"    && <ActivityTab />}
    </div>
  );
}
