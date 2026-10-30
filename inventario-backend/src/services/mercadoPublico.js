// Licitaciones de Mercado Público (API pública de ChileCompra, https://www.chilecompra.cl/api/).
// Requiere un "ticket" gratuito (se pide con Clave Única) en la variable MERCADOPUBLICO_TICKET.
// - El listado de activas trae solo código, nombre, estado y cierre: se filtra por palabras clave.
// - El detalle (organismo, región, productos) cuesta una consulta por licitación: se pide solo para las que calzan.
// - La API rechaza consultas simultáneas y tiene un tope diario (10.000): todo va de a una, con pausa.
const { Op } = require("sequelize");
const Licitacion = require("../models/Licitacion");
const { getParametros, setParametros } = require("./parametros");
const { ErrorNegocio } = require("./erp");

const BASE = "https://api.mercadopublico.cl/servicios/v1/publico";
const MAX_DETALLES = 80; // por sincronización
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const ticketConfigurado = () => !!process.env.MERCADOPUBLICO_TICKET;
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function pedir(params, intento = 0) {
  if (!ticketConfigurado()) throw new ErrorNegocio("Falta configurar MERCADOPUBLICO_TICKET en Render", 503);
  const url = `${BASE}/licitaciones.json?${new URLSearchParams({ ...params, ticket: process.env.MERCADOPUBLICO_TICKET })}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if (intento < 2) { await pausa(3000); return pedir(params, intento + 1); }
    throw new ErrorNegocio(`Mercado Público no respondió: ${e.message}`, 502);
  } finally { clearTimeout(timer); }
  const texto = await res.text();
  let data = null;
  try { data = JSON.parse(texto); } catch { /* no es JSON */ }
  // La API responde con un mensaje cuando hay peticiones simultáneas o se agotó la cuota
  const msg = data?.Mensaje || (!data ? texto.slice(0, 200) : "");
  if (res.status === 401 || res.status === 403 || /ticket/i.test(msg)) throw new ErrorNegocio("Mercado Público rechazó el ticket: revisa MERCADOPUBLICO_TICKET", 502);
  if ((res.status === 429 || /simult[aá]ne/i.test(msg)) && intento < 3) { await pausa(5000 * (intento + 1)); return pedir(params, intento + 1); }
  if (!res.ok || !data) throw new ErrorNegocio(`Mercado Público respondió ${res.status}: ${msg || "sin datos"}`, 502);
  return data;
}

// La API entrega fechas en hora de Chile sin zona ("2026-11-10T15:00:00"). Se interpretan como hora de Chile
// (con su horario de verano/invierno), sin importar en qué huso corra el servidor.
const offsetChile = (utcMs) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
};
const fecha = (v) => {
  if (!v) return null;
  const t = String(v);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) { const d = new Date(t); return isNaN(d) ? null : d; }
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const comoUtc = Date.UTC(m[1], m[2] - 1, m[3], m[4] || 0, m[5] || 0, m[6] || 0);
  return new Date(comoUtc - offsetChile(comoUtc));
};
const palabrasClave = (params) => String(params.mp_palabras || "").split(",").map((p) => sinTildes(p).trim()).filter(Boolean);
const calzan = (texto, palabras) => { const t = sinTildes(texto); return palabras.filter((p) => t.includes(p)); };

// Convierte el detalle de la API a nuestro registro
function desdeDetalle(l) {
  const c = l.Comprador || {};
  const items = (l.Items?.Listado || []).map((i) => ({
    producto: i.NombreProducto || "",
    descripcion: i.Descripcion || "",
    categoria: i.Categoria || "",
    cantidad: Number(i.Cantidad) || 1,
    unidad: i.UnidadMedida || "",
  }));
  return {
    nombre: l.Nombre, descripcion: l.Descripcion || null,
    organismo: c.NombreOrganismo || null, unidad: c.NombreUnidad || null, rut_unidad: c.RutUnidad || null,
    region: c.RegionUnidad ? String(c.RegionUnidad).trim() : null, comuna: c.ComunaUnidad || null,
    tipo: l.Tipo || null, estado: l.Estado || (l.CodigoEstado ? String(l.CodigoEstado) : null),
    fecha_publicacion: fecha(l.Fechas?.FechaPublicacion), fecha_cierre: fecha(l.Fechas?.FechaCierre || l.FechaCierre),
    monto_estimado: Number(l.MontoEstimado) > 0 ? Number(l.MontoEstimado) : null,
    items, detalle_cargado: true,
  };
}

// Sincroniza: activas -> filtra por palabras -> pide detalle de las nuevas. onProgreso(texto) opcional.
async function sincronizar({ onProgreso } = {}) {
  const avisar = (t) => { try { onProgreso?.(t); } catch { /* */ } };
  const params = await getParametros();
  const palabras = palabrasClave(params);
  avisar("Pidiendo licitaciones activas a Mercado Público...");
  const data = await pedir({ estado: "activas" });
  const activas = data.Listado || [];
  const candidatas = activas
    .map((l) => ({ codigo: l.CodigoExterno, nombre: l.Nombre || "", cierre: fecha(l.FechaCierre), palabras: calzan(l.Nombre, palabras) }))
    .filter((l) => l.codigo && l.palabras.length);
  avisar(`${activas.length} activas, ${candidatas.length} calzan con las palabras clave. Revisando cuáles son nuevas...`);

  const existentes = await Licitacion.findAll({ where: { codigo: candidatas.map((c) => c.codigo) }, attributes: ["codigo", "detalle_cargado"], raw: true });
  const conDetalle = new Set(existentes.filter((e) => e.detalle_cargado).map((e) => e.codigo));
  const conocidas = new Set(existentes.map((e) => e.codigo));
  // Las que no se conocían quedan registradas aunque no alcance la cuota de detalles en esta vuelta
  const nuevas = candidatas.filter((c) => !conocidas.has(c.codigo));
  if (nuevas.length) {
    await Licitacion.bulkCreate(nuevas.map((c) => ({ codigo: c.codigo, nombre: c.nombre, fecha_cierre: c.cierre, palabras: c.palabras.join(", "), estado: "Publicada" })), { ignoreDuplicates: true });
  }
  const pendientes = candidatas.filter((c) => !conDetalle.has(c.codigo)).sort((a, b) => (a.cierre || 0) - (b.cierre || 0)).slice(0, MAX_DETALLES);
  let detalles = 0;
  for (const c of pendientes) {
    avisar(`Leyendo detalle ${detalles + 1} de ${pendientes.length}: ${c.codigo}`);
    try {
      const d = await pedir({ codigo: c.codigo });
      const l = (d.Listado || [])[0];
      if (l) {
        const desc = calzan(`${l.Nombre} ${l.Descripcion || ""} ${(l.Items?.Listado || []).map((i) => i.NombreProducto).join(" ")}`, palabras);
        await Licitacion.update({ ...desdeDetalle(l), palabras: [...new Set([...c.palabras, ...desc])].join(", ") }, { where: { codigo: c.codigo } });
        detalles++;
      }
    } catch (e) {
      if (e.status === 502 && /ticket/i.test(e.message)) throw e;
      console.error("MP detalle", c.codigo, e.message);
    }
    await pausa(1200);
  }
  // Las que ya cerraron dejan de mostrarse como abiertas
  await Licitacion.update({ estado: "Cerrada" }, { where: { fecha_cierre: { [Op.lt]: new Date() }, estado: { [Op.notIn]: ["Cerrada", "Adjudicada", "Desierta", "Revocada"] } } });
  await setParametros({ mp_ultima_sincronizacion: new Date().toISOString() });
  return { activas: activas.length, calzan: candidatas.length, nuevas: nuevas.length, detalles, pendientes_detalle: Math.max(0, candidatas.filter((c) => !conDetalle.has(c.codigo)).length - detalles) };
}

// ¿La licitación es de alguna de las regiones elegidas? (vacío = todas)
const enRegiones = (region, params) => {
  const regiones = String(params.mp_regiones || "").split(",").map((r) => sinTildes(r).trim()).filter(Boolean);
  if (!regiones.length || !region) return true;
  const r = sinTildes(region);
  return regiones.some((x) => r.includes(x));
};

module.exports = { fecha, sincronizar, ticketConfigurado, enRegiones, pedir, desdeDetalle };
