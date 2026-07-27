import { useQuery } from '@tanstack/react-query';
import { getServiceUsers } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { THEME as T, StatusPill } from '../v1design';

// Read-only view of who exists in Seerr and Emby. Accounts are managed in those
// apps — this is just so an admin can see them without opening two more UIs.
const SOURCE_LABEL = { seerr: 'Seerr', emby: 'Emby / Jellyfin' };
const SOURCE_COLOR = { seerr: T.accent, emby: T.accent2 };

function initials(name) {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

function formatSeen(value, t) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return t('su_seen_today');
  if (days === 1) return t('su_seen_yesterday');
  if (days < 30) return t('su_seen_days').replace('{n}', days);
  return d.toLocaleDateString();
}

function Avatar({ user }) {
  const color = SOURCE_COLOR[user.source] || T.textMute;
  if (user.avatar) {
    return (
      <img src={user.avatar} alt="" loading="lazy"
        style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover',
                 flexShrink: 0, border: `1px solid ${T.border}` }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }} />
    );
  }
  return (
    <div style={{
      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
      display: 'grid', placeItems: 'center', background: T.panel2,
      border: `1px solid ${T.border}`, color,
      font: '600 13px "Space Grotesk"',
    }}>{initials(user.name)}</div>
  );
}

export default function ServiceUsersList() {
  const t = useT();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['service-users'],
    queryFn: () => getServiceUsers().then(r => r.data ?? r),
    staleTime: 60_000,
    retry: 1,
  });

  const users = data?.users ?? [];
  const sources = data?.sources ?? {};

  // A service that's simply not set up isn't an error worth shouting about.
  const problems = Object.entries(sources)
    .filter(([, s]) => !s.ok && s.reason !== 'not_configured')
    .map(([name, s]) => `${SOURCE_LABEL[name] || name}: ${s.reason}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ font: '700 15px "Space Grotesk"', color: T.text }}>{t('su_title')}</div>
        <div style={{ font: '400 12px "Space Grotesk"', color: T.textDim, marginTop: 2 }}>
          {t('su_subtitle')}
        </div>
      </div>

      {problems.map(p => (
        <div key={p} style={{
          padding: '8px 12px', borderRadius: 8, background: T.panel2,
          border: `1px solid ${T.border}`, color: T.textDim,
          font: '500 12px "Space Grotesk"',
        }}>⚠ {p}</div>
      ))}

      <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {isLoading && (
          <div style={{ padding: 18, textAlign: 'center', color: T.textMute, font: '400 13px "Space Grotesk"' }}>
            {t('su_loading')}
          </div>
        )}
        {!isLoading && (isError || users.length === 0) && (
          <div style={{ padding: 18, textAlign: 'center', color: T.textMute, font: '400 13px "Space Grotesk"' }}>
            {t('su_empty')}
          </div>
        )}
        {users.map(u => {
          const seen = formatSeen(u.last_seen, t);
          return (
            <div key={`${u.source}-${u.id}`} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderBottom: `1px solid ${T.border}`,
              opacity: u.disabled ? 0.5 : 1,
            }}>
              <Avatar user={u}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ font: '600 13px "Space Grotesk"', color: T.text }}>{u.name}</span>
                  {u.is_admin && <StatusPill theme={T} color={T.accent} label={t('su_admin')} size="sm"/>}
                  {u.disabled && <StatusPill theme={T} color={T.textMute} label={t('su_disabled')} size="sm"/>}
                </div>
                <div style={{ font: '400 11px "JetBrains Mono", monospace', color: T.textMute,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[u.email,
                    u.requests != null ? t('su_requests').replace('{n}', u.requests) : null,
                    seen ? `${t('su_last_seen')} ${seen}` : null,
                  ].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <span style={{
                flexShrink: 0, font: '600 10px "Space Grotesk"',
                color: SOURCE_COLOR[u.source] || T.textMute,
                background: T.panel2, border: `1px solid ${T.border}`,
                padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap',
              }}>{SOURCE_LABEL[u.source] || u.source}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
