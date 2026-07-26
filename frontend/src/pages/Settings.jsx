import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  getUsers, createUser, deleteUser, getApiKeys, createApiKey, deleteApiKey,
  getAppSettings, updateSettings, testConnection, seerrSyncNow,
  getSchedulerJobs, updateSchedulerJob, runSchedulerJobNow,
  analyzeDiagnostics,
} from '../api/client';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, StatusPill, SettingsGroup, SettingsRow, Toggle, TextField, SelectField,
} from '../v1design';
import LibrariesSettings from './LibrariesSettings';
import ServicesTable from '../components/ServicesTable';
import { LANGUAGE_OPTIONS } from '../i18n/translations';
import { useT } from '../i18n/I18nContext';

const T = THEME;

// Settings are grouped in two levels: category (e.g. "Titulky") → subsection
// (e.g. "Poskytovatelé"). Each leaf `id` below is unchanged from the old flat
// list, so the content switch in <Settings/> and every section component
// keeps working without modification — only the navigation is nested now.
const CATEGORIES = [
  {
    id: 'obecne', labelKey: 'set_cat_obecne', icon: '⚙',
    items: [
      { id:'profile', labelKey:'set_item_profile', icon:'👤' },
      { id:'general', labelKey:'set_item_general', icon:'⚙' },
      { id:'about',   labelKey:'set_item_about',   icon:'ⓘ' },
    ],
  },
  {
    id: 'knihovny', labelKey: 'set_cat_knihovny', icon: '⊟',
    items: [
      { id:'libraries_mgmt', labelKey:'set_item_libraries_mgmt', icon:'⊟' },
      { id:'promotion',      labelKey:'set_item_promotion',      icon:'▲' },
      { id:'nfo',            labelKey:'set_item_nfo',            icon:'◫' },
    ],
  },
  {
    id: 'titulky', labelKey: 'set_cat_titulky', icon: '✦',
    items: [
      { id:'subs',     labelKey:'set_item_subs',     icon:'✦' },
      { id:'indexers', labelKey:'set_item_indexers', icon:'⌕' },
      { id:'sync',     labelKey:'set_item_sync',     icon:'↔' },
      { id:'scraping', labelKey:'set_item_scraping', icon:'⌖' },
    ],
  },
  {
    id: 'pripojeni', labelKey: 'set_cat_pripojeni', icon: '⚡',
    items: [
      { id:'connections', labelKey:'set_item_connections', icon:'⚡' },
      { id:'sonarr_adv',  labelKey:'set_item_sonarr_adv',  icon:'▷' },
      { id:'discord',     labelKey:'set_item_discord',     icon:'💬' },
    ],
  },
  {
    id: 'sit', labelKey: 'set_cat_sit', icon: '🌐',
    items: [
      { id:'network_media', labelKey:'set_item_network_media', icon:'🖴' },
      { id:'network_vpn',   labelKey:'set_item_network_vpn',   icon:'🛡' },
      { id:'network_proxy', labelKey:'set_item_network_proxy', icon:'↪' },
    ],
  },
  {
    id: 'automatizace', labelKey: 'set_cat_automatizace', icon: '↻',
    items: [
      { id:'auto_tasks', labelKey:'set_item_auto_tasks', icon:'⚡' },
    ],
  },
  {
    id: 'verejny_web', labelKey: 'set_cat_verejny_web', icon: '🌍',
    items: [
      { id:'newsletter', labelKey:'set_item_newsletter', icon:'✉' },
    ],
  },
  {
    id: 'system', labelKey: 'set_cat_system', icon: '⊕',
    items: [
      { id:'users',       labelKey:'set_item_users',       icon:'⊕' },
      { id:'apikeys',     labelKey:'set_item_apikeys',     icon:'⌧' },
      { id:'backup',      labelKey:'set_item_backup',      icon:'⛁' },
      { id:'logs',        labelKey:'set_item_logs',        icon:'◧' },
      { id:'diagnostika', labelKey:'set_item_diagnostika', icon:'⚕' },
    ],
  },
];


function IndexerBlock({ title, url, usernameKey, passwordKey, extraFields = [], fields, setFields }) {
  const t = useT();
  return (
    <SettingsGroup theme={T} title={title} sub={<span style={{font:'11px JetBrains Mono',color:T.textMute}}>{url}</span>}>
      <SettingsRow theme={T} label={t('set_idx_username_label')}
        control={<TextField theme={T} value={fields[usernameKey] || ''} width={240} mono
          placeholder="username"
          onChange={v => setFields(p => ({...p, [usernameKey]: v}))}/>}/>
      <SettingsRow theme={T} last={extraFields.length === 0} label={t('set_idx_password_label')}
        control={<TextField theme={T} value={fields[passwordKey] || ''} width={240} mono
          type={fields[passwordKey] && !fields[passwordKey].startsWith('••••') ? 'password' : 'text'}
          placeholder="••••••••"
          onChange={v => setFields(p => ({...p, [passwordKey]: v}))}/>}/>
      {extraFields.map(({key, label, placeholder}, i) => (
        <SettingsRow key={key} theme={T} last={i === extraFields.length - 1} label={label}
          control={<TextField theme={T} value={fields[key] || ''} width={240} mono
            placeholder={placeholder || ''}
            onChange={v => setFields(p => ({...p, [key]: v}))}/>}/>
      ))}
    </SettingsGroup>
  );
}

function IndexersSection() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: cfg = {} } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => getAppSettings().then(r => r.data ?? r),
  });

  const [fields, setFields] = useState({});
  const f = { ...cfg, ...fields };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v && !v.startsWith('••••')) payload[k] = v;
        else if (v === '') payload[k] = '';
      }
      return updateSettings(payload);
    },
    onSuccess: () => {
      toast.success(t('set_idx_toast_saved'));
      qc.invalidateQueries(['app-settings']);
      setFields({});
    },
    onError: (e) => toast.error(e?.response?.data?.detail || t('set_idx_toast_save_error')),
  });

  const dirty = Object.keys(fields).length > 0;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <IndexerBlock
        title="Hiyori.cz" url="hiyori.cz"
        usernameKey="hiyori_username" passwordKey="hiyori_password"
        fields={f} setFields={setFields}
      />
      <IndexerBlock
        title="HnS.sk" url="hns.sk"
        usernameKey="hns_username" passwordKey="hns_password"
        fields={f} setFields={setFields}
      />
      <IndexerBlock
        title="Kamui-subs.cz" url="kamui-subs.cz"
        usernameKey="kamui_username" passwordKey="kamui_password"
        extraFields={[{ key:'kamui_rar_password', label:t('set_idx_rar_password_label'), placeholder:'kamui' }]}
        fields={f} setFields={setFields}
      />
      <SettingsGroup theme={T} title="GenSubs" sub={t('set_idx_gensubs_sub')}>
        <SettingsRow theme={T} last label=" "
          control={<StatusPill theme={T} color={T.statusDone} label={t('set_idx_available_no_account')} dot/>}/>
      </SettingsGroup>
      {dirty && (
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={() => setFields({})} style={btnGhost(T)}>{t('common_discard')}</button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={btnPrimary(T)}>
            {saveMutation.isPending ? t('common_saving') : t('common_save')}
          </button>
        </div>
      )}
    </div>
  );
}

const DEFAULT_AI_ORDER = [
  { id: 'deepseek',   enabled: true  },
  { id: 'openrouter', enabled: false },
  { id: 'localai',    enabled: false },
  { id: 'claude',     enabled: false },
  { id: 'ollama',     enabled: false },
];

// sub text keys resolved via t() where the source string contains Czech
// wording; provider domains (api.deepseek.com etc.) are language-neutral.
const AI_PROVIDER_META = {
  deepseek:   { label: 'DeepSeek',           sub: 'api.deepseek.com' },
  openrouter: { label: 'OpenRouter',         subKey: 'set_ai_sub_openrouter' },
  localai:    { label: 'LocalAI',            subKey: 'set_ai_sub_localai' },
  ollama:     { label: 'Ollama',             subKey: 'set_ai_sub_ollama' },
  claude:     { label: 'Claude (Anthropic)', sub: 'api.anthropic.com' },
};

function parseProviderOrder(raw) {
  if (!raw) return DEFAULT_AI_ORDER;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_AI_ORDER;
}

function buildTestBody(provider, f) {
  const unmasked = (v) => (v && !String(v).startsWith('••••') ? v : undefined);
  switch (provider) {
    case 'deepseek':   return { api_key: unmasked(f.deepseek_api_key) };
    case 'openrouter': return { api_key: unmasked(f.openrouter_api_key) };
    case 'localai':    return { url: f.localai_url, api_key: unmasked(f.localai_api_key) };
    case 'ollama':     return { url: f.ollama_host };
    case 'claude':     return { api_key: unmasked(f.anthropic_api_key) };
    default:           return {};
  }
}

function ProviderConfigFields({ id, f, set }) {
  const t = useT();
  if (id === 'deepseek') return <>
    <SettingsRow theme={T} label={t('set_ai_api_key_label')}
      control={<TextField theme={T} value={f.deepseek_api_key || ''} width={320} mono
        placeholder="sk-..." onChange={v => set('deepseek_api_key', v)}/>}/>
    <SettingsRow theme={T} last label={t('set_ai_model_label')}
      control={<TextField theme={T} value={f.deepseek_model || ''} width={200} mono
        placeholder="deepseek-chat" onChange={v => set('deepseek_model', v)}/>}/>
  </>;
  if (id === 'openrouter') return <>
    <SettingsRow theme={T} label={t('set_ai_api_key_label')}
      control={<TextField theme={T} value={f.openrouter_api_key || ''} width={320} mono
        placeholder="sk-or-..." onChange={v => set('openrouter_api_key', v)}/>}/>
    <SettingsRow theme={T} last label={t('set_ai_model_label')}
      control={<TextField theme={T} value={f.openrouter_model || ''} width={260} mono
        placeholder="anthropic/claude-3-haiku" onChange={v => set('openrouter_model', v)}/>}/>
  </>;
  if (id === 'localai') return <>
    <SettingsRow theme={T} label={t('set_ai_base_url_label')}
      control={<TextField theme={T} value={f.localai_url || ''} width={280} mono
        placeholder="http://192.168.1.10:8080" onChange={v => set('localai_url', v)}/>}/>
    <SettingsRow theme={T} label={t('set_ai_model_label')}
      control={<TextField theme={T} value={f.localai_model || ''} width={200} mono
        placeholder="gpt-4" onChange={v => set('localai_model', v)}/>}/>
    <SettingsRow theme={T} last label={t('set_ai_api_key_optional_label')}
      control={<TextField theme={T} value={f.localai_api_key || ''} width={280} mono
        placeholder="—" onChange={v => set('localai_api_key', v)}/>}/>
  </>;
  if (id === 'ollama') return <>
    <SettingsRow theme={T} label={t('set_ai_host_label')}
      control={<TextField theme={T} value={f.ollama_host || ''} width={280} mono
        placeholder="http://192.168.1.10:11434" onChange={v => set('ollama_host', v)}/>}/>
    <SettingsRow theme={T} last label={t('set_ai_model_label')}
      control={<TextField theme={T} value={f.ollama_model || ''} width={200} mono
        placeholder="llama3" onChange={v => set('ollama_model', v)}/>}/>
  </>;
  if (id === 'claude') return <>
    <SettingsRow theme={T} last label={t('set_ai_api_key_label')}
      control={<TextField theme={T} value={f.anthropic_api_key || ''} width={320} mono
        placeholder="sk-ant-..." onChange={v => set('anthropic_api_key', v)}/>}/>
  </>;
  return null;
}

const btnIcon = {
  border: 'none', background: 'none', cursor: 'pointer',
  padding: '1px 4px', lineHeight: 1, fontSize: 11,
};

function SubsAISection() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: cfg = {} } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => getAppSettings().then(r => r.data ?? r),
  });

  const [fields, setFields] = useState({});
  const [order, setOrder] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});

  const f = { ...cfg, ...fields };
  const currentOrder = order ?? parseProviderOrder(cfg.ai_provider_order);

  const set = (key, val) => setFields(p => ({ ...p, [key]: val }));

  const moveUp = (idx) => {
    if (idx === 0) return;
    const next = [...currentOrder];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setOrder(next);
  };

  const moveDown = (idx) => {
    if (idx === currentOrder.length - 1) return;
    const next = [...currentOrder];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setOrder(next);
  };

  const toggleEnabled = (idx) => {
    const next = currentOrder.map((p, i) => i === idx ? { ...p, enabled: !p.enabled } : p);
    setOrder(next);
  };

  const toggleExpanded = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  async function handleTest(id) {
    setTesting(p => ({ ...p, [id]: true }));
    setTestResults(p => ({ ...p, [id]: null }));
    try {
      const r = await testConnection(id, buildTestBody(id, f));
      setTestResults(p => ({ ...p, [id]: r.data ?? r }));
    } catch {
      setTestResults(p => ({ ...p, [id]: { connected: false, reason: t('set_ai_test_request_error') } }));
    } finally {
      setTesting(p => ({ ...p, [id]: false }));
    }
  }

  const dirty = Object.keys(fields).length > 0 || order !== null;

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { ai_provider_order: JSON.stringify(currentOrder) };
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && !String(v).startsWith('••••')) payload[k] = v;
        else if (v === '') payload[k] = '';
      }
      return updateSettings(payload);
    },
    onSuccess: () => {
      toast.success(t('set_ai_toast_saved'));
      qc.invalidateQueries(['app-settings']);
      setFields({});
      setOrder(null);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || t('set_ai_toast_save_error')),
  });

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title={t('set_ai_group_title')}
        sub={t('set_ai_group_sub')}>
        {currentOrder.map((entry, idx) => {
          const { id, enabled } = entry;
          const meta = AI_PROVIDER_META[id] || { label: id, sub: '' };
          const metaSub = meta.subKey ? t(meta.subKey) : (meta.sub || '');
          const isExpanded = !!(expanded[id]);
          const testResult = testResults[id] ?? null;
          const isTesting = !!(testing[id]);
          const isLast = idx === currentOrder.length - 1;

          const testColor = testResult === null ? T.textMute
            : testResult.connected ? T.statusDone : T.statusEnded;
          const testLabel = testResult === null ? ''
            : testResult.connected
              ? `✓ ${testResult.models?.[0] || testResult.model || 'OK'}`
              : `✕ ${testResult.reason || t('set_ai_error_fallback')}`;

          return (
            <div key={id} style={{
              borderBottom: isLast ? 'none' : `1px solid ${T.border}`,
              opacity: enabled ? 1 : 0.45,
              transition: 'opacity 0.15s',
            }}>
              {/* Provider header row */}
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',minHeight:44}}>
                <span style={{font:'11px JetBrains Mono',color:T.textMute,width:20,textAlign:'right',flexShrink:0}}>
                  #{idx + 1}
                </span>

                <div style={{display:'flex',flexDirection:'column',gap:1,flexShrink:0}}>
                  <button onClick={() => moveUp(idx)} disabled={idx === 0}
                    style={{...btnIcon, color: idx === 0 ? T.textMute : T.text, cursor: idx === 0 ? 'default' : 'pointer'}}>▲</button>
                  <button onClick={() => moveDown(idx)} disabled={isLast}
                    style={{...btnIcon, color: isLast ? T.textMute : T.text, cursor: isLast ? 'default' : 'pointer'}}>▼</button>
                </div>

                <Toggle theme={T} on={enabled} onChange={() => toggleEnabled(idx)} />

                <div style={{flex:1,minWidth:0}}>
                  <span style={{font:'600 13px "Space Grotesk"',color:T.text}}>{meta.label}</span>
                  {enabled && <span style={{font:'11px JetBrains Mono',color:T.textMute,marginLeft:8}}>{metaSub}</span>}
                </div>

                {testResult && (
                  <span style={{font:'11px JetBrains Mono',color:testColor,flexShrink:0}}>{testLabel}</span>
                )}

                {enabled && (
                  <button onClick={() => toggleExpanded(id)} style={{
                    border:`1px solid ${T.border}`,borderRadius:4,background:T.panel,
                    cursor:'pointer',color:T.textMute,padding:'2px 8px',fontSize:10,flexShrink:0,
                  }}>
                    {isExpanded ? '▲' : '▼'}
                  </button>
                )}
              </div>

              {/* Expanded config */}
              {enabled && isExpanded && (
                <div style={{borderTop:`1px solid ${T.border}`,paddingBottom:8}}>
                  <ProviderConfigFields id={id} f={f} set={set} />
                  <div style={{padding:'6px 16px 4px',display:'flex',alignItems:'center',gap:12}}>
                    <button onClick={() => handleTest(id)} disabled={isTesting}
                      style={{...btnSub(T),fontSize:11,padding:'5px 12px'}}>
                      {isTesting ? '…' : t('set_ai_test_btn')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </SettingsGroup>

      <SettingsGroup theme={T} title={t('set_ai_diag_group_title')}
        sub={t('set_ai_diag_group_sub')}>
        <SettingsRow theme={T} label={t('set_ai_diag_use_same_label')}
          control={<Toggle theme={T}
            on={f.ai_diagnostics_use_same !== 'false'}
            onChange={v => set('ai_diagnostics_use_same', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} last label={t('set_ai_diag_type_label')}
          sub={f.ai_diagnostics_use_same === 'false' ? t('set_ai_diag_type_sub_active') : t('set_ai_diag_type_sub_inactive')}
          control={<SelectField theme={T}
            value={f.ai_diagnostics_mode || 'web'}
            disabled={f.ai_diagnostics_use_same !== 'false'}
            onChange={v => set('ai_diagnostics_mode', v)}
            options={[
              { value:'web',   label:t('set_ai_diag_opt_web') },
              { value:'local', label:t('set_ai_diag_opt_local') },
            ]}/>}/>
      </SettingsGroup>

      {dirty && (
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={() => { setFields({}); setOrder(null); setTestResults({}); }} style={btnGhost(T)}>
            {t('common_discard')}
          </button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={btnPrimary(T)}>
            {saveMutation.isPending ? t('common_saving') : t('common_save')}
          </button>
        </div>
      )}
    </div>
  );
}

function ProfileSection() {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me').then(r => r.data),
  });

  return (
    <SettingsGroup theme={T} title={t('set_prof_group_title')} sub={t('set_prof_group_sub')}>
      <SettingsRow theme={T} label={t('set_prof_username_label')}
        control={<span style={{font:'600 13px JetBrains Mono',color:T.text}}>{me?.username || '—'}</span>}/>
      <SettingsRow theme={T} label={t('set_prof_role_label')}
        control={<StatusPill theme={T} color={T.accent} label={me?.is_admin ? t('set_prof_role_admin') : t('set_prof_role_user')} size="sm"/>}
        last/>
    </SettingsGroup>
  );
}

function ConnectionsSection() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: cfg = {} } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => getAppSettings().then(r => r.data ?? r),
  });

  const [fields, setFields] = useState({});
  const [testResults, setTestResults] = useState({ sonarr: null, seerr: null, emby: null, qbittorrent: null });
  const [testing, setTesting] = useState({});
  const [syncing, setSyncing] = useState(false);

  const f = { ...cfg, ...fields };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v && !v.startsWith('••••')) payload[k] = v;
        else if (v === '') payload[k] = '';
      }
      return updateSettings(payload);
    },
    onSuccess: () => {
      toast.success(t('set_conn_toast_saved'));
      qc.invalidateQueries(['app-settings']);
      setFields({});
    },
    onError: (e) => toast.error(e?.response?.data?.detail || t('set_conn_toast_save_error')),
  });

  async function handleTest(svc, body) {
    setTesting(p => ({...p, [svc]: true}));
    try {
      const r = await testConnection(svc, body);
      setTestResults(p => ({...p, [svc]: r.data ?? r}));
    } catch {
      setTestResults(p => ({...p, [svc]: { connected: false, reason: t('set_conn_test_request_error') }}));
    } finally {
      setTesting(p => ({...p, [svc]: false}));
    }
  }

  async function handleSeerrSync() {
    setSyncing(true);
    try {
      await seerrSyncNow();
      toast.success(t('set_conn_seerr_sync_success'));
      qc.invalidateQueries(['seerr-requests']);
    } catch {
      toast.error(t('set_conn_seerr_sync_error'));
    } finally {
      setSyncing(false);
    }
  }

  const dirty = Object.keys(fields).length > 0;

  const SYNC_INTERVAL_OPTIONS = [
    { value: '5',  label: `5 ${t('set_conn_minutes_suffix')}` },
    { value: '10', label: `10 ${t('set_conn_minutes_suffix')}` },
    { value: '15', label: `15 ${t('set_conn_minutes_suffix')}` },
    { value: '30', label: `30 ${t('set_conn_minutes_suffix')}` },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      {/* Connection registry — Sonarr / Radarr / Prowlarr / qBittorrent / Emby / Seerr */}
      <ServicesTable/>

      {/* Extra addresses / options that aren't part of a connection's host+key */}
      <SettingsGroup theme={T} title={t('set_conn_public_address_label')} sub=" ">
        <SettingsRow theme={T} label="Seerr"
          sub={t('set_conn_public_address_label')}
          control={<TextField theme={T} value={f.seerr_external_url || ''} width={280} mono
            placeholder="https://zadosti.example.com"
            onChange={v => setFields(p => ({...p, seerr_external_url: v}))}/>}/>
        <SettingsRow theme={T} last label="Emby / Jellyfin"
          sub={t('set_conn_ext_url_label')}
          control={<TextField theme={T} value={f.emby_external_url || ''} width={280} mono
            placeholder="https://emby.example.com"
            onChange={v => setFields(p => ({...p, emby_external_url: v}))}/>}/>
      </SettingsGroup>

      {/* Seerr cache sync controls */}
      <SettingsGroup theme={T} title={t('set_conn_seerr_cache_title')} sub={t('set_conn_seerr_cache_sub')}>
        <SettingsRow theme={T} label={t('set_conn_sync_interval_label')}
          sub={t('set_conn_sync_interval_sub')}
          control={
            <SelectField theme={T}
              value={f.seerr_sync_interval || '10'}
              onChange={v => setFields(p => ({...p, seerr_sync_interval: v}))}
              options={SYNC_INTERVAL_OPTIONS}/>
          }/>
        <SettingsRow theme={T} last label=" "
          control={
            <button onClick={handleSeerrSync} disabled={syncing}
              style={{...btnSub(T), fontSize:11, padding:'5px 12px'}}>
              {syncing ? t('set_conn_syncing_label') : t('set_conn_sync_now_btn')}
            </button>
          }/>
      </SettingsGroup>
      {/* TMDb */}
      <SettingsGroup theme={T} title="TMDb" sub={t('set_conn_tmdb_sub')}>
        <SettingsRow theme={T} last label={t('set_conn_api_key_label')}
          control={<TextField theme={T} value={f.tmdb_api_key || ''} width={280} mono
            placeholder="••••••••"
            onChange={v => setFields(p => ({...p, tmdb_api_key: v}))}/>}/>
      </SettingsGroup>
      {/* TVDB */}
      <SettingsGroup theme={T} title="TVDB" sub={t('set_conn_tvdb_sub')}>
        <SettingsRow theme={T} last={false} label={t('set_conn_api_key_label')}
          sub={t('set_conn_tvdb_api_key_sub')}
          control={<TextField theme={T} value={f.tvdb_api_key || ''} width={280} mono
            placeholder="••••••••"
            onChange={v => setFields(p => ({...p, tvdb_api_key: v}))}/>}/>
        <SettingsRow theme={T} last label={t('set_conn_pin_label')}
          sub={t('set_conn_pin_sub')}
          control={<TextField theme={T} value={f.tvdb_pin || ''} width={180} mono
            placeholder={t('set_conn_empty_placeholder')}
            onChange={v => setFields(p => ({...p, tvdb_pin: v}))}/>}/>
      </SettingsGroup>
      {dirty && (
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={() => setFields({})} style={btnGhost(T)}>{t('common_discard')}</button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={btnPrimary(T)}>
            {saveMutation.isPending ? t('common_saving') : t('common_save')}
          </button>
        </div>
      )}
    </div>
  );
}

function UsersSection() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [newUser, setNewUser] = useState({ username: '', password: '', email: '' });
  const [showForm, setShowForm] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data) => createUser(data),
    onSuccess: () => { qc.invalidateQueries(['users']); setShowForm(false); setNewUser({ username:'', password:'', email:'' }); toast.success(t('set_users_toast_created')); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteUser(id),
    onSuccess: () => qc.invalidateQueries(['users']),
  });

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <SettingsGroup theme={T} title={t('set_users_group_title')} sub={t('set_users_group_sub')}>
        {users.map((u, i) => (
          <SettingsRow key={u.id} theme={T} last={i === users.length-1 && !showForm}
            label={u.username}
            sub={u.email || ''}
            control={
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <StatusPill theme={T} color={u.is_admin ? T.accent : T.textDim}
                  label={u.is_admin ? t('set_prof_role_admin') : t('set_prof_role_user')} size="sm"/>
                <button onClick={() => deleteMutation.mutate(u.id)}
                  style={{...btnGhost(T),padding:'4px 8px',fontSize:11,color:T.statusEnded}}>✕</button>
              </div>
            }/>
        ))}
        {!showForm && (
          <SettingsRow theme={T} last label={t('set_users_add_row_label')}
            control={<button onClick={() => setShowForm(true)} style={btnSub(T)}>{t('set_users_add_btn')}</button>}/>
        )}
      </SettingsGroup>
      {showForm && (
        <SettingsGroup theme={T} title={t('set_users_new_group_title')} sub="">
          <SettingsRow theme={T} label={t('set_users_name_label')}
            control={<TextField theme={T} value={newUser.username} onChange={v => setNewUser(p => ({...p, username:v}))} placeholder={t('set_users_username_placeholder')}/>}/>
          <SettingsRow theme={T} label={t('set_idx_password_label')}
            control={<TextField theme={T} value={newUser.password} onChange={v => setNewUser(p => ({...p, password:v}))} placeholder={t('set_users_password_placeholder')}/>}/>
          <SettingsRow theme={T} label={t('admin_email_label')}
            control={<TextField theme={T} value={newUser.email} onChange={v => setNewUser(p => ({...p, email:v}))} width={240} placeholder={t('set_users_email_placeholder')}/>} last/>
          <div style={{display:'flex',gap:8,padding:'12px 16px'}}>
            <button onClick={() => setShowForm(false)} style={btnGhost(T)}>{t('common_cancel')}</button>
            <button onClick={() => createMutation.mutate(newUser)} style={btnPrimary(T)}>{t('admin_create')}</button>
          </div>
        </SettingsGroup>
      )}
    </div>
  );
}

function ApiKeysSection() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newKey, setNewKey] = useState(null);

  const { data: keys = [] } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => getApiKeys().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (n) => createApiKey(n),
    onSuccess: (r) => { qc.invalidateQueries(['api-keys']); setNewKey(r.data?.key || r.data); setName(''); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteApiKey(id),
    onSuccess: () => qc.invalidateQueries(['api-keys']),
  });

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <SettingsGroup theme={T} title={t('set_api_group_title')} sub={t('set_api_group_sub')}>
        {keys.map((k, i) => (
          <SettingsRow key={k.id} theme={T} last={i === keys.length-1}
            label={k.name || `${t('set_api_key_prefix')}${k.id}`}
            sub={`${t('set_api_created_prefix')}${k.created_at ? new Date(k.created_at).toLocaleDateString('cs') : '—'}`}
            control={
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{font:'500 11px JetBrains Mono',color:T.textMute,
                  background:T.sunken,padding:'3px 7px',borderRadius:5,border:`1px solid ${T.border}`}}>
                  {k.key_prefix || k.key?.slice(0,12) || '••••••••'}…
                </span>
                <button onClick={() => deleteMutation.mutate(k.id)}
                  style={{...btnGhost(T),padding:'4px 8px',fontSize:11,color:T.statusEnded}}>✕</button>
              </div>
            }/>
        ))}
        {keys.length === 0 && (
          <div style={{padding:'14px 16px',font:'500 12px "Space Grotesk"',color:T.textMute}}>
            {t('set_api_empty')}
          </div>
        )}
      </SettingsGroup>
      {newKey && (
        <div style={{background:T.accentSoft,border:`1px solid ${T.accent}44`,borderRadius:10,padding:'12px 16px'}}>
          <div style={{font:'600 12px "Space Grotesk"',color:T.accent,marginBottom:6}}>{t('set_api_new_key_notice')}</div>
          <div style={{font:'600 13px JetBrains Mono',color:T.text,wordBreak:'break-all'}}>{newKey}</div>
          <button onClick={() => setNewKey(null)} style={{...btnGhost(T),marginTop:8,fontSize:11}}>{t('lib_close')}</button>
        </div>
      )}
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t('set_api_name_placeholder')}
          style={{padding:'7px 10px',background:T.panel2,color:T.text,border:`1px solid ${T.border}`,
            borderRadius:7,outline:'none',font:'500 12px "Space Grotesk"',flex:1}}/>
        <button onClick={() => createMutation.mutate(name)} style={btnPrimary(T)} disabled={!name.trim()}>
          {t('set_api_create_btn')}
        </button>
      </div>
    </div>
  );
}

function useSettingsForm() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: cfg = {} } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => getAppSettings().then(r => r.data ?? r),
  });
  const [fields, setFields] = useState({});
  const f = { ...cfg, ...fields };
  const set = (key, val) => setFields(p => ({...p, [key]: val}));
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && !String(v).startsWith('••••')) payload[k] = v;
        else if (v === '') payload[k] = '';
      }
      return updateSettings(payload);
    },
    onSuccess: () => {
      toast.success(t('set_save_toast_saved'));
      qc.invalidateQueries(['app-settings']);
      setFields({});
    },
    onError: (e) => toast.error(e?.response?.data?.detail || t('set_save_toast_save_error')),
  });
  const dirty = Object.keys(fields).length > 0;
  return { f, set, setFields, saveMutation, dirty };
}

function SaveBar({ dirty, onDiscard, onSave, saving }) {
  const t = useT();
  if (!dirty) return null;
  return (
    <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
      <button onClick={onDiscard} style={btnGhost(T)}>{t('common_discard')}</button>
      <button onClick={onSave} disabled={saving} style={btnPrimary(T)}>
        {saving ? t('common_saving') : t('common_save')}
      </button>
    </div>
  );
}

function GeneralSection() {
  const t = useT();
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();

  const TZ_OPTIONS = [
    { value: 'Europe/Prague',    label: 'Europe/Prague (CET/CEST)' },
    { value: 'Europe/Bratislava',label: 'Europe/Bratislava' },
    { value: 'Europe/London',    label: 'Europe/London (GMT/BST)' },
    { value: 'UTC',              label: 'UTC' },
    { value: 'America/New_York', label: 'America/New_York' },
    { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  ];

  const daysAhead = parseInt(f.schedule_days_ahead || '7', 10);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title={t('set_cat_obecne')} sub={t('set_gen_group_sub')}>
        <SettingsRow theme={T} label={t('set_gen_timezone_label')}
          sub={t('set_gen_timezone_sub')}
          control={
            <SelectField theme={T} value={f.app_timezone || 'Europe/Prague'}
              onChange={v => set('app_timezone', v)}
              options={TZ_OPTIONS.map(o => ({value: o.value, label: o.label}))}/>
          }/>
        <SettingsRow theme={T} last label={t('set_gen_days_ahead_label')}
          sub={t('set_gen_days_ahead_sub')}
          control={
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <input
                type="range" min={3} max={30} value={daysAhead}
                onChange={e => set('schedule_days_ahead', e.target.value)}
                style={{width:120,accentColor:T.accent}}/>
              <span style={{font:'600 13px JetBrains Mono',color:T.text,minWidth:24}}>{daysAhead}</span>
            </div>
          }/>
      </SettingsGroup>
      <SettingsGroup theme={T} title={t('set_ui_language_label')}
        sub={t('set_gen_language_group_sub')}>
        <SettingsRow theme={T} last label={t('set_gen_language_label')}
          control={
            <SelectField theme={T} value={f.ui_language || 'cs'}
              onChange={v => set('ui_language', v)}
              options={LANGUAGE_OPTIONS}/>
          }/>
      </SettingsGroup>
      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

function SubtitleDefaultsSection() {
  const t = useT();
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();

  const LANG_OPTIONS = [
    { value: 'cs',       label: t('set_subdef_lang_cs') },
    { value: 'sk',       label: t('set_subdef_lang_sk') },
    { value: 'en',       label: t('set_subdef_lang_en') },
    { value: 'cs,sk',    label: t('set_subdef_lang_cs_sk') },
    { value: 'cs,en',    label: t('set_subdef_lang_cs_en') },
    { value: 'sk,en',    label: t('set_subdef_lang_sk_en') },
    { value: 'cs,sk,en', label: t('set_subdef_lang_cs_sk_en') },
  ];
  const FORMAT_OPTIONS = [
    { value: 'srt', label: 'SRT' },
    { value: 'ass', label: 'ASS / SSA' },
    { value: 'vtt', label: 'VTT' },
  ];
  const ACTION_OPTIONS = [
    { value: 'none',      label: t('set_subdef_action_none') },
    { value: 'auto_sync', label: t('set_subdef_action_autosync') },
    { value: 'rename',    label: t('set_subdef_action_rename') },
  ];
  const PROVIDER_OPTIONS = [
    { value: 'any',     label: t('set_subdef_provider_any') },
    { value: 'hiyori',  label: 'Hiyori.cz' },
    { value: 'hns',     label: 'HnS.sk' },
    { value: 'kamui',   label: 'Kamui-subs.cz' },
    { value: 'gensubs', label: 'GenSubs' },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title={t('set_subdef_group_title')} sub={t('set_subdef_group_sub')}>
        <SettingsRow theme={T} label={t('set_subdef_lang_label')}
          control={
            <SelectField theme={T} value={f.subtitle_preferred_language || 'cs'}
              onChange={v => set('subtitle_preferred_language', v)}
              options={LANG_OPTIONS}/>
          }/>
        <SettingsRow theme={T} label={t('set_subdef_format_label')}
          control={
            <SelectField theme={T} value={f.subtitle_preferred_format || 'srt'}
              onChange={v => set('subtitle_preferred_format', v)}
              options={FORMAT_OPTIONS}/>
          }/>
        <SettingsRow theme={T} label={t('set_subdef_action_label')}
          sub={t('set_subdef_action_sub')}
          control={
            <SelectField theme={T} value={f.subtitle_post_download_action || 'none'}
              onChange={v => set('subtitle_post_download_action', v)}
              options={ACTION_OPTIONS}/>
          }/>
        <SettingsRow theme={T} label={t('set_subdef_autodl_label')}
          sub={t('set_subdef_autodl_sub')}
          control={
            <Toggle theme={T}
              on={f.subtitle_auto_download_on_grab === 'true'}
              onChange={v => set('subtitle_auto_download_on_grab', v ? 'true' : 'false')}/>
          }/>
        <SettingsRow theme={T} last label={t('set_subdef_provider_label')}
          sub={t('set_subdef_provider_sub')}
          control={
            <SelectField theme={T} value={f.subtitle_preferred_provider || 'any'}
              onChange={v => set('subtitle_preferred_provider', v)}
              options={PROVIDER_OPTIONS}/>
          }/>
      </SettingsGroup>
      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

const DEFAULT_PROVIDER_ORDER = ['hiyori', 'hns', 'kamui', 'gensubs'];
const PROVIDER_LABELS = { hiyori: 'Hiyori.cz', hns: 'HnS.sk', kamui: 'Kamui-subs.cz', gensubs: 'GenSubs' };

function ProviderOrderEditor({ value, onChange }) {
  const order = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [...DEFAULT_PROVIDER_ORDER];

  const move = (idx, dir) => {
    const next = [...order];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next.join(','));
  };

  return (
    <div style={{display:'flex',flexDirection:'column',gap:4}}>
      {order.map((p, i) => (
        <div key={p} style={{
          display:'flex',alignItems:'center',gap:6,
          background:T.panel2, border:`1px solid ${T.border}`,
          borderRadius:6, padding:'5px 10px', width:240,
        }}>
          <span style={{font:'500 12px "Space Grotesk"',color:T.text,flex:1}}>
            {i + 1}. {PROVIDER_LABELS[p] || p}
          </span>
          <button onClick={() => move(i, -1)} disabled={i === 0}
            style={{...btnGhost(T),padding:'2px 6px',fontSize:11,opacity:i===0?0.3:1}}>↑</button>
          <button onClick={() => move(i, 1)} disabled={i === order.length - 1}
            style={{...btnGhost(T),padding:'2px 6px',fontSize:11,opacity:i===order.length-1?0.3:1}}>↓</button>
        </div>
      ))}
    </div>
  );
}

function SyncSettingsSection() {
  const t = useT();
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();

  const maxOffset = parseInt(f.alass_max_offset_seconds || '60', 10);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title={t('set_sync_when_title')}
        sub={t('set_sync_when_sub')}>
        <SettingsRow theme={T} last label={t('set_sync_auto_label')}
          sub={t('set_sync_auto_sub')}
          control={
            <Toggle theme={T}
              on={f.auto_alass_on_download === 'true'}
              onChange={v => set('auto_alass_on_download', v ? 'true' : 'false')}/>
          }/>
      </SettingsGroup>

      <SettingsGroup theme={T} title={t('set_sync_params_title')} sub={t('set_sync_params_sub')}>
        <SettingsRow theme={T} label={t('set_sync_audioref_label')}
          sub={t('set_sync_audioref_sub')}
          control={
            <Toggle theme={T}
              on={f.alass_use_audio_reference !== 'false'}
              onChange={v => set('alass_use_audio_reference', v ? 'true' : 'false')}/>
          }/>
        <SettingsRow theme={T} label={t('set_sync_skipfps_label')}
          sub={t('set_sync_skipfps_sub')}
          control={
            <Toggle theme={T}
              on={f.alass_no_fix_framerate === 'true'}
              onChange={v => set('alass_no_fix_framerate', v ? 'true' : 'false')}/>
          }/>
        <SettingsRow theme={T} label="Golden-section search"
          sub={t('set_sync_golden_sub')}
          control={
            <Toggle theme={T}
              on={f.alass_golden_section_search === 'true'}
              onChange={v => set('alass_golden_section_search', v ? 'true' : 'false')}/>
          }/>
        <NumberRow last
          label={t('set_sync_maxoffset_label')}
          sub={t('set_sync_maxoffset_sub')}
          value={maxOffset} min={5} max={600}
          onChange={v => set('alass_max_offset_seconds', String(v))}/>
      </SettingsGroup>

      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

// ── Síť (Network) ───────────────────────────────────────────────────────────
// Groups everything about how *this anisubarr instance* reaches the network —
// as opposed to "Připojení", which is about the external services it talks to
// (Sonarr, Emby, Seerr…). SMB existed as a working backend setting with no UI
// anywhere; VPN/Proxy are placeholders for later, same pattern as "Stahovače".

function ComingSoon({ title, text }) {
  const t = useT();
  return (
    <SettingsGroup theme={T} title={title}>
      <div style={{padding:'14px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,lineHeight:1.6}}>
        {text}{t('set_soon_suffix')}
      </div>
    </SettingsGroup>
  );
}

function NetworkMediaSection() {
  const t = useT();
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();
  const mode = f.media_access_mode || 'local';

  const MEDIA_MODE_OPTIONS = [
    { value: 'local', label: t('set_netmedia_mode_local') },
    { value: 'smb',   label: t('set_netmedia_mode_smb') },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title={t('set_netmedia_access_title')}
        sub={t('set_netmedia_access_sub')}>
        <SettingsRow theme={T} last label={t('set_netmedia_mode_label')}
          control={
            <SelectField theme={T} value={mode}
              onChange={v => set('media_access_mode', v)}
              options={MEDIA_MODE_OPTIONS}/>
          }/>
      </SettingsGroup>

      <SettingsGroup theme={T} title={t('set_netmedia_paths_title')}
        sub={t('set_netmedia_paths_sub')}>
        <SettingsRow theme={T} label={t('set_netmedia_sonarr_prefix_label')}
          sub={t('set_netmedia_sonarr_prefix_sub')}
          control={<TextField theme={T} value={f.path_sonarr_prefix || ''} width={260} mono
            placeholder="/data"
            onChange={v => set('path_sonarr_prefix', v)}/>}/>
        <SettingsRow theme={T} label={mode === 'smb' ? t('set_netmedia_path_local_label_smb') : t('set_netmedia_path_local_label_local')}
          sub={mode === 'smb'
            ? t('set_netmedia_path_local_sub_smb')
            : t('set_netmedia_path_local_sub_local')}
          control={<TextField theme={T} value={f.path_local_prefix || ''} width={260} mono
            placeholder={mode === 'smb' ? '\\\\192.168.1.10\\data' : '/media'}
            onChange={v => set('path_local_prefix', v)}/>}/>
        <SettingsRow theme={T} last label={t('set_netmedia_cache_prefix_label')}
          sub={t('set_netmedia_cache_prefix_sub')}
          control={<TextField theme={T} value={f.path_cache_prefix || ''} width={260} mono
            placeholder="/cache"
            onChange={v => set('path_cache_prefix', v)}/>}/>
      </SettingsGroup>

      {mode === 'smb' && (
        <SettingsGroup theme={T} title={t('set_netmedia_smb_title')}
          sub={t('set_netmedia_smb_sub')}>
          <SettingsRow theme={T} label={t('set_conn_host_label')}
            sub={t('set_netmedia_smb_host_sub')}
            control={<TextField theme={T} value={f.smb_host || ''} width={220} mono
              placeholder="192.168.1.10"
              onChange={v => set('smb_host', v)}/>}/>
          <SettingsRow theme={T} label={t('set_conn_username_label')}
            sub={t('set_netmedia_smb_username_sub')}
            control={<TextField theme={T} value={f.smb_username || ''} width={220} mono
              placeholder={t('set_conn_empty_placeholder')}
              onChange={v => set('smb_username', v)}/>}/>
          <SettingsRow theme={T} last label={t('set_idx_password_label')}
            control={<TextField theme={T} value={f.smb_password || ''} width={220} mono
              type={f.smb_password && !f.smb_password.startsWith('••••') ? 'password' : 'text'}
              placeholder="••••••••"
              onChange={v => set('smb_password', v)}/>}/>
        </SettingsGroup>
      )}

      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

function NetworkVpnSection() {
  const t = useT();
  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <ComingSoon title="VPN"
        text={t('set_netvpn_text')}/>
    </div>
  );
}

function NetworkProxySection() {
  const t = useT();
  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <ComingSoon title="Proxy"
        text={t('set_netproxy_text')}/>
    </div>
  );
}

function ScrapingSection() {
  const t = useT();
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();

  const timeout = parseInt(f.scraper_timeout || '30', 10);
  const maxResults = parseInt(f.scraper_max_results || '0', 10);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title={t('set_scrape_group_title')} sub={t('set_scrape_group_sub')}>
        <SettingsRow theme={T} label={t('set_scrape_timeout_label')}
          sub={t('set_scrape_timeout_sub')}
          control={
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <input
                type="range" min={5} max={120} value={timeout}
                onChange={e => set('scraper_timeout', e.target.value)}
                style={{width:120,accentColor:T.accent}}/>
              <span style={{font:'600 13px JetBrains Mono',color:T.text,minWidth:28}}>{timeout}s</span>
            </div>
          }/>
        <SettingsRow theme={T} label={t('set_scrape_maxresults_label')}
          sub={t('set_scrape_maxresults_sub')}
          control={
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <input
                type="range" min={0} max={20} value={maxResults}
                onChange={e => set('scraper_max_results', e.target.value)}
                style={{width:120,accentColor:T.accent}}/>
              <span style={{font:'600 13px JetBrains Mono',color:T.text,minWidth:28}}>
                {maxResults === 0 ? '∞' : maxResults}
              </span>
            </div>
          }/>
        <SettingsRow theme={T} last label={t('set_scrape_order_label')}
          sub={t('set_scrape_order_sub')}
          control={
            <ProviderOrderEditor
              value={f.scraper_provider_order || ''}
              onChange={v => set('scraper_provider_order', v)}/>
          }/>
      </SettingsGroup>
      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

function NfoSection() {
  const t = useT();
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();
  const toast = useToast();
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshAllResult, setRefreshAllResult] = useState(null);

  async function handleRefreshAll() {
    setRefreshingAll(true);
    setRefreshAllResult(null);
    try {
      const r = await api.post('/api/nfo/refresh-all');
      const data = r.data ?? r;
      setRefreshAllResult(data);
      toast.success(`${t('set_nfo_toast_started_prefix')}${data.series_count}${t('set_nfo_toast_started_suffix')}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('set_nfo_toast_start_error'));
    } finally {
      setRefreshingAll(false);
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title={t('set_item_nfo')} sub={t('set_nfo_group_sub')}>
        <SettingsRow theme={T} label={t('set_nfo_autogen_label')}
          sub={t('set_nfo_autogen_sub')}
          control={
            <Toggle theme={T}
              on={f.nfo_auto_generate_on_add !== 'false'}
              onChange={v => set('nfo_auto_generate_on_add', v ? 'true' : 'false')}/>
          }/>
        <SettingsRow theme={T} label={t('set_nfo_autorefresh_label')}
          sub={t('set_nfo_autorefresh_sub')}
          control={
            <Toggle theme={T}
              on={f.nfo_auto_refresh_after_promo !== 'false'}
              onChange={v => set('nfo_auto_refresh_after_promo', v ? 'true' : 'false')}/>
          }/>
        <SettingsRow theme={T} last label={t('set_nfo_refreshall_label')}
          sub={t('set_nfo_refreshall_sub')}
          control={
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <button
                onClick={handleRefreshAll}
                disabled={refreshingAll}
                style={{...btnSub(T), fontSize:11, padding:'5px 12px'}}
              >
                {refreshingAll ? t('set_nfo_refreshall_running') : t('set_nfo_refreshall_btn')}
              </button>
              {refreshAllResult && (
                <span style={{font:'11px JetBrains Mono', color:T.statusDone}}>
                  ✓ {refreshAllResult.series_count}{t('set_nfo_refreshall_result_suffix')}
                </span>
              )}
            </div>
          }/>
      </SettingsGroup>
      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

function SonarrAdvSection() {
  const t = useT();
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title={t('set_sonarr_group_title')} sub={t('set_sonarr_group_sub')}>
        <SettingsRow theme={T} last label={t('set_sonarr_auto_unmonitor_label')}
          sub={t('set_sonarr_auto_unmonitor_sub')}
          control={
            <Toggle theme={T}
              on={f.sonarr_auto_unmonitor_after_download === 'true'}
              onChange={v => set('sonarr_auto_unmonitor_after_download', v ? 'true' : 'false')}/>
          }/>
      </SettingsGroup>
      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

const PREVIEW_EVENTS = [
  {
    id: 'subtitles',
    labelKey: 'set_discord_preview_label_subtitles',
    icon: '✅',
    color: '#22c55e',
    series: 'Demon Slayer: Kimetsu no Yaiba',
    episodeCode: 'S01E05',
    episodeTitleKey: 'set_discord_preview_ep_subtitles',
    fields: [
      { labelKey: 'set_discord_preview_field_source', value: 'HnS' },
      { labelKey: 'set_discord_preview_field_status', valueKey: 'set_discord_preview_value_done' },
      { labelKey: 'set_discord_preview_field_language', value: 'CS' },
    ],
  },
  {
    id: 'promotion',
    labelKey: 'set_discord_preview_label_promotion',
    icon: '⬆',
    color: '#a78bfa',
    series: 'Attack on Titan: The Final Season',
    episodeCode: 'S04E16',
    episodeTitleKey: 'set_discord_preview_ep_promotion',
    fields: [
      { labelKey: 'set_discord_preview_field_subtitles', value: '93 %' },
      { labelKey: 'set_discord_preview_field_status', valueKey: 'set_discord_preview_value_promoted' },
      { labelKey: 'set_discord_preview_field_folder', value: 'anime_series' },
    ],
  },
  {
    id: 'error',
    labelKey: 'set_discord_preview_label_error',
    icon: '❌',
    color: '#ef4444',
    series: 'One Piece',
    episodeCode: 'S01E1050',
    episodeTitleKey: 'set_discord_preview_ep_error',
    fields: [
      { labelKey: 'set_discord_preview_field_source', value: 'Hiyori' },
      { labelKey: 'set_discord_preview_field_error', value: 'Timeout' },
      { labelKey: 'set_discord_preview_field_language', value: 'CS' },
    ],
  },
  {
    id: 'new_series',
    labelKey: 'set_discord_preview_label_new_series',
    icon: '🆕',
    color: '#3b82f6',
    series: 'Bleach: Thousand-Year Blood War',
    episodeCode: 'S01E01',
    episodeTitle: 'The Blood Warfare',
    fields: [
      { labelKey: 'set_discord_preview_field_episodes', value: '13' },
      { label: 'Status', value: 'Airing' },
      { labelKey: 'set_discord_preview_field_source', value: 'Sonarr' },
    ],
  },
];

function DiscordPreview({ useEmbed, prefix, errorRoleId }) {
  const t = useT();
  const [eventId, setEventId] = useState('subtitles');
  const event = PREVIEW_EVENTS.find(e => e.id === eventId) || PREVIEW_EVENTS[0];
  const displayPrefix = prefix || '[Anisubarr]';
  const eventLabel = t(event.labelKey);
  const episodeTitle = event.episodeTitleKey ? t(event.episodeTitleKey) : event.episodeTitle;

  const DC = {
    bg: '#2b2d31',
    embed: '#1e1f22',
    text: '#dbdee1',
    textMute: '#949ba4',
    fieldLabel: '#b5bac1',
    botTag: '#5865f2',
    username: '#ffffff',
    link: '#00a8fc',
  };

  const isError = event.id === 'error';
  const roleTag = isError && errorRoleId ? `<@&${errorRoleId}>` : null;

  const BotAvatar = () => (
    <div style={{
      width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, #5865f2, #7289da)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 18, userSelect: 'none',
    }}>🤖</div>
  );

  const BotHeader = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <span style={{ font: '600 14px "Space Grotesk"', color: DC.username }}>Anisubarr</span>
      <span style={{
        background: DC.botTag, color: '#fff',
        font: '700 8px "Space Grotesk"', padding: '2px 5px',
        borderRadius: 3, letterSpacing: '.06em',
      }}>APP</span>
      <span style={{ font: '11px "Space Grotesk"', color: DC.textMute }}>{t('set_discord_preview_today_label')}</span>
    </div>
  );

  return (
    <div style={{
      background: DC.bg,
      borderRadius: 10,
      padding: '12px 16px 16px',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ font: '600 10px JetBrains Mono', color: T.textMute, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          {t('set_discord_preview_header')}
        </span>
        <select
          value={eventId}
          onChange={e => setEventId(e.target.value)}
          style={{
            background: T.panel2, color: T.text,
            border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '4px 8px', font: '500 11px "Space Grotesk"',
            cursor: 'pointer', outline: 'none',
          }}
        >
          {PREVIEW_EVENTS.map(ev => (
            <option key={ev.id} value={ev.id}>{t(ev.labelKey)}</option>
          ))}
        </select>
      </div>

      {useEmbed ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <BotAvatar />
          <div style={{ flex: 1, minWidth: 0 }}>
            <BotHeader />
            <div style={{
              background: DC.embed, borderRadius: 4,
              borderLeft: `4px solid ${event.color}`,
              padding: '10px 12px 12px',
              maxWidth: 420, display: 'flex', gap: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: '600 14px "Space Grotesk"', color: DC.text, marginBottom: 4 }}>
                  {event.icon} {eventLabel}
                </div>
                <div style={{ font: '500 13px "Space Grotesk"', color: DC.text, marginBottom: 1 }}>
                  {event.series}
                </div>
                <div style={{ font: '12px "Space Grotesk"', color: DC.fieldLabel, marginBottom: 10 }}>
                  {event.episodeCode} · {episodeTitle}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px 10px', marginBottom: 10 }}>
                  {event.fields.map(fld => (
                    <div key={fld.labelKey || fld.label}>
                      <div style={{ font: '700 9px "Space Grotesk"', color: DC.fieldLabel, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>
                        {fld.labelKey ? t(fld.labelKey) : fld.label}
                      </div>
                      <div style={{ font: '500 13px "Space Grotesk"', color: DC.text }}>
                        {fld.valueKey ? t(fld.valueKey) : fld.value}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ font: '12px "Space Grotesk"', color: DC.link, cursor: 'pointer' }}>
                  {t('set_discord_preview_play_label')}
                </div>
              </div>
              <div style={{
                width: 52, height: 72, borderRadius: 5, flexShrink: 0,
                background: `linear-gradient(160deg, ${event.color}44 0%, ${event.color}11 100%)`,
                border: `1px solid ${event.color}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22,
              }}>🎬</div>
            </div>
            {roleTag && (
              <div style={{
                font: '13px "Space Grotesk"', color: '#c9cdfb',
                background: 'rgba(88,101,242,0.15)',
                display: 'inline-block', padding: '1px 6px',
                borderRadius: 3, marginTop: 4,
              }}>{roleTag}</div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <BotAvatar />
          <div>
            <BotHeader />
            <div style={{ font: '13px "Space Grotesk"', color: DC.text }}>
              {displayPrefix} {event.icon} {eventLabel} — {event.series} {event.episodeCode}
              {roleTag && (
                <span style={{ color: '#c9cdfb', background: 'rgba(88,101,242,0.15)', padding: '1px 5px', borderRadius: 3, marginLeft: 5 }}>
                  {roleTag}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiscordSection() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();

  const { data: cfg = {} } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => getAppSettings().then(r => r.data ?? r),
  });

  const [fields, setFields] = useState({});
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const f = { ...cfg, ...fields };
  const set = (key, val) => { setTestResult(null); setFields(p => ({...p, [key]: val})); };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && !String(v).startsWith('••••')) payload[k] = v;
        else if (v === '') payload[k] = '';
      }
      return updateSettings(payload);
    },
    onSuccess: () => {
      toast.success(t('set_discord_toast_saved'));
      qc.invalidateQueries(['app-settings']);
      setFields({});
    },
    onError: (e) => toast.error(e?.response?.data?.detail || t('set_conn_toast_save_error')),
  });

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const webhookUrl = f.discord_webhook_url;
    const body = webhookUrl && !webhookUrl.startsWith('••••') ? { webhook_url: webhookUrl } : {};
    try {
      const r = await testConnection('discord', body);
      setTestResult(r.data ?? r);
    } catch {
      setTestResult({ connected: false, reason: t('set_conn_test_request_error') });
    } finally {
      setTesting(false);
    }
  }

  const dirty = Object.keys(fields).length > 0;
  const statusColor = testResult === null ? T.textMute : testResult?.connected ? T.statusDone : T.statusEnded;
  const statusLabel = testResult === null ? '—' : testResult?.connected ? t('set_discord_test_sent_label') : `✕ ${testResult?.reason || t('set_conn_error_fallback')}`;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <DiscordPreview
        useEmbed={f.discord_use_embed !== 'false'}
        prefix={f.discord_message_prefix || ''}
        errorRoleId={f.discord_error_role_id || ''}
      />
      <SettingsGroup theme={T} title={t('set_discord_webhook_group_title')} sub={
        <span style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{font:'11px JetBrains Mono',color:T.textMute}}>discord.com/api/webhooks</span>
          <StatusPill theme={T} color={statusColor} label={statusLabel} size="sm"/>
        </span>
      }>
        <SettingsRow theme={T} label={t('set_discord_webhook_url_label')}
          sub={t('set_discord_webhook_url_sub')}
          control={<TextField theme={T} value={f.discord_webhook_url || ''} width={320} mono
            placeholder="https://discord.com/api/webhooks/…"
            onChange={v => set('discord_webhook_url', v)}/>}/>
        <SettingsRow theme={T} last label=" "
          control={
            <button onClick={handleTest} disabled={testing}
              style={{...btnSub(T), fontSize:11, padding:'5px 12px'}}>
              {testing ? '…' : t('set_conn_test_btn')}
            </button>
          }/>
      </SettingsGroup>

      <SettingsGroup theme={T} title={t('set_discord_notif_group_title')} sub={t('set_discord_notif_group_sub')}>
        <SettingsRow theme={T} label={t('set_discord_notify_new_series_label')}
          control={<Toggle theme={T}
            on={f.discord_notify_new_series !== 'false'}
            onChange={v => set('discord_notify_new_series', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label={t('set_discord_preview_label_subtitles')}
          control={<Toggle theme={T}
            on={f.discord_notify_subtitles_downloaded !== 'false'}
            onChange={v => set('discord_notify_subtitles_downloaded', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label={t('set_discord_notify_subtitles_missing_label')}
          control={<Toggle theme={T}
            on={f.discord_notify_subtitles_missing !== 'false'}
            onChange={v => set('discord_notify_subtitles_missing', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label={t('set_discord_notify_promoted_label')}
          control={<Toggle theme={T}
            on={f.discord_notify_promoted !== 'false'}
            onChange={v => set('discord_notify_promoted', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label={t('set_discord_notify_demoted_label')}
          control={<Toggle theme={T}
            on={f.discord_notify_demoted !== 'false'}
            onChange={v => set('discord_notify_demoted', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label={t('set_discord_notify_issue_flagged_label')}
          control={<Toggle theme={T}
            on={f.discord_notify_issue_flagged !== 'false'}
            onChange={v => set('discord_notify_issue_flagged', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label={t('set_discord_notify_nfo_label')}
          control={<Toggle theme={T}
            on={f.discord_notify_nfo !== 'false'}
            onChange={v => set('discord_notify_nfo', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} last label={t('set_discord_preview_label_error')}
          control={<Toggle theme={T}
            on={f.discord_notify_scraper_error !== 'false'}
            onChange={v => set('discord_notify_scraper_error', v ? 'true' : 'false')}/>}/>
      </SettingsGroup>

      <SettingsGroup theme={T} title={t('set_discord_format_group_title')} sub={t('set_discord_format_group_sub')}>
        <SettingsRow theme={T} label={t('set_discord_use_embed_label')}
          sub={t('set_discord_use_embed_sub')}
          control={<Toggle theme={T}
            on={f.discord_use_embed !== 'false'}
            onChange={v => set('discord_use_embed', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label={t('set_discord_prefix_label')}
          sub={t('set_discord_prefix_sub')}
          control={<TextField theme={T} value={f.discord_message_prefix || ''} width={200} mono
            placeholder="[Anisubarr]"
            onChange={v => set('discord_message_prefix', v)}/>}/>
        <SettingsRow theme={T} last label={t('set_discord_role_id_label')}
          sub={t('set_discord_role_id_sub')}
          control={<TextField theme={T} value={f.discord_error_role_id || ''} width={200} mono
            placeholder="123456789012345678"
            onChange={v => set('discord_error_role_id', v)}/>}/>
      </SettingsGroup>

      <SaveBar dirty={dirty} onDiscard={() => { setFields({}); setTestResult(null); }} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

// ── Veřejný web / Newsletter ─────────────────────────────────────────────────

function NewsletterSection() {
  const t = useT();
  const toast = useToast();
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');

  const { data: subs } = useQuery({
    queryKey: ['newsletter-subscribers'],
    queryFn: () => api.get('/newsletter/subscribers').then(r => r.data),
  });

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testConnection('smtp', testTo ? { to: testTo } : {});
      setTestResult(r.data ?? r);
    } catch {
      setTestResult({ connected: false, reason: t('set_conn_test_request_error') });
    } finally {
      setTesting(false);
    }
  }

  const [digestSubject, setDigestSubject] = useState('');
  const [digestBody, setDigestBody] = useState('');
  const digestMutation = useMutation({
    mutationFn: () => api.post('/newsletter/send-digest', { subject: digestSubject, html_body: digestBody }),
    onSuccess: (r) => {
      const d = r.data ?? r;
      toast.success(`${t('set_news_digest_sent_label')} ${d.sent}/${d.total}${d.failed?.length ? `, ${t('set_news_digest_failed_prefix')} ${d.failed.length}` : ''}`);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || t('set_news_digest_send_error')),
  });

  const statusColor = testResult === null ? T.textMute : testResult?.connected ? T.statusDone : T.statusEnded;
  const statusLabel = testResult === null ? '—' : testResult?.connected ? t('set_news_test_sent_label') : `✕ ${testResult?.reason || t('set_conn_error_fallback')}`;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title={t('set_news_subs_group_title')}
        sub={subs ? `${subs.active} ${t('set_news_subs_active_of_label')} ${subs.total} ${t('set_news_subs_total_label')}` : '—'}>
        <SettingsRow theme={T} last label=" " control={<span style={{color:T.textMute,font:'12px "Space Grotesk"'}}>
          {subs && subs.total === 0 ? t('set_news_subs_empty') : ''}
        </span>}/>
      </SettingsGroup>

      <SettingsGroup theme={T} title="SMTP" sub={
        <span style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{font:'11px JetBrains Mono',color:T.textMute}}>{t('set_news_smtp_group_sub')}</span>
          <StatusPill theme={T} color={statusColor} label={statusLabel} size="sm"/>
        </span>
      }>
        <SettingsRow theme={T} label={t('set_conn_host_label')}
          control={<TextField theme={T} value={f.smtp_host || ''} width={240} mono
            placeholder="smtp.gmail.com" onChange={v => set('smtp_host', v)}/>}/>
        <SettingsRow theme={T} label={t('set_news_port_label')}
          control={<TextField theme={T} value={f.smtp_port || '587'} width={100} mono
            placeholder="587" onChange={v => set('smtp_port', v)}/>}/>
        <SettingsRow theme={T} label={t('set_conn_username_label')}
          control={<TextField theme={T} value={f.smtp_username || ''} width={240} mono
            onChange={v => set('smtp_username', v)}/>}/>
        <SettingsRow theme={T} label={t('set_conn_password_label')}
          control={<TextField theme={T} value={f.smtp_password || ''} width={240} mono
            type={f.smtp_password && !f.smtp_password.startsWith('••••') ? 'password' : 'text'}
            placeholder="••••••••" onChange={v => set('smtp_password', v)}/>}/>
        <SettingsRow theme={T} label={t('set_news_from_email_label')}
          control={<TextField theme={T} value={f.smtp_from_email || ''} width={240} mono
            placeholder="anisubarr@example.com" onChange={v => set('smtp_from_email', v)}/>}/>
        <SettingsRow theme={T} label={t('set_news_tls_label')}
          control={<Toggle theme={T} on={f.smtp_use_tls !== 'false'}
            onChange={v => set('smtp_use_tls', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label={t('set_news_public_url_label')}
          sub={t('set_news_public_url_sub')}
          control={<TextField theme={T} value={f.public_site_url || ''} width={280} mono
            placeholder="https://anime.example.com" onChange={v => set('public_site_url', v)}/>}/>
        <SettingsRow theme={T} last label={t('set_news_test_to_label')}
          control={
            <div style={{display:'flex',gap:8}}>
              <TextField theme={T} value={testTo} width={200} mono
                placeholder="ty@example.com" onChange={setTestTo}/>
              <button onClick={handleTest} disabled={testing}
                style={{...btnSub(T), fontSize:11, padding:'5px 12px'}}>
                {testing ? '…' : t('set_conn_test_btn')}
              </button>
            </div>
          }/>
      </SettingsGroup>

      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>

      <SettingsGroup theme={T} title={t('set_news_digest_group_title')}
        sub={t('set_news_digest_group_sub')}>
        <SettingsRow theme={T} label={t('set_news_digest_subject_label')}
          control={<TextField theme={T} value={digestSubject} width={320}
            placeholder={t('set_news_digest_subject_placeholder')} onChange={setDigestSubject}/>}/>
        <SettingsRow theme={T} last label={t('set_news_digest_body_label')}
          control={
            <textarea value={digestBody} onChange={e => setDigestBody(e.target.value)}
              placeholder={t('set_news_digest_body_placeholder')}
              style={{
                width:320, minHeight:100, background:T.panel2, color:T.text,
                border:`1px solid ${T.border}`, borderRadius:8, padding:8,
                font:'12px JetBrains Mono', resize:'vertical',
              }}/>
          }/>
        <div style={{padding:'0 16px 14px', display:'flex', justifyContent:'flex-end'}}>
          <button
            onClick={() => digestMutation.mutate()}
            disabled={digestMutation.isPending || !digestSubject || !digestBody}
            style={{...btnPrimary(T), opacity: (digestMutation.isPending || !digestSubject || !digestBody) ? 0.5 : 1}}>
            {digestMutation.isPending ? t('set_news_digest_sending') : `${t('set_news_digest_send_btn_prefix')} ${subs?.active ?? 0} ${t('set_news_digest_send_btn_suffix')}`}
          </button>
        </div>
      </SettingsGroup>
    </div>
  );
}

const LOG_LEVELS = ['ALL', 'INFO', 'WARNING', 'ERROR', 'DEBUG'];

function colorLine(line) {
  if (/ERROR/.test(line))   return '#f87171';
  if (/WARNING|WARN/.test(line)) return '#fb923c';
  if (/DEBUG/.test(line))   return '#6b7280';
  if (/INFO/.test(line))    return '#94a3b8';
  return T.textDim;
}

// ── Záloha a obnova ───────────────────────────────────────────────────────────

function humanSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
}

async function downloadWithAuth(url, filename) {
  const token = localStorage.getItem('token');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.setAttribute('download', filename);
  a.click();
  URL.revokeObjectURL(a.href);
}

function BackupSection() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef(null);
  const [restoring, setRestoring] = useState(false);
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();

  const { data, isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get('/backup/list').then(r => r.data),
    refetchInterval: 15000,
  });
  const backups = data?.backups || [];

  const createMutation = useMutation({
    mutationFn: () => api.post('/backup/create', {}),
    onSuccess: () => { toast.success(t('set_backup_toast_created')); qc.invalidateQueries(['backups']); },
    onError: (e) => toast.error(e?.response?.data?.detail || t('set_backup_toast_create_error')),
  });

  const deleteMutation = useMutation({
    mutationFn: (filename) => api.delete(`/backup/${filename}`),
    onSuccess: () => { toast.success(t('set_backup_toast_deleted')); qc.invalidateQueries(['backups']); },
    onError: (e) => toast.error(e?.response?.data?.detail || t('set_backup_toast_delete_error')),
  });

  async function handleDownload(filename) {
    try {
      await downloadWithAuth(`/api/backup/download/${filename}`, filename);
    } catch {
      toast.error(t('set_backup_toast_download_error'));
    }
  }

  async function handleDelete(filename) {
    if (!window.confirm(`${t('set_backup_confirm_delete_prefix')}${filename}${t('set_backup_confirm_delete_suffix')}`)) return;
    deleteMutation.mutate(filename);
  }

  async function handleRestoreExisting(filename) {
    if (!window.confirm(
      `${t('set_backup_confirm_restore_existing_prefix')}${filename}${t('set_backup_confirm_restore_existing_suffix')}`
    )) return;
    setRestoring(true);
    try {
      const r = await api.post(`/backup/restore-existing/${filename}`);
      toast.success(r.data?.message || t('set_backup_toast_restore_started'));
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('set_backup_toast_restore_error'));
      setRestoring(false);
    }
  }

  async function handleRestoreUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm(
      `${t('set_backup_confirm_restore_upload_prefix')}${file.name}${t('set_backup_confirm_restore_upload_suffix')}`
    )) return;
    setRestoring(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.post('/backup/restore', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(r.data?.message || t('set_backup_toast_restore_started'));
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('set_backup_toast_restore_upload_error'));
      setRestoring(false);
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      {restoring && (
        <div style={{
          padding:'12px 16px', borderRadius:8, background:'rgba(245,158,11,0.12)',
          border:'1px solid rgba(245,158,11,0.35)', color:T.accent3,
          font:'600 13px "Space Grotesk"',
        }}>
          {t('set_backup_restoring_banner')}
        </div>
      )}

      <SettingsGroup theme={T} title={t('set_backup_create_group_title')}
        sub={t('set_backup_create_group_sub')}>
        <SettingsRow theme={T} last label=" " control={
          <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
            style={{...btnPrimary(T), opacity: createMutation.isPending ? 0.6 : 1}}>
            {createMutation.isPending ? t('set_backup_creating_label') : t('set_backup_create_btn')}
          </button>
        }/>
      </SettingsGroup>

      <SettingsGroup theme={T} title={t('set_backup_list_group_title')} sub={`${backups.length} ${t('set_backup_list_count_suffix')}`}>
        {isLoading ? (
          <div style={{padding:'14px 16px',color:T.textMute,font:'12px "Space Grotesk"'}}>{t('common_loading')}</div>
        ) : backups.length === 0 ? (
          <div style={{padding:'14px 16px',color:T.textMute,font:'12px "Space Grotesk"'}}>{t('set_backup_list_empty')}</div>
        ) : (
          backups.map((b, i) => (
            <SettingsRow key={b.filename} theme={T} last={i === backups.length - 1}
              label={<span style={{font:'12px JetBrains Mono',color:T.text}}>{b.filename}</span>}
              sub={`${humanSize(b.size)} · ${formatDate(b.created_at)}`}
              control={
                <div style={{display:'flex',gap:6}}>
                  <button onClick={() => handleDownload(b.filename)}
                    style={{...btnSub(T), fontSize:11, padding:'5px 10px'}}>{t('set_backup_download_btn')}</button>
                  <button onClick={() => handleRestoreExisting(b.filename)} disabled={restoring}
                    style={{...btnSub(T), fontSize:11, padding:'5px 10px', color:T.accent3}}>{t('set_backup_restore_btn')}</button>
                  <button onClick={() => handleDelete(b.filename)}
                    style={{...btnSub(T), fontSize:11, padding:'5px 10px', color:T.statusEnded}}>✕</button>
                </div>
              }/>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup theme={T} title={t('set_backup_auto_group_title')}
        sub={t('set_backup_auto_group_sub')}>
        <SettingsRow theme={T} last label={t('set_backup_keep_count_label')}
          sub={t('set_backup_keep_count_sub')}
          control={<TextField theme={T} value={f.auto_backup_keep_count || '14'} width={80} mono
            onChange={v => set('auto_backup_keep_count', v)}/>}/>
      </SettingsGroup>
      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>

      <SettingsGroup theme={T} title={t('set_backup_upload_group_title')}
        sub={t('set_backup_upload_group_sub')}>
        <SettingsRow theme={T} last label=" " control={
          <>
            <input ref={fileRef} type="file" accept=".db" className="hidden" style={{display:'none'}}
              onChange={handleRestoreUpload}/>
            <button onClick={() => fileRef.current?.click()} disabled={restoring}
              style={{...btnSub(T), color:T.statusEnded, borderColor:'rgba(239,68,68,0.35)'}}>
              {t('set_backup_upload_btn')}
            </button>
          </>
        }/>
      </SettingsGroup>
    </div>
  );
}

function LogsSection() {
  const t = useT();
  const [level, setLevel] = useState('ALL');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState([]);
  const [exists, setExists] = useState(true);
  const preRef = useRef(null);
  const intervalRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/logs', { params: { lines: 500, level } });
      setLines(res.data.lines || []);
      setExists(res.data.exists !== false);
    } catch {
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [level]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, 5000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, fetchLogs]);

  const filtered = search
    ? lines.filter(l => l.toLowerCase().includes(search.toLowerCase()))
    : lines;

  function handleDownload() {
    const token = localStorage.getItem('token');
    const a = document.createElement('a');
    a.href = '/api/logs/download';
    a.setAttribute('download', 'backend.log');
    // attach auth via fetch + blob since <a> can't set headers
    fetch('/api/logs/download', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        a.href = URL.createObjectURL(blob);
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {/* Toolbar */}
      <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
        <select
          value={level}
          onChange={e => setLevel(e.target.value)}
          style={{
            padding:'6px 10px', background:T.panel2, color:T.text,
            border:`1px solid ${T.border}`, borderRadius:7, outline:'none',
            font:'500 12px "Space Grotesk"', cursor:'pointer',
          }}
        >
          {LOG_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('set_logs_search_placeholder')}
          style={{
            flex:1, minWidth:180, padding:'6px 10px',
            background:T.panel2, color:T.text,
            border:`1px solid ${T.border}`, borderRadius:7, outline:'none',
            font:'500 12px "Space Grotesk"',
          }}
        />

        <button onClick={fetchLogs} disabled={loading} style={{...btnSub(T), fontSize:12, padding:'6px 12px'}}>
          {loading ? '…' : `↺ ${t('set_logs_refresh_btn')}`}
        </button>

        <button
          onClick={() => setAutoRefresh(v => !v)}
          style={{
            ...btnSub(T), fontSize:12, padding:'6px 12px',
            background: autoRefresh ? T.accentSoft : undefined,
            color: autoRefresh ? T.accent : undefined,
            border: autoRefresh ? `1px solid ${T.accent}55` : undefined,
          }}
        >
          {autoRefresh ? `⏸ ${t('set_logs_auto_label')}` : `▷ ${t('set_logs_auto_label')}`}
        </button>

        <button onClick={handleDownload} style={{...btnGhost(T), fontSize:12, padding:'6px 12px'}}>
          ↓ {t('set_logs_download_btn')}
        </button>
      </div>

      {/* Count info */}
      <div style={{font:'11px JetBrains Mono', color:T.textMute}}>
        {!exists
          ? t('set_logs_file_missing')
          : `${filtered.length} ${t('set_logs_lines_suffix')}${search ? ` ${t('set_logs_filtered_suffix')}` : ''}${autoRefresh ? ` ${t('set_logs_autorefresh_suffix')}` : ''}`}
      </div>

      {/* Log output */}
      <pre
        ref={preRef}
        style={{
          margin:0, padding:'12px 14px',
          background:T.sunken, border:`1px solid ${T.border}`, borderRadius:10,
          overflowY:'auto', height:'60vh', maxHeight:600,
          font:'12px/1.5 JetBrains Mono', whiteSpace:'pre-wrap', wordBreak:'break-all',
        }}
      >
        {filtered.length === 0
          ? <span style={{color:T.textMute}}>{loading ? t('common_loading') : t('set_logs_empty')}</span>
          : filtered.map((line, i) => (
            <span key={i} style={{color: colorLine(line), display:'block'}}>{line}</span>
          ))
        }
      </pre>
    </div>
  );
}

function SliderRow({ label, sub, value, min, max, unit = '', onChange }) {
  return (
    <SettingsRow theme={T} label={label} sub={sub}
      control={
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <input
            type="range" min={min} max={max} value={value}
            onChange={e => onChange(Number(e.target.value))}
            style={{width:120,accentColor:T.accent}}/>
          <span style={{font:'600 13px JetBrains Mono',color:T.text,minWidth:36,textAlign:'right'}}>
            {value}{unit}
          </span>
        </div>
      }/>
  );
}

function NumberRow({ label, sub, value, min, max, onChange, last }) {
  return (
    <SettingsRow theme={T} last={last} label={label} sub={sub}
      control={
        <input
          type="number" min={min} max={max} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            width:72, padding:'5px 8px',
            background:T.panel2, color:T.text,
            border:`1px solid ${T.border}`, borderRadius:6,
            font:'600 13px JetBrains Mono', outline:'none', textAlign:'right',
          }}/>
      }/>
  );
}

function PromotionSection() {
  const t = useT();
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();

  const minPct           = parseInt(f.promo_min_subtitle_pct        || '80', 10);
  const minEps           = parseInt(f.promo_min_episodes            || '1',  10);
  const cooldown         = parseInt(f.demote_cooldown_hours         || '24', 10);
  const threshold        = parseInt(f.demote_episode_threshold      || '3',  10);
  const multiThreshold   = parseInt(f.demote_multi_episode_threshold || '2', 10);
  const completedThresh  = parseInt(f.demote_completed_threshold    || '2',  10);
  const pctThreshold     = parseInt(f.demote_pct_threshold          || '10', 10);

  const auditTailHighDays  = parseInt(f.audit_tail_high_tolerance_days   || '7',  10);
  const auditTailLowDays   = parseInt(f.audit_tail_low_tolerance_days    || '30', 10);
  const auditTailLowMaxEps = parseInt(f.audit_tail_low_max_episodes      || '2',  10);
  const auditHiyoriHours   = parseInt(f.audit_hiyori_check_interval_hours || '24', 10);

  const COUNT_FROM_OPTIONS = [
    { value: 'aired', label: t('set_promo_count_from_opt_aired') },
    { value: 'all',   label: t('set_promo_count_from_opt_all') },
  ];
  const EPISODE_ERROR_OPTIONS = [
    { value: 'never',            label: t('set_promo_episode_error_opt_never') },
    { value: 'flag_only',        label: t('set_promo_episode_error_opt_flag_only') },
    { value: 'after_x_episodes', label: t('set_promo_episode_error_opt_after_x') },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>

      {/* ── Podmínky povyšování ── */}
      <SettingsGroup theme={T} title={t('set_promo_promote_group_title')}
        sub={t('set_promo_promote_group_sub')}>

        <SliderRow
          label={t('set_promo_min_pct_label')}
          sub={t('set_promo_min_pct_sub')}
          value={minPct} min={0} max={100} unit="%"
          onChange={v => set('promo_min_subtitle_pct', String(v))}/>

        <SettingsRow theme={T} label={t('set_promo_count_from_label')}
          sub={t('set_promo_count_from_sub')}
          control={
            <SelectField theme={T}
              value={f.promo_count_from || 'aired'}
              onChange={v => set('promo_count_from', v)}
              options={COUNT_FROM_OPTIONS}/>
          }/>

        <NumberRow
          label={t('set_promo_min_eps_label')}
          sub={t('set_promo_min_eps_sub')}
          value={minEps} min={1} max={99}
          onChange={v => set('promo_min_episodes', String(v))}/>

        <SettingsRow theme={T} label={t('set_promo_cs_only_label')}
          sub={t('set_promo_cs_only_sub')}
          control={
            <Toggle theme={T}
              on={f.promo_require_cs_only === 'true'}
              onChange={v => set('promo_require_cs_only', v ? 'true' : 'false')}/>
          }/>

        <SettingsRow theme={T} label={t('set_promo_tolerate_last_ep_label')}
          sub={<>
            {t('set_promo_tolerate_last_ep_sub')}
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              {t('set_promo_tolerate_last_ep_example')}
            </span>
          </>}
          control={
            <Toggle theme={T}
              on={f.promo_allow_last_episode_missing !== 'false'}
              onChange={v => set('promo_allow_last_episode_missing', v ? 'true' : 'false')}/>
          }/>

        <SettingsRow theme={T} last label={t('set_promo_require_alass_label')}
          sub={t('set_promo_require_alass_sub')}
          control={
            <Toggle theme={T}
              on={f.promo_require_alass === 'true'}
              onChange={v => set('promo_require_alass', v ? 'true' : 'false')}/>
          }/>
      </SettingsGroup>

      {/* ── Podmínky degradace ── */}
      <SettingsGroup theme={T} title={t('set_promo_demote_group_title')}
        sub={t('set_promo_demote_group_sub')}>

        <SettingsRow theme={T} label={t('set_promo_demote_seerr_label')}
          sub={t('set_promo_demote_seerr_sub')}
          control={
            <Toggle theme={T}
              on={f.demote_on_seerr_report !== 'false'}
              onChange={v => set('demote_on_seerr_report', v ? 'true' : 'false')}/>
          }/>

        <SettingsRow theme={T} label={t('set_promo_episode_error_label')}
          sub={t('set_promo_episode_error_sub')}
          control={
            <SelectField theme={T}
              value={f.demote_on_episode_error || 'flag_only'}
              onChange={v => set('demote_on_episode_error', v)}
              options={EPISODE_ERROR_OPTIONS}/>
          }/>

        {(f.demote_on_episode_error || 'flag_only') === 'after_x_episodes' && (
          <NumberRow
            label={t('set_promo_episode_threshold_label')}
            sub={t('set_promo_episode_threshold_sub')}
            value={threshold} min={1} max={50}
            onChange={v => set('demote_episode_threshold', String(v))}/>
        )}

        <SettingsRow theme={T} label={t('set_promo_demote_full_missing_label')}
          sub={t('set_promo_demote_full_missing_sub')}
          control={
            <Toggle theme={T}
              on={f.demote_on_full_series_missing !== 'false'}
              onChange={v => set('demote_on_full_series_missing', v ? 'true' : 'false')}/>
          }/>

        <SettingsRow theme={T} label={t('set_promo_protect_completed_label')}
          sub={t('set_promo_protect_completed_sub')}
          control={
            <Toggle theme={T}
              on={f.demote_protect_completed !== 'false'}
              onChange={v => set('demote_protect_completed', v ? 'true' : 'false')}/>
          }/>

        <SettingsRow theme={T} label={t('set_promo_single_ep_label')}
          sub={<>
            {t('set_promo_single_ep_sub')}
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              {t('set_promo_single_ep_example')}
            </span>
          </>}
          control={
            <SelectField theme={T}
              value={f.demote_single_episode_action || 'flag_only'}
              onChange={v => set('demote_single_episode_action', v)}
              options={[
                { value: 'flag_only', label: t('set_promo_single_ep_opt_flag_only') },
                { value: 'demote',    label: t('set_promo_single_ep_opt_demote') },
              ]}/>
          }/>

        <SettingsRow theme={T} label={t('set_promo_demote_tolerate_last_ep_label')}
          sub={<>
            {t('set_promo_demote_tolerate_last_ep_sub')}
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              {t('set_promo_demote_tolerate_last_ep_example')}
            </span>
          </>}
          control={
            <Toggle theme={T}
              on={f.demote_allow_last_episode_missing !== 'false'}
              onChange={v => set('demote_allow_last_episode_missing', v ? 'true' : 'false')}/>
          }/>

        <SliderRow
          label={t('set_promo_pct_threshold_label')}
          sub={<>
            {t('set_promo_pct_threshold_sub')}
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              {t('set_promo_pct_threshold_example')}
            </span>
          </>}
          value={pctThreshold} min={5} max={50} unit="%"
          onChange={v => set('demote_pct_threshold', String(v))}/>

        <NumberRow
          label={t('set_promo_multi_threshold_label')}
          sub={<>
            {t('set_promo_multi_threshold_sub')}
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              {t('set_promo_multi_threshold_example')}
            </span>
          </>}
          value={multiThreshold} min={2} max={10}
          onChange={v => set('demote_multi_episode_threshold', String(v))}/>

        <NumberRow
          label={t('set_promo_completed_threshold_label')}
          sub={<>
            {t('set_promo_completed_threshold_sub')}
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              {t('set_promo_completed_threshold_example')}
            </span>
          </>}
          value={completedThresh} min={1} max={10}
          onChange={v => set('demote_completed_threshold', String(v))}/>

        <SliderRow
          label={t('set_promo_cooldown_label')}
          sub={t('set_promo_cooldown_sub')}
          value={cooldown} min={0} max={168} unit="h"
          onChange={v => set('demote_cooldown_hours', String(v))}/>

        <SettingsRow theme={T} last label=" " control={
          <span style={{font:'11px JetBrains Mono',color:T.textMute}}>
            {cooldown === 0 ? t('set_promo_cooldown_none') : cooldown === 168 ? t('set_promo_cooldown_one_week') : `${cooldown} ${t('set_promo_cooldown_hours_suffix')}`}
          </span>
        }/>
      </SettingsGroup>

      {/* ── Audit titulků / stavový automat ── */}
      <SettingsGroup theme={T} title={t('set_promo_audit_group_title')}
        sub={t('set_promo_audit_group_sub')}>

        <SettingsRow theme={T} label={t('set_promo_audit_enabled_label')}
          sub={t('set_promo_audit_enabled_sub')}
          control={
            <Toggle theme={T}
              on={f.audit_enabled !== 'false'}
              onChange={v => set('audit_enabled', v ? 'true' : 'false')}/>
          }/>

        <NumberRow
          label={t('set_promo_audit_tail_high_label')}
          sub={<>
            {t('set_promo_audit_tail_high_sub')}
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              {t('set_promo_audit_tail_high_example')}
            </span>
          </>}
          value={auditTailHighDays} min={1} max={30}
          onChange={v => set('audit_tail_high_tolerance_days', String(v))}/>

        <NumberRow
          label={t('set_promo_audit_tail_low_label')}
          sub={t('set_promo_audit_tail_low_sub')}
          value={auditTailLowDays} min={auditTailHighDays + 1} max={120}
          onChange={v => set('audit_tail_low_tolerance_days', String(v))}/>

        <NumberRow
          label={t('set_promo_audit_tail_low_max_label')}
          sub={<>
            {t('set_promo_audit_tail_low_max_sub')}
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              {t('set_promo_audit_tail_low_max_example')}
            </span>
          </>}
          value={auditTailLowMaxEps} min={1} max={10}
          onChange={v => set('audit_tail_low_max_episodes', String(v))}/>

        <NumberRow last
          label={t('set_promo_audit_hiyori_label')}
          sub={t('set_promo_audit_hiyori_sub')}
          value={auditHiyoriHours} min={1} max={168}
          onChange={v => set('audit_hiyori_check_interval_hours', String(v))}/>
      </SettingsGroup>

      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

// ── Triggers tab (event-driven toggles) ───────────────────────────────────

const TRIGGER_ROWS = [
  { key: 'auto_emby_scan_on_promote',      labelKey: 'set_jobs_trigger_emby_scan_label',   subKey: 'set_jobs_trigger_emby_scan_sub',   defaultOn: true,  groupKey: 'set_jobs_trigger_group_after_promote' },
  { key: 'auto_nfo_on_promote',            labelKey: 'set_jobs_trigger_nfo_label',         subKey: 'set_jobs_trigger_nfo_sub',         defaultOn: true,  groupKey: 'set_jobs_trigger_group_after_promote' },
  { key: 'auto_discord_on_promote',        labelKey: 'set_jobs_trigger_discord_promote_label', subKey: 'set_jobs_trigger_discord_promote_sub', defaultOn: true,  groupKey: 'set_jobs_trigger_group_after_promote' },
  { key: 'auto_alass_on_download',         labelKey: 'set_jobs_trigger_alass_label',       subKey: 'set_jobs_trigger_alass_sub',       defaultOn: false, groupKey: 'set_jobs_trigger_group_after_download' },
  { key: 'auto_discord_on_subtitles',      labelKey: 'set_jobs_trigger_discord_subs_label', subKey: 'set_jobs_trigger_discord_subs_sub', defaultOn: true,  groupKey: 'set_jobs_trigger_group_after_download' },
  { key: 'auto_subtitle_search_on_grab',   labelKey: 'set_jobs_trigger_search_on_grab_label', subKey: 'set_jobs_trigger_search_on_grab_sub', defaultOn: false, groupKey: 'set_jobs_trigger_group_after_sonarr_sync' },
  { key: 'auto_promote_check_on_sync',     labelKey: 'set_jobs_trigger_promote_check_label', subKey: 'set_jobs_trigger_promote_check_sub', defaultOn: true,  groupKey: 'set_jobs_trigger_group_after_sonarr_sync' },
  { key: 'auto_translate_description',     labelKey: 'set_jobs_trigger_translate_desc_label', subKey: 'set_jobs_trigger_translate_desc_sub', defaultOn: false, groupKey: 'set_jobs_trigger_group_after_sonarr_sync' },
  { key: 'auto_seerr_issue_on_error',      labelKey: 'set_jobs_trigger_seerr_issue_label', subKey: 'set_jobs_trigger_seerr_issue_sub', defaultOn: false, groupKey: 'set_jobs_trigger_group_on_error' },
];

function TriggersTab() {
  const t = useT();
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();
  const groups = [...new Set(TRIGGER_ROWS.map(r => r.groupKey))];
  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      {groups.map(groupKey => {
        const rows = TRIGGER_ROWS.filter(r => r.groupKey === groupKey);
        return (
          <SettingsGroup key={groupKey} theme={T} title={t(groupKey)} sub={t('set_jobs_trigger_group_sub')}>
            {rows.map((row, i) => {
              const val = f[row.key];
              const isOn = val === undefined || val === '' ? row.defaultOn : val !== 'false';
              return (
                <SettingsRow key={row.key} theme={T} last={i === rows.length - 1}
                  label={t(row.labelKey)} sub={t(row.subKey)}
                  control={<Toggle theme={T} on={isOn} onChange={v => set(row.key, v ? 'true' : 'false')}/>}/>
              );
            })}
          </SettingsGroup>
        );
      })}
      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

// ── Scheduled Jobs tab ────────────────────────────────────────────────────

const INTERVAL_OPTIONS = [
  { value: '30s',   labelKey: 'set_jobs_interval_30s' },
  { value: '5min',  labelKey: 'set_jobs_interval_5min' },
  { value: '10min', labelKey: 'set_jobs_interval_10min' },
  { value: '15min', labelKey: 'set_jobs_interval_15min' },
  { value: '30min', labelKey: 'set_jobs_interval_30min' },
  { value: '1h',    labelKey: 'set_jobs_interval_1h' },
  { value: '3h',    labelKey: 'set_jobs_interval_3h' },
  { value: '6h',    labelKey: 'set_jobs_interval_6h' },
  { value: '12h',   labelKey: 'set_jobs_interval_12h' },
  { value: 'daily', labelKey: 'set_jobs_interval_daily' },
  { value: 'weekly',labelKey: 'set_jobs_interval_weekly' },
];

const DOW_OPTIONS = [
  { value: 0, labelKey: 'set_jobs_dow_monday' },
  { value: 1, labelKey: 'set_jobs_dow_tuesday' },
  { value: 2, labelKey: 'set_jobs_dow_wednesday' },
  { value: 3, labelKey: 'set_jobs_dow_thursday' },
  { value: 4, labelKey: 'set_jobs_dow_friday' },
  { value: 5, labelKey: 'set_jobs_dow_saturday' },
  { value: 6, labelKey: 'set_jobs_dow_sunday' },
];

function getJobGroups(t) {
  return [
    { label: t('set_jobs_group_integrace'), ids: ['sonarr_sync', 'seerr_sync', 'anilist_refresh'] },
    { label: t('set_jobs_group_titulky'),   ids: ['download_missing', 'subtitle_langcheck', 'ollama_translate'] },
    { label: t('set_jobs_group_sprava'),    ids: ['nfo_refresh', 'promotion_check'] },
  ];
}

function fmtTime(h, m) {
  if (h == null) return '03:00';
  return `${String(h).padStart(2,'0')}:${String(m ?? 0).padStart(2,'0')}`;
}

function fmtLastRun(lastRunAt, lastStatus) {
  if (!lastRunAt) return null;
  const d = new Date(lastRunAt);
  const label = d.toLocaleString('cs', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  const ok = lastStatus === 'ok';
  return { label, ok, error: !ok && lastStatus ? lastStatus.replace(/^error:\s*/i, '') : null };
}

function needsTime(interval) {
  return interval === 'daily' || interval === 'weekly';
}

function JobCard({ job, onSave, onRunNow, saving, running }) {
  const t = useT();
  const [localInterval, setLocalInterval] = useState(job.interval || 'daily');
  const [localEnabled,  setLocalEnabled]  = useState(job.enabled !== false);
  const [localHour,     setLocalHour]     = useState(job.hour ?? 3);
  const [localMinute,   setLocalMinute]   = useState(job.minute ?? 0);
  const [localDow,      setLocalDow]      = useState(job.day_of_week ?? 0);

  useEffect(() => {
    setLocalInterval(job.interval || 'daily');
    setLocalEnabled(job.enabled !== false);
    setLocalHour(job.hour ?? 3);
    setLocalMinute(job.minute ?? 0);
    setLocalDow(job.day_of_week ?? 0);
  }, [job.interval, job.enabled, job.hour, job.minute, job.day_of_week]);

  const dirty = (
    localInterval !== job.interval ||
    localEnabled  !== (job.enabled !== false) ||
    (needsTime(localInterval) && (localHour !== (job.hour ?? 3) || localMinute !== (job.minute ?? 0))) ||
    (localInterval === 'weekly' && localDow !== (job.day_of_week ?? 0))
  );

  const lastRun = fmtLastRun(job.last_run_at, job.last_status);

  const timeStr = fmtTime(localHour, localMinute);

  function handleTimeChange(v) {
    const [hh, mm] = v.split(':').map(Number);
    setLocalHour(hh || 0);
    setLocalMinute(mm || 0);
  }

  function handleSave() {
    const patch = {
      enabled:  localEnabled,
      interval: localInterval,
    };
    if (needsTime(localInterval)) {
      patch.hour   = localHour;
      patch.minute = localMinute;
    }
    if (localInterval === 'weekly') {
      patch.day_of_week = localDow;
    }
    onSave(patch);
  }

  const statusColor = lastRun === null ? T.textMute
    : lastRun.ok ? T.statusDone : T.statusEnded;

  return (
    <div style={{
      background: T.panel2,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      overflow: 'hidden',
      opacity: localEnabled ? 1 : 0.6,
      transition: 'opacity 0.15s',
    }}>
      {/* Header row */}
      <div style={{display:'flex', alignItems:'flex-start', gap:12, padding:'12px 14px',
        borderBottom: `1px solid ${T.border}`}}>
        <div style={{flex:1, minWidth:0}}>
          <div style={{font:'600 13px "Space Grotesk"', color: T.text}}>{job.name}</div>
          {job.description && (
            <div style={{font:'500 11px "Space Grotesk"', color: T.textDim, marginTop:3, lineHeight:1.4}}>
              {job.description}
            </div>
          )}
        </div>
        <Toggle theme={T} on={localEnabled} onChange={setLocalEnabled}/>
      </div>

      {/* Controls row */}
      <div style={{display:'flex', flexWrap:'wrap', alignItems:'center', gap:8, padding:'10px 14px'}}>

        {/* Interval */}
        <select
          value={localInterval}
          onChange={e => setLocalInterval(e.target.value)}
          style={{
            padding:'5px 8px', background:T.panel, color:T.text,
            border:`1px solid ${T.border}`, borderRadius:6, outline:'none',
            font:'500 12px "Space Grotesk"', cursor:'pointer',
          }}
        >
          {INTERVAL_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
          ))}
        </select>

        {/* Weekly: day of week */}
        {localInterval === 'weekly' && (
          <select
            value={localDow}
            onChange={e => setLocalDow(Number(e.target.value))}
            style={{
              padding:'5px 8px', background:T.panel, color:T.text,
              border:`1px solid ${T.border}`, borderRadius:6, outline:'none',
              font:'500 12px "Space Grotesk"', cursor:'pointer',
            }}
          >
            {DOW_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
            ))}
          </select>
        )}

        {/* Time picker for daily/weekly */}
        {needsTime(localInterval) && (
          <input
            type="time"
            value={timeStr}
            onChange={e => handleTimeChange(e.target.value)}
            style={{
              padding:'5px 8px', background:T.panel, color:T.text,
              border:`1px solid ${T.border}`, borderRadius:6, outline:'none',
              font:'500 12px JetBrains Mono', cursor:'pointer',
            }}
          />
        )}

        {/* Spacer */}
        <div style={{flex:1}}/>

        {/* Last run status */}
        {lastRun && (
          <span style={{font:'11px JetBrains Mono', color: statusColor, flexShrink:0}}>
            {lastRun.ok ? '✓' : '✕'} {lastRun.label}
            {lastRun.error && (
              <span style={{color: T.statusEnded, marginLeft:4}} title={lastRun.error}>
                · {lastRun.error.length > 30 ? lastRun.error.slice(0,30)+'…' : lastRun.error}
              </span>
            )}
          </span>
        )}

        {/* Run now button */}
        <button
          onClick={onRunNow}
          disabled={running}
          title={t('set_jobs_run_now_title')}
          style={{
            ...btnSub(T),
            fontSize: 11,
            padding: '5px 10px',
            color: running ? T.textMute : T.accent2,
            borderColor: running ? T.border : `${T.accent2}44`,
            flexShrink: 0,
          }}
        >
          {running ? '⏳' : '▶'} {t('set_jobs_run_now_btn')}
        </button>

        {/* Save button (only when dirty) */}
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            style={{...btnPrimary(T), fontSize:11, padding:'5px 10px', flexShrink:0}}
          >
            {saving ? '…' : t('common_save')}
          </button>
        )}
      </div>
    </div>
  );
}

function ScheduledJobsTab() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const JOB_GROUPS = getJobGroups(t);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['scheduler-jobs'],
    queryFn: () => getSchedulerJobs().then(r => r.data),
    refetchInterval: 30_000,
  });

  const [saving, setSaving] = useState({});
  const [running, setRunning] = useState({});

  const jobMap = Object.fromEntries(jobs.map(j => [j.job_id, j]));

  async function handleSave(jobId, patch) {
    setSaving(s => ({...s, [jobId]: true}));
    try {
      await updateSchedulerJob(jobId, patch);
      toast.success(`${jobMap[jobId]?.name || jobId} — ${t('set_jobs_toast_saved_suffix')}`);
      qc.invalidateQueries(['scheduler-jobs']);
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('set_jobs_toast_save_error'));
    } finally {
      setSaving(s => ({...s, [jobId]: false}));
    }
  }

  async function handleRunNow(jobId) {
    setRunning(s => ({...s, [jobId]: true}));
    try {
      await runSchedulerJobNow(jobId);
      toast.success(`${jobMap[jobId]?.name || jobId} — ${t('set_jobs_toast_ran_suffix')}`);
      setTimeout(() => {
        qc.invalidateQueries(['scheduler-jobs']);
        setRunning(s => ({...s, [jobId]: false}));
      }, 3000);
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('set_jobs_toast_run_error'));
      setRunning(s => ({...s, [jobId]: false}));
    }
  }

  if (isLoading) {
    return (
      <div style={{padding:'32px 0', textAlign:'center', color:T.textMute, font:'500 13px "Space Grotesk"'}}>
        {t('common_loading')}
      </div>
    );
  }

  return (
    <div style={{display:'flex', flexDirection:'column', gap:24}}>
      {JOB_GROUPS.map(group => {
        const groupJobs = group.ids.map(id => jobMap[id]).filter(Boolean);
        if (!groupJobs.length) return null;
        return (
          <div key={group.label}>
            <div style={{
              font:'600 11px JetBrains Mono', color:T.textMute,
              letterSpacing:'.08em', textTransform:'uppercase',
              marginBottom:10,
            }}>
              {group.label}
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              {groupJobs.map(job => (
                <JobCard
                  key={job.job_id}
                  job={job}
                  saving={!!saving[job.job_id]}
                  running={!!running[job.job_id]}
                  onSave={patch => handleSave(job.job_id, patch)}
                  onRunNow={() => handleRunNow(job.job_id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Jobs not in any group (future-proofing) */}
      {(() => {
        const allGroupedIds = JOB_GROUPS.flatMap(g => g.ids);
        const orphans = jobs.filter(j => !allGroupedIds.includes(j.job_id));
        if (!orphans.length) return null;
        return (
          <div>
            <div style={{font:'600 11px JetBrains Mono', color:T.textMute, letterSpacing:'.08em', textTransform:'uppercase', marginBottom:10}}>
              {t('set_jobs_group_other')}
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              {orphans.map(job => (
                <JobCard key={job.job_id} job={job}
                  saving={!!saving[job.job_id]} running={!!running[job.job_id]}
                  onSave={patch => handleSave(job.job_id, patch)}
                  onRunNow={() => handleRunNow(job.job_id)}/>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── AutoTasksSection — tab wrapper ────────────────────────────────────────

const AUTO_TASKS_TABS = [
  { id: 'jobs',     labelKey: 'set_auto_tab_jobs' },
  { id: 'triggers', labelKey: 'set_auto_tab_triggers' },
];

function AutoTasksSection() {
  const t = useT();
  const [tab, setTab] = useState('jobs');

  return (
    <div style={{display:'flex', flexDirection:'column', gap:18}}>
      {/* Tab switcher */}
      <div style={{display:'flex', gap:4, borderBottom:`1px solid ${T.border}`, paddingBottom:0}}>
        {AUTO_TASKS_TABS.map(opt => (
          <button
            key={opt.id}
            onClick={() => setTab(opt.id)}
            style={{
              background: 'transparent',
              color: tab === opt.id ? T.accent : T.textMute,
              border: 'none',
              borderBottom: tab === opt.id ? `2px solid ${T.accent}` : '2px solid transparent',
              padding: '8px 14px',
              marginBottom: -1,
              font: `${tab === opt.id ? 600 : 500} 13px "Space Grotesk"`,
              cursor: 'pointer',
              transition: 'color 0.15s',
            }}
          >
            {t(opt.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'jobs'     && <ScheduledJobsTab/>}
      {tab === 'triggers' && <TriggersTab/>}
    </div>
  );
}

export default function Settings() {
  const [sec, setSec] = useState('profile');
  const isMobile = useIsMobile();
  const t = useT();

  const content = (
    <>
      {sec === 'profile'        && <ProfileSection/>}
      {sec === 'general'        && <GeneralSection/>}
      {sec === 'libraries_mgmt' && <LibrariesSettings/>}
      {sec === 'connections' && <div style={{display:'flex',flexDirection:'column',gap:28}}><ConnectionsSection/><SubsAISection/></div>}
      {sec === 'discord'     && <DiscordSection/>}
      {sec === 'newsletter'  && <NewsletterSection/>}
      {sec === 'subs'        && <SubtitleDefaultsSection/>}
      {sec === 'sync'        && <SyncSettingsSection/>}
      {sec === 'scraping'    && <ScrapingSection/>}
      {sec === 'nfo'         && <NfoSection/>}
      {sec === 'sonarr_adv'  && <SonarrAdvSection/>}
      {sec === 'promotion'   && <PromotionSection/>}
      {sec === 'auto_tasks'  && <AutoTasksSection/>}
      {sec === 'users'       && <UsersSection/>}
      {sec === 'apikeys'     && <ApiKeysSection/>}
      {sec === 'backup'      && <BackupSection/>}
      {sec === 'indexers'    && <IndexersSection/>}
      {sec === 'logs'        && <LogsSection/>}
      {sec === 'diagnostika' && <DiagnostikaSection onNavigate={setSec}/>}
      {sec === 'about'       && <AboutSection onNavigate={setSec}/>}
      {sec === 'network_media' && <NetworkMediaSection/>}
      {sec === 'network_vpn'   && <NetworkVpnSection/>}
      {sec === 'network_proxy' && <NetworkProxySection/>}
    </>
  );

  const currentCategory = CATEGORIES.find(c => c.items.some(i => i.id === sec));

  if (isMobile) {
    return (
      <div style={{display:'flex',flexDirection:'column',height:'100%',background:T.bg,color:T.text}}>
        <PageHeader theme={T} title={t('nav_settings')} sub={t('set_page_sub')}/>
        <div style={{padding:'10px 14px',borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
          <select
            value={sec}
            onChange={e => setSec(e.target.value)}
            style={{
              width:'100%', padding:'9px 12px',
              background:T.panel2, color:T.text,
              border:`1px solid ${T.border}`, borderRadius:8,
              font:'600 13px "Space Grotesk"', cursor:'pointer', outline:'none',
            }}
          >
            {CATEGORIES.map(cat => (
              <optgroup key={cat.id} label={`${cat.icon}  ${t(cat.labelKey)}`}>
                {cat.items.map(s => (
                  <option key={s.id} value={s.id}>{s.icon} {t(s.labelKey)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'16px 14px'}}>
          {content}
        </div>
      </div>
    );
  }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:T.bg,color:T.text}}>
      <PageHeader theme={T} title={t('nav_settings')} sub={t('set_page_sub')}/>
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        {/* Sidebar — grouped by category, subsections indented underneath */}
        <div style={{width:210,flexShrink:0,borderRight:`1px solid ${T.border}`,padding:'8px 0',overflowY:'auto'}}>
          {CATEGORIES.map(cat => (
            <div key={cat.id} style={{marginBottom:4}}>
              <div style={{
                display:'flex',alignItems:'center',gap:7,
                padding:'8px 16px 4px',
                font:'700 10.5px "Space Grotesk"',letterSpacing:'0.04em',
                textTransform:'uppercase',color:T.textDim,
              }}>
                <span style={{fontSize:12}}>{cat.icon}</span> {t(cat.labelKey)}
              </div>
              {cat.items.map(s => (
                <button key={s.id} onClick={() => setSec(s.id)}
                  style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'7px 16px 7px 30px',
                    background: sec===s.id ? T.accentSoft : 'transparent',
                    color: sec===s.id ? T.accent : T.textMute,
                    border:'none',cursor:'pointer',fontSize:12.5,fontFamily:'"Space Grotesk"',fontWeight:500,
                    borderLeft: sec===s.id ? `3px solid ${T.accent}` : '3px solid transparent',
                    textAlign:'left'}}>
                  {t(s.labelKey)}
                </button>
              ))}
            </div>
          ))}
        </div>
        {/* Content */}
        <div style={{flex:1,overflowY:'auto',padding:'24px 28px'}}>
          {currentCategory && (
            <div style={{font:'600 11px JetBrains Mono',color:T.textMute,marginBottom:14,letterSpacing:'0.02em'}}>
              {t(currentCategory.labelKey)} / {t(currentCategory.items.find(i => i.id === sec)?.labelKey)}
            </div>
          )}
          {content}
        </div>
      </div>
    </div>
  );
}


function DiagnostikaSection({ onNavigate }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState({});
  const toast = useToast();

  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const runAiAnalysis = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const r = await analyzeDiagnostics(150);
      setAiResult(r.data ?? r);
    } catch (e) {
      setAiError(e?.response?.data?.detail || String(e));
    } finally {
      setAiLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/series/orphaned-folders');
      setData(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.response?.data?.error || String(e));
    } finally {
      setLoading(false);
    }
  };

  const addToDb = async (folder) => {
    setAdding(p => ({...p, [folder]: true}));
    try {
      await api.post('/sync/sonarr');
      toast.success(`${t('set_diag_orphans_add_toast_prefix')} ${folder} ${t('set_diag_orphans_add_toast_suffix')}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('set_diag_orphans_add_toast_error'));
    } finally {
      setAdding(p => ({...p, [folder]: false}));
    }
  };

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title={t('set_diag_orphans_group_title')}
        sub={t('set_diag_orphans_group_sub')}>
        <div style={{padding:'12px 16px'}}>
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            <button onClick={load} disabled={loading} style={btnPrimary(T)}>
              {loading ? t('common_loading') : t('set_diag_orphans_check_btn')}
            </button>
          </div>
          {error && (
            <div style={{color:T.statusError,fontSize:13,marginBottom:8,fontFamily:'JetBrains Mono'}}>
              {t('set_diag_error_prefix')} {error}
            </div>
          )}
          {data && (
            <div>
              <div style={{fontSize:12,color:T.textMute,marginBottom:8,fontFamily:'JetBrains Mono'}}>
                {t('set_diag_orphans_root_label')} {data.root_folder} · {t('set_diag_orphans_total_label')} {data.total_folders} · {t('set_diag_orphans_orphaned_label')} {data.orphaned_count}
              </div>
              {data.folders.length === 0 ? (
                <div style={{color:T.statusDone,fontSize:13}}>{t('set_diag_orphans_empty')}</div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {data.folders.map(folder => (
                    <div key={folder} style={{
                      display:'flex',alignItems:'center',justifyContent:'space-between',
                      padding:'8px 12px',background:T.panel2,borderRadius:6,
                      border:`1px solid ${T.border}`,
                    }}>
                      <span style={{fontFamily:'JetBrains Mono',fontSize:13,color:T.text}}>{folder}</span>
                      <button
                        onClick={() => addToDb(folder)}
                        disabled={adding[folder]}
                        style={btnSub(T)}
                        title={t('set_diag_orphans_add_title')}
                      >
                        {adding[folder] ? t('set_diag_orphans_adding') : t('set_diag_orphans_add_btn')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup theme={T} title={t('set_diag_ai_group_title')}
        sub={t('set_diag_ai_group_sub')}>
        <div style={{padding:'12px 16px',display:'flex',flexDirection:'column',gap:12}}>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button onClick={runAiAnalysis} disabled={aiLoading} style={btnPrimary(T)}>
              {aiLoading ? t('set_diag_ai_analyzing') : t('set_diag_ai_run_btn')}
            </button>
            <button onClick={() => onNavigate?.('connections')} style={btnSub(T)}>
              {t('set_diag_ai_configure_btn')}
            </button>
          </div>

          {aiError && (
            <div style={{color:T.statusError,fontSize:13,fontFamily:'JetBrains Mono'}}>
              {t('set_diag_error_prefix')} {aiError}
            </div>
          )}

          {aiResult && (
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <div style={{fontSize:11,color:T.textMute,fontFamily:'JetBrains Mono'}}>
                {aiResult.model ? `${t('set_diag_ai_model_label')} ${aiResult.model} · ` : ''}
                {aiResult.provider_kind && aiResult.provider_kind !== 'same' ? `(${aiResult.provider_kind}) · ` : ''}
                {t('set_diag_ai_log_errors_label')} {aiResult.context_counts?.log_errors ?? 0} ·
                {' '}{t('set_diag_ai_failed_jobs_label')} {aiResult.context_counts?.failed_jobs ?? 0} ·
                {' '}{t('set_diag_ai_issues_series_label')} {aiResult.context_counts?.series_with_issues ?? 0} ·
                {' '}{t('set_diag_ai_seerr_issues_label')} {aiResult.context_counts?.seerr_issues ?? 0}
              </div>
              <div style={{
                padding:'12px 14px', background:T.panel2, border:`1px solid ${T.border}`,
                borderRadius:8, whiteSpace:'pre-wrap', font:'500 13px/1.6 "Space Grotesk"',
                color:T.text,
              }}>
                {aiResult.summary}
              </div>
            </div>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}

function AboutSection({ onNavigate }) {
  const t = useT();
  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <div style={{display:'flex',alignItems:'center',gap:14}}>
        <div style={{width:56,height:56,borderRadius:14,
          background:`linear-gradient(135deg,${T.accent},${T.accent2})`,
          display:'grid',placeItems:'center'}}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="18" x2="12" y2="21"/>
          </svg>
        </div>
        <div>
          <div style={{font:'700 22px "Space Grotesk"',color:T.text}}>Anisubarr</div>
          <div style={{font:'500 12px JetBrains Mono',color:T.textDim,marginTop:4}}>
            {t('set_about_version_prefix')} 0.1.0 · build 2026
          </div>
        </div>
      </div>
      <div style={{font:'500 13px/1.6 "Space Grotesk"',color:T.textDim,maxWidth:540}}>
        {t('set_about_description')}
      </div>
      <div style={{display:'flex',gap:8}}>
        <a href="https://github.com/WiniXCZ/anisubarr#readme" target="_blank" rel="noopener noreferrer"
          style={{...btnSub(T), textDecoration:'none', display:'inline-flex', alignItems:'center'}}>
          {t('set_about_docs_btn')}
        </a>
        <a href="https://github.com/WiniXCZ/anisubarr" target="_blank" rel="noopener noreferrer"
          style={{...btnSub(T), textDecoration:'none', display:'inline-flex', alignItems:'center'}}>
          GitHub
        </a>
        <button style={btnSub(T)} onClick={() => onNavigate?.('diagnostika')}>{t('set_item_diagnostika')}</button>
      </div>
    </div>
  );
}
