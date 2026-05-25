// app.jsx — Anisubarr canvas wrapper

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": true,
  "accent": "#a78bfa",
  "showWaveform": true,
  "density": "regular"
}/*EDITMODE-END*/;

function App(){
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const base = t.dark ? THEME.dark : THEME.light;

  // Allow Tweaks to override accent (everything else stays per-theme)
  const theme = React.useMemo(()=>({
    ...base,
    accent: t.accent || base.accent,
    accentSoft: hexToSoft(t.accent || base.accent, 0.18),
    waveActive: t.accent || base.accent,
  }),[base, t.accent]);

  // Set background of the canvas to match theme for letterboxing
  React.useEffect(()=>{
    document.body.style.background = t.dark ? '#0a0d18' : '#e0e4ed';
  },[t.dark]);

  return (
    <>
      <DesignCanvas>
        <DCSection id="anisubarr-full" title="Animsubarr · plná appka"
          subtitle="Kompletní GUI se všemi taby — klikni v top navigaci pro přepnutí (Knihovna ▸ Harmonogram ▸ Kalendář ▸ Žádosti ▸ Soubory ▸ Nastavení ▸ Titulky). Klikni na poster v knihovně pro otevření editoru titulků.">
          <DCArtboard id="full" label="★ Animsubarr · plná appka" width={1600} height={1000}>
            <FullApp theme={theme}/>
          </DCArtboard>
        </DCSection>

        <DCSection id="anisubarr-layouts" title="Editor titulků · 3 layouty"
          subtitle="Varianty interního editoru titulků pro porovnání. Varianta A (Studio) je výchozí ve FullApp.">
          <DCArtboard id="studio" label="A · Studio — klasika (video + tabulka) ★" width={1500} height={920}>
            <VariantStudio theme={theme}/>
          </DCArtboard>
          <DCArtboard id="reel" label="B · Reel — časová osa výrazně" width={1500} height={920}>
            <VariantReel theme={theme}/>
          </DCArtboard>
          <DCArtboard id="bilingual" label="C · Bilingual — překladačský fokus" width={1500} height={920}>
            <VariantBilingual theme={theme}/>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Nastavení · Anisubarr">
        <TweakSection label="Téma"/>
        <TweakToggle label="Tmavý režim" value={t.dark}
          onChange={(v)=>setTweak('dark', v)}/>
        <TweakColor label="Akcent" value={t.accent}
          options={['#a78bfa','#ec4899','#22d3ee','#fb923c','#34d399']}
          onChange={(v)=>setTweak('accent', v)}/>
      </TweaksPanel>
    </>
  );
}

// Quick "alpha tint" helper for accent overrides
function hexToSoft(hex, a){
  const h = hex.replace('#','');
  const n = parseInt(h.length===3 ? h.split('').map(c=>c+c).join('') : h, 16);
  const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  return `rgba(${r},${g},${b},${a})`;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
