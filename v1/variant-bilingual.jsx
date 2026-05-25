// variant-bilingual.jsx — Anisubarr "Bilingual" layout (uvnitř AppShell)

function VariantBilingual({ theme }){
  const ph = usePlayhead(13.2);
  const [lines, setLines] = React.useState(SUB_LINES);
  const [activeId, setActiveId] = React.useState(6);
  const [openAI, setOpenAI] = React.useState(6);
  const t = ph.t;
  const activeLine = lines.find(l=>l.id===activeId);
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
            <span style={{font:'600 11px JetBrains Mono',color:theme.textDim}}>S01 · EP 03 · jp → cs</span>
          </div>
          <div style={{font:'500 11px JetBrains Mono',color:theme.textMute,marginTop:3}}>
            překladatelský fokus · slovník napojený · AI haiku-4.5
          </div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          <Chip theme={theme} dot accent={theme.accent} label="přeloženo" value="6/8"/>
          <Chip theme={theme} dot accent={theme.accent3} label="k revizi" value="2"/>
          <button style={btnSub(theme)}>🅰 Styl</button>
          <button style={btnSub(theme)}>↗ Export</button>
          <button style={btnPrimary(theme)}>✦ AI vyplnit vše</button>
        </div>
      </div>

      {/* BODY */}
      <div style={{flex:1, display:'flex', minHeight:0}}>
        {/* LEFT rail */}
        <div style={{flex:'0 0 320px', borderRight:`1px solid ${theme.border}`,
          background:theme.panel2, display:'flex', flexDirection:'column', minHeight:0,padding:12,gap:10}}>
          <VideoFrame theme={theme} t={t} line={playingLine} lang="both"
            style={{aspectRatio:'16/9'}}/>
          <div style={{display:'flex',gap:6,alignItems:'center',
            background:theme.panel, border:`1px solid ${theme.border}`, borderRadius:8,padding:'6px 8px'}}>
            <button onClick={()=>ph.setT(Math.max(0,t-1))} style={{...btnGhost(theme),padding:'3px 7px'}}>«</button>
            <button onClick={ph.toggle} style={{...btnPrimary(theme),width:28,height:28,borderRadius:99,padding:0,fontSize:11}}>{ph.playing?'❚❚':'▶'}</button>
            <button onClick={()=>ph.setT(Math.min(TOTAL,t+1))} style={{...btnGhost(theme),padding:'3px 7px'}}>»</button>
            <div style={{font:'600 11px/1 JetBrains Mono',color:theme.text,padding:'0 4px'}}>{fmtMS(t)}</div>
            <div style={{marginLeft:'auto',font:'500 10px JetBrains Mono',color:theme.textMute}}>×1.0</div>
          </div>
          <div style={{flex:1, background:theme.panel, border:`1px solid ${theme.border}`,
            borderRadius:10, padding:12, display:'flex',flexDirection:'column',gap:8, minHeight:0,overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{font:'600 11px JetBrains Mono',color:theme.textDim,letterSpacing:'.06em',textTransform:'uppercase'}}>Slovník</div>
              <div style={{font:'500 10px JetBrains Mono',color:theme.textMute,marginLeft:'auto'}}>14 termínů</div>
            </div>
            <div style={{flex:1,display:'flex',flexDirection:'column',gap:5,overflowY:'auto'}}>
              {[
                ['信号 (shingou)','signál','uzamčeno'],
                ['星 (hoshi)','hvězda',''],
                ['約束 (yakusoku)','slib',''],
                ['名前 (namae)','jméno',''],
                ['お願い (onegai)','prosím',''],
                ['もう一度','ještě jednou','schváleno'],
              ].map(([jp,en,tag],i)=>(
                <div key={i} style={{
                  display:'flex',alignItems:'baseline',gap:6,padding:'5px 7px',
                  background:theme.panel2,border:`1px solid ${theme.border}`,borderRadius:6,
                }}>
                  <div style={{font:'600 11px "Noto Sans JP"',color:theme.text,flex:'0 0 auto'}}>{jp}</div>
                  <div style={{font:'500 11px "Space Grotesk"',color:theme.textDim}}>→ {en}</div>
                  {tag && <div style={{marginLeft:'auto',font:'500 9px JetBrains Mono',
                    color:tag==='uzamčeno'?theme.accent:theme.accent2,
                    background:tag==='uzamčeno'?theme.accentSoft:theme.accent2Soft,
                    padding:'1px 5px',borderRadius:4}}>{tag}</div>}
                </div>
              ))}
            </div>
            <button style={{...btnGhost(theme),padding:'5px 8px',fontSize:11}}>＋ přidat termín z výběru</button>
          </div>
          <div style={{background:`linear-gradient(135deg,${theme.accent3}18, ${theme.accent}18)`,
            border:`1px solid ${theme.accent3}55`, borderRadius:10, padding:10,
            display:'flex',gap:8,alignItems:'flex-start'}}>
            <div style={{width:22,height:22,borderRadius:6,
              background:`linear-gradient(135deg, ${theme.accent3}, ${theme.accent})`,
              display:'grid',placeItems:'center',color:'#fff',font:'700 12px "Space Grotesk"'}}>✦</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{font:'600 11px "Space Grotesk"',color:theme.text}}>Kontext načten</div>
              <div style={{font:'500 10px/1.4 JetBrains Mono',color:theme.textDim,marginTop:2}}>
                ep03 · romance · jemný tón · zachovat honorifika
              </div>
            </div>
            <button style={{...btnGhost(theme),padding:'3px 6px',fontSize:10}}>upravit</button>
          </div>
        </div>

        {/* CENTER */}
        <div style={{flex:1, display:'flex', flexDirection:'column', minHeight:0}}>
          <div style={{display:'grid',gridTemplateColumns:'52px 1fr 1fr 110px',
            padding:'10px 16px',gap:14,
            borderBottom:`1px solid ${theme.border}`, background:theme.panel,
            font:'600 10px JetBrains Mono',color:theme.textDim,letterSpacing:'.06em',textTransform:'uppercase'}}>
            <div>#</div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{width:6,height:6,borderRadius:99,background:theme.accent2}}/>
              zdroj · 日本語
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{width:6,height:6,borderRadius:99,background:theme.accent}}/>
              překlad · čeština
            </div>
            <div>čas</div>
          </div>
          <div style={{flex:1, overflowY:'auto'}}>
            {lines.map((ln)=>{
              const isActive = ln.id===activeId;
              const isPlaying = t>=ln.start && t<=ln.end;
              const showAI = openAI===ln.id;
              const dur = ln.end-ln.start;
              return (
                <div key={ln.id} onClick={()=>onPickLine(ln)} style={{
                  display:'grid', gridTemplateColumns:'52px 1fr 1fr 110px',
                  padding:'12px 16px', gap:14, alignItems:'flex-start',
                  borderBottom:`1px solid ${theme.border}`, cursor:'pointer',
                  background:isPlaying?theme.accent2Soft:(isActive?theme.accentSoft:'transparent'),
                  borderLeft:`3px solid ${isPlaying?theme.accent2:(isActive?theme.accent:'transparent')}`,
                }}>
                  <div style={{display:'flex',flexDirection:'column',gap:3,alignItems:'flex-start'}}>
                    <div style={{font:'700 12px JetBrains Mono',color:isActive?theme.accent:theme.text}}>#{ln.id}</div>
                    {ln.note && <StatusPill theme={theme} color={theme.accent3} label={ln.note} size="sm"/>}
                  </div>
                  <div contentEditable suppressContentEditableWarning
                    onClick={(e)=>e.stopPropagation()}
                    onBlur={(e)=>updateText(ln.id,'jp',e.target.textContent)}
                    style={{
                      font:'600 16px/1.4 "Noto Sans JP"',color:theme.text,
                      padding:'4px 6px',margin:'-4px -6px',borderRadius:6,outline:'none',
                      background:theme.sunken,
                      border:`1px solid ${theme.border}`,
                    }}>{ln.jp}</div>
                  <div style={{display:'flex',flexDirection:'column',gap:6}}>
                    <div contentEditable suppressContentEditableWarning
                      onClick={(e)=>e.stopPropagation()}
                      onBlur={(e)=>updateText(ln.id,'en',e.target.textContent)}
                      style={{
                        font:'500 14px/1.4 "Space Grotesk"',color:theme.text,
                        padding:'4px 6px',margin:'-4px -6px',borderRadius:6,outline:'none',
                        background:theme.sunken,
                        border:`1px solid ${theme.border}`,
                      }}>{ln.en}</div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}
                      onClick={(e)=>e.stopPropagation()}>
                      <button onClick={()=>setOpenAI(showAI?null:ln.id)} style={{
                        display:'inline-flex',alignItems:'center',gap:4,
                        background:showAI?theme.accentSoft:'transparent',
                        border:`1px dashed ${showAI?theme.accent:theme.borderStrong}`,
                        color:showAI?theme.accent:theme.textDim,
                        borderRadius:99,padding:'2px 8px',cursor:'pointer',
                        font:'600 10px "Space Grotesk"',
                      }}>✦ AI varianty ({(AI_ALTS[ln.id]||[]).length}) {showAI?'▾':'▸'}</button>
                      <Chip theme={theme} label="CPS" value={(ln.en.length/dur).toFixed(1)}/>
                      {ln.en.length/dur>20 && <span style={{font:'500 9px JetBrains Mono',
                        color:theme.accent3,background:`${theme.accent3}22`,padding:'2px 6px',borderRadius:4}}>moc rychle</span>}
                    </div>
                    {showAI && (
                      <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:2}}>
                        {(AI_ALTS[ln.id]||[]).map((a,i)=>(
                          <button key={i} onClick={()=>updateText(ln.id,'en',a)} style={{
                            textAlign:'left', background:theme.panel,
                            border:`1px solid ${theme.border}`, borderRadius:6,
                            padding:'6px 9px', color:theme.text, cursor:'pointer',
                            font:'500 12px/1.35 "Space Grotesk"',
                            display:'flex',alignItems:'center',gap:8,
                          }}>
                            <span style={{width:14,height:14,borderRadius:4,
                              background:theme.accentSoft,color:theme.accent,
                              font:'700 9px "Space Grotesk"',display:'grid',placeItems:'center'}}>{i+1}</span>
                            <span style={{flex:1}}>{a}</span>
                          </button>
                        ))}
                        <button style={{...btnGhost(theme),padding:'4px 8px',fontSize:11,alignSelf:'flex-start'}}>⟲ regenerovat</button>
                      </div>
                    )}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:2,
                    font:'600 10px JetBrains Mono',color:theme.textDim,textAlign:'right'}}>
                    <div>{fmtMS(ln.start)}</div>
                    <div style={{color:theme.textMute}}>↓ {dur.toFixed(2)}s</div>
                    <div>{fmtMS(ln.end)}</div>
                  </div>
                </div>
              );
            })}
            <div style={{padding:'14px 16px',font:'500 12px "Space Grotesk"',color:theme.textMute,
              display:'flex',gap:8,alignItems:'center'}}>
              <button style={{...btnGhost(theme),padding:'5px 10px',fontSize:11}}>＋ nový řádek v {fmtMS(t)}</button>
              <button style={{...btnGhost(theme),padding:'5px 10px',fontSize:11}}>✦ přeložit nepřeložené (2)</button>
            </div>
          </div>
          <div style={{borderTop:`1px solid ${theme.border}`,padding:'10px 16px',background:theme.panel}}>
            <Waveform theme={theme} t={t} setT={ph.setT} height={70} compact
              onDragLine={onDragLine} activeId={activeId} onPickLine={onPickLine}/>
            <div style={{display:'flex',alignItems:'center',gap:10,marginTop:8}}>
              <button onClick={ph.toggle} style={{...btnPrimary(theme),width:32,height:32,padding:0,borderRadius:99}}>{ph.playing?'❚❚':'▶'}</button>
              <div style={{font:'600 12px/1 JetBrains Mono',color:theme.text}}>{fmtMS(t)} <span style={{color:theme.textMute}}>/ {fmtMS(TOTAL)}</span></div>
              <HotkeyStrip theme={theme} keys={[['␣','přehrát'],['Tab','další pole'],['⌘⏎','přijmout AI'],['G','slovník']]}
                style={{marginLeft:'auto'}}/>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

window.VariantBilingual = VariantBilingual;
