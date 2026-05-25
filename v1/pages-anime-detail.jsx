// pages-anime-detail.jsx — detail jednoho anime · synopsis + epizody + titulky

// Deterministický generátor epizod podle anime
function genEpisodes(anime){
  const titles = {
    sad:[ 'Vysílání','Hluk a hlas','Druhý refrén','Ozvěna','Hřeben','Most','Maják','Sloupec','Tichá vlna','Inversion','Návrat','Konec přenosu' ],
    nc: [ 'První mapa','Tunel 7','Karneval datami','Bílý šum','Most provazu','Skener','Vrstvy','Roj','Slepá místa','Skicák','Lighthouse','Skok','Nová mapa' ],
    yd: [ 'Stěhování','Nájemník','Bouřka','Stará brána','Otisky','Most','Kostýmy','Útěk','Lampa','Smlouva','Návrat','...'],
    qs: [ 'Start','Tichá obloha','Maják','Bóje','Mlha','Šum','Slunce','Inverze','Cyklus','Stopa','Kometa','Klid','Anomálie','Trhlina','Echo','Skok','Hluk','Tlumení','Naděje' ],
    gp: [ 'První pošta','Most',  'Lampa', 'Lístek', 'Setkání', 'Tma' ],
  };
  const titleList = titles[anime.id] || Array.from({length:anime.eps}, (_,i)=>`Epizoda ${i+1}`);
  const out = [];
  for(let i=1; i<=anime.eps; i++){
    const watched = i<=anime.watched;
    // deterministic-ish state via i + anime.id length
    const seed = (i*7 + anime.id.length*13) % 100;
    // subs state: most have JP+CS, some only JP, current/recent might have none, AI draft
    let subState;
    if(!watched && i>anime.watched+1) subState = i===anime.watched+2 && anime.status==='airing' ? 'ai-draft' : (seed%5===0 ? 'jp' : 'none');
    else subState = seed%6===0 ? 'jp' : 'both';
    if(anime.status==='upcoming') subState = 'none';

    out.push({
      n: i,
      title: titleList[i-1] || `Epizoda ${i}`,
      duration: 24,
      date: '',
      watched,
      subState,    // 'both' | 'jp' | 'ai-draft' | 'none'
      sizeGB: 1.2 + ((seed%5)*0.1),
      hasFile: subState!=='none' || watched,
    });
  }
  return out;
}

const SUB_STATE_META = {
  both:    { color:'statusDone',     icon:'✓', label:'JP + CS' },
  jp:      { color:'statusUpcoming', icon:'!', label:'jen JP' },
  'ai-draft':{ color:'accent3',      icon:'✦', label:'AI návrh' },
  none:    { color:'statusEnded',    icon:'×', label:'chybí' },
};

function AnimeDetail({ theme, anime, onBack, onOpenSubs }){
  const eps = React.useMemo(()=>genEpisodes(anime),[anime.id]);
  const [activeTab, setActiveTab] = React.useState('eps');
  const [filter, setFilter] = React.useState('all');

  const meta = STATUS_LABELS[anime.status];
  const statusColor = theme[meta.colorKey];

  const filtered = filter==='all' ? eps
    : filter==='missing-subs' ? eps.filter(e=>e.subState!=='both')
    : filter==='unwatched' ? eps.filter(e=>!e.watched)
    : filter==='ai-pending' ? eps.filter(e=>e.subState==='ai-draft')
    : eps;

  const missingCount = eps.filter(e=>e.subState!=='both').length;
  const aiPending = eps.filter(e=>e.subState==='ai-draft').length;
  const watchedPct = (anime.watched/anime.eps)*100;

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      {/* ─── HERO ─────────────────────────────────────────── */}
      <div style={{
        position:'relative', flex:'0 0 auto', overflow:'hidden',
        borderBottom:`1px solid ${theme.border}`,
      }}>
        {/* blurred poster background */}
        <div style={{position:'absolute',inset:0,
          background:`linear-gradient(160deg, hsla(${anime.hue},65%,28%,0.85), hsla(${(anime.hue+50)%360},55%,16%,0.95)), ${theme.bg}`,
          filter:'saturate(1.1)'}}/>
        <svg width="100%" height="100%" style={{position:'absolute',inset:0,opacity:0.07,pointerEvents:'none'}}>
          <pattern id="hero-stripe" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="14" stroke="white" strokeWidth="1"/>
          </pattern>
          <rect width="100%" height="100%" fill="url(#hero-stripe)"/>
        </svg>

        <div style={{position:'relative',padding:'18px 24px 22px',display:'flex',gap:22}}>
          {/* back chip */}
          <div style={{position:'absolute',top:14,left:24}}>
            <button onClick={onBack} style={{...btnGhost(theme),
              background:'rgba(0,0,0,0.35)',border:'1px solid rgba(255,255,255,0.12)',
              color:'#fff',padding:'5px 10px',display:'inline-flex',gap:6,alignItems:'center'}}>
              <NavIcon d={ICONS.back}/> Zpět do knihovny
            </button>
          </div>

          {/* poster */}
          <div style={{marginTop:34}}>
            <AnimePoster anime={anime} theme={theme} size="lg" radius={10}/>
          </div>

          {/* meta */}
          <div style={{flex:1, minWidth:0, marginTop:34, display:'flex',flexDirection:'column',gap:12,color:'#fff'}}>
            <div>
              <div style={{font:'600 13px "Noto Sans JP"',color:'rgba(255,255,255,0.7)'}}>{anime.jp}</div>
              <div style={{font:'700 32px/1.1 "Space Grotesk"',color:'#fff',letterSpacing:'-0.02em',marginTop:4}}>{anime.title}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <StatusPill theme={theme} color={statusColor} label={meta.label}/>
              {anime.score && <span style={{font:'700 13px JetBrains Mono',color:'#fff',
                background:'rgba(0,0,0,0.35)',padding:'3px 9px',borderRadius:99,border:'1px solid rgba(255,255,255,0.15)'}}>
                ★ {anime.score}
              </span>}
              <span style={{font:'500 12px "Space Grotesk"',color:'rgba(255,255,255,0.85)'}}>
                S{anime.season} · {anime.eps} ep · {anime.year} · studio <span style={{fontWeight:600,color:'#fff'}}>{anime.studio}</span>
              </span>
              <div style={{display:'flex',gap:5,marginLeft:6}}>
                {anime.genres.map(g=>(
                  <span key={g} style={{font:'600 11px "Space Grotesk"',color:'#fff',
                    background:'rgba(0,0,0,0.3)',padding:'2px 9px',borderRadius:99,
                    border:'1px solid rgba(255,255,255,0.15)'}}>{g}</span>
                ))}
              </div>
            </div>

            {/* synopsis */}
            <p style={{font:'500 13.5px/1.55 "Space Grotesk"',color:'rgba(255,255,255,0.88)',
              maxWidth:760, margin:0, textWrap:'pretty'}}>{anime.synopsis}</p>

            {/* progress */}
            <div style={{display:'flex',alignItems:'center',gap:14,marginTop:6,maxWidth:760}}>
              <div style={{flex:1,height:6,background:'rgba(0,0,0,0.4)',borderRadius:99,overflow:'hidden'}}>
                <div style={{width:`${watchedPct}%`,height:'100%',background:theme.accent,borderRadius:99,
                  boxShadow:`0 0 12px ${theme.accent}`}}/>
              </div>
              <div style={{font:'600 12px JetBrains Mono',color:'#fff',whiteSpace:'nowrap'}}>
                {anime.watched}/{anime.eps} ep · {Math.round(watchedPct)}%
              </div>
              {anime.next && <div style={{font:'500 11px JetBrains Mono',color:theme.accent2,
                background:'rgba(0,0,0,0.35)',padding:'4px 9px',borderRadius:99,whiteSpace:'nowrap'}}>
                další: {anime.next}
              </div>}
            </div>

            {/* actions */}
            <div style={{display:'flex',gap:8,marginTop:6,flexWrap:'wrap'}}>
              <button style={{...btnPrimary(theme),padding:'8px 16px',fontSize:13}}>▶ Pokračovat EP {anime.watched+1<=anime.eps?String(anime.watched+1).padStart(2,'0'):'—'}</button>
              <button style={{...btnSub(theme),background:'rgba(255,255,255,0.12)',color:'#fff',
                border:'1px solid rgba(255,255,255,0.2)'}}>+ Sleduji</button>
              {missingCount>0 && <button style={{...btnSub(theme),background:'rgba(255,255,255,0.12)',color:'#fff',
                border:'1px solid rgba(255,255,255,0.2)'}}>↓ Stáhnout chybějící ({missingCount})</button>}
              <button style={{...btnSub(theme),background:'rgba(255,255,255,0.12)',color:'#fff',
                border:'1px solid rgba(255,255,255,0.2)'}}>🅰 Hromadný překlad ({missingCount})</button>
              <button style={{...btnSub(theme),background:'rgba(255,255,255,0.12)',color:'#fff',
                border:'1px solid rgba(255,255,255,0.2)'}}>📁 Otevřít složku</button>
              <button style={{...btnSub(theme),background:'rgba(255,255,255,0.12)',color:'#fff',
                border:'1px solid rgba(255,255,255,0.2)',marginLeft:'auto'}}>⋯</button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── TABS ─────────────────────────────────────────── */}
      <div style={{display:'flex',gap:2,padding:'0 24px',borderBottom:`1px solid ${theme.border}`,
        background:theme.panel,flex:'0 0 auto'}}>
        {[
          ['eps',  `Epizody · ${anime.eps}`],
          ['subs', `Titulky · ${aiPending} čeká revizi`],
          ['files',`Soubory`],
          ['info', `Info`],
        ].map(([k,l])=>(
          <button key={k} onClick={()=>setActiveTab(k)} style={{
            padding:'12px 16px', background:'transparent', border:'none',
            borderBottom:`2px solid ${activeTab===k?theme.accent:'transparent'}`,
            color:activeTab===k?theme.accent:theme.textDim,
            font:`600 13px "Space Grotesk"`, cursor:'pointer',marginBottom:-1,
          }}>{l}</button>
        ))}
      </div>

      {/* ─── TAB BODY ─────────────────────────────────────── */}
      <div style={{flex:1, overflowY:'auto', padding:'18px 24px',display:'flex',flexDirection:'column',gap:14}}>
        {activeTab==='eps' && (
          <>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
              <FilterPill theme={theme} label="Vše"             active={filter==='all'}          count={eps.length}        onClick={()=>setFilter('all')}/>
              <FilterPill theme={theme} label="Nesledováno"     active={filter==='unwatched'}    count={eps.filter(e=>!e.watched).length} onClick={()=>setFilter('unwatched')}/>
              <FilterPill theme={theme} label="Chybí titulky"   active={filter==='missing-subs'} count={missingCount}     onClick={()=>setFilter('missing-subs')}/>
              <FilterPill theme={theme} label="AI čeká revizi"  active={filter==='ai-pending'}   count={aiPending}         onClick={()=>setFilter('ai-pending')}/>
              <div style={{marginLeft:'auto',font:'500 11px JetBrains Mono',color:theme.textMute}}>{filtered.length} z {eps.length}</div>
            </div>

            <div style={{display:'flex',flexDirection:'column',background:theme.panel,
              border:`1px solid ${theme.border}`,borderRadius:10,overflow:'hidden'}}>
              {filtered.map((ep,i)=>(
                <EpisodeRow key={ep.n} ep={ep} anime={anime} theme={theme}
                  last={i===filtered.length-1}
                  onOpenSubs={()=>onOpenSubs && onOpenSubs(anime, ep.n)}/>
              ))}
            </div>
          </>
        )}

        {activeTab==='subs' && <SubsMatrix theme={theme} anime={anime} eps={eps} onOpenSubs={onOpenSubs}/>}

        {activeTab==='files' && <FilesView theme={theme} anime={anime} eps={eps}/>}

        {activeTab==='info' && <InfoView theme={theme} anime={anime}/>}
      </div>
    </div>
  );
}

// ─── Episode row ────────────────────────────────────────────────────────
function EpisodeRow({ ep, anime, theme, last, onOpenSubs }){
  const sm = SUB_STATE_META[ep.subState];
  const subColor = theme[sm.color];

  return (
    <div style={{
      display:'grid', gridTemplateColumns:'70px 130px 1fr 90px 170px 220px',
      gap:14, alignItems:'center', padding:'12px 14px',
      borderBottom:last?'none':`1px solid ${theme.border}`,
      background: ep.watched ? 'transparent' : theme.panel2,
      opacity: ep.subState==='none' && !ep.watched ? 0.85 : 1,
    }}>
      {/* ep # */}
      <div style={{display:'flex',alignItems:'center',gap:6}}>
        {ep.watched && <span style={{width:8,height:8,borderRadius:99,background:theme.statusDone}}/>}
        <span style={{font:'700 14px JetBrains Mono',color:ep.watched?theme.textDim:theme.text}}>
          EP {String(ep.n).padStart(2,'0')}
        </span>
      </div>

      {/* mini thumbnail */}
      <div style={{width:120,height:68,borderRadius:6,overflow:'hidden',position:'relative',
        background:`linear-gradient(135deg, hsla(${anime.hue},50%,28%,1), hsla(${(anime.hue+30)%360},40%,15%,1))`,
        border:`1px solid ${theme.border}`}}>
        <svg width="100%" height="100%" style={{position:'absolute',inset:0,opacity:0.18}}>
          <pattern id={`ep-${anime.id}-${ep.n}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="white" strokeWidth="0.8"/>
          </pattern>
          <rect width="100%" height="100%" fill={`url(#ep-${anime.id}-${ep.n})`}/>
        </svg>
        <div style={{position:'absolute',right:4,top:4,padding:'1px 5px',background:'rgba(0,0,0,0.55)',
          borderRadius:3,font:'700 9px JetBrains Mono',color:'#fff'}}>{ep.duration}m</div>
        {ep.watched && <div style={{position:'absolute',left:4,bottom:4,padding:'1px 5px',
          background:'rgba(0,0,0,0.55)',borderRadius:3,font:'600 9px JetBrains Mono',color:theme.statusDone}}>✓ Sledováno</div>}
      </div>

      {/* title */}
      <div style={{minWidth:0}}>
        <div style={{font:'600 13.5px "Space Grotesk"',color:theme.text,
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ep.title}</div>
        <div style={{font:'500 11px JetBrains Mono',color:theme.textMute,marginTop:3,
          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          {anime.id}.s{String(anime.season).padStart(2,'0')}e{String(ep.n).padStart(2,'0')}.1080p.mkv
        </div>
      </div>

      {/* size */}
      <div style={{font:'500 11px JetBrains Mono',color:theme.textDim}}>
        {ep.hasFile ? `${ep.sizeGB.toFixed(1)} GB` : '—'}
      </div>

      {/* sub status */}
      <div>
        <StatusPill theme={theme} color={subColor} label={`${sm.icon} ${sm.label}`} size="sm"/>
      </div>

      {/* actions */}
      <div style={{display:'flex',gap:5,justifyContent:'flex-end'}}>
        {ep.subState==='both' && <>
          <button onClick={onOpenSubs} style={{...btnGhost(theme),padding:'5px 10px',fontSize:11}}>Otevřít titulky</button>
          <button style={{...btnGhost(theme),padding:'5px 10px',fontSize:11}}>▶ Přehrát</button>
        </>}
        {ep.subState==='jp' && <>
          <button onClick={onOpenSubs} style={{...btnPrimary(theme),padding:'5px 10px',fontSize:11}}>✦ Přeložit do CS</button>
        </>}
        {ep.subState==='ai-draft' && <>
          <button onClick={onOpenSubs} style={{...btnPrimary(theme),padding:'5px 10px',fontSize:11,
            background:theme.accent3,boxShadow:`0 4px 14px ${theme.accent3}55`}}>✦ Revidovat AI</button>
        </>}
        {ep.subState==='none' && <>
          <button style={{...btnGhost(theme),padding:'5px 10px',fontSize:11}}>↓ Stáhnout</button>
        </>}
        <button style={{...btnGhost(theme),padding:'5px 8px',fontSize:13}}>⋯</button>
      </div>
    </div>
  );
}

// ─── Subs matrix tab ────────────────────────────────────────────────────
function SubsMatrix({ theme, anime, eps, onOpenSubs }){
  const langs = [
    { code:'jp', label:'日本語', sub:'zdroj' },
    { code:'cs', label:'Čeština', sub:'cíl' },
    { code:'en', label:'English', sub:'záloha' },
  ];
  // map ep + lang → state
  const cellState = (ep, lang)=>{
    if(lang==='jp') return ep.subState==='none' ? 'none' : 'ok';
    if(lang==='cs'){
      if(ep.subState==='both') return 'ok';
      if(ep.subState==='ai-draft') return 'ai';
      return ep.subState==='jp' ? 'missing' : 'none';
    }
    return ep.n<=3 ? 'ok' : 'missing';
  };
  const cellColor = (state)=>({
    ok:theme.statusDone, ai:theme.accent3, missing:theme.statusUpcoming, none:theme.statusEnded,
  }[state]);
  const cellIcon = (state)=>({ ok:'✓', ai:'✦', missing:'!', none:'×' }[state]);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{display:'flex',gap:10}}>
        <StatCard theme={theme} label="Hotovo (CS)" value={eps.filter(e=>e.subState==='both').length} sub={`z ${eps.length}`} accent={theme.statusDone}/>
        <StatCard theme={theme} label="Jen JP" value={eps.filter(e=>e.subState==='jp').length} sub="potřeba přeložit" accent={theme.statusUpcoming}/>
        <StatCard theme={theme} label="AI návrh" value={eps.filter(e=>e.subState==='ai-draft').length} sub="čeká revizi" accent={theme.accent3}/>
        <StatCard theme={theme} label="Chybí úplně" value={eps.filter(e=>e.subState==='none').length} sub="ani JP" accent={theme.statusEnded}/>
        <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8}}>
          <button style={btnSub(theme)}>↑ Import .ass / .srt</button>
          <button style={btnPrimary(theme)}>✦ Přeložit chybějící hromadně</button>
        </div>
      </div>

      {/* matrix */}
      <div style={{background:theme.panel,border:`1px solid ${theme.border}`,borderRadius:10,
        overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:`80px 1.4fr repeat(${langs.length}, 1fr) 90px`,
          gap:0,padding:'10px 14px', background:theme.panel2,
          font:'600 10px JetBrains Mono',color:theme.textDim,letterSpacing:'.06em',textTransform:'uppercase',
          borderBottom:`1px solid ${theme.border}`}}>
          <div>EP</div>
          <div>Název</div>
          {langs.map(l=>(
            <div key={l.code} style={{display:'flex',flexDirection:'column'}}>
              <span style={{color:theme.text}}>{l.label}</span>
              <span style={{fontSize:9,fontWeight:500,marginTop:1}}>{l.sub}</span>
            </div>
          ))}
          <div style={{textAlign:'right'}}>akce</div>
        </div>
        {eps.map((ep,i)=>(
          <div key={ep.n} style={{
            display:'grid',gridTemplateColumns:`80px 1.4fr repeat(${langs.length}, 1fr) 90px`,
            gap:0, padding:'10px 14px', alignItems:'center',
            borderBottom:i===eps.length-1?'none':`1px solid ${theme.border}`,
          }}>
            <div style={{font:'700 12px JetBrains Mono',color:theme.text}}>EP {String(ep.n).padStart(2,'0')}</div>
            <div style={{font:'500 13px "Space Grotesk"',color:theme.text,
              whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ep.title}</div>
            {langs.map(lang=>{
              const s = cellState(ep, lang.code);
              return (
                <div key={lang.code}>
                  <span onClick={()=>lang.code==='cs' && (s==='ai'||s==='missing') && onOpenSubs && onOpenSubs(anime, ep.n)} style={{
                    display:'inline-flex',alignItems:'center',gap:5,
                    padding:'3px 9px', borderRadius:99,
                    background:`${cellColor(s)}22`, color:cellColor(s),
                    border:`1px solid ${cellColor(s)}55`,
                    font:'600 10.5px JetBrains Mono',
                    cursor:(s==='ai'||s==='missing')?'pointer':'default',
                  }}>{cellIcon(s)} {s==='ok'?'hotovo':s==='ai'?'AI':s==='missing'?'chybí':'—'}</span>
                </div>
              );
            })}
            <div style={{textAlign:'right'}}>
              <button onClick={()=>onOpenSubs && onOpenSubs(anime, ep.n)} style={{...btnGhost(theme),padding:'4px 8px',fontSize:11}}>Otevřít</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Files tab ──────────────────────────────────────────────────────────
function FilesView({ theme, anime, eps }){
  const totalGB = eps.reduce((s,e)=>s+(e.hasFile?e.sizeGB:0),0);
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{display:'flex',gap:10}}>
        <StatCard theme={theme} label="Soubory" value={eps.filter(e=>e.hasFile).length} sub={`z ${eps.length} epizod`} accent={theme.accent}/>
        <StatCard theme={theme} label="Celkem" value={`${totalGB.toFixed(1)} GB`} sub="na disku" accent={theme.accent2}/>
        <StatCard theme={theme} label="Kvalita" value="1080p" sub="100 % shodné s profilem" accent={theme.statusDone}/>
      </div>
      <div style={{background:theme.panel,border:`1px solid ${theme.border}`,borderRadius:10,
        padding:'10px 14px',font:'500 12px JetBrains Mono',color:theme.textDim}}>
        📁 /srv/media/anime/{anime.title.toLowerCase().replace(/[^a-z0-9]/g,'_')}/
      </div>
      <div style={{background:theme.panel,border:`1px solid ${theme.border}`,borderRadius:10,overflow:'hidden'}}>
        {eps.filter(e=>e.hasFile).map((ep,i,arr)=>(
          <div key={ep.n} style={{
            display:'grid', gridTemplateColumns:'90px 1fr 100px 120px auto',
            gap:12, padding:'10px 14px', alignItems:'center',
            borderBottom:i===arr.length-1?'none':`1px solid ${theme.border}`,
            fontFamily:'JetBrains Mono',
          }}>
            <div style={{font:'700 12px JetBrains Mono',color:theme.text}}>EP {String(ep.n).padStart(2,'0')}</div>
            <div style={{font:'500 12px JetBrains Mono',color:theme.text,
              whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              {anime.id}.s{String(anime.season).padStart(2,'0')}e{String(ep.n).padStart(2,'0')}.1080p.mkv
            </div>
            <div style={{font:'500 11px JetBrains Mono',color:theme.textDim}}>{ep.sizeGB.toFixed(1)} GB</div>
            <div style={{font:'500 11px JetBrains Mono',color:theme.textDim}}>x264 · AAC</div>
            <div style={{display:'flex',gap:5,justifyContent:'flex-end'}}>
              <button style={{...btnGhost(theme),padding:'4px 8px',fontSize:11}}>Přehrát</button>
              <button style={{...btnGhost(theme),padding:'4px 8px',fontSize:11}}>⋯</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Info tab ───────────────────────────────────────────────────────────
function InfoView({ theme, anime }){
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
      <div style={{background:theme.panel,border:`1px solid ${theme.border}`,borderRadius:10,padding:16}}>
        <div style={{font:'700 14px "Space Grotesk"',color:theme.text,marginBottom:12}}>Metadata</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[
            ['Originální název', anime.jp],
            ['Romaji', anime.title],
            ['Studio', anime.studio],
            ['Rok', anime.year],
            ['Řada', `S${anime.season} · ${anime.eps} epizod`],
            ['Žánry', anime.genres.join(' · ')],
            ['Hodnocení', anime.score?`★ ${anime.score} / 10`:'—'],
            ['Stav', STATUS_LABELS[anime.status].label],
          ].map(([k,v])=>(
            <div key={k} style={{display:'flex',gap:10,padding:'6px 0',borderBottom:`1px solid ${theme.border}`}}>
              <div style={{flex:'0 0 140px',font:'500 12px "Space Grotesk"',color:theme.textDim}}>{k}</div>
              <div style={{font:'600 12px "Space Grotesk"',color:theme.text}}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{background:theme.panel,border:`1px solid ${theme.border}`,borderRadius:10,padding:16}}>
          <div style={{font:'700 14px "Space Grotesk"',color:theme.text,marginBottom:12}}>Externí odkazy</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {[
              ['AniList',`anilist.co/anime/${anime.id}`],
              ['MyAnimeList',`myanimelist.net/anime/${anime.id}`],
              ['AniDB',`anidb.net/anime/${anime.id}`],
              ['Oficiální stránka',`${anime.id}.tv`],
            ].map(([k,v])=>(
              <a key={k} href="#" onClick={(e)=>e.preventDefault()} style={{
                display:'flex',justifyContent:'space-between',padding:'7px 10px',
                background:theme.panel2,border:`1px solid ${theme.border}`,borderRadius:7,
                textDecoration:'none',font:'500 12px "Space Grotesk"',color:theme.text,
              }}>
                <span>{k}</span>
                <span style={{font:'500 11px JetBrains Mono',color:theme.accent2}}>{v} ↗</span>
              </a>
            ))}
          </div>
        </div>
        <div style={{background:theme.panel,border:`1px solid ${theme.border}`,borderRadius:10,padding:16}}>
          <div style={{font:'700 14px "Space Grotesk"',color:theme.text,marginBottom:10}}>Aktivita</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {[
              ['dnes 03:21','EP 03 přeloženo do CS (AI revize · @kuro)'],
              ['včera 14:02','EP 03 staženo (1.4 GB)'],
              ['před 3 dny','Přidáno do knihovny z AniList'],
            ].map(([when,what],i)=>(
              <div key={i} style={{display:'flex',gap:10,padding:'6px 0',
                borderBottom:i===2?'none':`1px solid ${theme.border}`}}>
                <div style={{flex:'0 0 110px',font:'500 11px JetBrains Mono',color:theme.textMute}}>{when}</div>
                <div style={{font:'500 12px "Space Grotesk"',color:theme.textDim}}>{what}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.AnimeDetail = AnimeDetail;
