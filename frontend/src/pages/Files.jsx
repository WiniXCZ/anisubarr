import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDownloadsQueue, getDownloadsRecent, getDownloadsStats, browseFiles, getQbittorrentTorrents } from '../api/client';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, StatCard, StatusPill, Section,
} from '../v1design';
import { useIsMobile } from '../hooks/useIsMobile';

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

const QBT_COMPLETED_STATES = new Set(['seeding', 'stalledUP', 'uploading', 'complete', 'forcedUP', 'checkingUP']);

function fmtEta(seconds) {
  if (!seconds || seconds >= 8640000) return null;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function qbtStateLabel(state) {
  const m = {
    downloading:  { label: 'Stahuje se', color: T.accent },
    stalledDL:    { label: 'Stojí (↓)',  color: T.statusUpcoming },
    seeding:      { label: 'Seeduje',    color: T.accent2 },
    stalledUP:    { label: 'Stojí (↑)',  color: T.textDim },
    uploading:    { label: 'Nahrává',    color: T.accent2 },
    complete:     { label: 'Hotovo',     color: T.statusDone },
    forcedUP:     { label: 'Vynucený ↑',color: T.accent2 },
    checkingUP:   { label: 'Kontroluje', color: T.textDim },
    pausedDL:     { label: 'Pozastaveno',color: T.statusUpcoming },
    pausedUP:     { label: 'Pozastaveno',color: T.statusUpcoming },
    error:        { label: 'Chyba',      color: T.statusEnded },
    missingFiles: { label: 'Chybí soubory', color: T.statusEnded },
  };
  return m[state] || { label: state || '—', color: T.textDim };
}

function QBittorrentSection({ isMobile }) {
  const { data: rawTorrents, isLoading } = useQuery({
    queryKey: ['qbt-torrents'],
    queryFn: () => getQbittorrentTorrents().then(r => r.data ?? r),
    refetchInterval: 5000,
  });

  const torrents = Array.isArray(rawTorrents) ? rawTorrents : [];
  const active = torrents.filter(t => !QBT_COMPLETED_STATES.has(t.state));
  const done   = torrents.filter(t => QBT_COMPLETED_STATES.has(t.state));

  const totalSpeed = active.reduce((s, t) => s + (t.dlspeed || 0), 0);
  const totalSpeedStr = totalSpeed > 0
    ? `${(totalSpeed / 1024 / 1024).toFixed(1)} MB/s`
    : '—';

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      {/* Stats */}
      <div style={{display:'flex',gap:10,flexWrap: isMobile ? 'wrap' : 'nowrap'}}>
        <StatCard theme={T} label="Aktivní" value={active.length} sub={totalSpeedStr} accent={T.accent}/>
        <StatCard theme={T} label="Hotovo / seeduje" value={done.length} sub="dokončené" accent={T.statusDone}/>
        <StatCard theme={T} label="Celkem" value={torrents.length} sub="torrentů" accent={T.textDim}/>
      </div>

      {/* Active torrents */}
      <Section theme={T} title="Aktivní stahování" sub={`${active.length} torrentů · ${totalSpeedStr}`}>
        <div style={{display:'flex',flexDirection:'column',background:T.panel,
          border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
          {isLoading && (
            <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
              Načítám…
            </div>
          )}
          {!isLoading && active.length === 0 && (
            <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
              {torrents.length === 0 ? 'qBittorrent není nakonfigurován nebo je nedostupný' : 'Žádné aktivní stahování'}
            </div>
          )}
          {active.map((t, i) => {
            const st = qbtStateLabel(t.state);
            const eta = fmtEta(t.eta);
            return (
              <div key={t.name + i} style={{
                display:'grid',
                gridTemplateColumns: isMobile ? '1fr auto' : '1.8fr 100px 1.4fr 80px',
                gap: isMobile ? 8 : 12, padding:'12px 14px', alignItems:'center',
                borderBottom: i === active.length - 1 ? 'none' : `1px solid ${T.border}`,
              }}>
                <div style={{minWidth:0}}>
                  <div style={{font:'600 12.5px JetBrains Mono',color:T.text,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {t.name}
                  </div>
                  <div style={{font:'500 10px JetBrains Mono',color:T.textDim,marginTop:2,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {t.save_path}
                  </div>
                </div>
                <div><StatusPill theme={T} color={st.color} label={st.label} size="sm"/></div>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  <div style={{display:'flex',justifyContent:'space-between',font:'500 11px JetBrains Mono'}}>
                    <span style={{color:T.textDim}}>
                      {fmtBytes(t.size)}
                      {t.dlspeed_h ? ` · ${t.dlspeed_h}` : ''}
                    </span>
                    <span style={{color:T.text,fontWeight:600}}>{t.progress}%</span>
                  </div>
                  <div style={{height:5,background:T.sunken,borderRadius:99,overflow:'hidden'}}>
                    <div style={{width:`${t.progress}%`,height:'100%',background:st.color,borderRadius:99}}/>
                  </div>
                </div>
                <div style={{font:'500 11px JetBrains Mono',color:T.textDim,textAlign:'right'}}>
                  {eta ? `ETA ${eta}` : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Recently completed */}
      <Section theme={T} title="Nedávno stažené" sub="seeding / dokončené">
        <div style={{display:'flex',flexDirection:'column',background:T.panel,
          border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
          {done.length === 0 && !isLoading && (
            <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
              Žádné záznamy
            </div>
          )}
          {done.map((t, i) => {
            const st = qbtStateLabel(t.state);
            const completedDate = t.completed_on
              ? new Date(t.completed_on * 1000).toLocaleDateString('cs')
              : '—';
            return (
              <div key={t.name + i} style={{
                display:'grid',
                gridTemplateColumns: isMobile ? '1fr auto' : '1.8fr 100px 1fr 100px',
                gap: isMobile ? 8 : 12, padding:'10px 14px', alignItems:'center',
                borderBottom: i === done.length - 1 ? 'none' : `1px solid ${T.border}`,
              }}>
                <div style={{minWidth:0}}>
                  <div style={{font:'600 12px "Space Grotesk"',color:T.text,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {t.name}
                  </div>
                  <div style={{font:'500 10px JetBrains Mono',color:T.textDim,marginTop:2,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {t.save_path}
                  </div>
                </div>
                <div><StatusPill theme={T} color={st.color} label={st.label} size="sm"/></div>
                <div style={{font:'500 11px JetBrains Mono',color:T.textDim,
                  whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                  {fmtBytes(t.size)}
                </div>
                <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
                  {completedDate}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

export default function Files({ theme }) {
  const [browserPath, setBrowserPath] = useState('');
  const [activeTab, setActiveTab] = useState('files');
  const isMobile = useIsMobile();

  const { data: fileData, isLoading: fileLoading } = useQuery({
    queryKey: ['files-browse', browserPath],
    queryFn: () => browseFiles(browserPath).then(r => r.data ?? r),
  });

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

  const TABS = [
    { id: 'files',     label: 'Soubory' },
    { id: 'downloads', label: 'Stahování' },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={T} title="Soubory"
        subtitle="Fronta stahování · knihovna na disku · karanténa"
        right={null}
      />
      {/* Tab bar */}
      <div style={{
        display:'flex', gap:2, padding: isMobile ? '0 10px 0' : '0 24px 0',
        borderBottom:`1px solid ${T.border}`, flexShrink:0,
      }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            background:'none', border:'none', cursor:'pointer',
            padding:'10px 14px',
            font:`600 12px "Space Grotesk"`,
            color: activeTab === tab.id ? T.accent : T.textDim,
            borderBottom: activeTab === tab.id ? `2px solid ${T.accent}` : '2px solid transparent',
            marginBottom:-1,
            transition:'color 0.15s',
          }}>{tab.label}</button>
        ))}
      </div>

      <div style={{flex:1,overflowY:'auto',WebkitOverflowScrolling:'touch',padding: isMobile ? '12px 10px' : '18px 24px',display:'flex',flexDirection:'column',gap:18}}>
        {activeTab === 'downloads' && <QBittorrentSection isMobile={isMobile}/>}
        {activeTab === 'files' && <>
        {/* Stats — Sonarr/Radarr downloads */}
        <div style={{display:'flex',gap:10,flexWrap: isMobile ? 'wrap' : 'nowrap'}}>
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
                  display:'grid',
                  gridTemplateColumns: isMobile ? '1fr auto' : '1.6fr 90px 1.2fr 100px 80px 90px',
                  gap: isMobile ? 8 : 12, padding:'12px 14px', alignItems:'center',
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
                  <div/>
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
                display:'grid',
                gridTemplateColumns: isMobile ? '1fr auto' : '1.6fr 100px 130px 180px auto',
                gap: isMobile ? 8 : 12, padding:'10px 14px', alignItems:'center',
                borderBottom:i === recent.length-1 ? 'none' : `1px solid ${T.border}`,
              }}>
                <div style={{minWidth:0,color:T.text}}>
                  <div style={{font:'600 12.5px "Space Grotesk"',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {f.series_title || f.title || f.name || '—'}
                  </div>
                  {(f.season != null && f.episode != null) && (
                    <div style={{font:'500 10px JetBrains Mono',color:T.textDim}}>
                      S{String(f.season).padStart(2,'0')}E{String(f.episode).padStart(2,'0')}
                      {f.file ? ` · ${f.file}` : ''}
                    </div>
                  )}
                </div>
                <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
                  {f.size || (f.size_bytes ? (f.size_bytes/1e6).toFixed(0)+' MB' : '—')}
                </div>
                <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
                  {f.date_added ? new Date(f.date_added).toLocaleDateString('cs') : '—'}
                </div>
                <div style={{display:'flex',gap:5}}>
                  <StatusPill theme={T} color={T.statusDone} label="✓ Hotovo" size="sm"/>
                  {f.subs && f.subs !== '—' && (
                    <StatusPill theme={T} color={T.accent2} label={`titulky: ${f.subs}`} size="sm"/>
                  )}
                </div>
                <div/>
              </div>
            ))}
          </div>
        </Section>

        <Section theme={T} title="Prohlížeč souborů" sub={fileData?.path || 'kořenový adresář'}>
          {fileData?.parent && (
            <button onClick={() => setBrowserPath(fileData.parent)} style={{...btnGhost(T), marginBottom:8, fontSize:11}}>
              ← Zpět ({fileData.parent.split(/[\\/]/).slice(-1)[0] || '/'})
            </button>
          )}
          <div style={{display:'flex',flexDirection:'column',background:T.panel,
            border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
            {fileLoading && (
              <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
                Načítám…
              </div>
            )}
            {fileData?.error && (
              <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
                {fileData.error}
              </div>
            )}
            {(fileData?.entries || []).map((entry, i) => {
              const isLast = i === (fileData.entries.length - 1);
              const icon = entry.is_dir ? '📁' : entry.kind === 'video' ? '🎬' : entry.kind === 'subtitle' ? '💬' : '📄';
              const kindColor = entry.kind === 'video' ? T.accent : entry.kind === 'subtitle' ? T.accent2 : T.textDim;
              return (
                <div key={entry.path} onClick={() => entry.is_dir && setBrowserPath(entry.path)}
                  style={{
                    display:'grid', gridTemplateColumns: isMobile ? '24px 1fr auto' : '24px 1fr 80px 130px 80px',
                    gap:12, padding:'9px 14px', alignItems:'center',
                    cursor: entry.is_dir ? 'pointer' : 'default',
                    borderBottom: isLast ? 'none' : `1px solid ${T.border}`,
                    background: 'transparent',
                  }}>
                  <span style={{fontSize:14}}>{icon}</span>
                  <div style={{minWidth:0,font:'600 12px JetBrains Mono',color:T.text,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{entry.name}</div>
                  <div style={{font:'500 10px JetBrains Mono',color:kindColor}}>{entry.is_dir ? 'složka' : entry.kind}</div>
                  <div style={{font:'500 10px JetBrains Mono',color:T.textDim}}>{entry.size_h || '—'}</div>
                  <div style={{font:'500 10px JetBrains Mono',color:T.textMute}}>
                    {entry.mtime ? new Date(entry.mtime * 1000).toLocaleDateString('cs') : ''}
                  </div>
                </div>
              );
            })}
            {!fileLoading && !fileData?.error && (fileData?.entries || []).length === 0 && (
              <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
                Prázdný adresář
              </div>
            )}
          </div>
        </Section>
        </>}
      </div>
    </div>
  );
}
