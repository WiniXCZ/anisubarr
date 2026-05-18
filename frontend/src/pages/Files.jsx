import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getDownloadsQueue, getDownloadsRecent, getDownloadsStats } from "../api/client";

// ── Design system (inline, matches design zip) ────────────────────────────────
const T = {
  bg: '#0e1220', panel: '#161a2a', panel2: '#1d2237', sunken: '#0a0d18',
  border: 'rgba(255,255,255,0.06)', borderStrong: 'rgba(255,255,255,0.12)',
  text: '#e8e9f2', textDim: 'rgba(232,233,242,0.62)', textMute: 'rgba(232,233,242,0.38)',
  accent: '#a78bfa', accent2: '#22d3ee', accent3: '#fbbf24',
  accentSoft: 'rgba(167,139,250,0.16)',
  statusDone: '#22c55e', statusUpcoming: '#f59e0b', statusEnded: '#ef4444', statusAiring: '#3b82f6',
};
const btnGhost  = { background:'transparent', color:T.textDim, border:`1px solid ${T.border}`, borderRadius:7, padding:'5px 9px', font:'500 12px/1 "Space Grotesk"', cursor:'pointer' };
const btnPrimary = { background:T.accent, color:'#fff', border:'none', borderRadius:7, padding:'6px 12px', font:'600 12px/1 "Space Grotesk"', cursor:'pointer', boxShadow:`0 4px 14px ${T.accent}55` };
const btnSub    = { background:T.panel2, color:T.text, border:`1px solid ${T.border}`, borderRadius:7, padding:'5px 10px', font:'500 12px/1 "Space Grotesk"', cursor:'pointer' };

// ── Shared design components ──────────────────────────────────────────────────

function PageHeader({ title, subtitle, right }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:14, paddingBottom:14,
      borderBottom:`1px solid ${T.border}`, marginBottom:4 }}>
      <div style={{ display:'flex', flexDirection:'column', lineHeight:1.2 }}>
        <div style={{ font:'700 22px "Space Grotesk"', color:T.text, letterSpacing:'-0.02em' }}>{title}</div>
        {subtitle && <div style={{ font:'500 12px JetBrains Mono', color:T.textMute, marginTop:5, letterSpacing:'.02em' }}>{subtitle}</div>}
      </div>
      <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>{right}</div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ flex:1, background:T.panel, border:`1px solid ${T.border}`, borderRadius:10,
      padding:'14px 16px', display:'flex', flexDirection:'column', gap:4,
      position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:accent||T.accent }}/>
      <div style={{ font:'600 10px JetBrains Mono', color:T.textMute, letterSpacing:'.08em', textTransform:'uppercase' }}>{label}</div>
      <div style={{ font:'700 26px/1 "Space Grotesk"', color:T.text, marginTop:4, fontFeatureSettings:'"tnum"' }}>{value}</div>
      {sub && <div style={{ font:'500 11px JetBrains Mono', color:T.textDim, marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, sub, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
        <div style={{ font:'700 14px "Space Grotesk"', color:T.text }}>{title}</div>
        {sub && <div style={{ font:'500 11px JetBrains Mono', color:T.textMute }}>{sub}</div>}
        <div style={{ flex:1, height:1, background:T.border, marginLeft:6 }}/>
      </div>
      {children}
    </div>
  );
}

function StatusPill({ color, label, size = 'md' }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding: size==='sm' ? '2px 7px' : '3px 9px',
      background:`${color}22`, color, border:`1px solid ${color}55`,
      borderRadius:99, font:`600 ${size==='sm'?9.5:10.5}px JetBrains Mono`,
      letterSpacing:'.04em', whiteSpace:'nowrap',
    }}>
      <span style={{ width:5, height:5, borderRadius:99, background:color }}/>
      {label}
    </span>
  );
}

// Anime poster placeholder (gradient when no cover URL)
function AnimePosterSmall({ coverUrl, seriesTitle }) {
  if (coverUrl) {
    return <img src={coverUrl} alt={seriesTitle||''} style={{ width:40, height:54, borderRadius:4, objectFit:'cover', flexShrink:0 }} />;
  }
  return (
    <div style={{ width:40, height:54, borderRadius:4, flexShrink:0,
      background:`linear-gradient(135deg, ${T.accent}33, ${T.accent2}22)`,
      border:`1px solid ${T.border}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <span style={{ font:'500 16px serif', opacity:0.5 }}>🎌</span>
    </div>
  );
}

// ── Active download row ───────────────────────────────────────────────────────

function DownloadRow({ item, last }) {
  const isActive = item.state === 'downloading';
  const stateColor = isActive ? T.accent : T.textDim;
  const stateLabel = isActive ? '↓ Stahuje se' : '◷ Ve frontě';
  // Backend returns progress as 0–100 already
  const progress = Math.min(100, Math.round(item.progress ?? 0));

  return (
    <div style={{
      display:'grid', gridTemplateColumns:'40px 1.6fr 90px 1.2fr 100px 80px 90px',
      gap:12, padding:'12px 14px', alignItems:'center',
      borderBottom: last ? 'none' : `1px solid ${T.border}`,
    }}>
      <AnimePosterSmall coverUrl={item.cover_url} seriesTitle={item.series_title}/>

      <div style={{ minWidth:0 }}>
        <div style={{ font:'600 12.5px JetBrains Mono', color:T.text,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {item.name || item.hash || '—'}
        </div>
        {item.series_title && (
          <div style={{ font:'500 11px "Space Grotesk"', color:T.textDim, marginTop:2 }}>
            {item.series_title}
          </div>
        )}
      </div>

      <div>
        <StatusPill color={stateColor} label={stateLabel} size="sm"/>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        <div style={{ display:'flex', justifyContent:'space-between', font:'500 11px JetBrains Mono' }}>
          <span style={{ color:T.textDim }}>
            {item.size || item.size_h || '—'}{(item.speed || item.dlspeed_h) ? ` · ${item.speed || item.dlspeed_h}` : ''}
          </span>
          <span style={{ color:T.text, fontWeight:600 }}>{progress}%</span>
        </div>
        <div style={{ height:5, background:T.sunken, borderRadius:99, overflow:'hidden' }}>
          <div style={{ width:`${progress}%`, height:'100%', background:stateColor, borderRadius:99 }}/>
        </div>
      </div>

      <div style={{ font:'500 11px JetBrains Mono', color:T.textDim }}>
        {(item.eta || item.eta_h) ? `ETA ${item.eta || item.eta_h}` : '—'}
      </div>

      <div style={{ font:'500 10px JetBrains Mono', color:T.textMute }}>
        {item.client || 'qBittorrent'}
      </div>

      <div style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
        <button style={{ ...btnGhost, padding:'4px 7px', fontSize:11 }}>‖</button>
        <button style={{ ...btnGhost, padding:'4px 7px', fontSize:11 }}>✕</button>
      </div>
    </div>
  );
}

// ── Recent done row ───────────────────────────────────────────────────────────

function RecentRow({ item, last }) {
  // Backend returns: file, size, date_added, subs ("jp + cs"), has_cs_sub
  const subsLabel = item.subs && item.subs !== '—' ? item.subs : null;
  const date = (item.date_added || item.added_at)
    ? new Date(item.date_added || item.added_at).toLocaleDateString('cs-CZ', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    : '—';
  const filename = item.file || item.filename || item.path?.split(/[/\\]/).pop() || '—';

  return (
    <div style={{
      display:'grid', gridTemplateColumns:'40px 1.6fr 100px 130px 180px auto',
      gap:12, padding:'10px 14px', alignItems:'center',
      borderBottom: last ? 'none' : `1px solid ${T.border}`,
    }}>
      <AnimePosterSmall coverUrl={item.cover_url} seriesTitle={item.series_title}/>
      <div style={{ minWidth:0, font:'600 12.5px JetBrains Mono', color:T.text,
        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{filename}</div>
      <div style={{ font:'500 11px JetBrains Mono', color:T.textDim }}>{item.size || item.size_h || '—'}</div>
      <div style={{ font:'500 11px JetBrains Mono', color:T.textDim }}>{date}</div>
      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
        <StatusPill color={T.statusDone} label="✓ Hotovo" size="sm"/>
        {subsLabel && <StatusPill color={T.accent2} label={subsLabel} size="sm"/>}
      </div>
      <div style={{ display:'flex', gap:5, justifyContent:'flex-end' }}>
        <button style={{ ...btnGhost, padding:'4px 8px', fontSize:11 }}>Přehrát</button>
        <button style={{ ...btnGhost, padding:'4px 8px', fontSize:11 }}>⋯</button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Files() {
  const { data: queueRaw,  isLoading: queueLoading  } = useQuery({
    queryKey: ['downloads-queue'],
    queryFn:  () => getDownloadsQueue().then(r => r.data),
    refetchInterval: 5000,
    staleTime: 3000,
  });

  const { data: recentRaw, isLoading: recentLoading } = useQuery({
    queryKey: ['downloads-recent'],
    queryFn:  () => getDownloadsRecent(7).then(r => r.data),
    staleTime: 30_000,
  });

  const { data: stats } = useQuery({
    queryKey: ['downloads-stats'],
    queryFn:  () => getDownloadsStats().then(r => r.data),
    staleTime: 10_000,
  });

  // Backend returns {"items":[...]} for queue and recent
  const queue  = Array.isArray(queueRaw)  ? queueRaw  : (queueRaw?.items  ?? []);
  const recent = Array.isArray(recentRaw) ? recentRaw : (recentRaw?.items ?? []);

  const downloading = queue.filter(q => q.state === 'downloading');
  const queued      = queue.filter(q => q.state !== 'downloading');

  const diskUsed = stats?.disk_human || '—';
  const diskPct  = null;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      <PageHeader
        title="Soubory"
        subtitle="Fronta stahování · knihovna na disku · karanténa"
        right={<>
          <button style={btnSub}>‖ Pozastavit vše</button>
          <button style={btnSub}>⟲ Obnovit klienty</button>
          <button style={btnPrimary}>+ Přidat torrent / NZB</button>
        </>}
      />

      {/* Stat cards */}
      <div style={{ display:'flex', gap:10 }}>
        <StatCard label="Stahuje se"     value={stats?.downloading ?? downloading.length}
          sub={downloading.length > 0 ? `${downloading.map(i=>i.speed||'').join(' · ')||'aktivní'}` : 'aktivních'}
          accent={T.accent}/>
        <StatCard label="Ve frontě"      value={stats?.queued ?? queued.length}
          sub="čeká na slot"
          accent={T.accent2}/>
        <StatCard label="Hotovo (dnes)"  value={stats?.done_today ?? 0}
          sub={`∑ ${recent.length} za 7 dní`}
          accent={T.statusDone}/>
        <StatCard label="Karanténa"      value="0"
          sub="vše čisté"
          accent={T.statusDone}/>
        <StatCard label="Disk"           value={diskUsed}
          sub="využití"
          accent={T.accent}/>
      </div>

      {/* Active downloads */}
      <Section title="Aktivní stahování" sub={`${queue.length} úloh${queue.length > 0 ? ' · klient qBittorrent' : ''}`}>
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden' }}>
          {queueLoading ? (
            <div style={{ display:'flex', justifyContent:'center', padding:48 }}>
              <Loader2 size={18} style={{ color:T.textMute }}/>
            </div>
          ) : queue.length === 0 ? (
            <p style={{ textAlign:'center', padding:32, color:T.textMute, font:'500 13px "Space Grotesk"' }}>
              Nic se nestahuje
            </p>
          ) : (
            queue.map((item, i) => (
              <DownloadRow key={item.hash || item.id || i} item={item} last={i === queue.length - 1}/>
            ))
          )}
        </div>
      </Section>

      {/* Recently done */}
      <Section title="Nedávno hotové" sub="poslední 7 dní">
        <div style={{ background:T.panel, border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden' }}>
          {recentLoading ? (
            <div style={{ display:'flex', justifyContent:'center', padding:48 }}>
              <Loader2 size={18} style={{ color:T.textMute }}/>
            </div>
          ) : recent.length === 0 ? (
            <p style={{ textAlign:'center', padding:32, color:T.textMute, font:'500 13px "Space Grotesk"' }}>
              Žádné nedávné soubory
            </p>
          ) : (
            recent.map((item, i) => (
              <RecentRow key={item.id ?? i} item={item} last={i === recent.length - 1}/>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}
