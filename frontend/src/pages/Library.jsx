import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSeries, getLibraryStats } from '../api/client';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, StatCard, FilterPill, StatusPill, AnimePoster,
  statusMeta, statusColor,
} from '../v1design';

const T = THEME;

// Map API status to filter key
function toFilterKey(status) {
  const m = {
    RELEASING: 'airing', FINISHED: 'completed',
    NOT_YET_RELEASED: 'upcoming', CANCELLED: 'ended',
    Continuing: 'airing', Ended: 'ended', Upcoming: 'upcoming',
  };
  return m[status] || 'ended';
}

function LibraryCard({ series, onOpen }) {
  const meta = statusMeta(series.status);
  const color = T[meta.colorKey];
  const total = series.episode_count || series.episodes_monitored || 0;
  const watched = series.watched_count || 0;
  const pct = total > 0 ? (watched / total) * 100 : 0;
  const next = series.next_airing || null;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8,cursor:'pointer'}} onClick={onOpen}>
      <div style={{position:'relative'}}>
        <AnimePoster series={series} theme={T} size="md"/>
        <div style={{position:'absolute',right:6,bottom:6}}>
          <StatusPill theme={T} color={color} label={meta.label} size="sm"/>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:3,padding:'0 2px'}}>
        <div style={{font:'600 13px "Space Grotesk"',color:T.text,
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          {series.title_romaji || series.title}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,font:'500 10px JetBrains Mono',color:T.textMute}}>
          <span>S{series.season_number || 1} · {series.year || (series.first_aired ? new Date(series.first_aired).getFullYear() : '?')}</span>
          <span>·</span>
          <span style={{color:T.textDim,fontWeight:600}}>{watched}/{total} ep</span>
        </div>
        <div style={{height:3,background:T.sunken,borderRadius:99,overflow:'hidden',marginTop:3}}>
          <div style={{width:`${pct}%`,height:'100%',background:color,borderRadius:99}}/>
        </div>
        {next && <div style={{font:'500 10px JetBrains Mono',color:T.accent2,marginTop:2}}>
          ▸ další: {next}
        </div>}
      </div>
    </div>
  );
}

function LibraryRow({ series, last, onOpen }) {
  const meta = statusMeta(series.status);
  const color = T[meta.colorKey];
  const total = series.episode_count || series.episodes_monitored || 0;
  const watched = series.watched_count || 0;
  const pct = total > 0 ? (watched / total) * 100 : 0;
  const genres = series.genres || [];
  const score = series.average_score;

  return (
    <div onClick={onOpen} style={{
      display:'grid', gridTemplateColumns:'50px 1.6fr 1fr 100px 130px 130px 80px',
      gap:12, alignItems:'center', padding:'10px 14px', cursor:'pointer',
      borderBottom:last ? 'none' : `1px solid ${T.border}`,
    }}>
      <AnimePoster series={series} theme={T} size="sm" radius={4}/>
      <div style={{minWidth:0}}>
        <div style={{font:'600 13px "Space Grotesk"',color:T.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          {series.title_romaji || series.title}
        </div>
        <div style={{font:'500 11px "Noto Sans JP"',color:T.textDim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          {series.title_jp || series.title_native || series.title}
        </div>
      </div>
      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
        {genres.slice(0, 3).map(g => (
          <span key={g} style={{font:'500 10px JetBrains Mono',color:T.textDim,
            background:T.panel2,padding:'2px 6px',borderRadius:4,border:`1px solid ${T.border}`}}>{g}</span>
        ))}
      </div>
      <div><StatusPill theme={T} color={color} label={meta.label} size="sm"/></div>
      <div style={{font:'500 11px JetBrains Mono',color:T.textDim}}>
        {watched}/{total} ep
        <div style={{height:3,background:T.sunken,borderRadius:99,marginTop:4}}>
          <div style={{width:`${pct}%`,height:'100%',background:color,borderRadius:99}}/>
        </div>
      </div>
      <div style={{font:'500 11px JetBrains Mono',color:T.accent2}}>{series.next_airing || '—'}</div>
      <div style={{font:'600 11px JetBrains Mono',color:T.text,textAlign:'right'}}>
        {score > 0 ? `★ ${Number(score).toFixed(1)}` : '—'}
      </div>
    </div>
  );
}

export default function Library({ theme }) {
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('grid');
  const [search, setSearch] = useState('');

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
    for (const s of seriesList) {
      const k = toFilterKey(s.status);
      if (c[k] != null) c[k]++;
    }
    return c;
  }, [seriesList]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? seriesList : seriesList.filter(s => toFilterKey(s.status) === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.title_romaji || '').toLowerCase().includes(q) ||
        (s.title_jp || s.title_native || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [seriesList, filter, search]);

  const watching = seriesList.filter(s => toFilterKey(s.status) === 'airing' && (s.watched_count || 0) > 0).length;
  const totalEps = seriesList.reduce((s, a) => s + (a.episode_count || 0), 0);
  const watchedEps = seriesList.reduce((s, a) => s + (a.watched_count || 0), 0);

  if (isLoading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:T.textDim,font:'500 14px "Space Grotesk"'}}>
      Načítám knihovnu…
    </div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={T} title="Knihovna"
        subtitle={`${seriesList.length} titulů · ${watchedEps}/${totalEps} epizod sledováno`}
        right={<>
          <button style={btnSub(T)}>↑ Import .ass / .srt</button>
          <button style={btnPrimary(T)}>+ Přidat anime</button>
        </>}
      />

      <div style={{flex:1,overflowY:'auto',padding:'18px 24px',display:'flex',flexDirection:'column',gap:18}}>
        {/* Stats */}
        <div style={{display:'flex',gap:10}}>
          <StatCard theme={T} label="Sleduji" value={watching} sub="aktivní série" accent={T.statusAiring}/>
          <StatCard theme={T} label="Plánuji" value={counts.upcoming} sub="čeká na premiéru" accent={T.statusUpcoming}/>
          <StatCard theme={T} label="Dokončeno" value={counts.completed} sub="hotové série" accent={T.statusDone}/>
          <StatCard theme={T} label="Stahování" value={stats?.active_downloads ?? '—'} sub="aktivních úloh" accent={T.accent}/>
          <StatCard theme={T} label="Místa na disku" value={stats?.disk_used ?? '—'} sub={stats?.disk_total ? `z ${stats.disk_total}` : 'na disku'} accent={T.accent2}/>
        </div>

        {/* Filters */}
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <FilterPill theme={T} label="Vše"        active={filter==='all'}       count={counts.all}       onClick={() => setFilter('all')}/>
          <FilterPill theme={T} label="Vysílá se"  active={filter==='airing'}    count={counts.airing}    onClick={() => setFilter('airing')}/>
          <FilterPill theme={T} label="Dokončeno"  active={filter==='completed'} count={counts.completed} onClick={() => setFilter('completed')}/>
          <FilterPill theme={T} label="Chystá se"  active={filter==='upcoming'}  count={counts.upcoming}  onClick={() => setFilter('upcoming')}/>
          <FilterPill theme={T} label="Skončilo"   active={filter==='ended'}     count={counts.ended}     onClick={() => setFilter('ended')}/>

          <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Hledat v knihovně…"
              style={{
                background:T.panel2, border:`1px solid ${T.border}`, borderRadius:8,
                padding:'7px 12px', color:T.text, outline:'none',
                font:'500 12px "Space Grotesk"', width:220,
              }}
            />
            <div style={{display:'flex',background:T.panel2,padding:2,borderRadius:8,border:`1px solid ${T.border}`}}>
              {[['grid','⊞ Karty'],['list','☰ Seznam']].map(([v, l]) => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding:'4px 10px', borderRadius:6, border:'none', cursor:'pointer',
                  background:view===v ? T.panel : 'transparent',
                  color:view===v ? T.accent : T.textDim,
                  font:'600 11px "Space Grotesk"',
                }}>{l}</button>
              ))}
            </div>
            <button style={{...btnGhost(T), padding:'6px 10px', fontSize:12}}>↓ Setřídit ▾</button>
          </div>
        </div>

        {/* Grid */}
        {view === 'grid' ? (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))',gap:14}}>
            {filtered.map(s => (
              <Link key={s.id} to={`/series/${s.id}`} style={{textDecoration:'none'}}>
                <LibraryCard series={s} onOpen={() => {}}/>
              </Link>
            ))}
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',background:T.panel,
            border:`1px solid ${T.border}`,borderRadius:10,overflow:'hidden'}}>
            {filtered.map((s, i) => (
              <Link key={s.id} to={`/series/${s.id}`} style={{textDecoration:'none'}}>
                <LibraryRow series={s} last={i === filtered.length - 1} onOpen={() => {}}/>
              </Link>
            ))}
          </div>
        )}

        {filtered.length === 0 && !isLoading && (
          <div style={{padding:40, textAlign:'center', color:T.textMute, font:'500 13px "Space Grotesk"'}}>
            Žádné výsledky
          </div>
        )}
      </div>
    </div>
  );
}
