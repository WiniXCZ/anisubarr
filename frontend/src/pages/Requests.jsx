import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRequests, createRequest, updateRequest, deleteRequest,
  overseerrRequests, overseerrStatus, overseerrApprove, overseerrDecline, overseerrCancelReq,
} from '../api/client';
import { useToast } from '../context/ToastContext';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, StatCard, FilterPill, StatusPill,
  strHue,
} from '../v1design';

const T = THEME;

function AnimePosterSmall({ title, coverUrl, hue }) {
  const h = hue || strHue(title || '');
  if (coverUrl) {
    return (
      <div style={{width:44,height:60,borderRadius:4,overflow:'hidden',flexShrink:0,border:`1px solid ${T.borderStrong}`}}>
        <img src={coverUrl} alt={title} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
      </div>
    );
  }
  return (
    <div style={{width:44,height:60,borderRadius:4,flexShrink:0,
      background:`linear-gradient(135deg, hsl(${h},55%,30%), hsl(${(h+60)%360},50%,18%))`,
      border:`1px solid ${T.borderStrong}`, display:'grid', placeItems:'center',
      font:'700 14px "Space Grotesk"', color:'rgba(255,255,255,0.6)'}}>
      {title?.[0] || '?'}
    </div>
  );
}

function NewRequestModal({ theme, onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'grid',placeItems:'center',zIndex:100}}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width:480, background:T.panel, border:`1px solid ${T.borderStrong}`,
        borderRadius:14, padding:22, boxShadow:'0 24px 70px rgba(0,0,0,0.5)',
      }}>
        <div style={{font:'700 16px "Space Grotesk"',color:T.text,marginBottom:16}}>Nová žádost</div>
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div>
            <div style={{font:'500 12px "Space Grotesk"',color:T.textDim,marginBottom:6}}>Název anime</div>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Název série…"
              style={{width:'100%',padding:'8px 10px',background:T.panel2,color:T.text,
                border:`1px solid ${T.border}`,borderRadius:7,outline:'none',font:'500 13px "Space Grotesk"'}}/>
          </div>
          <div>
            <div style={{font:'500 12px "Space Grotesk"',color:T.textDim,marginBottom:6}}>Poznámka (volitelné)</div>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              rows={3} placeholder="Proč chceš přidat tento titul?"
              style={{width:'100%',padding:'8px 10px',background:T.panel2,color:T.text,
                border:`1px solid ${T.border}`,borderRadius:7,outline:'none',
                font:'500 13px "Space Grotesk"',resize:'vertical'}}/>
          </div>
        </div>
        <div style={{display:'flex',gap:8,marginTop:18,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={btnSub(T)}>Zrušit</button>
          <button onClick={() => { onCreate({ title, note }); onClose(); }}
            style={btnPrimary(T)} disabled={!title.trim()}>Vytvořit žádost</button>
        </div>
      </div>
    </div>
  );
}

export default function Requests({ theme }) {
  const [tab, setTab] = useState('overseerr');
  const [showModal, setShowModal] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  const { data: localReqs = [] } = useQuery({
    queryKey: ['requests'],
    queryFn: () => getRequests().then(r => r.data ?? r),
  });

  const { data: overseerrData } = useQuery({
    queryKey: ['overseerr-requests', tab],
    queryFn: () => overseerrRequests(tab === 'pending' ? 'pending' : tab === 'approved' ? 'approved' : 'declined')
      .then(r => r.data?.results ?? []),
  });

  const { data: overseerrStatusData } = useQuery({
    queryKey: ['overseerr-status'],
    queryFn: () => overseerrStatus().then(r => r.data ?? r),
  });

  const createMutation = useMutation({
    mutationFn: (data) => createRequest(data),
    onSuccess: () => {
      qc.invalidateQueries(['requests']);
      toast.success('Žádost vytvořena');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateRequest(id, data),
    onSuccess: () => qc.invalidateQueries(['requests']),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteRequest(id),
    onSuccess: () => qc.invalidateQueries(['requests']),
  });

  const approveMutation = useMutation({
    mutationFn: (id) => overseerrApprove(id),
    onSuccess: () => { qc.invalidateQueries(['overseerr-requests']); toast.success('Žádost schválena'); },
    onError: () => toast.error('Chyba při schvalování'),
  });

  const declineMutation = useMutation({
    mutationFn: (id) => overseerrDecline(id),
    onSuccess: () => { qc.invalidateQueries(['overseerr-requests']); toast.success('Žádost zamítnuta'); },
    onError: () => toast.error('Chyba při zamítání'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => overseerrCancelReq(id),
    onSuccess: () => { qc.invalidateQueries(['overseerr-requests']); toast.success('Žádost zrušena'); },
  });

  // Combine local + overseerr requests
  const allReqs = localReqs;

  const counts = {
    pending:  allReqs.filter(r => r.status === 'pending').length,
    approved: allReqs.filter(r => r.status === 'approved').length,
    rejected: allReqs.filter(r => r.status === 'rejected' || r.status === 'declined').length,
  };

  const overseerrCount = overseerrData?.length || 0;

  const list = tab === 'overseerr'
    ? (overseerrData || [])
    : allReqs.filter(r => {
        if (tab === 'pending') return r.status === 'pending';
        if (tab === 'approved') return r.status === 'approved';
        if (tab === 'rejected') return r.status === 'rejected' || r.status === 'declined';
        return true;
      });

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      {showModal && (
        <NewRequestModal theme={T} onClose={() => setShowModal(false)}
          onCreate={data => createMutation.mutate(data)}/>
      )}

      <PageHeader theme={T} title="Žádosti"
        subtitle="Požadavky od uživatelů a integrace Overseerr"
        right={<>
          <button style={btnSub(T)}>⚙ Pravidla auto-schválení</button>
          <button onClick={() => setShowModal(true)} style={btnPrimary(T)}>+ Nová žádost</button>
        </>}
      />

      <div style={{flex:1,overflowY:'auto',padding:'18px 24px',display:'flex',flexDirection:'column',gap:18}}>
        {/* Stats */}
        <div style={{display:'flex',gap:10}}>
          <StatCard theme={T} label="Čeká" value={counts.pending} sub="vyžaduje schválení" accent={T.statusUpcoming}/>
          <StatCard theme={T} label="Schváleno" value={counts.approved} sub="přidáno do knihovny" accent={T.statusDone}/>
          <StatCard theme={T} label="Zamítnuto" value={counts.rejected} sub="nedostupné / mimo profil" accent={T.statusEnded}/>
          <StatCard theme={T} label="Overseerr" value={overseerrCount} sub="žádosti z Overseerr" accent={T.accent}/>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:6}}>
          <FilterPill theme={T} label="Čekající"  active={tab==='pending'}   count={counts.pending}   onClick={() => setTab('pending')}/>
          <FilterPill theme={T} label="Schválené" active={tab==='approved'}  count={counts.approved}  onClick={() => setTab('approved')}/>
          <FilterPill theme={T} label="Zamítnuté" active={tab==='rejected'}  count={counts.rejected}  onClick={() => setTab('rejected')}/>
          <FilterPill theme={T} label="Overseerr" active={tab==='overseerr'} count={overseerrCount}   onClick={() => setTab('overseerr')}/>
        </div>

        {/* Request list */}
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {list.length === 0 && (
            <div style={{padding:24,background:T.panel,border:`1px dashed ${T.border}`,
              borderRadius:10,font:'500 13px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
              Nic tu není
            </div>
          )}

          {tab === 'overseerr' && overseerrStatusData?.connected === false && (
            <div style={{padding:24,background:T.panel,border:`1px dashed ${T.border}`,borderRadius:10,textAlign:'center',color:T.textDim}}>
              Overseerr není připojen. Nastav OVERSEERR_HOST a OVERSEERR_API_KEY v Nastavení.
            </div>
          )}

          {tab === 'overseerr' ? (
            list.map((req, idx) => {
              const title = req.media?.title || req.media?.name || req.title || '—';
              const user = req.requestedBy?.displayName || req.requestedBy?.username || '—';
              const status = req.status;
              const h = strHue(title);
              const coverUrl = req.media?.posterPath ? `https://image.tmdb.org/t/p/w92${req.media.posterPath}` : null;
              const statusLabel = status === 1 ? 'Čeká' : status === 2 ? 'Schváleno' : status === 3 ? 'Zamítnuto' : status === 4 ? 'Částečně' : status === 5 ? 'Dostupné' : String(status ?? '?');
              const statusColor = status === 1 ? T.statusUpcoming : status === 2 ? T.statusDone : status === 3 ? T.statusEnded : status >= 4 ? T.accent2 : T.textDim;
              const isPending = status === 1;
              return (
                <div key={req.id || idx} style={{
                  display:'grid', gridTemplateColumns:'48px 1fr auto',
                  gap:14, padding:14, background:T.panel,
                  border:`1px solid ${T.border}`, borderRadius:10, alignItems:'flex-start',
                }}>
                  <AnimePosterSmall title={title} coverUrl={coverUrl} hue={h}/>
                  <div style={{minWidth:0,display:'flex',flexDirection:'column',gap:5}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      <div style={{font:'600 14px "Space Grotesk"',color:T.text}}>{title}</div>
                      <span style={{font:'500 10px JetBrains Mono',color:T.textMute,
                        background:T.panel2,padding:'2px 7px',borderRadius:99,
                        border:`1px solid ${T.border}`}}>Overseerr</span>
                    </div>
                    <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
                      od <span style={{color:T.text}}>@{user}</span>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',justifyContent:'flex-end'}}>
                    <StatusPill theme={T} color={statusColor} label={statusLabel} size="sm"/>
                    {isPending && <>
                      <button
                        onClick={() => declineMutation.mutate(req.id)}
                        disabled={declineMutation.isPending}
                        style={{...btnGhost(T),padding:'5px 10px',fontSize:11}}>
                        ✕ Zamítnout
                      </button>
                      <button
                        onClick={() => approveMutation.mutate(req.id)}
                        disabled={approveMutation.isPending}
                        style={{...btnPrimary(T),padding:'5px 10px',fontSize:11}}>
                        ✓ Schválit
                      </button>
                    </>}
                    {!isPending && (
                      <button
                        onClick={() => cancelMutation.mutate(req.id)}
                        disabled={cancelMutation.isPending}
                        style={{...btnGhost(T),padding:'5px 8px',fontSize:11}}>
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            list.map(req => {
              const title = req.title || req.anime_title || '—';
              const titleJp = req.title_jp || '';
              const h = strHue(title);
              return (
                <div key={req.id} style={{
                  display:'grid', gridTemplateColumns:'48px 1fr auto',
                  gap:14, padding:14, background:T.panel,
                  border:`1px solid ${T.border}`, borderRadius:10, alignItems:'flex-start',
                }}>
                  <AnimePosterSmall title={title} hue={h}/>
                  <div style={{minWidth:0,display:'flex',flexDirection:'column',gap:5}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      <div style={{font:'600 14px "Space Grotesk"',color:T.text}}>{title}</div>
                      {titleJp && <div style={{font:'500 12px "Noto Sans JP"',color:T.textDim}}>{titleJp}</div>}
                      <span style={{font:'500 10px JetBrains Mono',color:T.textMute,
                        background:T.panel2,padding:'2px 7px',borderRadius:99,
                        border:`1px solid ${T.border}`}}>{req.source || 'manuální'}</span>
                    </div>
                    <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
                      od <span style={{color:T.text}}>@{req.username || req.user || 'anon'}</span>
                      {req.created_at && <span> · {new Date(req.created_at).toLocaleDateString('cs')}</span>}
                    </div>
                    {req.note && (
                      <div style={{font:'500 12px/1.4 "Space Grotesk"',color:T.textDim,
                        background:T.panel2,border:`1px solid ${T.border}`,borderRadius:6,
                        padding:'7px 10px',marginTop:2,fontStyle:'italic'}}>
                        „{req.note}"
                      </div>
                    )}
                  </div>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    {req.status === 'pending' && <>
                      <button onClick={() => deleteMutation.mutate(req.id)}
                        style={{...btnGhost(T),padding:'6px 10px',fontSize:11}}>Zamítnout</button>
                      <button onClick={() => updateMutation.mutate({ id: req.id, data: { status: 'approved' } })}
                        style={{...btnPrimary(T),padding:'6px 12px',fontSize:11}}>✓ Schválit</button>
                    </>}
                    {req.status === 'approved' && <>
                      <StatusPill theme={T} color={T.statusDone} label="Schváleno" size="sm"/>
                      <button style={{...btnGhost(T),padding:'6px 10px',fontSize:11}}>Zobrazit</button>
                    </>}
                    {(req.status === 'rejected' || req.status === 'declined') && <>
                      <StatusPill theme={T} color={T.statusEnded} label="Zamítnuto" size="sm"/>
                      <button onClick={() => updateMutation.mutate({ id: req.id, data: { status: 'pending' } })}
                        style={{...btnGhost(T),padding:'6px 10px',fontSize:11}}>Obnovit</button>
                    </>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
