import { useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSeriesById, translateSeries, downloadAllSubtitles, setWatchStatus,
  searchSubtitles, downloadBest, deleteSubsByEpisodes,
} from '../api/client';
import api from '../api/client';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  StatusPill, AnimePoster, FilterPill, StatCard,
  statusMeta, statusColor, strHue,
} from '../v1design';

const T = THEME;
const getEpisodes = (id) => api.get(`/series/${id}/episodes`).then(r => r.data);

const ICONS = {
  back: <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,
};
const NavIcon = ({ d, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

function epSubState(ep) {
  if (ep.has_cs_sub) return 'cs-only';
  return 'none';
}

const SUB_STATE_META = {
  both:     { colorKey:'statusDone',     icon:'✓', label:'JP + CS' },
  'cs-only':{ colorKey:'statusDone',     icon:'✓', label:'CS' },
  jp:       { colorKey:'statusUpcoming', icon:'!', label:'jen JP' },
  none:     { colorKey:'statusEnded',    icon:'×', label:'chybí' },
};

function EpisodeRow({ ep, series, last, selected, onSelect, onOpenSubs, isMobile }) {
  const subSt = epSubState(ep);
  const sm = SUB_STATE_META[subSt] || SUB_STATE_META.none;
  const subColor = T[sm.colorKey];
  const hue = strHue(series.title || '');
  const sizeGB = ep.file_size ? (ep.file_size / 1e9).toFixed(1) : null;

  if (isMobile) {
    return (
      <div style={{
        display:'flex', gap:10, alignItems:'center', padding:'10px 12px',
        borderBottom:last ? 'none' : `1px solid ${T.border}`,
        background: selected ? `${T.accent}11` : ep.watched ? 'transparent' : T.panel2,
      }}>
        <div
          style={{ width:16, height:16, borderRadius:3, flexShrink:0,
            background: selected ? T.accent : 'transparent',
            border:`2px solid ${selected ? T.accent : T.borderStrong}`,
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}
          onClick={e => { e.stopPropagation(); onSelect && onSelect(); }}
        >
          {selected && <span style={{ color:'#fff', fontSize:9, lineHeight:1 }}>✓</span>}
        </div>
        <span style={{font:'700 12px JetBrains Mono',color:ep.watched ? T.textDim : T.text,flexShrink:0}}>
          {String(ep.episode_number || 0).padStart(2,'0')}
        </span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{font:'600 12px "Space Grotesk"',color:T.text,
            whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {ep.title || `Epizoda ${ep.episode_number}`}
          </div>
        </div>
        <StatusPill theme={T} color={subColor} label={sm.icon} size="sm"/>
        <button onClick={onOpenSubs} style={{...btnGhost(T),padding:'4px 8px',fontSize:11}}>⋯</button>
      </div>
    );
  }

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
      overflow:'hidden',
      borderBottom:last ? 'none' : `1px solid ${T.border}`,
      background: selected ? `${T.accent}11` : ep.watched ? 'transparent' : T.panel2,
    }}>
      {/* Checkbox — 20px fixed */}
      <div
        style={{ flex:'0 0 20px', width:16, height:16, borderRadius:3,
          background: selected ? T.accent : 'transparent',
          border:`2px solid ${selected ? T.accent : T.borderStrong}`,
          display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}
        onClick={e => { e.stopPropagation(); onSelect && onSelect(); }}
      >
        {selected && <span style={{ color:'#fff', fontSize:9, lineHeight:1 }}>✓</span>}
      </div>

      {/* EP number — 72px fixed */}
      <div style={{flex:'0 0 72px', display:'flex', alignItems:'center', gap:5}}>
        {ep.watched && <span style={{width:7,height:7,borderRadius:99,background:T.statusDone,flexShrink:0}}/>}
        <span style={{font:'700 13px JetBrains Mono',color:ep.watched ? T.textDim : T.text}}>
          EP {String(ep.episode_number || ep.n || 0).padStart(2,'0')}
        </span>
      </div>

      {/* Thumbnail — 80px fixed */}
      <div style={{flex:'0 0 80px', height:50, borderRadius:5, overflow:'hidden', position:'relative',
        background:`linear-gradient(135deg, hsla(${hue},50%,28%,1), hsla(${(hue+30)%360},40%,15%,1))`,
        border:`1px solid ${T.border}`}}>
        <div style={{position:'absolute',right:3,top:3,padding:'1px 4px',
          background:'rgba(0,0,0,0.55)',borderRadius:3,font:'700 8px JetBrains Mono',color:'#fff'}}>
          {ep.duration || 24}m
        </div>
        {ep.watched && <div style={{position:'absolute',left:3,bottom:3,padding:'1px 4px',
          background:'rgba(0,0,0,0.55)',borderRadius:3,font:'600 8px JetBrains Mono',color:T.statusDone}}>
          ✓
        </div>}
      </div>

      {/* Title — flex:1, shrinks when needed */}
      <div style={{flex:1, minWidth:0, overflow:'hidden'}}>
        <div style={{font:'600 13px "Space Grotesk"',color:T.text,
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          {ep.title || `Epizoda ${ep.episode_number}`}
        </div>
        <div style={{font:'500 10px JetBrains Mono',color:T.textMute,marginTop:2,
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          s{String(series.season_number || 1).padStart(2,'0')}
          e{String(ep.episode_number || 0).padStart(2,'0')}
          {sizeGB ? ` · ${sizeGB} GB` : ''}
        </div>
      </div>

      {/* Sub status — fixed, no-shrink */}
      <div style={{flexShrink:0}}>
        <StatusPill theme={T} color={subColor} label={`${sm.icon} ${sm.label}`} size="sm"/>
      </div>

      {/* Actions — fixed, no-shrink */}
      <div style={{display:'flex', gap:4, flexShrink:0}}>
        {(subSt === 'both' || subSt === 'cs-only') && <>
          <button onClick={onOpenSubs} style={{...btnGhost(T),padding:'4px 9px',fontSize:11}}>Titulky</button>
          <button style={{...btnGhost(T),padding:'4px 9px',fontSize:11}}>▶</button>
        </>}
        {subSt === 'jp' && (
          <button onClick={onOpenSubs} style={{...btnPrimary(T),padding:'4px 9px',fontSize:11}}>✦ CS</button>
        )}
        {subSt === 'none' && ep.has_file && (
          <button onClick={onOpenSubs} style={{...btnPrimary(T),padding:'4px 9px',fontSize:11}}>↓ Titulky</button>
        )}
        {subSt === 'none' && !ep.has_file && (
          <button style={{...btnGhost(T),padding:'4px 9px',fontSize:11}}>↓</button>
        )}
        <button style={{...btnGhost(T),padding:'4px 7px',fontSize:13}}>⋯</button>
      </div>
    </div>
  );
}

function InfoView({ series, isMobile }) {
  const year = series.year || (series.first_aired ? new Date(series.first_aired).getFullYear() : '—');
  const meta = statusMeta(series.status);
  return (
    <div style={{display:'grid',gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',gap:14}}>
      <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:10,padding:16}}>
        <div style={{font:'700 14px "Space Grotesk"',color:T.text,marginBottom:12}}>Metadata</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[
            ['Originální název', series.title_japanese || '—'],
            ['Romaji', series.title_romaji || series.title || '—'],
            ['Stanice', series.network || '—'],
            ['Rok', year],
            ['Epizody', `${series.episode_count || '?'} epizod`],
            ['Žánry', (series.genres || []).join(' · ') || '—'],
            ['Hodnocení', series.average_score > 0 ? `★ ${Number(series.average_score).toFixed(1)} / 10` : '—'],
            ['Stav', meta.label],
          ].map(([k, v]) => (
            <div key={k} style={{display:'flex',gap:10,padding:'6px 0',borderBottom:`1px solid ${T.border}`}}>
              <div style={{flex:'0 0 140px',font:'500 12px "Space Grotesk"',color:T.textDim}}>{k}</div>
              <div style={{font:'600 12px "Space Grotesk"',color:T.text}}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:10,padding:16}}>
        <div style={{font:'700 14px "Space Grotesk"',color:T.text,marginBottom:12}}>Synopsis</div>
        <div style={{font:'500 13px/1.6 "Space Grotesk"',color:T.textDim}}>
          {series.overview || series.synopsis || 'Popis není k dispozici.'}
        </div>
      </div>
    </div>
  );
}

function SubSearchModal({ theme, episodeIds, onClose }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const doSearch = async () => {
    setLoading(true);
    try {
      const r = await searchSubtitles({ episode_ids: episodeIds, query: query || undefined, language: 'cs' });
      setResults(r.data?.results ?? r.data ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const doDownload = async (sub) => {
    try {
      await downloadBest({ subtitle_id: sub.id ?? sub.SubDownloadLink, episode_id: episodeIds[0] });
      onClose();
    } catch { /* ignore */ }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:300,
      display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ width:560, maxHeight:'80vh', background:theme.panel,
        border:`1px solid ${theme.borderStrong}`, borderRadius:14, padding:22,
        display:'flex', flexDirection:'column', gap:14, overflow:'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ font:'700 15px "Space Grotesk"', color:theme.text }}>Hledat titulky</div>
        <div style={{ font:'500 11px JetBrains Mono', color:theme.textDim }}>
          {episodeIds.length} vybraných epizod · jazyk: CS
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Upřesnit hledání (volitelné)…"
            style={{ flex:1, padding:'7px 10px', background:theme.panel2, color:theme.text,
              border:`1px solid ${theme.border}`, borderRadius:6, outline:'none',
              font:'500 12px "Space Grotesk"' }}
          />
          <button onClick={doSearch} style={{ ...btnPrimary(theme), padding:'7px 14px', fontSize:12 }}>
            {loading ? '…' : '⌕ Hledat'}
          </button>
        </div>

        <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
          {results === null && (
            <div style={{ padding:24, textAlign:'center', color:theme.textMute, font:'500 12px "Space Grotesk"' }}>
              Zadej dotaz a klikni Hledat
            </div>
          )}
          {results !== null && results.length === 0 && (
            <div style={{ padding:24, textAlign:'center', color:theme.textMute, font:'500 12px "Space Grotesk"' }}>
              Žádné výsledky
            </div>
          )}
          {(results || []).map((sub, i) => (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr auto auto',
              gap:10, padding:'9px 12px', alignItems:'center',
              borderBottom:`1px solid ${theme.border}`,
              background: i % 2 === 0 ? 'transparent' : `${theme.panel2}88` }}>
              <div style={{ minWidth:0 }}>
                <div style={{ font:'600 12px "Space Grotesk"', color:theme.text,
                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {sub.SubFileName || sub.title || sub.name || `Výsledek ${i + 1}`}
                </div>
                <div style={{ font:'500 10px JetBrains Mono', color:theme.textDim, marginTop:2 }}>
                  {sub.SubDownloadsCnt ? `↓ ${sub.SubDownloadsCnt}` : ''}
                  {sub.SubRating ? ` · ★ ${sub.SubRating}` : ''}
                  {sub.MovieReleaseName ? ` · ${sub.MovieReleaseName}` : ''}
                </div>
              </div>
              <div style={{ font:'500 10px JetBrains Mono', color:theme.accent2 }}>
                {sub.SubFormat || sub.format || 'srt'}
              </div>
              <button onClick={() => doDownload(sub)}
                style={{ ...btnPrimary(theme), padding:'4px 10px', fontSize:11 }}>
                ↓
              </button>
            </div>
          ))}
        </div>

        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <button style={{ ...btnGhost(theme), padding:'6px 12px', fontSize:12 }} onClick={onClose}>Zavřít</button>
        </div>
      </div>
    </div>
  );
}

function ScheduleEpModal({ theme, count, onClose }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:300,
      display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ width:340, background:theme.panel, border:`1px solid ${theme.borderStrong}`,
        borderRadius:14, padding:22, display:'flex', flexDirection:'column', gap:14 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ font:'700 15px "Space Grotesk"', color:theme.text }}>Časovat zpracování</div>
        <div style={{ font:'500 11px JetBrains Mono', color:theme.textDim }}>{count} epizod</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <label style={{ font:'600 10px JetBrains Mono', color:theme.textMute, letterSpacing:'.06em' }}>DATUM</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{
            padding:'7px 10px', background:theme.panel2, color:theme.text,
            border:`1px solid ${theme.border}`, borderRadius:6, outline:'none',
            font:'500 12px "Space Grotesk"', colorScheme:'dark' }}/>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <label style={{ font:'600 10px JetBrains Mono', color:theme.textMute, letterSpacing:'.06em' }}>ČAS</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{
            padding:'7px 10px', background:theme.panel2, color:theme.text,
            border:`1px solid ${theme.border}`, borderRadius:6, outline:'none',
            font:'500 12px "Space Grotesk"', colorScheme:'dark' }}/>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button style={{ ...btnGhost(theme), padding:'6px 12px', fontSize:12 }} onClick={onClose}>Zrušit</button>
          <button style={{ ...btnPrimary(theme), padding:'6px 14px', fontSize:12 }}
            onClick={onClose}>Potvrdit</button>
        </div>
      </div>
    </div>
  );
}

function EpisodeBulkBar({ theme, selectedIds, episodes, onClear }) {
  const [showSearch, setShowSearch] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const count = selectedIds.size;
  if (count === 0) return null;

  const epIds = [...selectedIds];
  const epIdNums = epIds.map(id => {
    const ep = episodes.find(e => (e.id || e.episode_number) === id);
    return ep?.id;
  }).filter(Boolean);

  const handleDownloadBest = async () => {
    try {
      await downloadBest({ episode_ids: epIdNums, language: 'cs' });
    } catch { /* ignore */ }
  };

  const handleDeleteSubs = async () => {
    try {
      await deleteSubsByEpisodes(epIdNums);
      qc.invalidateQueries(['episodes']);
      onClear();
    } catch { /* ignore */ }
  };

  return (
    <>
      {showSearch && <SubSearchModal theme={theme} episodeIds={epIdNums} onClose={() => setShowSearch(false)}/>}
      {showSchedule && <ScheduleEpModal theme={theme} count={count} onClose={() => setShowSchedule(false)}/>}
      <div style={{
        background:`${theme.panel}f0`, backdropFilter:'blur(14px)',
        borderTop:`1px solid ${theme.borderStrong}`,
        flexShrink:0,
      }}>
        {/* Horizontally scrollable button row — works on both mobile and desktop */}
        <div style={{
          display:'flex', alignItems:'center', gap:6,
          padding: isMobile ? '9px 12px' : '10px 24px',
          overflowX:'auto', scrollbarWidth:'none',
        }}>
          <div style={{ font:'600 12px "Space Grotesk"', color:theme.accent, flexShrink:0, marginRight:4 }}>
            {count} vybráno
          </div>
          <button style={{ ...btnSub(theme), padding: isMobile ? '7px 10px' : '6px 12px',
            fontSize:12, flexShrink:0, whiteSpace:'nowrap' }}
            onClick={() => setShowSchedule(true)}>⏱ {!isMobile && 'Časovat'}</button>
          <button style={{ ...btnPrimary(theme), padding: isMobile ? '7px 10px' : '6px 12px',
            fontSize:12, flexShrink:0, whiteSpace:'nowrap' }}
            onClick={handleDownloadBest}>⬇ Titulky</button>
          <button style={{ ...btnSub(theme), padding: isMobile ? '7px 10px' : '6px 12px',
            fontSize:12, flexShrink:0, whiteSpace:'nowrap' }}>✦ AI</button>
          <button style={{ ...btnSub(theme), padding: isMobile ? '7px 10px' : '6px 12px',
            fontSize:12, flexShrink:0, whiteSpace:'nowrap' }}
            onClick={() => setShowSearch(true)}>🔍 {!isMobile && 'Hledat'}</button>
          <button style={{ ...btnGhost(theme), padding: isMobile ? '7px 10px' : '6px 12px',
            fontSize:12, flexShrink:0, whiteSpace:'nowrap' }}
            onClick={handleDeleteSubs}>🗑 {!isMobile && 'Smazat'}</button>
          <div style={{ flex:1, minWidth:8 }}/>
          <button style={{ ...btnGhost(theme), padding: isMobile ? '7px 10px' : '6px 10px',
            fontSize:12, flexShrink:0, whiteSpace:'nowrap' }} onClick={onClear}>
            ✕ {!isMobile && 'Zrušit výběr'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function SeriesDetail({ theme }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('eps');
  const [epFilter, setEpFilter] = useState('all');
  const [selectedEpIds, setSelectedEpIds] = useState(new Set());

  const toggleEp = useCallback((epId) => {
    setSelectedEpIds(prev => {
      const next = new Set(prev);
      if (next.has(epId)) next.delete(epId);
      else next.add(epId);
      return next;
    });
  }, []);

  const clearEpSelection = useCallback(() => setSelectedEpIds(new Set()), []);

  const { data: series, isLoading } = useQuery({
    queryKey: ['series', id],
    queryFn: () => getSeriesById(id).then(r => r.data),
  });

  const { data: episodes = [] } = useQuery({
    queryKey: ['episodes', id],
    queryFn: () => getEpisodes(id),
    enabled: !!series,
  });

  const filteredEps = useMemo(() => {
    if (epFilter === 'all') return episodes;
    if (epFilter === 'unwatched') return episodes.filter(e => !e.watched);
    if (epFilter === 'missing-subs') return episodes.filter(e => epSubState(e) !== 'both' && epSubState(e) !== 'cs-only');
    return episodes;
  }, [episodes, epFilter]);

  if (isLoading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:T.textDim,font:'500 14px "Space Grotesk"'}}>
      Načítám…
    </div>
  );
  if (!series) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:T.textMute,font:'500 14px "Space Grotesk"'}}>
      Série nenalezena
    </div>
  );

  const meta = statusMeta(series.status);
  const statusCol = T[meta.colorKey];
  const hue = strHue(series.title || '');
  const total = series.episode_count || series.total_episode_count || episodes.length || 0;
  const downloaded = series.episodes_with_file || 0;
  const downloadedPct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  const missingCount = episodes.filter(e => epSubState(e) !== 'both' && epSubState(e) !== 'cs-only').length;

  const year = series.year || (series.first_aired ? new Date(series.first_aired).getFullYear() : null);

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      {/* HERO */}
      <div style={{position:'relative',flex:'0 0 auto',overflow:'hidden',borderBottom:`1px solid ${T.border}`}}>
        <div style={{position:'absolute',inset:0,
          background:`linear-gradient(160deg, hsla(${hue},65%,28%,0.85), hsla(${(hue+50)%360},55%,16%,0.95)), ${T.bg}`,
          filter:'saturate(1.1)'}}/>
        <svg width="100%" height="100%" style={{position:'absolute',inset:0,opacity:0.07,pointerEvents:'none'}}>
          <pattern id="hero-stripe" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="14" stroke="white" strokeWidth="1"/>
          </pattern>
          <rect width="100%" height="100%" fill="url(#hero-stripe)"/>
        </svg>

        {isMobile ? (
          /* ── MOBILE HERO ──────────────────────────────────────────── */
          <div style={{position:'relative', padding:'12px 14px 16px', display:'flex', flexDirection:'column', gap:10}}>
            {/* Back */}
            <button onClick={() => navigate('/')} style={{
              ...btnGhost(T), alignSelf:'flex-start',
              background:'rgba(0,0,0,0.35)', border:'1px solid rgba(255,255,255,0.12)',
              color:'#fff', padding:'5px 10px', display:'inline-flex', gap:6, alignItems:'center',
            }}>
              <NavIcon d={ICONS.back}/> Zpět
            </button>

            {/* Poster 80px + info */}
            <div style={{display:'flex', gap:12, alignItems:'flex-start'}}>
              {/* Custom 80px poster */}
              <div style={{width:80, height:120, flexShrink:0, borderRadius:8, overflow:'hidden',
                border:`1px solid ${T.borderStrong}`, position:'relative'}}>
                {series.cover_url
                  ? <img src={series.cover_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                  : <div style={{width:'100%',height:'100%',
                      background:`linear-gradient(135deg, hsl(${hue},55%,28%), hsl(${(hue+60)%360},45%,16%))`,
                      display:'grid', placeItems:'center',
                      font:`700 22px "Space Grotesk"`, color:'rgba(255,255,255,0.55)'}}>
                      {(series.title_romaji || series.title || '?')[0]}
                    </div>
                }
              </div>

              {/* Info beside poster */}
              <div style={{flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:6, color:'#fff'}}>
                <div style={{font:'700 18px/1.15 "Space Grotesk"', color:'#fff', letterSpacing:'-0.01em',
                  overflow:'hidden', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical'}}>
                  {series.title_romaji || series.title}
                </div>
                <div style={{font:'500 11px "Noto Sans JP"', color:'rgba(255,255,255,0.65)'}}>
                  {series.title_japanese || ''}
                </div>
                <div style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginTop:2}}>
                  <StatusPill theme={T} color={statusCol} label={meta.label}/>
                  {series.average_score > 0 && (
                    <span style={{font:'700 11px JetBrains Mono', color:'#fff',
                      background:'rgba(0,0,0,0.35)', padding:'2px 7px',
                      borderRadius:99, border:'1px solid rgba(255,255,255,0.15)'}}>
                      ★ {Number(series.average_score).toFixed(1)}
                    </span>
                  )}
                </div>
                <div style={{font:'500 11px JetBrains Mono', color:'rgba(255,255,255,0.7)'}}>
                  {total} ep{year ? ` · ${year}` : ''}{series.network ? ` · ${series.network}` : ''}
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <div style={{flex:1, height:4, background:'rgba(0,0,0,0.4)', borderRadius:99, overflow:'hidden'}}>
                <div style={{width:`${downloadedPct}%`, height:'100%', background:T.accent, borderRadius:99,
                  boxShadow:`0 0 8px ${T.accent}`}}/>
              </div>
              <div style={{font:'600 11px JetBrains Mono', color:'#fff', whiteSpace:'nowrap'}}>
                {downloaded}/{total} · {Math.round(downloadedPct)}%
              </div>
            </div>

            {/* Action buttons */}
            <div style={{display:'flex', gap:6}}>
              <button style={{...btnPrimary(T), flex:1, padding:'9px 12px', fontSize:13,
                display:'flex', alignItems:'center', justifyContent:'center', gap:6}}>
                ▶ EP {downloaded + 1 <= total ? String(downloaded + 1).padStart(2,'0') : '—'}
              </button>
              {missingCount > 0 && (
                <button style={{...btnSub(T), padding:'9px 12px', fontSize:12,
                  background:'rgba(255,255,255,0.12)', color:'#fff',
                  border:'1px solid rgba(255,255,255,0.2)', whiteSpace:'nowrap'}}>
                  ↓ {missingCount}
                </button>
              )}
              <button style={{...btnSub(T), padding:'9px 10px',
                background:'rgba(255,255,255,0.12)', color:'#fff',
                border:'1px solid rgba(255,255,255,0.2)'}}>⋯</button>
            </div>
          </div>
        ) : (
          /* ── DESKTOP HERO ─────────────────────────────────────────── */
          <div style={{position:'relative', padding:'18px 24px 22px', display:'flex', gap:22}}>
            <div style={{position:'absolute', top:14, left:24}}>
              <button onClick={() => navigate('/')} style={{
                ...btnGhost(T),
                background:'rgba(0,0,0,0.35)', border:'1px solid rgba(255,255,255,0.12)',
                color:'#fff', padding:'5px 10px', display:'inline-flex', gap:6, alignItems:'center',
              }}>
                <NavIcon d={ICONS.back}/> Zpět do knihovny
              </button>
            </div>
            <div style={{marginTop:34}}>
              <AnimePoster series={series} theme={T} size="lg" radius={10}/>
            </div>

          <div style={{flex:1,minWidth:0,marginTop:34,display:'flex',flexDirection:'column',gap:12,color:'#fff'}}>
            <div>
              <div style={{font:'600 13px "Noto Sans JP"',color:'rgba(255,255,255,0.7)'}}>
                {series.title_japanese || ''}
              </div>
              <div style={{font:'700 32px/1.1 "Space Grotesk"',color:'#fff',letterSpacing:'-0.02em',marginTop:4}}>
                {series.title_romaji || series.title}
              </div>
            </div>

            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <StatusPill theme={T} color={statusCol} label={meta.label}/>
              {series.average_score > 0 && (
                <span style={{font:'700 13px JetBrains Mono',color:'#fff',
                  background:'rgba(0,0,0,0.35)',padding:'3px 9px',borderRadius:99,border:'1px solid rgba(255,255,255,0.15)'}}>
                  ★ {Number(series.average_score).toFixed(1)}
                </span>
              )}
              <span style={{font:'500 12px "Space Grotesk"',color:'rgba(255,255,255,0.85)'}}>
                {total} ep{year ? ` · ${year}` : ''}
                {series.network ? ` · ` : ''}{series.network && <strong style={{color:'#fff'}}>{series.network}</strong>}
              </span>
              <div style={{display:'flex',gap:5,marginLeft:6}}>
                {(series.genres || []).map(g => (
                  <span key={g} style={{font:'600 11px "Space Grotesk"',color:'#fff',
                    background:'rgba(0,0,0,0.3)',padding:'2px 9px',borderRadius:99,
                    border:'1px solid rgba(255,255,255,0.15)'}}>{g}</span>
                ))}
              </div>
            </div>

            {series.overview && (
              <p style={{font:'500 13.5px/1.55 "Space Grotesk"',color:'rgba(255,255,255,0.88)',
                maxWidth:760, margin:0}}>{series.overview}</p>
            )}

            <div style={{display:'flex',alignItems:'center',gap:14,marginTop:6,maxWidth:760}}>
              <div style={{flex:1,height:6,background:'rgba(0,0,0,0.4)',borderRadius:99,overflow:'hidden'}}>
                <div style={{width:`${downloadedPct}%`,height:'100%',background:T.accent,borderRadius:99,
                  boxShadow:`0 0 12px ${T.accent}`}}/>
              </div>
              <div style={{font:'600 12px JetBrains Mono',color:'#fff',whiteSpace:'nowrap'}}>
                {downloaded}/{total} ep · {Math.round(downloadedPct)}%
              </div>
              {series.air_time && (
                <div style={{font:'500 11px JetBrains Mono',color:T.accent2,
                  background:'rgba(0,0,0,0.35)',padding:'4px 9px',borderRadius:99,whiteSpace:'nowrap'}}>
                  {series.air_time}
                </div>
              )}
            </div>

            <div style={{display:'flex',gap:8,marginTop:6,flexWrap:'wrap'}}>
              <button style={{...btnPrimary(T),padding:'8px 16px',fontSize:13}}>
                ▶ Pokračovat EP {downloaded + 1 <= total ? String(downloaded + 1).padStart(2,'0') : '—'}
              </button>
              <button style={{...btnSub(T),background:'rgba(255,255,255,0.12)',color:'#fff',
                border:'1px solid rgba(255,255,255,0.2)'}}>+ Sleduji</button>
              {missingCount > 0 && (
                <button style={{...btnSub(T),background:'rgba(255,255,255,0.12)',color:'#fff',
                  border:'1px solid rgba(255,255,255,0.2)'}}>↓ Chybějící ({missingCount})</button>
              )}
              <button style={{...btnSub(T),background:'rgba(255,255,255,0.12)',color:'#fff',
                border:'1px solid rgba(255,255,255,0.2)',marginLeft:'auto'}}>⋯</button>
            </div>
          </div>
          </div>
        )}
      </div>

      {/* TABS */}
      <div style={{display:'flex',gap:2,padding:'0 24px',borderBottom:`1px solid ${T.border}`,
        background:T.panel,flex:'0 0 auto'}}>
        {[
          ['eps',  `Epizody · ${total}`],
          ['info', 'Info'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{
            padding:'12px 16px', background:'transparent', border:'none',
            borderBottom:`2px solid ${activeTab===k ? T.accent : 'transparent'}`,
            color:activeTab===k ? T.accent : T.textDim,
            font:'600 13px "Space Grotesk"', cursor:'pointer', marginBottom:-1,
          }}>{l}</button>
        ))}
      </div>

      {/* TAB BODY */}
      <div style={{flex:1,minHeight:0,overflowY:'auto',padding: isMobile ? '12px 10px' : '18px 24px',display:'flex',flexDirection:'column',gap:14}}>
        {activeTab === 'eps' && <>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <FilterPill theme={T} label="Vše"           active={epFilter==='all'}          count={episodes.length} onClick={() => setEpFilter('all')}/>
            <FilterPill theme={T} label="Nesledováno"   active={epFilter==='unwatched'}    count={episodes.filter(e => !e.watched).length} onClick={() => setEpFilter('unwatched')}/>
            <FilterPill theme={T} label="Chybí titulky" active={epFilter==='missing-subs'} count={missingCount} onClick={() => setEpFilter('missing-subs')}/>
            <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8}}>
              {selectedEpIds.size > 0
                ? <button style={{...btnGhost(T),padding:'4px 9px',fontSize:11}}
                    onClick={() => setSelectedEpIds(new Set(filteredEps.map(e => e.id || e.episode_number)))}>
                    Vybrat vše ({filteredEps.length})
                  </button>
                : null}
              <div style={{font:'500 11px JetBrains Mono',color:T.textMute}}>
                {filteredEps.length} z {episodes.length}
              </div>
            </div>
          </div>

          {filteredEps.length > 0 ? (
            <div style={{display:'flex',flexDirection:'column',background:T.panel,
              border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
              {filteredEps.map((ep, i) => (
                <EpisodeRow key={ep.id || ep.episode_number}
                  ep={ep} series={series}
                  last={i === filteredEps.length - 1}
                  selected={selectedEpIds.has(ep.id || ep.episode_number)}
                  onSelect={() => toggleEp(ep.id || ep.episode_number)}
                  onOpenSubs={() => navigate('/subtitles')}
                  isMobile={isMobile}
                />
              ))}
            </div>
          ) : (
            <div style={{padding:40,textAlign:'center',color:T.textMute,font:'500 13px "Space Grotesk"'}}>
              Žádné epizody
            </div>
          )}
        </>}

        {activeTab === 'info' && <InfoView series={series} isMobile={isMobile}/>}
      </div>

      <EpisodeBulkBar theme={T} selectedIds={selectedEpIds} episodes={episodes} onClear={clearEpSelection}/>
    </div>
  );
}
