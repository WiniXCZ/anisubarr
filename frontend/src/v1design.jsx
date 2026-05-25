// v1design.jsx — sdílený design systém (THEME.dark z v1/shared.jsx)

export const THEME = {
  bg:'#0e1220', panel:'#161a2a', panel2:'#1d2237', sunken:'#0a0d18',
  border:'rgba(255,255,255,0.06)', borderStrong:'rgba(255,255,255,0.12)',
  text:'#e8e9f2', textDim:'rgba(232,233,242,0.62)', textMute:'rgba(232,233,242,0.38)',
  accent:'#a78bfa',
  accent2:'#22d3ee',
  accent3:'#fbbf24',
  accentSoft:'rgba(167,139,250,0.16)',
  accent2Soft:'rgba(34,211,238,0.14)',
  statusAiring:'#3b82f6', statusDone:'#22c55e', statusUpcoming:'#f59e0b', statusEnded:'#ef4444',
};

export const btnGhost = (t) => ({
  background:'transparent', color:t.textDim, border:`1px solid ${t.border}`,
  borderRadius:7, padding:'5px 9px', font:'500 12px/1 "Space Grotesk"', cursor:'pointer',
});
export const btnPrimary = (t) => ({
  background:t.accent, color:'#fff', border:'none',
  borderRadius:7, padding:'6px 12px', font:'600 12px/1 "Space Grotesk"', cursor:'pointer',
  boxShadow:`0 4px 14px ${t.accent}55`,
});
export const btnSub = (t) => ({
  background:t.panel2, color:t.text, border:`1px solid ${t.border}`,
  borderRadius:7, padding:'5px 10px', font:'500 12px/1 "Space Grotesk"', cursor:'pointer',
});

// Status mapping for API status codes
export const STATUS_META = {
  // AniList style
  RELEASING:        { label:'Vysílá se', colorKey:'statusAiring' },
  FINISHED:         { label:'Dokončeno',  colorKey:'statusDone' },
  NOT_YET_RELEASED: { label:'Chystá se',  colorKey:'statusUpcoming' },
  CANCELLED:        { label:'Skončilo',   colorKey:'statusEnded' },
  HIATUS:           { label:'Pauza',      colorKey:'statusUpcoming' },
  // Sonarr style (Title case)
  Continuing:       { label:'Vysílá se', colorKey:'statusAiring' },
  Ended:            { label:'Skončilo',   colorKey:'statusEnded' },
  Upcoming:         { label:'Chystá se',  colorKey:'statusUpcoming' },
  Deleted:          { label:'Smazáno',   colorKey:'statusEnded' },
  // Sonarr style (lowercase — actual API values)
  // "ended" = series concluded (= completed/green), "deleted" = removed from Sonarr (= red)
  continuing:       { label:'Vysílá se', colorKey:'statusAiring' },
  ended:            { label:'Dokončeno', colorKey:'statusDone' },
  upcoming:         { label:'Chystá se', colorKey:'statusUpcoming' },
  deleted:          { label:'Smazáno',  colorKey:'statusEnded' },
};

export function statusMeta(status) {
  return STATUS_META[status] || { label: status || '—', colorKey: 'statusEnded' };
}
export function statusColor(theme, status) {
  return theme[statusMeta(status).colorKey];
}

// Deterministic hue from string
export function strHue(s) {
  if (!s) return 220;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return h % 360;
}

export function StatusPill({ theme, color, label, dot = true, size = 'md' }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding: size==='sm' ? '2px 7px' : '3px 9px',
      background:`${color}22`, color, border:`1px solid ${color}55`,
      borderRadius:99, font:`600 ${size==='sm' ? 9.5 : 10.5}px JetBrains Mono`,
      letterSpacing:'.04em', whiteSpace:'nowrap',
    }}>
      {dot && <span style={{width:5, height:5, borderRadius:99, background:color}}/>}
      {label}
    </span>
  );
}

export function AnimePoster({ series, theme, size = 'md', radius = 6 }) {
  const w = size==='lg' ? 220 : (size==='sm' ? 44 : 120);
  const h = size==='lg' ? 310 : (size==='sm' ? 60 : 170);
  const title = series.title_romaji || series.title || '';
  const jp = series.title_jp || series.title_native || '';
  const score = series.average_score || series.score || null;
  const hue = strHue(title);
  const h2 = (hue + 60) % 360;
  const pid = `pat-${String(series.id || '').replace(/[^a-z0-9]/gi, 'x')}-${size}`;

  if (series.cover_url) {
    return (
      <div style={{
        width:w, height:h, borderRadius:radius, overflow:'hidden',
        border:`1px solid ${theme.borderStrong}`, flexShrink:0,
      }}>
        <img src={series.cover_url} alt={title}
          style={{width:'100%', height:'100%', objectFit:'cover'}}/>
      </div>
    );
  }

  return (
    <div style={{
      width:w, height:h, borderRadius:radius, position:'relative', overflow:'hidden',
      background:`linear-gradient(155deg, hsl(${hue},55%,30%) 0%, hsl(${h2},50%,18%) 80%)`,
      border:`1px solid ${theme.borderStrong}`, flexShrink:0,
    }}>
      <svg width="100%" height="100%" style={{position:'absolute',inset:0,opacity:0.18}}>
        <pattern id={pid} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="9" stroke="white" strokeWidth="1.4"/>
        </pattern>
        <rect width="100%" height="100%" fill={`url(#${pid})`}/>
      </svg>
      <div style={{position:'absolute',left:'-20%',bottom:'-30%',width:'120%',aspectRatio:'1/1',
        background:`radial-gradient(circle, hsla(${hue},80%,60%,0.55) 0%, transparent 60%)`, filter:'blur(8px)'}}/>
      {size !== 'sm' && <>
        <div style={{position:'absolute',left:8,right:8,bottom:size==='lg'?14:8,
          font:`700 ${size==='lg'?16:12}px/1.2 "Space Grotesk"`,color:'#fff',
          textShadow:'0 2px 8px rgba(0,0,0,0.9)'}}>{title}</div>
        {jp && <div style={{position:'absolute',left:8,top:8,
          font:`600 ${size==='lg'?12:10}px "Noto Sans JP"`,color:'rgba(255,255,255,0.75)',
          textShadow:'0 1px 4px rgba(0,0,0,0.9)'}}>{jp}</div>}
        {score > 0 && <div style={{position:'absolute',right:8,top:8,
          padding:'2px 5px', background:'rgba(0,0,0,0.55)', color:'#fff',
          borderRadius:4, font:'700 10px JetBrains Mono'}}>
          ★ {Number(score).toFixed(1)}
        </div>}
      </>}
    </div>
  );
}

export function PageHeader({ theme, title, subtitle, right }) {
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

export function StatCard({ theme, label, value, sub, accent }) {
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

export function FilterPill({ theme, label, active, count, onClick }) {
  return (
    <button onClick={onClick} style={{
      display:'inline-flex',alignItems:'center',gap:7,
      padding:'6px 12px', borderRadius:99,
      background:active ? theme.accent : theme.panel2,
      color:active ? '#fff' : theme.textDim,
      border:`1px solid ${active ? theme.accent : theme.border}`,
      font:'600 12px "Space Grotesk"', cursor:'pointer',
    }}>
      {label}
      {count != null && <span style={{font:'700 10px JetBrains Mono',
        background:active ? 'rgba(255,255,255,0.22)' : theme.sunken,
        color:active ? '#fff' : theme.textMute, padding:'1px 6px', borderRadius:99}}>{count}</span>}
    </button>
  );
}

export function Section({ theme, title, sub, children }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      <div style={{display:'flex',alignItems:'baseline',gap:10}}>
        <div style={{font:'700 14px "Space Grotesk"',color:theme.text}}>{title}</div>
        {sub && <div style={{font:'500 11px JetBrains Mono',color:theme.textMute}}>{sub}</div>}
        <div style={{flex:1, height:1, background:theme.border, marginLeft:6}}/>
      </div>
      {children}
    </div>
  );
}

export function SettingsGroup({ theme, title, sub, children }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      <div>
        <div style={{font:'700 15px "Space Grotesk"',color:theme.text}}>{title}</div>
        {sub && <div style={{font:'500 12px "Space Grotesk"',color:theme.textDim,marginTop:3}}>{sub}</div>}
      </div>
      <div style={{background:theme.panel,border:`1px solid ${theme.border}`,borderRadius:10,
        display:'flex',flexDirection:'column'}}>
        {children}
      </div>
    </div>
  );
}

export function SettingsRow({ theme, label, sub, control, last }) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:14,padding:'14px 16px',
      borderBottom:last ? 'none' : `1px solid ${theme.border}`}}>
      <div style={{flex:1}}>
        <div style={{font:'600 13px "Space Grotesk"',color:theme.text}}>{label}</div>
        {sub && <div style={{font:'500 11px "Space Grotesk"',color:theme.textDim,marginTop:3}}>{sub}</div>}
      </div>
      <div>{control}</div>
    </div>
  );
}

export function Toggle({ theme, on, onChange }) {
  return (
    <button onClick={() => onChange && onChange(!on)} style={{
      width:36, height:20, borderRadius:99, border:'none', cursor:'pointer',
      background:on ? theme.accent : theme.sunken, position:'relative',
      transition:'background .15s',
    }}>
      <div style={{
        position:'absolute', top:2, left:on ? 18 : 2, width:16, height:16, borderRadius:99,
        background:'#fff', transition:'left .15s',
        boxShadow:'0 1px 3px rgba(0,0,0,0.4)',
      }}/>
    </button>
  );
}

export function TextField({ theme, value, onChange, width = 200, mono = false, placeholder }) {
  return (
    <input
      value={value}
      onChange={e => onChange && onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width, padding:'6px 10px', background:theme.panel2, color:theme.text,
        border:`1px solid ${theme.border}`, borderRadius:6, outline:'none',
        font:`500 12px ${mono ? 'JetBrains Mono' : '"Space Grotesk"'}`,
      }}
    />
  );
}

export function SelectField({ theme, value, options, onChange }) {
  return (
    <select value={value} onChange={e => onChange && onChange(e.target.value)} style={{
      padding:'6px 10px', background:theme.panel2, color:theme.text,
      border:`1px solid ${theme.border}`, borderRadius:6, outline:'none',
      font:'500 12px "Space Grotesk"', cursor:'pointer',
    }}>
      {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
    </select>
  );
}
