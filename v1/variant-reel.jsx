// variant-reel.jsx — Anisubarr "Reel" layout (uvnitř AppShell)

function VariantReel({ theme }){
  const ph = usePlayhead(11.4);
  const [lang, setLang] = React.useState('both');
  const [lines, setLines] = React.useState(SUB_LINES);
  const [activeId, setActiveId] = React.useState(5);

  const activeLine = lines.find(l=>l.id===activeId);
  const t = ph.t;
  const playingLine = lines.find(l=> t>=l.start && t<=l.end);

  const onPickLine = (ln)=>{ setActiveId(ln.id); ph.setT(ln.start+0.05); };
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

  return (
    <AppShell theme={theme} active="subs">
      {/* page header */}
      <div style={{display:'flex',alignItems:'center',gap:14,padding:'12px 20px',
        borderBottom:`1px solid ${theme.border}`, background:theme.bg, flex:'0 0 auto'}}>
        <button style={{...btnGhost(theme),padding:'6px 9px',display:'inline-flex',gap:6,alignItems:'center'}}>
          <NavIcon d={ICONS.back}/> Knihovna
        </button>
        <div style={{display:'flex',flexDirection:'column',lineHeight:1.2}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{font:'700 15px "Space Grotesk"',color:theme.text}}>Signal at Dusk</div>
            <StatusPill theme={theme} color={theme.statusAiring} label="Vysílá se"/>
            <span style={{font:'600 11px JetBrains Mono',color:theme.textDim}}>S01 · EP 03</span>
          </div>
          <div style={{font:'500 11px JetBrains Mono',color:theme.textMute,marginTop:3,letterSpacing:'.02em'}}>
            reel · časová osa · {fmtMS(TOTAL)} · v3
          </div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          <Chip theme={theme} dot accent={theme.accent3} label="AI kredit" value="412"/>
          <LangTabs theme={theme} value={lang} onChange={setLang} sizes="sm"/>
          <button style={btnSub(theme)}>↗ Export</button>
          <button style={btnPrimary(theme)}>Publikovat</button>
        </div>
      </div>

      {/* CENTER STAGE */}
      <div style={{flex:1, display:'flex', flexDirection:'column', minHeight:0,
        padding:'18px 22px', gap:14, position:'relative',
        backgroundImage:`radial-gradient(circle at 80% 10%, ${theme.accent}10 0%, transparent 45%)`}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{font:'700 13px "Space Grotesk"',color:theme.text}}>Časová osa</div>
          <div style={{font:'500 11px JetBrains Mono',color:theme.textMute}}>
            {fmtMS(ph.t)} <span style={{color:theme.textMute}}>· z</span> {fmtMS(TOTAL)}
          </div>
          <div style={{marginLeft:'auto',display:'flex',gap:4,alignItems:'center'}}>
            <Chip theme={theme} dot label="snap" value="0.1s"/>
            <Chip theme={theme} dot accent={theme.accent} label="aktivní" value={'#'+activeId}/>
            <div style={{display:'flex',gap:2,marginLeft:6}}>
              {['⊖','100%','⊕','⤢'].map((g,i)=>(
                <button key={i} style={{...btnGhost(theme),padding:'4px 7px',fontSize:11,fontFamily:'JetBrains Mono'}}>{g}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{position:'relative',height:18,background:theme.sunken,borderRadius:6,
          border:`1px solid ${theme.border}`,display:'flex',alignItems:'center',
          font:'500 10px JetBrains Mono',color:theme.textMute,overflow:'hidden'}}>
          {Array.from({length:Math.floor(TOTAL/2)+1}).map((_,i)=>(
            <div key={i} style={{position:'absolute',left:`${(i*2/TOTAL)*100}%`,top:0,bottom:0,
              borderLeft:`1px solid ${theme.border}`,paddingLeft:4,display:'flex',alignItems:'center'}}>
              {String(Math.floor(i*2/60)).padStart(2,'0')}:{String((i*2)%60).padStart(2,'0')}
            </div>
          ))}
        </div>

        <div style={{flex:'0 0 auto',position:'relative'}}>
          <Waveform theme={theme} t={t} setT={ph.setT} height={220}
            onDragLine={onDragLine} activeId={activeId} onPickLine={onPickLine}/>
          <div style={{
            position:'absolute', top:14, right:14, width:260,
            background:theme.panel, border:`1px solid ${theme.borderStrong}`,
            borderRadius:12, padding:8,
            boxShadow:'0 22px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03)',
          }}>
            <VideoFrame theme={theme} t={t} line={playingLine} lang={lang}
              style={{aspectRatio:'16/9'}} label="náhled · plovoucí"/>
            <div style={{display:'flex',alignItems:'center',gap:6,marginTop:8,padding:'0 2px'}}>
              <button onClick={ph.toggle} style={{
                ...btnPrimary(theme), width:30,height:30,borderRadius:99,padding:0,fontSize:11
              }}>{ph.playing?'❚❚':'▶'}</button>
              <div style={{font:'600 11px/1 JetBrains Mono',color:theme.text}}>{fmtMS(t)}</div>
              <div style={{marginLeft:'auto',display:'flex',gap:3}}>
                {['⤢','⫶'].map((g,i)=>(
                  <button key={i} style={{...btnGhost(theme),padding:'3px 6px',fontSize:11}}>{g}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{flex:1, display:'flex', gap:14, minHeight:0}}>
          <div style={{flex:'1 1 60%', background:theme.panel,
            border:`1px solid ${theme.border}`,borderRadius:12, padding:16,
            display:'flex',flexDirection:'column',gap:10,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{font:'700 11px JetBrains Mono',color:theme.accent,letterSpacing:'.08em',textTransform:'uppercase'}}>
                ▶ aktivní řádek · #{activeLine?.id}
              </div>
              <div style={{font:'500 10px JetBrains Mono',color:theme.textMute,letterSpacing:'.02em'}}>
                {activeLine && `${fmtMS(activeLine.start)} → ${fmtMS(activeLine.end)} · ${(activeLine.end-activeLine.start).toFixed(2)}s`}
              </div>
              <div style={{marginLeft:'auto',display:'flex',gap:4}}>
                <button style={{...btnGhost(theme),padding:'3px 7px',fontSize:11}}>−0.1s</button>
                <button style={{...btnGhost(theme),padding:'3px 7px',fontSize:11}}>+0.1s</button>
                <button style={{...btnGhost(theme),padding:'3px 7px',fontSize:11}}>rozdělit</button>
                <button style={{...btnGhost(theme),padding:'3px 7px',fontSize:11}}>spojit ↓</button>
              </div>
            </div>
            {activeLine && (
              <>
                <div contentEditable suppressContentEditableWarning
                  onBlur={(e)=>updateText(activeLine.id,'jp',e.target.textContent)}
                  style={{font:'700 28px/1.25 "Noto Sans JP"',color:theme.text,
                    padding:'4px 6px',margin:'-4px -6px',borderRadius:6,outline:'none',
                    background:theme.sunken,border:`1px dashed ${theme.border}`}}>
                  {activeLine.jp}
                </div>
                <div contentEditable suppressContentEditableWarning
                  onBlur={(e)=>updateText(activeLine.id,'en',e.target.textContent)}
                  style={{font:'500 18px/1.3 "Space Grotesk"',color:theme.textDim,
                    padding:'4px 6px',margin:'-4px -6px',borderRadius:6,outline:'none',
                    background:theme.sunken,border:`1px dashed ${theme.border}`}}>
                  {activeLine.en}
                </div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  <Chip theme={theme} dot accent={theme.accent} label="CPS" value={(activeLine.en.length/(activeLine.end-activeLine.start)).toFixed(1)}/>
                  <Chip theme={theme} dot accent={theme.accent2} label="znaků" value={activeLine.en.length}/>
                  <Chip theme={theme} label="styl" value="Výchozí"/>
                  {activeLine.note && <Chip theme={theme} dot accent={theme.accent3} label="pozn." value={activeLine.note}/>}
                </div>
              </>
            )}
          </div>
          <AISuggest theme={theme} line={activeLine}
            onApply={(text)=>updateText(activeLine.id,'en',text)}
            style={{flex:'0 0 320px'}}/>
        </div>
      </div>

      {/* BOTTOM */}
      <div style={{
        flex:'0 0 auto', borderTop:`1px solid ${theme.border}`,
        background:theme.panel, padding:'10px 18px',
        display:'flex',alignItems:'center',gap:12,
      }}>
        <Transport theme={theme} ph={ph} compact/>
        <div style={{flex:1, display:'flex', gap:6, overflowX:'auto', padding:'2px 0'}}>
          {lines.map(ln=>{
            const isActive = ln.id===activeId;
            const isPlaying = t>=ln.start && t<=ln.end;
            return (
              <button key={ln.id} onClick={()=>onPickLine(ln)} style={{
                flex:'0 0 auto', padding:'6px 10px',
                background:isPlaying?theme.accent2Soft:(isActive?theme.accentSoft:theme.panel2),
                border:`1px solid ${isPlaying?theme.accent2:(isActive?theme.accent:theme.border)}`,
                borderRadius:8, color:theme.text, cursor:'pointer', textAlign:'left',
                display:'flex',flexDirection:'column',gap:2,minWidth:120,
              }}>
                <div style={{display:'flex',gap:6,alignItems:'baseline'}}>
                  <span style={{font:'700 10px JetBrains Mono',color:isActive?theme.accent:theme.textMute}}>#{ln.id}</span>
                  <span style={{font:'500 9px JetBrains Mono',color:theme.textMute}}>{fmtMS(ln.start)}</span>
                </div>
                <div style={{font:'600 11px "Noto Sans JP"',color:theme.text,whiteSpace:'nowrap',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}}>{ln.jp}</div>
                <div style={{font:'500 10px "Space Grotesk"',color:theme.textDim,whiteSpace:'nowrap',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}}>{ln.en}</div>
              </button>
            );
          })}
        </div>
        <HotkeyStrip theme={theme} keys={[['␣','přehrát'],['←→','krok'],['T','rozdělit']]}/>
      </div>
    </AppShell>
  );
}

window.VariantReel = VariantReel;
