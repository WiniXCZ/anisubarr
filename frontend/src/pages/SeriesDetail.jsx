import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSeriesById, translateSeries, downloadAllSubtitles, setWatchStatus,
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
  const cs = ep.cs_sub_count || ep.subtitle_count || 0;
  const jp = ep.jp_sub_count || 0;
  if (cs > 0 && jp > 0) return 'both';
  if (cs > 0) return 'cs-only';
  if (jp > 0) return 'jp';
  return 'none';
}

const SUB_STATE_META = {
  both:     { colorKey:'statusDone',     icon:'✓', label:'JP + CS' },
  'cs-only':{ colorKey:'statusDone',     icon:'✓', label:'CS' },
  jp:       { colorKey:'statusUpcoming', icon:'!', label:'jen JP' },
  none:     { colorKey:'statusEnded',    icon:'×', label:'chybí' },
};

function EpisodeRow({ ep, series, last, onOpenSubs }) {
  const subSt = epSubState(ep);
  const sm = SUB_STATE_META[subSt] || SUB_STATE_META.none;
  const subColor = T[sm.colorKey];
  const hue = strHue(series.title || '');
  const sizeGB = ep.file_size_bytes ? (ep.file_size_bytes / 1e9).toFixed(1) : null;

  return (
    <div style={{
      display:'grid', gridTemplateColumns:'70px 130px 1fr 90px 170px 220px',
      gap:14, alignItems:'center', padding:'12px 14px',
      borderBottom:last ? 'none' : `1px solid ${T.border}`,
      background: ep.watched ? 'transparent' : T.panel2,
    }}>
      {/* ep # */}
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        {ep.watched && <span style={{width:8,height:8,borderRadius:99,background:T.statusDone}}/>}
        <span style={{font:'700 14px JetBrains Mono',color:ep.watched ? T.textDim : T.text}}>
          EP {String(ep.episode_number || ep.n || 0).padStart(2,'0')}
        </span>
      </div>

      {/* mini thumbnail */}
      <div style={{width:120,height:68,borderRadius:6,overflow:'hidden',position:'relative',
        background:`linear-gradient(135deg, hsla(${hue},50%,28%,1), hsla(${(hue+30)%360},40%,15%,1))`,
        border:`1px solid ${T.border}`}}>
        <div style={{position:'absolute',right:4,top:4,padding:'1px 5px',
          background:'rgba(0,0,0,0.55)',borderRadius:3,font:'700 9px JetBrains Mono',color:'#fff'}}>
          {ep.duration || 24}m
        </div>
        {ep.watched && <div style={{position:'absolute',left:4,bottom:4,padding:'1px 5px',
          background:'rgba(0,0,0,0.55)',borderRadius:3,font:'600 9px JetBrains Mono',color:T.statusDone}}>
          ✓ Sledováno
        </div>}
      </div>

      {/* title */}
      <div style={{minWidth:0}}>
        <div style={{font:'600 13.5px "Space Grotesk"',color:T.text,
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          {ep.title || `Epizoda ${ep.episode_number}`}
        </div>
        <div style={{font:'500 11px JetBrains Mono',color:T.textMute,marginTop:3,
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          {String(series.id).toLowerCase()}.s{String(series.season_number || 1).padStart(2,'0')}
          e{String(ep.episode_number || 0).padStart(2,'0')}.1080p.mkv
        </div>
      </div>

      <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
        {sizeGB ? `${sizeGB} GB` : (ep.has_file ? '—' : '—')}
      </div>

      <div><StatusPill theme={T} color={subColor} label={`${sm.icon} ${sm.label}`} size="sm"/></div>

      <div style={{display:'flex',gap:5,justifyContent:'flex-end'}}>
        {(subSt === 'both' || subSt === 'cs-only') && <>
          <button onClick={onOpenSubs} style={{...btnGhost(T),padding:'5px 10px',fontSize:11}}>Otevřít titulky</button>
          <button style={{...btnGhost(T),padding:'5px 10px',fontSize:11}}>▶ Přehrát</button>
        </>}
        {subSt === 'jp' && <>
          <button onClick={onOpenSubs} style={{...btnPrimary(T),padding:'5px 10px',fontSize:11}}>✦ Přeložit do CS</button>
        </>}
        {subSt === 'none' && ep.has_file && <>
          <button onClick={onOpenSubs} style={{...btnPrimary(T),padding:'5px 10px',fontSize:11}}>↓ Titulky</button>
        </>}
        {subSt === 'none' && !ep.has_file && <>
          <button style={{...btnGhost(T),padding:'5px 10px',fontSize:11}}>↓ Stáhnout</button>
        </>}
        <button style={{...btnGhost(T),padding:'5px 8px',fontSize:13}}>⋯</button>
      </div>
    </div>
  );
}

function InfoView({ series }) {
  const year = series.year || (series.first_aired ? new Date(series.first_aired).getFullYear() : '—');
  const meta = statusMeta(series.status);
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
      <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:10,padding:16}}>
        <div style={{font:'700 14px "Space Grotesk"',color:T.text,marginBottom:12}}>Metadata</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[
            ['Originální název', series.title_jp || series.title_native || '—'],
            ['Romaji', series.title_romaji || series.title || '—'],
            ['Studio', series.studio || '—'],
            ['Rok', year],
            ['Řada', `S${series.season_number || 1} · ${series.episode_count || '?'} epizod`],
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

export default function SeriesDetail({ theme }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('eps');
  const [epFilter, setEpFilter] = useState('all');

  const { data: series, isLoading } = useQuery({
    queryKey: ['series', id],
    queryFn: () => getSeriesById(id).then(r => r.data),
  });

  const { data: episodes = [] } = useQuery({
    queryKey: ['episodes', id],
    queryFn: () => getEpisodes(id),
    enabled: !!series,
  });

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
  const total = series.episode_count || episodes.length || 0;
  const watched = series.watched_count || 0;
  const watchedPct = total > 0 ? (watched / total) * 100 : 0;
  const missingCount = episodes.filter(e => epSubState(e) !== 'both' && epSubState(e) !== 'cs-only').length;

  const filteredEps = useMemo(() => {
    if (epFilter === 'all') return episodes;
    if (epFilter === 'unwatched') return episodes.filter(e => !e.watched);
    if (epFilter === 'missing-subs') return episodes.filter(e => epSubState(e) !== 'both' && epSubState(e) !== 'cs-only');
    return episodes;
  }, [episodes, epFilter]);

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

        <div style={{position:'relative',padding:'18px 24px 22px',display:'flex',gap:22}}>
          <div style={{position:'absolute',top:14,left:24}}>
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
                {series.title_jp || series.title_native || ''}
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
                S{series.season_number || 1} · {total} ep{year ? ` · ${year}` : ''}
                {series.studio ? ` · studio ` : ''}{series.studio && <strong style={{color:'#fff'}}>{series.studio}</strong>}
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
                <div style={{width:`${watchedPct}%`,height:'100%',background:T.accent,borderRadius:99,
                  boxShadow:`0 0 12px ${T.accent}`}}/>
              </div>
              <div style={{font:'600 12px JetBrains Mono',color:'#fff',whiteSpace:'nowrap'}}>
                {watched}/{total} ep · {Math.round(watchedPct)}%
              </div>
              {series.next_airing && (
                <div style={{font:'500 11px JetBrains Mono',color:T.accent2,
                  background:'rgba(0,0,0,0.35)',padding:'4px 9px',borderRadius:99,whiteSpace:'nowrap'}}>
                  další: {series.next_airing}
                </div>
              )}
            </div>

            <div style={{display:'flex',gap:8,marginTop:6,flexWrap:'wrap'}}>
              <button style={{...btnPrimary(T),padding:'8px 16px',fontSize:13}}>
                ▶ Pokračovat EP {watched + 1 <= total ? String(watched + 1).padStart(2,'0') : '—'}
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
      <div style={{flex:1,overflowY:'auto',padding:'18px 24px',display:'flex',flexDirection:'column',gap:14}}>
        {activeTab === 'eps' && <>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <FilterPill theme={T} label="Vše"           active={epFilter==='all'}          count={episodes.length} onClick={() => setEpFilter('all')}/>
            <FilterPill theme={T} label="Nesledováno"   active={epFilter==='unwatched'}    count={episodes.filter(e => !e.watched).length} onClick={() => setEpFilter('unwatched')}/>
            <FilterPill theme={T} label="Chybí titulky" active={epFilter==='missing-subs'} count={missingCount} onClick={() => setEpFilter('missing-subs')}/>
            <div style={{marginLeft:'auto',font:'500 11px JetBrains Mono',color:T.textMute}}>
              {filteredEps.length} z {episodes.length}
            </div>
          </div>

          {filteredEps.length > 0 ? (
            <div style={{display:'flex',flexDirection:'column',background:T.panel,
              border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
              {filteredEps.map((ep, i) => (
                <EpisodeRow key={ep.id || ep.episode_number}
                  ep={ep} series={series}
                  last={i === filteredEps.length - 1}
                  onOpenSubs={() => navigate('/subtitles')}
                />
              ))}
            </div>
          ) : (
            <div style={{padding:40,textAlign:'center',color:T.textMute,font:'500 13px "Space Grotesk"'}}>
              Žádné epizody
            </div>
          )}
        </>}

        {activeTab === 'info' && <InfoView series={series}/>}
      </div>
    </div>
  );
}
