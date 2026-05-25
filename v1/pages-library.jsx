// pages-library.jsx — Knihovna · Harmonogram · Kalendář

// ─── Sdílené helpery ─────────────────────────────────────────────────────
function PageHeader({ theme, title, subtitle, right }){
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:14,padding:'18px 24px 14px',
      borderBottom:`1px solid ${theme.border}`, flex:'0 0 auto'}}>
      <div style={{display:'flex',flexDirection:'column',lineHeight:1.2}}>
        <div style={{font:'700 22px "Space Grotesk"',color:theme.text,letterSpacing:'-0.02em'}}>{title}</div>
        {subtitle && <div style={{font:'500 12px JetBrains Mono',color:theme.textMute,marginTop:5,letterSpacing:'.02em'}}>{subtitle}</div>}
      </div>
      <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>{right}</div>
    </div>
  );
}

function StatCard({ theme, label, value, sub, accent }){
  return (
    <div style={{
      flex:1, background:theme.panel, border:`1px solid ${theme.border}`,
      borderRadius:10, padding:'14px 16px', display:'flex',flexDirection:'column',gap:4,
      position:'relative', overflow:'hidden',
    }}>
      <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:accent||theme.accent}}/>
      <div style={{font:'600 10px JetBrains Mono',color:theme.textMute,letterSpacing:'.08em',textTransform:'uppercase'}}>{label}</div>
      <div style={{font:'700 26px/1 "Space Grotesk"',color:theme.text,marginTop:4,fontFeatureSettings:'"tnum"'}}>{value}</div>
      {sub && <div style={{font:'500 11px JetBrains Mono',color:theme.textDim,marginTop:2}}>{sub}</div>}
    </div>
  );
}

function FilterPill({ theme, label, active, count, onClick }){
  return (
    <button onClick={onClick} style={{
      display:'inline-flex',alignItems:'center',gap:7,
      padding:'6px 12px', borderRadius:99,
      background:active?theme.accent:theme.panel2,
      color:active?'#fff':theme.textDim,
      border:`1px solid ${active?theme.accent:theme.border}`,
      font:'600 12px "Space Grotesk"', cursor:'pointer',
    }}>
      {label}
      {count!=null && <span style={{font:'700 10px JetBrains Mono',
        background:active?'rgba(255,255,255,0.22)':theme.sunken,
        color:active?'#fff':theme.textMute,padding:'1px 6px',borderRadius:99}}>{count}</span>}
    </button>
  );
}

// ─── KNIHOVNA ───────────────────────────────────────────────────────────
function LibraryPage({ theme, onOpenSubs }){
  const [filter, setFilter] = React.useState('all');
  const [view, setView] = React.useState('grid');
  const [detailId, setDetailId] = React.useState(null);

  // Drill-in: detail jednoho anime
  if(detailId){
    const anime = LIBRARY.find(a=>a.id===detailId);
    return <AnimeDetail theme={theme} anime={anime}
      onBack={()=>setDetailId(null)}
      onOpenSubs={onOpenSubs}/>;
  }

  const counts = {
    all: LIBRARY.length,
    airing: LIBRARY.filter(a=>a.status==='airing').length,
    upcoming: LIBRARY.filter(a=>a.status==='upcoming').length,
    completed: LIBRARY.filter(a=>a.status==='completed').length,
    ended: LIBRARY.filter(a=>a.status==='ended').length,
  };
  const filtered = filter==='all' ? LIBRARY : LIBRARY.filter(a=>a.status===filter);

  const watching = LIBRARY.filter(a=>a.status==='airing' && a.watched>0).length;
  const totalEps = LIBRARY.reduce((s,a)=>s+a.eps,0);
  const watchedEps = LIBRARY.reduce((s,a)=>s+a.watched,0);

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={theme} title="Knihovna" subtitle={`${LIBRARY.length} titulů · ${watchedEps}/${totalEps} epizod sledováno`}
        right={<>
          <button style={btnSub(theme)}>↑ Import .ass / .srt</button>
          <button style={btnPrimary(theme)}>+ Přidat anime</button>
        </>}/>

      <div style={{flex:1,overflowY:'auto',padding:'18px 24px',display:'flex',flexDirection:'column',gap:18}}>
        {/* Stats */}
        <div style={{display:'flex',gap:10}}>
          <StatCard theme={theme} label="Sleduji" value={watching} sub="aktivní série" accent={theme.statusAiring}/>
          <StatCard theme={theme} label="Plánuji" value={counts.upcoming} sub="čeká na premiéru" accent={theme.statusUpcoming}/>
          <StatCard theme={theme} label="Dokončeno" value={counts.completed} sub="hotové série" accent={theme.statusDone}/>
          <StatCard theme={theme} label="Stahování" value="3" sub="aktivních úloh" accent={theme.accent}/>
          <StatCard theme={theme} label="Místa na disku" value="847 GB" sub="z 2 TB" accent={theme.accent2}/>
        </div>

        {/* Filters */}
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <FilterPill theme={theme} label="Vše" active={filter==='all'} count={counts.all} onClick={()=>setFilter('all')}/>
          <FilterPill theme={theme} label="Vysílá se" active={filter==='airing'} count={counts.airing} onClick={()=>setFilter('airing')}/>
          <FilterPill theme={theme} label="Dokončeno" active={filter==='completed'} count={counts.completed} onClick={()=>setFilter('completed')}/>
          <FilterPill theme={theme} label="Chystá se" active={filter==='upcoming'} count={counts.upcoming} onClick={()=>setFilter('upcoming')}/>
          <FilterPill theme={theme} label="Skončilo" active={filter==='ended'} count={counts.ended} onClick={()=>setFilter('ended')}/>

          <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
            <input placeholder="Hledat v knihovně…" style={{
              background:theme.panel2, border:`1px solid ${theme.border}`, borderRadius:8,
              padding:'7px 12px', color:theme.text, outline:'none',
              font:'500 12px "Space Grotesk"', width:220,
            }}/>
            <div style={{display:'flex',background:theme.panel2,padding:2,borderRadius:8,border:`1px solid ${theme.border}`}}>
              {['grid','list'].map(v=>(
                <button key={v} onClick={()=>setView(v)} style={{
                  padding:'4px 10px', borderRadius:6, border:'none', cursor:'pointer',
                  background:view===v?theme.panel:'transparent',
                  color:view===v?theme.accent:theme.textDim,
                  font:'600 11px "Space Grotesk"',
                }}>{v==='grid'?'⊞ Karty':'☰ Seznam'}</button>
              ))}
            </div>
            <button style={{...btnGhost(theme),padding:'6px 10px',fontSize:12}}>↓ Setřídit ▾</button>
          </div>
        </div>

        {/* Grid */}
        {view==='grid' ? (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))',gap:14}}>
            {filtered.map(a=><LibraryCard key={a.id} anime={a} theme={theme} onOpen={()=>setDetailId(a.id)}/>)}
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',background:theme.panel,
            border:`1px solid ${theme.border}`,borderRadius:10,overflow:'hidden'}}>
            {filtered.map((a,i)=>(
              <LibraryRow key={a.id} anime={a} theme={theme} last={i===filtered.length-1}
                onOpen={()=>setDetailId(a.id)}/>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryCard({ anime, theme, onOpen }){
  const meta = STATUS_LABELS[anime.status];
  const color = theme[meta.colorKey];
  const pct = (anime.watched/anime.eps)*100;
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8,cursor:'pointer'}}
      onClick={onOpen}>
      <div style={{position:'relative'}}>
        <AnimePoster anime={anime} theme={theme} size="md"/>
        <div style={{position:'absolute',right:6,bottom:6}}>
          <StatusPill theme={theme} color={color} label={meta.label} size="sm"/>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:3,padding:'0 2px'}}>
        <div style={{font:'600 13px "Space Grotesk"',color:theme.text,
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{anime.title}</div>
        <div style={{display:'flex',alignItems:'center',gap:6,font:'500 10px JetBrains Mono',color:theme.textMute}}>
          <span>S{anime.season} · {anime.year}</span>
          <span>·</span>
          <span style={{color:theme.textDim,fontWeight:600}}>{anime.watched}/{anime.eps} ep</span>
        </div>
        <div style={{height:3,background:theme.sunken,borderRadius:99,overflow:'hidden',marginTop:3}}>
          <div style={{width:`${pct}%`,height:'100%',background:color,borderRadius:99}}/>
        </div>
        {anime.next && <div style={{font:'500 10px JetBrains Mono',color:theme.accent2,marginTop:2}}>
          ▸ další: {anime.next}
        </div>}
      </div>
    </div>
  );
}

function LibraryRow({ anime, theme, last, onOpen }){
  const meta = STATUS_LABELS[anime.status];
  const color = theme[meta.colorKey];
  const pct = (anime.watched/anime.eps)*100;
  return (
    <div onClick={onOpen} style={{display:'grid', gridTemplateColumns:'50px 1.6fr 1fr 100px 130px 130px 80px',
      gap:12, alignItems:'center', padding:'10px 14px', cursor:'pointer',
      borderBottom:last?'none':`1px solid ${theme.border}`}}>
      <AnimePoster anime={anime} theme={theme} size="sm" radius={4}/>
      <div style={{minWidth:0}}>
        <div style={{font:'600 13px "Space Grotesk"',color:theme.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{anime.title}</div>
        <div style={{font:'500 11px "Noto Sans JP"',color:theme.textDim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{anime.jp}</div>
      </div>
      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
        {anime.genres.map(g=>(
          <span key={g} style={{font:'500 10px JetBrains Mono',color:theme.textDim,
            background:theme.panel2,padding:'2px 6px',borderRadius:4,border:`1px solid ${theme.border}`}}>{g}</span>
        ))}
      </div>
      <div><StatusPill theme={theme} color={color} label={meta.label} size="sm"/></div>
      <div style={{font:'500 11px JetBrains Mono',color:theme.textDim}}>
        {anime.watched}/{anime.eps} ep
        <div style={{height:3,background:theme.sunken,borderRadius:99,marginTop:4}}>
          <div style={{width:`${pct}%`,height:'100%',background:color,borderRadius:99}}/>
        </div>
      </div>
      <div style={{font:'500 11px JetBrains Mono',color:theme.accent2}}>{anime.next || '—'}</div>
      <div style={{font:'600 11px JetBrains Mono',color:theme.text,textAlign:'right'}}>{anime.score?`★ ${anime.score}`:'—'}</div>
    </div>
  );
}

window.LibraryPage = LibraryPage;
window.PageHeader = PageHeader;
window.StatCard = StatCard;
window.FilterPill = FilterPill;
