import { loadPlanFromCSV, getReadingForDay, getReadingHaystack } from "./plan.js";
import { renderBookProgressPanel } from "./book_progress.js";

// === MENU LATERAL MOBILE ===
const menuToggle = document.getElementById("menuToggle");
const menuBackdrop = document.getElementById("menuBackdrop");

if (menuToggle && menuBackdrop) {
  const closeMenu = () => {
    document.body.classList.remove("menu-open");
  };

  // abre / fecha ao clicar no botão de 3 riscos
  menuToggle.addEventListener("click", () => {
    document.body.classList.toggle("menu-open");
  });

  // fecha ao clicar no fundo escurecido
  menuBackdrop.addEventListener("click", closeMenu);

  // fecha também ao trocar de tela pelo menu
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", closeMenu);
  });
}


/* =========================================================
   APP.JS
   - Planos built-in + planos personalizados via CSV
   - Planos personalizados isolados POR USUÁRIO (localStorage)
   - Admin mode local
   - XP / Achievements / Notes / Notifications
   ========================================================= */

/* =========================
   CONSTANTES / API
   ========================= */

const API = {
  me: "api/me.php",
  register: "api/register.php",
  login: "api/login.php",
  logout: "api/logout.php",
  setStart: "api/set_start_date.php",
  reset: "api/reset_plan.php",
  toggleDay: "api/toggle_day.php",
  progress: "api/progress.php",
  updateStats: "api/update_stats.php",
  notes: "api/notes.php",
};

const DAILY_XP = 10;
const VERSE_XP = 5;

/* =========================
   ADMIN MODE CONFIG
   ========================= */

const ADMIN_CRED = { login: "adm", pass: "adm211204" };

const ADMIN = {
  enabledKey: "admin_enabled",
  stateKey: "admin_state",
  timeOffsetKey: "admin_time_offset_days",
  autoSecondsKey: "admin_auto_seconds",
};

let adminAutoTimer = null;

function isAdminMode() {
  return localStorage.getItem(ADMIN.enabledKey) === "1";
}
function setAdminMode(on) {
  localStorage.setItem(ADMIN.enabledKey, on ? "1" : "0");
  if (!on) stopAdminAutoAdvance();
}

function getAdminState() {
  const raw = localStorage.getItem(ADMIN.stateKey);
  if (raw) {
    try { return JSON.parse(raw); } catch {}
  }
  return {
    user: {
      id: -999,
      name: "Administrador",
      email: "adm@local",
      start_date: null,
      theme: "dark",
      total_xp: 0,
      achievements_json: null,
      verse_reads: 0,
      plan_key: "alternada",
    },
    progress: [],
    achievements: {},
    notes: {}
  };
}
function saveAdminState(state) {
  localStorage.setItem(ADMIN.stateKey, JSON.stringify(state));
}

function getAdminOffsetDays() {
  return Number(localStorage.getItem(ADMIN.timeOffsetKey) || 0);
}
function setAdminOffsetDays(n) {
  localStorage.setItem(ADMIN.timeOffsetKey, String(n));
}
function getAdminAutoSeconds() {
  return Number(localStorage.getItem(ADMIN.autoSecondsKey) || 0);
}
function setAdminAutoSeconds(n) {
  localStorage.setItem(ADMIN.autoSecondsKey, String(n));
}

function startAdminAutoAdvance(seconds) {
  stopAdminAutoAdvance();
  if (!seconds || seconds <= 0) return;

  setAdminAutoSeconds(seconds);
  adminAutoTimer = setInterval(() => {
    setAdminOffsetDays(getAdminOffsetDays() + 1);
    refreshAfterTimeChange();
  }, seconds * 1000);
}

function stopAdminAutoAdvance() {
  if (adminAutoTimer) {
    clearInterval(adminAutoTimer);
    adminAutoTimer = null;
  }
  setAdminAutoSeconds(0);
}

/* =========================
   STATE
   ========================= */

let user = null;
let progress = [];
let achievements = {};
let verseToday = null;
let verseClaimedToday = false;

// Notes
let notesMap = new Map(); // day_index -> { text, updated_at? }

// HOME reading navigation
let homeDayOffset = 0;

/* =========================
   CATÁLOGO DE PLANOS
   ========================= */

const BUILTIN_PLANS = [
  { key: "alternada", title: "Leitura da Bíblia Alternada", desc: "AT + Salmo/Provérbio + NT diariamente.", file: "./plano_leitura_alternada.csv", hint: "Formato AT/Sl-Pv/NT." },
  { key: "cron_livros", title: "Bíblia Cronológica por Livros", desc: "Segue ordem cronológica por livros.", file: "./plano_cronologico_por_livros.csv", hint: "Formato Mês,Dia,Leitura." },
  { key: "cron_capitulos", title: "Bíblia Cronológica por Capítulos", desc: "Ordem cronológica no nível dos capítulos.", file: "./plano_cronologico_por_capitulos.csv", hint: "Formato Mês,Dia,Leitura." },
  { key: "generos", title: "Bíblia por Gêneros Literários", desc: "Lei, História, Poesia, Profecia, Evangelhos, Epístolas.", file: "./plano_generos_literarios.csv", hint: "Formato Mês,Dia,Leitura (múltiplas linhas/dia)." },
  { key: "gen_ap", title: "Bíblia de Gênesis a Apocalipse", desc: "Plano anual do início ao fim.", file: "./plano_genesis_a_apocalipse.csv", hint: "Formato Mês,Dia,Leitura." },
  { key: "sl_pv_5", title: "Salmos e Provérbios (1 ano - 5 dias/semana)", desc: "5 dias por semana.", file: "./plano_salmos_proverbios_1_ano_5_dias.csv", hint: "Formato Mês,Dia,Leitura." },
  { key: "nt_5", title: "Novo Testamento (1 ano - 5 dias/semana)", desc: "5 dias por semana.", file: "./plano_novo_testamento_1_ano_5_dias.csv", hint: "Formato Mês,Dia,Leitura." },
  { key: "sl_pv_nt", title: "Salmos + Provérbios + Novo Testamento", desc: "Plano combinado anual.", file: "./plano_salmos_proverbios_nt_1_ano.csv", hint: "Formato Mês,Dia,Leitura (múltiplas linhas/dia)." },
];

/* ================================
   PLANOS PERSONALIZADOS (CSV)
   - Isolados por usuário
   ================================ */

const BUILTIN_PLANS_FALLBACK =
  (typeof PLANS !== "undefined" && Array.isArray(PLANS)) ? PLANS : [];

const LS_CUSTOM_PLANS_BASE = "customPlans.v1";

/** Identificador estável do usuário para storage local */
function getUserStorageId() {
  if (isAdminMode()) return "admin_local";
  if (user?.id != null) return `uid_${user.id}`;
  if (user?.email) return `email_${String(user.email).toLowerCase()}`;
  return "guest";
}

function getCustomPlansKey() {
  return `${LS_CUSTOM_PLANS_BASE}.${getUserStorageId()}`;
}

/**
 * Migração:
 * se houver um storage legado global "customPlans.v1",
 * move para o usuário atual e remove o legado.
 */
function migrateLegacyCustomPlansForUser() {
  try {
    const legacy = localStorage.getItem(LS_CUSTOM_PLANS_BASE);
    if (!legacy) return;

    const newKey = getCustomPlansKey();
    if (!localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, legacy);
    }

    localStorage.removeItem(LS_CUSTOM_PLANS_BASE);
  } catch (e) {
    console.warn("Falha ao migrar custom plans:", e);
  }
}

function getCustomPlans() {
  try {
    const raw = localStorage.getItem(getCustomPlansKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn("Falha ao ler custom plans:", e);
    return [];
  }
}

function saveCustomPlans(arr) {
  localStorage.setItem(getCustomPlansKey(), JSON.stringify(arr));
}

function getAllPlans() {
  const builtins =
    (typeof BUILTIN_PLANS !== "undefined" && Array.isArray(BUILTIN_PLANS))
      ? BUILTIN_PLANS
      : BUILTIN_PLANS_FALLBACK;

  return [...builtins, ...getCustomPlans()];
}

function getPlanMetaByKey(key) {
  const all = getAllPlans();
  return all.find(p => p.key === key) || all[0] || BUILTIN_PLANS[0];
}

function upsertCustomPlan(plan) {
  const all = getCustomPlans();
  const idx = all.findIndex(p => p.key === plan.key);

  if (idx >= 0) all[idx] = plan;
  else all.push(plan);

  saveCustomPlans(all);
}

function deleteCustomPlan(planKey) {
  const all = getCustomPlans().filter(p => p.key !== planKey);
  saveCustomPlans(all);
}

/* =========================
   PLAN LOADER PROMISE
   ========================= */

let planReady = Promise.resolve();

/* =========================
   VERSE CONFIG
   ========================= */

const VERSE_FILE = "./versiculo_do_dia.csv";
let versesReady = Promise.resolve();
let versesList = [];

/* =========================
   NOTIFICATIONS (local only)
   ========================= */

const NOTIF = {
  enabledKey: "notif_enabled",
  timeKey: "notif_time",
  lastFiredKey: "notif_last_fired",
  followFiredKey: "notif_follow_fired",
};

function getNotifEnabled() {
  return localStorage.getItem(NOTIF.enabledKey) === "1";
}
function setNotifEnabled(v) {
  localStorage.setItem(NOTIF.enabledKey, v ? "1" : "0");
}
function getNotifTime() {
  return localStorage.getItem(NOTIF.timeKey) || "20:00";
}
function setNotifTime(v) {
  localStorage.setItem(NOTIF.timeKey, v || "20:00");
}

let notifPrimaryTimer = null;
let notifPollTimer = null;

/* =========================
   UTIL
   ========================= */

const fmtDate = (d) => new Date(d).toLocaleDateString("pt-BR");

function getNowDate() {
  if (!isAdminMode()) return new Date();
  const offset = getAdminOffsetDays();
  return new Date(Date.now() + offset * 86400000);
}
const todayISO = () => getNowDate().toISOString().slice(0, 10);

function daysBetween(a, b) {
  const A = new Date(a + "T00:00:00");
  const B = new Date(b + "T00:00:00");
  const ms = B - A;
  return Math.floor(ms / 86400000);
}

function safeJsonParse(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; }
  catch { return fallback; }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/* =========================
   TOAST
   ========================= */

const toastHost = document.getElementById("toastHost");

function showToast(title, body, actions = []) {
  if (!toastHost) return;

  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `
    <div class="t-title">${title}</div>
    <div class="t-body">${body}</div>
    <div class="t-actions"></div>
  `;

  const actBox = el.querySelector(".t-actions");
  actions.forEach(a => {
    const b = document.createElement("button");
    b.className = a.variant || "ghost-btn";
    b.textContent = a.label;
    b.onclick = () => {
      try { a.onClick?.(); } catch {}
      el.remove();
    };
    actBox.appendChild(b);
  });

  toastHost.appendChild(el);

  setTimeout(() => {
    if (el.isConnected) el.remove();
  }, 6000);
}
/* =========================
   DOM
   ========================= */

const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const authMsg = document.getElementById("authMsg");

// Auth panels
const loginPanel = document.getElementById("loginPanel");
const registerPanel = document.getElementById("registerPanel");
const goRegisterBtn = document.getElementById("goRegisterBtn");
const goLoginBtn = document.getElementById("goLoginBtn");

// Login
const loginEmail = document.getElementById("loginEmail");
const loginPass = document.getElementById("loginPass");
const loginBtn = document.getElementById("loginBtn");

// Register
const regName = document.getElementById("regName");
const regEmail = document.getElementById("regEmail");
const regPass = document.getElementById("regPass");
const registerBtn = document.getElementById("registerBtn");

// Header
const userNameEl = document.getElementById("userName");
const logoutBtn = document.getElementById("logoutBtn");

// Nav
const navBtns = document.querySelectorAll(".nav-btn");
const views = {
  home: document.getElementById("homeView"),
  plan: document.getElementById("planView"),
  stats: document.getElementById("statsView"),
  achievements: document.getElementById("achievementsView"),
  settings: document.getElementById("settingsView"),
};

// Home summary
const progressCountEl = document.getElementById("progressCount");
const progressFillEl = document.getElementById("progressFill");
const progressPctEl = document.getElementById("progressPct");

const streakCountEl = document.getElementById("streakCount");
const streakRecordMiniEl = document.getElementById("streakRecordMini");
const flameIcon = document.getElementById("flameIcon");

const levelNumEl = document.getElementById("levelNum");
const levelFillEl = document.getElementById("levelFill");
const xpTextEl = document.getElementById("xpText");

// Home reading
const homeReadingLabel = document.getElementById("homeReadingLabel");
const homeReadingSub = document.getElementById("homeReadingSub");
const todayBox = document.getElementById("todayBox");
const markTodayBtn = document.getElementById("markTodayBtn");
const todayHint = document.getElementById("todayHint");
const prevReadingBtn = document.getElementById("prevReadingBtn");
const nextReadingBtn = document.getElementById("nextReadingBtn");

// Verse
const verseTextEl = document.getElementById("verseText");
const verseRefEl = document.getElementById("verseRef");
const readVerseBtn = document.getElementById("readVerseBtn");
const streakMultPillEl = document.getElementById("streakMultPill");



// Notes UI
const notesDayLabel = document.getElementById("notesDayLabel");
const notesSavedLabel = document.getElementById("notesSavedLabel");
const dayNotesInput = document.getElementById("dayNotesInput");
const saveDayNotesBtn = document.getElementById("saveDayNotesBtn");
const clearDayNotesBtn = document.getElementById("clearDayNotesBtn");

// Plan view
const planList = document.getElementById("planList");
const planSearch = document.getElementById("planSearch");
const planTitleEl = document.getElementById("planTitle");
const planMetaHint = document.getElementById("planMetaHint");

// Achievements view
const achList = document.getElementById("achList");

// Settings
const startDateInput = document.getElementById("startDateInput");
const saveStartDateBtn = document.getElementById("saveStartDateBtn");
const themeToggle = document.getElementById("themeToggle");
const resetBtn = document.getElementById("resetBtn");
const planPickerList = document.getElementById("planPickerList");
const savePlanBtn = document.getElementById("savePlanBtn");

// Custom plan import UI
const customPlanNameInput = document.getElementById("customPlanNameInput");
const customPlanFileInput = document.getElementById("customPlanFileInput");
const importCustomPlanBtn = document.getElementById("importCustomPlanBtn");
const customPlanMsg = document.getElementById("customPlanMsg");

// Notifications settings UI
const notifEnabledToggle = document.getElementById("notifEnabledToggle");
const notifTimeInput = document.getElementById("notifTimeInput");
const saveNotifBtn = document.getElementById("saveNotifBtn");
const requestNotifPermBtn = document.getElementById("requestNotifPermBtn");

// Admin tools container (em Configurações)
const adminToolsContainer = document.getElementById("adminToolsContainer");

// Stats view
const finishDateEl = document.getElementById("finishDate");
const finishDaysEl = document.getElementById("finishDays");
const avgPerDayEl = document.getElementById("avgPerDay");
const elapsedDaysEl = document.getElementById("elapsedDays");
const statsCompletedEl = document.getElementById("statsCompleted");
const statsPctEl = document.getElementById("statsPct");
const statsRemainingEl = document.getElementById("statsRemaining");
const statsXpEl = document.getElementById("statsXp");
const statsLevelEl = document.getElementById("statsLevel");
const statsReadsEl = document.getElementById("statsReads");
const statsVersesEl = document.getElementById("statsVerses");
const macroPlanLine1El = document.getElementById("macroPlanLine1");
const macroPlanLine2El = document.getElementById("macroPlanLine2");
const statsStreakNowEl = document.getElementById("statsStreakNow");
const statsStreakRecordEl = document.getElementById("statsStreakRecord");
const statsFlameStateEl = document.getElementById("statsFlameState");
const statsFirstDoneEl = document.getElementById("statsFirstDone");
const statsLastDoneEl = document.getElementById("statsLastDone");
const statsMaxDayEl = document.getElementById("statsMaxDay");
const statsStreakMultiplierEl = document.getElementById("statsStreakMultiplier");


// Motivação
const statsBestStreakEl = document.getElementById("statsBestStreak");
const statsRecoveredEl = document.getElementById("statsRecovered");
const statsCommonHourEl = document.getElementById("statsCommonHour");

// Ritmo atual vs. necessário
const statsPace7El = document.getElementById("statsPace7");
const statsPaceNeedEl = document.getElementById("statsPaceNeed");
const statsPaceHintEl = document.getElementById("statsPaceHint");

// Consistência semanal
const statsWDayEls = [
  document.getElementById("statsWDay0"),
  document.getElementById("statsWDay1"),
  document.getElementById("statsWDay2"),
  document.getElementById("statsWDay3"),
  document.getElementById("statsWDay4"),
  document.getElementById("statsWDay5"),
  document.getElementById("statsWDay6"),
];

const shareBtn = document.getElementById("shareBtn");

/* =========================
   AUTH UI MODE
   ========================= */

function showAuthMode(mode) {
  if (authMsg) authMsg.textContent = "";
  if (mode === "register") {
    loginPanel?.classList.add("hidden");
    registerPanel?.classList.remove("hidden");
  } else {
    registerPanel?.classList.add("hidden");
    loginPanel?.classList.remove("hidden");
  }
}

goRegisterBtn?.addEventListener("click", () => showAuthMode("register"));
goLoginBtn?.addEventListener("click", () => showAuthMode("login"));

/* =========================
   Fetch helper robusto
   ========================= */

async function safeFetchJson(url, options) {
  const r = await fetch(url, options);
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "Resposta inválida do servidor." };
  }
}

/* =========================
   API (intercepta no modo admin)
   ========================= */

async function apiGet(url) {
  if (isAdminMode()) {
    const state = getAdminState();

    if (url.includes("me.php")) {
      return { logged: true, user: state.user };
    }
    if (url.includes("progress.php")) {
      return { ok: true, progress: state.progress };
    }
    if (url.includes("notes.php")) {
      const u = new URL(url, window.location.href);
      const day = Number(u.searchParams.get("day_index") || 0);

      if (day) {
        const txt = state.notes?.[day] || "";
        return { ok: true, note: txt ? { day_index: day, note_text: txt, updated_at: new Date().toISOString() } : null };
      }

      const notesArr = Object.entries(state.notes || {}).map(([k, v]) => ({
        day_index: Number(k),
        note_text: v,
        updated_at: new Date().toISOString()
      })).sort((a, b) => a.day_index - b.day_index);

      return { ok: true, notes: notesArr };
    }
    if (url.includes("logout.php")) {
      setAdminMode(false);
      return { ok: true };
    }
    return { ok: true };
  }

  return safeFetchJson(url, { credentials: "include" });
}

async function apiPost(url, body) {
  if (isAdminMode()) {
    const state = getAdminState();

    if (url.includes("toggle_day.php")) {
      const day = Number(body?.day_index || 0);
      const idx = state.progress.findIndex(p => p.day_index === day);

      if (idx >= 0) {
        state.progress.splice(idx, 1);
        saveAdminState(state);
        progress = state.progress;
        return { ok: true, completed: false };
      } else {
        state.progress.push({ day_index: day, completed_at: new Date().toISOString() });
        state.progress.sort((a, b) => a.day_index - b.day_index);
        saveAdminState(state);
        progress = state.progress;
        return { ok: true, completed: true };
      }
    }

    if (url.includes("set_start_date.php")) {
      if (body?.start_date) state.user.start_date = body.start_date;
      if (body?.theme) state.user.theme = body.theme;
      if (body?.plan_key) state.user.plan_key = body.plan_key;
      saveAdminState(state);
      user = state.user;
      return { ok: true };
    }

    if (url.includes("reset_plan.php")) {
      state.progress = [];
      state.user.total_xp = 0;
      state.user.verse_reads = 0;
      state.achievements = {};
      state.user.achievements_json = null;
      state.notes = {};
      saveAdminState(state);
      progress = [];
      achievements = {};
      notesMap = new Map();
      return { ok: true };
    }

    if (url.includes("update_stats.php")) {
      if (typeof body?.total_xp === "number") state.user.total_xp = body.total_xp;
      if (typeof body?.verse_reads === "number") state.user.verse_reads = body.verse_reads;
      if (body?.achievements_json) {
        state.achievements = body.achievements_json;
        state.user.achievements_json = JSON.stringify(body.achievements_json);
      }
      saveAdminState(state);
      user = state.user;
      achievements = state.achievements || {};
      return { ok: true };
    }

    if (url.includes("notes.php")) {
      const day = Number(body?.day_index || 0);
      const text = String(body?.note_text || "").trim();

      state.notes = state.notes || {};

      if (!day || day < 1 || day > 365) return { ok: false, error: "Invalid day" };

      if (!text) {
        delete state.notes[day];
        saveAdminState(state);
        return { ok: true, deleted: true };
      }

      state.notes[day] = text;
      saveAdminState(state);
      return { ok: true, saved: true };
    }

    if (url.includes("login.php") || url.includes("register.php")) {
      return { ok: true };
    }

    return { ok: true };
  }

  return safeFetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body ?? {})
  });
}

/* =========================
   VIEW TOGGLES
   ========================= */

function showAuth() {
  authView?.classList.remove("hidden");
  appView?.classList.add("hidden");
  document.querySelector(".topbar")?.classList.add("hidden");
  showAuthMode("login");
}

function showApp() {
  authView?.classList.add("hidden");
  appView?.classList.remove("hidden");
  document.querySelector(".topbar")?.classList.remove("hidden");
}

/* =========================
   NAV
   ========================= */

navBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    navBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const v = btn.dataset.view;

    Object.values(views).forEach(x => x?.classList.add("hidden"));
    views[v]?.classList.remove("hidden");

    if (v === "plan") renderPlan();
    if (v === "achievements") renderAchievements();
    if (v === "settings") renderSettings();
    if (v === "stats") renderStats();
  });
});
/* =========================
   CORE CALC
   ========================= */

function getStartDate() {
  return user?.start_date || todayISO();
}

function getDayIndexForDate(dateISO) {
  const start = getStartDate();
  const diff = daysBetween(start, dateISO);
  return diff + 1;
}

function getTodayDayIndex() {
  let idx = getDayIndexForDate(todayISO());
  if (idx < 1) idx = 1;
  if (idx > 365) idx = 365;
  return idx;
}

function getDateForDayIndex(dayIndex) {
  const start = new Date(getStartDate() + "T00:00:00");
  const d = new Date(start.getTime() + (dayIndex - 1) * 86400000);
  return d.toISOString().slice(0, 10);
}

function completedSet() {
  return new Set(progress.map(p => p.day_index));
}

function computeTotalCompleted() {
  return completedSet().size;
}

function getPlanTotalDays() {
  // Tenta pegar dos metadados do plano, se existir
  try {
    const meta = getPlanMetaByKey(user?.plan_key || "alternada");
    if (meta && typeof meta.days === "number" && meta.days > 0) {
      return meta.days;
    }
  } catch (e) {
    // se der erro, ignora e cai no fallback
  }

  // Fallback padrão: plano de 365 dias
  return 365;
}

function dayOfYearFromDate(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = d - start;
  return Math.floor(diff / 86400000) + 1;
}


function computeStreak() {
  const done = completedSet();
  const start = getStartDate();

  const today = todayISO();
  const daysSinceStart = Math.max(0, daysBetween(start, today));

  function dayIndexAtOffset(offset) {
    return offset + 1;
  }

  let count = 0;
  for (let offset = daysSinceStart; offset >= 0; offset--) {
    const di = dayIndexAtOffset(offset);
    if (di > 365) continue;
    if (done.has(di)) count++;
    else break;
  }

  const todayIdx = getTodayDayIndex();
  if (!done.has(todayIdx)) {
    const yesterdayISO = new Date(getNowDate().getTime() - 86400000).toISOString().slice(0, 10);
    const yIdx = getDayIndexForDate(yesterdayISO);
    if (done.has(yIdx)) {
      count = 0;
      for (let offset = daysSinceStart - 1; offset >= 0; offset--) {
        const di = dayIndexAtOffset(offset);
        if (di > 365) continue;
        if (done.has(di)) count++;
        else break;
      }
    } else {
      count = 0;
    }
  }

  const gap = (() => {
    if (progress.length === 0) return 999;
    const last = [...progress].map(p => p.day_index).sort((a, b) => b - a)[0];
    const lastDate = new Date(new Date(start + "T00:00:00").getTime() + (last - 1) * 86400000);
    const lastISO = lastDate.toISOString().slice(0, 10);
    return daysBetween(lastISO, today);
  })();

  const flameOn = gap <= 1;

  return { count, flameOn };
}

function getStreakMultiplier(streak) {
  if (streak >= 30) return 1.2;
  if (streak >= 7) return 1.1;
  return 1.0;
}


function computeAveragePerDay() {
  const start = getStartDate();
  const today = todayISO();
  const elapsed = Math.max(1, daysBetween(start, today) + 1);
  const done = computeTotalCompleted();
  return done / elapsed;
}

function computeFinishForecast() {
  const start = getStartDate();
  const done = computeTotalCompleted();
  const avg = computeAveragePerDay();

  if (avg <= 0) {
    const hardEnd = new Date(new Date(start + "T00:00:00").getTime() + 364 * 86400000);
    return {
      daysLeft: 365 - done,
      date: hardEnd.toISOString().slice(0, 10),
      avg
    };
  }

  const remaining = Math.max(0, 365 - done);
  const estDays = Math.ceil(remaining / avg);
  const estDate = new Date(getNowDate().getTime() + estDays * 86400000);

  return {
    daysLeft: estDays,
    date: estDate.toISOString().slice(0, 10),
    avg
  };
}

function computeLevel(totalXp) {
  const level = Math.floor(totalXp / 100) + 1;
  const into = totalXp % 100;
  const pct = Math.min(100, Math.round((into / 100) * 100));
  return { level, pct, into };
}


// === TÍTULO DO USUÁRIO POR NÍVEL ===
function getUserTitleByLevel(level) {
  if (level >= 100) return "Lenda das Escrituras";
  if (level >= 95)  return "Herói da Fé";
  if (level >= 90)  return "Patriarca da Leitura";
  if (level >= 85)  return "Ancião da Comunidade";
  if (level >= 80)  return "Coluna do Templo";
  if (level >= 75)  return "Lâmpada para os Caminhos";
  if (level >= 70)  return "Teólogo em Treinamento";
  if (level >= 65)  return "Instrutor da Palavra";
  if (level >= 60)  return "Guia da Jornada";
  if (level >= 55)  return "Mentor Bíblico";
  if (level >= 50)  return "Sábio das Escrituras";
  if (level >= 45)  return "Cronista da Fé";
  if (level >= 40)  return "Mestre das Parábolas";
  if (level >= 35)  return "Discípulo Dedicado";
  if (level >= 30)  return "Guardião das Promessas";
  if (level >= 25)  return "Estudioso da Palavra";
  if (level >= 20)  return "Desbravador da Verdade";
  if (level >= 15)  return "Explorador das Escrituras";
  if (level >= 10)  return "Maratonista da Palavra";
  if (level >= 5)   return "Leitor Persistente";
  if (level >= 1)   return "Iniciante";
  return "";
}


/* =========================
   ACH HELPERS
   ========================= */

function normTxt(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function readingTextForDay(day) {
  return normTxt(getReadingHaystack(day));
}

function hasPsalmByDay(day) {
  const t = readingTextForDay(day);
  return t.includes("sl") || t.includes("salmo") || t.includes("salmos") || t.includes("pv") || t.includes("proverb");
}
function hasMatthewByDay(day) {
  const t = readingTextForDay(day);
  return t.includes("mt") || t.includes("mateus");
}
function hasMarkByDay(day) {
  const t = readingTextForDay(day);
  return t.includes("mc") || t.includes("marcos");
}
function hasLukeByDay(day) {
  const t = readingTextForDay(day);
  return t.includes("lc") || t.includes("lucas");
}
function hasRevelationByDay(day) {
  const t = readingTextForDay(day);
  return t.includes("ap") || t.includes("apocalipse");
}
function hasPentateuchByDay(day) {
  const t = readingTextForDay(day);
  return (
    t.includes("gn") || t.includes("genesis") ||
    t.includes("ex") || t.includes("exodo") ||
    t.includes("lv") || t.includes("levitico") ||
    t.includes("nm") || t.includes("numeros") ||
    t.includes("dt") || t.includes("deuteronomio")
  );
}

function categoryAllDoneByDayPredicate(dayPredicate) {
  const done = completedSet();
  const days = [];

  for (let day = 1; day <= 365; day++) {
    if (dayPredicate(day)) days.push(day);
  }

  if (days.length === 0) return false;
  return days.every(d => done.has(d));
}

function categoryProgressByDayPredicate(dayPredicate) {
  const done = completedSet();
  const days = [];

  for (let day = 1; day <= 365; day++) {
    if (dayPredicate(day)) days.push(day);
  }

  const total = days.length;
  const completed = days.filter(d => done.has(d)).length;
  const pct = total ? Math.floor((completed / total) * 100) : 0;

  return { total, completed, pct };
}

/* =========================
   ACHIEVEMENTS
   ========================= */

const ACH_DEFS = [
  { key: "first_day", title: "Primeiro Dia", desc: "Complete 1 dia de leitura.", xp: 20, test: (c) => c.completed >= 1 },
  { key: "days_10", title: "10 Dias", desc: "Complete 10 dias.", xp: 25, test: (c) => c.completed >= 10 },
  { key: "days_30", title: "30 Dias", desc: "Complete 30 dias.", xp: 60, test: (c) => c.completed >= 30 },
  { key: "days_50", title: "50 Dias", desc: "Complete 50 dias.", xp: 80, test: (c) => c.completed >= 50 },
  { key: "days_100", title: "Centenário", desc: "Complete 100 dias.", xp: 150, test: (c) => c.completed >= 100 },
  { key: "days_200", title: "Bicentenário", desc: "Complete 200 dias.", xp: 200, test: (c) => c.completed >= 200 },
  { key: "days_300", title: "Quase Lá", desc: "Complete 300 dias.", xp: 240, test: (c) => c.completed >= 300 },

  { key: "streak_3", title: "Aquecendo", desc: "3 dias seguidos.", xp: 15, test: (c) => c.streak >= 3 },
  { key: "streak_7", title: "Sequência 7", desc: "7 dias seguidos.", xp: 50, test: (c) => c.streak >= 7 },
  { key: "streak_14", title: "Duas Semanas", desc: "14 dias seguidos.", xp: 80, test: (c) => c.streak >= 14 },
  { key: "streak_30", title: "Sequência 30", desc: "30 dias seguidos.", xp: 120, test: (c) => c.streak >= 30 },
  { key: "streak_60", title: "Consistência", desc: "60 dias seguidos.", xp: 180, test: (c) => c.streak >= 60 },
  { key: "streak_100", title: "Imparável", desc: "100 dias seguidos.", xp: 260, test: (c) => c.streak >= 100 },

  { key: "verse_1", title: "Primeiro Versículo", desc: "Leia o versículo do dia 1 vez.", xp: 10, test: (c) => c.verseReads >= 1 },
  { key: "verse_10", title: "Amigo do Verso", desc: "Leia o versículo do dia 10 vezes.", xp: 40, test: (c) => c.verseReads >= 10 },
  { key: "verse_30", title: "Versículos em Dia", desc: "Leia o versículo do dia 30 vezes.", xp: 90, test: (c) => c.verseReads >= 30 },
  { key: "verse_100", title: "Tesouro Diário", desc: "Leia o versículo do dia 100 vezes.", xp: 180, test: (c) => c.verseReads >= 100 },

  { key: "pct_25", title: "25% do Caminho", desc: "Complete 25% do plano.", xp: 70, test: (c) => c.pct >= 25 },
  { key: "pct_50", title: "Metade", desc: "Complete 50% do plano.", xp: 120, test: (c) => c.pct >= 50 },
  { key: "pct_75", title: "Reta Final", desc: "Complete 75% do plano.", xp: 180, test: (c) => c.pct >= 75 },

  { key: "read_all_psalms", title: "Livro dos Salmos", desc: "Complete todos os dias do plano que contêm Salmos/Provérbios.", xp: 140, test: (c) => c.readAllPsalms === true },
  { key: "read_matthew", title: "Evangelho de Mateus", desc: "Complete todos os dias do plano que contêm Mateus.", xp: 80, test: (c) => c.readMatthew === true },
  { key: "read_mark", title: "Evangelho de Marcos", desc: "Complete todos os dias do plano que contêm Marcos.", xp: 80, test: (c) => c.readMark === true },
  { key: "read_luke", title: "Evangelho de Lucas", desc: "Complete todos os dias do plano que contêm Lucas.", xp: 90, test: (c) => c.readLuke === true },
  { key: "read_pentateuch", title: "Pentateuco", desc: "Complete todos os dias do plano que contêm Gênesis, Êxodo, Levítico, Números e Deuteronômio.", xp: 160, test: (c) => c.readPentateuch === true },
  { key: "read_revelation", title: "Apocalipse", desc: "Complete todos os dias do plano que contêm Apocalipse.", xp: 110, test: (c) => c.readRevelation === true },

  { key: "complete_365", title: "Projeto Concluído", desc: "Complete os 365 dias.", xp: 300, test: (c) => c.completed >= 365 },
];

function evaluateAchievements() {
  const streak = computeStreak().count;
  const completed = computeTotalCompleted();
  const verseReads = user?.verse_reads ?? 0;
  const pct = Math.floor((completed / 365) * 100);

  const readAllPsalms = categoryAllDoneByDayPredicate(hasPsalmByDay);
  const readMatthew = categoryAllDoneByDayPredicate(hasMatthewByDay);
  const readMark = categoryAllDoneByDayPredicate(hasMarkByDay);
  const readLuke = categoryAllDoneByDayPredicate(hasLukeByDay);
  const readPentateuch = categoryAllDoneByDayPredicate(hasPentateuchByDay);
  const readRevelation = categoryAllDoneByDayPredicate(hasRevelationByDay);

  const ctx = { streak, completed, verseReads, pct, readAllPsalms, readMatthew, readMark, readLuke, readPentateuch, readRevelation };

  let newlyUnlocked = [];

  ACH_DEFS.forEach(def => {
    if (!achievements[def.key] && def.test(ctx)) {
      achievements[def.key] = { unlocked: true, unlocked_at: new Date().toISOString() };
      newlyUnlocked.push(def);
    }
  });

  return newlyUnlocked;
}
/* =========================
   VERSE OF THE DAY
   ========================= */

function detectDelimiterLine(line){
  const semicolons = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

function parseSimpleCSV(text){
  const cleaned = String(text || "").replace(/^\uFEFF/, "");
  const lines = cleaned
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  if (!lines.length) return { header: [], rows: [], delimiter: "," };

  const delimiter = detectDelimiterLine(lines[0]);
  const header = lines[0].split(delimiter).map(h => h.trim());
  const rows = lines.slice(1).map(l => l.split(delimiter).map(c => c.trim()));

  return { header, rows, delimiter };
}

function normHeaderKey(s){
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function findHeaderIdx(header, candidates){
  const n = header.map(normHeaderKey);
  for (const c of candidates){
    const k = normHeaderKey(c);
    const idx = n.findIndex(h => h === k || h.includes(k));
    if (idx !== -1) return idx;
  }
  return -1;
}

async function loadVersesFromCSV(path){
  versesList = [];
  try{
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return true;

    const text = await res.text();
    const { header, rows } = parseSimpleCSV(text);
    if (!header.length) return true;

    const idxRef = findHeaderIdx(header, ["ref", "referencia", "referência"]);
    const idxTxt = findHeaderIdx(header, ["text", "texto", "versiculo", "versículo"]);

    rows.forEach(r => {
      const ref = idxRef !== -1 ? r[idxRef] : r[0];
      const txt = idxTxt !== -1 ? r[idxTxt] : r[1];

      if (txt && txt.trim()){
        versesList.push({
          ref: String(ref || "").trim(),
          text: String(txt || "").trim()
        });
      }
    });

    return true;
  } catch {
    versesList = [];
    return true;
  }
}


function pickVerseForDate(dateObj) {
  if (!versesList?.length) return null;
  const iso = dateObj.toISOString().slice(0, 10);
  let h = 0;
  for (let i = 0; i < iso.length; i++) h = (h * 31 + iso.charCodeAt(i)) >>> 0;
  const idx = h % versesList.length;
  return versesList[idx];
}

function verseKey() {
  const prefix = isAdminMode() ? "admin" : "user";
  return `${prefix}_verse_claimed_${todayISO()}`;
}

function clearAllVerseClaims() {
  const prefix = isAdminMode() ? "admin_verse_claimed_" : "user_verse_claimed_";
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
}

/* =========================
   NOTES
   ========================= */

async function loadNotes() {
  notesMap = new Map();

  const res = await apiGet(API.notes);
  const list = res?.notes ?? [];

  list.forEach(n => {
    notesMap.set(Number(n.day_index), {
      text: String(n.note_text || ""),
      updated_at: n.updated_at || null
    });
  });
}

function getNoteText(dayIndex) {
  return notesMap.get(dayIndex)?.text || "";
}

function getNoteUpdatedAt(dayIndex) {
  return notesMap.get(dayIndex)?.updated_at || null;
}

async function saveNoteForDay(dayIndex, text) {
  const res = await apiPost(API.notes, { day_index: dayIndex, note_text: text });

  if (!res.ok) {
    showToast("Erro ao salvar nota", res.error || "Tente novamente.");
    return false;
  }

  if (!text.trim()) {
    notesMap.delete(dayIndex);
  } else {
    notesMap.set(dayIndex, { text, updated_at: new Date().toISOString() });
  }

  return true;
}

/* =========================
   HOME helpers
   ========================= */

function getHomeDayIndex() {
  const base = getTodayDayIndex();
  return clamp(base + homeDayOffset, 1, 365);
}

function syncHomeOffsetButtons() {
  const base = getTodayDayIndex();
  const current = getHomeDayIndex();
  if (prevReadingBtn) prevReadingBtn.disabled = current <= 1;
  if (nextReadingBtn) nextReadingBtn.disabled = current >= 365;

  homeDayOffset = current - base;
}

prevReadingBtn?.addEventListener("click", () => {
  homeDayOffset = clamp(homeDayOffset - 1, -400, 400);
  renderHome();
});
nextReadingBtn?.addEventListener("click", () => {
  homeDayOffset = clamp(homeDayOffset + 1, -400, 400);
  renderHome();
});

/* =========================
   RENDER HOME
   ========================= */

function renderTodayReadingBox(reading) {
  if (!todayBox || !reading) return;

  if (reading.mode === "list") {
    const items = reading.items?.length ? reading.items : ["—"];
    todayBox.innerHTML = `
      <div class="today-list">
        ${items.map(x => `<div class="item">${x}</div>`).join("")}
      </div>
    `;
    return;
  }

  todayBox.innerHTML = `
    <div class="row"><span class="tag">AT:</span><span>${reading.ot}</span></div>
    <div class="row"><span class="tag">Sl/Pv:</span><span>${reading.ps}</span></div>
    <div class="row"><span class="tag">NT:</span><span>${reading.nt}</span></div>
  `;
}

function renderNotesBox() {
  if (!notesDayLabel || !notesSavedLabel || !dayNotesInput) return;

  const dayIdx = getHomeDayIndex();
  const isToday = dayIdx === getTodayDayIndex();

  notesDayLabel.textContent = isToday ? `Dia ${dayIdx} (Hoje)` : `Dia ${dayIdx}`;
  const upd = getNoteUpdatedAt(dayIdx);
  notesSavedLabel.textContent = upd ? `Salvo em ${fmtDate(upd)}` : "Sem nota salva";

  dayNotesInput.value = getNoteText(dayIdx);
}

function renderHome() {
  if (userNameEl) {
    userNameEl.textContent = user?.name
      ? `${isAdminMode() ? "🛠️" : "👤"} ${user.name}`
      : "";
  }

  const done = computeTotalCompleted();
  if (progressCountEl) progressCountEl.textContent = `${done}/365`;

  const pct = Math.round((done / 365) * 100);
  if (progressFillEl) progressFillEl.style.width = `${pct}%`;
  if (progressPctEl) progressPctEl.textContent = `${pct}% completo`;

  const { count: streak, flameOn } = computeStreak();
  if (streakCountEl) streakCountEl.textContent = `${streak} dias`;

  const recKey = isAdminMode() ? "admin_streak_record" : "streak_record";
  const rec = Math.max(Number(localStorage.getItem(recKey) || 0), streak);
  localStorage.setItem(recKey, String(rec));

  if (streakRecordMiniEl) streakRecordMiniEl.textContent = `Recorde: ${rec} dias`;
  if (flameIcon) flameIcon.textContent = flameOn ? "🔥" : "🕯️";

  const streakMult = getStreakMultiplier(streak);
  if (streakMultPillEl) {
    streakMultPillEl.textContent = `🔥 Multiplicador de sequência: x${streakMult.toFixed(1)}`;
  }

  const totalXp = user?.total_xp ?? 0;
  const { level, pct: lvlPct } = computeLevel(totalXp);

  if (levelNumEl) levelNumEl.textContent = level;
  if (levelFillEl) levelFillEl.style.width = `${lvlPct}%`;
  if (xpTextEl) xpTextEl.textContent = `${totalXp} XP total`;

  const dayIdx = getHomeDayIndex();
  const reading = getReadingForDay(dayIdx);

  const isToday = dayIdx === getTodayDayIndex();
  if (homeReadingLabel) homeReadingLabel.textContent = isToday ? "Leitura de Hoje" : `Leitura do Dia ${dayIdx}`;
  if (homeReadingSub) homeReadingSub.textContent = `Data do plano: ${fmtDate(getDateForDayIndex(dayIdx))}`;

  renderTodayReadingBox(reading);

  const doneSet = completedSet();
  const dayCompleted = doneSet.has(dayIdx);

  if (markTodayBtn) markTodayBtn.textContent = dayCompleted ? "Desmarcar Leitura" : "Marcar como Lido";
  if (todayHint) todayHint.textContent = isToday
    ? "Você está visualizando o dia de hoje."
    : "Você está visualizando outro dia do plano.";

  syncHomeOffsetButtons();

  verseToday = pickVerseForDate(getNowDate());
  if (verseTextEl) verseTextEl.textContent = verseToday?.text ? `"${verseToday.text}"` : "—";
  if (verseRefEl) verseRefEl.textContent = verseToday?.ref ? `— ${verseToday.ref}` : "";

  verseClaimedToday = localStorage.getItem(verseKey()) === "1";
  if (readVerseBtn) {
    readVerseBtn.textContent = verseClaimedToday ? "XP do versículo já coletado" : "Ler e Ganhar XP";
    readVerseBtn.disabled = verseClaimedToday;
  }

  renderNotesBox();
}

/* =========================
   RENDER PLAN
   ========================= */

function renderPlan() {
  if (!planList || !planTitleEl || !planMetaHint) return;

  const meta = getPlanMetaByKey(user?.plan_key || "alternada");
  planTitleEl.textContent = `${meta.title} (365 dias)`;
  planMetaHint.textContent = meta.hint || "Plano carregado do CSV.";

  const done = completedSet();
  const q = (planSearch?.value || "").toLowerCase();

  let html = "";
  for (let day = 1; day <= 365; day++) {
    const r = getReadingForDay(day);
    const hay = (getReadingHaystack(day) || "").toLowerCase();
    if (q && !hay.includes(q)) continue;

    const doneBadge = done.has(day) ? `<span class="badge-done">Concluído</span>` : "";
    const hasNote = !!getNoteText(day).trim();
    const noteBadge = hasNote ? `<span class="badge-done" title="Tem nota">📝 Nota</span>` : "";

    let body = "";

    if (r?.mode === "list") {
      const items = r.items?.length ? r.items : ["—"];
      body = items.map(x => `<div class="list-line">${x}</div>`).join("");
    } else {
      body = `
        <div class="line"><strong>AT</strong><span>${r?.ot ?? "—"}</span></div>
        <div class="line"><strong>Sl/Pv</strong><span>${r?.ps ?? "—"}</span></div>
        <div class="line"><strong>NT</strong><span>${r?.nt ?? "—"}</span></div>
      `;
    }

    html += `
      <div class="plan-item">
        <div class="head">
          <span>Dia ${day}</span>
          <span style="display:flex; gap:6px;">
            ${noteBadge}
            ${doneBadge}
          </span>
        </div>
        ${body}
        <div style="display:flex; gap:6px; margin-top:8px;">
          <button class="ghost-btn wide" data-toggle-day="${day}">
            ${done.has(day) ? "Desmarcar" : "Marcar como lido"}
          </button>
          <button class="ghost-btn" data-open-note="${day}" title="Abrir nota">📝</button>
        </div>
      </div>
    `;
  }

  planList.innerHTML = html || `<div class="muted">Nada encontrado.</div>`;

  planList.querySelectorAll("[data-toggle-day]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const dayIndex = Number(btn.dataset.toggleDay);
      await toggleDay(dayIndex);
    });
  });

  planList.querySelectorAll("[data-open-note]").forEach(btn => {
    btn.addEventListener("click", () => {
      const dayIndex = Number(btn.dataset.openNote);

      navBtns.forEach(b => b.classList.remove("active"));
      document.querySelector('[data-view="home"]')?.classList.add("active");
      Object.values(views).forEach(v => v?.classList.add("hidden"));
      views.home?.classList.remove("hidden");

      const base = getTodayDayIndex();
      homeDayOffset = dayIndex - base;
      renderHome();

      dayNotesInput?.focus();
    });
  });
}

planSearch?.addEventListener("input", renderPlan);

/* =========================
   RENDER ACHIEVEMENTS
   ========================= */

function renderAchievements() {
  if (!achList) return;

  const done = computeTotalCompleted();
  const streak = computeStreak().count;
  const verseReads = user?.verse_reads ?? 0;

  const bookProgressMap = {
    read_all_psalms: () => categoryProgressByDayPredicate(hasPsalmByDay),
    read_matthew: () => categoryProgressByDayPredicate(hasMatthewByDay),
    read_mark: () => categoryProgressByDayPredicate(hasMarkByDay),
    read_luke: () => categoryProgressByDayPredicate(hasLukeByDay),
    read_pentateuch: () => categoryProgressByDayPredicate(hasPentateuchByDay),
    read_revelation: () => categoryProgressByDayPredicate(hasRevelationByDay),
  };

  achList.innerHTML = ACH_DEFS.map(def => {
    const unlocked = !!achievements[def.key];

    const progFn = bookProgressMap[def.key];
    const prog = progFn ? progFn() : null;

    const progressLine = prog
      ? `<div class="muted small">Progresso: <strong>${prog.completed}/${prog.total}</strong> (${prog.pct}%)</div>`
      : "";

    return `
      <div class="ach-card ${unlocked ? "" : "locked"}">
        <div class="label">${unlocked ? "🏆" : "🔒"} ${def.title}</div>
        <div class="muted small">${def.desc}</div>
        ${progressLine}
        <div class="pill-row">
          <span class="pill">+${def.xp} XP</span>
          <span class="pill">Status: ${unlocked ? "Concluída" : "Pendente"}</span>
        </div>
      </div>
    `;
  }).join("");

  const info = document.createElement("div");
  info.className = "muted small";
  info.style.marginTop = "10px";
  info.textContent = `Progresso atual: ${done} dias, streak ${streak}, versículos lidos ${verseReads}.`;
  achList.appendChild(info);
}
/* =========================
   STATS helpers
   ========================= */

function computeBestHistoricalStreak() {
  const key = isAdminMode() ? "admin_streak_record" : "streak_record";
  return Number(localStorage.getItem(key) || 0);
}

function computeWeekdayConsistency() {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const start = getStartDate();

  progress.forEach(p => {
    const d = new Date(start + "T00:00:00");
    d.setDate(d.getDate() + (p.day_index - 1));
    const w = d.getDay();
    counts[w] = (counts[w] || 0) + 1;
  });

  return { counts, total: progress.length };
}

function computeMostCommonReadingHour() {
  const hours = new Array(24).fill(0);
  progress.forEach(p => {
    const iso = p.completed_at;
    if (!iso) return;
    const h = new Date(iso).getHours();
    if (!Number.isNaN(h)) hours[h]++;
  });

  const max = Math.max(...hours);
  if (max <= 0) return null;
  const h = hours.indexOf(max);
  return String(h).padStart(2, "0") + ":00";
}

function computeRecoveredDays() {
  let recovered = 0;

  progress.forEach(p => {
    const scheduledISO = getDateForDayIndex(p.day_index);
    const completedISO = (p.completed_at || scheduledISO).slice(0, 10);
    const late = daysBetween(scheduledISO, completedISO);
    if (late > 0) recovered++;
  });

  return recovered;
}

function computePaceLast7() {
  const now = getNowDate();
  const cut = new Date(now.getTime() - 6 * 86400000);
  let count = 0;

  const start = getStartDate();

  progress.forEach(p => {
    const d = new Date(start + "T00:00:00");
    d.setDate(d.getDate() + (p.day_index - 1));
    if (d >= new Date(cut.toDateString())) count++;
  });

  return count / 7;
}

function computeNeededPace() {
  const done = computeTotalCompleted();
  const remaining = Math.max(0, 365 - done);

  const start = getStartDate();
  const hardEnd = new Date(new Date(start + "T00:00:00").getTime() + 364 * 86400000);
  const daysLeft = Math.max(1, Math.ceil((hardEnd - getNowDate()) / 86400000));

  return remaining / daysLeft;
}

/* =========================
   RENDER STATS
   ========================= */

function renderStats() {
  const done = computeTotalCompleted();
  const pct = Math.round((done / 365) * 100);
  const remaining = Math.max(0, 365 - done);

  const avg = computeAveragePerDay();
  const start = getStartDate();
  const today = todayISO();
  const elapsed = Math.max(1, daysBetween(start, today) + 1);

  const forecast = computeFinishForecast();

  if (finishDateEl) finishDateEl.textContent = forecast.date ? fmtDate(forecast.date) : "—";
  if (finishDaysEl) finishDaysEl.textContent = forecast.daysLeft != null
    ? `${forecast.daysLeft} dias restantes`
    : "—";

  if (avgPerDayEl) avgPerDayEl.textContent = `${avg.toFixed(2)}/dia`;
  if (elapsedDaysEl) elapsedDaysEl.textContent = `${elapsed} dias desde o início`;

  if (statsCompletedEl) statsCompletedEl.textContent = String(done);
  if (statsPctEl) statsPctEl.textContent = `${pct}%`;
  if (statsRemainingEl) statsRemainingEl.textContent = String(remaining);

  const totalXp = user?.total_xp ?? 0;
  const verseReads = user?.verse_reads ?? 0;
  const { level } = computeLevel(totalXp);

  if (statsXpEl) statsXpEl.textContent = String(totalXp);
  if (statsLevelEl) statsLevelEl.textContent = String(level);
  if (statsVersesEl) statsVersesEl.textContent = String(verseReads);
  if (statsReadsEl) statsReadsEl.textContent = String(done);

  const { count: streak, flameOn } = computeStreak();
  if (statsStreakNowEl) statsStreakNowEl.textContent = `${streak} dias`;

  const recKey = isAdminMode() ? "admin_streak_record" : "streak_record";
  const rec = Number(localStorage.getItem(recKey) || 0);
  if (statsStreakRecordEl) statsStreakRecordEl.textContent = `Recorde: ${rec} dias`;
  if (statsFlameStateEl) statsFlameStateEl.textContent = flameOn ? "Chama ativa." : "Chama fraca.";

  const streakMult = getStreakMultiplier(streak);
  if (statsStreakMultiplierEl) {
    statsStreakMultiplierEl.textContent = `x${streakMult.toFixed(1)}`;
  }


  function renderStats() {
  const done = computeTotalCompleted();
  const pct = Math.round((done / 365) * 100);
  const remaining = Math.max(0, 365 - done);

  const avg = computeAveragePerDay();
  const start = getStartDate();
  const today = todayISO();
  const elapsed = Math.max(1, daysBetween(start, today) + 1);

  const forecast = computeFinishForecast();

  if (finishDateEl) finishDateEl.textContent = forecast.date ? fmtDate(forecast.date) : "—";
  if (finishDaysEl) finishDaysEl.textContent = forecast.daysLeft != null
    ? `${forecast.daysLeft} dias restantes`
    : "—";

  if (avgPerDayEl) avgPerDayEl.textContent = `${avg.toFixed(2)}/dia`;
  if (elapsedDaysEl) elapsedDaysEl.textContent = `${elapsed} dias desde o início`;

  if (statsCompletedEl) statsCompletedEl.textContent = String(done);
  if (statsPctEl) statsPctEl.textContent = `${pct}%`;
  if (statsRemainingEl) statsRemainingEl.textContent = String(remaining);

  const totalXp = user?.total_xp ?? 0;
  const verseReads = user?.verse_reads ?? 0;
  const { level } = computeLevel(totalXp);

  if (statsXpEl) statsXpEl.textContent = String(totalXp);
  if (statsLevelEl) statsLevelEl.textContent = String(level);
  if (statsVersesEl) statsVersesEl.textContent = String(verseReads);
  if (statsReadsEl) statsReadsEl.textContent = String(done);

  const { count: streak, flameOn } = computeStreak();
  if (statsStreakNowEl) statsStreakNowEl.textContent = `${streak} dias`;

  const recKey = isAdminMode() ? "admin_streak_record" : "streak_record";
  const rec = Number(localStorage.getItem(recKey) || 0);
  if (statsStreakRecordEl) statsStreakRecordEl.textContent = `Recorde: ${rec} dias`;
  if (statsFlameStateEl) statsFlameStateEl.textContent = flameOn ? "Chama ativa." : "Chama fraca.";

  const streakMult = getStreakMultiplier(streak);
  if (statsStreakMultiplierEl) {
    statsStreakMultiplierEl.textContent = `x${streakMult.toFixed(1)}`;
  }

  // ---- Visão macro do plano ----
  const totalDaysPlan = getPlanTotalDays();

  // qual dia do plano "deveria" estar hoje (considerando tempo simulado)
  const todayPlanIndex = Math.min(getTodayDayIndex(), totalDaysPlan);
  const diff = done - todayPlanIndex;

  if (macroPlanLine1El) {
    const clamped = Math.min(done, totalDaysPlan);
    macroPlanLine1El.textContent = `Você está no dia ${clamped} de ${totalDaysPlan}.`;
  }

  if (macroPlanLine2El) {
    if (diff > 0) {
      macroPlanLine2El.textContent =
        `Você está ${diff} dia${diff === 1 ? "" : "s"} adiantado.`;
    } else if (diff < 0) {
      const abs = Math.abs(diff);
      macroPlanLine2El.textContent =
        `Você está ${abs} dia${abs === 1 ? "" : "s"} atrasado.`;
    } else {
      macroPlanLine2El.textContent = "Você está em dia com o plano. 🙌";
    }
  }

  const daysSorted = [...progress].map(p => p.day_index).sort((a, b) => a - b);
  const firstDay = daysSorted[0];
  const lastDay = daysSorted[daysSorted.length - 1];

  if (statsFirstDoneEl) statsFirstDoneEl.textContent = firstDay ? `Dia ${firstDay} (${fmtDate(getDateForDayIndex(firstDay))})` : "—";
  if (statsLastDoneEl) statsLastDoneEl.textContent = lastDay ? `Dia ${lastDay} (${fmtDate(getDateForDayIndex(lastDay))})` : "—";
  if (statsMaxDayEl) statsMaxDayEl.textContent = lastDay ? `Dia ${lastDay}` : "—";

  const best = computeBestHistoricalStreak();
  if (statsBestStreakEl) statsBestStreakEl.textContent = `${best} dias`;

  const recovered = computeRecoveredDays();
  if (statsRecoveredEl) statsRecoveredEl.textContent = String(recovered);

  const commonHour = computeMostCommonReadingHour();
  if (statsCommonHourEl) statsCommonHourEl.textContent = commonHour || "—";

  const pace7 = computePaceLast7();
  const need = computeNeededPace();

  if (statsPace7El) statsPace7El.textContent = `${pace7.toFixed(2)}/dia`;
  if (statsPaceNeedEl) statsPaceNeedEl.textContent = `${need.toFixed(2)}/dia`;

  if (statsPaceHintEl) {
    statsPaceHintEl.textContent = pace7 >= need
      ? "Você está no ritmo. 💪"
      : "Um pequeno empurrão e você entra no ritmo. 🫶";
  }

  const { counts, total } = computeWeekdayConsistency();
  statsWDayEls?.forEach((el, i) => {
    if (!el) return;
    const c = counts[i] || 0;
    const pctW = total ? Math.round((c / total) * 100) : 0;
    el.textContent = `${c} (${pctW}%)`;
  });

  renderBookProgressPanel(progress);
}


  const daysSorted = [...progress].map(p => p.day_index).sort((a, b) => a - b);
  const firstDay = daysSorted[0];
  const lastDay = daysSorted[daysSorted.length - 1];

  if (statsFirstDoneEl) statsFirstDoneEl.textContent = firstDay ? `Dia ${firstDay} (${fmtDate(getDateForDayIndex(firstDay))})` : "—";
  if (statsLastDoneEl) statsLastDoneEl.textContent = lastDay ? `Dia ${lastDay} (${fmtDate(getDateForDayIndex(lastDay))})` : "—";
  if (statsMaxDayEl) statsMaxDayEl.textContent = lastDay ? `Dia ${lastDay}` : "—";

  const best = computeBestHistoricalStreak();
  if (statsBestStreakEl) statsBestStreakEl.textContent = `${best} dias`;

  const recovered = computeRecoveredDays();
  if (statsRecoveredEl) statsRecoveredEl.textContent = String(recovered);

  const commonHour = computeMostCommonReadingHour();
  if (statsCommonHourEl) statsCommonHourEl.textContent = commonHour || "—";

  const pace7 = computePaceLast7();
  const need = computeNeededPace();

  if (statsPace7El) statsPace7El.textContent = `${pace7.toFixed(2)}/dia`;
  if (statsPaceNeedEl) statsPaceNeedEl.textContent = `${need.toFixed(2)}/dia`;

  if (statsPaceHintEl) {
    statsPaceHintEl.textContent = pace7 >= need
      ? "Você está no ritmo. 💪"
      : "Um pequeno empurrão e você entra no ritmo. 🫶";
  }

  const { counts, total } = computeWeekdayConsistency();
  statsWDayEls?.forEach((el, i) => {
    if (!el) return;
    const c = counts[i] || 0;
    const pctW = total ? Math.round((c / total) * 100) : 0;
    el.textContent = `${c} (${pctW}%)`;
  });

  renderBookProgressPanel(progress);
}

/* =========================
   SETTINGS
   ========================= */

function renderPlanPicker() {
  if (!planPickerList) return;

  const current = user?.plan_key || "alternada";
  const plans = getAllPlans();

  planPickerList.innerHTML = plans.map(p => {
    const checked = p.key === current ? "checked" : "";

    const delBtn = isCustomPlan(p)
      ? `<button type="button"
                 class="danger-btn"
                 style="margin-left:auto; padding:6px 10px; font-size:12px;"
                 data-delete-plan="${p.key}"
                 title="Excluir plano personalizado">
            Excluir
         </button>`
      : "";

    return `
      <label class="plan-option ${p.key === current ? "selected" : ""}" data-plan-option="${p.key}"
             style="display:flex; align-items:center; gap:10px;">
        <input type="radio" name="planKeyRadio" value="${p.key}" ${checked} />
        <div class="plan-txt">
          <div class="plan-title">${p.title}</div>
          <div class="plan-desc">${p.desc || ""}</div>
          <div class="muted small">${p.hint || ""}</div>
        </div>
        ${delBtn}
      </label>
    `;
  }).join("");

  // Seleção visual
  planPickerList.querySelectorAll('input[name="planKeyRadio"]').forEach(r => {
    r.addEventListener("change", () => {
      planPickerList.querySelectorAll(".plan-option").forEach(el => el.classList.remove("selected"));
      const box = planPickerList.querySelector(`[data-plan-option="${r.value}"]`);
      if (box) box.classList.add("selected");
    });
  });

  // Exclusão de plano personalizado
  planPickerList.querySelectorAll("[data-delete-plan]").forEach(btn => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const key = btn.dataset.deletePlan;
      const plan = getAllPlans().find(p => p.key === key);
      if (!plan) return;

      const ok = confirm(`Excluir o plano "${plan.title}"?\n\nIsso remove o plano apenas da sua conta neste navegador.`);
      if (!ok) return;

      deleteCustomPlan(key);

      // Se o usuário estava usando esse plano, volta pro padrão
      if (user?.plan_key === key) {
        const fallbackKey = BUILTIN_PLANS?.[0]?.key || "alternada";
        user.plan_key = fallbackKey;

        const meta = getPlanMetaByKey(fallbackKey);
        planReady = loadPlanFromCSV(meta.csvText || meta.file, meta);
        await planReady;

        await apiPost(API.setStart, {
          start_date: user.start_date ?? todayISO(),
          theme: user.theme ?? "dark",
          plan_key: user.plan_key
        });
      }

      renderSettings();
      refreshAfterTimeChange();
      showToast("Plano excluído", `O plano "${plan.title}" foi removido.`);
    });
  });
}

function renderNotificationsSettings() {
  if (!notifEnabledToggle || !notifTimeInput) return;

  notifEnabledToggle.checked = getNotifEnabled();
  notifTimeInput.value = getNotifTime();
}

/* -------------------------
   ADMIN TOOLS (compacto)
-------------------------- */

function renderAdminTools() {
  if (!adminToolsContainer) return;
  if (!isAdminMode()) {
    adminToolsContainer.innerHTML = "";
    return;
  }

  const simDate = getNowDate();
  const simISO = simDate.toISOString().slice(0, 10);
  const realISO = new Date().toISOString().slice(0, 10);
  const offsetDays = getAdminOffsetDays();
  const auto = getAdminAutoSeconds();

  const offsetLabel =
    offsetDays === 0
      ? "sincronizado com o tempo real"
      : `${offsetDays > 0 ? "+" : ""}${offsetDays} dia(s) em relação ao tempo real`;

  adminToolsContainer.innerHTML = `
    <hr/>
    <div class="label" style="margin-bottom:6px;">🛠️ Ferramentas do Admin</div>

    <div class="muted small" style="margin-bottom:12px;">
      Tempo simulado: <strong>${simISO}</strong>
      (${offsetLabel})
      • Tempo real: ${realISO}
    </div>

    <!-- TEMPO SIMULADO -->
    <div class="plan-picker" style="margin-bottom:14px;">
      <div class="label">Tempo simulado</div>

      <div class="pill-row" style="margin-top:6px; flex-wrap:wrap;">
        <button class="ghost-btn" data-adm-jump="-30">-30</button>
        <button class="ghost-btn" data-adm-jump="-7">-7</button>
        <button class="ghost-btn" data-adm-jump="-1">-1</button>
        <button class="ghost-btn" data-adm-jump="1">+1</button>
        <button class="ghost-btn" data-adm-jump="7">+7</button>
        <button class="ghost-btn" data-adm-jump="30">+30</button>
        <button class="danger-btn" id="admBackToRealBtn">Tempo real</button>
      </div>

      <div class="settings-row" style="margin-top:10px; grid-template-columns: 1fr auto auto;">
        <div>
          <div class="label">Definir data simulada específica</div>
          <div class="muted small">Calcula o offset a partir da data real de hoje.</div>
        </div>
        <input type="date" id="admSimDateInput" />
        <button class="secondary" id="admApplySimDateBtn">Aplicar</button>
      </div>
    </div>

    <!-- AUTO-AVANÇAR + VERSÍCULO DO DIA -->
    <div class="plan-picker" style="margin-bottom:14px;">
      <div class="label">Auto-avançar</div>
      <div class="pill-row" style="margin-top:6px;">
        <button class="ghost-btn" data-adm-auto="1">1s</button>
        <button class="ghost-btn" data-adm-auto="2">2s</button>
        <button class="ghost-btn" data-adm-auto="5">5s</button>
        <button class="ghost-btn" data-adm-auto="10">10s</button>
        <button class="danger-btn" id="admAutoStopBtn">Parar</button>
      </div>
      <div class="muted small" style="margin-top:6px;">
        Status: ${auto > 0 ? `ativo a cada ${auto}s` : "desligado"}
      </div>
      <div class="pill-row" style="margin-top:10px;">
        <button class="ghost-btn" id="admClearVerseClaimsBtn">
          Limpar só versículos do dia
        </button>
      </div>
    </div>

    <!-- PROGRESSO EM MASSA -->
    <div class="plan-picker" style="margin-bottom:14px;">
      <div class="label">Progresso em massa</div>
      <div class="muted small" style="margin-bottom:8px;">
        Afeta apenas o estado local do Admin (não mexe em usuários reais).
      </div>

      <!-- Próximos 7/30/100 dias -->
      <div class="pill-row" style="margin-top:4px; margin-bottom:10px;">
        <button class="secondary" data-adm-mass-next="7">Próximos 7 dias</button>
        <button class="secondary" data-adm-mass-next="30">Próximos 30 dias</button>
        <button class="secondary" data-adm-mass-next="100">Próximos 100 dias</button>
      </div>

      <!-- Intervalo tipo 10-25 -->
      <div class="settings-row" style="grid-template-columns: 1fr auto auto;">
        <div>
          <div class="label">Marcar intervalo de dias</div>
          <div class="muted small">Ex.: <strong>10-25</strong> (entre 1 e 365).</div>
        </div>
        <input type="text" id="admRangeInput" placeholder="ex.: 10-25" />
        <button class="secondary" id="admRangeApplyBtn">Aplicar</button>
      </div>

      <!-- Preencher aleatório -->
      <div class="settings-row" style="grid-template-columns: 1fr auto auto;">
        <div>
          <div class="label">Preencher progresso aleatório</div>
          <div class="muted small">Marca N dias aleatórios ainda não concluídos.</div>
        </div>
        <input type="number" id="admRandomCountInput" min="1" max="365" placeholder="N" />
        <button class="secondary" id="admRandomApplyBtn">Preencher</button>
      </div>

      <!-- Quebrar streak -->
      <div class="settings-row danger" style="grid-template-columns: 1fr auto;">
        <div>
          <div class="label">Quebrar streak (Admin)</div>
          <div class="muted small">
            Remove a leitura de <strong>ontem</strong> (no tempo simulado) para testar resets de sequência.
          </div>
        </div>
        <button class="danger-btn" id="admBreakStreakBtn">Quebrar streak</button>
      </div>
    </div>

    <!-- PLANO (CSV) -->
    <div class="plan-picker" style="margin-bottom:14px;">
      <div class="label">Plano (CSV)</div>
      <div class="muted small" style="margin-bottom:8px;">
        Informações sobre o plano carregado neste navegador.
      </div>

      <div class="muted small">
        Dias detectados no CSV atual:
        <strong>${getCurrentPlanDayCount()}</strong>
      </div>

      <div class="pill-row" style="margin-top:8px; flex-wrap:wrap;">
        <button class="secondary" id="admReloadPlanBtn">Recarregar CSV do plano</button>
        <button class="danger-btn" id="admResetAdminLocalBtn">Reset Admin Local</button>
      </div>

      <div class="muted small" style="margin-top:6px;">
        O reset limpa: progresso, record, offset de tempo simulado e auto-avançar
        (apenas neste navegador).
      </div>
    </div>
  `;

  // --- Preenche input de data simulada com a data atual simulada ---
  const simInput = adminToolsContainer.querySelector("#admSimDateInput");
  if (simInput) {
    simInput.value = simISO;
  }

  // --------- TEMPO SIMULADO: pulo rápido (-30, -7, -1, +1, +7, +30) ----------
  adminToolsContainer.querySelectorAll("[data-adm-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const delta = Number(btn.dataset.admJump || "0");
      if (!Number.isFinite(delta)) return;
      setAdminOffsetDays(getAdminOffsetDays() + delta);
      refreshAfterTimeChange();
      renderSettings();
    });
  });

  // Voltar para o tempo real (offset = 0)
  const backBtn = adminToolsContainer.querySelector("#admBackToRealBtn");
  backBtn?.addEventListener("click", () => {
    setAdminOffsetDays(0);
    refreshAfterTimeChange();
    renderSettings();
  });

  // Definir uma data simulada específica
  const applyBtn = adminToolsContainer.querySelector("#admApplySimDateBtn");
  applyBtn?.addEventListener("click", () => {
    const iso = simInput?.value;
    if (!iso) {
      showToast("Data inválida", "Escolha uma data simulada.");
      return;
    }
    const realToday = new Date().toISOString().slice(0, 10);
    const diff = daysBetween(realToday, iso); // B - A (hoje -> data simulada)
    setAdminOffsetDays(diff);
    refreshAfterTimeChange();
    renderSettings();
  });

  // --------- AUTO-AVANÇAR 1/2/5/10s + PARAR ----------
  adminToolsContainer.querySelectorAll("[data-adm-auto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = Number(btn.dataset.admAuto);
      if (!Number.isFinite(s) || s <= 0) return;
      startAdminAutoAdvance(s);
      renderSettings();
    });
  });

  const stopBtn = adminToolsContainer.querySelector("#admAutoStopBtn");
  stopBtn?.addEventListener("click", () => {
    stopAdminAutoAdvance();
    renderSettings();
  });

  // Limpar somente os "claims" do versículo do dia
  const clearVerseBtn = adminToolsContainer.querySelector("#admClearVerseClaimsBtn");
  clearVerseBtn?.addEventListener("click", () => {
    clearAllVerseClaims();
    showToast("Versículos resetados", "Claims do versículo do dia foram limpos.");
    refreshAfterTimeChange();
  });

  // ===================== PROGRESSO EM MASSA =====================

  // Helper interno: aplica um conjunto de dias lidos no estado do Admin
  function adminMarkDays(dayList, toastMsg) {
    const state = getAdminState();
    state.progress = state.progress || [];

    const doneSet = new Set(state.progress.map((p) => Number(p.day_index)));
    const nowIso = new Date().toISOString();
    let added = 0;

    dayList.forEach((d) => {
      const day = Number(d);
      if (!Number.isFinite(day)) return;
      if (day < 1 || day > 365) return;
      if (doneSet.has(day)) return;
      state.progress.push({ day_index: day, completed_at: nowIso });
      doneSet.add(day);
      added++;
    });

    if (!added) {
      showToast("Sem mudanças", "Nenhum dia novo foi marcado.");
      return;
    }

    state.progress.sort((a, b) => a.day_index - b.day_index);
    saveAdminState(state);
    progress = state.progress;
    recomputeAndSyncXp(true);
    refreshAfterTimeChange();
    renderSettings();
    showToast("Progresso atualizado", toastMsg || `${added} dia(s) marcado(s) no modo Admin.`);
  }

  // --- Marcar próximos 7/30/100 dias ---
  adminToolsContainer.querySelectorAll("[data-adm-mass-next]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const n = Number(btn.dataset.admMassNext || "0");
      if (!Number.isFinite(n) || n <= 0) return;
      const startDay = getTodayDayIndex();
      const days = [];
      for (let i = 0; i < n; i++) {
        const d = startDay + i;
        if (d >= 1 && d <= 365) days.push(d);
      }
      if (!days.length) {
        showToast("Nada a marcar", "Nenhum dia válido encontrado no intervalo.");
        return;
      }
      adminMarkDays(days, `Próximos ${days.length} dia(s) a partir de hoje marcados como concluídos.`);
    });
  });

  // --- Marcar intervalo tipo 10-25 ---
  const rangeInput = adminToolsContainer.querySelector("#admRangeInput");
  const rangeBtn = adminToolsContainer.querySelector("#admRangeApplyBtn");
  rangeBtn?.addEventListener("click", () => {
    const raw = (rangeInput?.value || "").trim();
    if (!raw) {
      showToast("Intervalo vazio", 'Digite algo como "10-25".');
      return;
    }
    const match = raw.match(/^\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$/);
    if (!match) {
      showToast("Formato inválido", 'Use o formato "início-fim", ex.: 10-25.');
      return;
    }
    let a = Number(match[1]);
    let b = Number(match[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      showToast("Números inválidos", "Use valores de 1 a 365.");
      return;
    }
    if (a > b) [a, b] = [b, a];

    a = Math.max(1, Math.min(365, a));
    b = Math.max(1, Math.min(365, b));
    if (a > b) {
      showToast("Intervalo inválido", "Certifique-se de que o intervalo está entre 1 e 365.");
      return;
    }

    const days = [];
    for (let d = a; d <= b; d++) days.push(d);
    adminMarkDays(days, `Dias ${a} até ${b} marcados como concluídos.`);
  });

  // --- Preencher progresso aleatório com N dias ---
  const randomInput = adminToolsContainer.querySelector("#admRandomCountInput");
  const randomBtn = adminToolsContainer.querySelector("#admRandomApplyBtn");
  randomBtn?.addEventListener("click", () => {
    const n = Number(randomInput?.value || "0");
    if (!Number.isFinite(n) || n <= 0) {
      showToast("Valor inválido", "Informe um número de dias maior que zero.");
      return;
    }

    const state = getAdminState();
    state.progress = state.progress || [];
    const doneSet = new Set(state.progress.map((p) => Number(p.day_index)));

    const available = [];
    for (let d = 1; d <= 365; d++) {
      if (!doneSet.has(d)) available.push(d);
    }
    if (!available.length) {
      showToast("Sem dias disponíveis", "Todos os 365 dias já estão marcados.");
      return;
    }

    // Embaralha (Fisher–Yates)
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }

    const count = Math.min(n, available.length);
    const pick = available.slice(0, count);
    adminMarkDays(pick, `${count} dia(s) aleatório(s) marcados como concluídos.`);
  });

  // --- Quebrar streak removendo "ontem" (no tempo simulado) ---
  const breakBtn = adminToolsContainer.querySelector("#admBreakStreakBtn");
  breakBtn?.addEventListener("click", () => {
    const state = getAdminState();
    state.progress = state.progress || [];

    const simNow = getNowDate();
    const y = new Date(simNow.getTime() - 86400000);
    const yISO = y.toISOString().slice(0, 10);
    const yIdx = getDayIndexForDate(yISO);

    if (!yIdx || yIdx < 1 || yIdx > 365) {
      showToast("Nada a remover", "Ontem está fora do intervalo 1-365 do plano.");
      return;
    }

    const before = state.progress.length;
    state.progress = state.progress.filter((p) => Number(p.day_index) !== yIdx);

    if (state.progress.length === before) {
      showToast("Nada removido", "Ontem já estava sem leitura marcada.");
      return;
    }

    saveAdminState(state);
    progress = state.progress;
    recomputeAndSyncXp(true);
    refreshAfterTimeChange();
    renderSettings();
    showToast(
      "Streak quebrada",
      `Leitura do dia ${yIdx} (ontem no tempo simulado) foi removida.`
    );
  });

  // --- Botões de plano: recarregar CSV + reset local do Admin ---
  const reloadPlanBtn = adminToolsContainer.querySelector("#admReloadPlanBtn");
  reloadPlanBtn?.addEventListener("click", () => {
    reloadPlanFromCsvAdmin();
  });

  const resetAdminBtn = adminToolsContainer.querySelector("#admResetAdminLocalBtn");
  resetAdminBtn?.addEventListener("click", () => {
    const ok = confirm(
      "Tem certeza que deseja resetar TODO o estado local do Admin (progresso, record, offset, auto)?"
    );
    if (!ok) return;
    resetAdminLocalState();
    renderSettings();
  });
}

/* =========================
   HELPERS DO MODO ADMIN
   ========================= */

// Conta quantos dias existem no plano atual (CSV já carregado)
function getCurrentPlanDayCount() {
  try {
    // Se a sua app tiver algo como getActivePlan(), usa aqui:
    if (typeof getActivePlan === "function") {
      const p = getActivePlan();
      if (p && Array.isArray(p.days)) return p.days.length;
    }

    if (typeof window !== "undefined") {
      const w = window;
      if (Array.isArray(w.planDays)) return w.planDays.length;
      if (w.currentPlan && Array.isArray(w.currentPlan.days)) return w.currentPlan.days.length;
      if (Array.isArray(w.plan)) return w.plan.length;
    }
  } catch (err) {
    console.error("Erro ao contar dias do plano:", err);
  }
  return 0;
}

// Recarrega o CSV do plano (apenas Admin/local)
function reloadPlanFromCsvAdmin() {
  try {
    // Caminho 1: se existir uma função específica da sua app, use-a.
    if (typeof reloadCurrentPlanFromCsv === "function") {
      reloadCurrentPlanFromCsv();
      showToast("Plano recarregado", "CSV do plano foi recarregado.");
      if (typeof refreshAfterTimeChange === "function") refreshAfterTimeChange();
      if (typeof renderSettings === "function") renderSettings();
      return;
    }

    // Caminho 2: tenta ler do localStorage com algumas chaves comuns
    let raw = "";
    if (typeof localStorage !== "undefined") {
      raw =
        localStorage.getItem("vt_plan_csv") ||
        localStorage.getItem("plan_csv") ||
        localStorage.getItem("reading_plan_csv") ||
        "";
    }

    if (!raw) {
      showToast(
        "Nenhum CSV encontrado",
        "Não há CSV salvo no localStorage para recarregar. Faça upload do plano primeiro."
      );
      return;
    }

    // Procura funções comuns de parser/carregamento de plano
    if (typeof loadPlanFromCsvString === "function") {
      loadPlanFromCsvString(raw);
    } else if (typeof loadPlanFromCsv === "function") {
      loadPlanFromCsv(raw);
    } else if (typeof parsePlanCsv === "function" && typeof applyParsedPlan === "function") {
      const parsed = parsePlanCsv(raw);
      applyParsedPlan(parsed);
    } else {
      showToast(
        "Função ausente",
        "Adapte reloadPlanFromCsvAdmin para usar suas funções de plano (ex.: loadPlanFromCsvString)."
      );
      return;
    }

    showToast("Plano recarregado", "CSV do plano processado novamente.");
    if (typeof refreshAfterTimeChange === "function") refreshAfterTimeChange();
    if (typeof renderSettings === "function") renderSettings();
  } catch (err) {
    console.error("Erro ao recarregar plano CSV (Admin):", err);
    showToast("Erro", "Falha ao recarregar o CSV do plano. Veja o console.");
  }
}

// Reset Admin Local (limpa state/offset/auto/record)
function resetAdminLocalState() {
  try {
    // Zera offset / auto avançar
    if (typeof setAdminOffsetDays === "function") setAdminOffsetDays(0);
    if (typeof stopAdminAutoAdvance === "function") stopAdminAutoAdvance();

    try {
      localStorage.removeItem("vt_admin_offset_days");
      localStorage.removeItem("admin_offset_days");
      localStorage.removeItem("vt_admin_auto_seconds");
      localStorage.removeItem("admin_auto_seconds");
    } catch (e) {
      // ignora erro silenciosamente
    }

    // Zera progress / record / xp do Admin
    if (typeof saveAdminState === "function") {
      saveAdminState({ progress: [], record: [], xp: 0 });
    }

    try {
      localStorage.removeItem("vt_admin_state");
      localStorage.removeItem("admin_state");
      localStorage.removeItem("admin_record");
    } catch (e) {
      // ignora
    }

    if (typeof progress !== "undefined") {
      progress = [];
    }

    if (typeof recomputeAndSyncXp === "function") {
      recomputeAndSyncXp(true);
    }

    if (typeof refreshAfterTimeChange === "function") {
      refreshAfterTimeChange();
    }

    showToast(
      "Admin resetado",
      "State/offset/auto/record do modo Admin foram limpos neste navegador."
    );
  } catch (err) {
    console.error("Erro ao resetar Admin local:", err);
    showToast("Erro", "Falha ao resetar Admin local. Veja o console.");
  }
}



function renderSettings() {
  if (startDateInput) startDateInput.value = user?.start_date || "";
  if (themeToggle) themeToggle.checked = (user?.theme ?? "dark") === "dark";

  renderPlanPicker();
  renderNotificationsSettings();
  renderAdminTools();
}

/* =========================
   ACTIONS
   ========================= */

async function toggleDay(dayIndex) {
  const res = await apiPost(API.toggleDay, { day_index: dayIndex });
  if (!res.ok) return;

  await loadProgress();
  recomputeAndSyncXp();
  refreshAfterTimeChange();
}

markTodayBtn?.addEventListener("click", async () => {
  const dayIdx = getHomeDayIndex();
  await toggleDay(dayIdx);
  scheduleSmartNotifications();
});

/* =========================
   NOTAS events
   ========================= */

saveDayNotesBtn?.addEventListener("click", async () => {
  const dayIdx = getHomeDayIndex();
  const text = dayNotesInput?.value || "";

  const ok = await saveNoteForDay(dayIdx, text);
  if (ok) {
    if (notesSavedLabel) {
      notesSavedLabel.textContent = text.trim()
        ? `Salvo em ${fmtDate(new Date().toISOString())}`
        : "Nota removida";
    }

    showToast("Nota salva", `Dia ${dayIdx} atualizado.`);
    if (!views.plan?.classList.contains("hidden")) renderPlan();
  }
});

clearDayNotesBtn?.addEventListener("click", async () => {
  const dayIdx = getHomeDayIndex();
  if (dayNotesInput) dayNotesInput.value = "";

  const ok = await saveNoteForDay(dayIdx, "");
  if (ok) {
    renderNotesBox();
    showToast("Nota limpa", `Dia ${dayIdx} sem anotação.`);
    if (!views.plan?.classList.contains("hidden")) renderPlan();
  }
});

dayNotesInput?.addEventListener("blur", async () => {
  const dayIdx = getHomeDayIndex();
  const current = getNoteText(dayIdx);
  const now = dayNotesInput.value || "";

  if (now.trim() !== current.trim()) {
    await saveNoteForDay(dayIdx, now);
    renderNotesBox();
    if (!views.plan?.classList.contains("hidden")) renderPlan();
  }
});

/* =========================
   VERSE button
   ========================= */

readVerseBtn?.addEventListener("click", async () => {
  if (verseClaimedToday) return;

  localStorage.setItem(verseKey(), "1");
  verseClaimedToday = true;

  user.verse_reads = (user.verse_reads ?? 0) + 1;

  // recomputeAndSyncXp já faz o updateStats
  recomputeAndSyncXp(true);

  renderHome();
  if (!views.stats?.classList.contains("hidden")) renderStats();

  showToast("Versículo lido!", `+${VERSE_XP} XP adicionados.`);
});


/* =========================
   NOTIFICATIONS logic
   ========================= */

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("Sem suporte", "Seu navegador não suporta notificações.");
    return false;
  }
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") {
    showToast("Permissão bloqueada", "Ative nas configurações do navegador.");
    return false;
  }
  const p = await Notification.requestPermission();
  return p === "granted";
}

requestNotifPermBtn?.addEventListener("click", async () => {
  const ok = await requestNotificationPermission();
  showToast("Notificações", ok ? "Permissão concedida." : "Permissão não concedida.");
});

saveNotifBtn?.addEventListener("click", () => {
  setNotifEnabled(!!notifEnabledToggle?.checked);
  setNotifTime(notifTimeInput?.value || "20:00");
  showToast("Lembretes salvos", `Horário: ${getNotifTime()}`);
  scheduleSmartNotifications();
});

notifEnabledToggle?.addEventListener("change", () => {
  setNotifEnabled(!!notifEnabledToggle.checked);
  scheduleSmartNotifications();
});

function scheduleSmartNotifications() {
  stopNotificationSchedulers();
  if (!getNotifEnabled()) return;

  const now = getNowDate();
  const [hh, mm] = getNotifTime().split(":").map(n => Number(n || 0));

  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);

  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const ms = target - now;

  notifPrimaryTimer = setTimeout(() => {
    fireSmartReminder("primary");
    scheduleSmartNotifications();
  }, ms);

  notifPollTimer = setInterval(() => {
    const nowISOKey = todayISO();
    const last = localStorage.getItem(NOTIF.lastFiredKey);

    const nowD = getNowDate();
    const targetToday = new Date(nowD);
    targetToday.setHours(hh, mm, 0, 0);

    if (nowD >= targetToday && last !== nowISOKey) {
      fireSmartReminder("primary");
    }
  }, 10 * 60 * 1000);
}

function stopNotificationSchedulers() {
  if (notifPrimaryTimer) clearTimeout(notifPrimaryTimer);
  if (notifPollTimer) clearInterval(notifPollTimer);
  notifPrimaryTimer = null;
  notifPollTimer = null;
}

async function fireBrowserNotification(title, body) {
  const ok = await requestNotificationPermission();
  if (!ok) return;

  try { new Notification(title, { body }); } catch {}
}

function fireSmartReminder(kind) {
  const todayIdx = getTodayDayIndex();
  const done = completedSet().has(todayIdx);
  const todayKey = todayISO();

  if (done) return;

  if (kind === "primary") {
    if (localStorage.getItem(NOTIF.lastFiredKey) === todayKey) return;

    localStorage.setItem(NOTIF.lastFiredKey, todayKey);
    localStorage.removeItem(NOTIF.followFiredKey);

    const { count: streak } = computeStreak();
    const msg = streak >= 3
      ? `Sua sequência está em ${streak} dias. Faça a leitura de hoje para manter!`
      : `Você ainda não concluiu a leitura de hoje.`;

    showToast("Lembrete de leitura", msg, [
      {
        label: "Ir para hoje",
        variant: "secondary",
        onClick: () => {
          homeDayOffset = 0;
          navBtns.forEach(b => b.classList.remove("active"));
          document.querySelector('[data-view="home"]')?.classList.add("active");
          Object.values(views).forEach(v => v?.classList.add("hidden"));
          views.home?.classList.remove("hidden");
          renderHome();
        }
      }
    ]);

    fireBrowserNotification("Leitura do dia", msg);

    setTimeout(() => {
      const stillDone = completedSet().has(getTodayDayIndex());
      if (!stillDone && localStorage.getItem(NOTIF.followFiredKey) !== todayKey) {
        localStorage.setItem(NOTIF.followFiredKey, todayKey);

        const msg2 = "Passando só pra lembrar: sua leitura de hoje ainda está pendente.";
        showToast("Segundo lembrete", msg2);
        fireBrowserNotification("Segundo lembrete", msg2);
      }
    }, 2 * 60 * 60 * 1000);
  }
}

/* =========================
   XP RECOMPUTE
   ========================= */

function recomputeAndSyncXp(force = false) {
  const completed = computeTotalCompleted();
  const base = completed * DAILY_XP;
  const versePart = (user?.verse_reads ?? 0) * VERSE_XP;

  const newly = evaluateAchievements();

  const achXp = ACH_DEFS
    .filter(d => achievements[d.key])
    .reduce((s, d) => s + d.xp, 0);

  const total = base + versePart + achXp;

  if (force || total !== (user.total_xp ?? 0) || newly.length) {
    user.total_xp = total;
    apiPost(API.updateStats, {
      total_xp: user.total_xp,
      achievements_json: achievements,
      verse_reads: user.verse_reads ?? 0
    });

    if (newly.length) {
      newly.forEach(a => {
        showToast("Conquista desbloqueada!", `${a.title} • +${a.xp} XP`);
      });
    }
  }
}

/* =========================
   LOADERS
   ========================= */

async function loadMe() {
  if (isAdminMode()) {
    const state = getAdminState();
    user = state.user;
    progress = state.progress || [];
    achievements = state.achievements || safeJsonParse(user.achievements_json, {});
    notesMap = new Map(
      Object.entries(state.notes || {}).map(([k, v]) => [Number(k), { text: String(v), updated_at: new Date().toISOString() }])
    );
    return true;
  }

  const res = await apiGet(API.me);
  if (!res.logged) {
    user = null;
    return false;
  }

  user = res.user;
  if (!user.plan_key) user.plan_key = "alternada";

  achievements = safeJsonParse(user.achievements_json, {});
  return true;
}

async function loadProgress() {
  const res = await apiGet(API.progress);
  progress = res?.progress ?? [];
}

async function loadAllNotes() {
  if (isAdminMode()) {
    const state = getAdminState();
    notesMap = new Map(
      Object.entries(state.notes || {}).map(([k, v]) => [Number(k), { text: String(v), updated_at: new Date().toISOString() }])
    );
    return;
  }
  await loadNotes();
}

/* =========================
   THEME
   ========================= */

function applyTheme() {
  const t = user?.theme ?? "dark";
  document.body.classList.toggle("dark", t === "dark");
  document.body.classList.toggle("light", t === "light");
}

/* =========================
   AUTH FLOW
   ========================= */

loginBtn?.addEventListener("click", async () => {
  if (authMsg) authMsg.textContent = "";

  const loginValue = (loginEmail?.value || "").trim().toLowerCase();
  const passValue = (loginPass?.value || "").trim();

  // ADMIN LOGIN LOCAL
  if (loginValue === ADMIN_CRED.login && passValue === ADMIN_CRED.pass) {
    setAdminMode(true);

    const state = getAdminState();
    if (!state.user.start_date) state.user.start_date = todayISO();
    if (!state.user.plan_key) state.user.plan_key = "alternada";
    state.notes = state.notes || {};
    saveAdminState(state);

    const meta = getPlanMetaByKey(state.user.plan_key);
    planReady = loadPlanFromCSV(meta.csvText || meta.file, meta);

    versesReady = loadVersesFromCSV(VERSE_FILE);

    await planReady;
    await versesReady;
    await boot();

    const auto = getAdminAutoSeconds();
    if (auto > 0) startAdminAutoAdvance(auto);

    return;
  }

  const res = await apiPost(API.login, {
    email: loginValue,
    password: passValue
  });

  if (!res.ok) {
    if (authMsg) authMsg.textContent = res.error || "Erro ao entrar.";
    return;
  }

  await boot();
});

registerBtn?.addEventListener("click", async () => {
  if (authMsg) authMsg.textContent = "";

  const res = await apiPost(API.register, {
    name: regName?.value || "",
    email: (regEmail?.value || "").trim().toLowerCase(),
    password: regPass?.value || ""
  });

  if (!res.ok) {
    if (authMsg) authMsg.textContent = res.error || "Erro ao cadastrar.";
    return;
  }

  if (authMsg) authMsg.textContent = "Conta criada! Faça login.";
  showAuthMode("login");
});

logoutBtn?.addEventListener("click", async () => {
  stopNotificationSchedulers();
  await apiGet(API.logout);
  user = null;
  progress = [];
  achievements = {};
  notesMap = new Map();
  showAuth();
});

/* =========================
   SETTINGS actions
   ========================= */

saveStartDateBtn?.addEventListener("click", async () => {
  const iso = startDateInput?.value;
  if (!iso) {
    showToast("Data inválida", "Escolha uma data de início.");
    return;
  }

  user.start_date = iso;
  await apiPost(API.setStart, {
    start_date: user.start_date,
    theme: user.theme ?? "dark",
    plan_key: user.plan_key ?? "alternada"
  });

  refreshAfterTimeChange();
  showToast("Data salva", "Data de início atualizada.");
});

themeToggle?.addEventListener("change", async () => {
  user.theme = themeToggle.checked ? "dark" : "light";
  applyTheme();

  await apiPost(API.setStart, {
    start_date: user.start_date ?? todayISO(),
    theme: user.theme,
    plan_key: user.plan_key ?? "alternada"
  });
});

savePlanBtn?.addEventListener("click", async () => {
  const selected = planPickerList?.querySelector('input[name="planKeyRadio"]:checked');
  const key = selected?.value;

  if (!key) {
    showToast("Seleção inválida", "Escolha um plano.");
    return;
  }

  user.plan_key = key;

  const meta = getPlanMetaByKey(key);
  planReady = loadPlanFromCSV(meta.csvText || meta.file, meta);
  await planReady;

  await apiPost(API.setStart, {
    start_date: user.start_date ?? todayISO(),
    theme: user.theme ?? "dark",
    plan_key: user.plan_key
  });

  refreshAfterTimeChange();
  showToast("Plano salvo", `Plano atual: ${meta.title}`);
});

resetBtn?.addEventListener("click", async () => {
  if (!confirm("Tem certeza que deseja resetar seu progresso?")) return;

  const res = await apiPost(API.reset, {});
  if (!res.ok) {
    showToast("Erro", res.error || "Não foi possível resetar.");
    return;
  }

  progress = [];
  achievements = {};
  notesMap = new Map();
  user.total_xp = 0;
  user.verse_reads = 0;

  refreshAfterTimeChange();
  showToast("Reset concluído", "Progresso e conquistas apagados.");
});

/* =========================
   COMPARTILHAR
   ========================= */

shareBtn?.addEventListener("click", async () => {
  const done = computeTotalCompleted();
  const pct = Math.round((done / 365) * 100);
  const { count: streak } = computeStreak();
  const streakMult = getStreakMultiplier(streak);
  const meta = getPlanMetaByKey(user?.plan_key || "alternada");

  const text =
    `📘 Meu progresso no plano "${meta.title}":\n` +
    ` + ✅ ${done}/365 dias (${pct}%)\n` +
    ` + 🔥 Sequência atual: ${streak} dias (x${streakMult.toFixed(1)})\n` +
    ` + ⭐ XP: ${user?.total_xp ?? 0}\n`;

  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch {}
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copiado!", "Texto de progresso copiado para a área de transferência.");
  } catch {
    alert(text);
  }
});


/* =========================
   IMPORTAR PLANO PERSONALIZADO
   ========================= */

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    r.readAsText(file, "utf-8");
  });
}
function isCustomPlan(p) {
  if (!p) return false;
  if (p.type === "custom") return true;
  if (p.csvText) return true;
  const k = String(p.key || "");
  return k.startsWith("custom_");
}



importCustomPlanBtn?.addEventListener("click", async () => {
  if (customPlanMsg) customPlanMsg.textContent = "";

  const name = (customPlanNameInput?.value || "").trim();
  const file = customPlanFileInput?.files?.[0];

  if (!name) {
    showToast("Nome obrigatório", "Informe um nome para o seu plano.");
    return;
  }
  if (!file) {
    showToast("Arquivo obrigatório", "Selecione um arquivo .csv.");
    return;
  }

  try {
    const csvText = await readFileAsText(file);

    // valida carregando diretamente no loader do app
    await loadPlanFromCSV(csvText, { key: "temp", title: name });

    const plan = {
      key: "custom_" + Date.now(),
      title: name,
      desc: "Plano personalizado importado.",
      hint: "Importado via CSV pessoal.",
      csvText,
      type: "custom",
      createdAt: new Date().toISOString()
    };

    upsertCustomPlan(plan);

    // seleciona automaticamente
    user.plan_key = plan.key;

    planReady = loadPlanFromCSV(plan.csvText, plan);
    await planReady;

    await apiPost(API.setStart, {
      start_date: user.start_date ?? todayISO(),
      theme: user.theme ?? "dark",
      plan_key: user.plan_key
    });

    renderSettings();
    refreshAfterTimeChange();

    if (customPlanMsg) customPlanMsg.textContent = `Plano "${name}" importado com sucesso.`;
    if (customPlanFileInput) customPlanFileInput.value = "";
    if (customPlanNameInput) customPlanNameInput.value = "";

    showToast("Plano importado!", `Agora você está usando "${name}".`);
  } catch (e) {
    console.error(e);
    showToast("Erro ao importar", e?.message || "CSV inválido.");
  }
});

/* =========================
   LOAD PLAN on boot/change
   ========================= */

async function ensurePlanLoaded() {
  const meta = getPlanMetaByKey(user?.plan_key || "alternada");
  planReady = loadPlanFromCSV(meta.csvText || meta.file, meta);
  await planReady;
}

/* =========================
   REFRESH central
   ========================= */

function refreshAfterTimeChange() {
  renderHome();

  if (!views.plan?.classList.contains("hidden")) renderPlan();
  if (!views.achievements?.classList.contains("hidden")) renderAchievements();
  if (!views.settings?.classList.contains("hidden")) renderSettings();
  if (!views.stats?.classList.contains("hidden")) renderStats();
}

/* =========================
   BOOT
   ========================= */

async function boot() {
  const ok = await loadMe();
  if (!ok) {
    showAuth();
    return;
  }

  // garante isolamento de planos por usuário
  migrateLegacyCustomPlansForUser();

  await ensurePlanLoaded();

  versesReady = loadVersesFromCSV(VERSE_FILE);
  await versesReady;

  await loadProgress();
  await loadAllNotes();

  applyTheme();
  showApp();

  navBtns.forEach(b => b.classList.remove("active"));
  document.querySelector('[data-view="home"]')?.classList.add("active");
  Object.values(views).forEach(v => v?.classList.add("hidden"));
  views.home?.classList.remove("hidden");

  if (!user.start_date) {
    user.start_date = todayISO();
    await apiPost(API.setStart, {
      start_date: user.start_date,
      theme: user.theme ?? "dark",
      plan_key: user.plan_key ?? "alternada"
    });
  }

  homeDayOffset = 0;

  if (localStorage.getItem(NOTIF.timeKey) == null) setNotifTime("20:00");
  if (localStorage.getItem(NOTIF.enabledKey) == null) setNotifEnabled(false);

  recomputeAndSyncXp(true);
  refreshAfterTimeChange();
  renderSettings();

  scheduleSmartNotifications();
}

/* =========================
   INIT
   ========================= */

(async () => {
  await boot();

  if (isAdminMode()) {
    const auto = getAdminAutoSeconds();
    if (auto > 0) startAdminAutoAdvance(auto);
  }
})();
