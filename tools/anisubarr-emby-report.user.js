// ==UserScript==
// @name         Anisubarr – Nahlásit v Emby
// @namespace    anisubarr
// @version      1.1
// @description  Přidá tlačítko "🚩 Nahlásit" na stránky seriálů a dílů v Emby, které vytvoří issue v Overseerru přes Anisubarr.
// @match        http://192.168.1.149:8096/*
// @match        http://localhost:8096/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      192.168.1.149
// @connect      localhost
// ==/UserScript==

(function () {
  'use strict';

  // ─── KONFIGURACE ──────────────────────────────────────────────────────────
  // Změň dle svého prostředí. API klíč vygeneruj v Anisubarr → Nastavení → API klíče.
  const ANISUBARR_URL     = GM_getValue('anisubarr_url',     'http://192.168.1.149:8000');
  const ANISUBARR_API_KEY = GM_getValue('anisubarr_api_key', '');
  const EMBY_HOST         = GM_getValue('emby_host',         'http://192.168.1.149:8096');
  const EMBY_API_KEY      = GM_getValue('emby_api_key',      '');

  // Nabídka v Tampermonkey → nastavení
  GM_registerMenuCommand('⚙️ Nastavit Anisubarr URL', () => {
    const v = prompt('Anisubarr URL (bez lomítka na konci):', GM_getValue('anisubarr_url', 'http://192.168.1.149:8000'));
    if (v !== null) GM_setValue('anisubarr_url', v.trim());
  });
  GM_registerMenuCommand('🔑 Nastavit Anisubarr API klíč', () => {
    const v = prompt('API klíč (ansk_...):', GM_getValue('anisubarr_api_key', ''));
    if (v !== null) GM_setValue('anisubarr_api_key', v.trim());
  });
  GM_registerMenuCommand('📺 Nastavit Emby API klíč', () => {
    const v = prompt('Emby API klíč:', GM_getValue('emby_api_key', ''));
    if (v !== null) GM_setValue('emby_api_key', v.trim());
  });

  // ─── STAV ─────────────────────────────────────────────────────────────────
  let _lastInjectedItemId = null;

  // ─── POMOCNÉ FUNKCE ───────────────────────────────────────────────────────

  /** Zavolá Emby API GET a vrátí Promise s JSON. */
  function embyGet(path) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${EMBY_HOST}${path}`,
        headers: { 'X-Emby-Token': EMBY_API_KEY },
        onload: r => {
          if (r.status >= 200 && r.status < 300) {
            try { resolve(JSON.parse(r.responseText)); }
            catch { reject(new Error('JSON parse error')); }
          } else {
            reject(new Error(`Emby API ${r.status}`));
          }
        },
        onerror: () => reject(new Error('Emby API network error')),
      });
    });
  }

  /** Zavolá Anisubarr API POST a vrátí Promise s JSON. */
  function anisubarrPost(path, body) {
    return new Promise((resolve, reject) => {
      const apiKey = GM_getValue('anisubarr_api_key', ANISUBARR_API_KEY);
      const url    = GM_getValue('anisubarr_url',     ANISUBARR_URL);
      GM_xmlhttpRequest({
        method:  'POST',
        url:     `${url}${path}`,
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key':    apiKey,
        },
        data: JSON.stringify(body),
        onload: r => {
          if (r.status >= 200 && r.status < 300) {
            try { resolve(JSON.parse(r.responseText)); }
            catch { resolve({}); }
          } else {
            let detail = `HTTP ${r.status}`;
            try { detail = JSON.parse(r.responseText)?.detail || detail; } catch {}
            reject(new Error(detail));
          }
        },
        onerror: () => reject(new Error('Anisubarr nedostupný')),
      });
    });
  }

  // ─── DIALOG ───────────────────────────────────────────────────────────────

  function showReportDialog({ tvdbId, itemName, season, episode }) {
    // Odstraň předchozí dialog
    document.getElementById('anisubarr-dialog')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'anisubarr-dialog';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(0,0,0,.75); display: flex;
      align-items: center; justify-content: center;
      font-family: sans-serif;
    `;

    const isEpisode = season != null && episode != null;
    const scopeText = isEpisode
      ? `Epizoda S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}`
      : 'Celý seriál';

    overlay.innerHTML = `
      <div style="background:#1a1a2e; border:1px solid #444; border-radius:12px;
                  padding:28px 32px; min-width:360px; max-width:480px; color:#eee;">
        <h2 style="margin:0 0 6px; font-size:18px;">🚩 Nahlásit problém</h2>
        <p style="margin:0 0 18px; color:#aaa; font-size:13px;">
          <strong style="color:#eee">${itemName}</strong> — ${scopeText}
        </p>

        <label style="display:block; margin-bottom:10px; font-size:13px; color:#ccc">
          Typ problému
          <select id="ar-type" style="display:block; width:100%; margin-top:4px;
            background:#111; color:#eee; border:1px solid #555; border-radius:6px;
            padding:7px 10px; font-size:13px;">
            <option value="3">🔤 Titulky</option>
            <option value="1">🎬 Video</option>
            <option value="2">🔊 Zvuk</option>
            <option value="4">❓ Jiné</option>
          </select>
        </label>

        <label style="display:block; margin-bottom:18px; font-size:13px; color:#ccc">
          Popis (volitelný)
          <textarea id="ar-msg" rows="3" placeholder="Co je špatně?"
            style="display:block; width:100%; margin-top:4px; box-sizing:border-box;
              background:#111; color:#eee; border:1px solid #555; border-radius:6px;
              padding:7px 10px; font-size:13px; resize:vertical;"></textarea>
        </label>

        ${!isEpisode ? `
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:18px;
                       font-size:13px; color:#ccc; cursor:pointer;">
          <input type="checkbox" id="ar-demote" checked
            style="width:16px; height:16px; accent-color:#e55;">
          Degradovat seriál (přesunout zpět do incomplete)
        </label>` : '<input type="hidden" id="ar-demote">'}

        <div style="display:flex; gap:10px; justify-content:flex-end">
          <button id="ar-cancel" style="padding:8px 18px; border-radius:6px;
            background:#333; color:#ccc; border:1px solid #555; cursor:pointer; font-size:13px;">
            Zrušit
          </button>
          <button id="ar-submit" style="padding:8px 18px; border-radius:6px;
            background:#c0392b; color:#fff; border:none; cursor:pointer;
            font-size:13px; font-weight:600;">
            Nahlásit
          </button>
        </div>
        <p id="ar-status" style="margin:12px 0 0; font-size:12px; color:#aaa; min-height:16px;"></p>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#ar-cancel').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    overlay.querySelector('#ar-submit').onclick = async () => {
      const btn      = overlay.querySelector('#ar-submit');
      const statusEl = overlay.querySelector('#ar-status');
      const issueType = parseInt(overlay.querySelector('#ar-type').value);
      const message   = overlay.querySelector('#ar-msg').value.trim();
      const demoteEl  = overlay.querySelector('#ar-demote');
      const demote    = isEpisode ? false : (demoteEl?.checked ?? false);

      btn.disabled   = true;
      btn.textContent = '⏳ Odesílám…';
      statusEl.textContent = '';

      const payload = { tvdb_id: tvdbId, issue_type: issueType, message, demote };
      if (isEpisode) {
        payload.season  = season;
        payload.episode = episode;
      }

      try {
        const result = await anisubarrPost('/api/overseerr/report', payload);
        statusEl.style.color = '#4caf50';
        statusEl.textContent = `✅ Issue #${result.issue_id} vytvořena${result.demoted ? ' · degradace zahájena' : ''}`;
        btn.textContent = 'Hotovo';
        setTimeout(() => overlay.remove(), 2500);
      } catch (err) {
        statusEl.style.color = '#e55';
        statusEl.textContent = `❌ Chyba: ${err.message}`;
        btn.disabled = false;
        btn.textContent = 'Nahlásit';
      }
    };
  }

  // ─── INJEKCE TLAČÍTKA ─────────────────────────────────────────────────────

  function createReportButton(onClick) {
    const btn = document.createElement('button');
    btn.id = 'anisubarr-report-btn';
    btn.textContent = '🚩 Nahlásit';
    btn.title = 'Nahlásit problém do Overseerru přes Anisubarr';
    btn.style.cssText = `
      display: inline-flex; align-items: center; gap: 6px;
      margin-left: 8px; padding: 7px 14px;
      background: rgba(180,30,30,.85); color: #fff;
      border: 1px solid rgba(255,80,80,.5); border-radius: 6px;
      font-size: 13px; font-weight: 600; cursor: pointer;
      vertical-align: middle; transition: background .15s;
    `;
    btn.onmouseenter = () => { btn.style.background = 'rgba(220,40,40,.95)'; };
    btn.onmouseleave = () => { btn.style.background = 'rgba(180,30,30,.85)'; };
    btn.onclick = onClick;
    return btn;
  }

  async function injectButton(embyItemId) {
    if (_lastInjectedItemId === embyItemId) return;

    // Získej informace o položce z Emby API
    let itemData;
    try {
      const embyApiKey = GM_getValue('emby_api_key', EMBY_API_KEY);
      itemData = await embyGet(`/Items/${embyItemId}?api_key=${embyApiKey}`);
    } catch (err) {
      console.warn('[Anisubarr] Nepodařilo se načíst data z Emby:', err);
      return;
    }

    const tvdbId  = itemData?.ProviderIds?.Tvdb ? parseInt(itemData.ProviderIds.Tvdb) : null;
    const itemType = itemData?.Type; // 'Series', 'Season', 'Episode'
    const itemName = itemData?.SeriesName || itemData?.Name || 'Neznámý seriál';
    const season   = itemData?.ParentIndexNumber ?? null;  // season number (for Episode)
    const episode  = itemData?.IndexNumber ?? null;         // episode number

    if (!tvdbId) {
      console.warn('[Anisubarr] Položka nemá TVDB ID:', itemData?.Name);
      return;
    }

    // Hledej místo pro injekci — tlačítka akcí v Emby detailu
    const selectors = [
      '.detailButtons',
      '.itemButtons',
      '.actionButtons',
      '[data-role="actionButtons"]',
      '.mainDetailButtons',
    ];

    let container = null;
    for (const sel of selectors) {
      container = document.querySelector(sel);
      if (container) break;
    }

    if (!container) {
      // Záloha: přidej za první tlačítko play
      container = document.querySelector('.btnPlay')?.parentElement
               || document.querySelector('.itemActionButtons');
    }

    if (!container) {
      console.warn('[Anisubarr] Nenalezeno místo pro injekci tlačítka');
      return;
    }

    // Odstraň staré tlačítko pokud existuje
    document.getElementById('anisubarr-report-btn')?.remove();

    const isEpisode = itemType === 'Episode';
    const btn = createReportButton(() => {
      showReportDialog({
        tvdbId,
        itemName,
        season: isEpisode ? season : null,
        episode: isEpisode ? episode : null,
      });
    });

    container.appendChild(btn);
    _lastInjectedItemId = embyItemId;
    console.info(`[Anisubarr] Tlačítko injektováno pro "${itemName}" (TVDB: ${tvdbId})`);
  }

  // ─── SLEDOVÁNÍ URL (Emby je SPA) ──────────────────────────────────────────

  function getItemIdFromUrl() {
    const hash = window.location.hash || '';
    const search = hash.includes('?') ? hash.split('?')[1] : window.location.search;
    const params = new URLSearchParams(search);
    return params.get('id') || params.get('itemId') || null;
  }

  function checkPage() {
    const itemId = getItemIdFromUrl();
    if (!itemId) {
      _lastInjectedItemId = null;
      document.getElementById('anisubarr-report-btn')?.remove();
      return;
    }
    if (itemId !== _lastInjectedItemId) {
      // Počkej, až se stránka vykreslí
      setTimeout(() => injectButton(itemId), 800);
    }
  }

  // Sleduj změny hash URL
  window.addEventListener('hashchange', checkPage);
  window.addEventListener('popstate',   checkPage);

  // MutationObserver pro případ, kdy Emby přepíše obsah bez změny URL
  const observer = new MutationObserver(() => {
    const itemId = getItemIdFromUrl();
    if (itemId && itemId !== _lastInjectedItemId) {
      setTimeout(() => injectButton(itemId), 600);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Úvodní kontrola
  setTimeout(checkPage, 1200);

})();
