/**
 * SubtitleEditorPage — /subtitles
 *
 * Picking what to edit, and nothing else. The editing happens in the player,
 * where the video is: judging whether a line is late needs the picture, and
 * every timing operation takes the playhead as its input. This page exists
 * because "I want to fix a subtitle" doesn't start from an episode row — it
 * starts from not knowing which episode is broken.
 *
 * So the list leads with that: how many episodes of each show have Czech
 * subtitles at all, and which ones don't.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Film, Loader2, Pencil, Search } from "lucide-react";
import clsx from "clsx";
import api from "../api/client";
import { useT } from "../i18n/I18nContext";

const getSeries = () => api.get("/series").then((r) => r.data);
const getEpisodes = (sid) => api.get(`/series/${sid}/episodes`).then((r) => r.data);

function epCode(ep) {
  return `S${String(ep.season_number).padStart(2, "0")}E${String(ep.episode_number).padStart(2, "0")}`;
}

export default function SubtitleEditorPage() {
  const t = useT();
  const navigate = useNavigate();
  const [openSeries, setOpenSeries] = useState(null);
  const [filter, setFilter] = useState("");

  const { data: allSeries = [], isLoading } = useQuery({
    queryKey: ["series"],
    queryFn: getSeries,
    staleTime: 60_000,
  });

  const { data: episodes = [], isFetching: loadingEps } = useQuery({
    queryKey: ["episodes", openSeries],
    queryFn: () => getEpisodes(openSeries),
    enabled: !!openSeries,
    staleTime: 30_000,
  });

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return allSeries;
    return allSeries.filter((s) =>
      `${s.title || ""} ${s.title_romaji || ""} ${s.title_english || ""}`
        .toLowerCase().includes(needle));
  }, [allSeries, filter]);

  return (
    <div className="flex flex-col gap-4">

      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-text">{t("sube_page_title")}</h1>
          <p className="text-xs text-muted mt-0.5">{t("sube_page_subtitle")}</p>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted/50" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("sube_page_search")}
            className="bg-bg border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-text w-56 focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-muted" /></div>
      )}

      {!isLoading && shown.length === 0 && (
        <p className="text-sm text-muted text-center py-16">{t("sube_page_nothing")}</p>
      )}

      <div className="flex flex-col gap-1.5">
        {shown.map((s) => {
          const open = openSeries === s.id;
          return (
            <div key={s.id} className="border border-border rounded-lg overflow-hidden bg-panel">
              <button
                onClick={() => setOpenSeries(open ? null : s.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left"
              >
                <ChevronRight
                  size={14}
                  className={clsx("text-muted transition-transform flex-shrink-0", open && "rotate-90")}
                />
                <Film size={13} className="text-muted/60 flex-shrink-0" />
                <span className="text-sm text-text truncate min-w-0 flex-1">
                  {s.title_romaji || s.title}
                </span>
                {s.episode_count != null && (
                  <span className="text-[10px] font-mono text-muted/50 flex-shrink-0">
                    {s.episode_count} {t("sube_page_episodes")}
                  </span>
                )}
              </button>

              {open && (
                <div className="border-t border-border">
                  {loadingEps && (
                    <div className="flex justify-center py-6">
                      <Loader2 size={16} className="animate-spin text-muted" />
                    </div>
                  )}
                  {!loadingEps && episodes.length === 0 && (
                    <p className="text-xs text-muted text-center py-6">{t("sube_page_no_episodes")}</p>
                  )}
                  {episodes.map((ep) => (
                    <button
                      key={ep.id}
                      onClick={() => navigate(`/player/${s.id}/${ep.id}`)}
                      disabled={!ep.has_file}
                      className={clsx(
                        "w-full flex items-center gap-2.5 px-3 py-1.5 border-b border-border/50 last:border-b-0 text-left transition-colors",
                        ep.has_file ? "hover:bg-accent/10" : "opacity-40 cursor-not-allowed",
                      )}
                      title={ep.has_file ? t("sube_page_open") : t("sube_page_no_video")}
                    >
                      <span className="text-[10px] font-mono text-muted w-16 flex-shrink-0">{epCode(ep)}</span>
                      <span className="text-xs text-text/90 truncate min-w-0 flex-1">
                        {ep.title || "—"}
                      </span>
                      <span className={clsx(
                        "text-[10px] px-1.5 py-0.5 rounded flex-shrink-0",
                        ep.has_cs_sub ? "text-green-400 bg-green-900/20" : "text-muted bg-white/5",
                      )}>
                        {ep.has_cs_sub ? t("sd_sub_cs") : t("sd_sub_missing")}
                      </span>
                      {ep.has_file && <Pencil size={11} className="text-muted/50 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
