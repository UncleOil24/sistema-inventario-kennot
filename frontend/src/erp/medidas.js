// Medidas de una descripción, para no confundir productos de distinta medida (20 MM no es 25 MM, 1/2" no es 3/4").
// Se comparan por tipo: pulgadas, milímetros, centímetros, metros, kilos, litros, watts...
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

// "1 ½" → "1.1/2", "¾" → "3/4", 1-1/2 / 1 1/2 / 1.1/2 → "1.1/2", 3/4PLG → 3/4"
function normalizar(s) {
  let t = String(s || "").replace(/½/g, " 1/2").replace(/¾/g, " 3/4").replace(/¼/g, " 1/4").replace(/⅛/g, " 1/8");
  t = sinTildes(t).toUpperCase().replace(/[“”″]/g, '"').replace(/''/g, '"');
  t = t.replace(/(\d)\s*(PULG(ADAS?)?|PLG)\b/g, '$1"');
  t = t.replace(/(^|[^0-9./])(\d+)(?:\s+|-|\.)(\d+\/\d+)/g, "$1$2.$3");
  t = t.replace(/(\d)X(\d)/g, "$1 X $2");
  return t;
}

const UNIDADES = { MM: "mm", CM: "cm", MT: "m", MTS: "m", M: "m", KG: "kg", KILO: "kg", KILOS: "kg", GR: "g", LT: "l", LTS: "l", L: "l", CC: "cc", ML: "ml", W: "w", V: "v", AMP: "a", A: "a" };

// Devuelve { pulg: Set, mm: Set, ... } con las medidas encontradas
function extraer(s) {
  const t = normalizar(s);
  const out = {};
  const add = (tipo, v) => { (out[tipo] = out[tipo] || new Set()).add(v); };
  // Fracciones de pulgada (con o sin entero): 3/4, 1.1/2
  for (const m of t.matchAll(/(?:^|[^0-9./])((?:\d+\.)?\d+\/\d+)/g)) add("pulg", m[1]);
  // Pulgadas enteras: 1", 2"
  for (const m of t.matchAll(/(?:^|[^0-9./])(\d+)\s*"/g)) add("pulg", m[1]);
  // Número + unidad: 25MM, 25 MM, 3 MT, 25KG, 900CC, 200W
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(MM|CM|MTS|MT|M|KG|KILOS?|GR|LTS|LT|L|CC|ML|W|V|AMP|A)\b/g)) {
    add(UNIDADES[m[2]], String(Number(m[1].replace(",", "."))));
  }
  return out;
}

// Hay conflicto si para algún tipo de medida las dos descripciones traen valores y no comparten ninguno
function conflictoMedidas(a, b) {
  const A = extraer(a), B = extraer(b);
  for (const tipo of Object.keys(A)) {
    if (!B[tipo]) continue;
    if (![...A[tipo]].some((v) => B[tipo].has(v))) return { tipo, a: [...A[tipo]].join(", "), b: [...B[tipo]].join(", ") };
  }
  return null;
}

// Comparten al menos una medida (o ninguna de las dos trae medidas)
function mismasMedidas(a, b) {
  const A = extraer(a), B = extraer(b);
  const ta = Object.keys(A), tb = Object.keys(B);
  if (!ta.length && !tb.length) return true;
  if (conflictoMedidas(a, b)) return false;
  return ta.some((tipo) => B[tipo] && [...A[tipo]].some((v) => B[tipo].has(v)));
}

export { normalizar, extraer, conflictoMedidas, mismasMedidas };
