(() => {
  "use strict";

  const STORAGE_KEYS = {
    config: "eletor_os_config_v1",
    cache: "eletor_os_cache_v1",
    selection: "eletor_os_selection_v1"
  };

  const DEFAULT_SELECTION = { contexto: "casa", estado: "alta" };
  const DEFAULT_CUPO = 15;
  const FETCH_TIMEOUT_MS = 12000;

  const state = {
    config: null,
    cache: { runbook: [], mc_count_mes: 0, mc_cupo: DEFAULT_CUPO, updated_at: null },
    selection: { ...DEFAULT_SELECTION },
    inFlight: { sync: false, mc: false, checkin: false },
    timer: { id: null, endAt: 0, activeMinutes: null },
    toastId: null
  };

  const dom = {};

  function cacheDom() {
    const ids = [
      "sync-indicator",
      "mc-badge",
      "mc-count",
      "mc-cupo",
      "btn-sync",
      "btn-config",
      "toast",
      "setup-view",
      "setup-title",
      "setup-form",
      "input-url",
      "input-token",
      "setup-error",
      "btn-save-config",
      "btn-cancel-config",
      "btn-clear-config",
      "main-view",
      "runbook-cards",
      "wednesday-box",
      "wednesday-cards",
      "btn-checkin",
      "tardes-cards",
      "bajada-cards",
      "break-glass-dock",
      "btn-break-glass",
      "break-glass-view",
      "btn-close-bg",
      "bg-cards",
      "timer-display",
      "timer-status",
      "btn-stop-timer"
    ];
    for (const id of ids) {
      dom[id] = document.getElementById(id);
    }
    dom.contextButtons = Array.from(document.querySelectorAll("[data-contexto]"));
    dom.estadoButtons = Array.from(document.querySelectorAll("[data-estado]"));
    dom.timerButtons = Array.from(document.querySelectorAll("[data-minutes]"));
    dom.timerPanel = document.querySelector(".timer-panel");
  }

  function readJsonStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_err) {
      return null;
    }
  }

  function writeJsonStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_err) {
      showToast("No se pudo guardar en almacenamiento local.", "error");
    }
  }

  function validateConfig(rawUrl, rawToken) {
    const url = String(rawUrl || "").trim();
    const token = String(rawToken || "").trim();
    if (!url || !token) {
      return { ok: false, error: "Completá Web App URL y Token/Clave." };
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_err) {
      return { ok: false, error: "La Web App URL no es válida." };
    }
    const isLocalHttp =
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (parsed.protocol !== "https:" && !isLocalHttp) {
      return { ok: false, error: "La URL debe usar HTTPS." };
    }
    return { ok: true, config: { url: parsed.toString(), token } };
  }

  function sanitizeRunbook(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        contexto: String(item.contexto || "").trim(),
        estado: String(item.estado || "").trim(),
        bloque: String(item.bloque || "").trim(),
        texto: String(item.texto || "").trim()
      }));
  }

  function getBlocks(runbook, contexto, estado) {
    return runbook.filter((item) => {
      if (item.contexto !== contexto) {
        return false;
      }
      return estado === undefined ? true : item.estado === estado;
    });
  }

  function showToast(message, kind = "") {
    if (!dom.toast) {
      return;
    }
    if (state.toastId) {
      clearTimeout(state.toastId);
    }
    dom.toast.textContent = message;
    dom.toast.className = kind ? `toast is-${kind}` : "toast";
    dom.toast.hidden = false;
    state.toastId = setTimeout(() => {
      dom.toast.hidden = true;
    }, 2600);
  }

  function setSyncIndicator(text) {
    dom["sync-indicator"].textContent = text;
  }

  function renderCards(container, items, emptyMessage) {
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = emptyMessage;
      container.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const card = document.createElement("article");
      card.className = "runbook-card";

      if (item.bloque) {
        const label = document.createElement("div");
        label.className = "block-label";
        label.textContent = item.bloque;
        card.appendChild(label);
      }

      const body = document.createElement("p");
      body.className = "block-text";
      body.textContent = item.texto;
      card.appendChild(body);

      fragment.appendChild(card);
    }
    container.replaceChildren(fragment);
  }

  function renderHeaderStats() {
    const count = Number.isFinite(Number(state.cache.mc_count_mes))
      ? Number(state.cache.mc_count_mes)
      : 0;
    const cupo = Number.isFinite(Number(state.cache.mc_cupo)) && Number(state.cache.mc_cupo) > 0
      ? Number(state.cache.mc_cupo)
      : DEFAULT_CUPO;
    dom["mc-count"].textContent = String(count);
    dom["mc-cupo"].textContent = String(cupo);
  }

  function renderMain() {
    renderHeaderStats();

    for (const btn of dom.contextButtons) {
      btn.setAttribute("aria-pressed", String(btn.dataset.contexto === state.selection.contexto));
    }
    for (const btn of dom.estadoButtons) {
      btn.setAttribute("aria-pressed", String(btn.dataset.estado === state.selection.estado));
    }

    const runbook = state.cache.runbook || [];
    const activeItems = getBlocks(runbook, state.selection.contexto, state.selection.estado);
    renderCards(
      dom["runbook-cards"],
      activeItems,
      runbook.length
        ? "Sin bloques para este contexto y estado."
        : "Sin datos cacheados. Tocá ↻ para sincronizar."
    );

    const wednesdayItems =
      state.selection.contexto === "casa"
        ? getBlocks(runbook, "casa", "regla_miercoles")
        : [];
    dom["wednesday-box"].hidden = wednesdayItems.length === 0;
    if (wednesdayItems.length) {
      renderCards(dom["wednesday-cards"], wednesdayItems, "");
    }

    renderCards(
      dom["tardes-cards"],
      getBlocks(runbook, "tardes"),
      "Sin bloques cargados."
    );
    renderCards(
      dom["bajada-cards"],
      getBlocks(runbook, "bajada"),
      "Sin bloques cargados."
    );
    renderCards(
      dom["bg-cards"],
      getBlocks(runbook, "break_glass"),
      "Sin bloques de emergencia cargados."
    );
  }

  function openSetupView(isEditing) {
    dom["setup-error"].hidden = true;
    dom["setup-view"].hidden = false;
    dom["main-view"].hidden = true;
    dom["break-glass-dock"].hidden = true;
    dom["mc-badge"].hidden = !state.config;
    dom["btn-sync"].hidden = !state.config;

    dom["setup-title"].textContent = isEditing ? "Configuración" : "Configuración inicial";
    dom["input-url"].value = state.config ? state.config.url : "";
    dom["input-token"].value = state.config ? state.config.token : "";
    dom["btn-cancel-config"].hidden = !isEditing;
    dom["btn-clear-config"].hidden = !state.config;
  }

  function openMainView() {
    dom["setup-view"].hidden = true;
    dom["main-view"].hidden = false;
    dom["break-glass-dock"].hidden = false;
    dom["mc-badge"].hidden = false;
    dom["btn-sync"].hidden = false;
    renderMain();
  }

  async function requestJson(url, options) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!data || typeof data !== "object") {
        throw new Error("Respuesta inválida");
      }
      if (!data.ok) {
        throw new Error(data.error || "Error del servidor");
      }
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function syncRunbook(configToUse, { fromSetup = false } = {}) {
    if (!configToUse || state.inFlight.sync) {
      return false;
    }
    state.inFlight.sync = true;
    dom["btn-sync"].disabled = true;
    dom["btn-save-config"].disabled = true;
    setSyncIndicator("Sincronizando...");

    try {
      const endpoint = new URL(configToUse.url);
      endpoint.searchParams.set("token", configToUse.token);
      const data = await requestJson(endpoint.toString(), { method: "GET" });

      state.cache = {
        runbook: sanitizeRunbook(data.runbook),
        mc_count_mes: Number(data.mc_count_mes) || 0,
        mc_cupo: Number(data.mc_cupo) || DEFAULT_CUPO,
        updated_at: new Date().toISOString()
      };
      writeJsonStorage(STORAGE_KEYS.cache, state.cache);
      setSyncIndicator("Actualizado");
      renderMain();
      return true;
    } catch (err) {
      const msg = err && err.name === "AbortError"
        ? "Tiempo de espera agotado"
        : (err && err.message ? err.message : "Error al sincronizar");

      if (msg === "unauthorized") {
        setSyncIndicator("Clave inválida");
        if (!fromSetup) {
          showToast("Token inválido. Revisá ⚙️ Configuración.", "error");
        }
      } else {
        setSyncIndicator(state.cache.runbook.length ? "Sin conexión · caché local" : "Sin conexión");
        if (!fromSetup) {
          showToast(state.cache.runbook.length ? "Usando caché local." : msg, "error");
        }
      }
      return fromSetup ? msg : false;
    } finally {
      state.inFlight.sync = false;
      dom["btn-sync"].disabled = false;
      dom["btn-save-config"].disabled = false;
    }
  }

  async function sendTelemetry(evento, contexto, estado, nota = "") {
    if (!state.config) {
      return null;
    }
    return requestJson(state.config.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        token: state.config.token,
        contexto,
        estado,
        evento,
        nota
      })
    });
  }

  async function handleMcTap() {
    if (!state.config || state.inFlight.mc) {
      return;
    }
    state.inFlight.mc = true;
    dom["mc-badge"].disabled = true;
    try {
      const data = await sendTelemetry(
        "desayuno_mc",
        state.selection.contexto,
        state.selection.estado
      );
      if (data && typeof data.mc_count_mes === "number") {
        state.cache.mc_count_mes = data.mc_count_mes;
        writeJsonStorage(STORAGE_KEYS.cache, state.cache);
        renderHeaderStats();
      }
      showToast("Mc registrado", "ok");
    } catch (err) {
      const msg = err && err.message === "unauthorized"
        ? "Token inválido en ⚙️."
        : "Sin conexión para registrar Mc.";
      showToast(msg, "error");
    } finally {
      state.inFlight.mc = false;
      dom["mc-badge"].disabled = false;
    }
  }

  async function handleCheckin() {
    if (!state.config || state.inFlight.checkin) {
      return;
    }
    state.inFlight.checkin = true;
    dom["btn-checkin"].disabled = true;
    try {
      const data = await sendTelemetry(
        "check_in",
        state.selection.contexto,
        state.selection.estado
      );
      if (data && typeof data.mc_count_mes === "number") {
        state.cache.mc_count_mes = data.mc_count_mes;
        writeJsonStorage(STORAGE_KEYS.cache, state.cache);
        renderHeaderStats();
      }
      dom["btn-checkin"].textContent = "Guardado";
      dom["btn-checkin"].classList.add("is-saved");
      setTimeout(() => {
        dom["btn-checkin"].textContent = "Check-in estado actual";
        dom["btn-checkin"].classList.remove("is-saved");
      }, 2000);
    } catch (_err) {
      showToast("No se pudo guardar el check-in.", "error");
    } finally {
      state.inFlight.checkin = false;
      dom["btn-checkin"].disabled = false;
    }
  }

  function formatRemaining(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function stopTimer({ resetDisplay = true } = {}) {
    if (state.timer.id) {
      clearInterval(state.timer.id);
      state.timer.id = null;
    }
    state.timer.activeMinutes = null;
    for (const btn of dom.timerButtons) {
      btn.classList.remove("is-active");
    }
    dom.timerPanel.classList.remove("is-done");
    dom["btn-stop-timer"].hidden = true;
    if (resetDisplay) {
      dom["timer-display"].textContent = "00:00";
      dom["timer-status"].textContent = "Elegí un tiempo";
    }
  }

  function startTimer(minutes) {
    stopTimer({ resetDisplay: false });
    state.timer.activeMinutes = minutes;
    state.timer.endAt = Date.now() + minutes * 60 * 1000;

    for (const btn of dom.timerButtons) {
      btn.classList.toggle("is-active", Number(btn.dataset.minutes) === minutes);
    }
    dom["btn-stop-timer"].hidden = false;
    dom["timer-status"].textContent = "Corriendo en silencio";

    const tick = () => {
      const remaining = state.timer.endAt - Date.now();
      if (remaining <= 0) {
        stopTimer({ resetDisplay: false });
        dom["timer-display"].textContent = "00:00";
        dom["timer-status"].textContent = "Tiempo cumplido";
        dom.timerPanel.classList.add("is-done");
        if (typeof navigator.vibrate === "function") {
          navigator.vibrate([120, 80, 120]);
        }
        return;
      }
      dom["timer-display"].textContent = formatRemaining(remaining);
    };

    tick();
    state.timer.id = setInterval(tick, 500);
  }

  function openBreakGlass() {
    renderCards(
      dom["bg-cards"],
      getBlocks(state.cache.runbook || [], "break_glass"),
      "Sin bloques de emergencia cargados."
    );
    dom["break-glass-view"].hidden = false;
    sendTelemetry("break_glass", "break_glass", "emergencia").catch(() => {});
  }

  function closeBreakGlass() {
    stopTimer({ resetDisplay: true });
    dom["break-glass-view"].hidden = true;
  }

  function bindEvents() {
    dom["setup-form"].addEventListener("submit", async (event) => {
      event.preventDefault();
      dom["setup-error"].hidden = true;

      const check = validateConfig(dom["input-url"].value, dom["input-token"].value);
      if (!check.ok) {
        dom["setup-error"].textContent = check.error;
        dom["setup-error"].hidden = false;
        return;
      }

      const prevConfig = state.config;
      const syncResult = await syncRunbook(check.config, { fromSetup: true });
      if (syncResult === true) {
        state.config = check.config;
        writeJsonStorage(STORAGE_KEYS.config, state.config);
        openMainView();
        return;
      }

      if (syncResult === "unauthorized") {
        state.config = prevConfig;
        dom["setup-error"].textContent = "Token rechazado (unauthorized). Revisá la clave.";
        dom["setup-error"].hidden = false;
        return;
      }

      state.config = check.config;
      writeJsonStorage(STORAGE_KEYS.config, state.config);
      openMainView();
      showToast("Guardado. Se sincronizará cuando haya conexión.", "error");
    });

    dom["btn-config"].addEventListener("click", () => {
      if (state.config && !dom["setup-view"].hidden) {
        openMainView();
        return;
      }
      openSetupView(Boolean(state.config));
    });
    dom["btn-cancel-config"].addEventListener("click", openMainView);
    dom["btn-clear-config"].addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEYS.config);
      localStorage.removeItem(STORAGE_KEYS.cache);
      state.config = null;
      state.cache = { runbook: [], mc_count_mes: 0, mc_cupo: DEFAULT_CUPO, updated_at: null };
      setSyncIndicator("");
      openSetupView(false);
    });

    dom["btn-sync"].addEventListener("click", () => syncRunbook(state.config));
    dom["mc-badge"].addEventListener("click", handleMcTap);
    dom["btn-checkin"].addEventListener("click", handleCheckin);

    for (const btn of dom.contextButtons) {
      btn.addEventListener("click", () => {
        state.selection.contexto = btn.dataset.contexto;
        writeJsonStorage(STORAGE_KEYS.selection, state.selection);
        renderMain();
      });
    }

    for (const btn of dom.estadoButtons) {
      btn.addEventListener("click", () => {
        state.selection.estado = btn.dataset.estado;
        writeJsonStorage(STORAGE_KEYS.selection, state.selection);
        renderMain();
      });
    }

    dom["btn-break-glass"].addEventListener("click", openBreakGlass);
    dom["btn-close-bg"].addEventListener("click", closeBreakGlass);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !dom["break-glass-view"].hidden) {
        closeBreakGlass();
      }
    });
    dom["btn-stop-timer"].addEventListener("click", () => stopTimer({ resetDisplay: true }));

    for (const btn of dom.timerButtons) {
      btn.addEventListener("click", () => {
        const mins = Number(btn.dataset.minutes);
        if (mins > 0) {
          startTimer(mins);
        }
      });
    }
  }

  function bootstrap() {
    cacheDom();
    bindEvents();

    const savedSelection = readJsonStorage(STORAGE_KEYS.selection);
    if (savedSelection && typeof savedSelection === "object") {
      if (savedSelection.contexto === "casa" || savedSelection.contexto === "oficina") {
        state.selection.contexto = savedSelection.contexto;
      }
      if (["alta", "baja", "horno"].includes(savedSelection.estado)) {
        state.selection.estado = savedSelection.estado;
      }
    }

    const savedCache = readJsonStorage(STORAGE_KEYS.cache);
    if (savedCache && typeof savedCache === "object") {
      state.cache = {
        runbook: sanitizeRunbook(savedCache.runbook),
        mc_count_mes: Number(savedCache.mc_count_mes) || 0,
        mc_cupo: Number(savedCache.mc_cupo) || DEFAULT_CUPO,
        updated_at: savedCache.updated_at || null
      };
    }

    const savedConfig = readJsonStorage(STORAGE_KEYS.config);
    const valid = savedConfig
      ? validateConfig(savedConfig.url, savedConfig.token)
      : { ok: false };

    if (!valid.ok) {
      openSetupView(false);
      return;
    }

    state.config = valid.config;
    openMainView();
    if (state.cache.runbook.length) {
      setSyncIndicator("Caché local");
    }
    syncRunbook(state.config);
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
