import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getServices, createService, updateService, deleteService, testServiceUnsaved, testService,
} from '../api/client';
import { useToast } from '../context/ToastContext';
import { THEME as T, btnPrimary, btnSub, btnGhost, StatusPill, TextField, SelectField } from '../v1design';

// Service types the registry supports. `key` matches backend SERVICE_TYPES.
const TYPES = [
  { value: 'sonarr',      label: 'Sonarr' },
  { value: 'radarr',      label: 'Radarr' },
  { value: 'prowlarr',    label: 'Prowlarr' },
  { value: 'jackett',     label: 'Jackett' },
  { value: 'qbittorrent', label: 'qBittorrent' },
  { value: 'emby',        label: 'Emby / Jellyfin' },
  { value: 'seerr',       label: 'Seerr' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map(x => [x.value, x.label]));
// qBittorrent authenticates with username/password; everything else with an API key.
const USES_CREDENTIALS = (type) => type === 'qbittorrent';

const MASK = '••••';
const EMPTY = { type: 'sonarr', name: '', host: '', api_key: '', username: '', password: '', is_default: false, enabled: true };

export default function ServicesTable() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(null); // null | {} (new) | service (edit)

  const { data: services = [], isLoading } = useQuery({
    queryKey: ['services'],
    queryFn: () => getServices().then(r => r.data ?? r),
  });

  const delMutation = useMutation({
    mutationFn: (id) => deleteService(id),
    onSuccess: () => { qc.invalidateQueries(['services']); toast.success('Služba smazána'); },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Smazání selhalo'),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ font: '700 15px "Space Grotesk"', color: T.text }}>Služby</div>
          <div style={{ font: '400 12px "Space Grotesk"', color: T.textDim, marginTop: 2 }}>
            Připojení k Sonarr, Radarr, Prowlarr, qBittorrent, Emby, Seerr… Přidej libovolný počet instancí.
          </div>
        </div>
        <button onClick={() => setEditing({ ...EMPTY })} style={btnPrimary(T)}>+ Přidat službu</button>
      </div>

      <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ background: T.panel2 }}>
                {['Typ', 'Název', 'Host', 'Stav', 'Výchozí', ''].map((h, i) => (
                  <th key={i} style={{
                    textAlign: i === 4 ? 'center' : 'left', padding: '9px 12px',
                    font: '600 11px "Space Grotesk"', color: T.textDim,
                    borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} style={{ padding: 18, textAlign: 'center', color: T.textMute, font: '400 13px "Space Grotesk"' }}>Načítám…</td></tr>
              )}
              {!isLoading && services.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 18, textAlign: 'center', color: T.textMute, font: '400 13px "Space Grotesk"' }}>
                  Zatím žádná služba — přidej první připojení.
                </td></tr>
              )}
              {services.map(s => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: '9px 12px', font: '600 12px "Space Grotesk"', color: T.text, whiteSpace: 'nowrap' }}>
                    {TYPE_LABEL[s.type] || s.type}
                  </td>
                  <td style={{ padding: '9px 12px', font: '500 13px "Space Grotesk"', color: T.text }}>{s.name}</td>
                  <td style={{ padding: '9px 12px', font: '400 12px "JetBrains Mono", monospace', color: T.textDim }}>{s.host || '—'}</td>
                  <td style={{ padding: '9px 12px' }}>
                    <StatusPill theme={T}
                      color={s.enabled ? T.statusDone : T.textMute}
                      label={s.enabled ? 'aktivní' : 'vypnuto'} size="sm"/>
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'center' }}>{s.is_default ? '★' : ''}</td>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button onClick={() => setEditing(s)} style={{ ...btnGhost(T), fontSize: 11, padding: '4px 10px', marginRight: 6 }}>Upravit</button>
                    <button
                      onClick={() => { if (confirm(`Smazat službu „${s.name}"?`)) delMutation.mutate(s.id); }}
                      style={{ ...btnGhost(T), fontSize: 11, padding: '4px 10px', color: T.statusEnded }}>Smazat</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ServiceModal
          service={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries(['services']); }}
        />
      )}
    </div>
  );
}

function ServiceModal({ service, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !service.id;
  const [form, setForm] = useState({ ...EMPTY, ...service });
  const [testResult, setTestResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const creds = USES_CREDENTIALS(form.type);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(), type: form.type, host: form.host.trim(),
        is_default: !!form.is_default, enabled: form.enabled !== false,
      };
      if (creds) {
        payload.username = form.username || null;
        if (form.password && !String(form.password).startsWith(MASK)) payload.password = form.password;
      } else if (form.api_key && !String(form.api_key).startsWith(MASK)) {
        payload.api_key = form.api_key;
      }
      return isNew ? createService(payload) : updateService(service.id, payload);
    },
    onSuccess: () => { toast.success(isNew ? 'Služba přidána' : 'Uloženo'); onSaved(); },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Uložení selhalo'),
  });

  async function handleTest() {
    setBusy(true); setTestResult(null);
    try {
      const keyUntouched  = !form.api_key  || String(form.api_key).startsWith(MASK);
      const passUntouched = !form.password || String(form.password).startsWith(MASK);
      const hostUnchanged = !isNew && form.host === service.host;
      let r;
      if (hostUnchanged && (creds ? passUntouched : keyUntouched)) {
        // Secrets are still the mask — test the saved service with its stored
        // credentials instead of sending the mask (which would always fail).
        r = await testService(service.id);
      } else {
        r = await testServiceUnsaved({
          type: form.type, host: form.host,
          api_key: keyUntouched ? undefined : form.api_key,
          username: creds ? (form.username || undefined) : undefined,
          password: (creds && !passUntouched) ? form.password : undefined,
        });
      }
      setTestResult(r.data ?? r);
    } catch {
      setTestResult({ connected: false, reason: 'Požadavek selhal' });
    } finally { setBusy(false); }
  }

  const statusColor = testResult === null ? T.textMute : testResult?.connected ? T.statusDone : T.statusEnded;
  const statusLabel = testResult === null ? '—'
    : testResult?.connected ? '✓ Připojeno' : `✕ ${testResult?.reason || 'Chyba'}`;

  const canSave = form.name.trim() && form.type;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 460, maxWidth: '100%', background: T.panel, border: `1px solid ${T.borderStrong}`,
        borderRadius: 14, padding: 22, boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ font: '700 16px "Space Grotesk"', color: T.text }}>
          {isNew ? 'Nová služba' : `Upravit — ${service.name}`}
        </div>

        <Field label="Typ">
          <SelectField theme={T} value={form.type} options={TYPES}
            onChange={v => { set('type', v); setTestResult(null); }} />
        </Field>
        <Field label="Název">
          <TextField theme={T} value={form.name} width={280} placeholder="např. Sonarr Anime"
            onChange={v => set('name', v)} />
        </Field>
        <Field label="Host / URL">
          <TextField theme={T} value={form.host} width={280} mono placeholder="http://192.168.1.x:port"
            onChange={v => set('host', v)} />
        </Field>
        {creds ? (
          <>
            <Field label="Uživatel">
              <TextField theme={T} value={form.username || ''} width={280} mono placeholder="admin"
                onChange={v => set('username', v)} />
            </Field>
            <Field label="Heslo">
              <TextField theme={T} value={form.password || ''} width={280} mono type="password" placeholder="••••••••"
                onChange={v => set('password', v)} />
            </Field>
          </>
        ) : (
          <Field label="API klíč">
            <TextField theme={T} value={form.api_key || ''} width={280} mono placeholder="••••••••"
              onChange={v => set('api_key', v)} />
          </Field>
        )}
        <Field label="Výchozí instance">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', font: '500 13px "Space Grotesk"', color: T.textDim }}>
            <input type="checkbox" checked={!!form.is_default} onChange={e => set('is_default', e.target.checked)} />
            použít jako výchozí pro tento typ
          </label>
        </Field>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={handleTest} disabled={busy || !form.host} style={{ ...btnSub(T), fontSize: 12 }}>
            {busy ? 'Testuji…' : 'Test připojení'}
          </button>
          <StatusPill theme={T} color={statusColor} label={statusLabel} size="sm" />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} style={btnSub(T)}>Zrušit</button>
          <button onClick={() => save.mutate()} disabled={!canSave || save.isPending} style={btnPrimary(T)}>
            {save.isPending ? 'Ukládám…' : (isNew ? 'Přidat' : 'Uložit')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ font: '500 12px "Space Grotesk"', color: T.textDim }}>{label}</div>
      {children}
    </div>
  );
}
