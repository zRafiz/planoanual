// plan.js

// Estrutura atual do plano em memória
let currentPlan = {
  meta: null,
  days: [], // cada item: { index, mode, items?, ot?, ps?, nt? }
};

// Normaliza header: tira acento, espaço, maiúsculas/minúsculas
function normHeaderKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Detecta se o CSV usa ; ou ,
function detectDelimiter(line) {
  const semicolons = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

// Faz o parse bruto de um CSV simples
function parseCsv(text) {
  const cleaned = String(text || "").replace(/^\uFEFF/, "");
  const lines = cleaned
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return { header: [], rows: [] };

  const delimiter = detectDelimiter(lines[0]);
  const header = lines[0].split(delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(delimiter).map((c) => c.trim()));

  return { header, rows };
}

// Busca índice de coluna pelo nome normalizado
function findHeaderIdx(header, candidates) {
  const normHdr = header.map(normHeaderKey);
  for (const cand of candidates) {
    const k = normHeaderKey(cand);
    const idx = normHdr.findIndex((h) => h === k || h.includes(k));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Constrói o plano interno a partir do CSV já lido
function buildPlanFromCsv(text, meta = {}) {
  const { header, rows } = parseCsv(text);

  if (!header.length) {
    currentPlan = { meta: { ...meta, days: 0 }, days: [] };
    syncPlanToWindow();
    return;
  }

  // Tenta detectar colunas de plano "AT / Sl-Pv / NT"
  const idxAt = findHeaderIdx(header, ["at", "antigo testamento", "ot"]);
  const idxPs = findHeaderIdx(header, [
    "sl/pv",
    "sl-pv",
    "slpv",
    "salmos/proverbios",
    "salmos e proverbios",
    "salmosproverbios",
  ]);
  const idxNt = findHeaderIdx(header, ["nt", "novo testamento"]);

  // Tenta detectar colunas de mês/dia/leitura
  const idxMes = findHeaderIdx(header, ["mes", "mês", "month"]);
  const idxDia = findHeaderIdx(header, ["dia", "day"]);
  const idxLeitura = findHeaderIdx(header, ["leitura", "texto", "passagem", "reading"]);

  let days = [];

  // 1) Formato AT / Sl-Pv / NT (plano alternado)
  if (idxAt !== -1 || idxPs !== -1 || idxNt !== -1) {
    days = rows.map((cols, i) => {
      const ot = idxAt !== -1 ? (cols[idxAt] || "") : "";
      const ps = idxPs !== -1 ? (cols[idxPs] || "") : "";
      const nt = idxNt !== -1 ? (cols[idxNt] || "") : "";
      return {
        index: i + 1,
        mode: "split",
        ot: ot,
        ps: ps,
        nt: nt,
        items: [ot, ps, nt].filter(Boolean),
      };
    });
  }
  // 2) Formato Mês,Dia,Leitura (como seu plano de Salmos+Pv+NT)
  else if (idxLeitura !== -1 && idxMes !== -1 && idxDia !== -1) {
    const map = new Map(); // key "mes|dia" -> array de leituras
    const order = [];

    rows.forEach((cols) => {
      const mes = cols[idxMes] || "";
      const dia = cols[idxDia] || "";
      const leitura = cols[idxLeitura] || "";
      const key = `${mes}|${dia}`;

      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      if (leitura) map.get(key).push(leitura);
    });

    days = order.map((key, i) => {
      const items = map.get(key) || [];
      return {
        index: i + 1,
        mode: "list",
        items,
        ot: "",
        ps: "",
        nt: "",
      };
    });
  }
  // 3) Formato genérico com coluna "Leitura" (sem mês/dia)
  else if (idxLeitura !== -1) {
    days = rows.map((cols, i) => {
      const leitura = cols[idxLeitura] || "";
      return {
        index: i + 1,
        mode: "list",
        items: leitura ? [leitura] : [],
        ot: "",
        ps: "",
        nt: "",
      };
    });
  }
  // 4) Último recurso: junta o resto em uma string única
  else {
    days = rows.map((cols, i) => {
      const rest = cols.slice(2).join(" ").trim() || cols.join(" ");
      return {
        index: i + 1,
        mode: "list",
        items: rest ? [rest] : [],
        ot: "",
        ps: "",
        nt: "",
      };
    });
  }

  currentPlan = {
    meta: { ...meta, days: days.length },
    days,
  };

  syncPlanToWindow();
}

// Expõe algumas coisas no window para o Admin & helpers do app.js
function syncPlanToWindow() {
  if (typeof window !== "undefined") {
    window.currentPlan = currentPlan;
    window.planDays = currentPlan.days;
    window.plan = currentPlan.days;
    window.getActivePlan = () => currentPlan;
  }
}

/**
 * Carrega um plano a partir de:
 *  - uma string CSV direta (texto com quebras de linha), OU
 *  - uma URL para o CSV (ex.: "./plano_salmos_proverbios_novo_testamento_1_ano.csv")
 *
 * Nunca lança erro — se der ruim, só gera plano vazio.
 */
export async function loadPlanFromCSV(source, meta = {}) {
  let text = "";

  // Se já parece ser CSV em texto (tem quebras de linha), usa direto
  if (typeof source === "string" && (source.includes("\n") || source.includes("\r"))) {
    text = source;
  } else {
    const url = typeof source === "string" ? source : String(source || "");
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.error("Falha ao carregar CSV do plano:", url, res.status);
        text = "";
      } else {
        text = await res.text();
      }
    } catch (e) {
      console.error("Erro de rede ao buscar CSV do plano:", e);
      text = "";
    }
  }

  buildPlanFromCsv(text, meta);
}

/**
 * Retorna o objeto de leitura para um dia (1..N)
 * Estrutura:
 *  - mode: "split" ou "list"
 *  - ot / ps / nt (para "split")
 *  - items: array de strings com as leituras
 */
export function getReadingForDay(dayIndex) {
  const idx = Number(dayIndex) - 1;
  if (!currentPlan.days || idx < 0 || idx >= currentPlan.days.length) {
    return {
      mode: "list",
      items: [],
      ot: "",
      ps: "",
      nt: "",
    };
  }

  const d = currentPlan.days[idx];

  if (d.mode === "split") {
    return {
      mode: "split",
      ot: d.ot || "",
      ps: d.ps || "",
      nt: d.nt || "",
      items: Array.isArray(d.items) ? d.items : [d.ot, d.ps, d.nt].filter(Boolean),
    };
  }

  // default: lista
  return {
    mode: "list",
    items: Array.isArray(d.items) ? d.items : (d.items ? [d.items] : []),
    ot: d.ot || "",
    ps: d.ps || "",
    nt: d.nt || "",
  };
}

/**
 * Texto "pesquisável" para o dia (usado na busca e nos achievements)
 */
export function getReadingHaystack(dayIndex) {
  const r = getReadingForDay(dayIndex);
  if (!r) return "";

  if (r.mode === "list") {
    return (r.items || []).join(" | ");
  }

  return [r.ot, r.ps, r.nt].filter(Boolean).join(" | ");
}

// Opcional: se você quiser acessar o plano ativo de fora
export function getActivePlan() {
  return currentPlan;
}
