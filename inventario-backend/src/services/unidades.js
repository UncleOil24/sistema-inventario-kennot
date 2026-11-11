// Unidad de medida (M11). Lista oficial de gerencia (11-nov-2026), en este orden:
const UNIDADES = ["UNIDAD", "METRO", "KILO", "SACO", "TINETA", "GALÓN", "ROLLO", "CAJA", "BOLSA", "PACK", "PAR", "JUEGO", "PLIEGO", "PLANCHA", "TIRA", "M2", "M3"];
// Solo otras formas de escribir la MISMA unidad (abreviaturas, plurales, sin tilde). Nunca se cambia una unidad por otra.
const SINONIMOS = {
  UN: "UNIDAD", UND: "UNIDAD", UNID: "UNIDAD", "UNID.": "UNIDAD", UNIDADES: "UNIDAD", U: "UNIDAD", "C/U": "UNIDAD", EA: "UNIDAD",
  M: "METRO", MT: "METRO", MTS: "METRO", MTR: "METRO", METROS: "METRO", ML: "METRO", "M.L.": "METRO", "METRO LINEAL": "METRO",
  KG: "KILO", KGS: "KILO", KILOS: "KILO", KILOGRAMO: "KILO", KILOGRAMOS: "KILO",
  SACOS: "SACO", TINETAS: "TINETA", GALON: "GALÓN", GALONES: "GALÓN", GL: "GALÓN", GAL: "GALÓN",
  ROLLOS: "ROLLO", RL: "ROLLO", CAJAS: "CAJA", CJ: "CAJA", BOLSAS: "BOLSA", BLS: "BOLSA",
  PACKS: "PACK", PAQUETE: "PACK", PAQUETES: "PACK", PQT: "PACK", PARES: "PAR", JUEGOS: "JUEGO", JGO: "JUEGO",
  PLIEGOS: "PLIEGO", PLANCHAS: "PLANCHA", TIRAS: "TIRA",
  "M²": "M2", MT2: "M2", MTS2: "M2", "METRO CUADRADO": "M2", "METROS CUADRADOS": "M2",
  "M³": "M3", MT3: "M3", MTS3: "M3", "METRO CUBICO": "M3", "METROS CUBICOS": "M3",
};
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
// La unidad de la lista, o null si no se reconoce
const normalizarUnidad = (u) => {
  const t = String(u || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!t) return null;
  if (UNIDADES.includes(t)) return t;
  return SINONIMOS[t] || SINONIMOS[sinTildes(t)] || (UNIDADES.includes(sinTildes(t)) ? sinTildes(t) : null);
};
// Unidad de un producto: la de la lista si se reconoce; si no, se guarda tal cual (queda en "Unidad por revisar").
// Sin unidad = UNIDAD. Ya no se cambia sola según la descripción (ej. el cemento no pasa a SACO).
const unidadDeProducto = (_nombre, unidad) => {
  const t = String(unidad || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!t) return "UNIDAD";
  return normalizarUnidad(t) || t.slice(0, 20);
};
const unidadPorRevisar = (u) => !UNIDADES.includes(String(u || ""));
module.exports = { UNIDADES, normalizarUnidad, unidadDeProducto, unidadPorRevisar };
