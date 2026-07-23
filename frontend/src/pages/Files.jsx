import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDownloadsQueue, getDownloadsRecent, getDownloadsStats, browseFiles, getQbittorrentTorrents } from '../api/client';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, StatCard, StatusPill, Section,
} from '../v1design';
import { useIsMobile } from '../hooks/useIsMobile';
import { useT, useLang } from '../i18n/I18nContext';

const T = THEME;

function fmtBytes(bytes) {
  if (!bytes) return '—';
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1e6;
  return `${mb.toFixed(0)} MB`;
}

function stateStyle(state, t) {
  const m = {
    downloading: { color: T.accent,         label: t('files_state_downloading'), icon: '↓' },
    seeding:     { color: T.accent2,        label: t('files_state_seeding'),     icon: '↑' },
    completed:   { color: T.statusDone,     label: t('files_state_completed'),   icon: '✓' },
    queued:      { color: T.textDim,        label: t('files_state_queued'),      icon: '◷' },
    paused:      { color: T.statusUpcoming, label: t('files_state_paused'),      icon: '‖' },
    error:       { color: T.statusEnded,    label: t('files_state_error'),       icon: '✕' },
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

function qbtStateLabel(state, t) {
  const m = {
    downloading:  { label: t('files_state_downloading'),   color: T.accent },
    stalledDL:    { label: t('files_state_stalled_dl'),    color: T.statusUpcoming },
    seeding:      { label: t('files_state_seeding'),       color: T.accent2 },
    stalledUP:    { label: t('files_state_stalled_up'),    color: T.textDim },
    uploading:    { label: t('files_state_uploading'),     color: T.accent2 },
    complete:     { label: t('files_state_completed'),     color: T.statusDone },
    forcedUP:     { label: t('files_state_forced_up'),     color: T.accent2 },
    checkingUP:   { label: t('files_state_checking'),      color: T.textDim },
    pausedDL:     { label: t('files_state_paused'),        color: T.statusUpcoming },
    pausedUP:     { label: t('files_state_paused'),        color: T.statusUpcoming },
    error:        { label: t('files_state_error'),         color: T.statusEnded },
    missingFiles: { label: t('files_state_missing_files'), color: T.statusEnded },
  };
  return m[state] || { label: state || '—', color: T.textDim };
}

function QBittorrentSection({ isMobile }) {
  const { t, lang } = useLang();
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
        <StatCard theme={T} label={t('files_qbt_active')} value={active.length} sub={totalSpeedStr} accent={T.accent}/>
        <StatCard theme={T} label={t('files_qbt_done_seeding')} value={done.length} sub={t('files_qbt_done_sub')} accent={T.statusDone}/>
        <StatCard theme={T} label={t('files_qbt_total')} value={torrents.length} sub={t('files_qbt_total_sub')} accent={T.textDim}/>
      </div>

      {/* Active torrents */}
      <Section theme={T} title={t('files_active_downloads')} sub={`${active.length} ${t('files_jobs_suffix')} · ${totalSpeedStr}`}>
        <div style={{display:'flex',flexDirection:'column',background:T.panel,
          border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
          {isLoading && (
            <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
              {t('common_loading')}
            </div>
          )}
          {!isLoading && active.length === 0 && (
            <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
              {torrents.length === 0 ? t('files_qbt_not_configured') : t('files_qbt_no_active')}
            </div>
          )}
          {active.map((tr, i) => {
            const st = qbtStateLabel(tr.state, t);
            const eta = fmtEta(tr.eta);
            return (
              <div key={tr.name + i} style={{
                display:'grid',
                gridTemplateColumns: isMobile ? '1fr auto' : '1.8fr 100px 1.4fr 80px',
                gap: isMobile ? 8 : 12, padding:'12px 14px', alignItems:'center',
                borderBottom: i === active.length - 1 ? 'none' : `1px solid ${T.border}`,
              }}>
                <div style={{minWidth:0}}>
                  <div style={{font:'600 12.5px JetBrains Mono',color:T.text,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {tr.name}
                  </div>
                  <div style={{font:'500 10px JetBrains Mono',color:T.textDim,marginTop:2,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {tr.save_path}
                  </div>
                </div>
                <div><StatusPill theme={T} color={st.color} label={st.label} size="sm"/></div>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  <div style={{display:'flex',justifyContent:'space-between',font:'500 11px JetBrains Mono'}}>
                    <span style={{color:T.textDim}}>
                      {fmtBytes(tr.size)}
                      {tr.dlspeed_h ? ` · ${tr.dlspeed_h}` : ''}
                    </span>
                    <span style={{color:T.text,fontWeight:600}}>{tr.progress}%</span>
                  </div>
                  <div style={{height:5,background:T.sunken,borderRadius:99,overflow:'hidden'}}>
                    <div style={{width:`${tr.progress}%`,height:'100%',background:st.color,borderRadius:99}}/>
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
      <Section theme={T} title={t('files_recently_downloaded')} sub={t('files_recently_downloaded_sub')}>
        <div style={{display:'flex',flexDirection:'column',background:T.panel,
          border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
          {done.length === 0 && !isLoading && (
            <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
              {t('files_no_records')}
            </div>
          )}
          {done.map((tr, i) => {
            const st = qbtStateLabel(tr.state, t);
            const completedDate = tr.completed_on
              ? new Date(tr.completed_on * 1000).toLocaleDateString(lang)
              : '—';
            return (
              <div key={tr.name + i} style={{
                display:'grid',
                gridTemplateColumns: isMobile ? '1fr auto' : '1.8fr 100px 1fr 100px',
                gap: isMobile ? 8 : 12, padding:'10px 14px', alignItems:'center',
                borderBottom: i === done.length - 1 ? 'none' : `1px solid ${T.border}`,
              }}>
                <div style={{minWidth:0}}>
                  <div style={{font:'600 12px "Space Grotesk"',color:T.text,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {tr.name}
                  </div>
                  <div style={{font:'500 10px JetBrains Mono',color:T.textDim,marginTop:2,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {tr.save_path}
                  </div>
                </div>
                <div><StatusPill theme={T} color={st.color} label={st.label} size="sm"/></div>
                <div style={{font:'500 11px JetBrains Mono',color:T.textDim,
                  whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                  {fmtBytes(tr.size)}
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
  const { t, lang } = useLang();
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
    { id: 'files',     label: t('files_tab_files') },
    { id: 'downloads', label: t('files_tab_downloads') },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={T} title={t('files_title')}
        subtitle={t('files_subtitle')}
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
          <StatCard theme={T} label={t('files_state_downloading')} value={downloading.length} sub={`${totalSpeedStr} · ↑ —`} accent={T.accent}/>
          <StatCard theme={T} label={t('files_state_queued')} value={inQueue.length} sub={t('files_stat_queued_sub')} accent={T.accent2}/>
          <StatCard theme={T} label={t('files_stat_done_today')} value={recent.filter(r => {
            const d = r.downloaded_at || r.when || '';
            return d.startsWith(new Date().toISOString().slice(0, 10));
          }).length} sub={`∑ ${fmtBytes(recent.reduce((s, r) => s + (r.size_bytes || 0), 0))}`} accent={T.statusDone}/>
          <StatCard theme={T} label={t('files_stat_quarantine')} value={stats.quarantine_count ?? 0} sub={t('files_stat_quarantine_sub')} accent={T.statusDone}/>
          <StatCard theme={T} label={t('files_stat_disk')} value={stats.disk_used ? `${stats.disk_used} / ${stats.disk_total || '?'}` : '—'} sub={stats.disk_pct ? `${stats.disk_pct}%` : 'GB · —'} accent={T.accent}/>
        </div>

        {/* Active downloads */}
        <Section theme={T} title={t('files_active_downloads')}
          sub={`${queue.length} ${t('files_jobs_suffix')}${stats.client ? ` · ${t('files_client_prefix')} ${stats.client}` : ''}`}>
          <div style={{display:'flex',flexDirection:'column',background:T.panel,
            border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
            {queue.length === 0 && (
              <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
                {t('files_queue_empty')}
              </div>
            )}
            {queue.map((f, i) => {
              const sm = stateStyle(f.state, t);
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
        <Section theme={T} title={t('files_recently_done')} sub={t('files_recently_done_sub')}>
          <div style={{display:'flex',flexDirection:'column',background:T.panel,
            border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
            {recent.length === 0 && (
              <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
                {t('files_no_records')}
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
                  {f.date_added ? new Date(f.date_added).toLocaleDateString(lang) : '—'}
                </div>
                <div style={{display:'flex',gap:5}}>
                  <StatusPill theme={T} color={T.statusDone} label={t('files_done_label')} size="sm"/>
                  {f.subs && f.subs !== '—' && (
                    <StatusPill theme={T} color={T.accent2} label={`${t('files_subs_label')}: ${f.subs}`} size="sm"/>
                  )}
                </div>
                <div/>
              </div>
            ))}
          </div>
        </Section>

        <Section theme={T} title={t('files_browser_title')} sub={fileData?.path || t('files_browser_root')}>
          {fileData?.parent && (
            <button onClick={() => setBrowserPath(fileData.parent)} style={{...btnGhost(T), marginBottom:8, fontSize:11}}>
              {t('files_back')} ({fileData.parent.split(/[\\/]/).slice(-1)[0] || '/'})
            </button>
          )}
          <div style={{display:'flex',flexDirection:'column',background:T.panel,
            border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
            {fileLoading && (
              <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
                {t('common_loading')}
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
                  <div style={{font:'500 10px JetBrains Mono',color:kindColor}}>{entry.is_dir ? t('files_folder') : entry.kind}</div>
                  <div style={{font:'500 10px JetBrains Mono',color:T.textDim}}>{entry.size_h || '—'}</div>
                  <div style={{font:'500 10px JetBrains Mono',color:T.textMute}}>
                    {entry.mtime ? new Date(entry.mtime * 1000).toLocaleDateString(lang) : ''}
                  </div>
                </div>
              );
            })}
            {!fileLoading && !fileData?.error && (fileData?.entries || []).length === 0 && (
              <div style={{padding:'18px 16px',font:'500 12px "Space Grotesk"',color:T.textMute,textAlign:'center'}}>
                {t('files_empty_dir')}
              </div>
            )}
          </div>
        </Section>
        </>}
      </div>
    </div>
  );
}
