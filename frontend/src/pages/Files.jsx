import { useQuery } from '@tanstack/react-query';
import { getDownloadsQueue, getDownloadsRecent, getDownloadsStats } from '../api/client';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, StatCard, StatusPill, Section,
} from '../v1design';

const T = THEME;

function fmtBytes(bytes) {
  if (!bytes) return '—';
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1e6;
  return `${mb.toFixed(0)} MB`;
}

function stateStyle(state) {
  const m = {
    downloading: { color: T.accent,         label: 'Stahuje se',  icon: '↓' },
    seeding:     { color: T.accent2,        label: 'Seeduje',     icon: '↑' },
    completed:   { color: T.statusDone,     label: 'Hotovo',      icon: '✓' },
    queued:      { color: T.textDim,        label: 'Ve frontě',   icon: '◷' },
    paused:      { color: T.statusUpcoming, label: 'Pozastaveno', icon: '‖' },
    error:       { color: T.statusEnded,    label: 'Chyba',       icon: '✕' },
  };
  return m[state] || { color: T.textDim, label: state || '—', icon: '?' };
}

export default function Files({ theme }) {
  const { data: rawQueue } = useQuery({
    queryKey: ['downloads-queue'],
    queryFn: () => getDownloadsQueue().then(r => r.data ?? r),
    refetchInterval: 5000,
  });

  const { data: rawRecent } = useQuery({
    queryKey: ['downloads-recent'],
    queryFn: () => getDownloadsRecent(7).then(r => r.data ?? r),
  });

  const { data: rawStats } = useQuery({
    queryKey: ['downloads-stats'],
    queryFn: () => getDownloadsStats().then(r => r.data ?? r),
  });

  const queue = Array.isArray(rawQueue) ? rawQueue : (rawQueue?.items || rawQueue?.queue || []);
  const recent = Array.isArray(rawRecent) ? rawRecent : (rawRecent?.items || rawRecent?.records || []);
  const stats = rawStats || {};

  const downloading = queue.filter(q => q.state === 'downloading' || q.state === 'seeding');
  const inQueue = queue.filter(q => q.state === 'queued');
  const totalSpeed = downloading.reduce((s, q) => s + (parseFloat(q.speed) || 0), 0);
  const totalSpeedStr = totalSpeed > 0 ? `${totalSpeed.toFixed(1)} MB/s` : '—';

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={T} title="Soubory"
        subtitle="Fronta stahování · knihovna na disku · karanténa"
        right={<>
          <button style={btnSub(T)}>‖ Pozastavit vše</button>
          <button style={btnSub(T)}>⟲ Obnovit klienty</button>
          <button style={btnPrimary(T)}>+ Přidat torrent / NZB</button>
        </>}
      />

      <div style={{flex:1,overflowY:'auto',padding:'18px 24px',display:'flex',flexDirection:'column',gap:18}}>
        {/* Stats */}
        <div style={{display:'flex',gap:10}}>
          <StatCard theme={T} label="Stahuje se" value={downloading.length} sub={`${totalSpeedStr} · ↑ —`} accent={T.accent}/>
          <StatCard theme={T} label="Ve frontě" value={inQueue.length} sub="čeká na slot" accent={T.accent2}/>
          <StatCard theme={T} label="Hotovo (dnes)" value={recent.filter(r => {
            const d = r.downloaded_at || r.when || '';
            return d.startsWith(new Date().toISOString().slice(0, 10));
          }).length} sub={`∑ ${fmtBytes(recent.reduce((s, r) => s + (r.size_bytes || 0), 0))}`} accent={T.statusDone}/>
          <StatCard theme={T} label="Karanténa" value={stats.quarantine_count ?? 0} sub="vše čisté" accent={T.statusDone}/>
          <StatCard theme={T} label="Disk" value={stats.disk_used ? `${stats.disk_used} / ${stats.disk_total || '?'}` : '—'} sub={stats.disk_pct ? `${stats.disk_pct}%` : 'GB · —'} accent={T.accent}/>
        </div>

        {/* Active downloads */}
        <Section theme={T} title="Aktivní stahování"
          sub={`${queue.length} úloh${stats.client ? ` · klient ${stats.client}` : ''}`}>
          <div style={{display:'flex',flexDirection:'column',background:T.panel,
            border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
            {queue.length === 0 && (
              <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
                Fronta je prázdná
              </div>
            )}
            {queue.map((f, i) => {
              const sm = stateStyle(f.state);
              const progress = f.progress ?? 0;
              return (
                <div key={f.id || i} style={{
                  display:'grid', gridTemplateColumns:'1.6fr 90px 1.2fr 100px 80px 90px',
                  gap:12, padding:'12px 14px', alignItems:'center',
                  borderBottom:i === queue.length-1 ? 'none' : `1px solid ${T.border}`,
                }}>
                  <div style={{minWidth:0}}>
                    <div style={{font:'600 12.5px JetBrains Mono',color:T.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {f.title || f.name || '—'}
                    </div>
                    <div style={{font:'500 11px "Space Grotesk"',color:T.textDim,marginTop:2}}>
                      {f.series_title || f.series || ''}
                      {f.season_number ? ` · S${f.season_number}` : ''}
                    </div>
                  </div>
                  <div><StatusPill theme={T} color={sm.color} label={`${sm.icon} ${sm.label}`} size="sm"/></div>
                  <div style={{display:'flex',flexDirection:'column',gap:4}}>
                    <div style={{display:'flex',justifyContent:'space-between',font:'500 11px JetBrains Mono'}}>
                      <span style={{color:T.textDim}}>
                        {f.size || fmtBytes(f.size_bytes)}
                        {f.speed ? ` · ${f.speed}` : ''}
                      </span>
                      <span style={{color:T.text,fontWeight:600}}>{progress}%</span>
                    </div>
                    <div style={{height:5,background:T.sunken,borderRadius:99,overflow:'hidden'}}>
                      <div style={{width:`${progress}%`,height:'100%',background:sm.color,borderRadius:99}}/>
                    </div>
                  </div>
                  <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
                    {f.eta ? `ETA ${f.eta}` : '—'}
                  </div>
                  <div style={{font:'500 10px JetBrains Mono',color:T.textMute}}>{f.client || '—'}</div>
                  <div style={{display:'flex',gap:4,justifyContent:'flex-end'}}>
                    <button style={{...btnGhost(T),padding:'4px 7px',fontSize:11}}>‖</button>
                    <button style={{...btnGhost(T),padding:'4px 7px',fontSize:11}}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Recently done */}
        <Section theme={T} title="Nedávno hotové" sub="poslední 7 dní">
          <div style={{display:'flex',flexDirection:'column',background:T.panel,
            border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
            {recent.length === 0 && (
              <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
                Žádné záznamy
              </div>
            )}
            {recent.map((f, i) => (
              <div key={f.id || i} style={{
                display:'grid', gridTemplateColumns:'1.6fr 100px 130px 180px auto',
                gap:12, padding:'10px 14px', alignItems:'center',
                borderBottom:i === recent.length-1 ? 'none' : `1px solid ${T.border}`,
              }}>
                <div style={{minWidth:0,font:'600 12.5px JetBrains Mono',color:T.text,
                  whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                  {f.title || f.name || '—'}
                </div>
                <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
                  {f.size || fmtBytes(f.size_bytes)}
                </div>
                <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
                  {f.when || (f.downloaded_at ? new Date(f.downloaded_at).toLocaleDateString('cs') : '—')}
                </div>
                <div style={{display:'flex',gap:5}}>
                  <StatusPill theme={T} color={T.statusDone} label="✓ Hotovo" size="sm"/>
                  {(f.cs_subs || f.subtitle_languages) && (
                    <StatusPill theme={T} color={T.accent2}
                      label={`titulky: ${f.cs_subs || f.subtitle_languages}`} size="sm"/>
                  )}
                </div>
                <div style={{display:'flex',gap:5,justifyContent:'flex-end'}}>
                  <button style={{...btnGhost(T),padding:'4px 8px',fontSize:11}}>Přehrát</button>
                  <button style={{...btnGhost(T),padding:'4px 8px',fontSize:11}}>⋯</button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
