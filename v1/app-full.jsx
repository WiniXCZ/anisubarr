// app-full.jsx — Animsubarr · plná appka s routingem mezi taby

// ─── Subtitle editor BODY (Studio layout bez vlastního AppShellu) ────────
function SubsBody({ theme, anime, episode=3 }){
  const ph = usePlayhead(7.2);
  const [lang, setLang] = React.useState('both');
  const [lines, setLines] = React.useState(SUB_LINES);
  const [activeId, setActiveId] = React.useState(4);
  const [stylingOpen, setStylingOpen] = React.useState(false);

  const t = ph.t;
  const playingLine = lines.find(l=> t>=l.start && t<=l.end);
  const onPickLine = (ln)=>{ setActiveId(ln.id); ph.setT(ln.start + 0.1); };
  const onDragLine = (id, edge, tt)=>{
    setLines(prev=>prev.map(l=>{
      if(l.id!==id) return l;
      if(edge==='start') return {...l, start:Math.min(tt, l.end-0.2)};
      if(edge==='end')   return {...l, end:Math.max(tt, l.start+0.2)};
      return l;
    }));
  };
  const updateText = (id, field, val)=>{
    setLines(prev=>prev.map(l=> l.id===id?{...l,[field]:val}:l));
  };

  const a = anime || LIBRARY.find(x=>x.id==='sad');

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      {/* sub-page header */}
      <div style={{
        display:'flex',alignItems:'center',gap:14,
        padding:'12px 20px', borderBottom:`1px solid ${theme.border}`,
        background:theme.bg, flex:'0 0 auto',
      }}>
        <AnimePoster anime={a} theme={theme} size="sm" radius={4}/>
        <div style={{display:'flex',flexDirection:'column',lineHeight:1.2,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{font:'700 15px "Space Grotesk"',color:theme.text}}>{a.title}</div>
            <StatusPill theme={theme} color={theme[STATUS_LABELS[a.status].colorKey]} label={STATUS_LABELS[a.status].label}/>
            <span style={{font:'600 11px JetBrains Mono',color:theme.textDim}}>S{a.season} · EP {String(episode).padStart(2,'0')}</span>
            <span style={{font:'500 11px "Noto Sans JP"',color:theme.textDim}}>「{a.jp}」</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4,font:'500 11px JetBrains Mono',color:theme.textMute}}>
            <span style={{color:theme.text}}>{a.id}.s{String(a.season).padStart(2,'0')}e{String(episode).padStart(2,'0')}.1080p.mkv</span>
            <span style={{color:theme.textMute}}>·</span>
            <span style={{color:theme.statusDone}}>● uloženo</span><span>03:21 utc</span>
            <span style={{color:theme.textMute}}>·</span>
            <span>{lines.length} řádků</span>
          </div>
        </div>
        {/* episode picker */}
        <div style={{display:'flex',gap:3,marginLeft:8,background:theme.panel2,padding:3,borderRadius:8,border:`1px solid ${theme.border}`}}>
          {[1,2,3,4,5].map(n=>(
            <button key={n} style={{
              width:28,height:26,borderRadius:5,border:'none',cursor:'pointer',
              background:n===episode?theme.accent:'transparent',
              color:n===episode?'#fff':theme.textDim,
              font:`${n===episode?'700':'500'} 11px JetBrains Mono`,
            }}>{String(n).padStart(2,'0')}</button>
          ))}
          <button style={{width:26,height:26,borderRadius:5,border:'none',background:'transparent',color:theme.textMute,cursor:'pointer',font:'600 14px "Space Grotesk"'}}>…</button>
        </div>
        <div style={{marginLeft:'auto', display:'flex',gap:8, alignItems:'center'}}>
          <LangTabs theme={theme} value={lang} onChange={setLang}/>
          <button onClick={()=>setStylingOpen(true)} style={btnSub(theme)}>🅰 Styl</button>
          <button style={btnSub(theme)}>↗ Export ▾</button>
          <button style={btnPrimary(theme)}>✦ AI vyplnit</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1, display:'flex', minHeight:0}}>
        <div style={{flex:'1 1 60%', display:'flex',flexDirection:'column',padding:16,gap:14,minWidth:0}}>
          <div style={{display:'flex',gap:12,flex:'0 0 auto'}}>
            <VideoFrame theme={theme} t={t} line={playingLine} lang={lang}
              style={{flex:1, aspectRatio:'16/9'}}
              label={`${a.id}.s01e03 · 1080p`}/>
            <div style={{width:220,display:'flex',flexDirection:'column',gap:8}}>
              <div style={{flex:1, background:theme.panel, border:`1px solid ${theme.border}`,
                borderRadius:10, padding:12, display:'flex', flexDirection:'column', gap:8, minHeight:0}}>
                <div style={{font:'600 11px JetBrains Mono',color:theme.textDim,letterSpacing:'.06em',textTransform:'uppercase'}}>Právě hraje</div>
                {playingLine ? (
                  <>
                    <div style={{font:'700 16px/1.3 "Noto Sans JP"',color:theme.text}}>{playingLine.jp}</div>
                    <div style={{font:'500 12.5px/1.3 "Space Grotesk"',color:theme.textDim}}>{playingLine.en}</div>
                  </>
                ) : (
                  <div style={{font:'500 12px "Space Grotesk"',color:theme.textMute,fontStyle:'italic'}}>— ticho —</div>
                )}
                <div style={{marginTop:'auto',display:'flex',gap:4,flexWrap:'wrap'}}>
                  {playingLine && <>
                    <Chip theme={theme} dot label="od" value={fmtMS(playingLine.start)}/>
                    <Chip theme={theme} label="trvání" value={(playingLine.end-playingLine.start).toFixed(2)+'s'}/>
                  </>}
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                <Chip theme={theme} dot accent={theme.accent} label="CPS" value="14"/>
                <Chip theme={theme} dot accent={theme.accent2} label="WPS" value="2.1"/>
                <Chip theme={theme} label="Řádků" value={lines.length}/>
                <Chip theme={theme} label="Mezery" value="0"/>
              </div>
            </div>
          </div>

          <div style={{flex:'0 0 auto'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
              <div style={{font:'600 10px JetBrains Mono',color:theme.textDim,letterSpacing:'.06em',textTransform:'uppercase'}}>Audio · jp_vo.wav · táhni okraje pro přečasování</div>
              <div style={{marginLeft:'auto',display:'flex',gap:4}}>
                {['◀','⏵','▶','⊕','⊖','✂'].map((g,i)=>(
                  <button key={i} style={{...btnGhost(theme),padding:'3px 7px',fontSize:11}}>{g}</button>
                ))}
              </div>
            </div>
            <Waveform theme={theme} t={t} setT={ph.setT} height={140}
              onDragLine={onDragLine} activeId={activeId} onPickLine={onPickLine}/>
          </div>

          <div style={{flex:'0 0 auto'}}>
            <Transport theme={theme} ph={ph}
              extra={
                <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
                  <HotkeyStrip theme={theme} keys={[['␣','přehrát'],['J/L','-/+1s'],['↑↓','řádek'],['⏎','upravit']]}/>
                </div>
              }/>
          </div>

          <StylingPanel theme={theme} open={stylingOpen} onClose={()=>setStylingOpen(false)}/>
        </div>

        <div style={{
          flex:'0 0 440px', background:theme.panel,
          borderLeft:`1px solid ${theme.border}`,
          display:'flex',flexDirection:'column', minWidth:0,
        }}>
          <div style={{padding:'12px 16px', borderBottom:`1px solid ${theme.border}`,
            display:'flex',alignItems:'center',gap:8}}>
            <div style={{font:'600 13px "Space Grotesk"',color:theme.text}}>Titulky</div>
            <div style={{font:'500 11px JetBrains Mono',color:theme.textMute}}>{lines.length} řádků</div>
            <input placeholder="Hledat…" style={{
              marginLeft:'auto', background:theme.panel2,
              border:`1px solid ${theme.border}`, borderRadius:6,
              padding:'4px 8px', color:theme.text, outline:'none',
              font:'500 11px "Space Grotesk"', width:120,
            }}/>
            <button style={{...btnGhost(theme),padding:'4px 8px',fontSize:11}}>＋</button>
          </div>
          <div style={{flex:1, overflowY:'auto', display:'flex',flexDirection:'column'}}>
            {lines.map((ln)=>{
              const isActive = ln.id===activeId;
              const isPlaying = t>=ln.start && t<=ln.end;
              return (
                <div key={ln.id} onClick={()=>onPickLine(ln)} style={{
                  padding:'11px 16px',
                  background:isPlaying ? theme.accent2Soft : (isActive ? theme.accentSoft : 'transparent'),
                  borderBottom:`1px solid ${theme.border}`,
                  cursor:'pointer', position:'relative',
                  borderLeft:`3px solid ${isPlaying?theme.accent2:(isActive?theme.accent:'transparent')}`,
                }}>
                  <div style={{display:'flex',gap:8,alignItems:'baseline',marginBottom:5}}>
                    <div style={{font:'700 11px JetBrains Mono',color:isActive?theme.accent:theme.textMute,minWidth:24}}>#{ln.id}</div>
                    <div style={{font:'500 10px JetBrains Mono',color:theme.textDim}}>
                      {fmtMS(ln.start)} → {fmtMS(ln.end)}
                    </div>
                    <div style={{marginLeft:'auto',font:'500 10px JetBrains Mono',color:theme.textMute}}>
                      {(ln.end-ln.start).toFixed(2)}s
                    </div>
                    {ln.note && <StatusPill theme={theme} color={theme.accent3} label={ln.note} size="sm"/>}
                  </div>
                  <div contentEditable suppressContentEditableWarning
                    onClick={(e)=>e.stopPropagation()}
                    onBlur={(e)=>updateText(ln.id,'jp',e.target.textContent)}
                    style={{font:'600 14px/1.35 "Noto Sans JP"',color:theme.text, outline:'none',
                      padding:'2px 4px', margin:'-2px -4px 2px', borderRadius:4}}>{ln.jp}</div>
                  <div contentEditable suppressContentEditableWarning
                    onClick={(e)=>e.stopPropagation()}
                    onBlur={(e)=>updateText(ln.id,'en',e.target.textContent)}
                    style={{font:'500 12.5px/1.35 "Space Grotesk"',color:theme.textDim, outline:'none',
                      padding:'2px 4px', margin:'-2px -4px', borderRadius:4}}>{ln.en}</div>
                  {isActive && (
                    <AISuggest theme={theme} line={ln}
                      onApply={(text)=>updateText(ln.id,'en',text)}
                      style={{marginTop:8}}/>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Plná appka — routing mezi taby ───────────────────────────────────────
function FullApp({ theme }){
  const [tab, setTab] = React.useState('library');
  const [openedAnime, setOpenedAnime] = React.useState(null);
  const [openedEp, setOpenedEp] = React.useState(3);

  const openSubs = (anime, ep)=>{
    setOpenedAnime(anime || LIBRARY.find(a=>a.id==='sad'));
    if(ep) setOpenedEp(ep);
    setTab('subs');
  };

  return (
    <AppShell theme={theme} active={tab} onNav={setTab} syncCount={3}>
      {tab==='library'  && <LibraryPage  theme={theme} onOpenSubs={openSubs}/>}
      {tab==='sched'    && <SchedulePage theme={theme} onOpenSubs={openSubs}/>}
      {tab==='cal'      && <CalendarPage theme={theme}/>}
      {tab==='req'      && <RequestsPage theme={theme}/>}
      {tab==='files'    && <FilesPage    theme={theme}/>}
      {tab==='sett'     && <SettingsPage theme={theme}/>}
      {tab==='subs'     && <SubsBody     theme={theme} anime={openedAnime} episode={openedEp}/>}
    </AppShell>
  );
}

window.FullApp = FullApp;
window.SubsBody = SubsBody;
