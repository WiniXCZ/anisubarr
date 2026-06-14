import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSeriesById, translateSeries, translateDescription,
  downloadAllSubtitles, searchSubtitles, downloadSubtitle,
  downloadBest, deleteSubsByEpisodes, refreshSeriesNfo, getEmbySeriesUrl,
  getAiStatus, fetchEnglishTitle,
  getAuditLog, getAuditStatus, runAuditCheck,
} from '../api/client';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
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

// ── Audit status badge meta (Logic 3 state machine) ────────────────────────────
const AUDIT_STATUS_META = {
  CLEAN:               { icon:'✓', label:'Clean',               color:'#57f287' },
  PENDING:             { icon:'⏳', label:'Pending',             color:'#5dade2' },
  ABANDONED:           { icon:'🚫', label:'Abandoned',           color:'#9aa0ab' },
  DAMAGED:             { icon:'⚠', label:'Damaged',             color:'#ed4245' },
  PARTIAL:             { icon:'◐', label:'Partial',             color:'#ffa651' },
  PENDING_TRANSLATION: { icon:'🌐', label:'Pending translation', color:'#c897ff' },
};

function AuditStatusBadge({ status, size = 'sm' }) {
  if (!status || !AUDIT_STATUS_META[status]) return null;
  const m = AUDIT_STATUS_META[status];
  const big = size === 'lg';
  return (
    <span style={{
      font:`700 ${big ? 11 : 10}px JetBrains Mono`,
      color: m.color,
      background: `${m.color}26`,
      padding: big ? '3px 9px' : '2px 7px',
      borderRadius:99,
      border:`1px solid ${m.color}59`,
      whiteSpace:'nowrap',
    }}>
      {m.icon} {m.label}
    </span>
  );
}

// ── Info cell helper ──────────────────────────────────────────────────────────
function InfoCell({ label, value, accent, mono, wide }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:2, gridColumn: wide ? 'span 2' : undefined }}>
      <span style={{ font:'500 10px JetBrains Mono', color:T.textMute, letterSpacing:'.05em' }}>
        {label}
      </span>
      <span style={{
        font: mono ? '600 11px JetBrains Mono' : '600 12px "Space Grotesk"',
        color: accent || T.text,
        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
      }}>
        {value || '—'}
      </span>
    </div>
  );
}

// ── Episode expand detail panel ────────────────────────────────────────────────
function EpisodeDetail({ ep, series, onSearchSubs, onClose, onPlay, onEdit }) {
  const subSt = epSubState(ep);
  const sm = SUB_STATE_META[subSt] || SUB_STATE_META.none;

  const sizeGB  = ep.file_size ? `${(ep.file_size / 1e9).toFixed(2)} GB` : null;
  const fps     = ep.video_fps ? `${ep.video_fps.toFixed(2)} fps` : null;
  const vBit    = ep.video_bitrate ? `${ep.video_bitrate} kbps` : null;
  const aBit    = ep.audio_bitrate ? `${ep.audio_bitrate} kbps` : null;
  const aCh     = ep.audio_channels ? `${ep.audio_channels}ch` : null;
  const filename = ep.file_path ? ep.file_path.split(/[\\/]/).pop() : null;
  const folder   = ep.file_path ? ep.file_path.split(/[\\/]/).slice(0,-1).join('/') : null;

  return (
    <div style={{
      background:T.panel2, borderTop:`1px solid ${T.border}`,
      padding:'12px 14px 14px', display:'flex', flexDirection:'column', gap:12,
    }}>
      {/* ── Video info ── */}
      <div>
        <div style={{ font:'700 11px JetBrains Mono', color:T.textDim, marginBottom:8, letterSpacing:'.06em' }}>
          VIDEO
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(130px, 1fr))', gap:'6px 16px' }}>
          <InfoCell label="Rozlišení"     value={ep.resolution || (ep.quality_resolution ? `${ep.quality_resolution}p` : null)} accent={T.accent} mono/>
          <InfoCell label="Kodek"         value={ep.video_codec} accent={T.accent2} mono/>
          <InfoCell label="FPS"           value={fps} mono/>
          <InfoCell label="HDR"           value={ep.video_dynamic_range || 'SDR'} mono/>
          <InfoCell label="Bitrate"       value={vBit} mono/>
          <InfoCell label="Profil"        value={ep.quality_name} mono/>
        </div>
      </div>

      {/* ── Audio info ── */}
      <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:10 }}>
        <div style={{ font:'700 11px JetBrains Mono', color:T.textDim, marginBottom:8, letterSpacing:'.06em' }}>
          AUDIO
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(130px, 1fr))', gap:'6px 16px' }}>
          <InfoCell label="Kodek"       value={ep.audio_codec} accent={T.accent2} mono/>
          <InfoCell label="Kanály"      value={aCh} mono/>
          <InfoCell label="Bitrate"     value={aBit} mono/>
          <InfoCell label="Jazyky"      value={ep.audio_languages} mono/>
        </div>
      </div>

      {/* ── Soubor ── */}
      <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:10 }}>
        <div style={{ font:'700 11px JetBrains Mono', color:T.textDim, marginBottom:8, letterSpacing:'.06em' }}>
          SOUBOR
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(130px, 1fr))', gap:'6px 16px' }}>
          <InfoCell label="Velikost"     value={sizeGB} accent={T.accent} mono/>
          <InfoCell label="Stav"         value={ep.has_file ? '✓ Stažen' : '✗ Chybí'} mono/>
          <InfoCell label="Titulky"      value={`${sm.icon} ${sm.label}`} mono/>
          <InfoCell label="Zdroj titulků" value={ep.subtitle_source || (ep.has_cs_sub ? 'lokální' : null)} mono/>
        </div>
        {filename && (
          <div style={{ marginTop:8, font:'500 11px JetBrains Mono', color:T.textMute, wordBreak:'break-all' }}>
            <span style={{ color:T.textDim }}>Soubor: </span>{filename}
          </div>
        )}
        {folder && (
          <div style={{ marginTop:2, font:'500 10px JetBrains Mono', color:T.textMute, wordBreak:'break-all' }}>
            <span style={{ color:T.textDim }}>Cesta: </span>{folder}
          </div>
        )}
      </div>

      {/* ── Akce ── */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', paddingTop:4, borderTop:`1px solid ${T.border}` }}>
        <button onClick={onSearchSubs}
          style={{ ...btnPrimary(T), padding:'6px 12px', fontSize:12 }}>
          🔍 Hledat titulky
        </button>
        {ep.has_file && onPlay && (
          <button onClick={onPlay}
            style={{ ...btnGhost(T), padding:'6px 12px', fontSize:12 }}>
            ▶ Přehrát
          </button>
        )}
        {(ep.has_file || ep.has_cs_sub) && onEdit && (
          <button onClick={onEdit}
            style={{ ...btnGhost(T), padding:'6px 12px', fontSize:12 }}>
            ✎ Editovat titulky
          </button>
        )}
        <button onClick={onClose}
          style={{ ...btnGhost(T), padding:'6px 10px', fontSize:12, marginLeft:'auto' }}>
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Episode row ─────────────────────────────────────────────────────────────────
function EpisodeRow({ ep, series, last, selected, onSelect, onOpenSubs, onPlay, onEdit, isMobile, expanded, onToggle, index }) {
  const subSt = epSubState(ep);
  const sm = SUB_STATE_META[subSt] || SUB_STATE_META.none;
  const subColor = T[sm.colorKey];
  const hue = strHue(series.title || '');
  const sizeGB = ep.file_size ? (ep.file_size / 1e9).toFixed(1) : null;

  const zebraBg = (index ?? 0) % 2 !== 0 ? 'rgba(255,255,255,0.025)' : 'transparent';
  const rowBg = expanded
    ? `${T.accent}18`
    : selected
    ? `${T.accent}11`
    : zebraBg;

  if (isMobile) {
    return (
      <div style={{ borderBottom: last && !expanded ? 'none' : `1px solid ${T.border}` }}>
        <div
          style={{ display:'flex', gap:10, alignItems:'center', padding:'10px 12px', background:rowBg, cursor:'pointer' }}
          onClick={onToggle}
        >
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
          <span style={{ color:T.textDim, fontSize:10 }}>{expanded ? '▲' : '▼'}</span>
        </div>
        {expanded && (
          <EpisodeDetail ep={ep} series={series} onSearchSubs={onOpenSubs} onClose={onToggle} onPlay={onPlay} onEdit={onEdit}/>
        )}
      </div>
    );
  }

  return (
    <div style={{ borderBottom: last && !expanded ? 'none' : `1px solid ${T.border}` }}>
      <div
        style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', background:rowBg }}
        onClick={onToggle}
      >
        {/* Checkbox */}
        <div
          style={{ flex:'0 0 20px', width:16, height:16, borderRadius:3,
            background: selected ? T.accent : 'transparent',
            border:`2px solid ${selected ? T.accent : T.borderStrong}`,
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}
          onClick={e => { e.stopPropagation(); onSelect && onSelect(); }}
        >
          {selected && <span style={{ color:'#fff', fontSize:9, lineHeight:1 }}>✓</span>}
        </div>

        {/* EP number */}
        <div style={{flex:'0 0 72px', display:'flex', alignItems:'center', gap:5}}>
          {ep.watched && <span style={{width:7,height:7,borderRadius:99,background:T.statusDone,flexShrink:0}}/>}
          <span style={{font:'700 13px JetBrains Mono',color:ep.watched ? T.textDim : T.text}}>
            EP {String(ep.episode_number || ep.n || 0).padStart(2,'0')}
          </span>
        </div>

        {/* Thumbnail */}
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

        {/* Title */}
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
            {ep.subtitle_source ? ` · ${ep.subtitle_source}` : ''}
          </div>
        </div>

        {/* Sub status */}
        <div style={{flexShrink:0}}>
          <StatusPill theme={T} color={subColor} label={`${sm.icon} ${sm.label}`} size="sm"/>
        </div>

        {/* Expand toggle */}
        <div style={{flexShrink:0, color:T.textDim, fontSize:11, padding:'0 4px', userSelect:'none'}}>
          {expanded ? '▲' : '▼'}
        </div>

        {/* Quick actions — stop propagation so they don't toggle expand */}
        <div style={{display:'flex', gap:4, flexShrink:0}} onClick={e => e.stopPropagation()}>
          {(subSt === 'both' || subSt === 'cs-only') && (
            <button onClick={onOpenSubs} style={{...btnGhost(T),padding:'4px 9px',fontSize:11}}>Titulky</button>
          )}
          {subSt === 'jp' && (
            <button onClick={onOpenSubs} style={{...btnPrimary(T),padding:'4px 9px',fontSize:11}}>✦ CS</button>
          )}
          {subSt === 'none' && ep.has_file && (
            <button onClick={onOpenSubs} style={{...btnPrimary(T),padding:'4px 9px',fontSize:11}}>↓ Titulky</button>
          )}
          {subSt === 'none' && !ep.has_file && (
            <button onClick={onOpenSubs} style={{...btnGhost(T),padding:'4px 9px',fontSize:11}}>↓</button>
          )}
          {(ep.has_file || ep.has_cs_sub) && onEdit && (
            <button onClick={onEdit} style={{...btnGhost(T),padding:'4px 9px',fontSize:11}} title="Otevřít editor titulků">✎</button>
          )}
        </div>
      </div>

      {/* Expand detail */}
      {expanded && (
        <EpisodeDetail ep={ep} series={series} onSearchSubs={onOpenSubs} onClose={onToggle} onPlay={onPlay} onEdit={onEdit}/>
      )}
    </div>
  );
}

// ── Schedule / Harmonogram view ───────────────────────────────────────────────
function ScheduleView({ episodes, series, isMobile }) {
  const now = new Date();

  // Sort episodes by air date
  const sorted = [...episodes].sort((a, b) => {
    const da = a.air_date || a.air_date_utc || '';
    const db_ = b.air_date || b.air_date_utc || '';
    return da.localeCompare(db_);
  });

  const withDate = sorted.filter(e => e.air_date || e.air_date_utc);
  const noDate   = sorted.filter(e => !e.air_date && !e.air_date_utc);

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('cs-CZ', { weekday:'short', day:'numeric', month:'long', year:'numeric' });
    } catch { return dateStr; }
  }

  function formatTime(dateStr) {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString('cs-CZ', { hour:'2-digit', minute:'2-digit' });
    } catch { return null; }
  }

  function isAired(dateStr) {
    if (!dateStr) return false;
    return new Date(dateStr) < now;
  }

  function isToday(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d.toDateString() === now.toDateString();
  }

  // Group by month
  const byMonth = {};
  for (const ep of withDate) {
    const dateStr = ep.air_date_utc || ep.air_date || '';
    let monthKey = '—';
    try {
      const d = new Date(dateStr);
      monthKey = d.toLocaleDateString('cs-CZ', { month:'long', year:'numeric' });
    } catch {}
    if (!byMonth[monthKey]) byMonth[monthKey] = [];
    byMonth[monthKey].push(ep);
  }

  const airTime = series.air_time;

  // Show season prefix (S2, S3...) only when episodes span multiple seasons
  const seasons = new Set(episodes.map(e => e.season_number).filter(Boolean));
  const showSeason = seasons.size > 1;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Series air info */}
      {(airTime || series.network) && (
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10,
          padding:'14px 18px', display:'flex', gap:20, flexWrap:'wrap' }}>
          {airTime && (
            <div>
              <div style={{ font:'500 10px JetBrains Mono', color:T.textMute, marginBottom:4 }}>ČAS VYSÍLÁNÍ</div>
              <div style={{ font:'700 18px JetBrains Mono', color:T.accent }}>{airTime}</div>
            </div>
          )}
          {series.network && (
            <div>
              <div style={{ font:'500 10px JetBrains Mono', color:T.textMute, marginBottom:4 }}>STANICE</div>
              <div style={{ font:'600 14px "Space Grotesk"', color:T.text }}>{series.network}</div>
            </div>
          )}
          <div>
            <div style={{ font:'500 10px JetBrains Mono', color:T.textMute, marginBottom:4 }}>EPIZODY</div>
            <div style={{ font:'600 14px "Space Grotesk"', color:T.text }}>
              {episodes.filter(e => isAired(e.air_date_utc || e.air_date)).length} / {episodes.length} odvysíláno
            </div>
          </div>
        </div>
      )}

      {/* Episodes grouped by month */}
      {Object.entries(byMonth).map(([month, eps]) => (
        <div key={month}>
          <div style={{ font:'700 11px JetBrains Mono', color:T.textDim, letterSpacing:'.08em',
            marginBottom:8, textTransform:'uppercase' }}>
            {month}
          </div>
          <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden' }}>
            {eps.map((ep, i) => {
              const dateStr = ep.air_date_utc || ep.air_date || '';
              const aired   = isAired(dateStr);
              const today   = isToday(dateStr);
              const time    = formatTime(dateStr);

              return (
                <div key={ep.id || ep.episode_number} style={{
                  display:'flex', alignItems:'center', gap:12,
                  padding: isMobile ? '10px 14px' : '10px 18px',
                  borderBottom: i < eps.length - 1 ? `1px solid ${T.border}` : 'none',
                  background: today ? `${T.accent}14` : 'transparent',
                }}>
                  {/* EP number */}
                  <div style={{
                    font:'700 12px JetBrains Mono', flexShrink:0, width: showSeason ? 60 : 40,
                    color: aired ? T.statusDone : today ? T.accent : T.textDim,
                  }}>
                    {today && <span style={{ marginRight:4 }}>▶</span>}
                    {showSeason && ep.season_number ? (
                      <><span style={{ color: T.accent2 }}>S{ep.season_number}</span>{' '}</>
                    ) : null}
                    EP {String(ep.episode_number || 0).padStart(2,'0')}
                  </div>

                  {/* Title */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{
                      font:'600 12px "Space Grotesk"',
                      color: aired ? T.textDim : T.text,
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                    }}>
                      {ep.title || `Epizoda ${ep.episode_number}`}
                    </div>
                  </div>

                  {/* Date + time */}
                  <div style={{ flexShrink:0, textAlign:'right' }}>
                    <div style={{ font:'500 11px JetBrains Mono', color: today ? T.accent : T.textDim }}>
                      {formatDate(dateStr)}
                    </div>
                    {time && (
                      <div style={{ font:'600 11px JetBrains Mono', color: today ? T.accent : T.textMute, marginTop:1 }}>
                        {time}
                      </div>
                    )}
                  </div>

                  {/* Status dot */}
                  <div style={{ flexShrink:0, width:8, height:8, borderRadius:99,
                    background: aired ? T.statusDone : today ? T.accent : T.border,
                  }}/>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Episodes without date */}
      {noDate.length > 0 && (
        <div>
          <div style={{ font:'700 11px JetBrains Mono', color:T.textMute, letterSpacing:'.08em',
            marginBottom:8 }}>
            BEZ DATA
          </div>
          <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden' }}>
            {noDate.map((ep, i) => (
              <div key={ep.id || ep.episode_number} style={{
                display:'flex', alignItems:'center', gap:12,
                padding: isMobile ? '10px 14px' : '10px 18px',
                borderBottom: i < noDate.length - 1 ? `1px solid ${T.border}` : 'none',
              }}>
                <div style={{ font:'700 12px JetBrains Mono', color:T.textMute, width: showSeason ? 60 : 40 }}>
                  {showSeason && ep.season_number ? (
                    <><span style={{ color: T.accent2 }}>S{ep.season_number}</span>{' '}</>
                  ) : null}
                  EP {String(ep.episode_number || 0).padStart(2,'0')}
                </div>
                <div style={{ flex:1, minWidth:0, font:'600 12px "Space Grotesk"', color:T.textDim,
                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {ep.title || `Epizoda ${ep.episode_number}`}
                </div>
                <div style={{ font:'500 11px JetBrains Mono', color:T.textMute }}>—</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {episodes.length === 0 && (
        <div style={{ padding:40, textAlign:'center', color:T.textMute, font:'500 13px "Space Grotesk"' }}>
          Žádné epizody
        </div>
      )}
    </div>
  );
}

function InfoView({ series, isMobile, onTranslate, translateState, onFetchEnTitle, enTitleState }) {
  const year = series.year || (series.first_aired ? new Date(series.first_aired).getFullYear() : '—');
  const meta = statusMeta(series.status);
  return (
    <div style={{display:'grid',gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',gap:14}}>
      <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:10,padding:16}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <div style={{font:'700 14px "Space Grotesk"',color:T.text}}>Metadata</div>
          {onFetchEnTitle && (
            <button
              disabled={enTitleState === 'loading'}
              onClick={onFetchEnTitle}
              style={{...btnSub(T), marginLeft:'auto', padding:'4px 10px', fontSize:11,
                opacity: enTitleState === 'loading' ? 0.6 : 1}}
              title="Načíst anglický název z AniList API">
              {enTitleState === 'loading' ? '⏳…'
                : enTitleState === 'ok' ? '✓'
                : enTitleState === 'error' ? '✗'
                : '🌐 EN název'}
            </button>
          )}
        </div>
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
            ['Umístění', series.path ? series.path.split(/[\\/]/).filter(Boolean).slice(-2).join('/') : '—'],
          ].map(([k, v]) => (
            <div key={k} style={{display:'flex',gap:10,padding:'6px 0',borderBottom:`1px solid ${T.border}`}}>
              <div style={{flex:'0 0 140px',font:'500 12px "Space Grotesk"',color:T.textDim}}>{k}</div>
              <div style={{font:'600 12px "Space Grotesk"',color:T.text}}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:10,padding:16}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <div style={{font:'700 14px "Space Grotesk"',color:T.text}}>Synopsis</div>
          {series.overview_cs && (
            <span style={{font:'600 9px JetBrains Mono',color:T.accent,
              background:`${T.accent}22`,border:`1px solid ${T.accent}44`,
              padding:'1px 6px',borderRadius:3}}>CS</span>
          )}
          {onTranslate && (
            <button
              disabled={translateState === 'loading'}
              onClick={() => onTranslate(!!series.overview_cs)}
              style={{...btnSub(T), marginLeft:'auto', padding:'4px 10px', fontSize:11,
                opacity: translateState === 'loading' ? 0.6 : 1}}>
              {translateState === 'loading' ? '⏳…'
                : translateState === 'ok' ? '✓'
                : translateState === 'error' ? '✗'
                : series.overview_cs ? '↺ Přeložit znovu'
                : '🌐 Přeložit popis'}
            </button>
          )}
        </div>
        <div style={{font:'500 13px/1.6 "Space Grotesk"',color:T.textDim}}>
          {series.overview_cs || series.overview || series.synopsis || 'Popis není k dispozici.'}
        </div>
      </div>
    </div>
  );
}

// ── Audit log entry type styling ────────────────────────────────────────────
const LOG_EVENT_META = {
  state_change:        { icon:'⇄', label:'Změna stavu',      color:'#c897ff' },
  subtitle_search:     { icon:'🔎', label:'Hledání titulků',  color:'#5dade2' },
  seerr_report:        { icon:'🐞', label:'Seerr report',     color:'#ed4245' },
  hiyori_check:        { icon:'🌐', label:'Hiyori kontrola',  color:'#22c55e' },
  damage_eval:         { icon:'⚠', label:'Hodnocení škod',    color:'#ffa651' },
  subtitle_confidence: { icon:'✓', label:'Subtitle confidence', color:'#57f287' },
  info:                { icon:'ℹ', label:'Info',              color:'#9aa0ab' },
};

function formatLogDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('cs-CZ', { day:'numeric', month:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch { return dateStr; }
}

function LogView({ seriesId, series, isMobile }) {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);

  const { data: logEntries = [], isLoading } = useQuery({
    queryKey: ['audit-log', seriesId],
    queryFn: () => getAuditLog(seriesId).then(r => r.data),
    enabled: !!seriesId,
  });

  const { data: auditStatus } = useQuery({
    queryKey: ['audit-status', seriesId],
    queryFn: () => getAuditStatus(seriesId).then(r => r.data),
    enabled: !!seriesId,
  });

  const handleRecheck = async () => {
    setChecking(true);
    try {
      await runAuditCheck(seriesId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['audit-log', seriesId] }),
        queryClient.invalidateQueries({ queryKey: ['audit-status', seriesId] }),
        queryClient.invalidateQueries({ queryKey: ['series', seriesId] }),
      ]);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={{display:'flex', flexDirection:'column', gap:14}}>
      {/* Current audit status summary */}
      <div style={{background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, padding:16,
        display:'flex', flexDirection:isMobile ? 'column' : 'row', gap:12,
        alignItems:isMobile ? 'flex-start' : 'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', flexDirection:'column', gap:6}}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <div style={{font:'700 14px "Space Grotesk"', color:T.text}}>Stav auditu</div>
            <AuditStatusBadge status={series.audit_status} size="lg"/>
          </div>
          {series.audit_status_reason && (
            <div style={{font:'500 12px "Space Grotesk"', color:T.textDim}}>
              {series.audit_status_reason}
            </div>
          )}
          <div style={{font:'500 11px JetBrains Mono', color:T.textMute}}>
            {series.audit_status_since ? `od ${formatLogDate(series.audit_status_since)}` : ''}
            {auditStatus?.last_hiyori_check_at ? ` · Hiyori check: ${formatLogDate(auditStatus.last_hiyori_check_at)}` : ''}
          </div>
        </div>
        <button
          disabled={checking}
          onClick={handleRecheck}
          style={{...btnSub(T), padding:'8px 14px', fontSize:12, flexShrink:0,
            opacity: checking ? 0.6 : 1}}>
          {checking ? '⏳ Kontroluji…' : '↺ Zkontrolovat znovu'}
        </button>
      </div>

      {/* Chronological log */}
      <div style={{background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden'}}>
        {isLoading ? (
          <div style={{padding:40, textAlign:'center', color:T.textMute, font:'500 13px "Space Grotesk"'}}>
            Načítám…
          </div>
        ) : logEntries.length === 0 ? (
          <div style={{padding:40, textAlign:'center', color:T.textMute, font:'500 13px "Space Grotesk"'}}>
            Žádné záznamy
          </div>
        ) : (
          logEntries.map((e, i) => {
            const meta = LOG_EVENT_META[e.event_type] || LOG_EVENT_META.info;
            return (
              <div key={e.id || i} style={{
                display:'flex', gap:12, alignItems:'flex-start',
                padding: isMobile ? '10px 14px' : '12px 18px',
                borderBottom: i < logEntries.length - 1 ? `1px solid ${T.border}` : 'none',
              }}>
                <div style={{
                  flexShrink:0, width:28, height:28, borderRadius:99,
                  display:'grid', placeItems:'center',
                  background:`${meta.color}22`, border:`1px solid ${meta.color}44`,
                  font:'14px sans-serif',
                }}>
                  {meta.icon}
                </div>
                <div style={{flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:2}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                    <span style={{font:'700 11px JetBrains Mono', color:meta.color, letterSpacing:'.04em', textTransform:'uppercase'}}>
                      {meta.label}
                    </span>
                    <span style={{font:'500 11px JetBrains Mono', color:T.textMute}}>
                      {formatLogDate(e.created_at)}
                    </span>
                  </div>
                  <div style={{font:'500 13px "Space Grotesk"', color:T.text}}>
                    {e.message}
                  </div>
                  {e.detail && (
                    <div style={{font:'500 11px JetBrains Mono', color:T.textDim, whiteSpace:'pre-wrap',
                      background:T.bg, border:`1px solid ${T.border}`, borderRadius:6,
                      padding:'6px 8px', marginTop:4}}>
                      {e.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Source badge colors
const SOURCE_META = {
  hiyori:  { label:'Hiyori',  color:'#22c55e' },
  hns:     { label:'HnS',     color:'#3b82f6' },
  kamui:   { label:'Kamui',   color:'#a855f7' },
  gensubs: { label:'GenSubs', color:'#f97316' },
  direct:  { label:'Direct',  color:'#94a3b8' },
};

function SourceBadge({ source }) {
  const m = SOURCE_META[source] || { label: source, color: '#94a3b8' };
  return (
    <span style={{
      font:'700 9px JetBrains Mono', letterSpacing:'.04em',
      background:`${m.color}22`, color:m.color,
      border:`1px solid ${m.color}44`,
      padding:'2px 6px', borderRadius:4, flexShrink:0, whiteSpace:'nowrap',
    }}>{m.label}</span>
  );
}

function SubSearchModal({ theme, episodeId, epLabel, onClose }) {
  const [results, setResults]   = useState(null);
  const [logs, setLogs]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [downloading, setDownloading] = useState(null); // url being downloaded
  const [done, setDone]         = useState(null);       // url successfully downloaded
  const [dlWarning, setDlWarning] = useState(null);     // language/path warning after download
  const [autoSync, setAutoSync] = useState(false);
  const [showLog, setShowLog]   = useState(false);
  const qc = useQueryClient();

  // Auto-search on open
  useState(() => {
    doSearch();
  });

  async function doSearch() {
    if (!episodeId) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setLogs([]);
    try {
      const r = await searchSubtitles({
        episode_id: episodeId,
        sources: ['hiyori', 'hns', 'kamui', 'gensubs'],
        language: 'cs',
      });
      setResults(r.data?.results ?? []);
      setLogs(r.data?.log ?? []);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Chyba při hledání');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function doDownload(sub) {
    setDownloading(sub.url);
    setError(null);
    setDlWarning(null);
    try {
      const r = await downloadSubtitle({
        episode_id: episodeId,
        source: sub.source,
        url: sub.url,
        title: sub.title || '',
        language: 'cs',
        auto_sync: autoSync,
      });
      setDone(sub.url);
      qc.invalidateQueries(['episodes']);
      // Show warning if language was detected as different or path was fallback
      const w = r.data?.language_warning || r.data?.warning;
      if (w) setDlWarning(w);
    } catch (e) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || e?.message || 'Chyba při stahování';
      setError(status ? `[HTTP ${status}] ${detail}` : detail);
    } finally {
      setDownloading(null);
    }
  }

  return createPortal(
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }} onClick={onClose}>
      <div style={{
        width:'100%', maxWidth:600, maxHeight:'80vh',
        background:theme.panel, borderRadius:14,
        border:`1px solid ${theme.borderStrong}`,
        display:'flex', flexDirection:'column', overflow:'hidden',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'16px 18px 12px', borderBottom:`1px solid ${theme.border}`,
          display:'flex', alignItems:'flex-start', gap:10 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ font:'700 14px "Space Grotesk"', color:theme.text }}>
              Hledat titulky
            </div>
            {epLabel && (
              <div style={{ font:'500 11px JetBrains Mono', color:theme.textDim, marginTop:2 }}>
                {epLabel}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ ...btnGhost(theme), padding:'4px 8px', fontSize:14, flexShrink:0 }}>✕</button>
        </div>

        {/* Auto-sync toggle + re-search */}
        <div style={{ padding:'10px 18px', borderBottom:`1px solid ${theme.border}`,
          display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={doSearch} disabled={loading}
            style={{ ...btnSub(theme), padding:'6px 12px', fontSize:12 }}>
            {loading ? '⏳ Hledám…' : '↻ Znovu hledat'}
          </button>
          <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer',
            font:'500 12px "Space Grotesk"', color:theme.textDim, marginLeft:'auto' }}>
            <input type="checkbox" checked={autoSync} onChange={e => setAutoSync(e.target.checked)}
              style={{ accentColor:theme.accent }}/>
            Auto-sync (alass)
          </label>
        </div>

        {/* Results */}
        <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
          {loading && (
            <div style={{ padding:32, textAlign:'center', color:theme.textDim,
              font:'500 13px "Space Grotesk"' }}>
              ⏳ Prohledávám Hiyori, HnS, Kamui, GenSubs…
            </div>
          )}

          {!loading && error && (
            <div style={{ padding:'16px 18px', background:`${theme.statusEnded}18`,
              color:theme.statusEnded, font:'500 12px "Space Grotesk"', margin:'12px 18px',
              borderRadius:8, border:`1px solid ${theme.statusEnded}44` }}>
              ⚠ {error}
            </div>
          )}

          {dlWarning && (
            <div style={{ padding:'12px 18px', background:'#f59e0b18',
              color:'#f59e0b', font:'500 12px "Space Grotesk"', margin:'12px 18px',
              borderRadius:8, border:'1px solid #f59e0b44', display:'flex', gap:8 }}>
              ⚠ {dlWarning}
            </div>
          )}

          {!loading && results !== null && results.length === 0 && (
            <div style={{ padding:32, textAlign:'center', color:theme.textMute,
              font:'500 13px "Space Grotesk"' }}>
              Žádné titulky nenalezeny
            </div>
          )}

          {!loading && (results || []).map((sub, i) => {
            const isDownloading = downloading === sub.url;
            const isDone = done === sub.url;
            return (
              <div key={i} style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'10px 18px',
                borderBottom:`1px solid ${theme.border}`,
                background: isDone ? `${theme.statusDone}0f` : 'transparent',
              }}>
                {/* Source badge */}
                <SourceBadge source={sub.source}/>

                {/* Info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ font:'600 12px "Space Grotesk"', color:theme.text,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {sub.title || '—'}
                  </div>
                  <div style={{ display:'flex', gap:8, marginTop:2, flexWrap:'wrap' }}>
                    {sub.uploader && (
                      <span style={{ font:'500 10px JetBrains Mono', color:theme.accent2 }}>
                        👤 {sub.uploader}
                      </span>
                    )}
                    {sub.rating && (
                      <span style={{ font:'500 10px JetBrains Mono', color:theme.textMute }}>
                        ver. {sub.rating}
                      </span>
                    )}
                    {sub.notes && (
                      <span style={{ font:'500 10px JetBrains Mono', color:theme.textMute }}>
                        {sub.notes}
                      </span>
                    )}
                    {sub.language && (() => {
                      const lc = sub.language.toLowerCase();
                      const [col, bg] =
                        lc === 'cs' ? [theme.statusDone, `${theme.statusDone}22`] :
                        lc === 'sk' ? ['#f59e0b', '#f59e0b22'] :
                        lc === 'en' ? ['#60a5fa', '#60a5fa22'] :
                        [theme.textMute, theme.panel2];
                      return (
                        <span style={{ font:'600 9px JetBrains Mono', color:col,
                          background:bg, padding:'1px 5px', borderRadius:3,
                          border:`1px solid ${col}44` }}>
                          {sub.language.toUpperCase()}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Download button */}
                {isDone ? (
                  <span style={{ font:'600 11px JetBrains Mono', color:theme.statusDone, flexShrink:0 }}>✓ Staženo</span>
                ) : (
                  <button
                    disabled={isDownloading || !!downloading}
                    onClick={() => doDownload(sub)}
                    style={{
                      ...btnPrimary(theme),
                      padding:'6px 12px', fontSize:12, flexShrink:0,
                      opacity: (isDownloading || (!!downloading && !isDownloading)) ? 0.6 : 1,
                    }}>
                    {isDownloading ? '⏳' : '↓ Stáhnout'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Log toggle */}
        {logs.length > 0 && (
          <div style={{ borderTop:`1px solid ${theme.border}` }}>
            <button onClick={() => setShowLog(v => !v)} style={{
              ...btnGhost(theme), width:'100%', padding:'8px 18px',
              font:'500 11px JetBrains Mono', color:theme.textMute,
              borderRadius:0, justifyContent:'flex-start',
            }}>
              {showLog ? '▲' : '▼'} Log ({logs.length} zpráv)
            </button>
            {showLog && (
              <div style={{ padding:'8px 18px 12px', maxHeight:120, overflowY:'auto',
                background:theme.sunken }}>
                {logs.map((l, i) => (
                  <div key={i} style={{ font:'400 10px JetBrains Mono', color:theme.textDim,
                    lineHeight:1.5 }}>{l}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function ScheduleEpModal({ theme, count, onClose }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  return createPortal(
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:9999,
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
    </div>,
    document.body
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
      {showSearch && epIdNums.length > 0 && (
        <SubSearchModal
          theme={theme}
          episodeId={epIdNums[0]}
          epLabel={`${count} vybraných epizod`}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showSchedule && <ScheduleEpModal theme={theme} count={count} onClose={() => setShowSchedule(false)}/>}
      <div style={{
        background:`${theme.panel}f0`, backdropFilter:'blur(14px)',
        borderTop:`1px solid ${theme.borderStrong}`,
        position:'sticky', bottom:0, zIndex:10,
      }}>
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
  const qc = useQueryClient();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('eps');
  const [epFilter, setEpFilter] = useState('all');
  const [selectedEpIds, setSelectedEpIds] = useState(new Set());
  const [expandedEpId, setExpandedEpId] = useState(null);
  const [subModalEp, setSubModalEp] = useState(null); // { id, label }
  const [nfoState, setNfoState] = useState(null); // null | 'loading' | 'ok' | 'error'
  const [translateState, setTranslateState] = useState(null); // null | 'loading' | 'ok' | 'error'
  const [enTitleState, setEnTitleState] = useState(null); // null | 'loading' | 'ok' | 'error'
  const [subDlState, setSubDlState] = useState(null); // null | 'loading' | 'ok' | 'error'
  const [langCheckState, setLangCheckState] = useState(null); // null | 'loading' | 'ok' | 'error'
  const [tmdbState, setTmdbState] = useState(null); // null | 'loading' | 'ok' | 'error'
  const [promoState, setPromoState] = useState(null); // null | 'loading' | 'ok' | 'error'

  const { data: aiStatus } = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => getAiStatus().then(r => r.data),
    staleTime: 60_000,
  });
  const aiReady = aiStatus?.ready ?? true; // optimistic default so button shows normally until we know

  const toggleEp = useCallback((epId) => {
    setSelectedEpIds(prev => {
      const next = new Set(prev);
      if (next.has(epId)) next.delete(epId);
      else next.add(epId);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((epId) => {
    setExpandedEpId(prev => prev === epId ? null : epId);
  }, []);

  const clearEpSelection = useCallback(() => setSelectedEpIds(new Set()), []);

  const handlePlayEpisode = useCallback((epId) => {
    navigate(`/player/${id}/${epId}`);
  }, [navigate, id]);

  const handleSubDownload = async (force = false) => {
    setSubDlState('loading');
    try {
      const res = await downloadAllSubtitles(id, force);
      const count = res?.data?.count ?? '?';
      setSubDlState('ok');
      toast.success(`Hledání titulků zahájeno (${count} epizod ve frontě)`);
      setTimeout(() => setSubDlState(null), 3000);
    } catch (err) {
      setSubDlState('error');
      const detail = err?.response?.data?.detail;
      toast.error(detail || 'Chyba při spuštění hledání titulků');
      setTimeout(() => setSubDlState(null), 3000);
    }
  };

  const handleTranslate = async (force = false) => {
    setTranslateState('loading');
    try {
      await translateDescription(id, force);
      qc.invalidateQueries(['series', id]);
      setTranslateState('ok');
      toast.success('Popis byl přeložen do češtiny.');
      setTimeout(() => setTranslateState(null), 3000);
    } catch (err) {
      setTranslateState('error');
      const detail = err?.response?.data?.detail;
      toast.error(detail || 'Překlad se nezdařil. Zkontrolujte konfiguraci AI providera v Nastavení.');
      setTimeout(() => setTranslateState(null), 3000);
    }
  };

  const handleFetchEnTitle = async () => {
    setEnTitleState('loading');
    try {
      const res = await fetchEnglishTitle(id);
      qc.invalidateQueries(['series', id]);
      setEnTitleState('ok');
      toast.success(res.data.title_en
        ? `EN název uložen: ${res.data.title_en}`
        : 'Anglický název nenalezen (uložen romaji)');
      setTimeout(() => setEnTitleState(null), 3000);
    } catch (err) {
      setEnTitleState('error');
      toast.error(err?.response?.data?.detail || 'AniList: série nenalezena');
      setTimeout(() => setEnTitleState(null), 3000);
    }
  };

  const handleFetchTmdb = async () => {
    setTmdbState('loading');
    try {
      await api.post(`/series/${id}/fetch-tmdb`);
      qc.invalidateQueries(['series', id]);
      setTmdbState('ok');
      toast.success('TMDb data načtena — poster uložen');
      setTimeout(() => setTmdbState(null), 3000);
    } catch (err) {
      setTmdbState('error');
      toast.error(err?.response?.data?.detail || 'TMDb: série nenalezena nebo API klíč chybí');
      setTimeout(() => setTmdbState(null), 3000);
    }
  };

  const handlePromotion = async (promote) => {
    setPromoState('loading');
    const action = promote ? 'publish' : 'demote';
    try {
      await api.post(`/promotion/${action}/${id}`);
      setPromoState('ok');
      toast.success(promote ? 'Povýšení zahájeno — série se přesouvá do anime_series.' : 'Degradace zahájena — série se přesouvá zpět.');
      setTimeout(() => {
        setPromoState(null);
        qc.invalidateQueries(['series', id]);
      }, 2500);
    } catch (err) {
      setPromoState('error');
      toast.error(err?.response?.data?.detail || (promote ? 'Povýšení selhalo' : 'Degradace selhala'));
      setTimeout(() => setPromoState(null), 3000);
    }
  };

  const { data: series, isLoading } = useQuery({
    queryKey: ['series', id],
    queryFn: () => getSeriesById(id).then(r => r.data),
  });

  const { data: episodes = [] } = useQuery({
    queryKey: ['episodes', id],
    queryFn: () => getEpisodes(id),
    enabled: !!series,
  });

  const { data: embyData } = useQuery({
    queryKey: ['emby-url', id],
    queryFn: () => getEmbySeriesUrl(id).then(r => r.data),
    enabled: !!series,
    staleTime: 5 * 60 * 1000,
  });

  const regularEps = useMemo(() => episodes.filter(e => e.season_number > 0), [episodes]);
  const specialEps = useMemo(() => episodes.filter(e => e.season_number === 0), [episodes]);

  const filteredEps = useMemo(() => {
    const base = epFilter === 'specials' ? specialEps : regularEps;
    if (epFilter === 'all' || epFilter === 'specials') return base;
    if (epFilter === 'unwatched') return base.filter(e => !e.watched);
    if (epFilter === 'missing-subs') return base.filter(e => epSubState(e) !== 'both' && epSubState(e) !== 'cs-only');
    return base;
  }, [episodes, epFilter, regularEps, specialEps]);

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
  const total = series.episode_count || regularEps.length || 0;
  const downloaded = series.episodes_with_file || 0;
  const downloadedPct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  const missingCount = regularEps.filter(e => epSubState(e) !== 'both' && epSubState(e) !== 'cs-only').length;

  const year = series.year || (series.first_aired ? new Date(series.first_aired).getFullYear() : null);

  return (
    <div style={{flex:1, minHeight:0, overflowY:'auto', WebkitOverflowScrolling:'touch'}}>
      {subModalEp && (
        <SubSearchModal
          theme={T}
          episodeId={subModalEp.id}
          epLabel={subModalEp.label}
          onClose={() => setSubModalEp(null)}
        />
      )}

      {/* HERO */}
      <div style={{position:'relative', flexShrink:0, overflow:'hidden', borderBottom:`1px solid ${T.border}`}}>
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
          <div style={{position:'relative', padding:'12px 14px 16px', display:'flex', flexDirection:'column', gap:10}}>
            <button onClick={() => navigate('/')} style={{
              ...btnGhost(T), alignSelf:'flex-start',
              background:'rgba(0,0,0,0.35)', border:'1px solid rgba(255,255,255,0.12)',
              color:'#fff', padding:'5px 10px', display:'inline-flex', gap:6, alignItems:'center',
            }}>
              <NavIcon d={ICONS.back}/> Zpět
            </button>
            <div style={{display:'flex', gap:12, alignItems:'flex-start'}}>
              <div style={{width:80, height:120, flexShrink:0, borderRadius:8, overflow:'hidden',
                border:`1px solid ${T.borderStrong}`, position:'relative'}}>
                {(series.cover_url || series.poster_url)
                  ? <img src={series.cover_url || series.poster_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                  : <div style={{width:'100%',height:'100%',
                      background:`linear-gradient(135deg, hsl(${hue},55%,28%), hsl(${(hue+60)%360},45%,16%))`,
                      display:'grid', placeItems:'center',
                      font:`700 22px "Space Grotesk"`, color:'rgba(255,255,255,0.55)'}}>
                      {(series.title_romaji || series.title || '?')[0]}
                    </div>
                }
              </div>
              <div style={{flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:6, color:'#fff'}}>
                <div style={{font:'700 18px/1.15 "Space Grotesk"', color:'#fff', letterSpacing:'-0.01em',
                  overflow:'hidden', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical'}}>
                  {series.title_english || series.title_romaji || series.title}
                </div>
                <div style={{font:'500 11px "Noto Sans JP"', color:'rgba(255,255,255,0.65)'}}>
                  {series.title_japanese || ''}
                </div>
                <div style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginTop:2}}>
                  <StatusPill theme={T} color={statusCol} label={meta.label}/>
                  {series.promoted ? (
                    <span style={{font:'700 10px JetBrains Mono',
                      color:'#57f287', background:'rgba(87,242,135,0.18)',
                      padding:'2px 7px', borderRadius:99, border:'1px solid rgba(87,242,135,0.35)'}}>
                      ↑ Povýšeno
                    </span>
                  ) : series.has_issue ? (
                    <span style={{font:'700 10px JetBrains Mono',
                      color:'#fee75c', background:'rgba(254,231,92,0.15)',
                      padding:'2px 7px', borderRadius:99, border:'1px solid rgba(254,231,92,0.35)'}}>
                      ⚠ Issue
                    </span>
                  ) : null}
                  <AuditStatusBadge status={series.audit_status}/>
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
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <div style={{flex:1, height:4, background:'rgba(0,0,0,0.4)', borderRadius:99, overflow:'hidden'}}>
                <div style={{width:`${downloadedPct}%`, height:'100%', background:T.accent, borderRadius:99,
                  boxShadow:`0 0 8px ${T.accent}`}}/>
              </div>
              <div style={{font:'600 11px JetBrains Mono', color:'#fff', whiteSpace:'nowrap'}}>
                {downloaded}/{total} · {Math.round(downloadedPct)}%
              </div>
            </div>
            <div style={{display:'flex', gap:6}}>
              <button
                onClick={() => {
                  const nextEp = regularEps.find(e => !e.watched && e.has_file) || regularEps[0];
                  if (nextEp?.id) navigate(`/player/${id}/${nextEp.id}`);
                }}
                style={{...btnPrimary(T), flex:1, padding:'9px 12px', fontSize:13,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6}}>
                ▶ EP {(() => { const ep = regularEps.find(e => !e.watched && e.has_file) || regularEps[0]; return ep ? String(ep.episode_number || 1).padStart(2,'0') : '01'; })()}
              </button>
              <button
                disabled={!embyData?.url}
                onClick={() => embyData?.url && window.open(embyData.url, '_blank', 'noopener,noreferrer')}
                title={embyData?.url ? 'Otevřít v Emby' : 'Série není v Emby'}
                style={{...btnSub(T), padding:'9px 12px', fontSize:12,
                  background:'rgba(255,255,255,0.12)', color:'#fff',
                  border:'1px solid rgba(255,255,255,0.2)', whiteSpace:'nowrap',
                  opacity: embyData?.url ? 1 : 0.4,
                  cursor: embyData?.url ? 'pointer' : 'default'}}>
                ▶ Emby
              </button>
              <div style={{display:'flex', gap:0}}>
                <button
                  disabled={subDlState === 'loading'}
                  onClick={() => handleSubDownload(missingCount === 0)}
                  title={missingCount > 0 ? `Stáhnout titulky pro ${missingCount} epizod` : 'Re-search: hledat znovu pro všechny epizody'}
                  style={{...btnSub(T), padding:'9px 10px', fontSize:12,
                    background:'rgba(255,255,255,0.12)', color:'#fff',
                    border:'1px solid rgba(255,255,255,0.2)', borderRight:'none',
                    borderRadius:'6px 0 0 6px', whiteSpace:'nowrap',
                    opacity: subDlState === 'loading' ? 0.5 : 1}}>
                  {subDlState === 'loading' ? '⏳'
                    : subDlState === 'ok' ? '✓ Zahájeno'
                    : subDlState === 'error' ? '✗ Chyba'
                    : missingCount > 0 ? `↓ Titulky (${missingCount})`
                    : '↓ Titulky ✓'}
                </button>
                <button
                  disabled={subDlState === 'loading'}
                  onClick={() => handleSubDownload(true)}
                  title="Force re-search: hledat znovu pro VŠECHNY epizody"
                  style={{...btnSub(T), padding:'9px 8px', fontSize:11,
                    background:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.6)',
                    border:'1px solid rgba(255,255,255,0.2)',
                    borderRadius:'0 6px 6px 0', whiteSpace:'nowrap',
                    opacity: subDlState === 'loading' ? 0.5 : 1}}>
                  ↺
                </button>
              </div>
              {/* Promotion / demotion — mobile */}
              {series && (series.promoted ? (
                <button
                  disabled={promoState === 'loading'}
                  onClick={() => handlePromotion(false)}
                  title="Degradovat"
                  style={{...btnSub(T), padding:'9px 10px', fontSize:12, flexShrink:0,
                    background:'rgba(237,66,69,0.25)', color:'#ff8080',
                    border:'1px solid rgba(237,66,69,0.45)',
                    opacity: promoState === 'loading' ? 0.6 : 1}}>
                  {promoState === 'loading' ? '⏳' : promoState === 'ok' ? '✓' : '↓'}
                </button>
              ) : (
                <button
                  disabled={promoState === 'loading'}
                  onClick={() => handlePromotion(true)}
                  title="Povýšit"
                  style={{...btnSub(T), padding:'9px 10px', fontSize:12, flexShrink:0,
                    background:'rgba(87,242,135,0.2)', color:'#57f287',
                    border:'1px solid rgba(87,242,135,0.4)',
                    opacity: promoState === 'loading' ? 0.6 : 1}}>
                  {promoState === 'loading' ? '⏳' : promoState === 'ok' ? '✓' : '↑'}
                </button>
              ))}
            </div>
          </div>
        ) : (
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
                  {series.title_english || series.title_romaji || series.title}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <StatusPill theme={T} color={statusCol} label={meta.label}/>
                {series.promoted ? (
                  <span style={{font:'700 11px JetBrains Mono',
                    color:'#57f287', background:'rgba(87,242,135,0.18)',
                    padding:'3px 9px', borderRadius:99, border:'1px solid rgba(87,242,135,0.35)'}}>
                    ↑ Povýšeno
                  </span>
                ) : series.has_issue ? (
                  <span style={{font:'700 11px JetBrains Mono',
                    color:'#fee75c', background:'rgba(254,231,92,0.15)',
                    padding:'3px 9px', borderRadius:99, border:'1px solid rgba(254,231,92,0.35)'}}>
                    ⚠ Issue
                  </span>
                ) : null}
                <AuditStatusBadge status={series.audit_status} size="lg"/>
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
                <button
                  onClick={() => {
                    const nextEp = regularEps.find(e => !e.watched && e.has_file) || regularEps[0];
                    if (nextEp?.id) navigate(`/player/${id}/${nextEp.id}`);
                  }}
                  style={{...btnPrimary(T),padding:'8px 16px',fontSize:13}}>
                  ▶ Pokračovat EP {downloaded + 1 <= total ? String(downloaded + 1).padStart(2,'0') : '—'}
                </button>
                <button
                  disabled={!embyData?.url}
                  onClick={() => embyData?.url && window.open(embyData.url, '_blank', 'noopener,noreferrer')}
                  title={embyData?.url ? 'Otevřít v Emby' : 'Série není v Emby'}
                  style={{...btnSub(T),background:'rgba(255,255,255,0.12)',color:'#fff',
                    border:'1px solid rgba(255,255,255,0.2)',
                    padding:'7px 12px', fontSize:13, borderRadius:8,
                    opacity: embyData?.url ? 1 : 0.4,
                    cursor: embyData?.url ? 'pointer' : 'default'}}>
                  ▶ Emby
                </button>
                {/* Subtitle auto-download — always visible; force=true when nothing is missing */}
                <div style={{display:'flex', gap:0}}>
                  <button
                    disabled={subDlState === 'loading'}
                    onClick={() => handleSubDownload(missingCount === 0)}
                    title={missingCount > 0
                      ? `Automaticky stáhnout CZ titulky pro ${missingCount} epizod bez titulků`
                      : 'Všechny epizody mají titulky — klikni pro force re-search'}
                    style={{...btnSub(T), background:'rgba(255,255,255,0.12)', color:'#fff',
                      border:'1px solid rgba(255,255,255,0.2)',
                      borderRight: 'none',
                      borderRadius: '8px 0 0 8px',
                      padding:'7px 12px', fontSize:13,
                      opacity: subDlState === 'loading' ? 0.5 : 1}}>
                    {subDlState === 'loading' ? '⏳ Hledám…'
                      : subDlState === 'ok' ? '✓ Zahájeno'
                      : subDlState === 'error' ? '✗ Chyba'
                      : missingCount > 0 ? `↓ Titulky (${missingCount})` : '↓ Titulky ✓'}
                  </button>
                  <button
                    disabled={subDlState === 'loading'}
                    onClick={() => handleSubDownload(true)}
                    title="Force re-search: hledat znovu pro VŠECHNY epizody (i ty s titulky)"
                    style={{...btnSub(T), background:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.6)',
                      border:'1px solid rgba(255,255,255,0.2)',
                      borderRadius: '0 8px 8px 0',
                      padding: '7px 10px',
                      fontSize: 13}}>
                    ↺
                  </button>
                </div>
                <button
                  disabled={nfoState === 'loading'}
                  onClick={async () => {
                    setNfoState('loading');
                    try {
                      await refreshSeriesNfo(series.id);
                      setNfoState('ok');
                      setTimeout(() => setNfoState(null), 3000);
                    } catch {
                      setNfoState('error');
                      setTimeout(() => setNfoState(null), 3000);
                    }
                  }}
                  style={{...btnSub(T),background:'rgba(255,255,255,0.12)',color:'#fff',
                    border:'1px solid rgba(255,255,255,0.2)',
                    padding:'7px 12px', fontSize:13, borderRadius:8,
                    opacity: nfoState === 'loading' ? 0.6 : 1}}>
                  {nfoState === 'loading' ? '⏳ NFO…' : nfoState === 'ok' ? '✓ NFO' : nfoState === 'error' ? '✗ NFO' : '↻ NFO'}
                </button>
                <button
                  disabled={langCheckState === 'loading'}
                  title="Zkontroluje jazyk všech titulků a přejmenuje špatně označené (SK/EN→CS)"
                  onClick={async () => {
                    setLangCheckState('loading');
                    try {
                      const res = await api.post('/subtitles/langcheck', { dry_run: false, min_conf_pct: 80 });
                      const fixed = res?.data?.fixed ?? 0;
                      setLangCheckState('ok');
                      toast.success(`Langcheck dokončen — přejmenováno ${fixed} titulků`);
                      setTimeout(() => setLangCheckState(null), 3000);
                    } catch {
                      setLangCheckState('error');
                      toast.error('Langcheck selhal');
                      setTimeout(() => setLangCheckState(null), 3000);
                    }
                  }}
                  style={{...btnSub(T), background:'rgba(255,255,255,0.12)', color:'#fff',
                    border:'1px solid rgba(255,255,255,0.2)',
                    padding:'7px 12px', fontSize:13, borderRadius:8,
                    opacity: langCheckState === 'loading' ? 0.6 : 1}}>
                  {langCheckState === 'loading' ? '⏳ Kontroluji…'
                    : langCheckState === 'ok' ? '✓ Hotovo'
                    : langCheckState === 'error' ? '✗ Chyba'
                    : '🔍 Zkontrolovat jazyk titulků'}
                </button>
                <button
                  disabled={translateState === 'loading' || !aiReady}
                  title={!aiReady ? 'AI provider není nastaven — zkonfigurujte v Nastavení' : undefined}
                  onClick={() => aiReady && handleTranslate(!!series.overview_cs)}
                  style={{...btnSub(T),background:'rgba(255,255,255,0.12)',color:'#fff',
                    border:'1px solid rgba(255,255,255,0.2)',
                    padding:'7px 12px', fontSize:13, borderRadius:8,
                    opacity: (translateState === 'loading' || !aiReady) ? 0.4 : 1,
                    cursor: !aiReady ? 'not-allowed' : 'pointer'}}>
                  {!aiReady ? '🤖 AI nenastaven'
                    : translateState === 'loading' ? '⏳ Překládám…'
                    : translateState === 'ok' ? '✓ Přeloženo'
                    : translateState === 'error' ? '✗ Chyba'
                    : series.overview_cs ? '↺ Přeložit znovu'
                    : '🌐 Přeložit popis'}
                </button>
                <button
                  disabled={tmdbState === 'loading'}
                  onClick={handleFetchTmdb}
                  title="Načíst poster a metadata ze The Movie Database"
                  style={{...btnSub(T),background:'rgba(255,255,255,0.12)',color:'#fff',
                    border:'1px solid rgba(255,255,255,0.2)',
                    opacity: tmdbState === 'loading' ? 0.6 : 1}}>
                  {tmdbState === 'loading' ? '⏳ TMDb…'
                    : tmdbState === 'ok' ? '✓ TMDb'
                    : tmdbState === 'error' ? '✗ TMDb'
                    : '🎬 Načíst TMDb'}
                </button>
                {/* Promotion / demotion */}
                {series && (series.promoted ? (
                  <button
                    disabled={promoState === 'loading'}
                    onClick={() => handlePromotion(false)}
                    title="Degradovat — přesunout zpět do složky incomplete"
                    style={{...btnSub(T), padding:'7px 14px', fontSize:13, borderRadius:8,
                      background:'rgba(237,66,69,0.25)', color:'#ff8080',
                      border:'1px solid rgba(237,66,69,0.45)',
                      opacity: promoState === 'loading' ? 0.6 : 1}}>
                    {promoState === 'loading' ? '⏳ Degraduji…'
                      : promoState === 'ok' ? '✓ Zahájeno'
                      : promoState === 'error' ? '✗ Chyba'
                      : '↓ Degradovat'}
                  </button>
                ) : (
                  <button
                    disabled={promoState === 'loading'}
                    onClick={() => handlePromotion(true)}
                    title="Povýšit — přesunout do složky anime_series"
                    style={{...btnSub(T), padding:'7px 14px', fontSize:13, borderRadius:8,
                      background:'rgba(87,242,135,0.2)', color:'#57f287',
                      border:'1px solid rgba(87,242,135,0.4)',
                      opacity: promoState === 'loading' ? 0.6 : 1}}>
                    {promoState === 'loading' ? '⏳ Povyšuji…'
                      : promoState === 'ok' ? '✓ Zahájeno'
                      : promoState === 'error' ? '✗ Chyba'
                      : '↑ Povýšit'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* TABS — sticky pod hero */}
      <div style={{display:'flex',gap:2,padding:'0 24px',borderBottom:`1px solid ${T.border}`,
        background:T.panel, position:'sticky', top:0, zIndex:10}}>
        {[
          ['eps',      `Epizody · ${total}`],
          ['schedule', 'Harmonogram'],
          ['info',     'Info'],
          ['log',      'Log'],
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
      <div style={{
        padding: isMobile ? '12px 10px' : '18px 24px',
        display:'flex',
        flexDirection:'column',
        gap:14,
        paddingBottom: selectedEpIds.size > 0 ? 80 : (isMobile ? 24 : 32),
      }}>
        {activeTab === 'eps' && <>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <FilterPill theme={T} label="Vše"           active={epFilter==='all'}          count={regularEps.length} onClick={() => setEpFilter('all')}/>
            <FilterPill theme={T} label="Nesledováno"   active={epFilter==='unwatched'}    count={regularEps.filter(e => !e.watched).length} onClick={() => setEpFilter('unwatched')}/>
            <FilterPill theme={T} label="Chybí titulky" active={epFilter==='missing-subs'} count={missingCount} onClick={() => setEpFilter('missing-subs')}/>
            {specialEps.length > 0 && (
              <FilterPill theme={T} label="Speciály" active={epFilter==='specials'} count={specialEps.length} onClick={() => setEpFilter('specials')}/>
            )}
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

          {filteredEps.length > 0 ? (() => {
            const seasons = [...new Set(filteredEps.map(e => e.season_number))].sort((a, b) => a - b);
            const isSpecialsView = epFilter === 'specials';
            const multiSeason = seasons.length > 1;
            const showHeaders = isSpecialsView || multiSeason;

            if (!showHeaders) {
              return (
                <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
                  {filteredEps.map((ep, i) => {
                    const epKey = ep.id || ep.episode_number;
                    return (
                      <EpisodeRow
                        key={epKey} ep={ep} series={series}
                        index={i}
                        last={i === filteredEps.length - 1}
                        selected={selectedEpIds.has(epKey)}
                        onSelect={() => toggleEp(epKey)}
                        onOpenSubs={() => setSubModalEp({
                          id: ep.id,
                          label: (() => { const t = ep.title || series.title_romaji || series.title || ''; return `EP ${String(ep.episode_number || 0).padStart(2,'0')} · ${t.length > 50 ? t.slice(0,50)+'…' : t}`; })(),
                        })}
                        onPlay={() => handlePlayEpisode(ep.id)}
                        onEdit={() => navigate(`/player/${id}/${ep.id}`)}
                        isMobile={isMobile}
                        expanded={expandedEpId === epKey}
                        onToggle={() => toggleExpand(epKey)}
                      />
                    );
                  })}
                </div>
              );
            }

            const bySeasonMap = {};
            for (const ep of filteredEps) {
              const s = ep.season_number;
              if (!bySeasonMap[s]) bySeasonMap[s] = [];
              bySeasonMap[s].push(ep);
            }

            return (
              <div style={{display:'flex',flexDirection:'column',gap:16}}>
                {seasons.map(seasonNum => {
                  const eps = bySeasonMap[seasonNum] || [];
                  const header = seasonNum === 0 ? 'Speciály' : `Sezóna ${seasonNum}`;
                  return (
                    <div key={seasonNum}>
                      <div style={{
                        font:'700 11px JetBrains Mono',color:T.textDim,
                        letterSpacing:'.08em',marginBottom:8,textTransform:'uppercase',
                      }}>
                        {header}
                      </div>
                      <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
                        {eps.map((ep, i) => {
                          const epKey = ep.id || ep.episode_number;
                          return (
                            <EpisodeRow
                              key={epKey} ep={ep} series={series}
                              index={i}
                              last={i === eps.length - 1}
                              selected={selectedEpIds.has(epKey)}
                              onSelect={() => toggleEp(epKey)}
                              onOpenSubs={() => setSubModalEp({
                                id: ep.id,
                                label: (() => { const t = ep.title || series.title_romaji || series.title || ''; return `S${String(seasonNum).padStart(2,'0')}E${String(ep.episode_number || 0).padStart(2,'0')} · ${t.length > 50 ? t.slice(0,50)+'…' : t}`; })(),
                              })}
                              onPlay={() => handlePlayEpisode(ep.id)}
                              onEdit={() => navigate(`/player/${id}/${ep.id}`)}
                              isMobile={isMobile}
                              expanded={expandedEpId === epKey}
                              onToggle={() => toggleExpand(epKey)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })() : (
            <div style={{padding:40,textAlign:'center',color:T.textMute,font:'500 13px "Space Grotesk"'}}>
              Žádné epizody
            </div>
          )}
        </>}

        {activeTab === 'schedule' && <ScheduleView episodes={episodes} series={series} isMobile={isMobile}/>}

        {activeTab === 'info' && <InfoView series={series} isMobile={isMobile} onTranslate={handleTranslate} translateState={translateState} onFetchEnTitle={handleFetchEnTitle} enTitleState={enTitleState}/>}

        {activeTab === 'log' && <LogView seriesId={id} series={series} isMobile={isMobile}/>}
      </div>

      <EpisodeBulkBar theme={T} selectedIds={selectedEpIds} episodes={episodes} onClear={clearEpSelection}/>
    </div>
  );
}
