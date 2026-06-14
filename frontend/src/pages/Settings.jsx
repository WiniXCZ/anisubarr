import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  getUsers, createUser, deleteUser, getApiKeys, createApiKey, deleteApiKey,
  getAppSettings, updateSettings, testConnection, seerrSyncNow,
  getSchedulerJobs, updateSchedulerJob, runSchedulerJobNow,
} from '../api/client';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, StatusPill, SettingsGroup, SettingsRow, Toggle, TextField, SelectField,
} from '../v1design';

const T = THEME;

const SECTIONS = [
  { id:'profile',     label:'Profil',            icon:'👤' },
  { id:'general',     label:'Obecné',            icon:'⚙' },
  { id:'library',     label:'Knihovna',          icon:'⊞' },
  { id:'connections', label:'Připojení',         icon:'⚡' },
  { id:'discord',     label:'Discord',           icon:'💬' },
  { id:'downloads',   label:'Stahovače',         icon:'↓' },
  { id:'indexers',    label:'Indexery',          icon:'⌕' },
  { id:'subs',        label:'Titulky & AI',      icon:'✦' },
  { id:'scraping',    label:'Scrapování',        icon:'⌖' },
  { id:'nfo',         label:'NFO & Emby',        icon:'◫' },
  { id:'sonarr_adv',  label:'Sonarr',            icon:'▷' },
  { id:'promotion',   label:'Povýšení',          icon:'▲' },
  { id:'auto_tasks',  label:'Automatické úlohy', icon:'⚡' },
  { id:'users',       label:'Uživatelé',         icon:'⊕' },
  { id:'apikeys',     label:'API klíče',         icon:'⌧' },
  { id:'logs',        label:'Logy',              icon:'◧' },
  { id:'diagnostika', label:'Diagnostika',        icon:'⚕' },
  { id:'about',       label:'O aplikaci',        icon:'ⓘ' },
];

function IndexerBlock({ title, url, usernameKey, passwordKey, extraFields = [], fields, setFields }) {
  return (
    <SettingsGroup theme={T} title={title} sub={<span style={{font:'11px JetBrains Mono',color:T.textMute}}>{url}</span>}>
      <SettingsRow theme={T} label="Uživatelské jméno"
        control={<TextField theme={T} value={fields[usernameKey] || ''} width={240} mono
          placeholder="username"
          onChange={v => setFields(p => ({...p, [usernameKey]: v}))}/>}/>
      <SettingsRow theme={T} last={extraFields.length === 0} label="Heslo"
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
      toast.success('Přihlašovací údaje uloženy');
      qc.invalidateQueries(['app-settings']);
      setFields({});
    },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Chyba při ukládání'),
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
        extraFields={[{ key:'kamui_rar_password', label:'RAR heslo', placeholder:'kamui' }]}
        fields={f} setFields={setFields}
      />
      <SettingsGroup theme={T} title="GenSubs" sub="teamns.gensubs.cz — veřejný web, přihlášení není potřeba">
        <SettingsRow theme={T} last label=" "
          control={<StatusPill theme={T} color={T.statusDone} label="Dostupný bez účtu" dot/>}/>
      </SettingsGroup>
      {dirty && (
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={() => setFields({})} style={btnGhost(T)}>Zahodit změny</button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={btnPrimary(T)}>
            {saveMutation.isPending ? 'Ukládám…' : '✓ Uložit'}
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

const AI_PROVIDER_META = {
  deepseek:   { label: 'DeepSeek',           sub: 'api.deepseek.com' },
  openrouter: { label: 'OpenRouter',         sub: 'openrouter.ai — stovky modelů' },
  localai:    { label: 'LocalAI',            sub: 'vlastní OpenAI-compat server' },
  ollama:     { label: 'Ollama',             sub: 'lokální inference' },
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
  if (id === 'deepseek') return <>
    <SettingsRow theme={T} label="API klíč"
      control={<TextField theme={T} value={f.deepseek_api_key || ''} width={320} mono
        placeholder="sk-..." onChange={v => set('deepseek_api_key', v)}/>}/>
    <SettingsRow theme={T} last label="Model"
      control={<TextField theme={T} value={f.deepseek_model || ''} width={200} mono
        placeholder="deepseek-chat" onChange={v => set('deepseek_model', v)}/>}/>
  </>;
  if (id === 'openrouter') return <>
    <SettingsRow theme={T} label="API klíč"
      control={<TextField theme={T} value={f.openrouter_api_key || ''} width={320} mono
        placeholder="sk-or-..." onChange={v => set('openrouter_api_key', v)}/>}/>
    <SettingsRow theme={T} last label="Model"
      control={<TextField theme={T} value={f.openrouter_model || ''} width={260} mono
        placeholder="anthropic/claude-3-haiku" onChange={v => set('openrouter_model', v)}/>}/>
  </>;
  if (id === 'localai') return <>
    <SettingsRow theme={T} label="Base URL"
      control={<TextField theme={T} value={f.localai_url || ''} width={280} mono
        placeholder="http://192.168.1.10:8080" onChange={v => set('localai_url', v)}/>}/>
    <SettingsRow theme={T} label="Model"
      control={<TextField theme={T} value={f.localai_model || ''} width={200} mono
        placeholder="gpt-4" onChange={v => set('localai_model', v)}/>}/>
    <SettingsRow theme={T} last label="API klíč (volitelný)"
      control={<TextField theme={T} value={f.localai_api_key || ''} width={280} mono
        placeholder="—" onChange={v => set('localai_api_key', v)}/>}/>
  </>;
  if (id === 'ollama') return <>
    <SettingsRow theme={T} label="Host"
      control={<TextField theme={T} value={f.ollama_host || ''} width={280} mono
        placeholder="http://192.168.1.10:11434" onChange={v => set('ollama_host', v)}/>}/>
    <SettingsRow theme={T} last label="Model"
      control={<TextField theme={T} value={f.ollama_model || ''} width={200} mono
        placeholder="llama3" onChange={v => set('ollama_model', v)}/>}/>
  </>;
  if (id === 'claude') return <>
    <SettingsRow theme={T} last label="API klíč"
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
      setTestResults(p => ({ ...p, [id]: { connected: false, reason: 'Chyba požadavku' } }));
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
      toast.success('Nastavení AI uloženo');
      qc.invalidateQueries(['app-settings']);
      setFields({});
      setOrder(null);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Chyba při ukládání'),
  });

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title="AI překlad"
        sub="Pořadí providerů — první povolený a nakonfigurovaný bude použit">
        {currentOrder.map((entry, idx) => {
          const { id, enabled } = entry;
          const meta = AI_PROVIDER_META[id] || { label: id, sub: '' };
          const isExpanded = !!(expanded[id]);
          const testResult = testResults[id] ?? null;
          const isTesting = !!(testing[id]);
          const isLast = idx === currentOrder.length - 1;

          const testColor = testResult === null ? T.textMute
            : testResult.connected ? T.statusDone : T.statusEnded;
          const testLabel = testResult === null ? ''
            : testResult.connected
              ? `✓ ${testResult.models?.[0] || testResult.model || 'OK'}`
              : `✕ ${testResult.reason || 'Chyba'}`;

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
                  {enabled && <span style={{font:'11px JetBrains Mono',color:T.textMute,marginLeft:8}}>{meta.sub}</span>}
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
                      {isTesting ? '…' : '⚡ Otestovat'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </SettingsGroup>

      {dirty && (
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={() => { setFields({}); setOrder(null); setTestResults({}); }} style={btnGhost(T)}>
            Zahodit změny
          </button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={btnPrimary(T)}>
            {saveMutation.isPending ? 'Ukládám…' : '✓ Uložit'}
          </button>
        </div>
      )}
    </div>
  );
}

function ProfileSection() {
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me').then(r => r.data),
  });

  return (
    <SettingsGroup theme={T} title="Profil" sub="Tvůj účet a předvolby">
      <SettingsRow theme={T} label="Uživatelské jméno"
        control={<span style={{font:'600 13px JetBrains Mono',color:T.text}}>{me?.username || '—'}</span>}/>
      <SettingsRow theme={T} label="Role"
        control={<StatusPill theme={T} color={T.accent} label={me?.is_admin ? 'Admin' : 'Uživatel'} size="sm"/>}
        last/>
    </SettingsGroup>
  );
}

function LibrarySection() {
  const { data: cfg = {} } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  });
  const [rootFolder, setRootFolder] = useState('');

  return (
    <SettingsGroup theme={T} title="Knihovna" sub="Kořenové složky a pravidla pojmenování">
      <SettingsRow theme={T} label="Kořenová složka"
        control={<TextField theme={T} value={cfg.library_path || rootFolder} onChange={setRootFolder} width={300} mono placeholder="/srv/media/anime"/>}/>
      <SettingsRow theme={T} label="Preferovaná kvalita"
        control={<SelectField theme={T} value={cfg.preferred_quality || '1080p'}
          options={['480p','720p','1080p','2160p (4K)']}/>} last/>
    </SettingsGroup>
  );
}

function ServiceBlock({ title, hostKey, keyKey, extraFields, fields, setFields, onTest, testResult, saving }) {
  const statusColor = testResult === null ? T.textMute
    : testResult?.connected ? T.statusDone : T.statusEnded;
  const statusLabel = testResult === null ? '—'
    : testResult?.connected
      ? `✓ OK${testResult.version ? ' · v' + testResult.version : ''}`
      : `✕ ${testResult?.reason || 'Chyba'}`;

  return (
    <SettingsGroup theme={T} title={title} sub={
      <span style={{display:'flex',alignItems:'center',gap:8}}>
        <StatusPill theme={T} color={statusColor} label={statusLabel} size="sm"/>
      </span>
    }>
      <SettingsRow theme={T} label="Host"
        control={<TextField theme={T} value={fields[hostKey] || ''} width={280} mono
          placeholder="http://192.168.1.x:port"
          onChange={v => setFields(p => ({...p, [hostKey]: v}))}/>}/>
      <SettingsRow theme={T} label="API klíč"
        control={<TextField theme={T} value={fields[keyKey] || ''} width={280} mono
          placeholder="••••••••"
          onChange={v => setFields(p => ({...p, [keyKey]: v}))}/>}/>
      {(extraFields || []).map(({key, label, placeholder}) => (
        <SettingsRow key={key} theme={T} label={label}
          control={<TextField theme={T} value={fields[key] || ''} width={280} mono
            placeholder={placeholder || ''}
            onChange={v => setFields(p => ({...p, [key]: v}))}/>}/>
      ))}
      <SettingsRow theme={T} last label=" "
        control={
          <button onClick={onTest} disabled={saving}
            style={{...btnSub(T), fontSize:11, padding:'5px 12px'}}>
            ⚡ Otestovat
          </button>
        }/>
    </SettingsGroup>
  );
}

function QBittorrentBlock({ fields, setFields, onTest, testResult, saving }) {
  const statusColor = testResult === null ? T.textMute
    : testResult?.connected ? T.statusDone : T.statusEnded;
  const statusLabel = testResult === null ? '—'
    : testResult?.connected
      ? `✓ OK${testResult.version ? ' · v' + testResult.version : ''}`
      : `✕ ${testResult?.reason || 'Chyba'}`;

  return (
    <SettingsGroup theme={T} title="qBittorrent" sub={
      <span style={{display:'flex',alignItems:'center',gap:8}}>
        <StatusPill theme={T} color={statusColor} label={statusLabel} size="sm"/>
      </span>
    }>
      <SettingsRow theme={T} label="URL"
        control={<TextField theme={T} value={fields.qbittorrent_url || ''} width={280} mono
          placeholder="http://localhost:8080"
          onChange={v => setFields(p => ({...p, qbittorrent_url: v}))}/>}/>
      <SettingsRow theme={T} label="Uživatelské jméno"
        control={<TextField theme={T} value={fields.qbittorrent_username || ''} width={200} mono
          placeholder="admin"
          onChange={v => setFields(p => ({...p, qbittorrent_username: v}))}/>}/>
      <SettingsRow theme={T} label="Heslo"
        control={<TextField theme={T} value={fields.qbittorrent_password || ''} width={200} mono
          type="password"
          placeholder="••••••••"
          onChange={v => setFields(p => ({...p, qbittorrent_password: v}))}/>}/>
      <SettingsRow theme={T} last label=" "
        control={
          <button onClick={onTest} disabled={saving}
            style={{...btnSub(T), fontSize:11, padding:'5px 12px'}}>
            ⚡ Test připojení
          </button>
        }/>
    </SettingsGroup>
  );
}

function ConnectionsSection() {
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
      toast.success('Nastavení uloženo — restart backendu pro hostové změny');
      qc.invalidateQueries(['app-settings']);
      setFields({});
    },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Chyba při ukládání'),
  });

  async function handleTest(svc, body) {
    setTesting(p => ({...p, [svc]: true}));
    try {
      const r = await testConnection(svc, body);
      setTestResults(p => ({...p, [svc]: r.data ?? r}));
    } catch {
      setTestResults(p => ({...p, [svc]: { connected: false, reason: 'Chyba požadavku' }}));
    } finally {
      setTesting(p => ({...p, [svc]: false}));
    }
  }

  async function handleSeerrSync() {
    setSyncing(true);
    try {
      await seerrSyncNow();
      toast.success('Seerr cache synchronizována');
      qc.invalidateQueries(['seerr-requests']);
    } catch {
      toast.error('Synchronizace selhala');
    } finally {
      setSyncing(false);
    }
  }

  const dirty = Object.keys(fields).length > 0;

  const SYNC_INTERVAL_OPTIONS = [
    { value: '5',  label: '5 minut' },
    { value: '10', label: '10 minut' },
    { value: '15', label: '15 minut' },
    { value: '30', label: '30 minut' },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <ServiceBlock
        title="Sonarr" hostKey="sonarr_host" keyKey="sonarr_api_key"
        fields={f} setFields={setFields}
        testResult={testResults.sonarr} saving={testing.sonarr}
        onTest={() => handleTest('sonarr', { host: f.sonarr_host, api_key: f.sonarr_api_key?.startsWith('••••') ? undefined : f.sonarr_api_key })}
      />
      <ServiceBlock
        title="Seerr" hostKey="seerr_host" keyKey="seerr_api_key"
        extraFields={[{ key:'seerr_external_url', label:'Veřejná adresa', placeholder:'https://zadosti.luni.ml' }]}
        fields={f} setFields={setFields}
        testResult={testResults.seerr} saving={testing.seerr}
        onTest={() => handleTest('seerr', { host: f.seerr_host, api_key: f.seerr_api_key?.startsWith('••••') ? undefined : f.seerr_api_key })}
      />
      {/* Seerr cache sync controls */}
      <SettingsGroup theme={T} title="Seerr cache" sub="Lokální cache požadavků ze Seerr pro rychlejší načítání">
        <SettingsRow theme={T} label="Interval synchronizace"
          sub="Jak často se cache automaticky obnovuje ze Seerr API"
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
              {syncing ? '⏳ Synchronizuji…' : '↻ Synchronizovat teď'}
            </button>
          }/>
      </SettingsGroup>
      <ServiceBlock
        title="Emby / Jellyfin" hostKey="emby_host" keyKey="emby_api_key"
        extraFields={[{ key:'emby_external_url', label:'Ext. URL', placeholder:'https://emby.example.com' }]}
        fields={f} setFields={setFields}
        testResult={testResults.emby} saving={testing.emby}
        onTest={() => handleTest('emby', { host: f.emby_host, api_key: f.emby_api_key?.startsWith('••••') ? undefined : f.emby_api_key })}
      />
      {/* qBittorrent */}
      <QBittorrentBlock
        fields={f} setFields={setFields}
        testResult={testResults.qbittorrent} saving={!!testing.qbittorrent}
        onTest={() => handleTest('qbittorrent', {
          url: f.qbittorrent_url,
          username: f.qbittorrent_username,
          password: f.qbittorrent_password?.startsWith('••••') ? undefined : f.qbittorrent_password,
        })}
      />
      {/* TMDb */}
      <SettingsGroup theme={T} title="TMDb" sub="themoviedb.org — postery a metadata">
        <SettingsRow theme={T} last label="API klíč"
          control={<TextField theme={T} value={f.tmdb_api_key || ''} width={280} mono
            placeholder="••••••••"
            onChange={v => setFields(p => ({...p, tmdb_api_key: v}))}/>}/>
      </SettingsGroup>
      {/* TVDB */}
      <SettingsGroup theme={T} title="TVDB" sub="thetvdb.com — mapování AniList → TVDB ID pro přidávání do Sonarru">
        <SettingsRow theme={T} last={false} label="API klíč"
          sub="Najdeš na thetvdb.com → Dashboard → API Keys"
          control={<TextField theme={T} value={f.tvdb_api_key || ''} width={280} mono
            placeholder="••••••••"
            onChange={v => setFields(p => ({...p, tvdb_api_key: v}))}/>}/>
        <SettingsRow theme={T} last label="PIN (volitelné)"
          sub="Potřeba jen pro předplatitelský účet"
          control={<TextField theme={T} value={f.tvdb_pin || ''} width={180} mono
            placeholder="(prázdné)"
            onChange={v => setFields(p => ({...p, tvdb_pin: v}))}/>}/>
      </SettingsGroup>
      {dirty && (
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={() => setFields({})} style={btnGhost(T)}>Zahodit změny</button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={btnPrimary(T)}>
            {saveMutation.isPending ? 'Ukládám…' : '✓ Uložit'}
          </button>
        </div>
      )}
    </div>
  );
}

function UsersSection() {
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
    onSuccess: () => { qc.invalidateQueries(['users']); setShowForm(false); setNewUser({ username:'', password:'', email:'' }); toast.success('Uživatel vytvořen'); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteUser(id),
    onSuccess: () => qc.invalidateQueries(['users']),
  });

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <SettingsGroup theme={T} title="Uživatelé" sub="Správa přístupu">
        {users.map((u, i) => (
          <SettingsRow key={u.id} theme={T} last={i === users.length-1 && !showForm}
            label={u.username}
            sub={u.email || ''}
            control={
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <StatusPill theme={T} color={u.is_admin ? T.accent : T.textDim}
                  label={u.is_admin ? 'Admin' : 'Uživatel'} size="sm"/>
                <button onClick={() => deleteMutation.mutate(u.id)}
                  style={{...btnGhost(T),padding:'4px 8px',fontSize:11,color:T.statusEnded}}>✕</button>
              </div>
            }/>
        ))}
        {!showForm && (
          <SettingsRow theme={T} last label="Přidat uživatele"
            control={<button onClick={() => setShowForm(true)} style={btnSub(T)}>+ Přidat</button>}/>
        )}
      </SettingsGroup>
      {showForm && (
        <SettingsGroup theme={T} title="Nový uživatel" sub="">
          <SettingsRow theme={T} label="Jméno"
            control={<TextField theme={T} value={newUser.username} onChange={v => setNewUser(p => ({...p, username:v}))} placeholder="username"/>}/>
          <SettingsRow theme={T} label="Heslo"
            control={<TextField theme={T} value={newUser.password} onChange={v => setNewUser(p => ({...p, password:v}))} placeholder="heslo"/>}/>
          <SettingsRow theme={T} label="E-mail"
            control={<TextField theme={T} value={newUser.email} onChange={v => setNewUser(p => ({...p, email:v}))} width={240} placeholder="email@example.com"/>} last/>
          <div style={{display:'flex',gap:8,padding:'12px 16px'}}>
            <button onClick={() => setShowForm(false)} style={btnGhost(T)}>Zrušit</button>
            <button onClick={() => createMutation.mutate(newUser)} style={btnPrimary(T)}>Vytvořit</button>
          </div>
        </SettingsGroup>
      )}
    </div>
  );
}

function ApiKeysSection() {
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
      <SettingsGroup theme={T} title="API klíče" sub="Programatický přístup k Anisubarr">
        {keys.map((k, i) => (
          <SettingsRow key={k.id} theme={T} last={i === keys.length-1}
            label={k.name || `Klíč #${k.id}`}
            sub={`Vytvořen: ${k.created_at ? new Date(k.created_at).toLocaleDateString('cs') : '—'}`}
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
            Žádné API klíče
          </div>
        )}
      </SettingsGroup>
      {newKey && (
        <div style={{background:T.accentSoft,border:`1px solid ${T.accent}44`,borderRadius:10,padding:'12px 16px'}}>
          <div style={{font:'600 12px "Space Grotesk"',color:T.accent,marginBottom:6}}>Nový API klíč — zkopíruj hned, nezobrazí se znovu</div>
          <div style={{font:'600 13px JetBrains Mono',color:T.text,wordBreak:'break-all'}}>{newKey}</div>
          <button onClick={() => setNewKey(null)} style={{...btnGhost(T),marginTop:8,fontSize:11}}>Zavřít</button>
        </div>
      )}
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Název klíče…"
          style={{padding:'7px 10px',background:T.panel2,color:T.text,border:`1px solid ${T.border}`,
            borderRadius:7,outline:'none',font:'500 12px "Space Grotesk"',flex:1}}/>
        <button onClick={() => createMutation.mutate(name)} style={btnPrimary(T)} disabled={!name.trim()}>
          + Vytvořit klíč
        </button>
      </div>
    </div>
  );
}

function useSettingsForm() {
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
      toast.success('Nastavení uloženo');
      qc.invalidateQueries(['app-settings']);
      setFields({});
    },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Chyba při ukládání'),
  });
  const dirty = Object.keys(fields).length > 0;
  return { f, set, setFields, saveMutation, dirty };
}

function SaveBar({ dirty, onDiscard, onSave, saving }) {
  if (!dirty) return null;
  return (
    <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
      <button onClick={onDiscard} style={btnGhost(T)}>Zahodit změny</button>
      <button onClick={onSave} disabled={saving} style={btnPrimary(T)}>
        {saving ? 'Ukládám…' : '✓ Uložit'}
      </button>
    </div>
  );
}

function GeneralSection() {
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
      <SettingsGroup theme={T} title="Obecné" sub="Časové pásmo a zobrazení">
        <SettingsRow theme={T} label="Časové pásmo"
          sub="Pro správné zobrazení dat v Harmonogramu a Kalendáři"
          control={
            <SelectField theme={T} value={f.app_timezone || 'Europe/Prague'}
              onChange={v => set('app_timezone', v)}
              options={TZ_OPTIONS.map(o => ({value: o.value, label: o.label}))}/>
          }/>
        <SettingsRow theme={T} last label="Dní dopředu v Harmonogramu"
          sub="Kolik dní dopředu zobrazit (3–30, výchozí 7)"
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
      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

function SubtitleDefaultsSection() {
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();

  const LANG_OPTIONS = [
    { value: 'cs',    label: 'Česky (cs)' },
    { value: 'sk',    label: 'Slovensky (sk)' },
    { value: 'cs,sk', label: 'CS + SK (oboje)' },
  ];
  const FORMAT_OPTIONS = [
    { value: 'srt', label: 'SRT' },
    { value: 'ass', label: 'ASS / SSA' },
    { value: 'vtt', label: 'VTT' },
  ];
  const ACTION_OPTIONS = [
    { value: 'none',      label: 'Nic' },
    { value: 'auto_sync', label: 'Auto-sync alass' },
    { value: 'rename',    label: 'Auto-přejmenovat' },
  ];
  const PROVIDER_OPTIONS = [
    { value: 'any',     label: 'Libovolný (pořadí z Scrapování)' },
    { value: 'hiyori',  label: 'Hiyori.cz' },
    { value: 'hns',     label: 'HnS.sk' },
    { value: 'kamui',   label: 'Kamui-subs.cz' },
    { value: 'gensubs', label: 'GenSubs' },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title="Výchozí chování titulků" sub="Co se stane po stažení a jaký formát preferovat">
        <SettingsRow theme={T} label="Preferovaný jazyk"
          control={
            <SelectField theme={T} value={f.subtitle_preferred_language || 'cs'}
              onChange={v => set('subtitle_preferred_language', v)}
              options={LANG_OPTIONS}/>
          }/>
        <SettingsRow theme={T} label="Preferovaný formát"
          control={
            <SelectField theme={T} value={f.subtitle_preferred_format || 'srt'}
              onChange={v => set('subtitle_preferred_format', v)}
              options={FORMAT_OPTIONS}/>
          }/>
        <SettingsRow theme={T} label="Akce po stažení"
          sub="Provede se automaticky po každém stažení titulku"
          control={
            <SelectField theme={T} value={f.subtitle_post_download_action || 'none'}
              onChange={v => set('subtitle_post_download_action', v)}
              options={ACTION_OPTIONS}/>
          }/>
        <SettingsRow theme={T} label="Auto-stahovat po epizodě"
          sub="Sonarr webhook Download → automaticky stáhnout titulek"
          control={
            <Toggle theme={T}
              on={f.subtitle_auto_download_on_grab === 'true'}
              onChange={v => set('subtitle_auto_download_on_grab', v ? 'true' : 'false')}/>
          }/>
        <SettingsRow theme={T} last label="Preferovaný poskytovatel"
          sub="Výchozí zdroj pro auto-stahování (override pořadí v Scrapování)"
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

function ScrapingSection() {
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();

  const timeout = parseInt(f.scraper_timeout || '30', 10);
  const maxResults = parseInt(f.scraper_max_results || '0', 10);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title="Chování scraperů" sub="Timeouty, limity a pořadí providerů">
        <SettingsRow theme={T} label="Timeout (sekundy)"
          sub="HTTP timeout pro každý scraper request (výchozí 30 s)"
          control={
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <input
                type="range" min={5} max={120} value={timeout}
                onChange={e => set('scraper_timeout', e.target.value)}
                style={{width:120,accentColor:T.accent}}/>
              <span style={{font:'600 13px JetBrains Mono',color:T.text,minWidth:28}}>{timeout}s</span>
            </div>
          }/>
        <SettingsRow theme={T} label="Max výsledků na providera"
          sub="0 = neomezeno; jinak se vrátí max. N výsledků od každého zdroje"
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
        <SettingsRow theme={T} last label="Záložní pořadí providerů"
          sub="Přetáhněte pro přeuspořádání pořadí prohledávání"
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
      toast.success(`Překlad NFO spuštěn — ${data.series_count} seriálů ve frontě`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Chyba při spuštění překladu NFO');
    } finally {
      setRefreshingAll(false);
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title="NFO & Emby" sub="Automatické generování a refresh NFO souborů">
        <SettingsRow theme={T} label="Auto-generovat NFO při přidání série"
          sub="Při Sonarr sync se vygeneruje NFO pro novou sérii"
          control={
            <Toggle theme={T}
              on={f.nfo_auto_generate_on_add !== 'false'}
              onChange={v => set('nfo_auto_generate_on_add', v ? 'true' : 'false')}/>
          }/>
        <SettingsRow theme={T} label="Auto-refreshovat NFO po promoci"
          sub="Po promoci série se přegeneruje NFO s českým popisem"
          control={
            <Toggle theme={T}
              on={f.nfo_auto_refresh_after_promo !== 'false'}
              onChange={v => set('nfo_auto_refresh_after_promo', v ? 'true' : 'false')}/>
          }/>
        <SettingsRow theme={T} last label="Přeložit a zapsat NFO pro vše"
          sub="Přeloží chybějící CZ popisy a zapíše tvshow.nfo pro všechny série na pozadí"
          control={
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <button
                onClick={handleRefreshAll}
                disabled={refreshingAll}
                style={{...btnSub(T), fontSize:11, padding:'5px 12px'}}
              >
                {refreshingAll ? '⏳ Spouštím…' : '◫ Přeložit a zapsat vše'}
              </button>
              {refreshAllResult && (
                <span style={{font:'11px JetBrains Mono', color:T.statusDone}}>
                  ✓ {refreshAllResult.series_count} seriálů
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
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title="Sonarr — chování" sub="Automatizace po stažení titulků">
        <SettingsRow theme={T} last label="Auto-unmonitor po stažení titulku"
          sub="Epizoda se automaticky odmonitoruje v Sonarru po úspěšném stažení titulku"
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
    label: 'Titulky staženy',
    icon: '✅',
    color: '#22c55e',
    series: 'Demon Slayer: Kimetsu no Yaiba',
    episode: 'S01E05 · Hlídka na noci',
    fields: [
      { label: 'Zdroj', value: 'HnS' },
      { label: 'Stav', value: '✓ Hotovo' },
      { label: 'Jazyk', value: 'CS' },
    ],
  },
  {
    id: 'promotion',
    label: 'Povýšení',
    icon: '⬆',
    color: '#a78bfa',
    series: 'Attack on Titan: The Final Season',
    episode: 'S04E16 · Zápas titanů',
    fields: [
      { label: 'Titulky', value: '93 %' },
      { label: 'Stav', value: '✓ Povýšeno' },
      { label: 'Složka', value: 'anime_series' },
    ],
  },
  {
    id: 'error',
    label: 'Chyba scraperu',
    icon: '❌',
    color: '#ef4444',
    series: 'One Piece',
    episode: 'S01E1050 · Nika probouzí se',
    fields: [
      { label: 'Zdroj', value: 'Hiyori' },
      { label: 'Chyba', value: 'Timeout' },
      { label: 'Jazyk', value: 'CS' },
    ],
  },
  {
    id: 'new_series',
    label: 'Nová série',
    icon: '🆕',
    color: '#3b82f6',
    series: 'Bleach: Thousand-Year Blood War',
    episode: 'S01E01 · The Blood Warfare',
    fields: [
      { label: 'Epizod', value: '13' },
      { label: 'Status', value: 'Airing' },
      { label: 'Zdroj', value: 'Sonarr' },
    ],
  },
];

function DiscordPreview({ useEmbed, prefix, errorRoleId }) {
  const [eventId, setEventId] = useState('subtitles');
  const event = PREVIEW_EVENTS.find(e => e.id === eventId) || PREVIEW_EVENTS[0];
  const displayPrefix = prefix || '[Anisubarr]';

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
      <span style={{ font: '11px "Space Grotesk"', color: DC.textMute }}>dnes v 14:32</span>
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
          Náhled notifikace
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
            <option key={ev.id} value={ev.id}>{ev.label}</option>
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
                  {event.icon} {event.label}
                </div>
                <div style={{ font: '500 13px "Space Grotesk"', color: DC.text, marginBottom: 1 }}>
                  {event.series}
                </div>
                <div style={{ font: '12px "Space Grotesk"', color: DC.fieldLabel, marginBottom: 10 }}>
                  {event.episode}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px 10px', marginBottom: 10 }}>
                  {event.fields.map(fld => (
                    <div key={fld.label}>
                      <div style={{ font: '700 9px "Space Grotesk"', color: DC.fieldLabel, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>
                        {fld.label}
                      </div>
                      <div style={{ font: '500 13px "Space Grotesk"', color: DC.text }}>
                        {fld.value}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ font: '12px "Space Grotesk"', color: DC.link, cursor: 'pointer' }}>
                  ▶ Přehrát
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
              {displayPrefix} {event.icon} {event.label} — {event.series} {event.episode.split(' · ')[0]}
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
      toast.success('Nastavení Discord uloženo');
      qc.invalidateQueries(['app-settings']);
      setFields({});
    },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Chyba při ukládání'),
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
      setTestResult({ connected: false, reason: 'Chyba požadavku' });
    } finally {
      setTesting(false);
    }
  }

  const dirty = Object.keys(fields).length > 0;
  const statusColor = testResult === null ? T.textMute : testResult?.connected ? T.statusDone : T.statusEnded;
  const statusLabel = testResult === null ? '—' : testResult?.connected ? '✓ Test odeslán' : `✕ ${testResult?.reason || 'Chyba'}`;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <DiscordPreview
        useEmbed={f.discord_use_embed !== 'false'}
        prefix={f.discord_message_prefix || ''}
        errorRoleId={f.discord_error_role_id || ''}
      />
      <SettingsGroup theme={T} title="Discord Webhook" sub={
        <span style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{font:'11px JetBrains Mono',color:T.textMute}}>discord.com/api/webhooks</span>
          <StatusPill theme={T} color={statusColor} label={statusLabel} size="sm"/>
        </span>
      }>
        <SettingsRow theme={T} label="Webhook URL"
          sub="URL Discord webhooku pro odesílání notifikací"
          control={<TextField theme={T} value={f.discord_webhook_url || ''} width={320} mono
            placeholder="https://discord.com/api/webhooks/…"
            onChange={v => set('discord_webhook_url', v)}/>}/>
        <SettingsRow theme={T} last label=" "
          control={
            <button onClick={handleTest} disabled={testing}
              style={{...btnSub(T), fontSize:11, padding:'5px 12px'}}>
              {testing ? '…' : '⚡ Otestovat'}
            </button>
          }/>
      </SettingsGroup>

      <SettingsGroup theme={T} title="Notifikace" sub="Kdy posílat zprávy na Discord">
        <SettingsRow theme={T} label="Nová série přidána"
          control={<Toggle theme={T}
            on={f.discord_notify_new_series !== 'false'}
            onChange={v => set('discord_notify_new_series', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label="Titulky staženy"
          control={<Toggle theme={T}
            on={f.discord_notify_subtitles_downloaded !== 'false'}
            onChange={v => set('discord_notify_subtitles_downloaded', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label="Titulky nenalezeny"
          control={<Toggle theme={T}
            on={f.discord_notify_subtitles_missing !== 'false'}
            onChange={v => set('discord_notify_subtitles_missing', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label="Série povýšena"
          control={<Toggle theme={T}
            on={f.discord_notify_promoted !== 'false'}
            onChange={v => set('discord_notify_promoted', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label="Série degradována"
          control={<Toggle theme={T}
            on={f.discord_notify_demoted !== 'false'}
            onChange={v => set('discord_notify_demoted', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label="Issue označena"
          control={<Toggle theme={T}
            on={f.discord_notify_issue_flagged !== 'false'}
            onChange={v => set('discord_notify_issue_flagged', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label="NFO vygenerováno"
          control={<Toggle theme={T}
            on={f.discord_notify_nfo !== 'false'}
            onChange={v => set('discord_notify_nfo', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} last label="Chyba scraperu"
          control={<Toggle theme={T}
            on={f.discord_notify_scraper_error !== 'false'}
            onChange={v => set('discord_notify_scraper_error', v ? 'true' : 'false')}/>}/>
      </SettingsGroup>

      <SettingsGroup theme={T} title="Formátování zpráv" sub="Vzhled a prefix Discord notifikací">
        <SettingsRow theme={T} label="Rich embed"
          sub="Formátované embed zprávy místo plain textu"
          control={<Toggle theme={T}
            on={f.discord_use_embed !== 'false'}
            onChange={v => set('discord_use_embed', v ? 'true' : 'false')}/>}/>
        <SettingsRow theme={T} label="Prefix zprávy"
          sub="Předpona pro plain text zprávy (výchozí [Anisubarr])"
          control={<TextField theme={T} value={f.discord_message_prefix || ''} width={200} mono
            placeholder="[Anisubarr]"
            onChange={v => set('discord_message_prefix', v)}/>}/>
        <SettingsRow theme={T} last label="Role ID pro @mention"
          sub="Discord role ID — zmíní roli při chybách a chybějících titulcích (volitelné)"
          control={<TextField theme={T} value={f.discord_error_role_id || ''} width={200} mono
            placeholder="123456789012345678"
            onChange={v => set('discord_error_role_id', v)}/>}/>
      </SettingsGroup>

      <SaveBar dirty={dirty} onDiscard={() => { setFields({}); setTestResult(null); }} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
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

function LogsSection() {
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
          placeholder="Hledat v lozích…"
          style={{
            flex:1, minWidth:180, padding:'6px 10px',
            background:T.panel2, color:T.text,
            border:`1px solid ${T.border}`, borderRadius:7, outline:'none',
            font:'500 12px "Space Grotesk"',
          }}
        />

        <button onClick={fetchLogs} disabled={loading} style={{...btnSub(T), fontSize:12, padding:'6px 12px'}}>
          {loading ? '…' : '↺ Obnovit'}
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
          {autoRefresh ? '⏸ Auto' : '▷ Auto'}
        </button>

        <button onClick={handleDownload} style={{...btnGhost(T), fontSize:12, padding:'6px 12px'}}>
          ↓ Stáhnout
        </button>
      </div>

      {/* Count info */}
      <div style={{font:'11px JetBrains Mono', color:T.textMute}}>
        {!exists
          ? 'backend.log nenalezen'
          : `${filtered.length} řádků${search ? ' (filtrováno)' : ''}${autoRefresh ? ' · auto-refresh 5s' : ''}`}
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
          ? <span style={{color:T.textMute}}>{loading ? 'Načítám…' : 'Žádné záznamy'}</span>
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
    { value: 'aired', label: 'Jen odvysílané (s videem)' },
    { value: 'all',   label: 'Všechny epizody série' },
  ];
  const EPISODE_ERROR_OPTIONS = [
    { value: 'never',            label: 'Nikdy (ignorovat)' },
    { value: 'flag_only',        label: 'Jen označit (bez přesunu)' },
    { value: 'after_x_episodes', label: 'Degradovat po X epizodách' },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>

      {/* ── Podmínky povyšování ── */}
      <SettingsGroup theme={T} title="Podmínky povyšování"
        sub="Kdy se série automaticky přesune do složky anime_series">

        <SliderRow
          label="Min. % epizod s titulky"
          sub="Kolik procent odvysílaných epizod musí mít CS titulky (0 = libovolné, 100 = všechny)"
          value={minPct} min={0} max={100} unit="%"
          onChange={v => set('promo_min_subtitle_pct', String(v))}/>

        <SettingsRow theme={T} label="Počítat ze"
          sub="Základ pro výpočet procent — jen epizody s videem, nebo celá série"
          control={
            <SelectField theme={T}
              value={f.promo_count_from || 'aired'}
              onChange={v => set('promo_count_from', v)}
              options={COUNT_FROM_OPTIONS}/>
          }/>

        <NumberRow
          label="Min. epizod s titulky (absolutně)"
          sub="Bez ohledu na % — série musí mít aspoň N epizod s titulky"
          value={minEps} min={1} max={99}
          onChange={v => set('promo_min_episodes', String(v))}/>

        <SettingsRow theme={T} label="Jen čisté CS titulky"
          sub="Při výpočtu % ignorovat SK a EN titulky — počítat pouze cs/cze/cz"
          control={
            <Toggle theme={T}
              on={f.promo_require_cs_only === 'true'}
              onChange={v => set('promo_require_cs_only', v ? 'true' : 'false')}/>
          }/>

        <SettingsRow theme={T} label="Tolerovat chybějící titulky u posledního dílu"
          sub={<>
            U vysílaného anime smí poslední epizoda chybět titulky při posuzování podmínek povýšení.
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              Příklad: anime má 8 dílů, ep 8 vyšla včera — série může být povýšena i bez titulků u posledního dílu.
            </span>
          </>}
          control={
            <Toggle theme={T}
              on={f.promo_allow_last_episode_missing !== 'false'}
              onChange={v => set('promo_allow_last_episode_missing', v ? 'true' : 'false')}/>
          }/>

        <SettingsRow theme={T} last label="Vyžadovat alass sync"
          sub="Před povyšením musí být titulky sesynchronizované přes alass (zatím nepodporováno)"
          control={
            <Toggle theme={T}
              on={f.promo_require_alass === 'true'}
              onChange={v => set('promo_require_alass', v ? 'true' : 'false')}/>
          }/>
      </SettingsGroup>

      {/* ── Podmínky degradace ── */}
      <SettingsGroup theme={T} title="Podmínky degradace"
        sub="Kdy se série automaticky přesune zpět do složky incomplete">

        <SettingsRow theme={T} label="Degradovat po hlášení v Seerr"
          sub="Pokud uživatel nahlásí problém přes Seerr, série se automaticky degraduje"
          control={
            <Toggle theme={T}
              on={f.demote_on_seerr_report !== 'false'}
              onChange={v => set('demote_on_seerr_report', v ? 'true' : 'false')}/>
          }/>

        <SettingsRow theme={T} label="Chyba epizody"
          sub="Co dělat, pokud má epizoda problém (chybějící titulek, chyba sync)"
          control={
            <SelectField theme={T}
              value={f.demote_on_episode_error || 'flag_only'}
              onChange={v => set('demote_on_episode_error', v)}
              options={EPISODE_ERROR_OPTIONS}/>
          }/>

        {(f.demote_on_episode_error || 'flag_only') === 'after_x_episodes' && (
          <NumberRow
            label="Práh problémových epizod"
            sub="Degradovat až po N epizodách s chybou (platí jen pro režim 'po X epizodách')"
            value={threshold} min={1} max={50}
            onChange={v => set('demote_episode_threshold', String(v))}/>
        )}

        <SettingsRow theme={T} label="Degradovat pokud chybí všechny titulky"
          sub="Povýšená série, která nemá ani jeden CS titulek, se automaticky degraduje"
          control={
            <Toggle theme={T}
              on={f.demote_on_full_series_missing !== 'false'}
              onChange={v => set('demote_on_full_series_missing', v ? 'true' : 'false')}/>
          }/>

        <SettingsRow theme={T} label="Chránit dokončené série"
          sub="Nezdegradovat série se statusem Ended, pokud mají ≥ 50 % CS titulků"
          control={
            <Toggle theme={T}
              on={f.demote_protect_completed !== 'false'}
              onChange={v => set('demote_protect_completed', v ? 'true' : 'false')}/>
          }/>

        <SettingsRow theme={T} label="Jeden vadný díl"
          sub={<>
            Nastavuje co se stane pokud chybí titulky pouze u JEDNOHO dílu ze série.
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              Příklad: anime má 24 dílů, chybí titulky u dílu 13 → označí se (has_issue), ale zůstane zveřejněné.
            </span>
          </>}
          control={
            <SelectField theme={T}
              value={f.demote_single_episode_action || 'flag_only'}
              onChange={v => set('demote_single_episode_action', v)}
              options={[
                { value: 'flag_only', label: 'Pouze označit' },
                { value: 'demote',    label: 'Degradovat' },
              ]}/>
          }/>

        <SettingsRow theme={T} label="Tolerovat chybějící titulky u posledního dílu (vysílané)"
          sub={<>
            Pokud právě vyšel nový díl a ještě nemá titulky, nezapočítává se jako chyba.
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              Příklad: anime má 8 dílů, ep 8 vyšla včera bez titulků → série zůstane zveřejněná.
            </span>
          </>}
          control={
            <Toggle theme={T}
              on={f.demote_allow_last_episode_missing !== 'false'}
              onChange={v => set('demote_allow_last_episode_missing', v ? 'true' : 'false')}/>
          }/>

        <SliderRow
          label="Procentuální práh pro degradaci"
          sub={<>
            Pokud chybí CS titulky u více než X % epizod, série se vždy degraduje bez ohledu na jiná pravidla.
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              Příklad: při hodnotě 10 % — anime se 24 díly kde chybí titulky u 3 nebo více dílů bude degradováno.
            </span>
          </>}
          value={pctThreshold} min={5} max={50} unit="%"
          onChange={v => set('demote_pct_threshold', String(v))}/>

        <NumberRow
          label="Práh pro degradaci — střední díly (vysílané)"
          sub={<>
            Počet chybějících CS titulků u středních dílů vysílaného anime, po kterém se série degraduje.
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              Příklad: při hodnotě 2 — vysílané anime kde chybí titulky u dílů 3 a 7 (ne posledního) bude degradováno.
            </span>
          </>}
          value={multiThreshold} min={2} max={10}
          onChange={v => set('demote_multi_episode_threshold', String(v))}/>

        <NumberRow
          label="Práh pro degradaci — dokončené anime"
          sub={<>
            Počet epizod bez CS titulků po kterém se dokončené anime automaticky degraduje.
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              Příklad: při hodnotě 2 — anime s 12 díly kde chybí titulky u dílů 5 a 8 bude degradováno.
            </span>
          </>}
          value={completedThresh} min={1} max={10}
          onChange={v => set('demote_completed_threshold', String(v))}/>

        <SliderRow
          label="Ochranná lhůta po povýšení"
          sub="Kolik hodin po povýšení nelze sérii automaticky degradovat (ochrana před 'flapping')"
          value={cooldown} min={0} max={168} unit="h"
          onChange={v => set('demote_cooldown_hours', String(v))}/>

        <SettingsRow theme={T} last label=" " control={
          <span style={{font:'11px JetBrains Mono',color:T.textMute}}>
            {cooldown === 0 ? 'bez ochrany' : cooldown === 168 ? '1 týden' : `${cooldown} hodin`}
          </span>
        }/>
      </SettingsGroup>

      {/* ── Audit titulků / stavový automat ── */}
      <SettingsGroup theme={T} title="Audit titulků (stavový automat)"
        sub="Logika pro určení stavu série: CLEAN / PENDING / ABANDONED / DAMAGED / PARTIAL / PENDING_TRANSLATION">

        <SettingsRow theme={T} label="Povolit audit"
          sub="Pravidelně i po každé relevantní změně přehodnotí audit_status každé série"
          control={
            <Toggle theme={T}
              on={f.audit_enabled !== 'false'}
              onChange={v => set('audit_enabled', v ? 'true' : 'false')}/>
          }/>

        <NumberRow
          label="Vysoká tolerance konce série (dny)"
          sub={<>
            Pokud je poslední díl mladší než X dní, chybějící titulky na konci série (tail) se tolerují bez omezení počtu.
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              Příklad: nový díl vyšel včera bez titulků → stále PENDING, ne PARTIAL.
            </span>
          </>}
          value={auditTailHighDays} min={1} max={30}
          onChange={v => set('audit_tail_high_tolerance_days', String(v))}/>

        <NumberRow
          label="Nízká tolerance konce série (dny)"
          sub="Mezi vysokou a touto hranicí (ve dnech) se chybějící titulky na konci tolerují jen do max. počtu epizod níže"
          value={auditTailLowDays} min={auditTailHighDays + 1} max={120}
          onChange={v => set('audit_tail_low_tolerance_days', String(v))}/>

        <NumberRow
          label="Max. epizod v nízké toleranci"
          sub={<>
            Maximální počet epizod bez titulků na konci série, které se v 'nízké toleranci' ještě tolerují.
            <span style={{display:'block',fontStyle:'italic',opacity:0.65,marginTop:2}}>
              Nad touto hranicí dní i počtem epizod se stav stává PARTIAL / ABANDONED.
            </span>
          </>}
          value={auditTailLowMaxEps} min={1} max={10}
          onChange={v => set('audit_tail_low_max_episodes', String(v))}/>

        <NumberRow last
          label="Interval kontroly hiyori.cz (hodiny)"
          sub="Jak často se před přiřazením ABANDONED kontroluje hiyori.cz, zda je série plánovaná / oživená (→ PENDING_TRANSLATION)"
          value={auditHiyoriHours} min={1} max={168}
          onChange={v => set('audit_hiyori_check_interval_hours', String(v))}/>
      </SettingsGroup>

      <SaveBar dirty={dirty} onDiscard={() => setFields({})} onSave={() => saveMutation.mutate()} saving={saveMutation.isPending}/>
    </div>
  );
}

// ── Triggers tab (event-driven toggles) ───────────────────────────────────

const TRIGGER_ROWS = [
  { key: 'auto_emby_scan_on_promote',      label: 'Emby scan po povýšení',              sub: 'Po automatickém povýšení série spustí skenování knihovny Emby',                          defaultOn: true,  group: 'Po povýšení série' },
  { key: 'auto_nfo_on_promote',            label: 'Generovat NFO po povýšení',          sub: 'Po povýšení série vygeneruje / aktualizuje tvshow.nfo s českým popisem',                  defaultOn: true,  group: 'Po povýšení série' },
  { key: 'auto_discord_on_promote',        label: 'Discord notifikace po povýšení',     sub: 'Po povýšení série odešle embed zprávu na Discord webhook',                                defaultOn: true,  group: 'Po povýšení série' },
  { key: 'auto_alass_on_download',         label: 'Alass sync po stažení titulku',      sub: 'Automaticky synchronizuje načasování titulků pomocí alass po každém stažení',             defaultOn: false, group: 'Po stažení titulků' },
  { key: 'auto_discord_on_subtitles',      label: 'Discord notifikace po stažení',      sub: 'Po úspěšném stažení CZ titulku odešle notifikaci na Discord',                             defaultOn: true,  group: 'Po stažení titulků' },
  { key: 'auto_subtitle_search_on_grab',   label: 'Hledat titulky po přidání epizody',  sub: 'Po Sonarr sync automaticky spustí hledání titulků pro nové epizody s videem',             defaultOn: false, group: 'Po Sonarr sync' },
  { key: 'auto_promote_check_on_sync',     label: 'Kontrola povýšení po Sonarr sync',   sub: 'Po dokončení Sonarr sync zkontroluje podmínky povýšení / degradace pro všechny série',    defaultOn: true,  group: 'Po Sonarr sync' },
  { key: 'auto_translate_description',     label: 'Automaticky překládat popisky anime do češtiny', sub: 'Při syncu přeloží popis série i epizod do češtiny pomocí nakonfigurovaného AI providera (jen nové/nepřeložené)', defaultOn: false, group: 'Po Sonarr sync' },
  { key: 'auto_seerr_issue_on_error',      label: 'Nahlásit issue v Seerr při chybě',   sub: 'Při opakované chybě stažení titulků automaticky vytvoří issue v Seerr',                   defaultOn: false, group: 'Při chybě' },
];

function TriggersTab() {
  const { f, set, setFields, saveMutation, dirty } = useSettingsForm();
  const groups = [...new Set(TRIGGER_ROWS.map(r => r.group))];
  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      {groups.map(group => {
        const rows = TRIGGER_ROWS.filter(r => r.group === group);
        return (
          <SettingsGroup key={group} theme={T} title={group} sub="Automatické akce při této události">
            {rows.map((row, i) => {
              const val = f[row.key];
              const isOn = val === undefined || val === '' ? row.defaultOn : val !== 'false';
              return (
                <SettingsRow key={row.key} theme={T} last={i === rows.length - 1}
                  label={row.label} sub={row.sub}
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
  { value: '30s',   label: 'Každých 30 sekund (debug)' },
  { value: '5min',  label: 'Každých 5 minut' },
  { value: '10min', label: 'Každých 10 minut' },
  { value: '15min', label: 'Každých 15 minut' },
  { value: '30min', label: 'Každých 30 minut' },
  { value: '1h',    label: 'Každou hodinu' },
  { value: '3h',    label: 'Každé 3 hodiny' },
  { value: '6h',    label: 'Každých 6 hodin' },
  { value: '12h',   label: 'Každých 12 hodin' },
  { value: 'daily', label: 'Jednou denně' },
  { value: 'weekly',label: 'Jednou týdně' },
];

const DOW_OPTIONS = [
  { value: 0, label: 'Pondělí' },
  { value: 1, label: 'Úterý' },
  { value: 2, label: 'Středa' },
  { value: 3, label: 'Čtvrtek' },
  { value: 4, label: 'Pátek' },
  { value: 5, label: 'Sobota' },
  { value: 6, label: 'Neděle' },
];

const JOB_GROUPS = [
  { label: 'Integrace',   ids: ['sonarr_sync', 'seerr_sync', 'anilist_refresh'] },
  { label: 'Titulky',     ids: ['download_missing', 'subtitle_langcheck', 'ollama_translate'] },
  { label: 'Správa',      ids: ['nfo_refresh', 'promotion_check'] },
];

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
            <option key={o.value} value={o.value}>{o.label}</option>
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
              <option key={o.value} value={o.value}>{o.label}</option>
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
          title="Spustit teď"
          style={{
            ...btnSub(T),
            fontSize: 11,
            padding: '5px 10px',
            color: running ? T.textMute : T.accent2,
            borderColor: running ? T.border : `${T.accent2}44`,
            flexShrink: 0,
          }}
        >
          {running ? '⏳' : '▶'} Spustit teď
        </button>

        {/* Save button (only when dirty) */}
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            style={{...btnPrimary(T), fontSize:11, padding:'5px 10px', flexShrink:0}}
          >
            {saving ? '…' : '✓ Uložit'}
          </button>
        )}
      </div>
    </div>
  );
}

function ScheduledJobsTab() {
  const qc = useQueryClient();
  const toast = useToast();

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
      toast.success(`${jobMap[jobId]?.name || jobId} — nastavení uloženo`);
      qc.invalidateQueries(['scheduler-jobs']);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Chyba při ukládání');
    } finally {
      setSaving(s => ({...s, [jobId]: false}));
    }
  }

  async function handleRunNow(jobId) {
    setRunning(s => ({...s, [jobId]: true}));
    try {
      await runSchedulerJobNow(jobId);
      toast.success(`${jobMap[jobId]?.name || jobId} — spuštěno`);
      setTimeout(() => {
        qc.invalidateQueries(['scheduler-jobs']);
        setRunning(s => ({...s, [jobId]: false}));
      }, 3000);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Chyba při spouštění');
      setRunning(s => ({...s, [jobId]: false}));
    }
  }

  if (isLoading) {
    return (
      <div style={{padding:'32px 0', textAlign:'center', color:T.textMute, font:'500 13px "Space Grotesk"'}}>
        Načítám…
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
              Ostatní
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
  { id: 'jobs',     label: 'Plánované úlohy' },
  { id: 'triggers', label: 'Triggery' },
];

function AutoTasksSection() {
  const [tab, setTab] = useState('jobs');

  return (
    <div style={{display:'flex', flexDirection:'column', gap:18}}>
      {/* Tab switcher */}
      <div style={{display:'flex', gap:4, borderBottom:`1px solid ${T.border}`, paddingBottom:0}}>
        {AUTO_TASKS_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: 'transparent',
              color: tab === t.id ? T.accent : T.textMute,
              border: 'none',
              borderBottom: tab === t.id ? `2px solid ${T.accent}` : '2px solid transparent',
              padding: '8px 14px',
              marginBottom: -1,
              font: `${tab === t.id ? 600 : 500} 13px "Space Grotesk"`,
              cursor: 'pointer',
              transition: 'color 0.15s',
            }}
          >
            {t.label}
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

  const content = (
    <>
      {sec === 'profile'     && <ProfileSection/>}
      {sec === 'general'     && <GeneralSection/>}
      {sec === 'library'     && <LibrarySection/>}
      {sec === 'connections' && <ConnectionsSection/>}
      {sec === 'discord'     && <DiscordSection/>}
      {sec === 'subs'        && <div style={{display:'flex',flexDirection:'column',gap:28}}><SubtitleDefaultsSection/><SubsAISection/></div>}
      {sec === 'scraping'    && <ScrapingSection/>}
      {sec === 'nfo'         && <NfoSection/>}
      {sec === 'sonarr_adv'  && <SonarrAdvSection/>}
      {sec === 'promotion'   && <PromotionSection/>}
      {sec === 'auto_tasks'  && <AutoTasksSection/>}
      {sec === 'users'       && <UsersSection/>}
      {sec === 'apikeys'     && <ApiKeysSection/>}
      {sec === 'downloads'   && (
        <div style={{color:T.textMute,fontSize:13,padding:8}}>Sekce stahování — připravuje se</div>
      )}
      {sec === 'indexers'    && <IndexersSection/>}
      {sec === 'logs'        && <LogsSection/>}
      {sec === 'diagnostika' && <DiagnostikaSection/>}
      {sec === 'about'       && <AboutSection/>}
    </>
  );

  if (isMobile) {
    return (
      <div style={{display:'flex',flexDirection:'column',height:'100%',background:T.bg,color:T.text}}>
        <PageHeader theme={T} title="Nastavení" sub="Konfigurace aplikace"/>
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
            {SECTIONS.map(s => (
              <option key={s.id} value={s.id}>{s.icon} {s.label}</option>
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
      <PageHeader theme={T} title="Nastavení" sub="Konfigurace aplikace"/>
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        {/* Sidebar */}
        <div style={{width:180,flexShrink:0,borderRight:`1px solid ${T.border}`,padding:'8px 0',overflowY:'auto'}}>
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSec(s.id)}
              style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'9px 16px',
                background: sec===s.id ? T.accentSoft : 'transparent',
                color: sec===s.id ? T.accent : T.textMute,
                border:'none',cursor:'pointer',fontSize:13,fontFamily:'"Space Grotesk"',fontWeight:500,
                borderLeft: sec===s.id ? `3px solid ${T.accent}` : '3px solid transparent',
                textAlign:'left'}}>
              <span style={{fontSize:15}}>{s.icon}</span> {s.label}
            </button>
          ))}
        </div>
        {/* Content */}
        <div style={{flex:1,overflowY:'auto',padding:'24px 28px'}}>
          {content}
        </div>
      </div>
    </div>
  );
}


function DiagnostikaSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState({});
  const toast = useToast();

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
      toast.success(`Spuštěn sync Sonarru — ${folder} bude přidán pokud ho Sonarr zná`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Chyba při spouštění syncu');
    } finally {
      setAdding(p => ({...p, [folder]: false}));
    }
  };

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <SettingsGroup theme={T} title="Složky bez záznamu v DB"
        sub="Podsložky anime_series složky, které nemají odpovídající sérii v databázi">
        <div style={{padding:'12px 16px'}}>
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            <button onClick={load} disabled={loading} style={btnPrimary(T)}>
              {loading ? 'Načítám…' : '⟳ Zkontrolovat'}
            </button>
          </div>
          {error && (
            <div style={{color:T.statusError,fontSize:13,marginBottom:8,fontFamily:'JetBrains Mono'}}>
              Chyba: {error}
            </div>
          )}
          {data && (
            <div>
              <div style={{fontSize:12,color:T.textMute,marginBottom:8,fontFamily:'JetBrains Mono'}}>
                Root: {data.root_folder} · Celkem složek: {data.total_folders} · Osiřelých: {data.orphaned_count}
              </div>
              {data.folders.length === 0 ? (
                <div style={{color:T.statusDone,fontSize:13}}>✓ Žádné osiřelé složky</div>
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
                        title="Spustí Sonarr sync — série se přidá pokud ji Sonarr zná"
                      >
                        {adding[folder] ? 'Přidávám…' : '+ Přidat do DB'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}

function AboutSection() {
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
            verze 0.4.2 · build 2026
          </div>
        </div>
      </div>
      <div style={{font:'500 13px/1.6 "Space Grotesk"',color:T.textDim,maxWidth:540}}>
        Anime knihovna a editor titulků v jednom. Stahuje nové epizody, automaticky generuje
        a kontroluje titulky pomocí AI, drží přehled o tom, co sleduješ.
      </div>
      <div style={{display:'flex',gap:8}}>
        <button style={btnSub(T)}>Dokumentace</button>
        <button style={btnSub(T)}>GitHub</button>
        <button style={btnSub(T)}>Diagnostika</button>
      </div>
    </div>
  );
}
