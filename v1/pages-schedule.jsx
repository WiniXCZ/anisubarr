// pages-schedule.jsx — Harmonogram & Kalendář

// Synthetic schedule items mapped onto LIBRARY
const SCHEDULE = [
  // dnes — středa 20. 5. 2026
  { day:'Dnes', date:'St 20. 5.', items:[
    { time:'14:00', animeId:'sad', ep:4,  state:'downloading', progress:62, sub:'Stahuje se · ETA 02:14', issue:null },
    { time:'14:00', animeId:'yd',  ep:12, state:'ready',       progress:100,sub:'Připraveno · titulky JP+CS',          issue:null },
    { time:'19:30', animeId:'nc',  ep:8,  state:'missing-sub', progress:100,sub:'Hotovo, ale chybí titulky',           issue:'no-subs' },
  ]},
  { day:'Zítra', date:'Čt 21. 5.', items:[
    { time:'16:00', animeId:'qs', ep:19, state:'scheduled', progress:0, sub:'Plánováno · indexer: NyaaSi',     issue:null },
  ]},
  { day:'Pátek', date:'Pá 22. 5.', items:[
    { time:'17:00', animeId:'gp', ep:6,  state:'scheduled', progress:0, sub:'Plánováno · indexer: BakaBT',     issue:null },
  ]},
  { day:'Sobota',  date:'So 23. 5.', items:[] },
  { day:'Neděle',  date:'Ne 24. 5.', items:[] },
];

function stateMeta(theme, state){
  const m = {
    downloading:{ color:theme.accent,         label:'Stahuje se', icon:'↓' },
    ready:      { color:theme.statusDone,     label:'Připraveno', icon:'✓' },
    'missing-sub':{ color:theme.statusUpcoming, label:'Chybí titulky', icon:'⚠' },
    scheduled:  { color:theme.textDim,        label:'Plánováno',  icon:'◷' },
  };
  return m[state] || m.scheduled;
}

// ─── HARMONOGRAM ────────────────────────────────────────────────────────
function SchedulePage({ theme, onOpenSubs }){
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={theme} title="Harmonogram" subtitle="Sledované série · příští epizody · stav stahování"
        right={<>
          <button style={btnSub(theme)}>⟲ Obnovit indexery</button>
          <button style={btnSub(theme)}>⚙ Pravidla</button>
        </>}/>
      <div style={{flex:1,overflowY:'auto',padding:'18px 24px',display:'flex',flexDirection:'column',gap:18}}>
        <div style={{display:'flex',gap:10}}>
          <StatCard theme={theme} label="Dnes" value="3" sub="2 hotové, 1 stahuje" accent={theme.accent}/>
          <StatCard theme={theme} label="Tento týden" value="11" sub="napříč 7 sériemi" accent={theme.accent2}/>
          <StatCard theme={theme} label="Chybí titulky" value="1" sub="vyřešit ručně" accent={theme.statusUpcoming}/>
          <StatCard theme={theme} label="Stahuje se" value="3" sub="∑ 4.2 GB / 6.8 GB" accent={theme.statusAiring}/>
        </div>

        {SCHEDULE.map((day, i)=>(
          <div key={day.day} style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',alignItems:'baseline',gap:10}}>
              <div style={{font:'700 16px "Space Grotesk"',color:theme.text}}>{day.day}</div>
              <div style={{font:'500 12px JetBrains Mono',color:theme.textMute}}>{day.date}</div>
              <div style={{flex:1, height:1, background:theme.border, marginLeft:6}}/>
              <div style={{font:'500 11px JetBrains Mono',color:theme.textMute}}>{day.items.length} epizod</div>
            </div>
            {day.items.length === 0 ? (
              <div style={{padding:'18px 16px', background:theme.panel, border:`1px dashed ${theme.border}`,
                borderRadius:10, font:'500 12px "Space Grotesk"',color:theme.textMute,textAlign:'center'}}>
                Žádné epizody v tomto dni
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {day.items.map((it,j)=>{
                  const anime = LIBRARY.find(a=>a.id===it.animeId);
                  const sm = stateMeta(theme, it.state);
                  return (
                    <div key={j} style={{
                      display:'grid', gridTemplateColumns:'70px 60px 1fr 200px 220px auto',
                      gap:14, alignItems:'center', padding:'12px 14px',
                      background:theme.panel, border:`1px solid ${theme.border}`, borderRadius:10,
                    }}>
                      <div style={{font:'700 16px JetBrains Mono',color:theme.text}}>{it.time}</div>
                      <AnimePoster anime={anime} theme={theme} size="sm" radius={4}/>
                      <div style={{minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <div style={{font:'600 13px "Space Grotesk"',color:theme.text}}>{anime.title}</div>
                          <div style={{font:'500 11px JetBrains Mono',color:theme.accent}}>EP {String(it.ep).padStart(2,'0')}</div>
                        </div>
                        <div style={{font:'500 11px JetBrains Mono',color:theme.textDim,marginTop:2}}>{it.sub}</div>
                      </div>
                      {/* progress */}
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                          <StatusPill theme={theme} color={sm.color} label={`${sm.icon} ${sm.label}`} size="sm"/>
                          <div style={{font:'600 11px JetBrains Mono',color:theme.text,marginLeft:'auto'}}>{it.progress}%</div>
                        </div>
                        <div style={{height:4,background:theme.sunken,borderRadius:99,overflow:'hidden'}}>
                          <div style={{width:`${it.progress}%`,height:'100%',background:sm.color,borderRadius:99}}/>
                        </div>
                      </div>
                      {/* meta */}
                      <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                        {it.issue === 'no-subs' ? (
                          <button onClick={()=>onOpenSubs && onOpenSubs(anime, it.ep)}
                            style={{...btnPrimary(theme), padding:'5px 10px', fontSize:11}}>
                            ✦ Vytvořit titulky
                          </button>
                        ) : (
                          <>
                            <button style={{...btnGhost(theme),padding:'4px 8px',fontSize:11}}>Otevřít</button>
                            <button style={{...btnGhost(theme),padding:'4px 8px',fontSize:11}}>Titulky</button>
                          </>
                        )}
                      </div>
                      {/* kebab */}
                      <button style={{...btnGhost(theme),padding:'4px 7px',fontSize:14}}>⋯</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── KALENDÁŘ ───────────────────────────────────────────────────────────
function CalendarPage({ theme }){
  // Synthetic May 2026 grid (begins Thu)
  const month = 'Květen 2026';
  const weeks = []; // 5 rows
  // build 5x7 with day numbers; map LIBRARY airing items to specific dates
  const releaseMap = {
    18:[{a:'nc'}],
    20:[{a:'sad'},{a:'yd'},{a:'nc'}],
    21:[{a:'qs'}],
    22:[{a:'gp'}],
    25:[{a:'nc'}],
    27:[{a:'sad'},{a:'yd'}],
    28:[{a:'qs'}],
    29:[{a:'gp'}],
    13:[{a:'sad'},{a:'yd'}],
    14:[{a:'qs'}],
    11:[{a:'nc'}],
    8:[{a:'gp'}],
    7:[{a:'qs'}],
    6:[{a:'sad'},{a:'yd'}],
  };
  // build calendar grid starting on Friday May 1
  const startWeekday = 4; // 0=Mon ... 4=Fri
  const daysInMonth = 31;
  let cells = [];
  for(let i=0;i<startWeekday;i++) cells.push(null);
  for(let d=1; d<=daysInMonth; d++) cells.push(d);
  while(cells.length%7) cells.push(null);
  for(let i=0;i<cells.length;i+=7) weeks.push(cells.slice(i,i+7));

  const today = 20;

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={theme} title="Kalendář" subtitle="Měsíční přehled premiérových epizod"
        right={<>
          <div style={{display:'flex',alignItems:'center',gap:6,background:theme.panel2,
            border:`1px solid ${theme.border}`,borderRadius:8,padding:2}}>
            <button style={{...btnGhost(theme),padding:'4px 8px',border:'none'}}>‹</button>
            <div style={{font:'700 13px "Space Grotesk"',color:theme.text,padding:'0 8px'}}>{month}</div>
            <button style={{...btnGhost(theme),padding:'4px 8px',border:'none'}}>›</button>
          </div>
          <div style={{display:'flex',background:theme.panel2,padding:2,borderRadius:8,border:`1px solid ${theme.border}`}}>
            {['Měsíc','Týden','Agenda'].map((v,i)=>(
              <button key={v} style={{padding:'4px 10px',borderRadius:6,border:'none',cursor:'pointer',
                background:i===0?theme.panel:'transparent',
                color:i===0?theme.accent:theme.textDim,
                font:'600 11px "Space Grotesk"'}}>{v}</button>
            ))}
          </div>
        </>}/>

      <div style={{flex:1,overflowY:'auto',padding:'18px 24px',display:'flex',flexDirection:'column',gap:8}}>
        {/* weekday header */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:6}}>
          {['Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota','Neděle'].map(d=>(
            <div key={d} style={{font:'600 11px JetBrains Mono',color:theme.textDim,
              letterSpacing:'.04em',textTransform:'uppercase',padding:'0 6px'}}>{d}</div>
          ))}
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:6,flex:1}}>
          {weeks.map((week, wi)=>(
            <div key={wi} style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:6, minHeight:100}}>
              {week.map((day,di)=>{
                const isToday = day===today;
                const isWeekend = di>=5;
                const drops = day ? releaseMap[day] || [] : [];
                return (
                  <div key={di} style={{
                    background: day ? (isToday ? theme.accentSoft : theme.panel) : theme.bg,
                    border:`1px solid ${isToday?theme.accent:theme.border}`,
                    borderRadius:8, padding:8, display:'flex',flexDirection:'column',gap:4,
                    opacity: day ? 1 : 0.4,
                  }}>
                    {day && <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                      <div style={{font:`${isToday?'700':'600'} 13px JetBrains Mono`,
                        color:isToday?theme.accent:(isWeekend?theme.textDim:theme.text)}}>{day}</div>
                      {drops.length>0 && <div style={{font:'600 9px JetBrains Mono',color:theme.textMute}}>
                        {drops.length} ep
                      </div>}
                    </div>}
                    {drops.slice(0,3).map((drop,i)=>{
                      const anime = LIBRARY.find(a=>a.id===drop.a);
                      return (
                        <div key={i} style={{
                          display:'flex',alignItems:'center',gap:5,
                          padding:'3px 5px', borderRadius:5,
                          background:`hsla(${anime.hue},55%,30%,0.45)`,
                          border:`1px solid hsla(${anime.hue},65%,50%,0.55)`,
                        }}>
                          <div style={{width:5,height:5,borderRadius:99,background:`hsl(${anime.hue},70%,60%)`}}/>
                          <div style={{font:'600 10px "Space Grotesk"',color:'#fff',
                            whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1}}>
                            {anime.title}
                          </div>
                        </div>
                      );
                    })}
                    {drops.length>3 && <div style={{font:'500 10px JetBrains Mono',color:theme.textMute}}>
                      + {drops.length-3} dalších
                    </div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.SchedulePage = SchedulePage;
window.CalendarPage = CalendarPage;
