"""
sonarr.py – Sonarr v3 API client.
Pulls as much data as possible from each endpoint.
"""
import httpx
from typing import Optional
from ..config import get_settings

settings = get_settings()


def _client(timeout: int = 30, host: str = "", api_key: str = "") -> httpx.Client:
    base = host or settings.sonarr_host
    if not base.startswith("http"):
        base = f"http://{base}"
    key = api_key or settings.sonarr_api_key
    return httpx.Client(base_url=base, headers={"X-Api-Key": key}, timeout=timeout)


# Long timeout for file-move operations (Sonarr has to copy GBs of data)
_MOVE_TIMEOUT = 900  # 15 minutes


# ── Series ────────────────────────────────────────────────────────────

def get_series() -> list[dict]:
    with _client() as c:
        r = c.get("/api/v3/series")
        r.raise_for_status()
        return r.json()


def get_series_by_id(series_id: int) -> Optional[dict]:
    with _client() as c:
        r = c.get(f"/api/v3/series/{series_id}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()


# ── Episodes ──────────────────────────────────────────────────────────

def get_episodes(series_id: int) -> list[dict]:
    """Fetch all episodes for a series, including episodeFile with mediaInfo."""
    with _client() as c:
        r = c.get("/api/v3/episode", params={
            "seriesId": series_id,
            "includeEpisodeFile": "true",
        })
        r.raise_for_status()
        return r.json()


def set_episodes_monitored(episode_ids: list[int], monitored: bool) -> None:
    """Bulk set monitored flag for a list of Sonarr episode IDs."""
    if not episode_ids:
        return
    with _client() as c:
        r = c.put("/api/v3/episode/monitor", json={
            "episodeIds": episode_ids,
            "monitored": monitored,
        })
        r.raise_for_status()


def get_episode_files(series_id: int) -> list[dict]:
    """Fetch all episode files (with full mediaInfo) for a series."""
    with _client() as c:
        r = c.get("/api/v3/episodefile", params={"seriesId": series_id})
        r.raise_for_status()
        return r.json()


# ── Quality profiles ──────────────────────────────────────────────────

def get_quality_profiles() -> dict[int, str]:
    """Return {id: name} mapping of quality profiles."""
    try:
        with _client() as c:
            r = c.get("/api/v3/qualityprofile")
            r.raise_for_status()
            return {p["id"]: p["name"] for p in r.json()}
    except Exception:
        return {}


# ── Tags ──────────────────────────────────────────────────────────────

def get_tags() -> dict[int, str]:
    """Return {id: label} mapping of tags."""
    try:
        with _client() as c:
            r = c.get("/api/v3/tag")
            r.raise_for_status()
            return {t["id"]: t["label"] for t in r.json()}
    except Exception:
        return {}


def get_tags_full() -> list[dict]:
    """Return list of {id, label} for all Sonarr tags."""
    with _client() as c:
        r = c.get("/api/v3/tag")
        r.raise_for_status()
        return [{"id": t["id"], "label": t["label"]} for t in r.json()]


def create_tag(label: str) -> int:
    """Create a new Sonarr tag and return its ID."""
    with _client() as c:
        r = c.post("/api/v3/tag", json={"label": label})
        r.raise_for_status()
        return r.json()["id"]


def get_or_create_tag(label: str) -> int:
    """Return the ID of the tag with *label* (case-insensitive), creating it if absent."""
    tags = get_tags()  # {id: label}
    for tid, tlabel in tags.items():
        if tlabel.lower() == label.lower():
            return tid
    return create_tag(label)


# ── Root folders ──────────────────────────────────────────────────────

def get_root_folders() -> list[dict]:
    """Return list of root folders from Sonarr."""
    with _client() as c:
        r = c.get("/api/v3/rootfolder")
        r.raise_for_status()
        return [
            {
                "id":         f["id"],
                "path":       f["path"],
                "freeSpace":  f.get("freeSpace", 0),
                "accessible": f.get("accessible", True),
            }
            for f in r.json()
        ]


# ── Series update ──────────────────────────────────────────────────────

def update_series(sonarr_id: int, move_files: bool = False, **patch) -> dict:
    client_timeout = _MOVE_TIMEOUT if move_files else 30
    with _client(client_timeout) as c:
        r = c.get(f"/api/v3/series/{sonarr_id}")
        r.raise_for_status()
        body = r.json()
        body.update(patch)
        if "rootFolderPath" in patch:
            import posixpath as _pp
            old_series_path = body.get("path", "")
            series_folder = _pp.basename(old_series_path.rstrip("/\\"))
            if series_folder:
                new_root = patch["rootFolderPath"].rstrip("/\\")
                body["path"] = f"{new_root}/{series_folder}"
        url = f"/api/v3/series/{sonarr_id}?moveFiles=true" if move_files else f"/api/v3/series/{sonarr_id}"
        r2 = c.put(url, json=body)
        r2.raise_for_status()
        return r2.json()


# ── System ────────────────────────────────────────────────────────────

def get_system_status() -> dict:
    with _client() as c:
        r = c.get("/api/v3/system/status")
        r.raise_for_status()
        return r.json()


def get_disk_space() -> list[dict]:
    with _client() as c:
        r = c.get("/api/v3/diskspace")
        r.raise_for_status()
        return r.json()


def test_connection() -> dict:
    try:
        status = get_system_status()
        return {
            "ok": True,
            "version": status.get("version"),
            "app_name": status.get("appName", "Sonarr"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Commands ──────────────────────────────────────────────────────────

def trigger_series_scan(series_id: int) -> dict:
    with _client() as c:
        r = c.post("/api/v3/command", json={"name": "RescanSeries", "seriesId": series_id})
        r.raise_for_status()
        return r.json()


# ── Helpers / normalizers ─────────────────────────────────────────────

def extract_images(images: list[dict]) -> dict[str, str]:
    result = {}
    for img in images or []:
        ct  = img.get("coverType", "")
        url = img.get("remoteUrl") or img.get("url", "")
        if ct and url:
            result[ct] = url
    return result


def extract_media_info(ef: dict) -> dict:
    if not ef:
        return {}
    quality_obj = ef.get("quality", {}) or {}
    q           = quality_obj.get("quality", {}) or {}
    mi          = ef.get("mediaInfo", {}) or {}
    return {
        "sonarr_file_id":  ef.get("id"),
        "file_path":       ef.get("path"),
        "relative_path":   ef.get("relativePath"),
        "file_size":       ef.get("size"),
        "date_added":      ef.get("dateAdded"),
        "release_group":   ef.get("releaseGroup"),
        "scene_name":      ef.get("sceneName"),
        "quality_name":       q.get("name"),
        "quality_source":     q.get("source"),
        "quality_resolution": q.get("resolution"),
        "resolution":           mi.get("resolution"),
        "video_codec":          mi.get("videoCodec"),
        "video_bitrate":        mi.get("videoBitrate"),
        "video_fps":            mi.get("videoFps"),
        "video_dynamic_range":  mi.get("videoDynamicRangeType") or mi.get("videoDynamicRange"),
        "audio_codec":          mi.get("audioCodec"),
        "audio_channels":       mi.get("audioChannels"),
        "audio_bitrate":        mi.get("audioBitrate"),
        "audio_languages":      mi.get("audioLanguages"),
        "subtitles_in_file":    mi.get("subtitles"),
        "run_time":             mi.get("runTime"),
    }


def extract_series_fields(raw: dict, quality_map: dict, tag_map: dict) -> dict:
    import json

    stats  = raw.get("statistics") or {}
    images = extract_images(raw.get("images", []))
    rating = raw.get("ratings") or {}

    alt_titles = [t.get("title") for t in (raw.get("alternateTitles") or []) if t.get("title")]
    qp_id   = raw.get("qualityProfileId")
    qp_name = quality_map.get(qp_id, "") if qp_id else ""
    tag_ids    = raw.get("tags") or []
    tag_labels = [tag_map[tid] for tid in tag_ids if tid in tag_map]

    return {
        "sonarr_id":         raw["id"],
        "tvdb_id":           raw.get("tvdbId"),
        "tvmaze_id":         raw.get("tvMazeId"),
        "tvrage_id":         raw.get("tvRageId"),
        "imdb_id":           raw.get("imdbId"),
        "title":             raw.get("title", ""),
        "sort_title":        raw.get("sortTitle"),
        "title_slug":        raw.get("titleSlug"),
        "alternate_titles":  json.dumps(alt_titles, ensure_ascii=False) if alt_titles else None,
        "year":              raw.get("year"),
        "first_aired":       raw.get("firstAired"),
        "overview":          raw.get("overview"),
        "network":           raw.get("network"),
        "air_time":          raw.get("airTime"),
        "runtime":           raw.get("runtime"),
        "series_type":       raw.get("seriesType"),
        "certification":     raw.get("certification"),
        "status":            raw.get("status"),
        "monitored":         raw.get("monitored", True),
        "path":              raw.get("path"),
        "quality_profile":   qp_name,
        "sonarr_tags":       json.dumps(tag_labels, ensure_ascii=False) if tag_labels else None,
        "sonarr_added":      raw.get("added"),
        "genres":            json.dumps(raw.get("genres", []), ensure_ascii=False),
        "poster_url":        images.get("poster"),
        "fanart_url":        images.get("fanart"),
        "banner_url":        images.get("banner"),
        "season_count":         stats.get("seasonCount"),
        "episode_count":        stats.get("episodeCount"),
        "episode_file_count":   stats.get("episodeFileCount"),
        "total_episode_count":  stats.get("totalEpisodeCount"),
        "size_on_disk":         stats.get("sizeOnDisk"),
        "percent_complete":     stats.get("percentOfEpisodes"),
        "rating_value":  rating.get("value"),
        "rating_votes":  rating.get("votes"),
    }


# ── Library-aware helpers ─────────────────────────────────────────────────────

def fetch_all_series(host: str, api_key: str) -> list[dict]:
    """Fetch all series from a specific Sonarr instance (for library sync)."""
    with _client(host=host, api_key=api_key) as c:
        r = c.get("/api/v3/series")
        r.raise_for_status()
        return r.json()


def upsert_series_list(
    db,
    raw_list: list[dict],
    library_id: int,
    skip_translation: bool = True,
    skip_anilist: bool = True,
) -> dict:
    """Upsert a list of raw Sonarr series into the DB under the given library_id."""
    from ..models.series import Series
    from datetime import datetime, timezone

    created = updated = 0
    _ANILIST_FIELDS = {
        "anilist_id", "title_japanese", "title_romaji", "title_english",
        "average_score", "cover_url", "overview_anilist", "tags",
    }

    for raw in raw_list:
        sonarr_id = raw.get("id")
        if not sonarr_id:
            continue

        fields = extract_series_fields(raw, {}, {})
        fields["library_id"] = library_id
        fields["synced_at"] = datetime.now(timezone.utc)

        existing = db.query(Series).filter(Series.sonarr_id == sonarr_id).first()
        if existing is None:
            obj = Series(**fields)
            db.add(obj)
            created += 1
        else:
            for k, v in fields.items():
                if skip_anilist and k in _ANILIST_FIELDS:
                    continue
                setattr(existing, k, v)
            updated += 1

    db.commit()
    return {"created": created, "updated": updated, "total": len(raw_list)}

    db.commit()
    return {"created": created, "updated": updated, "total": len(raw_list)}
