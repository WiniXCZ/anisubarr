import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getSeries, getDownloadsQueue, getDownloadsRecent } from '../api/client';
import api from '../api/client';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, StatCard, StatusPill, AnimePoster,
  statusMeta, strHue,
} from '../v1design';

const T = THEME;
const getCalWeek = () => {
  const now = new Date();
  const start = now.toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  return api.get(`/calendar?start=${start}&end=${end}`).then(r => r.data);
};

const DAY_NAMES = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
const SHORT_DAYS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
const CZ_MONTHS = ['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];

function fmtDate(iso) {
  const d = new Date(iso);
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()}. ${CZ_MONTHS[d.getMonth()]}`;
}

function stateMeta(theme, state) {
  const m = {
    downloading: { color:theme.accent,         label:'Stahuje se',   icon:'↓' },
    seeding:     { color:theme.accent2,        label:'Seeduje',      icon:'↑' },
    completed:   { color:theme.statusDone,     label:'Hotovo',       icon:'✓' },
    ready:       { color:theme.statusDone,     label:'Připraveno',   icon:'✓' },
    queued:      { color:theme.textDim,        label:'Ve frontě',    icon:'◷' },
    paused:      { color:theme.statusUpcoming, label:'Pozastaveno',  icon:'‖' },
    scheduled:   { color:theme.textDim,        label:'Plánováno',    icon:'◷' },
    error:       { color:theme.statusEnded,    label:'Chyba',        icon:'✕' },
  };
  return m[state] || m.scheduled;
}

export default function Schedule({ theme }) {
  const navigate = useNavigate();

  const { data: queue = [] } = useQuery({
    queryKey: ['downloads-queue'],
    queryFn: () => getDownloadsQueue().then(r => r.data ?? r),
    refetchInterval: 5000,
  });

  const { data: recent = [] } = useQuery({
    queryKey: ['downloads-recent'],
    queryFn: () => getDownloadsRecent(7).then(r => r.data ?? r),
  });

  const { data: calItems = [] } = useQuery({
    queryKey: ['cal-week'],
    queryFn: getCalWeek,
  });

  const { data: seriesList = [] } = useQuery({
    queryKey: ['series'],
    queryFn: () => getSeries().then(r => r.data),
  });

  // Group calendar items by date
  const byDate = {};
  for (const item of calItems) {
    const d = item.air_date?.slice(0, 10) || item.date?.slice(0, 10);
    if (!d) continue;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(item);
  }

  // Build week days
  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

  const downloading = queue.filter(q => ['downloading','seeding'].includes(q.state) || q.progress < 100);
  const totalSpeed = downloading.reduce((s, q) => s + (parseFloat(q.speed) || 0), 0);

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={T} title="Harmonogram"
        subtitle="Sledované série · příští epizody · stav stahování"
        right={<>
          <button style={btnSub(T)}>⟲ Obnovit indexery</button>
          <button style={btnSub(T)}>⚙ Pravidla</button>
        </>}
      />

      <div style={{flex:1,overflowY:'auto',padding:'18px 24px',display:'flex',flexDirection:'column',gap:18}}>
        {/* Stats */}
        <div style={{display:'flex',gap:10}}>
          <StatCard theme={T} label="Stahuje se" value={downloading.length || '0'} sub={totalSpeed > 0 ? `${totalSpeed.toFixed(1)} MB/s` : 'žádné aktivní'} accent={T.accent}/>
          <StatCard theme={T} label="Ve frontě" value={queue.filter(q => q.state === 'queued').length} sub="čeká na slot" accent={T.accent2}/>
          <StatCard theme={T} label="Hotovo (7 dní)" value={recent.length} sub={`${recent.reduce((s, r) => s + (r.size_bytes || 0), 0) > 0 ? (recent.reduce((s, r) => s + (r.size_bytes || 0), 0) / 1e9).toFixed(1) + ' GB' : '—'}`} accent={T.statusDone}/>
          <StatCard theme={T} label="Vysílá se" value={seriesList.filter(s => s.status === 'RELEASING' || s.status === 'Continuing').length} sub="aktivní série" accent={T.statusAiring}/>
        </div>

        {/* Active downloads */}
        {queue.length > 0 && (
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',alignItems:'baseline',gap:10}}>
              <div style={{font:'700 16px "Space Grotesk"',color:T.text}}>Aktivní stahování</div>
              <div style={{font:'500 12px JetBrains Mono',color:T.textMute}}>{queue.length} úloh</div>
              <div style={{flex:1,height:1,background:T.border,marginLeft:6}}/>
            </div>
            <div style={{display:'flex',flexDirection:'column',background:T.panel,
              border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
              {queue.map((f, i) => {
                const sm = stateMeta(T, f.state);
                const progress = f.progress ?? 0;
                return (
                  <div key={f.id || i} style={{
                    display:'grid', gridTemplateColumns:'1.6fr 90px 1.2fr 100px 80px 90px',
                    gap:12, padding:'12px 14px', alignItems:'center',
                    borderBottom:i === queue.length-1 ? 'none' : `1px solid ${T.border}`,
                  }}>
                    <div style={{minWidth:0}}>
                      <div style={{font:'600 12.5px JetBrains Mono',color:T.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.title || f.name || '—'}</div>
                      <div style={{font:'500 11px "Space Grotesk"',color:T.textDim,marginTop:2}}>
                        {f.series_title || f.series || ''}
                      </div>
                    </div>
                    <div><StatusPill theme={T} color={sm.color} label={`${sm.icon} ${sm.label}`} size="sm"/></div>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      <div style={{display:'flex',justifyContent:'space-between',font:'500 11px JetBrains Mono'}}>
                        <span style={{color:T.textDim}}>{f.size || ''}{f.speed ? ` · ${f.speed}` : ''}</span>
                        <span style={{color:T.text,fontWeight:600}}>{progress}%</span>
                      </div>
                      <div style={{height:5,background:T.sunken,borderRadius:99,overflow:'hidden'}}>
                        <div style={{width:`${progress}%`,height:'100%',background:sm.color,borderRadius:99}}/>
                      </div>
                    </div>
                    <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
                      {f.eta ? `ETA ${f.eta}` : '—'}
                    </div>
                    <div style={{font:'500 10px JetBrains Mono',color:T.textMute}}>{f.client || ''}</div>
                    <div style={{display:'flex',gap:4,justifyContent:'flex-end'}}>
                      <button style={{...btnGhost(T),padding:'4px 7px',fontSize:11}}>‖</button>
                      <button style={{...btnGhost(T),padding:'4px 7px',fontSize:11}}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* This week */}
        {weekDays.map(dateStr => {
          const items = byDate[dateStr] || [];
          const d = new Date(dateStr);
          const isToday = dateStr === today.toISOString().slice(0, 10);
          const label = isToday ? 'Dnes' : DAY_NAMES[d.getDay()];

          if (!isToday && items.length === 0) return null;
          return (
            <div key={dateStr} style={{display:'flex',flexDirection:'column',gap:8}}>
              <div style={{display:'flex',alignItems:'baseline',gap:10}}>
                <div style={{font:'700 16px "Space Grotesk"',color:T.text}}>{label}</div>
                <div style={{font:'500 12px JetBrains Mono',color:T.textMute}}>{fmtDate(dateStr)}</div>
                <div style={{flex:1,height:1,background:T.border,marginLeft:6}}/>
                <div style={{font:'500 11px JetBrains Mono',color:T.textMute}}>{items.length} epizod</div>
              </div>

              {items.length === 0 ? (
                <div style={{padding:'18px 16px',background:T.panel,border:`1px dashed ${T.border}`,
                  borderRadius:10,font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
                  Žádné epizody
                </div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {items.map((it, j) => {
                    const s = seriesList.find(x => x.id === (it.series_id || it.seriesId)) || {};
                    const hue = strHue(s.title || it.series_title || '');
                    return (
                      <div key={j} style={{
                        display:'grid', gridTemplateColumns:'1fr auto auto',
                        gap:14, alignItems:'center', padding:'12px 14px',
                        background:T.panel, border:`1px solid ${T.border}`, borderRadius:10,
                      }}>
                        <div style={{minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div style={{font:'600 13px "Space Grotesk"',color:T.text}}>
                              {it.series_title || s.title_romaji || s.title || '—'}
                            </div>
                            <div style={{font:'500 11px JetBrains Mono',color:T.accent}}>
                              EP {String(it.episode_number || it.episodeNumber || 0).padStart(2,'0')}
                            </div>
                            {it.title && <div style={{font:'500 11px "Space Grotesk"',color:T.textDim}}>· {it.title}</div>}
                          </div>
                          {it.air_time && (
                            <div style={{font:'500 11px JetBrains Mono',color:T.textDim,marginTop:2}}>{it.air_time}</div>
                          )}
                        </div>
                        <div style={{display:'flex',gap:5}}>
                          <button style={{...btnGhost(T),padding:'4px 8px',fontSize:11}}>Otevřít</button>
                          <button style={{...btnGhost(T),padding:'4px 8px',fontSize:11}}>Titulky</button>
                        </div>
                        <button style={{...btnGhost(T),padding:'4px 7px',fontSize:14}}>⋯</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Recent downloads */}
        {recent.length > 0 && (
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',alignItems:'baseline',gap:10}}>
              <div style={{font:'700 16px "Space Grotesk"',color:T.text}}>Nedávno hotové</div>
              <div style={{font:'500 12px JetBrains Mono',color:T.textMute}}>posledních 7 dní</div>
              <div style={{flex:1,height:1,background:T.border,marginLeft:6}}/>
            </div>
            <div style={{display:'flex',flexDirection:'column',background:T.panel,
              border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
              {recent.slice(0, 10).map((f, i) => (
                <div key={f.id || i} style={{
                  display:'grid', gridTemplateColumns:'1.6fr 100px 130px 180px auto',
                  gap:12, padding:'10px 14px', alignItems:'center',
                  borderBottom:i === Math.min(recent.length, 10)-1 ? 'none' : `1px solid ${T.border}`,
                }}>
                  <div style={{minWidth:0,font:'600 12.5px JetBrains Mono',color:T.text,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {f.title || f.name || '—'}
                  </div>
                  <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
                    {f.size_bytes ? `${(f.size_bytes/1e9).toFixed(1)} GB` : f.size || '—'}
                  </div>
                  <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>{f.when || f.downloaded_at || '—'}</div>
                  <div>
                    <StatusPill theme={T} color={T.statusDone} label="✓ Hotovo" size="sm"/>
                  </div>
                  <div style={{display:'flex',gap:5,justifyContent:'flex-end'}}>
                    <button style={{...btnGhost(T),padding:'4px 8px',fontSize:11}}>⋯</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {queue.length === 0 && calItems.length === 0 && recent.length === 0 && (
          <div style={{padding:40,textAlign:'center',color:T.textMute,font:'500 13px "Space Grotesk"'}}>
            Žádná aktivita tento týden
          </div>
        )}
      </div>
    </div>
  );
}
