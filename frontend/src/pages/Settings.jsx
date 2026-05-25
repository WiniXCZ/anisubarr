import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUsers, createUser, deleteUser, getApiKeys, createApiKey, deleteApiKey,
  overseerrStatus, embyStatus, sonarrHealth, smbTest,
} from '../api/client';
import api from '../api/client';
import { useToast } from '../context/ToastContext';
import {
  THEME, btnGhost, btnPrimary, btnSub,
  PageHeader, StatusPill, SettingsGroup, SettingsRow, Toggle, TextField, SelectField,
} from '../v1design';

const T = THEME;

const SECTIONS = [
  { id:'profile',   label:'Profil',         icon:'👤' },
  { id:'library',   label:'Knihovna',       icon:'⊞' },
  { id:'downloads', label:'Stahovače',      icon:'↓' },
  { id:'indexers',  label:'Indexery',       icon:'⌕' },
  { id:'subs',      label:'Titulky & AI',   icon:'✦' },
  { id:'users',     label:'Uživatelé',      icon:'⊕' },
  { id:'apikeys',   label:'API klíče',      icon:'⌧' },
  { id:'about',     label:'O aplikaci',     icon:'ⓘ' },
];

function SubsAISection() {
  const [t1, setT1] = useState(true);
  const [t2, setT2] = useState(true);
  const [t3, setT3] = useState(false);
  const [model, setModel] = useState('claude-haiku-4-5');
  const [targetLang, setTargetLang] = useState('cs');

  return (<>
    <SettingsGroup theme={T} title="AI překlad" sub="Jak Anisubarr používá Claude pro překlad titulků">
      <SettingsRow theme={T} label="AI poskytovatel" sub="model pro generování překladu"
        control={<SelectField theme={T} value={model} onChange={setModel}
          options={[
            {value:'claude-haiku-4-5', label:'Claude haiku-4.5'},
            {value:'claude-sonnet-4-5', label:'Claude sonnet-4.5'},
          ]}/>}/>
      <SettingsRow theme={T} label="Cílový jazyk" sub="kam Anisubarr překládá"
        control={<SelectField theme={T} value={targetLang} onChange={setTargetLang}
          options={[
            {value:'cs', label:'Čeština (cs)'},
            {value:'sk', label:'Slovenština (sk)'},
            {value:'en', label:'Angličtina (en)'},
          ]}/>}/>
      <SettingsRow theme={T} label="Auto-překlad nových epizod" sub="po dokončení stahování spustit překlad"
        control={<Toggle theme={T} on={t1} onChange={setT1}/>}/>
      <SettingsRow theme={T} label="Zachovat honorifika" sub="-san, -kun, -chan, sensei…"
        control={<Toggle theme={T} on={t2} onChange={setT2}/>} last/>
    </SettingsGroup>

    <SettingsGroup theme={T} title="Časování" sub="Limity a pravidla pro auto-úpravy">
      <SettingsRow theme={T} label="Auto-snap na shot change" sub="přichytit start/end k detekovaným střihům"
        control={<Toggle theme={T} on={t3} onChange={setT3}/>} last/>
    </SettingsGroup>
  </>);
}

function ProfileSection() {
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me').then(r => r.data),
  });

  return (
    <SettingsGroup theme={T} title="Profil" sub="Tvůj účet a předvolby">
      <SettingsRow theme={T} label="Uživatelské jméno"
        control={<span style={{font:'600 13px JetBrains Mono',color:T.text}}>{me?.username || '—'}</span>}/>
      <SettingsRow theme={T} label="Role"
        control={<StatusPill theme={T} color={T.accent} label={me?.is_admin ? 'Admin' : 'Uživatel'} size="sm"/>}
        last/>
    </SettingsGroup>
  );
}

function LibrarySection() {
  const { data: cfg = {} } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  });
  const [rootFolder, setRootFolder] = useState('');

  return (
    <SettingsGroup theme={T} title="Knihovna" sub="Kořenové složky a pravidla pojmenování">
      <SettingsRow theme={T} label="Kořenová složka"
        control={<TextField theme={T} value={cfg.library_path || rootFolder} onChange={setRootFolder} width={300} mono placeholder="/srv/media/anime"/>}/>
      <SettingsRow theme={T} label="Preferovaná kvalita"
        control={<SelectField theme={T} value={cfg.preferred_quality || '1080p'}
          options={['480p','720p','1080p','2160p (4K)']}/>} last/>
    </SettingsGroup>
  );
}

function ConnectionsSection() {
  const { data: sonarr } = useQuery({
    queryKey: ['sonarr-health'],
    queryFn: () => sonarrHealth().then(r => r.data),
  });
  const { data: overseerr } = useQuery({
    queryKey: ['overseerr-status'],
    queryFn: () => overseerrStatus().then(r => r.data),
  });
  const { data: emby } = useQuery({
    queryKey: ['emby-status'],
    queryFn: () => embyStatus().then(r => r.data),
  });

  return (
    <SettingsGroup theme={T} title="Připojení" sub="Stav externích služeb">
      <SettingsRow theme={T} label="Sonarr"
        control={<StatusPill theme={T}
          color={sonarr?.ok ? T.statusDone : T.statusEnded}
          label={sonarr?.ok ? 'Připojeno' : 'Nepřipojeno'} size="sm"/>}/>
      <SettingsRow theme={T} label="Overseerr"
        control={<StatusPill theme={T}
          color={overseerr?.status === 'ok' ? T.statusDone : T.statusEnded}
          label={overseerr?.status === 'ok' ? 'Připojeno' : 'Nepřipojeno'} size="sm"/>}/>
      <SettingsRow theme={T} label="Emby"
        control={<StatusPill theme={T}
          color={emby?.ok ? T.statusDone : T.textMute}
          label={emby?.ok ? 'Připojeno' : 'Nepřipojeno'} size="sm"/>} last/>
    </SettingsGroup>
  );
}

function UsersSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const [newUser, setNewUser] = useState({ username: '', password: '', email: '' });
  const [showForm, setShowForm] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data) => createUser(data),
    onSuccess: () => { qc.invalidateQueries(['users']); setShowForm(false); setNewUser({ username:'', password:'', email:'' }); toast.success('Uživatel vytvořen'); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteUser(id),
    onSuccess: () => qc.invalidateQueries(['users']),
  });

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <SettingsGroup theme={T} title="Uživatelé" sub="Správa přístupu">
        {users.map((u, i) => (
          <SettingsRow key={u.id} theme={T} last={i === users.length-1 && !showForm}
            label={u.username}
            sub={u.email || ''}
            control={
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <StatusPill theme={T} color={u.is_admin ? T.accent : T.textDim}
                  label={u.is_admin ? 'Admin' : 'Uživatel'} size="sm"/>
                <button onClick={() => deleteMutation.mutate(u.id)}
                  style={{...btnGhost(T),padding:'4px 8px',fontSize:11,color:T.statusEnded}}>✕</button>
              </div>
            }/>
        ))}
        {!showForm && (
          <SettingsRow theme={T} last label="Přidat uživatele"
            control={<button onClick={() => setShowForm(true)} style={btnSub(T)}>+ Přidat</button>}/>
        )}
      </SettingsGroup>
      {showForm && (
        <SettingsGroup theme={T} title="Nový uživatel" sub="">
          <SettingsRow theme={T} label="Jméno"
            control={<TextField theme={T} value={newUser.username} onChange={v => setNewUser(p => ({...p, username:v}))} placeholder="username"/>}/>
          <SettingsRow theme={T} label="Heslo"
            control={<TextField theme={T} value={newUser.password} onChange={v => setNewUser(p => ({...p, password:v}))} placeholder="heslo"/>}/>
          <SettingsRow theme={T} label="E-mail"
            control={<TextField theme={T} value={newUser.email} onChange={v => setNewUser(p => ({...p, email:v}))} width={240} placeholder="email@example.com"/>} last/>
          <div style={{display:'flex',gap:8,padding:'12px 16px'}}>
            <button onClick={() => setShowForm(false)} style={btnGhost(T)}>Zrušit</button>
            <button onClick={() => createMutation.mutate(newUser)} style={btnPrimary(T)}>Vytvořit</button>
          </div>
        </SettingsGroup>
      )}
    </div>
  );
}

function ApiKeysSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newKey, setNewKey] = useState(null);

  const { data: keys = [] } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => getApiKeys().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (n) => createApiKey(n),
    onSuccess: (r) => { qc.invalidateQueries(['api-keys']); setNewKey(r.data?.key || r.data); setName(''); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteApiKey(id),
    onSuccess: () => qc.invalidateQueries(['api-keys']),
  });

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <SettingsGroup theme={T} title="API klíče" sub="Programatický přístup k Anisubarr">
        {keys.map((k, i) => (
          <SettingsRow key={k.id} theme={T} last={i === keys.length-1}
            label={k.name || `Klíč #${k.id}`}
            sub={`Vytvořen: ${k.created_at ? new Date(k.created_at).toLocaleDateString('cs') : '—'}`}
            control={
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{font:'500 11px JetBrains Mono',color:T.textMute,
                  background:T.sunken,padding:'3px 7px',borderRadius:5,border:`1px solid ${T.border}`}}>
                  {k.key_prefix || k.key?.slice(0,12) || '••••••••'}…
                </span>
                <button onClick={() => deleteMutation.mutate(k.id)}
                  style={{...btnGhost(T),padding:'4px 8px',fontSize:11,color:T.statusEnded}}>✕</button>
              </div>
            }/>
        ))}
        {keys.length === 0 && (
          <div style={{padding:'14px 16px',font:'500 12px "Space Grotesk"',color:T.textMute}}>
            Žádné API klíče
          </div>
        )}
      </SettingsGroup>
      {newKey && (
        <div style={{background:T.accentSoft,border:`1px solid ${T.accent}44`,borderRadius:10,padding:'12px 16px'}}>
          <div style={{font:'600 12px "Space Grotesk"',color:T.accent,marginBottom:6}}>Nový API klíč — zkopíruj hned, nezobrazí se znovu</div>
          <div style={{font:'600 13px JetBrains Mono',color:T.text,wordBreak:'break-all'}}>{newKey}</div>
          <button onClick={() => setNewKey(null)} style={{...btnGhost(T),marginTop:8,fontSize:11}}>Zavřít</button>
        </div>
      )}
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Název klíče…"
          style={{padding:'7px 10px',background:T.panel2,color:T.text,border:`1px solid ${T.border}`,
            borderRadius:7,outline:'none',font:'500 12px "Space Grotesk"',flex:1}}/>
        <button onClick={() => createMutation.mutate(name)} style={btnPrimary(T)} disabled={!name.trim()}>
          + Vytvořit klíč
        </button>
      </div>
    </div>
  );
}

function AboutSection() {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <div style={{display:'flex',alignItems:'center',gap:14}}>
        <div style={{width:56,height:56,borderRadius:14,
          background:`linear-gradient(135deg,${T.accent},${T.accent2})`,
          display:'grid',placeItems:'center'}}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="18" x2="12" y2="21"/>
          </svg>
        </div>
        <div>
          <div style={{font:'700 22px "Space Grotesk"',color:T.text}}>Anisubarr</div>
          <div style={{font:'500 12px JetBrains Mono',color:T.textDim,marginTop:4}}>
            verze 0.4.2 · build 2026
          </div>
        </div>
      </div>
      <div style={{font:'500 13px/1.6 "Space Grotesk"',color:T.textDim,maxWidth:540}}>
        Anime knihovna a editor titulků v jednom. Stahuje nové epizody, automaticky generuje
        a kontroluje titulky pomocí AI, drží přehled o tom, co sleduješ.
      </div>
      <div style={{display:'flex',gap:8}}>
        <button style={btnSub(T)}>Dokumentace</button>
        <button style={btnSub(T)}>GitHub</button>
        <button style={btnSub(T)}>Diagnostika</button>
      </div>
    </div>
  );
}

export default function Settings({ theme }) {
  const [sec, setSec] = useState('subs');

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      <PageHeader theme={T} title="Nastavení"
        subtitle="Konfigurace appky, indexerů, klientů a AI překladu"
        right={<button style={btnPrimary(T)}>✓ Uložit změny</button>}
      />

      <div style={{flex:1,display:'flex',minHeight:0}}>
        {/* Sidebar */}
        <div style={{flex:'0 0 240px',borderRight:`1px solid ${T.border}`,
          background:T.panel2,padding:'14px 8px',display:'flex',flexDirection:'column',gap:2}}>
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSec(s.id)} style={{
              display:'flex',alignItems:'center',gap:10,
              padding:'9px 12px',borderRadius:7,border:'none',cursor:'pointer',
              background:sec===s.id ? T.accentSoft : 'transparent',
              color:sec===s.id ? T.accent : T.text,
              font:`${sec===s.id?'600':'500'} 13px "Space Grotesk"`, textAlign:'left',
            }}>
              <span style={{width:16,textAlign:'center'}}>{s.icon}</span>{s.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{flex:1,overflowY:'auto',padding:'22px 28px',display:'flex',flexDirection:'column',gap:22,maxWidth:900}}>
          {sec === 'subs'      && <SubsAISection/>}
          {sec === 'profile'   && <ProfileSection/>}
          {sec === 'library'   && <LibrarySection/>}
          {sec === 'downloads' && <ConnectionsSection/>}
          {sec === 'indexers'  && (
            <SettingsGroup theme={T} title="Indexery" sub="Zdroje pro vyhledávání nových epizod">
              <SettingsRow theme={T} label="NyaaSi"      sub="anime · veřejný"   control={<StatusPill theme={T} color={T.statusDone} label="OK" size="sm"/>}/>
              <SettingsRow theme={T} label="AnimeTosho"  sub="re-encode archív" control={<StatusPill theme={T} color={T.statusDone} label="OK" size="sm"/>}/>
              <SettingsRow theme={T} label="+ Přidat indexer" control={<button style={btnSub(T)}>Konfigurovat</button>} last/>
            </SettingsGroup>
          )}
          {sec === 'users'   && <UsersSection/>}
          {sec === 'apikeys' && <ApiKeysSection/>}
          {sec === 'about'   && <AboutSection/>}
        </div>
      </div>
    </div>
  );
}
