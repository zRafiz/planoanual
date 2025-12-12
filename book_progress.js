import { getReadingHaystack } from "./plan.js";

/**
 * Painel de progresso por livros
 * - Usa os dias do plano (1..365)
 * - Detecta livros citados no texto de leitura do dia
 * - Conta:
 *   totalDays: quantos dias do plano mencionam o livro
 *   doneDays: quantos desses dias foram concluídos
 *
 * Observação:
 * isto mede progresso por "dias que contêm o livro",
 * não por capítulos/versos. É simples e funciona bem
 * com qualquer tipo de plano.
 */

const BOOKS = [
  // Pentateuco
  { key: "gn", title: "Gênesis", patterns: [/\bgn\b/i, /\bg[eê]nesis\b/i] },
  { key: "ex", title: "Êxodo", patterns: [/\bex\b/i, /\b[eê]xodo\b/i] },
  { key: "lv", title: "Levítico", patterns: [/\blv\b/i, /\blev[ií]tico\b/i] },
  { key: "nm", title: "Números", patterns: [/\bnm\b/i, /\bn[uú]meros\b/i] },
  { key: "dt", title: "Deuteronômio", patterns: [/\bdt\b/i, /\bdeuteron[oô]mio\b/i] },

  // Históricos
  { key: "js", title: "Josué", patterns: [/\bjs\b/i, /\bjosu[eé]\b/i] },
  { key: "jz", title: "Juízes", patterns: [/\bjz\b/i, /\bju[ií]zes\b/i] },
  { key: "rt", title: "Rute", patterns: [/\brt\b/i, /\brute\b/i] },
  { key: "1sm", title: "1 Samuel", patterns: [/\b1\s*sm\b/i, /\b1\s*samuel\b/i] },
  { key: "2sm", title: "2 Samuel", patterns: [/\b2\s*sm\b/i, /\b2\s*samuel\b/i] },
  { key: "1rs", title: "1 Reis", patterns: [/\b1\s*rs\b/i, /\b1\s*reis\b/i] },
  { key: "2rs", title: "2 Reis", patterns: [/\b2\s*rs\b/i, /\b2\s*reis\b/i] },
  { key: "1cr", title: "1 Crônicas", patterns: [/\b1\s*cr\b/i, /\b1\s*cr[oô]nicas\b/i] },
  { key: "2cr", title: "2 Crônicas", patterns: [/\b2\s*cr\b/i, /\b2\s*cr[oô]nicas\b/i] },
  { key: "ed", title: "Esdras", patterns: [/\bed\b/i, /\besdras\b/i] },
  { key: "ne", title: "Neemias", patterns: [/\bne\b/i, /\bneemias\b/i] },
  { key: "et", title: "Ester", patterns: [/\bet\b/i, /\bester\b/i] },

  // Poéticos / Sabedoria
  { key: "jo", title: "Jó", patterns: [/\bjo\b/i, /\bj[oó]\b/i] },
  { key: "sl", title: "Salmos", patterns: [/\bsl\b/i, /\bsalmos?\b/i] },
  { key: "pv", title: "Provérbios", patterns: [/\bpv\b/i, /\bprov[eé]rbios?\b/i] },
  { key: "ec", title: "Eclesiastes", patterns: [/\bec\b/i, /\beclesiastes\b/i] },
  { key: "ct", title: "Cânticos", patterns: [/\bct\b/i, /\bc[aâ]nticos?\b/i, /\bcantares\b/i] },

  // Profetas Maiores
  { key: "is", title: "Isaías", patterns: [/\bis\b/i, /\bisa[ií]as\b/i] },
  { key: "jr", title: "Jeremias", patterns: [/\bjr\b/i, /\bjeremias\b/i] },
  { key: "lm", title: "Lamentações", patterns: [/\blm\b/i, /\blamenta[cç][oõ]es\b/i] },
  { key: "ez", title: "Ezequiel", patterns: [/\bez\b/i, /\bezequiel\b/i] },
  { key: "dn", title: "Daniel", patterns: [/\bdn\b/i, /\bdaniel\b/i] },

  // Profetas Menores
  { key: "os", title: "Oséias", patterns: [/\bos\b/i, /\bos[eé]ias\b/i] },
  { key: "jl", title: "Joel", patterns: [/\bjl\b/i, /\bjoel\b/i] },
  { key: "am", title: "Amós", patterns: [/\bam\b/i, /\bam[oó]s\b/i] },
  { key: "ob", title: "Obadias", patterns: [/\bob\b/i, /\bobadias\b/i] },
  { key: "jn", title: "Jonas", patterns: [/\bjn\b/i, /\bjonas\b/i] },
  { key: "mq", title: "Miquéias", patterns: [/\bmq\b/i, /\bmiqu[eé]ias\b/i] },
  { key: "na", title: "Naum", patterns: [/\bna\b/i, /\bnaum\b/i] },
  { key: "hc", title: "Habacuque", patterns: [/\bhc\b/i, /\bhabacuque\b/i] },
  { key: "sf", title: "Sofonias", patterns: [/\bsf\b/i, /\bsofonias\b/i] },
  { key: "ag", title: "Ageu", patterns: [/\bag\b/i, /\bageu\b/i] },
  { key: "zc", title: "Zacarias", patterns: [/\bzc\b/i, /\bzacarias\b/i] },
  { key: "ml", title: "Malaquias", patterns: [/\bml\b/i, /\bmalaquias\b/i] },

  // Evangelhos
  { key: "mt", title: "Mateus", patterns: [/\bmt\b/i, /\bmateus\b/i] },
  { key: "mc", title: "Marcos", patterns: [/\bmc\b/i, /\bmarcos\b/i] },
  { key: "lc", title: "Lucas", patterns: [/\blc\b/i, /\blucas\b/i] },
  { key: "joao", title: "João", patterns: [/\bjo[aã]o\b/i, /\bjn\b/i] }, // cuidado: Jn pode conflitar com Jonas em alguns planos
  { key: "atos", title: "Atos", patterns: [/\batos\b/i, /\bac\b/i] },

  // Cartas Paulinas
  { key: "rm", title: "Romanos", patterns: [/\brm\b/i, /\bromanos\b/i] },
  { key: "1co", title: "1 Coríntios", patterns: [/\b1\s*co\b/i, /\b1\s*cor[ií]ntios\b/i] },
  { key: "2co", title: "2 Coríntios", patterns: [/\b2\s*co\b/i, /\b2\s*cor[ií]ntios\b/i] },
  { key: "gl", title: "Gálatas", patterns: [/\bgl\b/i, /\bg[aá]latas\b/i] },
  { key: "ef", title: "Efésios", patterns: [/\bef\b/i, /\bef[eé]sios\b/i] },
  { key: "fp", title: "Filipenses", patterns: [/\bfp\b/i, /\bfilipenses\b/i] },
  { key: "cl", title: "Colossenses", patterns: [/\bcl\b/i, /\bcolossenses\b/i] },
  { key: "1ts", title: "1 Tessalonicenses", patterns: [/\b1\s*ts\b/i, /\b1\s*tessalonicenses\b/i] },
  { key: "2ts", title: "2 Tessalonicenses", patterns: [/\b2\s*ts\b/i, /\b2\s*tessalonicenses\b/i] },
  { key: "1tm", title: "1 Timóteo", patterns: [/\b1\s*tm\b/i, /\b1\s*tim[oó]teo\b/i] },
  { key: "2tm", title: "2 Timóteo", patterns: [/\b2\s*tm\b/i, /\b2\s*tim[oó]teo\b/i] },
  { key: "tt", title: "Tito", patterns: [/\btt\b/i, /\btito\b/i] },
  { key: "fm", title: "Filemom", patterns: [/\bfm\b/i, /\bfilemom\b/i] },

  // Cartas Gerais
  { key: "hb", title: "Hebreus", patterns: [/\bhb\b/i, /\bhebreus\b/i] },
  { key: "tg", title: "Tiago", patterns: [/\btg\b/i, /\btiago\b/i] },
  { key: "1pe", title: "1 Pedro", patterns: [/\b1\s*pe\b/i, /\b1\s*pedro\b/i] },
  { key: "2pe", title: "2 Pedro", patterns: [/\b2\s*pe\b/i, /\b2\s*pedro\b/i] },
  { key: "1jo", title: "1 João", patterns: [/\b1\s*jo\b/i, /\b1\s*jo[aã]o\b/i] },
  { key: "2jo", title: "2 João", patterns: [/\b2\s*jo\b/i, /\b2\s*jo[aã]o\b/i] },
  { key: "3jo", title: "3 João", patterns: [/\b3\s*jo\b/i, /\b3\s*jo[aã]o\b/i] },
  { key: "jd", title: "Judas", patterns: [/\bjd\b/i, /\bjudas\b/i] },

  // Apocalipse
  { key: "ap", title: "Apocalipse", patterns: [/\bap\b/i, /\bapocalipse\b/i] },
];

function detectBooksInText(text) {
  const t = String(text || "");
  const found = new Set();

  for (const b of BOOKS) {
    for (const re of b.patterns) {
      if (re.test(t)) {
        found.add(b.key);
        break;
      }
    }
  }

  return [...found];
}

export function renderBookProgressPanel(progress = []) {
  const host = document.getElementById("bookProgressPanel");
  if (!host) return;

  const doneSet = new Set((progress || []).map(p => Number(p.day_index)));

  const stats = {};
  for (const b of BOOKS) {
    stats[b.key] = { title: b.title, totalDays: 0, doneDays: 0 };
  }

  for (let day = 1; day <= 365; day++) {
    const hay = getReadingHaystack(day) || "";
    const booksInDay = detectBooksInText(hay);

    if (!booksInDay.length) continue;

    for (const k of booksInDay) {
      if (!stats[k]) continue;
      stats[k].totalDays++;
    }

    if (doneSet.has(day)) {
      for (const k of booksInDay) {
        if (!stats[k]) continue;
        stats[k].doneDays++;
      }
    }
  }

  const list = Object.values(stats)
    .filter(s => s.totalDays > 0)
    .map(s => {
      const pct = s.totalDays ? Math.round((s.doneDays / s.totalDays) * 100) : 0;
      return { ...s, pct };
    })
    .sort((a, b) => b.pct - a.pct || b.doneDays - a.doneDays);

  if (!list.length) {
    host.innerHTML = `<div class="muted small">Sem dados de livros neste plano.</div>`;
    return;
  }

  host.innerHTML = `
    <div class="book-progress-grid">
      ${list.map(s => `
        <div class="book-card">
          <div class="book-title">${s.title}</div>
          <div class="muted small">${s.doneDays}/${s.totalDays} dias</div>
          <div class="bar">
            <div class="bar-fill" style="width:${s.pct}%"></div>
          </div>
          <div class="muted small">${s.pct}%</div>
        </div>
      `).join("")}
    </div>
  `;
}
