// pages-rest.jsx — Žádosti · Soubory · Nastavení

// ─── ŽÁDOSTI ────────────────────────────────────────────────────────────
const REQUESTS = [
  // pending
  { id:1, animeId:'vh', user:'kuro',     when:'před 18 min',  source:'AniList',     status:'pending', note:'Můžeme prosím zařadit? Vychází 10. června.' },
  { id:2, animeId:'ph', user:'mei',      when:'před 2 h',     source:'AniList',     status:'pending', note:'' },
  { id:3, animeId:null, customTitle:'Static Reverie', customJp:'静寂のレベリー', user:'ren',      when:'včera',        source:'manuální',  status:'pending', note:'V databázi to ještě není, ale je oznámeno na podzim.' },
  { id:4, animeId:'qs', user:'haru',     when:'včera',        source:'AniList',     status:'pending', note:'+ 4. řada by se hodila.' },
  // approved
  { id:5, animeId:'sad', user:'kuro',    when:'tento týden',  source:'AniList',    status:'approved', note:'' },
  { id:6, animeId:'nc',  user:'mei',     when:'minulý týden', source:'AniDB',      status:'approved', note:'' },
  // rejected
  { id:7, animeId:null, customTitle:'Bullet Karaoke', customJp:'弾丸カラオケ', user:'ren', when:'před měsícem', source:'manuální', status:'rejected', note:'Není dostupné v žádném indexeru.' },
];

function RequestsPage({ theme }){
  const [tab, setTab] = React.useState('pending');
  const counts = {
    pending: REQUESTS.filter(r=>r.status==='pending').length,
    approved: REQUESTS.filter(r=>r.status==='approved').length,
    rejected: REQUESTS.filter(r=>r.status==='rejected').length,
  };
  const list = REQUESTS.filter(r=>r.status===tab);

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={theme} title="Žádosti" subtitle="Požadavky od uživatelů a integrace AniList / AniDB"
        right={<>
          <button style={btnSub(theme)}>⚙ Pravidla auto-schválení</button>
          <button style={btnPrimary(theme)}>+ Nová žádost</button>
        </>}/>

      <div style={{flex:1,overflowY:'auto',padding:'18px 24px',display:'flex',flexDirection:'column',gap:18}}>
        <div style={{display:'flex',gap:10}}>
          <StatCard theme={theme} label="Čeká" value={counts.pending} sub="vyžaduje schválení" accent={theme.statusUpcoming}/>
          <StatCard theme={theme} label="Schváleno" value={counts.approved} sub="přidáno do knihovny" accent={theme.statusDone}/>
          <StatCard theme={theme} label="Zamítnuto" value={counts.rejected} sub="nedostupné / mimo profil" accent={theme.statusEnded}/>
          <StatCard theme={theme} label="Auto-schválení" value="ON" sub="dle pravidel" accent={theme.accent}/>
        </div>

        <div style={{display:'flex',gap:6}}>
          <FilterPill theme={theme} label="Čekající" active={tab==='pending'} count={counts.pending} onClick={()=>setTab('pending')}/>
          <FilterPill theme={theme} label="Schválené" active={tab==='approved'} count={counts.approved} onClick={()=>setTab('approved')}/>
          <FilterPill theme={theme} label="Zamítnuté" active={tab==='rejected'} count={counts.rejected} onClick={()=>setTab('rejected')}/>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {list.length===0 && (
            <div style={{padding:24,background:theme.panel,border:`1px dashed ${theme.border}`,
              borderRadius:10, font:'500 13px "Space Grotesk"',color:theme.textMute,textAlign:'center'}}>
              Nic tu není
            </div>
          )}
          {list.map(req=>{
            const anime = req.animeId ? LIBRARY.find(a=>a.id===req.animeId) : null;
            const fakeAnime = anime || { id:`custom-${req.id}`, title:req.customTitle, jp:req.customJp, hue:280, score:null };
            return (
              <div key={req.id} style={{
                display:'grid', gridTemplateColumns:'48px 1fr auto',
                gap:14, padding:14, background:theme.panel,
                border:`1px solid ${theme.border}`, borderRadius:10, alignItems:'flex-start',
              }}>
                {anime ? <AnimePoster anime={fakeAnime} theme={theme} size="sm" radius={4}/> :
                  <div style={{width:44,height:60,borderRadius:4,
                    background:`linear-gradient(135deg,${theme.accent}33,${theme.accent2}33)`,
                    border:`1px dashed ${theme.borderStrong}`,display:'grid',placeItems:'center',
                    font:'700 16px "Space Grotesk"',color:theme.textMute}}>?</div>
                }
                <div style={{minWidth:0,display:'flex',flexDirection:'column',gap:5}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                    <div style={{font:'600 14px "Space Grotesk"',color:theme.text}}>{fakeAnime.title}</div>
                    {fakeAnime.jp && <div style={{font:'500 12px "Noto Sans JP"',color:theme.textDim}}>{fakeAnime.jp}</div>}
                    {!anime && <StatusPill theme={theme} color={theme.accent} label="nové" size="sm"/>}
                    <span style={{font:'500 10px JetBrains Mono',color:theme.textMute,
                      background:theme.panel2,padding:'2px 7px',borderRadius:99,
                      border:`1px solid ${theme.border}`}}>{req.source}</span>
                  </div>
                  <div style={{font:'500 11px JetBrains Mono',color:theme.textDim}}>
                    od <span style={{color:theme.text}}>@{req.user}</span> · {req.when}
                  </div>
                  {req.note && <div style={{font:'500 12px/1.4 "Space Grotesk"',color:theme.textDim,
                    background:theme.panel2, border:`1px solid ${theme.border}`, borderRadius:6,
                    padding:'7px 10px',marginTop:2,fontStyle:'italic'}}>
                    „{req.note}"
                  </div>}
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  {req.status==='pending' && (<>
                    <button style={{...btnGhost(theme),padding:'6px 10px',fontSize:11}}>Zamítnout</button>
                    <button style={{...btnPrimary(theme),padding:'6px 12px',fontSize:11}}>✓ Schválit & přidat</button>
                  </>)}
                  {req.status==='approved' && (<>
                    <StatusPill theme={theme} color={theme.statusDone} label="Schváleno" size="sm"/>
                    <button style={{...btnGhost(theme),padding:'6px 10px',fontSize:11}}>Zobrazit</button>
                  </>)}
                  {req.status==='rejected' && (<>
                    <StatusPill theme={theme} color={theme.statusEnded} label="Zamítnuto" size="sm"/>
                    <button style={{...btnGhost(theme),padding:'6px 10px',fontSize:11}}>Obnovit</button>
                  </>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── SOUBORY ────────────────────────────────────────────────────────────
const FILES_QUEUE = [
  { id:1, file:'signal_at_dusk.s01e04.1080p.mkv',     anime:'sad', size:'1.4 GB', speed:'8.2 MB/s', eta:'02:14', progress:62, state:'downloading', client:'qBittorrent' },
  { id:2, file:'neon_cartographer.s01e08.1080p.mkv',  anime:'nc',  size:'1.2 GB', speed:'12.4 MB/s', eta:'00:47', progress:18, state:'downloading', client:'qBittorrent' },
  { id:3, file:'yokai_district.s04e12.1080p.mkv',     anime:'yd',  size:'1.6 GB', speed:'2.1 MB/s',  eta:'04:31', progress:5,  state:'queued',      client:'qBittorrent' },
];
const FILES_DONE = [
  { id:11, file:'signal_at_dusk.s01e03.1080p.mkv',    anime:'sad', size:'1.4 GB', when:'před 2 dny', subs:'jp + cs' },
  { id:12, file:'the_quiet_stars.s01e18.1080p.mkv',   anime:'qs',  size:'1.3 GB', when:'včera',     subs:'jp' },
  { id:13, file:'ghost_postman.s02e05.1080p.mkv',     anime:'gp',  size:'1.1 GB', when:'dnes 06:12', subs:'jp + cs' },
];

function FilesPage({ theme }){
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={theme} title="Soubory" subtitle="Fronta stahování · knihovna na disku · karanténa"
        right={<>
          <button style={btnSub(theme)}>‖ Pozastavit vše</button>
          <button style={btnSub(theme)}>⟲ Obnovit klienty</button>
          <button style={btnPrimary(theme)}>+ Přidat torrent / NZB</button>
        </>}/>
      <div style={{flex:1,overflowY:'auto',padding:'18px 24px',display:'flex',flexDirection:'column',gap:18}}>
        <div style={{display:'flex',gap:10}}>
          <StatCard theme={theme} label="Stahuje se" value="2" sub="20.6 MB/s · ↑ 1.2 MB/s" accent={theme.accent}/>
          <StatCard theme={theme} label="Ve frontě" value="1" sub="čeká na slot" accent={theme.accent2}/>
          <StatCard theme={theme} label="Hotovo (dnes)" value="3" sub="∑ 4.2 GB" accent={theme.statusDone}/>
          <StatCard theme={theme} label="Karanténa" value="0" sub="vše čisté" accent={theme.statusDone}/>
          <StatCard theme={theme} label="Disk" value="847 / 2048" sub="GB · 41 %" accent={theme.accent}/>
        </div>

        {/* Active downloads */}
        <Section theme={theme} title="Aktivní stahování" sub={`${FILES_QUEUE.length} úloh · klient qBittorrent`}>
          <div style={{display:'flex',flexDirection:'column',background:theme.panel,
            border:`1px solid ${theme.border}`,borderRadius:10,overflow:'hidden'}}>
            {FILES_QUEUE.map((f,i)=>{
              const anime = LIBRARY.find(a=>a.id===f.anime);
              const sm = f.state==='queued'
                ? { color:theme.textDim, label:'Ve frontě', icon:'◷' }
                : { color:theme.accent,  label:'Stahuje se', icon:'↓' };
              return (
                <div key={f.id} style={{
                  display:'grid', gridTemplateColumns:'40px 1.6fr 90px 1.2fr 100px 80px 90px',
                  gap:12, padding:'12px 14px', alignItems:'center',
                  borderBottom:i===FILES_QUEUE.length-1?'none':`1px solid ${theme.border}`,
                }}>
                  <AnimePoster anime={anime} theme={theme} size="sm" radius={4}/>
                  <div style={{minWidth:0}}>
                    <div style={{font:'600 12.5px JetBrains Mono',color:theme.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.file}</div>
                    <div style={{font:'500 11px "Space Grotesk"',color:theme.textDim,marginTop:2}}>
                      {anime.title} · S{anime.season}
                    </div>
                  </div>
                  <div><StatusPill theme={theme} color={sm.color} label={`${sm.icon} ${sm.label}`} size="sm"/></div>
                  {/* progress */}
                  <div style={{display:'flex',flexDirection:'column',gap:4}}>
                    <div style={{display:'flex',justifyContent:'space-between',font:'500 11px JetBrains Mono'}}>
                      <span style={{color:theme.textDim}}>{f.size} · {f.speed}</span>
                      <span style={{color:theme.text,fontWeight:600}}>{f.progress}%</span>
                    </div>
                    <div style={{height:5,background:theme.sunken,borderRadius:99,overflow:'hidden'}}>
                      <div style={{width:`${f.progress}%`,height:'100%',background:sm.color,borderRadius:99}}/>
                    </div>
                  </div>
                  <div style={{font:'500 11px JetBrains Mono',color:theme.textDim}}>ETA {f.eta}</div>
                  <div style={{font:'500 10px JetBrains Mono',color:theme.textMute}}>{f.client}</div>
                  <div style={{display:'flex',gap:4,justifyContent:'flex-end'}}>
                    <button style={{...btnGhost(theme),padding:'4px 7px',fontSize:11}}>‖</button>
                    <button style={{...btnGhost(theme),padding:'4px 7px',fontSize:11}}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Recently done */}
        <Section theme={theme} title="Nedávno hotové" sub="poslední 7 dní">
          <div style={{display:'flex',flexDirection:'column',background:theme.panel,
            border:`1px solid ${theme.border}`,borderRadius:10,overflow:'hidden'}}>
            {FILES_DONE.map((f,i)=>{
              const anime = LIBRARY.find(a=>a.id===f.anime);
              return (
                <div key={f.id} style={{
                  display:'grid', gridTemplateColumns:'40px 1.6fr 100px 130px 180px auto',
                  gap:12, padding:'10px 14px', alignItems:'center',
                  borderBottom:i===FILES_DONE.length-1?'none':`1px solid ${theme.border}`,
                }}>
                  <AnimePoster anime={anime} theme={theme} size="sm" radius={4}/>
                  <div style={{minWidth:0,font:'600 12.5px JetBrains Mono',color:theme.text,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.file}</div>
                  <div style={{font:'500 11px JetBrains Mono',color:theme.textDim}}>{f.size}</div>
                  <div style={{font:'500 11px JetBrains Mono',color:theme.textDim}}>{f.when}</div>
                  <div style={{display:'flex',gap:5}}>
                    <StatusPill theme={theme} color={theme.statusDone} label="✓ Hotovo" size="sm"/>
                    <StatusPill theme={theme} color={theme.accent2} label={`titulky: ${f.subs}`} size="sm"/>
                  </div>
                  <div style={{display:'flex',gap:5,justifyContent:'flex-end'}}>
                    <button style={{...btnGhost(theme),padding:'4px 8px',fontSize:11}}>Přehrát</button>
                    <button style={{...btnGhost(theme),padding:'4px 8px',fontSize:11}}>⋯</button>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ theme, title, sub, children }){
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

// ─── NASTAVENÍ ──────────────────────────────────────────────────────────
const SETTINGS_SECTIONS = [
  { id:'profile',   label:'Profil',         icon:'👤' },
  { id:'library',   label:'Knihovna',       icon:'⊞' },
  { id:'downloads', label:'Stahovače',      icon:'↓' },
  { id:'indexers',  label:'Indexery',       icon:'⌕' },
  { id:'subs',      label:'Titulky & AI',   icon:'✦' },
  { id:'notif',     label:'Notifikace',     icon:'⌃' },
  { id:'appear',    label:'Vzhled',         icon:'◐' },
  { id:'about',     label:'O aplikaci',     icon:'ⓘ' },
];

function SettingsPage({ theme }){
  const [sec, setSec] = React.useState('subs');

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={theme} title="Nastavení" subtitle="Konfigurace appky, indexerů, klientů a AI překladu"
        right={<button style={btnPrimary(theme)}>✓ Uložit změny</button>}/>

      <div style={{flex:1,display:'flex',minHeight:0}}>
        {/* sidebar */}
        <div style={{flex:'0 0 240px',borderRight:`1px solid ${theme.border}`,
          background:theme.panel2,padding:'14px 8px',display:'flex',flexDirection:'column',gap:2}}>
          {SETTINGS_SECTIONS.map(s=>(
            <button key={s.id} onClick={()=>setSec(s.id)} style={{
              display:'flex',alignItems:'center',gap:10,
              padding:'9px 12px', borderRadius:7, border:'none', cursor:'pointer',
              background:sec===s.id?theme.accentSoft:'transparent',
              color:sec===s.id?theme.accent:theme.text,
              font:`${sec===s.id?'600':'500'} 13px "Space Grotesk"`, textAlign:'left',
            }}>
              <span style={{width:16,textAlign:'center'}}>{s.icon}</span>{s.label}
            </button>
          ))}
        </div>

        {/* body */}
        <div style={{flex:1,overflowY:'auto',padding:'22px 28px',display:'flex',flexDirection:'column',gap:22,maxWidth:900}}>
          {sec==='subs' && <SubsAISettings theme={theme}/>}
          {sec==='profile' && <ProfileSettings theme={theme}/>}
          {sec==='library' && <LibrarySettings theme={theme}/>}
          {sec==='downloads' && <DownloadsSettings theme={theme}/>}
          {sec==='indexers' && <IndexersSettings theme={theme}/>}
          {sec==='notif' && <NotifSettings theme={theme}/>}
          {sec==='appear' && <AppearSettings theme={theme}/>}
          {sec==='about' && <AboutSettings theme={theme}/>}
        </div>
      </div>
    </div>
  );
}

function SettingsGroup({ theme, title, sub, children }){
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
function SettingsRow({ theme, label, sub, control, last }){
  return (
    <div style={{display:'flex',alignItems:'center',gap:14,padding:'14px 16px',
      borderBottom:last?'none':`1px solid ${theme.border}`}}>
      <div style={{flex:1}}>
        <div style={{font:'600 13px "Space Grotesk"',color:theme.text}}>{label}</div>
        {sub && <div style={{font:'500 11px "Space Grotesk"',color:theme.textDim,marginTop:3}}>{sub}</div>}
      </div>
      <div>{control}</div>
    </div>
  );
}
function Toggle({ theme, on, onChange }){
  return (
    <button onClick={()=>onChange && onChange(!on)} style={{
      width:36,height:20,borderRadius:99, border:'none', cursor:'pointer',
      background:on?theme.accent:theme.sunken, position:'relative',
      transition:'background .15s',
    }}>
      <div style={{
        position:'absolute', top:2, left:on?18:2, width:16, height:16, borderRadius:99,
        background:'#fff', transition:'left .15s',
        boxShadow:'0 1px 3px rgba(0,0,0,0.4)',
      }}/>
    </button>
  );
}
function TextField({ theme, value, width=200, mono=false }){
  return (
    <input defaultValue={value} style={{
      width, padding:'6px 10px', background:theme.panel2, color:theme.text,
      border:`1px solid ${theme.border}`, borderRadius:6, outline:'none',
      font:`500 12px ${mono?'JetBrains Mono':'"Space Grotesk"'}`,
    }}/>
  );
}
function Select({ theme, value, options }){
  return (
    <select defaultValue={value} style={{
      padding:'6px 10px', background:theme.panel2, color:theme.text,
      border:`1px solid ${theme.border}`, borderRadius:6, outline:'none',
      font:'500 12px "Space Grotesk"', cursor:'pointer',
    }}>
      {options.map(o=><option key={o}>{o}</option>)}
    </select>
  );
}

function SubsAISettings({ theme }){
  const [t1, setT1] = React.useState(true);
  const [t2, setT2] = React.useState(true);
  const [t3, setT3] = React.useState(false);
  return (<>
    <SettingsGroup theme={theme} title="AI překlad" sub="Jak Animsubarr používá Claude pro překlad titulků">
      <SettingsRow theme={theme} label="AI poskytovatel" sub="model pro generování překladu"
        control={<Select theme={theme} value="Claude haiku-4.5" options={['Claude haiku-4.5','Claude sonnet-4.5','GPT-4o-mini','Lokální (Whisper + LLM)']}/>}/>
      <SettingsRow theme={theme} label="Zdrojový jazyk" sub="výchozí jazyk vstupních titulků"
        control={<Select theme={theme} value="Japonština (ja)" options={['Japonština (ja)','Angličtina (en)','Korejština (ko)','Detekovat']}/>}/>
      <SettingsRow theme={theme} label="Cílový jazyk" sub="kam Animsubarr překládá"
        control={<Select theme={theme} value="Čeština (cs)" options={['Čeština (cs)','Slovenština (sk)','Angličtina (en)']}/>}/>
      <SettingsRow theme={theme} label="Auto-překlad nových epizod" sub="po dokončení stahování spustit překlad"
        control={<Toggle theme={theme} on={t1} onChange={setT1}/>}/>
      <SettingsRow theme={theme} label="Zachovat honorifika" sub="-san, -kun, -chan, sensei…"
        control={<Toggle theme={theme} on={t2} onChange={setT2}/>} last/>
    </SettingsGroup>

    <SettingsGroup theme={theme} title="Časování" sub="Limity a pravidla pro auto-úpravy">
      <SettingsRow theme={theme} label="Maximální CPS" sub="upozornit, když překlad překročí znaků za sekundu"
        control={<TextField theme={theme} value="20" width={60} mono/>}/>
      <SettingsRow theme={theme} label="Minimální mezera mezi řádky" sub="v sekundách"
        control={<TextField theme={theme} value="0.10" width={60} mono/>}/>
      <SettingsRow theme={theme} label="Auto-snap na shot change" sub="přichytit start/end k detekovaným střihům"
        control={<Toggle theme={theme} on={t3} onChange={setT3}/>} last/>
    </SettingsGroup>

    <SettingsGroup theme={theme} title="Výstupní formáty" sub="Kam ukládat hotové titulky">
      <SettingsRow theme={theme} label="Primární formát"
        control={<Select theme={theme} value=".ass (Advanced SubStation)" options={['.ass (Advanced SubStation)','.srt (SubRip)','.vtt (WebVTT)']}/>}/>
      <SettingsRow theme={theme} label="Cesta pro export"
        control={<TextField theme={theme} value="/library/{anime}/Subs/{anime}.s{season}e{ep}.{lang}.{ext}" width={420} mono/>} last/>
    </SettingsGroup>
  </>);
}
function ProfileSettings({ theme }){
  return (
    <SettingsGroup theme={theme} title="Profil" sub="Tvůj účet a sdílení knihovny">
      <SettingsRow theme={theme} label="Uživatelské jméno" control={<TextField theme={theme} value="kuro"/>}/>
      <SettingsRow theme={theme} label="E-mail" control={<TextField theme={theme} value="kuro@animsubarr.local" width={260}/>}/>
      <SettingsRow theme={theme} label="AniList synchronizace" sub="propojit pro automatický import sledovaného"
        control={<button style={btnSub(theme)}>Propojit</button>}/>
      <SettingsRow theme={theme} label="MAL synchronizace" control={<button style={btnSub(theme)}>Propojit</button>} last/>
    </SettingsGroup>
  );
}
function LibrarySettings({ theme }){
  return (
    <SettingsGroup theme={theme} title="Knihovna" sub="Kořenové složky a pravidla pojmenování">
      <SettingsRow theme={theme} label="Kořenová složka" control={<TextField theme={theme} value="/srv/media/anime" width={300} mono/>}/>
      <SettingsRow theme={theme} label="Vzor pojmenování" control={<TextField theme={theme} value="{anime}/S{season:00}/{anime}.s{season:00}e{ep:00}.{quality}" width={420} mono/>}/>
      <SettingsRow theme={theme} label="Preferovaná kvalita" control={<Select theme={theme} value="1080p" options={['480p','720p','1080p','2160p (4K)']}/>} last/>
    </SettingsGroup>
  );
}
function DownloadsSettings({ theme }){
  const [on, setOn] = React.useState(true);
  return (
    <SettingsGroup theme={theme} title="Stahovače" sub="Připojení k torrent / Usenet klientům">
      <SettingsRow theme={theme} label="qBittorrent" sub="http://localhost:8080 · zapnuto"
        control={<Toggle theme={theme} on={on} onChange={setOn}/>}/>
      <SettingsRow theme={theme} label="SABnzbd" sub="nepřipojeno"
        control={<button style={btnSub(theme)}>+ Připojit</button>}/>
      <SettingsRow theme={theme} label="Maximální paralelní stahování"
        control={<TextField theme={theme} value="3" width={60} mono/>} last/>
    </SettingsGroup>
  );
}
function IndexersSettings({ theme }){
  return (
    <SettingsGroup theme={theme} title="Indexery" sub="Zdroje pro vyhledávání nových epizod">
      <SettingsRow theme={theme} label="NyaaSi" sub="aktivní · 12 ms" control={<StatusPill theme={theme} color={theme.statusDone} label="OK" size="sm"/>}/>
      <SettingsRow theme={theme} label="AnimeTosho" sub="aktivní · 38 ms" control={<StatusPill theme={theme} color={theme.statusDone} label="OK" size="sm"/>}/>
      <SettingsRow theme={theme} label="BakaBT" sub="neaktivní · vyžaduje cookie" control={<StatusPill theme={theme} color={theme.statusUpcoming} label="Pozor" size="sm"/>}/>
      <SettingsRow theme={theme} label="+ Přidat indexer" control={<button style={btnSub(theme)}>Konfigurovat</button>} last/>
    </SettingsGroup>
  );
}
function NotifSettings({ theme }){
  const [a, setA] = React.useState(true);
  const [b, setB] = React.useState(false);
  const [c, setC] = React.useState(true);
  return (
    <SettingsGroup theme={theme} title="Notifikace" sub="Co se má hlásit a kam">
      <SettingsRow theme={theme} label="Discord webhook" sub="hotové stahování, chybějící titulky"
        control={<Toggle theme={theme} on={a} onChange={setA}/>}/>
      <SettingsRow theme={theme} label="E-mail" sub="souhrn 1× denně"
        control={<Toggle theme={theme} on={b} onChange={setB}/>}/>
      <SettingsRow theme={theme} label="Push (mobil)" control={<Toggle theme={theme} on={c} onChange={setC}/>} last/>
    </SettingsGroup>
  );
}
function AppearSettings({ theme }){
  return (
    <SettingsGroup theme={theme} title="Vzhled" sub="Téma, hustota a další jemnosti">
      <SettingsRow theme={theme} label="Téma" control={<Select theme={theme} value="Tmavé (auto)" options={['Tmavé','Světlé','Tmavé (auto)']}/>}/>
      <SettingsRow theme={theme} label="Akcentová barva" control={
        <div style={{display:'flex',gap:6}}>
          {['#a78bfa','#ec4899','#22d3ee','#fb923c','#34d399'].map(c=>(
            <button key={c} style={{width:22,height:22,borderRadius:99,background:c,
              border:c==='#a78bfa'?`2px solid ${theme.text}`:`1px solid ${theme.border}`,cursor:'pointer'}}/>
          ))}
        </div>
      }/>
      <SettingsRow theme={theme} label="Hustota UI" control={<Select theme={theme} value="Pohodlná" options={['Kompaktní','Pohodlná','Vzdušná']}/>} last/>
    </SettingsGroup>
  );
}
function AboutSettings({ theme }){
  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <div style={{display:'flex',alignItems:'center',gap:14}}>
        <div style={{width:56,height:56,borderRadius:14,
          background:`linear-gradient(135deg,${theme.accent},${theme.accent2})`,
          display:'grid',placeItems:'center'}}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="18" x2="12" y2="21"/>
          </svg>
        </div>
        <div>
          <div style={{font:'700 22px "Space Grotesk"',color:theme.text}}>Animsubarr</div>
          <div style={{font:'500 12px JetBrains Mono',color:theme.textDim,marginTop:4}}>verze 0.4.2 · build 2026-05-18</div>
        </div>
      </div>
      <div style={{font:'500 13px/1.6 "Space Grotesk"',color:theme.textDim,maxWidth:540}}>
        Anime knihovna a editor titulků v jednom. Stahuje nové epizody, automaticky generuje
        a kontroluje titulky pomocí AI, drží přehled o tom, co sleduješ. Backend napojený přes
        otevřené API — všechna data zůstávají u tebe.
      </div>
      <div style={{display:'flex',gap:8}}>
        <button style={btnSub(theme)}>Dokumentace</button>
        <button style={btnSub(theme)}>GitHub</button>
        <button style={btnSub(theme)}>Diagnostika</button>
      </div>
    </div>
  );
}

window.RequestsPage = RequestsPage;
window.FilesPage = FilesPage;
window.SettingsPage = SettingsPage;
