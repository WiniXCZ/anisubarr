import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  getRequests, createRequest, updateRequest, deleteRequest,
  overseerrRequests, overseerrStatus, overseerrCancelReq,
} from "../api/client";
import { useToast } from "../context/ToastContext";

// ── Design system (inline, matches design zip) ────────────────────────────────
const T = {
  bg: '#0e1220', panel: '#161a2a', panel2: '#1d2237', sunken: '#0a0d18',
  border: 'rgba(255,255,255,0.06)', borderStrong: 'rgba(255,255,255,0.12)',
  text: '#e8e9f2', textDim: 'rgba(232,233,242,0.62)', textMute: 'rgba(232,233,242,0.38)',
  accent: '#a78bfa', accent2: '#22d3ee', accent3: '#fbbf24',
  accentSoft: 'rgba(167,139,250,0.16)',
  statusDone: '#22c55e', statusUpcoming: '#f59e0b', statusEnded: '#ef4444', statusAiring: '#3b82f6',
};
const btnGhost  = { background:'transparent', color:T.textDim, border:`1px solid ${T.border}`, borderRadius:7, padding:'5px 9px', font:'500 12px/1 "Space Grotesk"', cursor:'pointer' };
const btnPrimary = { background:T.accent, color:'#fff', border:'none', borderRadius:7, padding:'6px 12px', font:'600 12px/1 "Space Grotesk"', cursor:'pointer', boxShadow:`0 4px 14px ${T.accent}55` };
const btnSub    = { background:T.panel2, color:T.text, border:`1px solid ${T.border}`, borderRadius:7, padding:'5px 10px', font:'500 12px/1 "Space Grotesk"', cursor:'pointer' };

// ── Shared design components ──────────────────────────────────────────────────

function PageHeader({ title, subtitle, right }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:14, paddingBottom:14,
      borderBottom:`1px solid ${T.border}`, marginBottom:4 }}>
      <div style={{ display:'flex', flexDirection:'column', lineHeight:1.2 }}>
        <div style={{ font:'700 22px "Space Grotesk"', color:T.text, letterSpacing:'-0.02em' }}>{title}</div>
        {subtitle && <div style={{ font:'500 12px JetBrains Mono', color:T.textMute, marginTop:5, letterSpacing:'.02em' }}>{subtitle}</div>}
      </div>
      <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>{right}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ flex:1, background:T.panel, border:`1px solid ${T.border}`, borderRadius:10,
      padding:'14px 16px', display:'flex', flexDirection:'column', gap:4,
      position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:accent||T.accent }}/>
      <div style={{ font:'600 10px JetBrains Mono', color:T.textMute, letterSpacing:'.08em', textTransform:'uppercase' }}>{label}</div>
      <div style={{ font:'700 26px/1 "Space Grotesk"', color:T.text, marginTop:4, fontFeatureSettings:'"tnum"' }}>{value}</div>
      {sub && <div style={{ font:'500 11px JetBrains Mono', color:T.textDim, marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function FilterPill({ label, active, count, onClick }) {
  return (
    <button onClick={onClick} style={{
      display:'inline-flex', alignItems:'center', gap:7,
      padding:'6px 12px', borderRadius:99,
      background: active ? T.accent : T.panel2,
      color: active ? '#fff' : T.textDim,
      border: `1px solid ${active ? T.accent : T.border}`,
      font:'600 12px "Space Grotesk"', cursor:'pointer',
    }}>
      {label}
      {count != null && (
        <span style={{ font:'700 10px JetBrains Mono',
          background: active ? 'rgba(255,255,255,0.22)' : T.sunken,
          color: active ? '#fff' : T.textMute, padding:'1px 6px', borderRadius:99 }}>{count}</span>
      )}
    </button>
  );
}

function StatusPill({ color, label, size = 'md' }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding: size==='sm' ? '2px 7px' : '3px 9px',
      background:`${color}22`, color, border:`1px solid ${color}55`,
      borderRadius:99, font:`600 ${size==='sm'?9.5:10.5}px JetBrains Mono`,
      letterSpacing:'.04em', whiteSpace:'nowrap',
    }}>
      <span style={{ width:5, height:5, borderRadius:99, background:color }}/>
      {label}
    </span>
  );
}

// ── Request card ──────────────────────────────────────────────────────────────

function RequestCard({ req, onApprove, onReject, actionPending }) {
  const isActing = actionPending === req.id;
  const coverUrl = req.series?.cover_url || null;

  const poster = coverUrl
    ? <img src={coverUrl} alt="" style={{ width:44, height:60, borderRadius:4, objectFit:'cover', flexShrink:0 }} />
    : req.series_id
      ? <div style={{ width:44, height:60, borderRadius:4, flexShrink:0,
          background:`linear-gradient(135deg, ${T.accent}33, ${T.accent2}33)`,
          border:`1px solid ${T.borderStrong}` }} />
      : <div style={{ width:44, height:60, borderRadius:4, flexShrink:0,
          background:`linear-gradient(135deg, ${T.accent}33, ${T.accent2}33)`,
          border:`1px dashed ${T.borderStrong}`, display:'grid', placeItems:'center',
          font:'700 16px "Space Grotesk"', color:T.textMute }}>?</div>;

  const title = req.series?.title || req.custom_title || '—';
  const jp    = req.series?.title_jp || req.custom_jp || '';
  const date  = req.created_at
    ? new Date(req.created_at).toLocaleDateString('cs-CZ', { day:'numeric', month:'short', year:'numeric' })
    : '—';

  return (
    <div style={{ display:'grid', gridTemplateColumns:'48px 1fr auto',
      gap:14, padding:14, background:T.panel, border:`1px solid ${T.border}`,
      borderRadius:10, alignItems:'flex-start' }}>
      {poster}

      <div style={{ minWidth:0, display:'flex', flexDirection:'column', gap:5 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <div style={{ font:'600 14px "Space Grotesk"', color:T.text }}>{title}</div>
          {jp && <div style={{ font:'500 12px "Noto Sans JP", sans-serif', color:T.textDim }}>{jp}</div>}
          {!req.series_id && <StatusPill color={T.accent} label="nové" size="sm"/>}
          <span style={{ font:'500 10px JetBrains Mono', color:T.textMute,
            background:T.panel2, padding:'2px 7px', borderRadius:99,
            border:`1px solid ${T.border}` }}>{req.source || 'manuální'}</span>
        </div>
        <div style={{ font:'500 11px JetBrains Mono', color:T.textDim }}>
          od <span style={{ color:T.text }}>@{req.username || 'anon'}</span> · {date}
        </div>
        {req.note && (
          <div style={{ font:'500 12px/1.4 "Space Grotesk"', color:T.textDim,
            background:T.panel2, border:`1px solid ${T.border}`, borderRadius:6,
            padding:'7px 10px', marginTop:2, fontStyle:'italic' }}>
            „{req.note}"
          </div>
        )}
      </div>

      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
        {req.status === 'pending' && (<>
          <button onClick={() => onReject(req.id)} disabled={isActing} style={btnGhost}>
            Zamítnout
          </button>
          <button onClick={() => onApprove(req.id)} disabled={isActing} style={btnPrimary}>
            {isActing ? <Loader2 size={11} style={{ display:'inline', verticalAlign:'middle' }}/> : '✓ Schválit & přidat'}
          </button>
        </>)}
        {req.status === 'approved' && (<>
          <StatusPill color={T.statusDone} label="Schváleno" size="sm"/>
          <button style={btnGhost}>Zobrazit</button>
        </>)}
        {req.status === 'rejected' && (<>
          <StatusPill color={T.statusEnded} label="Zamítnuto" size="sm"/>
          <button style={btnGhost}>Obnovit</button>
        </>)}
      </div>
    </div>
  );
}

// ── New request modal ─────────────────────────────────────────────────────────

function NewRequestModal({ onClose, onSave, isPending }) {
  const [form, setForm] = useState({ custom_title:'', custom_jp:'', note:'', source:'manuální' });

  return (
    <div style={{ position:'fixed', inset:0, zIndex:50, display:'grid', placeItems:'center' }}>
      <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.55)', backdropFilter:'blur(4px)' }} onClick={onClose}/>
      <div onClick={e => e.stopPropagation()} style={{ position:'relative', width:480, background:T.panel,
        border:`1px solid ${T.borderStrong}`, borderRadius:14, padding:18,
        boxShadow:'0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
          <div style={{ font:'700 14px "Space Grotesk"', color:T.text }}>Nová žádost</div>
          <button onClick={onClose} style={{ ...btnGhost, marginLeft:'auto', padding:'4px 8px' }}>esc</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {[
            { label:'Název anime (CZ)', key:'custom_title', placeholder:'např. Neon Genesis Evangelion', mono:false },
            { label:'Japonský název (volitelně)', key:'custom_jp', placeholder:'例: 新世紀エヴァンゲリオン', mono:false },
            { label:'Poznámka', key:'note', placeholder:'Proč toto anime chcete přidat?', mono:false },
          ].map(({ label, key, placeholder }) => (
            <label key={key} style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <span style={{ font:'500 11px JetBrains Mono', color:T.textMute, letterSpacing:'.04em', textTransform:'uppercase' }}>{label}</span>
              {key === 'note'
                ? <textarea rows={3} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    style={{ background:T.panel2, border:`1px solid ${T.border}`, borderRadius:6,
                      padding:'6px 10px', color:T.text, font:'500 12px "Space Grotesk"', resize:'none', outline:'none' }}/>
                : <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    style={{ background:T.panel2, border:`1px solid ${T.border}`, borderRadius:6,
                      padding:'6px 10px', color:T.text, font:'500 12px "Space Grotesk"', outline:'none' }}/>
              }
            </label>
          ))}
        </div>
        <div style={{ display:'flex', gap:8, marginTop:14, justifyContent:'flex-end' }}>
          <button style={btnGhost} onClick={onClose}>Zrušit</button>
          <button style={btnPrimary} disabled={!form.custom_title || isPending}
            onClick={() => onSave(form)}>
            {isPending ? <Loader2 size={12} style={{ display:'inline', verticalAlign:'middle' }}/> : null}
            {' '}Odeslat žádost
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Overseerr section (extra — not in design, but kept for functionality) ─────

function OverseerrSection() {
  const [filter, setFilter] = useState('pending');
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: statusData } = useQuery({
    queryKey: ['overseerr-status'],
    queryFn: () => overseerrStatus().then(r => r.data),
    staleTime: 30_000,
  });

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['overseerr-requests', filter],
    queryFn: () => overseerrRequests(filter).then(r => r.data),
    enabled: statusData?.connected === true,
    staleTime: 10_000,
  });

  const cancelMutation = useMutation({
    mutationFn: overseerrCancelReq,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['overseerr-requests'] }); toast.success('Žádost zrušena'); },
    onError: (err) => toast.error(`Chyba: ${err.response?.data?.detail || err.message}`),
  });

  if (!statusData || statusData.connected === false) return null;

  const FILTERS = { pending:'Čekající', approved:'Schválené', available:'Dostupné', all:'Vše' };
  const requests = data?.results || [];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:4 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
        <div style={{ font:'700 14px "Space Grotesk"', color:T.text }}>Overseerr</div>
        {statusData?.applicationName && <div style={{ font:'500 11px JetBrains Mono', color:T.textMute }}>{statusData.applicationName}</div>}
        <div style={{ flex:1, height:1, background:T.border, marginLeft:6 }}/>
        <button onClick={() => refetch()} disabled={isRefetching}
          style={{ ...btnGhost, padding:'3px 7px', fontSize:11 }}>
          {isRefetching ? '…' : '⟲'} Obnovit
        </button>
      </div>
      <div style={{ display:'flex', gap:6 }}>
        {Object.entries(FILTERS).map(([k, label]) => (
          <FilterPill key={k} label={label} active={filter===k} onClick={()=>setFilter(k)}/>
        ))}
      </div>
      <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden' }}>
        {isLoading
          ? <div style={{ display:'flex', justifyContent:'center', padding:48 }}><Loader2 size={18} style={{ color:T.textMute }}/></div>
          : requests.length === 0
            ? <p style={{ textAlign:'center', padding:48, color:T.textMute, font:'500 13px "Space Grotesk"' }}>Žádné žádosti</p>
            : requests.map((req, i) => {
                const media = req.media || {};
                const title = media.title || media.originalTitle || media.name || `#${req.id}`;
                return (
                  <div key={req.id ?? i} style={{ display:'flex', alignItems:'center', gap:12,
                    padding:'10px 14px', borderBottom: i<requests.length-1 ? `1px solid ${T.border}` : 'none' }}>
                    {media.posterPath
                      ? <img src={`https://image.tmdb.org/t/p/w92${media.posterPath}`} alt={title}
                          style={{ width:36, height:48, objectFit:'cover', borderRadius:4, flexShrink:0 }} />
                      : <div style={{ width:36, height:48, background:T.panel2, borderRadius:4, flexShrink:0 }} />
                    }
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ font:'600 13px "Space Grotesk"', color:T.text }}>{title}{media.year?` (${media.year})`:''}</div>
                      <div style={{ font:'500 11px JetBrains Mono', color:T.textMute, marginTop:2 }}>
                        {req.requestedBy?.displayName || '—'} · {req.createdAt ? new Date(req.createdAt).toLocaleDateString('cs-CZ') : '—'}
                      </div>
                    </div>
                    <button onClick={() => cancelMutation.mutate(req.id)} disabled={cancelMutation.isPending}
                      style={{ ...btnGhost, padding:'4px 7px', color:T.statusEnded }}>✕</button>
                  </div>
                );
              })
        }
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Requests() {
  const [tab,      setTab]      = useState('pending');
  const [actionId, setActionId] = useState(null);
  const [newModal, setNewModal] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: allReqs = [], isLoading } = useQuery({
    queryKey: ['requests'],
    queryFn: () => getRequests().then(r => r.data),
    staleTime: 15_000,
  });

  const counts = {
    pending:  allReqs.filter(r => r.status === 'pending').length,
    approved: allReqs.filter(r => r.status === 'approved').length,
    rejected: allReqs.filter(r => r.status === 'rejected').length,
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateRequest(id, data),
    onMutate: ({ id }) => setActionId(id),
    onSettled: () => setActionId(null),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['requests'] }); toast.success('Žádost aktualizována'); },
    onError: (err) => toast.error(`Chyba: ${err?.response?.data?.detail || err.message}`),
  });

  const createMutation = useMutation({
    mutationFn: createRequest,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['requests'] }); toast.success('Žádost odeslána'); setNewModal(false); },
    onError: (err) => toast.error(`Chyba: ${err?.response?.data?.detail || err.message}`),
  });

  const filtered = allReqs.filter(r => r.status === tab);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      <PageHeader
        title="Žádosti"
        subtitle="Požadavky od uživatelů a integrace AniList / AniDB"
        right={<>
          <button style={btnSub}>⚙ Pravidla auto-schválení</button>
          <button onClick={() => setNewModal(true)} style={btnPrimary}>+ Nová žádost</button>
        </>}
      />

      {/* Stat cards */}
      <div style={{ display:'flex', gap:10 }}>
        <StatCard label="Čeká"          value={counts.pending}  sub="vyžaduje schválení"         accent={T.statusUpcoming}/>
        <StatCard label="Schváleno"     value={counts.approved} sub="přidáno do knihovny"         accent={T.statusDone}/>
        <StatCard label="Zamítnuto"     value={counts.rejected} sub="nedostupné / mimo profil"    accent={T.statusEnded}/>
        <StatCard label="Auto-schválení" value="OFF"            sub="dle pravidel"                accent={T.accent}/>
      </div>

      {/* Filter pills */}
      <div style={{ display:'flex', gap:6 }}>
        <FilterPill label="Čekající"  active={tab==='pending'}  count={counts.pending}  onClick={() => setTab('pending')}/>
        <FilterPill label="Schválené" active={tab==='approved'} count={counts.approved} onClick={() => setTab('approved')}/>
        <FilterPill label="Zamítnuté" active={tab==='rejected'} count={counts.rejected} onClick={() => setTab('rejected')}/>
      </div>

      {/* Request list */}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {isLoading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:48 }}>
            <Loader2 size={20} style={{ color:T.textMute }}/>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding:24, background:T.panel, border:`1px dashed ${T.border}`,
            borderRadius:10, font:'500 13px "Space Grotesk"', color:T.textMute, textAlign:'center' }}>
            Nic tu není
          </div>
        ) : (
          filtered.map(req => (
            <RequestCard
              key={req.id}
              req={req}
              actionPending={actionId}
              onApprove={(id) => updateMutation.mutate({ id, data: { status: 'approved' } })}
              onReject={(id)  => updateMutation.mutate({ id, data: { status: 'rejected' } })}
            />
          ))
        )}
      </div>

      {/* Overseerr (extra integration) */}
      <OverseerrSection />

      {newModal && (
        <NewRequestModal
          onClose={() => setNewModal(false)}
          isPending={createMutation.isPending}
          onSave={(data) => createMutation.mutate({ ...data, status: 'pending' })}
        />
      )}
    </div>
  );
}
