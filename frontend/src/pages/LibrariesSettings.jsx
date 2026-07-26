/**
 * LibrariesSettings.jsx
 * Settings section for managing media libraries.
 * Rendered inside Settings.jsx under section id="libraries_mgmt"
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import {
  THEME as T, btnPrimary, btnGhost, btnSub,
  SettingsGroup, SettingsRow, TextField, SelectField, Toggle, StatusPill,
} from '../v1design';

// ── API ──────────────────────────────────────────────────────────────────────
const fetchLibraries   = () => api.get('/libraries').then(r => r.data);
const createLibrary    = (data) => api.post('/libraries', data).then(r => r.data);
const updateLibrary    = ({ id, ...data }) => api.patch(`/libraries/${id}`, data).then(r => r.data);
const deleteLibraryApi = (id) => api.delete(`/libraries/${id}`);
const testLibrary      = (id) => api.post(`/libraries/${id}/test`).then(r => r.data);
const syncLibrary      = (id) => api.post(`/libraries/${id}/sync`).then(r => r.data);

const MEDIA_TYPES = [
  { value: 'anime',  label: 'Anime (Sonarr + AniList)' },
  { value: 'series', label: 'Seriály (Sonarr)' },
  { value: 'movies', label: 'Filmy (Radarr)' },
];

const EMPTY_FORM = {
  name: '',
  media_type: 'series',
  sonarr_service_id: null,
  sonarr_host: '',
  sonarr_api_key: '',
  radarr_host: '',
  radarr_api_key: '',
  subtitles_enabled: false,
  translation_enabled: false,
  anilist_enabled: false,
  enabled: true,
};

// ── StatusDot ────────────────────────────────────────────────────────────────
function StatusDot({ ok }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: ok ? T.statusDone : T.statusEnded,
      boxShadow: ok ? `0 0 5px ${T.statusDone}88` : `0 0 5px ${T.statusEnded}88`,
      marginRight: 6, flexShrink: 0,
    }} />
  );
}

// ── LibraryCard ───────────────────────────────────────────────────────────────
function LibraryCard({ lib, onEdit, onDelete, onSync }) {
  const toast = useToast();
  const [testRes, setTestRes] = useState(null);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await testLibrary(lib.id);
      setTestRes(res);
    } catch (e) {
      toast.error('Test selhal');
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncLibrary(lib.id);
      if (res?.status === 'queued') {
        toast.success('Synchronizace spuštěna na pozadí — průběh v panelu úloh');
      } else {
        toast.success(`Sync hotov: ${JSON.stringify(res)}`);
      }
      onSync?.();
    } catch (e) {
      toast.error('Sync selhal: ' + (e?.response?.data?.detail || e.message));
    } finally {
      setSyncing(false);
    }
  };

  const typeLabel = MEDIA_TYPES.find(t => t.value === lib.media_type)?.label || lib.media_type;
  const count = lib.media_type === 'movies' ? `${lib.movies_count} filmů` : `${lib.series_count} sérií`;

  return (
    <div style={{
      background: T.panel2,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: `700 15px "Space Grotesk"`, color: T.text, flex: 1 }}>{lib.name}</span>
        <StatusPill theme={T} color={lib.enabled ? T.statusDone : T.textMute}
          label={lib.enabled ? 'Aktivní' : 'Vypnuto'} dot />
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ font: `500 12px "Space Grotesk"`, color: T.textDim,
          background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6,
          padding: '2px 8px' }}>{typeLabel}</span>
        <span style={{ font: `500 12px "Space Grotesk"`, color: T.textDim }}>{count}</span>
        {lib.sonarr_host && <span style={{ font: `11px "JetBrains Mono"`, color: T.textMute }}>Sonarr: {lib.sonarr_host}</span>}
        {lib.radarr_host && <span style={{ font: `11px "JetBrains Mono"`, color: T.textMute }}>Radarr: {lib.radarr_host}</span>}
      </div>

      {/* Features */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {lib.subtitles_enabled && <StatusPill theme={T} color={T.accent} label="Titulky" dot />}
        {lib.translation_enabled && <StatusPill theme={T} color={T.accent} label="Překlad" dot />}
        {lib.anilist_enabled && <StatusPill theme={T} color={T.accent} label="AniList" dot />}
      </div>

      {/* Test results */}
      {testRes && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(testRes).map(([svc, res]) => (
            <span key={svc} style={{
              font: `12px "JetBrains Mono"`, color: T.textDim,
              display: 'flex', alignItems: 'center',
            }}>
              <StatusDot ok={res.ok} />{svc}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={handleTest} disabled={testing} style={btnSub(T)}>
          {testing ? 'Testuju…' : '⚡ Test'}
        </button>
        <button onClick={handleSync} disabled={syncing} style={btnSub(T)}>
          {syncing ? 'Synchronizuji…' : '↻ Sync'}
        </button>
        <button onClick={() => onEdit(lib)} style={btnGhost(T)}>✎ Upravit</button>
        <button onClick={() => onDelete(lib.id)} style={{ ...btnGhost(T), color: T.statusEnded }}>✕ Smazat</button>
      </div>
    </div>
  );
}

// ── LibraryForm ───────────────────────────────────────────────────────────────
function LibraryForm({ initial = EMPTY_FORM, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const isMovies = form.media_type === 'movies';
  const isAnime  = form.media_type === 'anime';

  // Sonarr instances from the connection registry — a library picks one here
  // instead of typing a host/api_key.
  const { data: sonarrServices = [] } = useQuery({
    queryKey: ['services', 'sonarr'],
    queryFn: () => api.get('/services', { params: { type: 'sonarr' } }).then(r => r.data),
  });
  const sonarrOptions = [
    { value: '', label: sonarrServices.length ? '— vyber instanci —' : 'žádná služba (přidej v Propojení)' },
    ...sonarrServices.map(s => ({ value: String(s.id), label: `${s.name}${s.host ? ` · ${s.host}` : ''}` })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SettingsGroup theme={T} title="Základní info">
        <SettingsRow theme={T} label="Název"
          control={<TextField theme={T} value={form.name} width={260}
            placeholder="např. Seriály CZ" onChange={v => set('name', v)} />} />
        <SettingsRow theme={T} label="Typ"
          control={<SelectField theme={T} value={form.media_type} width={260}
            options={MEDIA_TYPES} onChange={v => set('media_type', v)} />} />
        <SettingsRow theme={T} last label="Aktivní"
          control={<Toggle theme={T} on={form.enabled} onChange={v => set('enabled', v)} />} />
      </SettingsGroup>

      {/* Sonarr – for anime & series. Instance is picked from the registry. */}
      {!isMovies && (
        <SettingsGroup theme={T} title="Sonarr"
          sub="Vyber instanci z Propojení → Služby">
          <SettingsRow theme={T} last label="Instance"
            control={<SelectField theme={T} width={300}
              value={form.sonarr_service_id != null ? String(form.sonarr_service_id) : ''}
              options={sonarrOptions}
              onChange={v => set('sonarr_service_id', v ? Number(v) : null)} />} />
        </SettingsGroup>
      )}

      {/* Radarr – for movies */}
      {isMovies && (
        <SettingsGroup theme={T} title="Radarr">
          <SettingsRow theme={T} label="URL"
            control={<TextField theme={T} value={form.radarr_host} width={300} mono
              placeholder="http://192.168.1.149:7878"
              onChange={v => set('radarr_host', v)} />} />
          <SettingsRow theme={T} last label="API Key"
            control={<TextField theme={T} value={form.radarr_api_key} width={300} mono
              placeholder="••••••••"
              onChange={v => set('radarr_api_key', v)} />} />
        </SettingsGroup>
      )}

      {/* Indexer/stahovač se nastavují centrálně v Připojení → Služby */}

      {/* Features */}
      <SettingsGroup theme={T} title="Funkce">
        {isAnime && (
          <SettingsRow theme={T} label="AniList obohacení"
            control={<Toggle theme={T} on={form.anilist_enabled}
              onChange={v => set('anilist_enabled', v)} />} />
        )}
        <SettingsRow theme={T} label="Titulky (TD)"
          control={<Toggle theme={T} on={form.subtitles_enabled}
            onChange={v => set('subtitles_enabled', v)} />} />
        <SettingsRow theme={T} last label="AI překlad"
          control={<Toggle theme={T} on={form.translation_enabled}
            onChange={v => set('translation_enabled', v)} />} />
      </SettingsGroup>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btnGhost(T)}>Zrušit</button>
        <button onClick={() => onSave(form)} disabled={saving || !form.name} style={btnPrimary(T)}>
          {saving ? 'Ukládám…' : '✓ Uložit'}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LibrariesSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(null);   // null | 'new' | library object
  const [deleting, setDeleting] = useState(null);  // id to confirm delete

  const { data: libs = [], isLoading } = useQuery({
    queryKey: ['libraries'],
    queryFn: fetchLibraries,
  });

  const invalidate = () => qc.invalidateQueries(['libraries']);

  const createMut = useMutation({
    mutationFn: createLibrary,
    onSuccess: () => { toast.success('Knihovna vytvořena'); setEditing(null); invalidate(); },
    onError: e => toast.error(e?.response?.data?.detail || 'Chyba při vytváření'),
  });

  const updateMut = useMutation({
    mutationFn: updateLibrary,
    onSuccess: () => { toast.success('Knihovna uložena'); setEditing(null); invalidate(); },
    onError: e => toast.error(e?.response?.data?.detail || 'Chyba při ukládání'),
  });

  const deleteMut = useMutation({
    mutationFn: deleteLibraryApi,
    onSuccess: () => { toast.success('Knihovna smazána'); setDeleting(null); invalidate(); },
    onError: e => toast.error(e?.response?.data?.detail || 'Chyba při mazání'),
  });

  const handleSave = (form) => {
    if (editing === 'new') {
      createMut.mutate(form);
    } else {
      updateMut.mutate({ id: editing.id, ...form });
    }
  };

  if (isLoading) return <div style={{ color: T.textMute, padding: 20 }}>Načítám…</div>;

  if (editing) {
    return (
      <LibraryForm
        initial={editing === 'new' ? EMPTY_FORM : editing}
        onSave={handleSave}
        onCancel={() => setEditing(null)}
        saving={createMut.isPending || updateMut.isPending}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Delete confirmation */}
      {deleting && (
        <div style={{
          background: `${T.statusEnded}22`, border: `1px solid ${T.statusEnded}44`,
          borderRadius: 10, padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ color: T.text, font: `500 13px "Space Grotesk"`, flex: 1 }}>
            Opravdu smazat knihovnu? Obsah (série/filmy) zůstane v DB bez přiřazení.
          </span>
          <button onClick={() => deleteMut.mutate(deleting)} style={{ ...btnPrimary(T), background: T.statusEnded }}>
            Smazat
          </button>
          <button onClick={() => setDeleting(null)} style={btnGhost(T)}>Zrušit</button>
        </div>
      )}

      {/* Library cards */}
      {libs.length === 0 && (
        <div style={{ color: T.textMute, font: `500 13px "Space Grotesk"`, padding: '20px 0' }}>
          Žádné knihovny. Přidej první níže.
        </div>
      )}
      {libs.map(lib => (
        <LibraryCard
          key={lib.id}
          lib={lib}
          onEdit={setEditing}
          onDelete={setDeleting}
          onSync={invalidate}
        />
      ))}

      {/* Add button */}
      <button onClick={() => setEditing('new')} style={{ ...btnPrimary(T), alignSelf: 'flex-start' }}>
        + Přidat knihovnu
      </button>
    </div>
  );
}
