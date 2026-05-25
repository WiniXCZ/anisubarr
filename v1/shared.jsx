// shared.jsx — Anisubarr shared data, components, theme
// Exposes globals at end of file for variant scripts.

// ─── Sample episode (original content, not from any real show) ────────────
// Sci-fi short: a girl picks up a strange transmission at dusk.
const SUB_LINES = [
  { id:1, start:0.30, end:2.40, jp:'もう一度…聞こえる？',          en:'Ještě jednou… slyšíš mě?',          note:'šeptem' },
  { id:2, start:2.55, end:5.10, jp:'この信号、どこから来てるの？',     en:'Ten signál — odkud přichází?',      note:'' },
  { id:3, start:5.40, end:7.20, jp:'答えて、お願い。',              en:'Odpověz mi, prosím.',               note:'' },
  { id:4, start:7.80, end:9.90, jp:'…私はここにいる。',             en:'…Jsem tady.',                       note:'jemně' },
  { id:5, start:10.20,end:12.60,jp:'時間がない、急いで！',          en:'Nemáme čas — pospěš si!',           note:'!' },
  { id:6, start:12.90,end:15.40,jp:'星が落ちる前に、見つけて。',     en:'Najdi mě, než spadnou hvězdy.',     note:'fade' },
  { id:7, start:15.80,end:17.90,jp:'約束した、覚えてる？',          en:'Slíbil jsi to — pamatuješ?',        note:'' },
  { id:8, start:18.40,end:21.00,jp:'もう一度だけ、君の名前を。',     en:'Ještě jednou… řekni mé jméno.',     note:'vrchol' },
];
const TOTAL = 22.0; // seconds — synthetic clip length

// AI translation alternates for selected line — strings are decorative/sample
const AI_ALTS = {
  1:[ 'Jsi tam? Slyšíš mě znovu?', 'Haló? Jsi… ještě tam?' ],
  2:[ 'Tenhle signál — odkud se vzal?', 'Kde se ten signál bere?' ],
  3:[ 'Odpověz mi.', 'Ozvi se, prosím tě.' ],
  4:[ 'Jsem tu.', '…Já jsem tady.' ],
  5:[ 'Dochází nám čas — rychle!', 'Pospěš si, čas se krátí!' ],
  6:[ 'Najdi mě, než hvězdy padnou.', 'Než spadne nebe — najdi mě.' ],
  7:[ 'Slíbil jsi to. Pamatuješ si to?', 'Vzpomeneš si na ten slib?' ],
  8:[ 'Řekni mé jméno, jen ještě jednou.', 'Naposledy — mé jméno.' ],
};

// ─── Theme tokens (dark / light) ──────────────────────────────────────────
const THEME = {
  dark:{
    bg:'#0e1220', panel:'#161a2a', panel2:'#1d2237', sunken:'#0a0d18',
    border:'rgba(255,255,255,0.06)', borderStrong:'rgba(255,255,255,0.12)',
    text:'#e8e9f2', textDim:'rgba(232,233,242,0.62)', textMute:'rgba(232,233,242,0.38)',
    accent:'#a78bfa',   // violet
    accent2:'#22d3ee',  // cyan
    accent3:'#fbbf24',  // amber (AI)
    accentSoft:'rgba(167,139,250,0.16)',
    accent2Soft:'rgba(34,211,238,0.14)',
    wave:'rgba(167,139,250,0.55)',
    waveActive:'#a78bfa',
    grid:'rgba(255,255,255,0.04)',
    statusAiring:'#3b82f6', statusDone:'#22c55e', statusUpcoming:'#f59e0b', statusEnded:'#ef4444',
  },
  light:{
    bg:'#eef1f6', panel:'#ffffff', panel2:'#f4f6fb', sunken:'#e4e8f1',
    border:'rgba(15,22,40,0.08)', borderStrong:'rgba(15,22,40,0.18)',
    text:'#101426', textDim:'rgba(16,20,38,0.62)', textMute:'rgba(16,20,38,0.40)',
    accent:'#7c3aed',
    accent2:'#0ea5b7',
    accent3:'#b07b00',
    accentSoft:'rgba(124,58,237,0.12)',
    accent2Soft:'rgba(14,165,183,0.13)',
    wave:'rgba(124,58,237,0.55)',
    waveActive:'#7c3aed',
    grid:'rgba(0,0,0,0.05)',
    statusAiring:'#2563eb', statusDone:'#16a34a', statusUpcoming:'#d97706', statusEnded:'#dc2626',
  },
};

// ─── Pseudo-random but deterministic waveform amplitudes ─────────────────
function makeWave(n=320){
  const out=[];
  let s=11;
  const rnd=()=>{ s=(s*9301+49297)%233280; return s/233280; };
  for(let i=0;i<n;i++){
    const t=i/n;
    // Add localized envelopes for each subtitle line so the waveform "sings"
    let env=0.05;
    for(const ln of SUB_LINES){
      const a=ln.start/TOTAL, b=ln.end/TOTAL;
      if(t>=a && t<=b){
        const mid=(a+b)/2, w=(b-a)/2;
        env=Math.max(env, 0.4 + 0.55*Math.cos(((t-mid)/w)*Math.PI/2) );
      }
    }
    out.push( env * (0.55 + 0.45*rnd()) );
  }
  return out;
}
const WAVE = makeWave(400);

// ─── Format helpers ───────────────────────────────────────────────────────
const fmtTC = (s)=>{
  const m=Math.floor(s/60), sec=s%60;
  return `${String(m).padStart(2,'0')}:${sec.toFixed(2).padStart(5,'0')}`;
};
const fmtMS = (s)=>{
  const ms=Math.floor((s%1)*1000);
  const sec=Math.floor(s%60);
  const m=Math.floor(s/60);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
};

// ─── useFakePlayhead — drives playhead state ─────────────────────────────
function usePlayhead(initial=0){
  const [t,setT] = React.useState(initial);
  const [playing,setPlaying] = React.useState(false);
  const raf = React.useRef(0);
  const last = React.useRef(0);
  React.useEffect(()=>{
    if(!playing) return;
    last.current = performance.now();
    const tick = (now)=>{
      const dt = (now-last.current)/1000;
      last.current = now;
      setT(prev => {
        const next = prev + dt;
        if(next >= TOTAL){ setPlaying(false); return 0; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf.current);
  },[playing]);
  return { t, setT, playing, setPlaying, toggle:()=>setPlaying(p=>!p) };
}

// Find the line index that contains time t (or last started before t)
function activeLineIdx(t){
  let cur = -1;
  for(let i=0;i<SUB_LINES.length;i++){
    if(t >= SUB_LINES[i].start && t <= SUB_LINES[i].end) return i;
    if(SUB_LINES[i].start <= t) cur = i;
  }
  return cur;
}

// ─── VideoFrame — striped placeholder with overlay subtitle ───────────────
function VideoFrame({ theme, t, line, lang='both', style, dim=false, scanlines=true, label='anime scéna · 1080p · 23.976' }){
  // Soft animated tint cycling slowly
  const hue = (t*8) % 360;
  return (
    <div style={{
      position:'relative', overflow:'hidden', borderRadius:10,
      background:`linear-gradient(135deg, hsl(${hue},22%,18%) 0%, hsl(${(hue+60)%360},25%,12%) 100%)`,
      border:`1px solid ${theme.border}`,
      ...style,
    }}>
      {/* striped placeholder pattern */}
      <svg width="100%" height="100%" style={{position:'absolute',inset:0,opacity:0.22}}>
        <defs>
          <pattern id={'stripes'+(label.length)} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="14" stroke="white" strokeWidth="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${'stripes'+(label.length)})`} />
      </svg>
      {/* sun / horizon vignette */}
      <div style={{position:'absolute',left:'50%',bottom:'-30%',width:'70%',aspectRatio:'1/1',transform:'translateX(-50%)',
        background:`radial-gradient(circle, ${theme.accent}55 0%, transparent 60%)`, filter:'blur(8px)'}}/>
      {/* corner label */}
      <div style={{position:'absolute',top:8,left:10,font:'500 10px/1 JetBrains Mono, monospace',color:theme.textDim,letterSpacing:'.04em',textTransform:'uppercase'}}>
        ▮ {label}
      </div>
      <div style={{position:'absolute',top:8,right:10,display:'flex',gap:6,alignItems:'center',
        font:'500 10px/1 JetBrains Mono, monospace',color:theme.accent2}}>
        <span style={{width:6,height:6,borderRadius:99,background:theme.accent,boxShadow:`0 0 8px ${theme.accent}`}}/>
        REC · {fmtTC(t)}
      </div>
      {/* scanlines */}
      {scanlines && <div style={{position:'absolute',inset:0,pointerEvents:'none',
        backgroundImage:`repeating-linear-gradient(to bottom, transparent 0 2px, rgba(0,0,0,0.18) 2px 3px)`,opacity:0.5}}/>}
      {/* subtitle overlay */}
      {line && !dim && (
        <div style={{position:'absolute',left:'8%',right:'8%',bottom:'8%',textAlign:'center',
          textShadow:'0 2px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,1)'}}>
          {(lang==='jp'||lang==='both') && (
            <div style={{font:'700 16px/1.3 "Noto Sans JP", sans-serif', color:'#fff', marginBottom:4}}>
              {line.jp}
            </div>
          )}
          {(lang==='en'||lang==='both') && (
            <div style={{font:'500 13px/1.3 "Space Grotesk", sans-serif', color:'#fde6f0'}}>
              {line.en}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Waveform — SVG bars + lane overlays for each subtitle line ──────────
function Waveform({ theme, t, setT, height=120, showLanes=true, onDragLine, activeId, onPickLine, compact=false }){
  const ref = React.useRef(null);
  const [drag, setDrag] = React.useState(null); // {id, edge:'start'|'end'|'body', dx}
  const px = (sec)=> (sec/TOTAL)*100; // percent

  const onMouseDown = (e)=>{
    if(drag) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const tt = (x/rect.width)*TOTAL;
    setT(Math.max(0, Math.min(TOTAL, tt)));
  };

  React.useEffect(()=>{
    if(!drag) return;
    const onMove = (e)=>{
      const rect = ref.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const tt = Math.max(0,Math.min(TOTAL,(x/rect.width)*TOTAL));
      onDragLine && onDragLine(drag.id, drag.edge, tt);
    };
    const onUp = ()=> setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return ()=>{ window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  },[drag,onDragLine]);

  return (
    <div ref={ref} onMouseDown={onMouseDown} style={{
      position:'relative', height, width:'100%',
      background:theme.sunken, borderRadius:8, overflow:'hidden', cursor:'crosshair',
      border:`1px solid ${theme.border}`,
    }}>
      {/* time grid every 2s */}
      <svg width="100%" height={height} style={{position:'absolute',inset:0,pointerEvents:'none'}}>
        {Array.from({length:Math.floor(TOTAL/2)+1}).map((_,i)=>{
          const x = (i*2/TOTAL)*100;
          return <line key={i} x1={`${x}%`} y1={0} x2={`${x}%`} y2={height} stroke={theme.grid} strokeWidth="1"/>;
        })}
      </svg>
      {/* bars */}
      <svg width="100%" height={height} viewBox={`0 0 ${WAVE.length} 100`} preserveAspectRatio="none" style={{position:'absolute',inset:0}}>
        {WAVE.map((a,i)=>{
          const x = i+0.5;
          const passed = (i/WAVE.length)*TOTAL <= t;
          return <line key={i} x1={x} y1={50-a*44} x2={x} y2={50+a*44}
            stroke={passed?theme.waveActive:theme.wave} strokeWidth="0.85" strokeLinecap="round"/>;
        })}
      </svg>

      {/* lanes — subtitle blocks */}
      {showLanes && SUB_LINES.map(ln=>{
        const isActive = ln.id===activeId;
        return (
          <div key={ln.id}
            onMouseDown={(e)=>{ e.stopPropagation(); onPickLine && onPickLine(ln); }}
            style={{
              position:'absolute', top:compact?4:6, bottom:compact?4:6,
              left:`${px(ln.start)}%`, width:`${px(ln.end-ln.start)}%`,
              background:isActive?theme.accentSoft:'rgba(255,255,255,0.04)',
              border:`1px solid ${isActive?theme.accent:theme.borderStrong}`,
              borderRadius:6, display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'0 4px', cursor:'pointer', overflow:'hidden',
              boxShadow:isActive?`0 0 0 2px ${theme.accentSoft}`:'none',
              transition:'background .12s, border-color .12s',
            }}>
            {/* left handle */}
            <div onMouseDown={(e)=>{ e.stopPropagation(); setDrag({id:ln.id, edge:'start'}); }}
              style={{position:'absolute',left:0,top:0,bottom:0,width:6,cursor:'ew-resize',
                background:isActive?theme.accent:'transparent', borderRadius:'6px 0 0 6px'}}/>
            <div style={{font:'600 10px/1 "Space Grotesk"', color:isActive?theme.accent:theme.textDim, whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              #{ln.id} · {ln.en}
            </div>
            <div onMouseDown={(e)=>{ e.stopPropagation(); setDrag({id:ln.id, edge:'end'}); }}
              style={{position:'absolute',right:0,top:0,bottom:0,width:6,cursor:'ew-resize',
                background:isActive?theme.accent:'transparent', borderRadius:'0 6px 6px 0'}}/>
          </div>
        );
      })}

      {/* playhead */}
      <div style={{position:'absolute',top:0,bottom:0,left:`${px(t)}%`,width:0,
        borderLeft:`2px solid ${theme.accent}`, boxShadow:`0 0 12px ${theme.accent}`,pointerEvents:'none'}}/>
      <div style={{position:'absolute',top:-1,left:`calc(${px(t)}% - 6px)`,width:12,height:8,
        background:theme.accent, clipPath:'polygon(0 0,100% 0,50% 100%)', pointerEvents:'none'}}/>
    </div>
  );
}

// ─── Transport — play/pause + tc + speed ───────────────────────────────
function Transport({ theme, ph, compact=false, extra=null }){
  const tc = fmtMS(ph.t);
  return (
    <div style={{display:'flex',alignItems:'center',gap:compact?6:10,
      padding:compact?'6px 10px':'10px 14px',
      background:theme.panel, border:`1px solid ${theme.border}`, borderRadius:10}}>
      <button onClick={()=>ph.setT(Math.max(0,ph.t-1))} title="−1s [J]"
        style={btnGhost(theme)}>«</button>
      <button onClick={ph.toggle} title="Play/Pause [Space]" style={{
        ...btnPrimary(theme), width:compact?32:38, height:compact?32:38, borderRadius:99, fontSize:14}}>
        {ph.playing?'❚❚':'▶'}
      </button>
      <button onClick={()=>ph.setT(Math.min(TOTAL,ph.t+1))} title="+1s [L]" style={btnGhost(theme)}>»</button>
      <div style={{font:'600 13px/1 JetBrains Mono', color:theme.text, padding:'0 6px',
        borderLeft:`1px solid ${theme.border}`, borderRight:`1px solid ${theme.border}`, marginLeft:4}}>
        {tc} <span style={{color:theme.textMute}}>/ {fmtMS(TOTAL)}</span>
      </div>
      <div style={{display:'flex',gap:2}}>
        {['0.5×','1×','1.5×'].map((s,i)=>(
          <button key={s} style={{...btnGhost(theme),padding:'4px 7px',
            background:i===1?theme.accentSoft:'transparent',
            color:i===1?theme.accent:theme.textDim,
            fontSize:11,fontFamily:'JetBrains Mono'}}>{s}</button>
        ))}
      </div>
      {extra}
    </div>
  );
}

// ─── Button styles ────────────────────────────────────────────────────────
const btnGhost = (theme)=>({
  background:'transparent', color:theme.textDim, border:`1px solid ${theme.border}`,
  borderRadius:7, padding:'5px 9px', font:'500 12px/1 "Space Grotesk"', cursor:'pointer',
});
const btnPrimary = (theme)=>({
  background:theme.accent, color:'#fff', border:'none',
  borderRadius:7, padding:'6px 12px', font:'600 12px/1 "Space Grotesk"', cursor:'pointer',
  boxShadow:`0 4px 14px ${theme.accent}55`,
});
const btnSub = (theme)=>({
  background:theme.panel2, color:theme.text, border:`1px solid ${theme.border}`,
  borderRadius:7, padding:'5px 10px', font:'500 12px/1 "Space Grotesk"', cursor:'pointer',
});

// ─── Language pill row ────────────────────────────────────────────────────
function LangTabs({ theme, value, onChange, sizes }){
  const tabs = [['both','JP+CS'],['jp','日本語'],['en','Čeština']];
  return (
    <div style={{display:'inline-flex',background:theme.sunken,borderRadius:8,padding:2,gap:2,border:`1px solid ${theme.border}`}}>
      {tabs.map(([k,l])=>(
        <button key={k} onClick={()=>onChange(k)} style={{
          background:value===k?theme.panel:'transparent',
          color:value===k?theme.accent:theme.textDim,
          border:'none', cursor:'pointer',
          padding: sizes==='sm'?'4px 8px':'5px 10px',
          font:`600 ${sizes==='sm'?10:11}px "Space Grotesk"`,
          borderRadius:6,
          boxShadow:value===k?`0 1px 0 ${theme.border}`:'none',
        }}>{l}</button>
      ))}
    </div>
  );
}

// ─── Logo ─────────────────────────────────────────────────────────────────
function Logo({ theme, sub }){
  return (
    <div style={{display:'flex',alignItems:'center',gap:9}}>
      {/* monitor icon */}
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="14" rx="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="18" x2="12" y2="21"/>
      </svg>
      <div style={{lineHeight:1}}>
        <div style={{font:'700 17px "Space Grotesk"',color:theme.accent,letterSpacing:'-0.01em'}}>
          Anisubarr
        </div>
        {sub && <div style={{font:'500 9px/1.2 JetBrains Mono',color:theme.textMute,marginTop:2,letterSpacing:'.08em',textTransform:'uppercase'}}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── Hotkey strip ─────────────────────────────────────────────────────────
function HotkeyStrip({ theme, keys, style }){
  return (
    <div style={{display:'flex',gap:14,flexWrap:'wrap',alignItems:'center',...style}}>
      {keys.map(([k,l],i)=>(
        <div key={i} style={{display:'flex',alignItems:'center',gap:6}}>
          <kbd style={{
            font:'600 10px JetBrains Mono', color:theme.text,
            background:theme.panel2, border:`1px solid ${theme.borderStrong}`,
            borderBottomWidth:2, borderRadius:5, padding:'3px 6px', minWidth:18, textAlign:'center'
          }}>{k}</kbd>
          <span style={{font:'500 11px "Space Grotesk"',color:theme.textDim}}>{l}</span>
        </div>
      ))}
    </div>
  );
}

// ─── AI suggestions card (used inline / sidebar) ─────────────────────────
function AISuggest({ theme, line, alts, onApply, style }){
  if(!line) return null;
  const list = alts || AI_ALTS[line.id] || [];
  return (
    <div style={{
      background:theme.panel, border:`1px solid ${theme.border}`, borderRadius:10,
      padding:12, display:'flex',flexDirection:'column',gap:8,
      ...style,
    }}>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <div style={{
          width:22,height:22,borderRadius:6,
          background:`linear-gradient(135deg, ${theme.accent3}, ${theme.accent})`,
          display:'grid',placeItems:'center', color:'#fff', font:'700 12px "Space Grotesk"',
          boxShadow:`0 0 0 1px ${theme.border}`,
        }}>✦</div>
        <div style={{font:'600 12px "Space Grotesk"',color:theme.text}}>AI překlad</div>
        <div style={{marginLeft:'auto', font:'500 10px/1 JetBrains Mono', color:theme.textMute}}>haiku-4.5</div>
      </div>
      <div style={{font:'500 11px JetBrains Mono', color:theme.textMute, lineHeight:1.4}}>
        z <span style={{color:theme.accent2,fontFamily:'"Noto Sans JP"'}}>{line.jp}</span>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {list.map((a,i)=>(
          <button key={i} onClick={()=>onApply && onApply(a)} style={{
            textAlign:'left', background:theme.panel2,
            border:`1px solid ${theme.border}`, borderRadius:8, padding:'7px 9px',
            color:theme.text, font:'500 12px/1.4 "Space Grotesk"', cursor:'pointer',
            display:'flex', alignItems:'center', gap:8,
          }}>
            <span style={{width:14,height:14,borderRadius:4,background:theme.accentSoft,color:theme.accent,
              font:'700 9px "Space Grotesk"', display:'grid',placeItems:'center',flex:'0 0 14px'}}>
              {i+1}
            </span>
            <span style={{flex:1}}>{a}</span>
            <span style={{font:'500 9px JetBrains Mono',color:theme.textMute}}>⏎</span>
          </button>
        ))}
      </div>
      <div style={{display:'flex',gap:6,marginTop:2}}>
        <button style={{...btnGhost(theme), padding:'4px 8px', fontSize:11}}>⟲ regen.</button>
        <button style={{...btnGhost(theme), padding:'4px 8px', fontSize:11}}>＋ kontext</button>
        <button style={{...btnGhost(theme), padding:'4px 8px', fontSize:11,marginLeft:'auto'}}>tón ▾</button>
      </div>
    </div>
  );
}

// ─── Styling modal (ASS-style) ───────────────────────────────────────────
function StylingPanel({ theme, open, onClose, style:wrapStyle }){
  if(!open) return null;
  return (
    <div style={{
      position:'absolute', inset:0, background:'rgba(0,0,0,0.55)',
      display:'grid', placeItems:'center', zIndex:50, ...wrapStyle,
    }} onClick={onClose}>
      <div onClick={(e)=>e.stopPropagation()} style={{
        width:480, background:theme.panel, border:`1px solid ${theme.borderStrong}`,
        borderRadius:14, padding:18, boxShadow:'0 24px 70px rgba(0,0,0,0.5)',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
          <div style={{font:'700 14px "Space Grotesk"',color:theme.text}}>Styl titulku · <span style={{color:theme.accent}}>Výchozí</span></div>
          <button onClick={onClose} style={{...btnGhost(theme),marginLeft:'auto',padding:'4px 8px'}}>esc</button>
        </div>
        <div style={{
          background:`linear-gradient(135deg, #1a1530 0%, #3a1a3a 100%)`,
          borderRadius:8, padding:'30px 12px', textAlign:'center', marginBottom:14,
          border:`1px solid ${theme.border}`,
        }}>
          <div style={{font:'700 18px/1.2 "Noto Sans JP"',color:'#fff',textShadow:'0 2px 6px rgba(0,0,0,0.9)'}}>もう一度…聞こえる？</div>
          <div style={{font:'500 14px/1.2 "Space Grotesk"',color:'#fde6f0',textShadow:'0 2px 6px rgba(0,0,0,0.9)',marginTop:4}}>Ještě jednou… slyšíš mě?</div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          {[
            ['Font','Noto Sans JP'],['Velikost','22'],['Tučné','Ano'],['Kurzíva','Ne'],
            ['Obrys','2.0'],['Stín','1.5'],['Hlavní','#ffffff'],['Barva obrysu','#1a0820'],
          ].map(([k,v])=>(
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',
              background:theme.panel2,border:`1px solid ${theme.border}`,borderRadius:7,
              font:'500 12px "Space Grotesk"',color:theme.text}}>
              <span style={{color:theme.textDim}}>{k}</span><span>{v}</span>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:8,marginTop:14}}>
          <button style={btnSub(theme)}>Duplikovat styl</button>
          <button style={btnSub(theme)}>Importovat .ass</button>
          <button style={{...btnPrimary(theme),marginLeft:'auto'}} onClick={onClose}>Použít</button>
        </div>
      </div>
    </div>
  );
}

// ─── Mini stats / status chips ────────────────────────────────────────────
// ─── AppShell · top nav podle library appky ──────────────────────────────
const NavIcon = ({d, size=15})=>(
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const ICONS = {
  library: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  sched:   <><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  cal:     <><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1"/><circle cx="12" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></>,
  req:     <><path d="M22 2 L11 13"/><path d="M22 2 L15 22 L11 13 L2 9 Z"/></>,
  files:   <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>,
  sett:    <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.4 16.96l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.37l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  subs:    <><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="12" x2="10" y2="12"/><line x1="12" y1="12" x2="18" y2="12"/><line x1="6" y1="16" x2="14" y2="16"/></>,
  sync:    <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></>,
  pulse:   <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>,
  out:     <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
  back:    <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,
  play:    <><polygon points="5 3 19 12 5 21 5 3"/></>,
};

function AppShell({ theme, active='subs', onNav, syncCount=3, children }){
  const tabs = [
    ['library','Knihovna',  ICONS.library],
    ['sched',  'Harmonogram',ICONS.sched],
    ['cal',    'Kalendář',  ICONS.cal],
    ['req',    'Žádosti',   ICONS.req],
    ['files',  'Soubory',    ICONS.files],
    ['sett',   'Nastavení',  ICONS.sett],
  ];
  const right = [
    ['subs',  'Titulky', ICONS.subs],
  ];
  const navBtn = (key, label, iconBody)=>{
    const isActive = key===active;
    return (
      <button key={key} onClick={()=>onNav && onNav(key)} style={{
        display:'inline-flex',alignItems:'center',gap:7,
        padding:'7px 12px', borderRadius:8,
        background:isActive?theme.accentSoft:'transparent',
        color:isActive?theme.accent:theme.textDim,
        border:'1px solid transparent',
        font:'600 13px "Space Grotesk"', cursor:'pointer',
      }}>
        <NavIcon d={iconBody}/>
        {label}
      </button>
    );
  };
  return (
    <div style={{display:'flex',flexDirection:'column',width:'100%',height:'100%',
      background:theme.bg, color:theme.text, font:'500 13px "Space Grotesk"',overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,
        padding:'10px 18px', background:theme.panel,
        borderBottom:`1px solid ${theme.border}`, flex:'0 0 auto'}}>
        <Logo theme={theme}/>
        <div style={{flex:1, display:'flex',justifyContent:'center',gap:4}}>
          {tabs.map(([k,l,i])=>navBtn(k,l,i))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          {right.map(([k,l,i])=>navBtn(k,l,i))}
          <button style={{
            display:'inline-flex',alignItems:'center',gap:7,
            padding:'7px 12px', borderRadius:8,
            background:theme.accentSoft, color:theme.accent,
            border:`1px solid ${theme.accent}33`,
            font:'600 13px "Space Grotesk"', cursor:'pointer',
          }}>
            <NavIcon d={ICONS.sync}/> Sync
            {syncCount>0 && <span style={{
              font:'700 10px JetBrains Mono', background:theme.accent, color:'#fff',
              padding:'1px 6px', borderRadius:99, marginLeft:2,
            }}>{syncCount}</span>}
          </button>
          <button title="activity" style={{...btnGhost(theme), padding:'6px 7px',color:theme.textDim,height:32}}>
            <NavIcon d={ICONS.pulse}/>
          </button>
          <button title="odhlásit" style={{...btnGhost(theme), padding:'6px 7px',color:theme.textDim,height:32}}>
            <NavIcon d={ICONS.out}/>
          </button>
        </div>
      </div>
      <div style={{flex:1, minHeight:0, display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {children}
      </div>
    </div>
  );
}

// ─── Status pill (Vysílá se / Dokončeno / ...) ──────────────────────────
function StatusPill({ theme, color, label, dot=true, size='md' }){
  return (
    <span style={{
      display:'inline-flex',alignItems:'center',gap:5,
      padding: size==='sm'?'2px 7px':'3px 9px',
      background:`${color}22`, color, border:`1px solid ${color}55`,
      borderRadius:99, font:`600 ${size==='sm'?9.5:10.5}px JetBrains Mono`,
      letterSpacing:'.04em', whiteSpace:'nowrap',
    }}>
      {dot && <span style={{width:5,height:5,borderRadius:99,background:color}}/>}
      {label}
    </span>
  );
}

// ─── Sample knihovna (fiktivní tituly) ──────────────────────────────────
const LIBRARY = [
  { id:'sad', title:'Signal at Dusk',    jp:'モース信号', year:2026, season:1, eps:12, watched:3,  status:'airing',    next:'Stř 14:00', genres:['Sci-Fi','Romance'],     score:8.4, hue:265,
    studio:'Studio Halcyon', synopsis:'Mladá telegrafistka Aoi začne každou noc zachytávat tajemný signál — hlas, který zní jako její vlastní, ale přichází odÝvad odjinud. Krátká sci-fi romance o paměti, ozvěnách a posledním vysílání před konce světa. Animace měkká jak akvarel, hudba minimalistická.' },
  { id:'cg',  title:'Crimson Garden',    jp:'紅い庭園',   year:2024, season:2, eps:24, watched:24, status:'completed', next:null, genres:['Drama','Historical'],       score:9.1, hue:0,
    studio:'Mokuren', synopsis:'Druhá řada politického dramatu odehrávajícího se v alternativní Taišo-éře. Aristokratická rodina Kurenai ztrácí kontrolu nad svými půdami i vlastními dědici. Kritika ji označila za jeden z nejlepších anime ročníku.' },
  { id:'nc',  title:'Neon Cartographer', jp:'ネオン地図', year:2026, season:1, eps:13, watched:7,  status:'airing',    next:'Út 18:30', genres:['Cyberpunk','Action'],   score:8.7, hue:190,
    studio:'Studio Halcyon', synopsis:'V noci nikdy nespícím městě Shin-Akihabara mapuje kurýrka Rei nelegální datové tunely — a najednou každá nová mapa začne hlasitě mizet z internetu. Cyberpunk s důrazem na atmosféru, neon, deset komor a těžký synthwave soundtrack.' },
  { id:'ph',  title:'Paper Hearts',      jp:'紙の心',     year:2026, season:1, eps:12, watched:0,  status:'upcoming',  next:'4. čvc',   genres:['Slice of Life'],         score:null, hue:330,
    studio:'Yume Ink', synopsis:'Slice of life o partii kamarádů, kteří v posledním ročníku střední otevřou amatérský origami klub. Předpremiéra ohlášená na červenec; po prvním trailer hodně očekávaný.' },
  { id:'st',  title:'Silver Tideline',   jp:'銀の渚',     year:2022, season:3, eps:36, watched:36, status:'ended',     next:null, genres:['Fantasy','Adventure'],      score:8.9, hue:210,
    studio:'Mokuren', synopsis:'Závěrečná třetí řada epické fantasy o „strážcích přílivů“ — chránců hranice mezi světem živých a strašidel. Záčtění ze starších řad doporučeno; finale dialogy nešetří.' },
  { id:'qs',  title:'The Quiet Stars',   jp:'静かな星',   year:2025, season:1, eps:24, watched:18, status:'airing',    next:'Čt 16:00', genres:['Sci-Fi'],                score:8.2, hue:240,
    studio:'BlueCast', synopsis:'Vesmírní posádka dvouroční misi vše komunikuje pouze pomocí světla — zvuk by je prozradil neviditelným sledujícím. Pomalé, hypnotické hard sci-fi.' },
  { id:'md',  title:'Mochi Detective',   jp:'モチ探偵',   year:2023, season:2, eps:12, watched:12, status:'completed', next:null, genres:['Mystery','Comedy'],         score:7.6, hue:35,
    studio:'Pon Pon Lab', synopsis:'Domácí detektivka, každý díl jedno zločin — a hlavní hrdina je hovořící mochi. Žánrová parodie, kterou nemůžete brát vážně, ale o to větrý vtípek poád zafunguje.' },
  { id:'vh',  title:'Velvet Halcyon',    jp:'ベルベット', year:2026, season:1, eps:13, watched:0,  status:'upcoming',  next:'10. čvn', genres:['Romance','Drama'],      score:null, hue:295,
    studio:'Yume Ink', synopsis:'Adaptace populárního josei mangy — koncertní pianistka se po nehodě vrací na pódium a najednou hraje výhradně duety. Romance a drama, premiéra v červnu.' },
  { id:'yd',  title:'Yokai District',    jp:'妖怪地区',   year:2026, season:4, eps:24, watched:11, status:'airing',    next:'Stř 14:00', genres:['Supernatural'],          score:8.5, hue:140,
    studio:'Akagi Studio', synopsis:'Čtvrtá řada urban-fantasy serialu o městské části, kde žijí jokai s lidmi v ne tak napěté — ale ne tak úrodné — koexistenci. Sledovanost roste, každá řada lepší.' },
  { id:'ea',  title:'Echo Atelier',      jp:'エコー工房', year:2024, season:1, eps:13, watched:13, status:'completed', next:null, genres:['Music','Slice of Life'],    score:8.8, hue:165,
    studio:'BlueCast', synopsis:'Mladá hudební producentka zdědí staré nahrávací studio v horách. Skladbu po skladbě se učí jak naslouchat — sobě i světu. Tichý, láskavý seriál s živou hudbou napsanou pro adaptaci.' },
  { id:'gp',  title:'Ghost Postman',     jp:'幽霊郵便夫', year:2025, season:2, eps:12, watched:5,  status:'airing',    next:'Pá 17:00', genres:['Adventure','Comedy'],   score:7.9, hue:65,
    studio:'Pon Pon Lab', synopsis:'Druhá řada úsměvné fantasy o poštákovi, který na svém kole rozváží zásilky mezi světem živých a světem duchů. Lehká, dobrosrdečná podívaná.' },
  { id:'lsb', title:'Last Summer Bloom', jp:'最後の夏花', year:2021, season:1, eps:12, watched:12, status:'ended',     next:null, genres:['Drama','Romance'],          score:8.0, hue:20,
    studio:'Akagi Studio', synopsis:'Coming-of-age o třech kamarádech, kteří prožijí poslední prázdniny předtím, než se jejich cesty rozdělí. Klasika žánru, na kterou se nezapomíná.' },
];

const STATUS_LABELS = {
  airing:    { label:'Vysílá se', colorKey:'statusAiring' },
  completed: { label:'Dokončeno', colorKey:'statusDone' },
  upcoming:  { label:'Chystá se', colorKey:'statusUpcoming' },
  ended:     { label:'Skončilo',  colorKey:'statusEnded' },
};

// ─── AnimePoster — gradient placeholder ─────────────────────────────────
function AnimePoster({ anime, theme, size='md', radius=6 }){
  const w = size==='lg'?220:(size==='sm'?44:120);
  const h = size==='lg'?310:(size==='sm'?60:170);
  const h1 = anime.hue;
  const h2 = (anime.hue+60)%360;
  return (
    <div style={{
      width:w, height:h, borderRadius:radius, position:'relative', overflow:'hidden',
      background:`linear-gradient(155deg, hsl(${h1}, 55%, 30%) 0%, hsl(${h2}, 50%, 18%) 80%)`,
      border:`1px solid ${theme.borderStrong}`, flexShrink:0,
    }}>
      <svg width="100%" height="100%" style={{position:'absolute',inset:0,opacity:0.18}}>
        <pattern id={`pat-${anime.id}-${size}`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="9" stroke="white" strokeWidth="1.4"/>
        </pattern>
        <rect width="100%" height="100%" fill={`url(#pat-${anime.id}-${size})`}/>
      </svg>
      <div style={{position:'absolute',left:'-20%',bottom:'-30%',width:'120%',aspectRatio:'1/1',
        background:`radial-gradient(circle, hsla(${h1},80%,60%,0.55) 0%, transparent 60%)`, filter:'blur(8px)'}}/>
      {size!=='sm' && (
        <>
          <div style={{position:'absolute',left:8,right:8,bottom:size==='lg'?14:8,
            font:`700 ${size==='lg'?16:12}px/1.2 "Space Grotesk"`,color:'#fff',
            textShadow:'0 2px 8px rgba(0,0,0,0.9)'}}>{anime.title}</div>
          <div style={{position:'absolute',left:8,top:8,
            font:`600 ${size==='lg'?12:10}px "Noto Sans JP"`,color:'rgba(255,255,255,0.75)',
            textShadow:'0 1px 4px rgba(0,0,0,0.9)'}}>{anime.jp}</div>
          {anime.score && <div style={{position:'absolute',right:8,top:8,
            padding:'2px 5px', background:'rgba(0,0,0,0.55)', color:'#fff',
            borderRadius:4, font:'700 10px JetBrains Mono'}}>
            ★ {anime.score}
          </div>}
        </>
      )}
    </div>
  );
}

function Chip({ theme, dot, label, value, accent }){
  return (
    <div style={{display:'inline-flex',alignItems:'center',gap:6,
      background:theme.panel2, border:`1px solid ${theme.border}`, borderRadius:99,
      padding:'4px 9px', font:'500 11px "Space Grotesk"', color:theme.textDim}}>
      {dot && <span style={{width:6,height:6,borderRadius:99,background:accent||theme.accent2}}/>}
      <span>{label}</span>
      {value!=null && <span style={{color:theme.text, fontFamily:'JetBrains Mono',fontWeight:600}}>{value}</span>}
    </div>
  );
}

// ─── Expose ───────────────────────────────────────────────────────────────
Object.assign(window, {
  SUB_LINES, TOTAL, AI_ALTS, THEME,
  WAVE, fmtTC, fmtMS,
  usePlayhead, activeLineIdx,
  VideoFrame, Waveform, Transport, LangTabs, Logo, HotkeyStrip, AISuggest, StylingPanel, Chip,
  AppShell, StatusPill, NavIcon, ICONS,
  LIBRARY, STATUS_LABELS, AnimePoster,
  btnGhost, btnPrimary, btnSub,
});
