// Unidad de medida controlada (M11): lista cerrada. Lo que llegue escrito distinto se lleva a la de la lista.
const UNIDADES = ["UNIDAD", "METRO", "KILO", "SACO", "TINETA", "GALÓN", "ROLLO", "CAJA", "PAR", "PLIEGO", "TIRA", "M3"];
const SINONIMOS = {
  UN: "UNIDAD", UND: "UNIDAD", UNID: "UNIDAD", "UNID.": "UNIDAD", UNIDADES: "UNIDAD", U: "UNIDAD", C_U: "UNIDAD", "C/U": "UNIDAD", PZA: "UNIDAD", PIEZA: "UNIDAD", JUEGO: "UNIDAD", JGO: "UNIDAD", KIT: "UNIDAD", SET: "UNIDAD",
  M: "METRO", MT: "METRO", MTS: "METRO", MTR: "METRO", METROS: "METRO", ML: "METRO", "M.L.": "METRO", "METRO LINEAL": "METRO",
  KG: "KILO", KGS: "KILO", KILOS: "KILO", KILOGRAMO: "KILO",
  SACOS: "SACO", BOLSA: "SACO",
  TINETAS: "TINETA", BALDE: "TINETA",
  GALON: "GALÓN", GALONES: "GALÓN", GL: "GALÓN", GAL: "GALÓN",
  ROLLOS: "ROLLO", RL: "ROLLO",
  CAJAS: "CAJA", CJ: "CAJA",
  PARES: "PAR",
  PLIEGOS: "PLIEGO", PLANCHA: "PLIEGO", PLANCHAS: "PLIEGO",
  TIRAS: "TIRA", BARRA: "TIRA", BARRAS: "TIRA", VARA: "TIRA",
  "M³": "M3", "MT3": "M3", "METRO CUBICO": "M3",
};
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
// Devuelve la unidad de la lista, o null si no se reconoce
const normalizarUnidad = (u) => {
  const t = String(u || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!t) return null;
  if (UNIDADES.includes(t)) return t;
  if (sinTildes(t) === "GALON") return "GALÓN";
  return SINONIMOS[t] || SINONIMOS[sinTildes(t)] || null;
};
// Unidad para un producto: la normalizada; los productos en saco cargados como UNIDAD (ej. cemento 25 kg) pasan a SACO
const SACO = /^(CEMENTO|MORTERO|YESO|ESTUCO|PASTA MURO|ADHESIVO|PEGAMENTO CERAMICO|CAL|ARENA|GRAVILLA|HORMIGON|BEKRON|SIKA ?GROUT|FRAGUE)\b.*\b\d+([.,]\d+)? ?KG/i;
const unidadDeProducto = (nombre, unidad) => {
  const u = normalizarUnidad(unidad) || "UNIDAD";
  if (u === "UNIDAD" && SACO.test(String(nombre || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) return "SACO";
  return u;
};
module.exports = { UNIDADES, normalizarUnidad, unidadDeProducto };
