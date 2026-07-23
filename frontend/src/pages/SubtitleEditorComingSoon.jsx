/**
 * SubtitleEditorComingSoon — temporary placeholder for /subtitles.
 *
 * The old text-only cue editor (SubtitleEditorPage.jsx) is being retired in
 * favor of a unified editor built on top of PlayerPage's existing video +
 * timeline + sync foundation (video preview, cue sync, metadata form, trim
 * UI). SubtitleEditorPage.jsx and SubtitleEditorPanel.jsx are left on disk
 * untouched as reference/salvage material for that rebuild — nothing here
 * deletes them, this just stops routing users to the half-finished old page.
 *
 * Once the new unified editor lands, swap the route in App.jsx back to the
 * real page and this file (plus the old ones) can be deleted.
 */
import { Wrench } from "lucide-react";
import { useT } from "../i18n/I18nContext";

export default function SubtitleEditorComingSoon() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center"
      style={{ minHeight: "60vh" }}>
      <Wrench size={32} className="text-muted opacity-50" />
      <h1 className="text-base font-semibold text-text">{t('subed_soon_title')}</h1>
      <p className="text-sm text-muted max-w-md leading-relaxed">{t('subed_soon_text')}</p>
    </div>
  );
}
