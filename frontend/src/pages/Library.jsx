import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSeries, getLibraryStats } from '../api/client';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, StatCard, FilterPill, StatusPill, AnimePoster,
  statusMeta, statusColor,
} from '../v1design';

const T = THEME;

function toFilterKey(status) {
  const m = {
    RELEASING: 'airing', FINISHED: 'completed', NOT_YET_RELEASED: 'upcoming',
    CANCELLED: 'ended', HIATUS: 'upcoming',
    Continuing: 'airing', Ended: 'ended', Upcoming: 'upcoming', Deleted: 'ended',
    continuing: 'airing', ended: 'completed', upcoming: 'upcoming', deleted: 'ended',
  };
  return m[status] || 'ended';
}

// ── Library card (grid view) ────────────────────────────────────────────────
function LibraryCard({ series, selected, onSelect, onOpen, compact = false }) {
  const meta = statusMeta(series.status);
  const color = T[meta.colorKey];
  const total = series.episode_count || series.episodes_monitored || 0;
  const downloaded = series.episodes_with_file || 0;
  const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  const next = series.next_airing || null;

  return (
    <div
      style={{ display:'flex', flexDirection:'column', gap: compact ? 3 : 6,
        cursor:'pointer', outline: selected ? `2px solid ${T.accent}` : 'none', borderRadius:8 }}
      onClick={onOpen}
    >
      {/* Poster */}
      <div style={{ position:'relative' }}>
        <div style={{ width:'100%', aspectRatio:'2/3', borderRadius: compact ? 5 : 6,
          overflow:'hidden', border:`1px solid ${T.borderStrong}`, position:'relative' }}>
          {series.cover_url
            ? <img src={series.cover_url} alt={series.title_romaji || series.title || ''}
                style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
            : <AnimePoster series={series} theme={T} size="lg" radius={compact ? 5 : 6}/>
          }
          {/* Promoted badge */}
          {series.promoted && (
            <div style={{
              position:'absolute', top: compact ? 4 : 6, left: compact ? 4 : 6,
              background:'rgba(34,197,94,0.92)', color:'#fff',
              font:'700 8px JetBrains Mono', padding:'2px 5px',
              borderRadius:99, letterSpacing:'.03em', whiteSpace:'nowrap',
              boxShadow:'0 1px 6px rgba(0,0,0,0.5)',
            }}>✓ Pub</div>
          )}
          {/* Status badge — over poster */}
          <div style={{ position:'absolute', right: compact ? 4 : 5, bottom: compact ? 4 : 5 }}>
            <StatusPill theme={T} color={color} label={meta.label} size="sm"/>
          </div>
        </div>

        {/* Checkbox — top-right corner */}
        <div
          style={{ position:'absolute', top: compact ? 4 : 5, right: compact ? 4 : 5,
            width:16, height:16, borderRadius:3,
            background: selected ? T.accent : 'rgba(0,0,0,0.55)',
            border:`2px solid ${selected ? T.accent : 'rgba(255,255,255,0.35)'}`,
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', zIndex:2 }}
          onClick={e => { e.stopPropagation(); onSelect(); }}
        >
          {selected && <span style={{ color:'#fff', fontSize:9, lineHeight:1 }}>✓</span>}
        </div>
      </div>

      {/* Info below poster */}
      <div style={{ display:'flex', flexDirection:'column', gap:2, padding: compact ? '0 3px' : '0 2px' }}>
        <div style={{
          font: `600 ${compact ? 11 : 12}px "Space Grotesk"`, color:T.text,
          overflow:'hidden', display:'-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient:'vertical',
          lineHeight:1.3,
        }}>
          {series.title_romaji || series.title}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:4,
          font:'500 10px JetBrains Mono', color:T.textMute }}>
          <span>{series.year || (series.first_aired ? new Date(series.first_aired).getFullYear() : '?')}</span>
          <span style={{ color:T.border }}>·</span>
          <span style={{ color:T.textDim }}>{downloaded}/{total}</span>
        </div>
        <div style={{ height:2, background:T.sunken, borderRadius:99, overflow:'hidden', marginTop:1 }}>
          <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:99 }}/>
        </div>
        {!compact && next && (
          <div style={{ font:'500 9px JetBrains Mono', color:T.accent2, marginTop:1 }}>▸ {next}</div>
        )}
      </div>
    </div>
  );
}

// ── Library row (list view — desktop only) ───────────────────────────────────
function LibraryRow({ series, last, selected, onSelect, onOpen }) {
  const meta = statusMeta(series.status);
  const color = T[meta.colorKey];
  const total = series.episode_count || series.episodes_monitored || 0;
  const downloaded = series.episodes_with_file || 0;
  const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  const genres = series.genres || [];
  const score = series.average_score;

  return (
    <div onClick={onOpen} style={{
      display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer',
      overflow:'hidden',
      borderBottom: last ? 'none' : `1px solid ${T.border}`,
      background: selected ? `${T.accent}11` : 'transparent',
    }}>
      <div
        style={{ flex:'0 0 18px', width:16, height:16, borderRadius:3,
          background: selected ? T.accent : 'transparent',
          border:`2px solid ${selected ? T.accent : T.borderStrong}`,
          display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}
        onClick={e => { e.stopPropagation(); onSelect(); }}
      >
        {selected && <span style={{ color:'#fff', fontSize:9, lineHeight:1 }}>✓</span>}
      </div>
      <div style={{ flex:'0 0 46px' }}><AnimePoster series={series} theme={T} size="sm" radius={4}/></div>
      <div style={{ flex:'1 1 0', minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ font:'600 13px "Space Grotesk"', color:T.text,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {series.title_romaji || series.title}
          </div>
          {series.promoted && <StatusPill theme={T} color={T.statusDone} label="✓ Pub" size="sm" dot={false}/>}
        </div>
        <div style={{ font:'500 11px "Noto Sans JP"', color:T.textDim,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {series.title_japanese || series.title}
        </div>
      </div>
      <div style={{ flex:'0 0 140px', display:'flex', gap:4, flexWrap:'wrap' }}>
        {genres.slice(0, 2).map(g => (
          <span key={g} style={{ font:'500 10px JetBrains Mono', color:T.textDim,
            background:T.panel2, padding:'2px 5px', borderRadius:4, border:`1px solid ${T.border}` }}>{g}</span>
        ))}
      </div>
      <div style={{ flex:'0 0 90px' }}><StatusPill theme={T} color={color} label={meta.label} size="sm"/></div>
      <div style={{ flex:'0 0 100px', font:'500 11px JetBrains Mono', color:T.textDim }}>
        {downloaded}/{total} ep
        <div style={{ height:3, background:T.sunken, borderRadius:99, marginTop:3 }}>
          <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:99 }}/>
        </div>
      </div>
      <div style={{ flex:'0 0 80px', font:'500 11px JetBrains Mono', color:T.accent2 }}>
        {series.next_airing || '—'}
      </div>
      <div style={{ flex:'0 0 50px', font:'600 11px JetBrains Mono', color:T.text, textAlign:'right' }}>
        {score > 0 ? `★ ${Number(score).toFixed(1)}` : '—'}
      </div>
    </div>
  );
}

// ── Schedule modal ────────────────────────────────────────────────────────────
function ScheduleModal({ onClose, ids }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const inp = { padding:'7px 10px', background:T.panel2, color:T.text,
    border:`1px solid ${T.border}`, borderRadius:6, outline:'none',
    font:'500 12px "Space Grotesk"', colorScheme:'dark' };
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:T.panel, border:`1px solid ${T.borderStrong}`, borderRadius:12,
        padding:24, minWidth:300, display:'flex', flexDirection:'column', gap:14 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ font:'700 15px "Space Grotesk"', color:T.text }}>Naplánovat publikaci</div>
        <div style={{ font:'500 11px "Space Grotesk"', color:T.textDim }}>{ids.size} vybraných</div>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <label style={{ font:'600 10px JetBrains Mono', color:T.textMute }}>DATUM</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp}/>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <label style={{ font:'600 10px JetBrains Mono', color:T.textMute }}>ČAS</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inp}/>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button style={btnSub(T)} onClick={onClose}>Zrušit</button>
          <button style={btnPrimary(T)} onClick={onClose}>Potvrdit</button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk action bar ───────────────────────────────────────────────────────────
function BulkActionBar({ selectedIds, seriesList, onClear }) {
  const isMobile = useIsMobile();
  const [showSchedule, setShowSchedule] = useState(false);
  const count = selectedIds.size;
  if (count === 0) return null;

  const anyPromoted = [...selectedIds].some(id => seriesList.find(s => s.id === id)?.promoted);

  const btnStyle = (primary) => ({
    ...(primary ? btnPrimary(T) : btnSub(T)),
    padding: isMobile ? '8px 12px' : '6px 12px',
    fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap',
  });

  return (
    <>
      {showSchedule && <ScheduleModal ids={selectedIds} onClose={() => setShowSchedule(false)}/>}
      <div style={{
        position:'sticky', bottom:0,
        background:`${T.panel}f0`, backdropFilter:'blur(12px)',
        borderTop:`1px solid ${T.borderStrong}`,
        flexShrink:0, zIndex:100,
      }}>
        {/* Horizontally scrollable button row */}
        <div style={{
          display:'flex', alignItems:'center', gap:8,
          padding: isMobile ? '10px 12px' : '10px 24px',
          overflowX:'auto', scrollbarWidth:'none',
        }}>
          <div style={{ font:'600 12px "Space Grotesk"', color:T.text, flexShrink:0, marginRight:2 }}>
            {count} vybráno
          </div>
          {!anyPromoted && (
            <button style={btnStyle(true)} onClick={() => alert('Publikovat')}>✓ Publikovat</button>
          )}
          {anyPromoted && (
            <button style={btnStyle(false)} onClick={() => alert('Stáhnout')}>↓ Stáhnout z publ.</button>
          )}
          <button style={btnStyle(false)} onClick={() => setShowSchedule(true)}>⏱ Časovat</button>
          <button style={btnStyle(false)} onClick={() => alert('Titulky')}>↓ Titulky</button>
          <button style={{ ...btnGhost(T), padding: isMobile ? '8px 12px' : '6px 12px',
            fontSize:12, flexShrink:0, whiteSpace:'nowrap' }}
            onClick={() => alert('Smazat')}>✕ Smazat titulky</button>
          <div style={{ flex:1, minWidth:16 }}/>
          <button style={{ ...btnGhost(T), padding: isMobile ? '8px 12px' : '6px 10px',
            fontSize:12, flexShrink:0, whiteSpace:'nowrap' }}
            onClick={onClear}>✕ Zrušit</button>
        </div>
      </div>
    </>
  );
}

const PAGE_SIZE = 36;

// ── Main Library page ─────────────────────────────────────────────────────────
export default function Library() {
  const navigate  = useNavigate();
  const isMobile  = useIsMobile();
  const [filter, setFilter]       = useState('all');
  const [view, setView]           = useState('grid');
  const [search, setSearch]       = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds]   = useState(new Set());
  const [showSearch, setShowSearch]     = useState(false);

  const { data: seriesList = [], isLoading } = useQuery({
    queryKey: ['series'],
    queryFn: () => getSeries().then(r => r.data),
  });
  const { data: stats } = useQuery({
    queryKey: ['library-stats'],
    queryFn: () => getLibraryStats().then(r => r.data),
  });

  const counts = useMemo(() => {
    const c = { all: seriesList.length, airing: 0, upcoming: 0, completed: 0, ended: 0 };
    for (const s of seriesList) { const k = toFilterKey(s.status); if (c[k] != null) c[k]++; }
    return c;
  }, [seriesList]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? seriesList : seriesList.filter(s => toFilterKey(s.status) === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.title_romaji || '').toLowerCase().includes(q) ||
        (s.title_japanese || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [seriesList, filter, search]);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filter, search]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const watching   = seriesList.filter(s => toFilterKey(s.status) === 'airing').length;
  const totalEps   = seriesList.reduce((s, a) => s + (a.episode_count || 0), 0);
  const watchedEps = seriesList.reduce((s, a) => s + (a.episodes_with_file || 0), 0);

  // On mobile: always grid, no list view
  const effectiveView = isMobile ? 'grid' : view;
  const pad = isMobile ? '10px 12px' : '18px 24px';

  if (isLoading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%',
      color:T.textDim, font:'500 14px "Space Grotesk"' }}>
      Načítám knihovnu…
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      {/* Header — hide on mobile to save space */}
      {!isMobile && (
        <PageHeader theme={T} title="Knihovna"
          subtitle={`${seriesList.length} titulů · ${watchedEps}/${totalEps} epizod staženo`}
          right={<>
            <button style={btnSub(T)}>↑ Import</button>
            <button style={btnPrimary(T)}>+ Přidat anime</button>
          </>}
        />
      )}

      <div style={{ flex:1, overflowY:'auto', padding:pad,
        display:'flex', flexDirection:'column', gap: isMobile ? 8 : 18 }}>

        {/* Stats — 2-col grid on mobile, flex row on desktop */}
        {isMobile ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:8 }}>
            {[
              { label:'Sleduje',    value:watching,                       sub:'aktivní série',    accent:T.statusAiring },
              { label:'Plánuje',    value:counts.upcoming,                sub:'čeká na premiéru', accent:T.statusUpcoming },
              { label:'Dokončeno',  value:counts.completed,               sub:'hotové série',     accent:T.statusDone },
              { label:'Stahování',  value:stats?.active_downloads ?? '—', sub:'aktivních úloh',  accent:T.accent },
            ].map(p => (
              <StatCard key={p.label} theme={T} label={p.label} value={p.value} sub={p.sub} accent={p.accent}/>
            ))}
          </div>
        ) : (
          <div style={{ display:'flex', gap:10 }}>
            <StatCard theme={T} label="Sleduji"   value={watching}                       sub="aktivní série"    accent={T.statusAiring}/>
            <StatCard theme={T} label="Plánuji"   value={counts.upcoming}                sub="čeká na premiéru" accent={T.statusUpcoming}/>
            <StatCard theme={T} label="Dokončeno" value={counts.completed}               sub="hotové série"     accent={T.statusDone}/>
            <StatCard theme={T} label="Stahování" value={stats?.active_downloads ?? '—'} sub="aktivních úloh"  accent={T.accent}/>
            <StatCard theme={T} label="Na disku"  value={stats?.disk_used ?? '—'}        sub={stats?.disk_total ? `z ${stats.disk_total}` : 'použito'} accent={T.accent2}/>
          </div>
        )}

        {/* Mobile: filter pills + search */}
        {isMobile ? (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {/* Filter pills — horizontal scroll */}
            <div style={{ display:'flex', gap:6, overflowX:'auto', scrollbarWidth:'none', paddingBottom:2 }}>
              {[
                { label:'Vše',       key:'all',       count:counts.all },
                { label:'Vysílá se', key:'airing',    count:counts.airing },
                { label:'Dokončeno', key:'completed', count:counts.completed },
                { label:'Chystá se', key:'upcoming',  count:counts.upcoming },
                { label:'Skončilo',  key:'ended',     count:counts.ended },
              ].map(f => (
                <div key={f.key} style={{ flexShrink:0 }}>
                  <FilterPill theme={T} label={f.label} active={filter===f.key}
                    count={f.count} onClick={() => setFilter(f.key)}/>
                </div>
              ))}
            </div>
            {/* Search full width */}
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Hledat v knihovně…"
              style={{
                width:'100%', boxSizing:'border-box',
                background:T.panel2, border:`1px solid ${T.border}`, borderRadius:8,
                padding:'9px 12px', color:T.text, outline:'none',
                font:'500 13px "Space Grotesk"',
              }}
            />
          </div>
        ) : (
          /* Desktop: filters + search + view toggle in one row */
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <FilterPill theme={T} label="Vše"        active={filter==='all'}       count={counts.all}       onClick={() => setFilter('all')}/>
            <FilterPill theme={T} label="Vysílá se"  active={filter==='airing'}    count={counts.airing}    onClick={() => setFilter('airing')}/>
            <FilterPill theme={T} label="Dokončeno"  active={filter==='completed'} count={counts.completed} onClick={() => setFilter('completed')}/>
            <FilterPill theme={T} label="Chystá se"  active={filter==='upcoming'}  count={counts.upcoming}  onClick={() => setFilter('upcoming')}/>
            <FilterPill theme={T} label="Skončilo"   active={filter==='ended'}     count={counts.ended}     onClick={() => setFilter('ended')}/>
            <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
              {selectedIds.size > 0 && (
                <div style={{ font:'600 11px JetBrains Mono', color:T.accent }}>
                  {selectedIds.size} vybráno
                </div>
              )}
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Hledat v knihovně…"
                style={{
                  background:T.panel2, border:`1px solid ${T.border}`, borderRadius:8,
                  padding:'7px 12px', color:T.text, outline:'none',
                  font:'500 12px "Space Grotesk"', width:220,
                }}
              />
              <div style={{ display:'flex', background:T.panel2, padding:2, borderRadius:8, border:`1px solid ${T.border}` }}>
                {[['grid','⊞ Karty'],['list','☰ Seznam']].map(([v, l]) => (
                  <button key={v} onClick={() => setView(v)} style={{
                    padding:'4px 10px', borderRadius:6, border:'none', cursor:'pointer',
                    background:view===v ? T.panel : 'transparent',
                    color:view===v ? T.accent : T.textDim,
                    font:'600 11px "Space Grotesk"',
                  }}>{l}</button>
                ))}
              </div>
              <button style={{ ...btnGhost(T), padding:'6px 10px', fontSize:12 }}>↓ Setřídit ▾</button>
            </div>
          </div>
        )}

        {/* Content */}
        {effectiveView === 'grid' ? (
          <div style={{
            display:'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(190px, 1fr))',
            gap: isMobile ? 8 : 16,
          }}>
            {visible.map(s => (
              <LibraryCard
                key={s.id} series={s}
                compact={isMobile}
                selected={selectedIds.has(s.id)}
                onSelect={() => toggleSelect(s.id)}
                onOpen={() => navigate(`/series/${s.id}`)}
              />
            ))}
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', background:T.panel,
            border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden' }}>
            {visible.map((s, i) => (
              <LibraryRow
                key={s.id} series={s}
                last={i === visible.length - 1}
                selected={selectedIds.has(s.id)}
                onSelect={() => toggleSelect(s.id)}
                onOpen={() => navigate(`/series/${s.id}`)}
              />
            ))}
          </div>
        )}

        {filtered.length === 0 && !isLoading && (
          <div style={{ padding:40, textAlign:'center', color:T.textMute, font:'500 13px "Space Grotesk"' }}>
            Žádné výsledky
          </div>
        )}

        {hasMore && (
          <div style={{ display:'flex', justifyContent:'center', paddingBottom:8 }}>
            <button
              onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              style={{ ...btnSub(T), padding:'10px 28px', fontSize:13, border:`1px solid ${T.borderStrong}` }}>
              Načíst více ({filtered.length - visibleCount} zbývá)
            </button>
          </div>
        )}
      </div>

      <BulkActionBar selectedIds={selectedIds} seriesList={seriesList} onClear={clearSelection}/>
    </div>
  );
}
