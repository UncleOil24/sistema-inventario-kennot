// Parámetros editables desde Configuración. Los márgenes NO van escritos en el código.
const Parametro = require("../models/Parametro");

const DEFAULTS = {
  margen_convenio: "30",          // % sobre el precio de compra
  margen_particular: "50",        // % sobre el precio de compra
  ultimo_numero_cotizacion: "0",  // la próxima cotización usa el siguiente número
  validez_cotizacion_dias: "30",
};

const getParametros = async (t) => {
  const filas = await Parametro.findAll({ transaction: t });
  const p = { ...DEFAULTS };
  filas.forEach((f) => { p[f.clave] = f.valor; });
  return p;
};

const setParametros = async (cambios, t) => {
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!(clave in DEFAULTS)) continue;
    await Parametro.upsert({ clave, valor: String(valor) }, { transaction: t });
  }
  return getParametros(t);
};

// Precio de venta según tipo de cliente: compra x (1 + margen%)
const precioVenta = (compra, tipo, params) => {
  const c = Number(compra) || 0;
  if (!c) return 0;
  const pct = Number(tipo === "particular" ? params.margen_particular : params.margen_convenio) || 0;
  return Math.round(c * (1 + pct / 100));
};

module.exports = { DEFAULTS, getParametros, setParametros, precioVenta };
