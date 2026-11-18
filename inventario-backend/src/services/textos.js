// Limpieza de descripciones que vienen de listas copiadas (Excel, Mercado Público, PDF):
// - un tabulador seguido de la cantidad al final ("Cemento saco 25 kg<TAB>30") es la columna de cantidad pegada
//   a la descripción: se quita (en el PDF salía como signos raros);
// - tabuladores, saltos y caracteres de control quedan como un espacio;
// - comillas tipográficas: después de un número son pulgadas (5/8 con comilla → 5/8"); si no, se quitan;
// - símbolos sueltos que no son de una descripción (viñeta, euro, arroba, reemplazo) se quitan.
const SEP = "[\\t\\u000b\\f\\r\\n\\u0085\\u2028\\u2029]";
const RE_CANT = new RegExp(`${SEP}+\\s*\\d+([.,]\\d+)?\\s*$`, "u");
const RE_PULG = new RegExp("(\\d)\\s*[\\u201c\\u201d\\u2033]", "gu");
const RE_COMILLA = new RegExp("[\\u201c\\u201d]", "gu");
const RE_SIMB = new RegExp("[\\u2022\\u20ac@\\u00a4\\ufffd]", "gu");
const RE_CTRL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u200b]+", "gu");
function limpiarTexto(s) {
  let t = String(s ?? "");
  if (!t) return t;
  t = t.replace(RE_CANT, "").replace(RE_PULG, '$1"').replace(RE_COMILLA, "").replace(RE_SIMB, " ").replace(RE_CTRL, " ");
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}
module.exports = { limpiarTexto };
