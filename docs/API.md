# Anisubarr API Reference

Base URL: `/api`  
Authentication: Bearer JWT — `Authorization: Bearer <token>`  
All endpoints require authentication unless noted otherwise.

---

## Auth

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/token` | Login (`application/x-www-form-urlencoded`, fields: `username`, `password`) → `{access_token, token_type}` |
| `POST` | `/auth/register` | Register new user `{username, password, email?}` |
| `GET`  | `/auth/me` | Current user info |

---

## Library

Thin wrappers over `/api/series` for the frontend.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/library` | All series (same as `/series`) |
| `GET`  | `/library/stats` | Aggregate counts: `{total, airing, upcoming, finished, cancelled, cs_subs_total, cs_subs_complete}` |
| `GET`  | `/library/{id}` | Single series |
| `GET`  | `/library/{id}/episodes` | Episodes for a series |

---

## Series

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/series` | All series |
| `GET`  | `/series/{id}` | Single series |
| `POST` | `/series/{id}/translate` | Translate synopsis (Ollama/AI) |
| `PATCH`| `/series/{id}/watch-status` | Set watch status `{watch_status}` |
| `PATCH`| `/series/{id}/episodes/{eid}/watched` | Set episode watched `{watched: bool}` |
| `POST` | `/series/refresh-counts` | Refresh subtitle/episode counts from disk |

---

## Subtitle Lines

Parse SRT/ASS files into structured JSON lines for the editor UI.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/episodes/{ep_id}/subs/{lang}` | Get parsed subtitle lines `{lines: [{id, start, end, text}], source_file, lang, ep_id}` |
| `GET`  | `/episodes/{ep_id}/subs/{lang}/file` | Raw subtitle file content |
| `PUT`  | `/episodes/{ep_id}/subs/{lang}` | Save lines back to SRT — body: `{lines: [{id, start, end, text}]}` |

**lang** is a language code, e.g. `cs`, `jp`, `en`.

---

## AI Translate

Translates Japanese subtitle lines to Czech via Claude API or Ollama fallback.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/ai/status` | Provider status: `{provider, model, available}` |
| `POST` | `/ai/translate` | Translate subtitle lines |

### POST `/ai/translate`

Request body:
```json
{
  "lines": [
    {"id": 1, "jp": "見てください！", "en": "Look at this!"}
  ],
  "context": {
    "series_id": 42,
    "series_title": "Neon Genesis Evangelion",
    "tone": "neutral",
    "keep_honorifics": true,
    "glossary": [
      {"src": "使徒", "tgt": "Apoštol"}
    ]
  }
}
```

Response:
```json
{
  "translations": [
    {"id": 1, "cs": "Podívejte se na to!", "alts": ["Pohleďte!", "Koukejte!"]}
  ],
  "model": "claude-haiku-4-5",
  "cached": false
}
```

---

## Requests

Local anime request system (independent of Overseerr).

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/requests` | List requests — optional `?status=pending\|approved\|rejected` |
| `POST` | `/requests` | Create request |
| `PATCH`| `/requests/{id}` | Update request (e.g. change status) |
| `DELETE`| `/requests/{id}` | Delete request |

### Request object fields

| Field | Type | Notes |
|-------|------|-------|
| `series_id` | int? | Link to existing series |
| `custom_title` | str? | Title for requests without a series |
| `custom_jp` | str? | Japanese title |
| `anilist_id` | int? | AniList ID |
| `username` | str | Requestor username |
| `status` | str | `pending` / `approved` / `rejected` |
| `source` | str | `manuální` / `AniList` / `AniDB` / `overseerr` |
| `note` | str? | Free-text note |

---

## Downloads

qBittorrent download queue + recent episode files.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/downloads/queue` | Active download queue from qBittorrent (empty list if not configured) |
| `GET`  | `/downloads/recent` | Recent episode files — `?days=7` |
| `GET`  | `/downloads/stats` | Aggregate stats |

### Queue item fields

`hash`, `name`, `state` (`downloading`/`queued`/`paused`/…), `progress` (0–1), `size_h`, `dlspeed_h`, `eta_h`, `series_title?`

---

## Glossary

Translation glossary for AI subtitle translation.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/glossary` | List entries — filter: `?src_lang=ja&tgt_lang=cs&series_id=42` |
| `POST` | `/glossary` | Create entry |
| `PATCH`| `/glossary/{id}` | Update entry |
| `DELETE`| `/glossary/{id}` | Delete entry |

### Glossary entry fields

| Field | Type | Default |
|-------|------|---------|
| `src_lang` | str | `ja` |
| `tgt_lang` | str | `cs` |
| `src_text` | str | — |
| `tgt_text` | str | — |
| `notes` | str? | — |
| `series_id` | int? | null = global |

---

## Sync

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sync/sonarr` | Sync all series from Sonarr |
| `POST` | `/sync/sonarr/{id}` | Sync single series |
| `GET`  | `/sync/status` | Last sync status |
| `GET`  | `/sync/sonarr/health` | Sonarr connectivity check |
| `GET`  | `/sync/sonarr/tags` | Sonarr tags |
| `GET`  | `/sync/sonarr/root-folders` | Sonarr root folders |
| `PATCH`| `/sync/sonarr/series/{id}/tags` | Update series tags `{tag_ids}` |
| `PATCH`| `/sync/sonarr/series/{id}/root-folder` | Move to root folder `{root_folder_path}` |
| `POST` | `/sync/sonarr/bulk-root-folder` | Bulk move `{series_ids, root_folder_path}` |
| `POST` | `/sync/auto-unmonitor` | Auto-unmonitor completed series |

---

## Subtitles

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/subtitles/search` | Search subtitle providers |
| `POST` | `/subtitles/download` | Download specific subtitle |
| `POST` | `/subtitles/download-best` | Auto-download best match |
| `GET`  | `/subtitles/episode/{ep_id}` | Subtitles for episode |
| `DELETE`| `/subtitles/{id}` | Delete subtitle record |
| `DELETE`| `/subtitles/bulk` | Bulk delete `{subtitle_ids}` |
| `POST` | `/subtitles/download-best-bulk` | Bulk auto-download `{episode_ids}` |
| `POST` | `/subtitles/download-all/{series_id}` | Download all for series |
| `POST` | `/subtitles/download-all-bulk-series` | Bulk download series `{series_ids}` |
| `POST` | `/subtitles/delete-by-series` | Delete subs by series `{series_ids, language?}` |
| `POST` | `/subtitles/delete-by-episodes` | Delete subs by episodes `{episode_ids, language?}` |
| `POST` | `/subtitles/upload` | Upload subtitle file |
| `GET`  | `/subtitles/files/episode/{ep_id}` | Subtitle disk files for episode |
| `POST` | `/subtitles/delete-file` | Delete disk file `{file_path}` |

---

## Subtitle Sync (alass)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/subtitle-sync/episode/{ep_id}` | Sync timing for episode |
| `POST` | `/subtitle-sync/series/{series_id}` | Sync all episodes in series |
| `POST` | `/subtitle-sync/bulk` | Bulk sync `{episode_ids}` |
| `POST` | `/subtitle-sync/bulk-series` | Bulk sync series `{series_ids}` |

---

## Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/settings` | All editable settings (secrets masked) |
| `PUT`  | `/settings` | Save settings — admin only, body: `{key: value, …}` |
| `POST` | `/settings/test/{service}` | Test connection — `service`: `sonarr`, `overseerr`, `emby`, `smb` |

Key fields include: `sonarr_host`, `sonarr_api_key`, `overseerr_host`, `emby_host`, `anthropic_api_key`, `qbittorrent_host`, `ollama_host`, subtitle processing flags, provider priority, etc.

---

## Jobs

Background job tracking.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/jobs` | List recent jobs — `?limit=100` — `{items, running_count}` |
| `POST` | `/jobs/{run_id}/cancel` | Cancel running job |

---

## Schedule / Calendar

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/schedule` | Airing schedule — `?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `GET`  | `/calendar` | Calendar data |

---

## NFO

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/nfo/preview/series/{id}` | Preview series NFO XML |
| `POST` | `/nfo/write/series/{id}` | Write series NFO |
| `POST` | `/nfo/write/series/{id}/all` | Write series + all episode NFOs |
| `POST` | `/nfo/write/episode/{id}` | Write episode NFO |
| `POST` | `/nfo/write/episodes` | Bulk write episode NFOs `{episode_ids}` |
| `POST` | `/nfo/write/all` | Write all NFOs |

---

## Promotion

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/promotion/status` | Promotion readiness overview |
| `POST` | `/promotion/check` | Check all series |
| `POST` | `/promotion/check/{id}` | Check single series |
| `POST` | `/promotion/publish/{id}` | Publish series (move + tag in Sonarr) |
| `POST` | `/promotion/demote/{id}` | Demote series |

---

## Overseerr

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/overseerr/status` | Connection status |
| `GET`  | `/overseerr/requests` | Requests — `?filter=all\|pending\|approved\|available` |
| `POST` | `/overseerr/request/{series_id}` | Create request |
| `DELETE`| `/overseerr/request/{req_id}` | Cancel request |
| `GET`  | `/overseerr/issues` | Issues list |
| `GET`  | `/overseerr/issues/series/{id}` | Issues for series |

---

## Video

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/video/tools` | FFmpeg/FFprobe availability |
| `POST` | `/video/probe` | Probe file `{file_path}` |
| `POST` | `/video/subtitle-tracks` | List subtitle streams `{file_path}` |
| `POST` | `/video/extract` | Extract subtitle track |
| `POST` | `/video/extract-all` | Extract all subs `{file_path, output_dir?}` |
| `POST` | `/video/remove-subtitles` | Remove embedded subs |
| `POST` | `/video/strip-embedded/{ep_id}` | Strip embedded subs for episode |

---

## Emby

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/emby/status` | Emby connectivity check |

---

## Users (admin)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/users/` | List users |
| `POST` | `/users/` | Create user |
| `PATCH`| `/users/{id}` | Update user |
| `DELETE`| `/users/{id}` | Delete user |

---

## API Keys

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api-keys` | List API keys |
| `POST` | `/api-keys` | Create key `{name}` → returns `{key}` once |
| `DELETE`| `/api-keys/{id}` | Revoke key |
