import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRequests, createRequest, updateRequest, deleteRequest,
  seerrRequests, seerrStatus, seerrApprove, seerrDecline, seerrCancelReq,
} from '../api/client';
import { useToast } from '../context/ToastContext';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, FilterPill, StatusPill, strHue,
} from '../v1design';
import { useT, useLang } from '../i18n/I18nContext';

const T = THEME;

// ── Mini poster ────────────────────────────────────────────────────────────────
function Poster({ title, cover, size = 48 }) {
  const h = strHue(title || '');
  if (cover) {
    return (
      <div style={{
        width: size, height: Math.round(size * 1.4), borderRadius: 5,
        overflow: 'hidden', flexShrink: 0, border: `1px solid ${T.borderStrong}`,
      }}>
        <img src={cover} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: Math.round(size * 1.4), borderRadius: 5, flexShrink: 0,
      background: `linear-gradient(135deg, hsl(${h},55%,28%), hsl(${(h+70)%360},50%,16%))`,
      border: `1px solid ${T.borderStrong}`,
      display: 'grid', placeItems: 'center',
      font: `700 ${Math.round(size * 0.3)}px "Space Grotesk"`, color: 'rgba(255,255,255,0.55)',
    }}>
      {(title || '?')[0].toUpperCase()}
    </div>
  );
}

// ── Status config (labels depend on t(), so built per-render) ──────────────────
function statusMeta(s, t) {
  const map = {
    pending:  { label: t('req_status_pending'),  color: '#f59e0b' },
    approved: { label: t('req_status_approved'), color: '#22c55e' },
    rejected: { label: t('req_status_rejected'), color: '#ef4444' },
    declined: { label: t('req_status_rejected'), color: '#ef4444' },
  };
  return map[s] || { label: String(s || '?'), color: T.textDim };
}

// Seerr numeric status
function seerrMeta(status, t) {
  const map = {
    1: { label: t('req_status_pending'),   color: '#f59e0b' },
    2: { label: t('req_status_approved'),  color: '#22c55e' },
    3: { label: t('req_status_rejected'),  color: '#ef4444' },
    4: { label: t('req_status_partial'),   color: '#6366f1' },
    5: { label: t('req_status_available'), color: '#22c55e' },
  };
  return map[status] || { label: String(status ?? '?'), color: T.textDim };
}

// ── New request modal ──────────────────────────────────────────────────────────
function NewRequestModal({ onClose, onCreate }) {
  const t = useT();
  const [title, setTitle]   = useState('');
  const [titleJp, setTitleJp] = useState('');
  const [note, setNote]     = useState('');

  const inp = (extra = {}) => ({
    width: '100%', boxSizing: 'border-box',
    padding: '8px 11px', background: T.sunken, color: T.text,
    border: `1px solid ${T.border}`, borderRadius: 7,
    outline: 'none', font: '500 13px "Space Grotesk"',
    ...extra,
  });

  function handleSubmit() {
    if (!title.trim()) return;
    onCreate({ custom_title: title.trim(), custom_jp: titleJp.trim() || undefined, note: note.trim() || undefined });
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      display: 'grid', placeItems: 'center', zIndex: 200,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 460, background: T.panel, border: `1px solid ${T.borderStrong}`,
        borderRadius: 14, padding: 24, boxShadow: '0 28px 80px rgba(0,0,0,0.55)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {/* Header */}
        <div>
          <div style={{ font: '700 16px "Space Grotesk"', color: T.text }}>{t('req_modal_title')}</div>
          <div style={{ font: '500 12px "Space Grotesk"', color: T.textMute, marginTop: 3 }}>
            {t('req_modal_subtitle')}
          </div>
        </div>

        {/* Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div>
            <label style={{ font: '500 11px "Space Grotesk"', color: T.textDim, display: 'block', marginBottom: 5 }}>
              {t('req_modal_name_label')} <span style={{ color: T.accent }}>*</span>
            </label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder={t('req_modal_name_placeholder')}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={inp()}
            />
          </div>
          <div>
            <label style={{ font: '500 11px "Space Grotesk"', color: T.textDim, display: 'block', marginBottom: 5 }}>
              {t('req_modal_jp_label')} <span style={{ color: T.textMute }}>{t('req_modal_optional')}</span>
            </label>
            <input
              value={titleJp} onChange={e => setTitleJp(e.target.value)}
              placeholder="鋼の錬金術師…"
              style={inp({ fontFamily: '"Noto Sans JP", sans-serif' })}
            />
          </div>
          <div>
            <label style={{ font: '500 11px "Space Grotesk"', color: T.textDim, display: 'block', marginBottom: 5 }}>
              {t('req_modal_note_label')} <span style={{ color: T.textMute }}>{t('req_modal_optional')}</span>
            </label>
            <textarea
              value={note} onChange={e => setNote(e.target.value)}
              rows={2} placeholder={t('req_modal_note_placeholder')}
              style={{ ...inp(), resize: 'vertical' }}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} style={btnSub(T)}>{t('common_cancel')}</button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            style={{ ...btnPrimary(T), opacity: title.trim() ? 1 : 0.45 }}
          >
            {t('req_modal_submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Local request card ─────────────────────────────────────────────────────────
function LocalCard({ req, onApprove, onReject, onRestore, onDelete, isAdmin }) {
  const { t, lang } = useLang();
  const title  = req.series?.title || req.custom_title || req.title || '—';
  const titleJp = req.custom_jp   || req.series?.jp   || '';
  const cover  = req.series?.cover || null;
  const meta   = statusMeta(req.status, t);

  return (
    <div style={{
      display: 'flex', gap: 14, padding: 14, alignItems: 'flex-start',
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10,
    }}>
      <Poster title={title} cover={cover} size={46}/>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ font: '600 14px "Space Grotesk"', color: T.text }}>{title}</div>
          <StatusPill theme={T} color={meta.color} label={meta.label} size="sm"/>
          {req.source && req.source !== 'manual' && (
            <span style={{
              font: '500 10px JetBrains Mono', color: T.textMute,
              background: T.panel2, padding: '2px 7px', borderRadius: 99, border: `1px solid ${T.border}`,
            }}>{req.source}</span>
          )}
        </div>

        {/* Japanese title */}
        {titleJp && (
          <div style={{ font: '500 12px "Noto Sans JP"', color: T.textDim }}>{titleJp}</div>
        )}

        {/* Meta row */}
        <div style={{ font: '500 11px JetBrains Mono', color: T.textDim }}>
          {t('req_by')} <span style={{ color: T.text }}>@{req.username || 'anon'}</span>
          {req.created_at && (
            <span> · {new Date(req.created_at).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          )}
        </div>

        {/* Note */}
        {req.note && (
          <div style={{
            font: '500 12px/1.45 "Space Grotesk"', color: T.textDim, fontStyle: 'italic',
            background: T.sunken, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 10px', marginTop: 2,
          }}>
            „{req.note}"
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0, alignItems: 'flex-end' }}>
        {req.status === 'pending' && isAdmin && (
          <>
            <button
              onClick={() => onApprove(req.id)}
              style={{ ...btnPrimary(T), padding: '5px 12px', fontSize: 12, minWidth: 90 }}>
              {t('req_approve')}
            </button>
            <button
              onClick={() => onReject(req.id)}
              style={{ ...btnGhost(T), padding: '5px 12px', fontSize: 12, minWidth: 90 }}>
              {t('req_reject')}
            </button>
          </>
        )}
        {req.status === 'approved' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
            <StatusPill theme={T} color="#22c55e" label={`✓ ${t('req_status_approved')}`} size="sm" dot={false}/>
            {isAdmin && (
              <button onClick={() => onDelete(req.id)}
                style={{ ...btnGhost(T), padding: '4px 8px', fontSize: 11 }}>
                {t('common_delete')}
              </button>
            )}
          </div>
        )}
        {(req.status === 'rejected' || req.status === 'declined') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
            <StatusPill theme={T} color="#ef4444" label={`✕ ${t('req_status_rejected')}`} size="sm" dot={false}/>
            {isAdmin && (
              <button onClick={() => onRestore(req.id)}
                style={{ ...btnGhost(T), padding: '4px 8px', fontSize: 11 }}>
                {t('req_restore')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Seerr card ─────────────────────────────────────────────────────────────────
function SeerrCard({ req, onApprove, onDecline, onCancel }) {
  const t = useT();
  const title    = req.media?.title || req.media?.name || req.title || '—';
  const user     = req.requestedBy?.displayName || req.requestedBy?.username || '—';
  const coverUrl = req.media?.posterPath ? `https://image.tmdb.org/t/p/w92${req.media.posterPath}` : null;
  const meta     = seerrMeta(req.status, t);
  const isPending = req.status === 1;

  return (
    <div style={{
      display: 'flex', gap: 14, padding: 14, alignItems: 'flex-start',
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10,
    }}>
      <Poster title={title} cover={coverUrl} size={46}/>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ font: '600 14px "Space Grotesk"', color: T.text }}>{title}</div>
          <StatusPill theme={T} color={meta.color} label={meta.label} size="sm"/>
          <span style={{
            font: '500 10px JetBrains Mono', color: T.textMute,
            background: T.panel2, padding: '2px 7px', borderRadius: 99, border: `1px solid ${T.border}`,
          }}>Seerr</span>
        </div>
        <div style={{ font: '500 11px JetBrains Mono', color: T.textDim }}>
          {t('req_by')} <span style={{ color: T.text }}>@{user}</span>
          {req.media?.mediaType && (
            <span> · {req.media.mediaType === 'tv' ? t('req_media_tv') : t('req_media_movie')}</span>
          )}
        </div>
        {req.seasons?.length > 0 && (
          <div style={{ font: '500 10px JetBrains Mono', color: T.textMute }}>
            {t('req_seasons')}: {req.seasons.map(s => `S${s.seasonNumber}`).join(', ')}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0, alignItems: 'flex-end' }}>
        {isPending ? (
          <>
            <button onClick={() => onApprove(req.id)}
              style={{ ...btnPrimary(T), padding: '5px 12px', fontSize: 12, minWidth: 90 }}>
              {t('req_approve')}
            </button>
            <button onClick={() => onDecline(req.id)}
              style={{ ...btnGhost(T), padding: '5px 12px', fontSize: 12, minWidth: 90 }}>
              {t('req_reject')}
            </button>
          </>
        ) : (
          <button onClick={() => onCancel(req.id)}
            style={{ ...btnGhost(T), padding: '4px 8px', fontSize: 11 }}>
            {t('common_cancel')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────
function Empty({ label }) {
  const t = useT();
  return (
    <div style={{
      padding: '40px 24px', textAlign: 'center',
      background: T.panel, border: `1px dashed ${T.border}`, borderRadius: 10,
    }}>
      <div style={{ font: '600 15px "Space Grotesk"', color: T.textDim, marginBottom: 6 }}>
        {t('req_empty_title')}
      </div>
      <div style={{ font: '500 12px "Space Grotesk"', color: T.textMute }}>{label}</div>
    </div>
  );
}

// ── Stat chip ──────────────────────────────────────────────────────────────────
function StatChip({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 2, padding: '10px 18px',
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, minWidth: 80,
    }}>
      <div style={{ font: `700 22px "Space Grotesk"`, color: color || T.text }}>{value}</div>
      <div style={{ font: '500 11px "Space Grotesk"', color: T.textMute }}>{label}</div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Requests() {
  const t = useT();
  const [tab, setTab]           = useState('pending');
  const [showModal, setShowModal] = useState(false);
  const qc  = useQueryClient();
  const toast = useToast();

  // ── Me (admin check) ────────────────────────────────────────────────────────
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res   = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      return res.ok ? res.json() : null;
    },
  });
  const isAdmin = me?.is_admin || me?.role === 'admin';

  // ── Local requests ──────────────────────────────────────────────────────────
  const { data: localReqs = [], isLoading: localLoading } = useQuery({
    queryKey: ['requests'],
    queryFn: () => getRequests().then(r => r.data ?? r),
  });

  // ── Seerr requests ──────────────────────────────────────────────────────────
  const { data: seerrData = [], isLoading: seerrLoading } = useQuery({
    queryKey: ['seerr-requests'],
    queryFn: async () => {
      const r = await seerrRequests('all');
      const d = r.data;
      return Array.isArray(d) ? d : (d?.results ?? []);
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: seerrStatusData } = useQuery({
    queryKey: ['seerr-status'],
    queryFn: () => seerrStatus().then(r => r.data ?? r),
    retry: 1,
  });

  const seerrConnected = seerrStatusData?.connected !== false;

  // ── Mutations ───────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data) => createRequest(data),
    onSuccess: () => { qc.invalidateQueries(['requests']); toast.success(t('req_toast_created')); },
    onError: (e) => toast.error(e.response?.data?.detail || t('req_toast_create_error')),
  });
  const approveMutation = useMutation({
    mutationFn: (id) => updateRequest(id, { status: 'approved' }),
    onSuccess: () => { qc.invalidateQueries(['requests']); toast.success(t('req_toast_approved')); },
    onError: () => toast.error(t('req_toast_approve_error')),
  });
  const rejectMutation = useMutation({
    mutationFn: (id) => updateRequest(id, { status: 'rejected' }),
    onSuccess: () => { qc.invalidateQueries(['requests']); toast.success(t('req_toast_rejected')); },
  });
  const restoreMutation = useMutation({
    mutationFn: (id) => updateRequest(id, { status: 'pending' }),
    onSuccess: () => { qc.invalidateQueries(['requests']); toast.success(t('req_toast_restored')); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteRequest(id),
    onSuccess: () => { qc.invalidateQueries(['requests']); toast.success(t('req_toast_deleted')); },
  });
  const seerrApproveMutation = useMutation({
    mutationFn: (id) => seerrApprove(id),
    onSuccess: () => { qc.invalidateQueries(['seerr-requests']); toast.success(t('req_toast_seerr_approved')); },
    onError: () => toast.error(t('req_toast_approve_error')),
  });
  const seerrDeclineMutation = useMutation({
    mutationFn: (id) => seerrDecline(id),
    onSuccess: () => { qc.invalidateQueries(['seerr-requests']); toast.success(t('req_toast_seerr_declined')); },
  });
  const seerrCancelMutation = useMutation({
    mutationFn: (id) => seerrCancelReq(id),
    onSuccess: () => { qc.invalidateQueries(['seerr-requests']); toast.success(t('req_toast_seerr_cancelled')); },
  });

  // ── Computed ────────────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    pending:  localReqs.filter(r => r.status === 'pending').length,
    approved: localReqs.filter(r => r.status === 'approved').length,
    rejected: localReqs.filter(r => r.status === 'rejected' || r.status === 'declined').length,
    seerr:    seerrData.length,
    seerrPending: seerrData.filter(r => r.status === 1).length,
  }), [localReqs, seerrData]);

  const list = tab === 'seerr'
    ? seerrData
    : localReqs.filter(r => {
        if (tab === 'pending')  return r.status === 'pending';
        if (tab === 'approved') return r.status === 'approved';
        if (tab === 'rejected') return r.status === 'rejected' || r.status === 'declined';
        return true;
      });

  const loading = tab === 'seerr' ? seerrLoading : localLoading;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {showModal && (
        <NewRequestModal
          onClose={() => setShowModal(false)}
          onCreate={data => createMutation.mutate(data)}
        />
      )}

      <PageHeader theme={T} title={t('req_title')}
        subtitle={t('req_subtitle')}
        right={
          <button onClick={() => setShowModal(true)} style={btnPrimary(T)}>
            {t('req_new')}
          </button>
        }
      />

      <div style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 18,
      }}>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StatChip label={t('req_status_pending')}  value={counts.pending}  color="#f59e0b"/>
          <StatChip label={t('req_status_approved')} value={counts.approved} color="#22c55e"/>
          <StatChip label={t('req_status_rejected')} value={counts.rejected} color="#ef4444"/>
          {seerrConnected && (
            <StatChip label={t('req_stat_seerr_pending')} value={counts.seerrPending} color={T.accent}/>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          <FilterPill theme={T} label={t('req_tab_pending')}  active={tab === 'pending'}
            count={counts.pending}  onClick={() => setTab('pending')}/>
          <FilterPill theme={T} label={t('req_tab_approved')} active={tab === 'approved'}
            count={counts.approved} onClick={() => setTab('approved')}/>
          <FilterPill theme={T} label={t('req_tab_rejected')} active={tab === 'rejected'}
            count={counts.rejected} onClick={() => setTab('rejected')}/>
          {seerrConnected && (
            <FilterPill theme={T} label={t('req_tab_seerr')} active={tab === 'seerr'}
              count={counts.seerr}   onClick={() => setTab('seerr')}/>
          )}
        </div>

        {/* Seerr not connected notice */}
        {tab === 'seerr' && !seerrConnected && (
          <div style={{
            padding: '14px 16px', background: T.panel,
            border: `1px solid ${T.border}`, borderRadius: 10,
            font: '500 13px "Space Grotesk"', color: T.textDim,
          }}>
            {t('req_seerr_notice_pre')}<strong style={{ color: T.text }}>SEERR_HOST</strong>{t('req_seerr_notice_and')}
            <strong style={{ color: T.text }}>SEERR_API_KEY</strong>{t('req_seerr_notice_post')}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center',
            font: '500 13px "Space Grotesk"', color: T.textMute }}>
            {t('common_loading')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.length === 0 && (
              <Empty label={
                tab === 'pending'  ? t('req_empty_pending') :
                tab === 'approved' ? t('req_empty_approved') :
                tab === 'rejected' ? t('req_empty_rejected') :
                t('req_empty_seerr')
              }/>
            )}

            {tab === 'seerr'
              ? list.map((req, i) => (
                  <SeerrCard key={req.id ?? i} req={req}
                    onApprove={id => seerrApproveMutation.mutate(id)}
                    onDecline={id => seerrDeclineMutation.mutate(id)}
                    onCancel={id  => seerrCancelMutation.mutate(id)}
                  />
                ))
              : list.map(req => (
                  <LocalCard key={req.id} req={req}
                    isAdmin={isAdmin}
                    onApprove={id => approveMutation.mutate(id)}
                    onReject={id  => rejectMutation.mutate(id)}
                    onRestore={id => restoreMutation.mutate(id)}
                    onDelete={id  => deleteMutation.mutate(id)}
                  />
                ))
            }
          </div>
        )}
      </div>
    </div>
  );
}
