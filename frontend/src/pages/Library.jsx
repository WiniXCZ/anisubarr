import { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSeries, getLibraryStats, getOrphanedFolders,
  publishSeries, demoteSeries, downloadAllBulkSeries, deleteSubsBySeries,
} from '../api/client';
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

// Extract root folder name from Sonarr path (e.g. /data/Incomplete/Title → "Incomplete")
function getLocationKey(path) {
  if (!path) return null;
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  // Skip first segment if it looks like a drive/data root, take the second-level folder
  if (parts.length >= 2) {
    const folder = parts[parts.length >= 3 ? parts.length - 2 : 0];
    return folder.toLowerCase();
  }
  return null;
}

// Well-known folder labels
const LOCATION_LABELS = {
  'incomplete': 'Incomplete',
  'anime series': 'Anime Series',
  'anime': 'Anime Series',
  'complete': 'Dokončeno',
};
function locationLabel(key) {
  return LOCATION_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : key);
}

// Sort options
const SORT_OPTIONS = [
  { key: 'title_asc',      label: 'Název (A→Z)' },
  { key: 'title_desc',     label: 'Název (Z→A)' },
  { key: 'year_desc',      label: 'Rok (nejnovější)' },
  { key: 'year_asc',       label: 'Rok (nejstarší)' },
  { key: 'score_desc',     label: 'Hodnocení ↓' },
  { key: 'pct_desc',       label: 'Staženo % ↓' },
  { key: 'pct_asc',        label: 'Staženo % ↑' },
  { key: 'missing_desc',   label: 'Nejvíce chybí titulků' },
  { key: 'missing_asc',    label: 'Nejméně chybí titulků' },
  { key: 'added_desc',     label: 'Přidáno (nejnovější)' },
  { key: 'added_asc',      label: 'Přidáno (nejstarší)' },
];

function sortSeries(list, sortKey) {
  const arr = [...list];
  switch (sortKey) {
    case 'title_asc':
      return arr.sort((a, b) => (a.title_english || a.title_romaji || a.title || '').localeCompare(b.title_english || b.title_romaji || b.title || ''));
    case 'title_desc':
      return arr.sort((a, b) => (b.title_english || b.title_romaji || b.title || '').localeCompare(a.title_english || a.title_romaji || a.title || ''));
    case 'year_desc':
      return arr.sort((a, b) => (b.year || 0) - (a.year || 0));
    case 'year_asc':
      return arr.sort((a, b) => (a.year || 0) - (b.year || 0));
    case 'score_desc':
      return arr.sort((a, b) => (b.average_score || 0) - (a.average_score || 0));
    case 'pct_desc': {
      const pct = s => { const t = s.episode_count || 0; return t > 0 ? (s.episodes_with_file || 0) / t : 0; };
      return arr.sort((a, b) => pct(b) - pct(a));
    }
    case 'pct_asc': {
      const pct = s => { const t = s.episode_count || 0; return t > 0 ? (s.episodes_with_file || 0) / t : 1; };
      return arr.sort((a, b) => pct(a) - pct(b));
    }
    case 'missing_desc': {
      const missing = s => (s.episodes_with_file || 0) - (s.cs_sub_count || 0);
      return arr.sort((a, b) => missing(b) - missing(a));
    }
    case 'missing_asc': {
      const missing = s => (s.episodes_with_file || 0) - (s.cs_sub_count || 0);
      return arr.sort((a, b) => missing(a) - missing(b));
    }
    case 'added_desc': {
      // Series without sonarr_added go to the end
      return arr.sort((a, b) => {
        if (!a.sonarr_added && !b.sonarr_added) return 0;
        if (!a.sonarr_added) return 1;
        if (!b.sonarr_added) return -1;
        return new Date(b.sonarr_added) - new Date(a.sonarr_added);
      });
    }
    case 'added_asc': {
      return arr.sort((a, b) => {
        if (!a.sonarr_added && !b.sonarr_added) return 0;
        if (!a.sonarr_added) return 1;
        if (!b.sonarr_added) return -1;
        return new Date(a.sonarr_added) - new Date(b.sonarr_added);
      });
    }
    default:
      return arr;
  }
}

// ── Library card (grid view) ────────────────────────────────────────────────
const LibraryCard = memo(function LibraryCard({ series, selected, onSelect, onOpen, compact = false }) {
  const meta = statusMeta(series.status);
  const color = T[meta.colorKey];
  const total = series.episode_count || series.episodes_monitored || 0;
  const downloaded = series.episodes_with_file || 0;
  const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  const next = series.next_airing || null;
  const [hovered, setHovered] = useState(false);

  // Fixed title height: 2 lines × font-size × line-height
  // compact: 11px * 1.3 * 2 = 28.6 → 29px; normal: 12px * 1.3 * 2 = 31.2 → 32px
  const titleHeight = compact ? 29 : 32;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display:'flex', flexDirection:'column', gap: compact ? 3 : 6,
        cursor:'pointer',
        outline: selected ? `2px solid ${T.accent}` : 'none',
        borderRadius: 8,
        transform: hovered && !compact ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: hovered && !compact ? `0 8px 24px rgba(0,0,0,0.45), 0 0 0 1px ${T.accent}33` : 'none',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onClick={onOpen}
    >
      {/* Poster */}
      <div style={{ position:'relative' }}>
        <div style={{ width:'100%', aspectRatio:'2/3', borderRadius: compact ? 5 : 6,
          overflow:'hidden', border:`1px solid ${T.borderStrong}`, position:'relative' }}>
          {(series.cover_url || series.poster_url)
            ? <img src={series.cover_url || series.poster_url} alt={series.title_english || series.title_romaji || series.title || ''}
                style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
            : <AnimePoster series={series} theme={T} size="lg" radius={compact ? 5 : 6}/>
          }
          {series.promoted && (
            <div style={{
              position:'absolute', top: compact ? 4 : 6, left: compact ? 4 : 6,
              background:'rgba(34,197,94,0.92)', color:'#fff',
              font:'700 8px JetBrains Mono', padding:'2px 5px',
              borderRadius:99, letterSpacing:'.03em', whiteSpace:'nowrap',
              boxShadow:'0 1px 6px rgba(0,0,0,0.5)',
            }}>Publikováno</div>
          )}
          <div style={{ position:'absolute', right: compact ? 4 : 5, bottom: compact ? 4 : 5 }}>
            <StatusPill theme={T} color={color} label={meta.label} size="sm"/>
          </div>
        </div>

        {/* Checkbox */}
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

      {/* Info below poster — fixed height so all cards align */}
      <div style={{ display:'flex', flexDirection:'column', gap:2, padding: compact ? '0 3px' : '0 2px' }}>
        {/* Title: always reserve space for 2 lines so cards don't jump */}
        <div style={{
          height: titleHeight,
          font: `600 ${compact ? 11 : 12}px "Space Grotesk"`, color:T.text,
          overflow:'hidden', display:'-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient:'vertical',
          lineHeight:1.3,
        }}>
          {series.title_english || series.title_romaji || series.title}
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
});

// ── Library row (list view — desktop only) ───────────────────────────────────
const LibraryRow = memo(function LibraryRow({ series, last, selected, onSelect, onOpen }) {
  const meta = statusMeta(series.status);
  const color = T[meta.colorKey];
  const total = series.episode_count || series.episodes_monitored || 0;
  const downloaded = series.episodes_with_file || 0;
  const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  const genres = series.genres || [];
  const score = series.average_score;

  return (
    <div onClick={onOpen} style={{
      display:'flex', alignItems:'center', gap:10, padding:'7px 14px', cursor:'pointer',
      minHeight: 72,   // enough for poster (52px wide = 78px tall at 2:3) to not get cut
      borderBottom: last ? 'none' : `1px solid ${T.border}`,
      background: selected ? `${T.accent}11` : 'transparent',
    }}>
      {/* Checkbox */}
      <div
        style={{ flex:'0 0 18px', width:16, height:16, borderRadius:3,
          background: selected ? T.accent : 'transparent',
          border:`2px solid ${selected ? T.accent : T.borderStrong}`,
          display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}
        onClick={e => { e.stopPropagation(); onSelect(); }}
      >
        {selected && <span style={{ color:'#fff', fontSize:9, lineHeight:1 }}>✓</span>}
      </div>

      {/* Poster — wider so it's fully visible */}
      <div style={{ flex:'0 0 52px', alignSelf:'center' }}>
        {(series.cover_url || series.poster_url)
          ? <img src={series.cover_url || series.poster_url} alt=""
              style={{ width:52, height:78, objectFit:'cover', borderRadius:4, display:'block',
                border:`1px solid ${T.borderStrong}` }}/>
          : <AnimePoster series={series} theme={T} size="sm" radius={4}/>
        }
      </div>

      {/* Title + japanese */}
      <div style={{ flex:'1 1 0', minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ font:'600 13px "Space Grotesk"', color:T.text,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {series.title_english || series.title_romaji || series.title}
          </div>
          {series.promoted && <StatusPill theme={T} color={T.statusDone} label="Publikováno" size="sm" dot={false}/>}
        </div>
        <div style={{ font:'500 11px "Noto Sans JP"', color:T.textDim,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {series.title_japanese || series.title}
        </div>
      </div>

      {/* Genres */}
      <div style={{ flex:'0 0 140px', display:'flex', gap:4, flexWrap:'wrap' }}>
        {genres.slice(0, 2).map(g => (
          <span key={g} style={{ font:'500 10px JetBrains Mono', color:T.textDim,
            background:T.panel2, padding:'2px 5px', borderRadius:4, border:`1px solid ${T.border}` }}>{g}</span>
        ))}
      </div>

      {/* Status */}
      <div style={{ flex:'0 0 90px' }}>
        <StatusPill theme={T} color={color} label={meta.label} size="sm"/>
      </div>

      {/* Episodes + progress */}
      <div style={{ flex:'0 0 100px', font:'500 11px JetBrains Mono', color:T.textDim }}>
        {downloaded}/{total} ep
        <div style={{ height:3, background:T.sunken, borderRadius:99, marginTop:3 }}>
          <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:99 }}/>
        </div>
      </div>

      {/* Next airing */}
      <div style={{ flex:'0 0 80px', font:'500 11px JetBrains Mono', color:T.accent2 }}>
        {series.next_airing || '—'}
      </div>

      {/* Score */}
      <div style={{ flex:'0 0 50px', font:'600 11px JetBrains Mono', color:T.text, textAlign:'right' }}>
        {score > 0 ? `★ ${Number(score).toFixed(1)}` : '—'}
      </div>
    </div>
  );
});

// ── Sort dropdown ─────────────────────────────────────────────────────────────
function SortDropdown({ sort, onSort }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = SORT_OPTIONS.find(o => o.key === sort) || SORT_OPTIONS[0];

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ ...btnGhost(T), padding:'6px 10px', fontSize:12,
          background: open ? T.panel2 : undefined,
          color: sort !== 'title_asc' ? T.accent : undefined,
        }}
      >
        ↓ {current.label} ▾
      </button>
      {open && (
        <div style={{
          position:'absolute', right:0, top:'calc(100% + 4px)', zIndex:200,
          background:T.panel, border:`1px solid ${T.borderStrong}`, borderRadius:8,
          padding:4, minWidth:180,
          boxShadow:'0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {SORT_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => { onSort(opt.key); setOpen(false); }} style={{
              display:'block', width:'100%', textAlign:'left',
              padding:'7px 12px', border:'none', borderRadius:5, cursor:'pointer',
              background: sort === opt.key ? `${T.accent}22` : 'transparent',
              color: sort === opt.key ? T.accent : T.text,
              font:`${sort === opt.key ? '600' : '500'} 12px "Space Grotesk"`,
            }}>
              {sort === opt.key && '✓ '}{opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Import modal ──────────────────────────────────────────────────────────────
function ImportModal({ onClose }) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['orphaned-folders'],
    queryFn: () => getOrphanedFolders().then(r => r.data),
  });
  const folders = data?.folders || [];

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:T.panel, border:`1px solid ${T.borderStrong}`, borderRadius:12,
        padding:24, minWidth:340, maxWidth:480, maxHeight:'70vh', overflowY:'auto',
        display:'flex', flexDirection:'column', gap:14 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ font:'700 15px "Space Grotesk"', color:T.text }}>Nenapárované složky</div>
        {isLoading && (
          <div style={{ font:'500 12px "Space Grotesk"', color:T.textDim }}>Načítám…</div>
        )}
        {error && (
          <div style={{ font:'500 12px "Space Grotesk"', color:T.statusEnded }}>
            Nepodařilo se načíst seznam složek.
          </div>
        )}
        {data?.error && (
          <div style={{ font:'500 12px "Space Grotesk"', color:T.statusEnded }}>{data.error}</div>
        )}
        {!isLoading && !error && !data?.error && (
          folders.length === 0 ? (
            <div style={{ font:'500 12px "Space Grotesk"', color:T.textDim }}>
              Všechny složky v knihovně jsou napárované na nějakou sérii.
            </div>
          ) : (
            <>
              <div style={{ font:'500 11px "Space Grotesk"', color:T.textDim }}>
                {folders.length} {folders.length === 1 ? 'složka' : 'složek'} v knihovně nemá odpovídající sérii. Přidej je přes Discover, ať se napárují.
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {folders.map(f => (
                  <div key={f} style={{ font:'500 12px JetBrains Mono', color:T.text,
                    background:T.panel2, borderRadius:6, padding:'6px 10px' }}>
                    {f}
                  </div>
                ))}
              </div>
            </>
          )
        )}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button style={btnSub(T)} onClick={onClose}>Zavřít</button>
          <button style={btnPrimary(T)} onClick={() => { onClose(); navigate('/discover'); }}>Otevřít Discover</button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk action bar ───────────────────────────────────────────────────────────
function BulkActionBar({ selectedIds, seriesList, onClear }) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const count = selectedIds.size;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['series'] });
    queryClient.invalidateQueries({ queryKey: ['library-stats'] });
  };

  const publishMutation = useMutation({
    mutationFn: (ids) => Promise.all(ids.map(id => publishSeries(id))),
    onSuccess: () => { invalidate(); onClear(); },
    onError: (e) => alert(`Publikace selhala: ${e.response?.data?.detail || e.message}`),
  });
  const demoteMutation = useMutation({
    mutationFn: (ids) => Promise.all(ids.map(id => demoteSeries(id))),
    onSuccess: () => { invalidate(); onClear(); },
    onError: (e) => alert(`Stažení z publikace selhalo: ${e.response?.data?.detail || e.message}`),
  });
  const downloadSubsMutation = useMutation({
    mutationFn: (ids) => downloadAllBulkSeries(ids),
    onSuccess: () => { invalidate(); onClear(); },
    onError: (e) => alert(`Stažení titulků selhalo: ${e.response?.data?.detail || e.message}`),
  });
  const deleteSubsMutation = useMutation({
    mutationFn: (ids) => deleteSubsBySeries(ids),
    onSuccess: () => { invalidate(); onClear(); },
    onError: (e) => alert(`Smazání titulků selhalo: ${e.response?.data?.detail || e.message}`),
  });

  if (count === 0) return null;

  const ids = [...selectedIds];
  const anyPromoted = ids.some(id => seriesList.find(s => s.id === id)?.promoted);
  const busy = publishMutation.isPending || demoteMutation.isPending
    || downloadSubsMutation.isPending || deleteSubsMutation.isPending;

  const btnStyle = (primary) => ({
    ...(primary ? btnPrimary(T) : btnSub(T)),
    padding: isMobile ? '8px 12px' : '6px 12px',
    fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap',
    opacity: busy ? 0.6 : 1,
  });

  const handleDeleteSubs = () => {
    if (!window.confirm(`Smazat titulky pro ${count} ${count === 1 ? 'sérii' : 'sérií'}? Tuto akci nelze vrátit.`)) return;
    deleteSubsMutation.mutate(ids);
  };

  return (
    <>
      <div style={{
        position:'sticky', bottom:0,
        background:`${T.panel}f0`, backdropFilter:'blur(12px)',
        borderTop:`1px solid ${T.borderStrong}`,
        flexShrink:0, zIndex:100,
      }}>
        <div style={{
          display:'flex', alignItems:'center', gap:8,
          padding: isMobile ? '10px 12px' : '10px 24px',
          overflowX:'auto', scrollbarWidth:'none',
        }}>
          <div style={{ font:'600 12px "Space Grotesk"', color:T.text, flexShrink:0, marginRight:2 }}>
            {count} vybráno
          </div>
          {!anyPromoted && (
            <button disabled={busy} style={btnStyle(true)} onClick={() => publishMutation.mutate(ids)}>✓ Publikovat</button>
          )}
          {anyPromoted && (
            <button disabled={busy} style={btnStyle(false)} onClick={() => demoteMutation.mutate(ids)}>↓ Stáhnout z publ.</button>
          )}
          <button disabled={busy} style={btnStyle(false)} onClick={() => downloadSubsMutation.mutate(ids)}>↓ Titulky</button>
          <button disabled={busy} style={{ ...btnGhost(T), padding: isMobile ? '8px 12px' : '6px 12px',
            fontSize:12, flexShrink:0, whiteSpace:'nowrap', opacity: busy ? 0.6 : 1 }}
            onClick={handleDeleteSubs}>✕ Smazat titulky</button>
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
  const [filter, setFilter]       = useState(() => localStorage.getItem('library_filter') || 'all');
  const [locationFilter, setLocationFilter] = useState(() => localStorage.getItem('library_locationFilter') || 'all');
  const [showPromotedOnly, setShowPromotedOnly] = useState(() => localStorage.getItem('library_promotedOnly') === 'true');
  const [sort, setSort]           = useState(() => localStorage.getItem('library_sort') || 'title_asc');
  const [view, setView]           = useState(() => localStorage.getItem('library_view') || 'grid');
  const [search, setSearch]       = useState('');

  useEffect(() => { localStorage.setItem('library_filter', filter); }, [filter]);
  useEffect(() => { localStorage.setItem('library_locationFilter', locationFilter); }, [locationFilter]);
  useEffect(() => { localStorage.setItem('library_promotedOnly', showPromotedOnly); }, [showPromotedOnly]);
  useEffect(() => { localStorage.setItem('library_sort', sort); }, [sort]);
  useEffect(() => { localStorage.setItem('library_view', view); }, [view]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds]   = useState(new Set());
  const [showImport, setShowImport]     = useState(false);

  const { data: seriesList = [], isLoading } = useQuery({
    queryKey: ['series'],
    queryFn: () => getSeries().then(r => r.data),
  });
  const { data: stats } = useQuery({
    queryKey: ['library-stats'],
    queryFn: () => getLibraryStats().then(r => r.data),
  });

  const counts = useMemo(() => {
    const c = { all: seriesList.length, airing: 0, upcoming: 0, completed: 0, ended: 0, promoted: 0 };
    for (const s of seriesList) {
      const k = toFilterKey(s.status);
      if (c[k] != null) c[k]++;
      if (s.promoted) c.promoted++;
    }
    return c;
  }, [seriesList]);

  // Unique location folders from series paths
  const locationCounts = useMemo(() => {
    const map = {};
    for (const s of seriesList) {
      const k = getLocationKey(s.path);
      if (k) map[k] = (map[k] || 0) + 1;
    }
    return map;
  }, [seriesList]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? seriesList : seriesList.filter(s => toFilterKey(s.status) === filter);
    if (locationFilter !== 'all') {
      list = list.filter(s => getLocationKey(s.path) === locationFilter);
    }
    if (showPromotedOnly) {
      list = list.filter(s => s.promoted);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.title_english || '').toLowerCase().includes(q) ||
        (s.title_romaji || '').toLowerCase().includes(q) ||
        (s.title_japanese || '').toLowerCase().includes(q)
      );
    }
    return sortSeries(list, sort);
  }, [seriesList, filter, locationFilter, showPromotedOnly, search, sort]);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filter, locationFilter, showPromotedOnly, search, sort]);

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
      {!isMobile && (
        <PageHeader theme={T} title="Knihovna"
          subtitle={`${seriesList.length} titulů · ${watchedEps}/${totalEps} epizod staženo`}
          right={<>
            <button style={btnSub(T)} onClick={() => setShowImport(true)}>↑ Import</button>
            <button style={btnPrimary(T)} onClick={() => navigate('/discover')}>+ Přidat anime</button>
          </>}
        />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)}/>}

      <div style={{ flex:1, overflowY:'auto', WebkitOverflowScrolling:'touch', padding:pad,
        display:'flex', flexDirection:'column', gap: isMobile ? 8 : 18 }}>

        {/* Stats */}
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

        {/* Filters + search + sort */}
        {isMobile ? (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {/* Status filter pills */}
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
              <div style={{ flexShrink:0 }}>
                <FilterPill theme={T} label="Zveřejněné" active={showPromotedOnly}
                  count={counts.promoted} onClick={() => setShowPromotedOnly(v => !v)}/>
              </div>
            </div>
            {/* Location filter pills — only if we have multiple folders */}
            {Object.keys(locationCounts).length > 0 && (
              <div style={{ display:'flex', gap:6, overflowX:'auto', scrollbarWidth:'none', paddingBottom:2 }}>
                <div style={{ flexShrink:0 }}>
                  <FilterPill theme={T} label="📁 Vše" active={locationFilter==='all'}
                    count={seriesList.length} onClick={() => setLocationFilter('all')}/>
                </div>
                {Object.entries(locationCounts).map(([k, cnt]) => (
                  <div key={k} style={{ flexShrink:0 }}>
                    <FilterPill theme={T} label={`📁 ${locationLabel(k)}`} active={locationFilter===k}
                      count={cnt} onClick={() => setLocationFilter(k)}/>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display:'flex', gap:8 }}>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Hledat v knihovně…"
                style={{
                  flex:1, boxSizing:'border-box',
                  background:T.panel2, border:`1px solid ${T.border}`, borderRadius:8,
                  padding:'9px 12px', color:T.text, outline:'none',
                  font:'500 13px "Space Grotesk"',
                }}
              />
              <SortDropdown sort={sort} onSort={setSort}/>
            </div>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {/* Row 1: Status filters + search + view toggle + sort */}
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <FilterPill theme={T} label="Vše"        active={filter==='all'}       count={counts.all}       onClick={() => setFilter('all')}/>
              <FilterPill theme={T} label="Vysílá se"  active={filter==='airing'}    count={counts.airing}    onClick={() => setFilter('airing')}/>
              <FilterPill theme={T} label="Dokončeno"  active={filter==='completed'} count={counts.completed} onClick={() => setFilter('completed')}/>
              <FilterPill theme={T} label="Chystá se"  active={filter==='upcoming'}  count={counts.upcoming}  onClick={() => setFilter('upcoming')}/>
              <FilterPill theme={T} label="Skončilo"   active={filter==='ended'}     count={counts.ended}     onClick={() => setFilter('ended')}/>
              <FilterPill theme={T} label="Zveřejněné" active={showPromotedOnly}     count={counts.promoted}  onClick={() => setShowPromotedOnly(v => !v)}/>
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
                <SortDropdown sort={sort} onSort={setSort}/>
              </div>
            </div>
            {/* Row 2: Location filters — only if multiple folders exist */}
            {Object.keys(locationCounts).length > 0 && (
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <span style={{ font:'500 11px JetBrains Mono', color:T.textMute, flexShrink:0 }}>📁</span>
                <FilterPill theme={T} label="Všechny složky" active={locationFilter==='all'}
                  count={seriesList.length} onClick={() => setLocationFilter('all')}/>
                {Object.entries(locationCounts).map(([k, cnt]) => (
                  <FilterPill key={k} theme={T} label={locationLabel(k)} active={locationFilter===k}
                    count={cnt} onClick={() => setLocationFilter(k)}/>
                ))}
              </div>
            )}
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
