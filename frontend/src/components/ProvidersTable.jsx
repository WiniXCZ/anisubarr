import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getServices, createService, updateService, deleteService } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useT } from '../i18n/I18nContext';
import { THEME as T, btnPrimary, btnSub, btnGhost, StatusPill, TextField, SelectField, Toggle } from '../v1design';

// Subtitle providers live in the same registry as service connections
// (backend SUBTITLE_PROVIDER_TYPES) — same CRUD, filtered by category.
const TYPES = [
  { value: 'hiyori',  label: 'Hiyori.cz' },
  { value: 'hns',     label: 'HnS.sk' },
  { value: 'kamui',   label: 'Kamui-subs.cz' },
  { value: 'gensubs', label: 'GenSubs' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map(x => [x.value, x.label]));
// Kamui packs subtitles in password-protected RAR archives.
const USES_EXTRA = (type) => type === 'kamui';

const MASK = '••••';
const EMPTY = {
  type: 'hiyori', name: '', username: '', password: '', extra: '',
  enabled: true, sort_order: 0,
};

export default function ProvidersTable() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(null);

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['services', 'providers'],
    queryFn: () => getServices(undefined, 'provider').then(r => r.data ?? r),
  });

  const invalidate = () => {
    qc.invalidateQueries(['services']);
    qc.invalidateQueries(['services', 'providers']);
  };

  const delMutation = useMutation({
    mutationFn: (id) => deleteService(id),
    onSuccess: () => { invalidate(); toast.success(t('prov_deleted_toast')); },
    onError: (e) => toast.error(e?.response?.data?.detail || t('prov_delete_failed')),
  });

  // Toggling enabled straight from the row — the common case (e.g. switching a
  // banned source off) shouldn't need opening the edit dialog.
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }) => updateService(id, { enabled }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e?.response?.data?.detail || t('prov_save_failed')),
  });

  // Priority = order they're tried in; moving a row rewrites sort_order.
  const reorder = useMutation({
    mutationFn: async ({ index, delta }) => {
      const a = providers[index];
      const b = providers[index + delta];
      if (!a || !b) return;
      await updateService(a.id, { sort_order: b.sort_order ?? index + delta });
      await updateService(b.id, { sort_order: a.sort_order ?? index });
    },
    onSuccess: () => invalidate(),
  });

  const usedTypes = new Set(providers.map(p => p.type));
  const availableTypes = TYPES.filter(x => !usedTypes.has(x.value));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ font: '700 15px "Space Grotesk"', color: T.text }}>{t('prov_title')}</div>
          <div style={{ font: '400 12px "Space Grotesk"', color: T.textDim, marginTop: 2 }}>
            {t('prov_subtitle')}
          </div>
        </div>
        <button
          onClick={() => setEditing({ ...EMPTY, type: availableTypes[0]?.value || 'hiyori',
                                      sort_order: providers.length })}
          disabled={!availableTypes.length}
          style={{ ...btnPrimary(T), opacity: availableTypes.length ? 1 : 0.5 }}>
          {t('prov_add_btn')}
        </button>
      </div>

      <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead>
              <tr style={{ background: T.panel2 }}>
                {[t('prov_col_priority'), t('prov_col_provider'), t('prov_col_account'),
                  t('prov_col_status'), ''].map((h, i) => (
                  <th key={i} style={{
                    textAlign: 'left', padding: '9px 12px',
                    font: '600 11px "Space Grotesk"', color: T.textDim,
                    borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} style={{ padding: 18, textAlign: 'center', color: T.textMute, font: '400 13px "Space Grotesk"' }}>
                  {t('prov_loading')}</td></tr>
              )}
              {!isLoading && providers.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 18, textAlign: 'center', color: T.textMute, font: '400 13px "Space Grotesk"' }}>
                  {t('prov_empty')}
                </td></tr>
              )}
              {providers.map((p, idx) => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${T.border}`, opacity: p.enabled ? 1 : 0.55 }}>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                    <span style={{ font: '600 12px "JetBrains Mono", monospace', color: T.textMute, marginRight: 6 }}>
                      {idx + 1}.
                    </span>
                    <button onClick={() => reorder.mutate({ index: idx, delta: -1 })}
                      disabled={idx === 0}
                      title={t('prov_move_up')}
                      style={{ ...btnGhost(T), padding: '1px 6px', fontSize: 11, marginRight: 2,
                               opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
                    <button onClick={() => reorder.mutate({ index: idx, delta: 1 })}
                      disabled={idx === providers.length - 1}
                      title={t('prov_move_down')}
                      style={{ ...btnGhost(T), padding: '1px 6px', fontSize: 11,
                               opacity: idx === providers.length - 1 ? 0.3 : 1 }}>↓</button>
                  </td>
                  <td style={{ padding: '9px 12px', font: '600 13px "Space Grotesk"', color: T.text, whiteSpace: 'nowrap' }}>
                    {TYPE_LABEL[p.type] || p.type}
                  </td>
                  <td style={{ padding: '9px 12px', font: '400 12px "JetBrains Mono", monospace', color: T.textDim }}>
                    {p.username || '—'}
                  </td>
                  <td style={{ padding: '9px 12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <Toggle theme={T} on={!!p.enabled}
                        onChange={(v) => toggleMutation.mutate({ id: p.id, enabled: v })} />
                      <StatusPill theme={T}
                        color={p.enabled ? T.statusDone : T.textMute}
                        label={p.enabled ? t('prov_status_active') : t('prov_status_disabled')} size="sm"/>
                    </label>
                  </td>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button onClick={() => setEditing(p)}
                      style={{ ...btnGhost(T), fontSize: 11, padding: '4px 10px', marginRight: 6 }}>
                      {t('prov_edit')}
                    </button>
                    <button
                      onClick={() => { if (confirm(t('prov_delete_confirm').replace('{name}', TYPE_LABEL[p.type] || p.type))) delMutation.mutate(p.id); }}
                      style={{ ...btnGhost(T), fontSize: 11, padding: '4px 10px', color: T.statusEnded }}>
                      {t('prov_delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ProviderModal
          provider={editing}
          availableTypes={editing.id ? TYPES : availableTypes}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}
    </div>
  );
}

function ProviderModal({ provider, availableTypes, onClose, onSaved }) {
  const t = useT();
  const toast = useToast();
  const isNew = !provider.id;
  const [form, setForm] = useState({ ...EMPTY, ...provider });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: (form.name || '').trim() || TYPE_LABEL[form.type] || form.type,
        type: form.type,
        username: (form.username || '').trim() || null,
        enabled: form.enabled !== false,
        sort_order: Number(form.sort_order) || 0,
      };
      // Never send back the mask — that would overwrite the stored secret.
      if (form.password && !String(form.password).startsWith(MASK)) payload.password = form.password;
      if (USES_EXTRA(form.type) && form.extra && !String(form.extra).startsWith(MASK)) {
        payload.extra = form.extra;
      }
      return isNew ? createService(payload) : updateService(provider.id, payload);
    },
    onSuccess: () => { toast.success(isNew ? t('prov_added_toast') : t('prov_saved_toast')); onSaved(); },
    onError: (e) => toast.error(e?.response?.data?.detail || t('prov_save_failed')),
  });

  const canSave = !!form.type && !!(form.username || '').trim();

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 440, maxWidth: '100%', background: T.panel, border: `1px solid ${T.borderStrong}`,
        borderRadius: 14, padding: 22, boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ font: '700 16px "Space Grotesk"', color: T.text }}>
          {isNew ? t('prov_modal_new') : t('prov_modal_edit').replace('{name}', TYPE_LABEL[form.type] || form.type)}
        </div>

        <Field label={t('prov_field_type')}>
          <SelectField theme={T} value={form.type} options={availableTypes}
            onChange={v => set('type', v)} />
        </Field>
        <Field label={t('prov_field_user')}>
          <TextField theme={T} value={form.username || ''} width={260} mono
            placeholder="uzivatel" onChange={v => set('username', v)} />
        </Field>
        <Field label={t('prov_field_pass')}>
          <TextField theme={T} value={form.password || ''} width={260} mono type="password"
            placeholder="••••••••" onChange={v => set('password', v)} />
        </Field>
        {USES_EXTRA(form.type) && (
          <Field label={t('prov_field_rar')}>
            <TextField theme={T} value={form.extra || ''} width={260} mono
              placeholder="kamui" onChange={v => set('extra', v)} />
          </Field>
        )}
        <Field label={t('prov_field_enabled')}>
          <Toggle theme={T} on={form.enabled !== false} onChange={v => set('enabled', v)} />
        </Field>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} style={btnSub(T)}>{t('prov_cancel')}</button>
          <button onClick={() => save.mutate()} disabled={!canSave || save.isPending} style={btnPrimary(T)}>
            {save.isPending ? t('prov_saving') : (isNew ? t('prov_add') : t('prov_save'))}
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
