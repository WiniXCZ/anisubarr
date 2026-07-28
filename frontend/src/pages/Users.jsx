/**
 * Users — read-only list of the people who exist on the connected services
 * (Seerr, Emby/Jellyfin). Accounts are managed in those apps; this is just a
 * roster so you can see who requests media and who watches it in one place.
 *
 * Anisubarr's own login accounts stay in Nastavení → Uživatelé.
 */
import { useQuery } from '@tanstack/react-query';
import { getServiceUsers } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { THEME as T, PageHeader, StatusPill } from '../v1design';

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
  const color = SOURCE_COLOR[(user.sources || [])[0]] || T.textMute;
  if (user.avatar) {
    return (
      <img src={user.avatar} alt="" loading="lazy"
        style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover',
                 flexShrink: 0, border: `1px solid ${T.border}` }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }} />
    );
  }
  return (
    <div style={{
      width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
      display: 'grid', placeItems: 'center', background: T.panel2,
      border: `1px solid ${T.border}`, color, font: '600 14px "Space Grotesk"',
    }}>{initials(user.name)}</div>
  );
}

function UserRow({ user }) {
  const t = useT();
  const seen = formatSeen(user.last_seen, t);
  const meta = [
    user.email,
    user.requests != null ? t('su_requests').replace('{n}', user.requests) : null,
    seen ? `${t('su_last_seen')} ${seen}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 14px', background: T.panel,
      border: `1px solid ${T.border}`, borderRadius: 10,
      opacity: user.disabled ? 0.55 : 1,
    }}>
      <Avatar user={user}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ font: '600 14px "Space Grotesk"', color: T.text }}>{user.name}</span>
          {user.is_admin && <StatusPill theme={T} color={T.accent} label={t('su_admin')} size="sm"/>}
          {user.disabled && <StatusPill theme={T} color={T.textMute} label={t('su_disabled')} size="sm"/>}
        </div>
        <div style={{
          font: '400 11px "JetBrains Mono", monospace', color: T.textMute, marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{meta || '—'}</div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap',
                    justifyContent: 'flex-end' }}>
        {(user.sources || []).map(src => (
          <span key={src} style={{
            font: '600 10px "Space Grotesk"',
            color: SOURCE_COLOR[src] || T.textMute,
            background: T.panel2, border: `1px solid ${T.border}`,
            padding: '3px 9px', borderRadius: 99, whiteSpace: 'nowrap',
          }}>{SOURCE_LABEL[src] || src}</span>
        ))}
      </div>
    </div>
  );
}

export default function Users() {
  const t = useT();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['service-users'],
    queryFn: () => getServiceUsers().then(r => r.data ?? r),
    staleTime: 60_000,
    retry: 1,
  });

  const users = data?.users ?? [];
  const sources = data?.sources ?? {};

  // A service that simply isn't set up is not a problem worth reporting.
  const problems = Object.entries(sources)
    .filter(([, s]) => !s.ok && s.reason !== 'not_configured')
    .map(([name, s]) => `${SOURCE_LABEL[name] || name}: ${s.reason}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageHeader theme={T} title={t('nav_users')} subtitle={t('su_subtitle')}
        right={users.length ? (
          <span style={{ font: '500 12px "JetBrains Mono"', color: T.textMute }}>
            {t('su_count').replace('{n}', users.length)}
          </span>
        ) : null}/>

      <div style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        padding: '16px 24px 32px', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {problems.map(p => (
          <div key={p} style={{
            padding: '9px 13px', borderRadius: 9, background: T.panel2,
            border: `1px solid ${T.border}`, color: T.textDim,
            font: '500 12px "Space Grotesk"',
          }}>⚠ {p}</div>
        ))}

        {isLoading && (
          <div style={{ padding: 26, textAlign: 'center', color: T.textMute,
                        font: '400 13px "Space Grotesk"' }}>{t('su_loading')}</div>
        )}

        {!isLoading && (isError || users.length === 0) && (
          <div style={{
            padding: 26, textAlign: 'center', color: T.textMute,
            background: T.panel, border: `1px dashed ${T.border}`, borderRadius: 10,
            font: '400 13px "Space Grotesk"',
          }}>{t('su_empty')}</div>
        )}

        {users.map(u => <UserRow key={`${u.name}-${(u.sources || []).join('+')}`} user={u}/>)}
      </div>
    </div>
  );
}
