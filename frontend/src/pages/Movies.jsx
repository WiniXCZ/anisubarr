// Movies.jsx — záložka Filmy: každý soubor filmu a co v něm doopravdy je
// (rozlišení, HDR, zvukové stopy s jazykem a kanály, titulky) + ověření přehratelnosti.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMovieFiles, getMovieScanStatus, startMovieScan, rescanMovieFile } from '../api/client';
import { THEME, btnGhost, btnPrimary, btnSub, PageHeader, StatCard, FilterPill } from '../v1design';
import { useIsMobile } from '../hooks/useIsMobile';
import { useT } from '../i18n/I18nContext';

const T = THEME;
const LANG_NAMES = { cs: 'CZ', sk: 'SK', en: 'EN', ja: 'JA', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', ru: 'RU', pl: 'PL', hu: 'HU', und: '?' };
const RES_ORDER = { '4K': 4, '1080p': 3, '720p': 2, 'SD': 1, '?': 0 };

function fmtBytes(b) {
  if (!b) return '—';
  const gb = b / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`;
}
function fmtDur(s) {
  if (!s) return '—';
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
const langName = (l) => LANG_NAMES[l] || (l || '?').toUpperCase();
const czDub = (m) => m.audio.filter(a => a.lang === 'cs');
const bestCzChannels = (m) => Math.max(0, ...czDub(m).map(a => a.channels || 0));
const hasCzSubs = (m) => m.subs.some(s => s.lang === 'cs');

function Chip({ children, color, strong, title }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 6,
      font: '600 11px "JetBrains Mono"', whiteSpace: 'nowrap',
      color: strong ? '#fff' : (color || T.textDim),
      background: strong ? (color || T.accent) : T.panel2,
      border: `1px solid ${strong ? 'transparent' : T.border}`,
    }}>{children}</span>
  );
}

function AudioCell({ audio, t }) {
  if (!audio.length) return <span style={{ color: T.statusEnded, font: '500 12px "Space Grotesk"' }}>{t('movies_no_audio')}</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {audio.map((a, i) => (
        <Chip key={i} strong={a.lang === 'cs'} color={a.lang === 'cs' ? T.statusDone : undefined}
          title={[a.codec?.toUpperCase(), a.title, a.default ? t('movies_default') : ''].filter(Boolean).join(' · ')}>
          {langName(a.lang)} {a.layout}{a.atmos ? ' Atmos' : ''}
        </Chip>
      ))}
    </div>
  );
}

function SubsCell({ subs }) {
  if (!subs.length) return <span style={{ color: T.textMute }}>—</span>;
  const seen = new Map();
  subs.forEach(s => {
    const k = `${s.lang}${s.forced ? 'F' : ''}`;
    const prev = seen.get(k) || { ...s, ext: false, emb: false };
    if (s.external) prev.ext = true; else prev.emb = true;
    seen.set(k, prev);
  });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {[...seen.values()].map((s, i) => (
        <Chip key={i} color={s.lang === 'cs' ? T.accent2 : undefined}
          title={[s.ext ? 'externí soubor' : '', s.emb ? 'vložené v souboru' : '', s.forced ? 'forced' : ''].filter(Boolean).join(' · ')}>
          {langName(s.lang)}{s.forced ? ' F' : ''}{s.ext ? ' ext' : ''}
        </Chip>
      ))}
    </div>
  );
}

function VerifyCell({ m, t }) {
  const meta = {
    ok:    { c: T.statusDone,     l: t('movies_verify_ok') },
    warn:  { c: T.statusUpcoming, l: t('movies_verify_warn') },
    error: { c: T.statusEnded,    l: t('movies_verify_error') },
  }[m.verify_status] || { c: T.textMute, l: t('movies_verify_none') };
  const msg = m.probe_error && !m.verify_status ? m.probe_error : m.verify_msg;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 260 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 12px "Space Grotesk"', color: meta.c }}>
        <span style={{ width: 7, height: 7, borderRadius: 9, background: meta.c }} />{m.probe_error && !m.verify_status ? t('movies_probe_error') : meta.l}
      </span>
      {msg && m.verify_status !== 'ok' && <span style={{ font: '500 11px "Space Grotesk"', color: T.textDim, lineHeight: 1.35 }}>{msg}</span>}
    </div>
  );
}

const COLS = [
  { key: 'title',  label: 'movies_col_title',  sort: (m) => `${m.title || ''} ${m.year || ''}`.toLowerCase() },
  { key: 'video',  label: 'movies_col_video',  sort: (m) => (RES_ORDER[m.resolution] || 0) * 10 + (m.hdr && m.hdr !== 'SDR' ? 1 : 0) },
  { key: 'size',   label: 'movies_col_size',   sort: (m) => m.size || 0 },
  { key: 'dur',    label: 'movies_col_duration', sort: (m) => m.duration || 0 },
  { key: 'audio',  label: 'movies_col_audio',  sort: (m) => bestCzChannels(m) * 100 + m.audio.length },
  { key: 'subs',   label: 'movies_col_subs',   sort: (m) => (hasCzSubs(m) ? 100 : 0) + m.subs.length },
  { key: 'verify', label: 'movies_col_verify', sort: (m) => ({ error: 3, warn: 2, ok: 0 }[m.verify_status] ?? 1) },
];

export default function Movies() {
  const t = useT();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [res, setRes] = useState('all');
  const [lang, setLang] = useState('all');
  const [ver, setVer] = useState('all');
  const [sort, setSort] = useState({ key: 'title', dir: 1 });
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  const status = useQuery({
    queryKey: ['movie-scan-status'],
    queryFn: () => getMovieScanStatus().then(r => r.data),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs || {};
      return Object.values(jobs).some(j => j.running) ? 3000 : 30000;
    },
  });
  const running = Object.values(status.data?.jobs || {}).find(j => j.running);
  const list = useQuery({
    queryKey: ['movie-files'],
    queryFn: () => getMovieFiles().then(r => r.data),
    refetchInterval: running ? 15000 : false,
  });
  const movies = list.data || [];

  const stats = useMemo(() => ({
    total: movies.length,
    uhd: movies.filter(m => m.resolution === '4K').length,
    cz51: movies.filter(m => bestCzChannels(m) >= 6).length,
    noCz: movies.filter(m => !czDub(m).length && !hasCzSubs(m)).length,
    bad: movies.filter(m => m.verify_status === 'error' || (m.probe_error && !m.verify_status)).length,
    unverified: movies.filter(m => !m.verify_status).length,
  }), [movies]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const col = COLS.find(c => c.key === sort.key) || COLS[0];
    return movies
      .filter(m => !needle || `${m.title} ${m.year} ${m.file}`.toLowerCase().includes(needle))
      .filter(m => res === 'all' || m.resolution === res)
      .filter(m => {
        if (lang === 'all') return true;
        const ch = bestCzChannels(m);
        if (lang === 'czdub') return ch > 0;
        if (lang === 'cz51') return ch >= 6;
        if (lang === 'czstereo') return ch > 0 && ch < 6;
        if (lang === 'nodub') return ch === 0;
        if (lang === 'nocz') return ch === 0 && !hasCzSubs(m);
        return true;
      })
      .filter(m => ver === 'all' || (ver === 'none' ? !m.verify_status : ver === 'error'
        ? (m.verify_status === 'error' || (m.probe_error && !m.verify_status)) : m.verify_status === ver))
      .sort((a, b) => {
        const x = col.sort(a), y = col.sort(b);
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      });
  }, [movies, q, res, lang, ver, sort]);

  const scan = async (verify) => {
    setErr('');
    try {
      await startMovieScan(verify);
      setTimeout(() => qc.invalidateQueries(['movie-scan-status']), 800);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    }
  };
  const rescan = async (id) => {
    setBusyId(id); setErr('');
    try {
      const r = await rescanMovieFile(id, true);
      qc.setQueryData(['movie-files'], (old) => (old || []).map(m => (m.id === id ? r.data : m)));
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusyId(null); }
  };

  const th = (c) => (
    <th key={c.key} onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? -s.dir : (c.key === 'title' ? 1 : -1) }))}
      style={{ textAlign: 'left', padding: '9px 10px', font: '600 11px "Space Grotesk"', color: T.textMute,
        letterSpacing: '.04em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap',
        position: 'sticky', top: 0, background: T.panel, borderBottom: `1px solid ${T.borderStrong}`, zIndex: 1 }}>
      {t(c.label)}{sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const select = (value, onChange, opts) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: T.panel2, color: T.text, border: `1px solid ${T.border}`, borderRadius: 7,
      padding: '6px 8px', font: '500 12px "Space Grotesk"' }}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PageHeader theme={T} title={t('nav_movies')}
        subtitle={running ? running.message || t('movies_scanning') : `${stats.total} ${t('movies_files')} · ${status.data?.roots?.join(', ') || ''}`}
        right={
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button style={btnSub(T)} disabled={!!running} onClick={() => scan(false)} title={t('movies_scan_hint')}>
              {running ? t('movies_scanning') : t('movies_scan')}
            </button>
            <button style={{ ...btnPrimary(T), opacity: running ? 0.5 : 1 }} disabled={!!running} onClick={() => scan(true)} title={t('movies_verify_hint')}>
              {t('movies_scan_verify')}
            </button>
          </div>
        } />

      <div style={{ padding: isMobile ? 12 : '16px 24px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StatCard theme={T} label={t('movies_stat_total')} value={stats.total} />
          <StatCard theme={T} label="4K" value={stats.uhd} accent={T.accent2} />
          <StatCard theme={T} label={t('movies_stat_cz51')} value={stats.cz51} accent={T.statusDone} />
          <StatCard theme={T} label={t('movies_stat_nocz')} value={stats.noCz} accent={T.statusUpcoming} />
          <StatCard theme={T} label={t('movies_stat_bad')} value={stats.bad} sub={`${stats.unverified} ${t('movies_unverified')}`} accent={T.statusEnded} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('movies_search')} style={{
            flex: isMobile ? '1 1 100%' : '0 1 260px', background: T.panel2, color: T.text,
            border: `1px solid ${T.border}`, borderRadius: 7, padding: '7px 10px', font: '500 13px "Space Grotesk"' }} />
          {['all', '4K', '1080p', '720p', 'SD'].map(r => (
            <FilterPill key={r} theme={T} label={r === 'all' ? t('movies_all') : r} active={res === r} onClick={() => setRes(r)} />
          ))}
          {select(lang, setLang, [['all', t('movies_lang_all')], ['czdub', t('movies_lang_czdub')], ['cz51', t('movies_lang_cz51')],
            ['czstereo', t('movies_lang_czstereo')], ['nodub', t('movies_lang_nodub')], ['nocz', t('movies_lang_nocz')]])}
          {select(ver, setVer, [['all', t('movies_ver_all')], ['error', t('movies_verify_error')], ['warn', t('movies_verify_warn')],
            ['none', t('movies_verify_none')], ['ok', t('movies_verify_ok')]])}
          <span style={{ font: '500 12px "JetBrains Mono"', color: T.textMute, marginLeft: 'auto' }}>{rows.length} / {movies.length}</span>
        </div>
        {err && <div style={{ color: T.statusEnded, font: '500 12px "Space Grotesk"' }}>{err}</div>}

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: `1px solid ${T.border}`, borderRadius: 10, background: T.panel }}>
          {list.isLoading ? (
            <div style={{ padding: 24, color: T.textDim }}>{t('movies_loading')}</div>
          ) : !movies.length ? (
            <div style={{ padding: 24, color: T.textDim, font: '500 13px "Space Grotesk"' }}>{t('movies_empty')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead><tr>{COLS.map(th)}<th style={{ position: 'sticky', top: 0, background: T.panel, borderBottom: `1px solid ${T.borderStrong}` }} /></tr></thead>
              <tbody>
                {rows.map(m => (
                  <tr key={m.id} style={{ borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }}>
                    <td style={{ padding: '9px 10px', minWidth: 200 }}>
                      <div style={{ font: '600 13px "Space Grotesk"', color: T.text }}>{m.title}{m.year ? <span style={{ color: T.textMute, fontWeight: 500 }}> ({m.year})</span> : null}</div>
                      <div title={m.path} style={{ font: '500 10.5px "JetBrains Mono"', color: T.textMute, marginTop: 3, wordBreak: 'break-all' }}>{m.file}</div>
                    </td>
                    <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Chip strong={m.resolution === '4K'} color={m.resolution === '4K' ? T.accent : undefined}>{m.resolution || '?'}</Chip>
                        {m.hdr && m.hdr !== 'SDR' && <Chip color={T.accent3}>{m.hdr}</Chip>}
                      </div>
                      <div style={{ font: '500 11px "JetBrains Mono"', color: T.textMute, marginTop: 4 }}>
                        {(m.video_codec || '').toUpperCase()} {m.width ? `${m.width}×${m.height}` : ''}{m.bitrate ? ` · ${(m.bitrate / 1000).toFixed(1)} Mb/s` : ''}
                      </div>
                    </td>
                    <td style={{ padding: '9px 10px', font: '500 12px "JetBrains Mono"', color: T.textDim, whiteSpace: 'nowrap' }}>{fmtBytes(m.size)}</td>
                    <td style={{ padding: '9px 10px', font: '500 12px "JetBrains Mono"', color: T.textDim }}>{fmtDur(m.duration)}</td>
                    <td style={{ padding: '9px 10px', maxWidth: 280 }}><AudioCell audio={m.audio} t={t} /></td>
                    <td style={{ padding: '9px 10px', maxWidth: 200 }}><SubsCell subs={m.subs} /></td>
                    <td style={{ padding: '9px 10px' }}><VerifyCell m={m} t={t} /></td>
                    <td style={{ padding: '9px 10px' }}>
                      <button style={btnGhost(T)} disabled={busyId === m.id} onClick={() => rescan(m.id)} title={t('movies_rescan_hint')}>
                        {busyId === m.id ? '…' : '⟳'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
