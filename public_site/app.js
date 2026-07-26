// Anisubarr — public visitor site. Vanilla JS, no build step, same-origin API.

const API_BASE = "/api/public";

const ENDPOINTS = {
  published: "/published",
  upcoming:  "/upcoming",
  requested: "/requested",
  issues:    "/issues",
};

const grid    = document.getElementById("grid");
const empty   = document.getElementById("empty");
const loading = document.getElementById("loading");
const tabsEl  = document.getElementById("tabs");

let currentTab = "published";
const cache = {}; // tab -> results (avoid refetch on tab switch within a session)

async function loadTab(tab) {
  currentTab = tab;
  grid.innerHTML = "";
  empty.classList.add("hidden");

  if (cache[tab]) {
    render(tab, cache[tab]);
    return;
  }

  loading.classList.remove("hidden");
  try {
    const res = await fetch(API_BASE + ENDPOINTS[tab]);
    const data = await res.json();
    cache[tab] = data.results || [];
    render(tab, cache[tab]);
  } catch (e) {
    loading.classList.add("hidden");
    empty.textContent = "Nepodařilo se načíst data.";
    empty.classList.remove("hidden");
  }
}

function render(tab, items) {
  loading.classList.add("hidden");
  grid.innerHTML = "";

  if (!items.length) {
    empty.textContent = "Zatím nic k zobrazení.";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const item of items) {
    grid.appendChild(buildCard(tab, item));
  }
}

function buildCard(tab, item) {
  const card = document.createElement("div");
  card.className = "card";

  const posterWrap = document.createElement("div");
  if (item.poster_url) {
    const img = document.createElement("img");
    img.className = "card-poster";
    img.src = item.poster_url;
    img.loading = "lazy";
    img.alt = item.title;
    posterWrap.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "card-poster-placeholder";
    ph.textContent = item.title;
    posterWrap.appendChild(ph);
  }
  card.appendChild(posterWrap);

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = item.title;
  body.appendChild(title);

  if (tab === "published") {
    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = [item.year, item.episode_count ? `${item.episode_count} dílů` : null].filter(Boolean).join(" · ");
    body.appendChild(meta);
    const pill = document.createElement("span");
    pill.className = "pill pill-ok";
    pill.textContent = "Zveřejněno";
    body.appendChild(pill);
  } else if (tab === "upcoming") {
    const total = item.episode_file_count || 0;
    const withSub = item.cs_sub_count || 0;
    const pct = total > 0 ? Math.round((withSub / total) * 100) : 0;
    const bar = document.createElement("div");
    bar.className = "progress-bar";
    const inner = document.createElement("div");
    inner.style.width = pct + "%";
    bar.appendChild(inner);
    body.appendChild(bar);
    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `${withSub}/${total} epizod s titulky`;
    body.appendChild(meta);
  } else if (tab === "requested") {
    const pill = document.createElement("span");
    pill.className = "pill " + (item.status === "Schváleno" ? "pill-ok" : "pill-warn");
    pill.textContent = item.status;
    body.appendChild(pill);
  } else if (tab === "issues") {
    const pill = document.createElement("span");
    pill.className = "pill pill-err";
    pill.textContent = "Nahlášený problém";
    body.appendChild(pill);
  }

  card.appendChild(body);
  card.addEventListener("click", () => openDetail(item));
  return card;
}

// ── Detail modal (only meaningful for series with overview/genres) ────────────

const detailModal   = document.getElementById("detail-modal");
const detailContent = document.getElementById("detail-content");

// Language code -> human label shown on subtitle pills.
const LANG_LABEL = {
  cs: "CZ", sk: "SK", en: "EN", ja: "JP", de: "DE",
  fr: "FR", pl: "PL", hu: "HU", ru: "RU", zh: "ZH", ko: "KO",
};

function langPill(code) {
  const pill = document.createElement("span");
  pill.className = "lang-pill" + (code === "cs" ? " lang-cs" : "");
  pill.textContent = LANG_LABEL[code] || code.toUpperCase();
  return pill;
}

function statLine(label, value) {
  const row = document.createElement("div");
  row.className = "detail-stat";
  const l = document.createElement("span");
  l.className = "detail-stat-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "detail-stat-value";
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  return row;
}

async function openDetail(item) {
  // Seerr request rows aren't local series (no `genres` key) — nothing to fetch.
  // Every series card has genres (possibly empty), so it always opens.
  if (item.id == null || item.genres === undefined) return;

  detailContent.innerHTML = "";
  detailModal.classList.remove("hidden");

  const loadingEl = document.createElement("div");
  loadingEl.className = "loading";
  loadingEl.textContent = "Načítám…";
  detailContent.appendChild(loadingEl);

  let data = item;
  try {
    const res = await fetch(`${API_BASE}/series/${item.id}`);
    if (res.ok) data = await res.json();
  } catch { /* fall back to the card data we already have */ }

  detailContent.innerHTML = "";

  const header = document.createElement("div");
  header.className = "detail-header";

  if (data.poster_url) {
    const img = document.createElement("img");
    img.className = "detail-poster";
    img.src = data.poster_url;
    header.appendChild(img);
  }

  const info = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.className = "detail-title";
  h2.textContent = data.title;
  info.appendChild(h2);

  // ── Stats: seasons, episodes, files, subtitle coverage ────────────────────
  const seasons = data.seasons || [];
  const allEps = seasons.flatMap(s => s.episodes || []);
  const withSubs = allEps.filter(e => (e.subtitles || []).length > 0).length;
  const withCs = allEps.filter(e => (e.subtitles || []).includes("cs")).length;

  const stats = document.createElement("div");
  stats.className = "detail-stats";
  const seasonCount = data.season_count || seasons.filter(s => s.season > 0).length;
  if (seasonCount) stats.appendChild(statLine("Sérií", String(seasonCount)));
  if (allEps.length) {
    stats.appendChild(statLine("Dílů", String(allEps.length)));
    stats.appendChild(statLine("Se souborem", `${allEps.filter(e => e.has_file).length}/${allEps.length}`));
    stats.appendChild(statLine("S titulky", `${withSubs}/${allEps.length}`));
    stats.appendChild(statLine("České titulky", `${withCs}/${allEps.length}`));
  } else if (data.episode_count) {
    stats.appendChild(statLine("Dílů", String(data.episode_count)));
  }
  if (data.year)   stats.appendChild(statLine("Rok", String(data.year)));
  if (data.status) stats.appendChild(statLine("Stav", data.status));
  info.appendChild(stats);

  if (data.overview) {
    const p = document.createElement("p");
    p.className = "detail-overview";
    p.textContent = data.overview;
    info.appendChild(p);
  }

  if (data.genres && data.genres.length) {
    const genresWrap = document.createElement("div");
    genresWrap.className = "detail-genres";
    for (const g of data.genres) {
      const pill = document.createElement("span");
      pill.className = "genre-pill";
      pill.textContent = g;
      genresWrap.appendChild(pill);
    }
    info.appendChild(genresWrap);
  }

  header.appendChild(info);
  detailContent.appendChild(header);

  // ── Per-season episode list with subtitle languages ───────────────────────
  for (const season of seasons) {
    if (!season.episodes || !season.episodes.length) continue;

    const h3 = document.createElement("h3");
    h3.className = "season-title";
    h3.textContent = season.season === 0 ? "Speciály" : `Série ${season.season}`;
    detailContent.appendChild(h3);

    const list = document.createElement("div");
    list.className = "episode-list";

    for (const ep of season.episodes) {
      const row = document.createElement("div");
      row.className = "episode-row";

      const num = document.createElement("span");
      num.className = "episode-num";
      num.textContent = String(ep.episode ?? "?").padStart(2, "0") + ".";
      row.appendChild(num);

      const title = document.createElement("span");
      title.className = "episode-title";
      title.textContent = ep.title || "—";
      row.appendChild(title);

      const langs = document.createElement("span");
      langs.className = "episode-langs";
      if (ep.subtitles && ep.subtitles.length) {
        for (const code of ep.subtitles) langs.appendChild(langPill(code));
      } else {
        const none = document.createElement("span");
        none.className = "lang-pill lang-none";
        none.textContent = "bez titulků";
        langs.appendChild(none);
      }
      row.appendChild(langs);

      list.appendChild(row);
    }
    detailContent.appendChild(list);
  }
}

document.getElementById("detail-close").addEventListener("click", () => {
  detailModal.classList.add("hidden");
});
detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) detailModal.classList.add("hidden");
});

// ── Tabs ────────────────────────────────────────────────────────────────────

tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  tabsEl.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  loadTab(btn.dataset.tab);
});

// ── Subscribe modal ───────────────────────────────────────────────────────────

const subscribeModal  = document.getElementById("subscribe-modal");
const subscribeStatus = document.getElementById("subscribe-status");

document.getElementById("subscribe-open").addEventListener("click", () => {
  subscribeModal.classList.remove("hidden");
});
document.getElementById("subscribe-close").addEventListener("click", () => {
  subscribeModal.classList.add("hidden");
});
subscribeModal.addEventListener("click", (e) => {
  if (e.target === subscribeModal) subscribeModal.classList.add("hidden");
});

document.getElementById("subscribe-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("subscribe-email").value.trim();
  subscribeStatus.textContent = "Odesílám…";
  subscribeStatus.className = "subscribe-status";
  try {
    const res = await fetch(API_BASE + "/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error();
    subscribeStatus.textContent = "Hotovo! Budeme tě informovat o novinkách.";
    subscribeStatus.className = "subscribe-status ok";
    document.getElementById("subscribe-email").value = "";
  } catch {
    subscribeStatus.textContent = "Něco se nepovedlo, zkus to prosím znovu.";
    subscribeStatus.className = "subscribe-status err";
  }
});

// ── Unsubscribe via ?token= in URL ────────────────────────────────────────────

(function handleUnsubscribeLink() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("unsubscribe_token") || (window.location.pathname === "/unsubscribe" ? params.get("token") : null);
  if (!token) return;
  fetch(`${API_BASE}/unsubscribe?token=${encodeURIComponent(token)}`)
    .then(() => alert("Byl jsi odhlášen z odběru novinek."))
    .catch(() => alert("Odhlášení se nepovedlo — odkaz je možná neplatný."));
})();

// ── Init ───────────────────────────────────────────────────────────────────

loadTab(currentTab);
