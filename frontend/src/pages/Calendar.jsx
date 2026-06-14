import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getSeries } from '../api/client';
import api from '../api/client';
import {
  THEME, btnGhost, btnSub,
  PageHeader, StatusPill, strHue,
} from '../v1design';

const T = THEME;

const MONTH_NAMES = [
  'Leden','Únor','Březen','Duben','Květen','Červen',
  'Červenec','Srpen','Září','Říjen','Listopad','Prosinec',
];
const DAY_NAMES = ['Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota','Neděle'];

function toISO(d) { return d.toISOString().slice(0, 10); }

function addMonths(d, n) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function getCalData(year, month) {
  // First day of month, last day of month + a week buffer
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 14);
  return api.get(`/calendar?start=${toISO(start)}&end=${toISO(end)}`).then(r => r.data ?? []);
}

export default function Calendar({ theme }) {
  const navigate = useNavigate();
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const { data: calItems = [] } = useQuery({
    queryKey: ['calendar', viewMonth.getFullYear(), viewMonth.getMonth()],
    queryFn: () => getCalData(viewMonth.getFullYear(), viewMonth.getMonth()),
  });

  const { data: seriesList = [] } = useQuery({
    queryKey: ['series'],
    queryFn: () => getSeries().then(r => r.data),
  });

  // Build map: ISO date → [{series, episode, ...}]
  const releaseMap = useMemo(() => {
    const m = {};
    for (const item of calItems) {
      const d = (item.air_date || item.date || '').slice(0, 10);
      if (!d) continue;
      if (!m[d]) m[d] = [];
      m[d].push(item);
    }
    return m;
  }, [calItems]);

  // Build calendar grid (Mon-first, 6 rows)
  const { weeks, startDay } = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    // Mon=0 … Sun=6
    const startWeekday = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);
    const ws = [];
    for (let i = 0; i < cells.length; i += 7) ws.push(cells.slice(i, i+7));
    return { weeks: ws, startDay: startWeekday };
  }, [viewMonth]);

  const todayStr = toISO(today);
  const monthLabel = `${MONTH_NAMES[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`;

  function dayISO(day) {
    if (!day) return null;
    return `${viewMonth.getFullYear()}-${String(viewMonth.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={T} title="Kalendář"
        subtitle="Měsíční přehled premiérových epizod"
        right={<>
          <div style={{display:'flex',alignItems:'center',gap:6,background:T.panel2,
            border:`1px solid ${T.border}`,borderRadius:8,padding:2}}>
            <button onClick={() => setViewMonth(m => addMonths(m, -1))}
              style={{...btnGhost(T),padding:'4px 8px',border:'none'}}>‹</button>
            <div style={{font:'700 13px "Space Grotesk"',color:T.text,padding:'0 8px'}}>{monthLabel}</div>
            <button onClick={() => setViewMonth(m => addMonths(m, 1))}
              style={{...btnGhost(T),padding:'4px 8px',border:'none'}}>›</button>
          </div>
          <div style={{display:'flex',background:T.panel2,padding:2,borderRadius:8,border:`1px solid ${T.border}`}}>
            <button style={{
              padding:'4px 10px',borderRadius:6,border:'none',cursor:'default',
              background:T.panel, color:T.accent,
              font:'600 11px "Space Grotesk"',
            }}>Měsíc</button>
          </div>
          <button onClick={() => setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
            style={btnGhost(T)}>Dnes</button>
        </>}
      />

      <div style={{flex:1,overflowY:'auto',WebkitOverflowScrolling:'touch',padding:'18px 24px',display:'flex',flexDirection:'column',gap:8}}>
        {/* Weekday header */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:6}}>
          {DAY_NAMES.map(d => (
            <div key={d} style={{font:'600 11px JetBrains Mono',color:T.textDim,
              letterSpacing:'.04em',textTransform:'uppercase',padding:'0 6px'}}>{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{display:'flex',flexDirection:'column',gap:6,flex:1}}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:6,minHeight:90}}>
              {week.map((day, di) => {
                const iso = dayISO(day);
                const isToday = iso === todayStr;
                const isWeekend = di >= 5;
                const drops = iso ? (releaseMap[iso] || []) : [];
                return (
                  <div key={di} style={{
                    background: day ? (isToday ? T.accentSoft : T.panel) : T.bg,
                    border:`1px solid ${isToday ? T.accent : T.border}`,
                    borderRadius:8, padding:8, display:'flex',flexDirection:'column',gap:4,
                    opacity: day ? 1 : 0.4,
                    minHeight:90,
                  }}>
                    {day && (
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                        <div style={{font:`${isToday?'700':'600'} 13px JetBrains Mono`,
                          color:isToday ? T.accent : (isWeekend ? T.textDim : T.text)}}>{day}</div>
                        {drops.length > 0 && (
                          <div style={{font:'600 9px JetBrains Mono',color:T.textMute}}>{drops.length} ep</div>
                        )}
                      </div>
                    )}
                    {drops.slice(0, 3).map((drop, i) => {
                      const s = seriesList.find(x => x.id === (drop.series_id || drop.seriesId)) || {};
                      const hue = strHue(s.title_english || s.title_romaji || s.title || drop.series_title || '');
                      const title = s.title_english || s.title_romaji || s.title || drop.series_title || '—';
                      return (
                        <div key={i} onClick={() => navigate(`/series/${s.id || drop.series_id || drop.seriesId}`)} style={{
                          display:'flex',alignItems:'center',gap:5,
                          padding:'3px 5px', borderRadius:5,
                          background:`hsla(${hue},55%,30%,0.45)`,
                          border:`1px solid hsla(${hue},65%,50%,0.55)`,
                          cursor:'pointer',
                        }}>
                          {s.cover_url
                            ? <img src={s.cover_url} alt={title} style={{width:18,height:25,objectFit:'cover',borderRadius:2,flexShrink:0}}/>
                            : <div style={{width:18,height:25,borderRadius:2,background:`hsl(${hue},50%,30%)`,flexShrink:0}}/>
                          }
                          <div style={{font:'600 10px "Space Grotesk"',color:'#fff',
                            whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1}}>
                            {title}
                          </div>
                        </div>
                      );
                    })}
                    {drops.length > 3 && (
                      <div style={{font:'500 10px JetBrains Mono',color:T.textMute}}>
                        + {drops.length - 3} dalších
                      </div>
                    )}
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
