import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  timeout: 30_000,
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Redirect to login on 401 — but NOT for the login endpoint itself
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isLoginEndpoint = err.config?.url?.includes("/auth/token");
    if (err.response?.status === 401 && !isLoginEndpoint) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────
export const login = (username, password) => {
  const form = new URLSearchParams({ username, password });
  return api.post("/auth/token", form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
};

export const register = (username, password, email) =>
  api.post("/auth/register", { username, password, email });

export const getMe = () => api.get("/auth/me");

// ── Series ────────────────────────────────
export const getSeries          = ()              => api.get("/series");
export const getSeriesById      = (id)            => api.get(`/series/${id}`);
export const translateSeries    = (id)            => api.post(`/series/${id}/translate`);
export const setWatchStatus     = (id, status)    => api.patch(`/series/${id}/watch-status`, { watch_status: status });
export const setEpisodeWatched  = (sid, eid, val) => api.patch(`/series/${sid}/episodes/${eid}/watched`, { watched: val });
export const refreshCounts      = ()              => api.post("/series/refresh-counts");

// ── Sync ──────────────────────────────────
export const syncAll         = ()          => api.post("/sync/sonarr");
export const syncOne         = (id)        => api.post(`/sync/sonarr/${id}`);
export const syncStatus      = ()          => api.get("/sync/status");
export const autoUnmonitor   = (seriesIds) => api.post("/sync/auto-unmonitor", seriesIds ? { series_ids: seriesIds } : {});

// Sonarr management
export const getSonarrTags          = ()                          => api.get("/sync/sonarr/tags");
export const getSonarrRootFolders   = ()                          => api.get("/sync/sonarr/root-folders");
export const updateSeriesTags       = (seriesId, tagIds)          => api.patch(`/sync/sonarr/series/${seriesId}/tags`, { tag_ids: tagIds });
export const updateSeriesRootFolder = (seriesId, rootFolderPath)  => api.patch(`/sync/sonarr/series/${seriesId}/root-folder`, { root_folder_path: rootFolderPath });
export const bulkRootFolderMove     = (seriesIds, rootFolderPath) => api.post("/sync/sonarr/bulk-root-folder", { series_ids: seriesIds, root_folder_path: rootFolderPath });

// ── Video ─────────────────────────────────
export const checkVideoTools    = ()       => api.get("/video/tools");
export const probeFile          = (path)   => api.post("/video/probe",           { file_path: path });
export const getSubtitleTracks  = (path)   => api.post("/video/subtitle-tracks", { file_path: path });
export const extractSubtitle    = (data)   => api.post("/video/extract",         data);
export const extractAllSubtitles= (path, outputDir) =>
  api.post("/video/extract-all", { file_path: path, output_dir: outputDir });
export const removeSubtitles    = (data)   => api.post("/video/remove-subtitles", data);
export const stripEmbeddedSubs  = (epId)   => api.post(`/video/strip-embedded/${epId}`, {}, { timeout: 300_000 });

// ── NFO ───────────────────────────────────
export const previewSeriesNfo  = (id)  => api.get(`/nfo/preview/series/${id}`);
export const writeSeriesNfo    = (id)  => api.post(`/nfo/write/series/${id}`);
export const writeAllNfo       = (id)  => api.post(`/nfo/write/series/${id}/all`);
export const writeEpisodeNfo   = (id)  => api.post(`/nfo/write/episode/${id}`);
export const writeAllSeriesNfo = ()    => api.post("/nfo/write/all");

// ── Users (admin) ─────────────────────────
export const getUsers    = ()           => api.get("/users/");
export const createUser  = (data)       => api.post("/users/", data);
export const updateUser  = (id, data)   => api.patch(`/users/${id}`, data);
export const deleteUser  = (id)         => api.delete(`/users/${id}`);

// ── Jobs log ──────────────────────────────
export const getJobs   = (limit = 100) => api.get("/jobs", { params: { limit } });
export const cancelJob = (runId)       => api.post(`/jobs/${runId}/cancel`);

// ── Subtitles ─────────────────────────────
export const searchSubtitles    = (data) => api.post("/subtitles/search",               data);
export const downloadSubtitle   = (data) => api.post("/subtitles/download",             data);
export const downloadBest       = (data) => api.post("/subtitles/download-best",        data);
export const getEpisodeSubs     = (epId) => api.get(`/subtitles/episode/${epId}`);
export const deleteSub          = (id)   => api.delete(`/subtitles/${id}`);
export const deleteSubsBulk     = (ids)  => api.delete("/subtitles/bulk", { data: { subtitle_ids: ids } });
export const deleteSubsByEpisodes = (episodeIds, language = null) =>
  api.post("/subtitles/delete-by-episodes", { episode_ids: episodeIds, ...(language ? { language } : {}) });
export const getEpisodeSubFiles = (epId) => api.get(`/subtitles/files/episode/${epId}`);
export const deleteDiskFile     = (path) => api.post("/subtitles/delete-file", { file_path: path });
export const uploadSubtitle        = (formData) => api.post("/subtitles/upload", formData, {
  headers: { "Content-Type": "multipart/form-data" },
});
export const downloadAllSubtitles  = (seriesId)   => api.post(`/subtitles/download-all/${seriesId}`);
export const downloadBestBulk          = (episodeIds) => api.post("/subtitles/download-best-bulk", { episode_ids: episodeIds });
export const downloadAllBulkSeries     = (seriesIds)  => api.post("/subtitles/download-all-bulk-series", { series_ids: seriesIds });
export const deleteSubsBySeries        = (seriesIds, language = null) =>
  api.post("/subtitles/delete-by-series", { series_ids: seriesIds, ...(language ? { language } : {}) });
export const writeEpisodesNfo          = (episodeIds) => api.post("/nfo/write/episodes", { episode_ids: episodeIds });

// ── Overseerr ─────────────────────────────
export const overseerrStatus      = ()          => api.get("/overseerr/status");
export const overseerrRequests    = (filter)    => api.get("/overseerr/requests", { params: { filter, take: 50 } });
export const overseerrRequest     = (seriesId)  => api.post(`/overseerr/request/${seriesId}`);
export const overseerrApprove     = (reqId)     => api.post(`/overseerr/request/${reqId}/approve`);
export const overseerrDecline     = (reqId)     => api.post(`/overseerr/request/${reqId}/decline`);
export const overseerrCancelReq   = (reqId)     => api.delete(`/overseerr/request/${reqId}`);
export const overseerrIssues      = (params)    => api.get("/overseerr/issues", { params });
export const overseerrSeriesIssues= (seriesId)  => api.get(`/overseerr/issues/series/${seriesId}`);

// ── API Keys ──────────────────────────────
export const getApiKeys    = ()           => api.get("/api-keys");
export const createApiKey  = (name)       => api.post("/api-keys", { name });
export const deleteApiKey  = (id)         => api.delete(`/api-keys/${id}`);

// ── Subtitle sync (alass) ─────────────────
export const syncEpisodeTiming  = (epId)       => api.post(`/subtitle-sync/episode/${epId}`);
export const syncSeriesTiming   = (seriesId)   => api.post(`/subtitle-sync/series/${seriesId}`);
export const syncBulkTiming     = (episodeIds) => api.post("/subtitle-sync/bulk", { episode_ids: episodeIds });
export const syncBulkSeries     = (seriesIds)  => api.post("/subtitle-sync/bulk-series", { series_ids: seriesIds });

// ── Promotion ─────────────────────────────
export const checkPromotions    = ()    => api.post("/promotion/check");
export const checkPromotion     = (id)  => api.post(`/promotion/check/${id}`);
export const getPromotionStatus = ()    => api.get("/promotion/status");
export const publishSeries      = (id)  => api.post(`/promotion/publish/${id}`);
export const demoteSeries       = (id)  => api.post(`/promotion/demote/${id}`);

// ── Emby ──────────────────────────────────
export const embyStatus    = ()           => api.get("/emby/status");

// ── Paths (SMB test) ──────────────────────
export const smbTest       = ()           => api.get("/paths/smb-test");
export const sonarrHealth  = ()           => api.get("/sync/sonarr/health");

// ── App settings ──────────────────────────
export const getAppSettings    = ()       => api.get("/settings");
export const updateSettings    = (data)   => api.put("/settings", data);
export const testConnection    = (svc, body) => api.post(`/settings/test/${svc}`, body);

// ── Library stats ─────────────────────────
export const getLibraryStats    = ()    => api.get("/library/stats");

// ── Subtitle lines (subtitle editor) ─────
export const getSubLines        = (epId, lang) => api.get(`/episodes/${epId}/subs/${lang}`);
export const saveSubLines       = (epId, lang, lines) => api.put(`/episodes/${epId}/subs/${lang}`, { lines });
export const getSubFile         = (epId, lang) => api.get(`/episodes/${epId}/subs/${lang}/file`);

// ── AI translate ──────────────────────────
export const getAiStatus        = ()        => api.get("/ai/status");
export const aiTranslate        = (payload) => api.post("/ai/translate", payload, { timeout: 120_000 });

// ── Requests (local) ─────────────────────
export const getRequests        = (status)  => api.get("/requests", { params: status ? { status } : {} });
export const createRequest      = (data)    => api.post("/requests", data);
export const updateRequest      = (id, data) => api.patch(`/requests/${id}`, data);
export const deleteRequest      = (id)      => api.delete(`/requests/${id}`);

// ── Downloads ─────────────────────────────
export const getDownloadsQueue  = ()         => api.get("/downloads/queue");
export const getDownloadsRecent = (days = 7) => api.get("/downloads/recent", { params: { days } });
export const getDownloadsStats  = ()         => api.get("/downloads/stats");

// ── Glossary ──────────────────────────────
export const getGlossary         = (params) => api.get("/glossary", { params });
export const createGlossaryEntry = (data)   => api.post("/glossary", data);
export const updateGlossaryEntry = (id, data) => api.patch(`/glossary/${id}`, data);
export const deleteGlossaryEntry = (id)     => api.delete(`/glossary/${id}`);

// ── File browser ──────────────────────────
export const browseFiles = (path = '') => api.get('/files/browse', { params: path ? { path } : {} });

export default api;
