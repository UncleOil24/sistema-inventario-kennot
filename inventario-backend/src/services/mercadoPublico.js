// Mercado Público: licitaciones (API v1) y Compra Ágil (API v2), con el mismo ticket gratuito de
// ChileCompra (se pide con Clave Única en https://www.chilecompra.cl/api/) en MERCADOPUBLICO_TICKET.
//
// Qué se guarda y cómo se ordena:
//  1. Región (mp_regiones), monto mínimo (mp_monto_minimo) y organismos excluidos (mp_excluir_organismos):
//     lo que no cumple ni se guarda.
//  2. Palabras prohibidas en el nombre (mp_excluir_palabras): se guarda como "descartada" automática.
//  3. Claude puntúa de 0 a 100 qué tanto calza con nuestro catálogo; bajo 40 queda "descartada" automática
//     (siempre se puede recuperar desde "Descartadas").
//  4. Organismos de mp_prioridad salen primero.
//
// Límites de las APIs: 10.000 consultas diarias por ticket, no aceptan consultas simultáneas y la de
// Compra Ágil es lenta (10-30 s por consulta): todo va de a una, con pausa, y con tope por revisión.
const { Op } = require("sequelize");
const Licitacion = require("../models/Licitacion");
const Producto = require("../models/Producto");
const { getParametros, setParametros } = require("./parametros");
const { ErrorNegocio } = require("./erp");
const ia = require("./ia");

const BASE = "https://api.mercadopublico.cl/servicios/v1/publico";
const BASE_CA = "https://api2.mercadopublico.cl/v2/compra-agil";
const MAX_DETALLES = 80;      // licitaciones: detalles por revisión
const MAX_DETALLES_CA = 40;   // Compra Ágil: detalles por revisión (cada uno tarda ~15 s)
const MAX_PAGINAS_CA = 60;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const ticketConfigurado = () => !!process.env.MERCADOPUBLICO_TICKET;
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const lista = (v) => String(v || "").split(",").map((p) => sinTildes(p).trim()).filter(Boolean);
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

// API de Compra Ágil: el ticket va en el encabezado "ticket". Lenta: la pasarela corta a los ~30 s (504).
async function pedirCA(ruta = "", params = {}, intento = 0) {
  if (!ticketConfigurado()) throw new ErrorNegocio("Falta configurar MERCADOPUBLICO_TICKET en Render", 503);
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_CA}${ruta}${qs ? `?${qs}` : ""}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(40000), headers: { Accept: "application/json", ticket: process.env.MERCADOPUBLICO_TICKET } });
  } catch (e) {
    if (intento < 1) { await pausa(5000); return pedirCA(ruta, params, intento + 1); }
    throw new ErrorNegocio(`Compra Ágil no respondió (${e.name === "TimeoutError" ? "tardó demasiado" : e.message})`, 502);
  }
  const texto = await res.text();
  let data = null;
  try { data = JSON.parse(texto); } catch { /* no es JSON */ }
  const msg = data?.errors?.[0]?.mensaje || (!data ? texto.slice(0, 200) : "");
  if (res.status === 401 || res.status === 403) throw new ErrorNegocio("Mercado Público rechazó el ticket para Compra Ágil: revisa MERCADOPUBLICO_TICKET", 502);
  if (res.status === 429) {
    const espera = Number(res.headers.get("retry-after")) || 0;
    if (intento < 2 && espera > 0 && espera <= 60) { await pausa(espera * 1000); return pedirCA(ruta, params, intento + 1); }
    throw new ErrorNegocio("Se agotó la cuota diaria de consultas de Mercado Público: se reintenta mañana", 503);
  }
  if ([502, 503, 504].includes(res.status) && intento < 2) { await pausa(8000 * (intento + 1)); return pedirCA(ruta, params, intento + 1); }
  if (res.status === 404) return null;
  if (!res.ok || !data || data.success !== "OK") {
    const e = new ErrorNegocio(`Compra Ágil respondió ${res.status}: ${msg || "sin datos"}`, 502);
    e.httpStatus = res.status;
    throw e;
  }
  return data.payload;
}

// Las APIs entregan fechas en hora de Chile sin zona ("2026-11-10T15:00:00"). Se interpretan como hora de Chile
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
// En Compra Ágil las fechas son hora de Chile aunque vengan con "Z"
const fechaCA = (v) => (v ? fecha(String(v).trim().replace(/(\.\d+)?[zZ]$/, "")) : null);

// Palabras: calza si la palabra aparece al inicio de una palabra del texto ("curso" no calza con "recurso")
const calzan = (texto, palabras) => {
  const t = sinTildes(texto);
  return palabras.filter((p) => new RegExp(`(^|[^a-z0-9])${escapar(p)}`).test(t));
};

// --- Regiones ------------------------------------------------------------------------
const REGIONES = [
  [1, "tarapaca"], [2, "antofagasta"], [3, "atacama"], [4, "coquimbo"], [5, "valparaiso"], [6, "higgins"], [6, "libertador"],
  [7, "maule"], [8, "biobio"], [8, "bio bio"], [9, "araucania"], [10, "los lagos"], [11, "aysen"], [12, "magallanes"],
  [13, "metropolitana"], [13, "santiago"], [14, "los rios"], [15, "arica"], [16, "nuble"],
];
const codigosRegion = (params) => [...new Set(lista(params.mp_regiones).flatMap((r) => REGIONES.filter(([, n]) => r.includes(n) || n.includes(r)).map(([c]) => c)))];
// ¿Es de alguna de las regiones elegidas? (vacío = todas)
const enRegiones = (region, params) => {
  const regiones = lista(params.mp_regiones);
  if (!regiones.length || !region) return true;
  const r = sinTildes(region);
  return regiones.some((x) => r.includes(x));
};

// --- Criterios (región, monto, organismo, palabras) -------------------------------------
const textoOrganismo = (l) => `${l.organismo || ""} ${l.unidad || ""}`;
const organismoExcluido = (l, params) => calzan(textoOrganismo(l), lista(params.mp_excluir_organismos)).length > 0;
const esPrioridad = (l, params) => calzan(textoOrganismo(l), lista(params.mp_prioridad)).length > 0;
const montoMinimo = (params) => Number(params.mp_monto_minimo) || 0;
const montoBajo = (l, params) => l.monto_estimado != null && Number(l.monto_estimado) > 0 && Number(l.monto_estimado) < montoMinimo(params);
const palabraProhibida = (nombre, params) => calzan(nombre, lista(params.mp_excluir_palabras))[0] || null;

const relevanciaMinima = (params) => { const v = Number(params.mp_relevancia_minima); return Number.isFinite(v) ? v : 65; };

// Aplica el % mínimo de calce a lo abierto: las "nuevas" bajo el mínimo pasan a descartadas automáticas, y si se bajó
// el mínimo, las descartadas por calce que ahora lo cumplen vuelven a "nueva". Lo que decidió una persona no se toca.
async function aplicarRelevanciaMinima(params) {
  const min = relevanciaMinima(params);
  const abierta = { [Op.or]: [{ fecha_cierre: null }, { fecha_cierre: { [Op.gte]: new Date() } }] };
  await Licitacion.update({ estado_interno: "descartada", descarte_auto: true },
    { where: { estado_interno: "nueva", relevancia: { [Op.lt]: min }, ...abierta } });
  const candidatas = await Licitacion.findAll({ where: { estado_interno: "descartada", descarte_auto: true, relevancia: { [Op.gte]: min }, ...abierta } });
  for (const l of candidatas) {
    if (visible(l, params) && !palabraProhibida(l.nombre, params)) await l.update({ estado_interno: "nueva", descarte_auto: false });
  }
}

// ¿Se muestra en la lista y en el resumen? (los criterios se aplican también a lo que ya estaba guardado)
const visible = (l, params) => enRegiones(l.region, params) && !organismoExcluido(l, params) && !montoBajo(l, params);

// Aplica los criterios a un registro ya guardado. Devuelve los cambios (o null si no hay)
function criterios(l, params) {
  const cambios = {};
  const prio = esPrioridad(l, params);
  if (prio !== l.prioridad) cambios.prioridad = prio;
  if (l.estado_interno === "nueva" || l.estado_interno === "revisada") {
    const prohibida = palabraProhibida(l.nombre, params);
    let motivo = null;
    if (organismoExcluido(l, params)) motivo = "Organismo excluido en Config.";
    else if (prohibida) motivo = `No es del rubro ("${prohibida}")`;
    if (motivo) Object.assign(cambios, { estado_interno: "descartada", descarte_auto: true, motivo_relevancia: motivo });
  }
  return Object.keys(cambios).length ? cambios : null;
}

// --- Catálogo resumido para Claude ------------------------------------------------------
async function resumenCatalogo() {
  const productos = await Producto.findAll({ where: { activo: true }, attributes: ["nombre", "categoria"], raw: true });
  const porCat = new Map();
  for (const p of productos) {
    const c = p.categoria || "General";
    if (!porCat.has(c)) porCat.set(c, []);
    porCat.get(c).push(p.nombre);
  }
  return [...porCat.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 40)
    .map(([c, ns]) => {
      const ejemplos = [];
      for (let i = 0; i < ns.length && ejemplos.length < 12; i += Math.max(1, Math.floor(ns.length / 12))) ejemplos.push(ns[i]);
      return `- ${c} (${ns.length}): ${ejemplos.join("; ")}`;
    }).join("\n") || "(catálogo vacío: ferretería y materiales de construcción en general)";
}

// Puntúa con Claude los procesos abiertos que aún no tienen puntaje. Sin Claude, quedan con las palabras clave.
async function puntuarPendientes(avisar, params) {
  if (!ia.iaConfigurada()) return 0;
  const todas = await Licitacion.findAll({
    where: { relevancia: null, estado_interno: { [Op.in]: ["nueva", "revisada"] }, [Op.or]: [{ fecha_cierre: null }, { fecha_cierre: { [Op.gte]: new Date() } }] },
    order: [["fecha_cierre", "ASC"]], limit: 300,
  });
  // No se gasta en lo que igual queda fuera por región, monto, organismo o palabra prohibida
  const pendientes = todas.filter((l) => visible(l, params) && !palabraProhibida(l.nombre, params));
  if (!pendientes.length) return 0;
  avisar(`Claude está revisando ${pendientes.length} procesos contra el catálogo...`);
  const notas = await ia.clasificarProcesos(pendientes.map((l) => ({
    codigo: l.codigo, nombre: l.nombre, descripcion: l.descripcion, organismo: l.organismo,
    productos: (l.items || []).map((i) => [i.producto, i.descripcion].filter(Boolean).join(" - ")),
  })), await resumenCatalogo());
  for (const l of pendientes) {
    const n = notas.get(l.codigo);
    if (!n) continue;
    const cambios = { relevancia: n.puntaje, motivo_relevancia: n.motivo };
    if (n.puntaje < relevanciaMinima(params) && l.estado_interno === "nueva") Object.assign(cambios, { estado_interno: "descartada", descarte_auto: true });
    await l.update(cambios);
  }
  return notas.size;
}

// --- Licitaciones (API v1) ---------------------------------------------------------------
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

async function sincronizarLicitaciones(params, avisar) {
  const palabras = lista(params.mp_palabras);
  avisar("Licitaciones: pidiendo las activas a Mercado Público...");
  const data = await pedir({ estado: "activas" });
  const activas = data.Listado || [];
  const candidatas = activas
    .map((l) => ({ codigo: l.CodigoExterno, nombre: l.Nombre || "", cierre: fecha(l.FechaCierre), palabras: calzan(l.Nombre, palabras) }))
    .filter((l) => l.codigo && l.palabras.length);
  avisar(`Licitaciones: ${activas.length} activas en Chile, ${candidatas.length} calzan con las palabras clave...`);

  const conocidas = new Set((await Licitacion.findAll({ where: { codigo: candidatas.map((c) => c.codigo) }, attributes: ["codigo"], raw: true })).map((e) => e.codigo));
  const nuevas = candidatas.filter((c) => !conocidas.has(c.codigo));
  if (nuevas.length) {
    await Licitacion.bulkCreate(nuevas.map((c) => {
      const prohibida = palabraProhibida(c.nombre, params);
      return { codigo: c.codigo, nombre: c.nombre, fecha_cierre: c.cierre, palabras: c.palabras.join(", "), estado: "Publicada", fuente: "licitacion",
        ...(prohibida ? { estado_interno: "descartada", descarte_auto: true, relevancia: 0, motivo_relevancia: `No es del rubro ("${prohibida}")` } : {}) };
    }), { ignoreDuplicates: true });
  }
  // Antes de gastar consultas en el detalle, Claude descarta por el nombre lo que no es del rubro
  try { await puntuarPendientes(avisar, params); } catch (e) { console.error("Claude relevancia:", e.message); }

  // Detalle (organismo, región, productos) solo de las que siguen en carrera. Las de otra región o de un
  // organismo excluido quedan guardadas como descartadas, para no volver a pedirlas en cada revisión.
  const pendientes = await Licitacion.findAll({
    where: { codigo: candidatas.map((c) => c.codigo), detalle_cargado: false, estado_interno: { [Op.in]: ["nueva", "revisada"] } },
    order: [["fecha_cierre", "ASC"]], limit: MAX_DETALLES,
  });
  let detalles = 0;
  for (const [k, reg] of pendientes.entries()) {
    avisar(`Licitaciones: leyendo detalle ${k + 1} de ${pendientes.length} (${reg.codigo})`, k, pendientes.length);
    try {
      const d = await pedir({ codigo: reg.codigo });
      const l = (d.Listado || [])[0];
      if (l) {
        const datos = desdeDetalle(l);
        const desc = calzan(`${l.Nombre} ${l.Descripcion || ""} ${(l.Items?.Listado || []).map((i) => i.NombreProducto).join(" ")}`, palabras);
        const fuera = !enRegiones(datos.region, params) ? "Otra región" : organismoExcluido(datos, params) ? "Organismo excluido en Config." : montoBajo(datos, params) ? "Monto bajo el mínimo" : null;
        await reg.update({ ...datos, palabras: [...new Set([...(reg.palabras || "").split(", ").filter(Boolean), ...desc])].join(", "),
          ...(fuera ? { estado_interno: "descartada", descarte_auto: true, motivo_relevancia: fuera } : {}) });
        detalles++;
      }
    } catch (e) {
      if (e.status === 502 && /ticket/i.test(e.message)) throw e;
      console.error("MP detalle", reg.codigo, e.message);
    }
    await pausa(500);
  }
  return { activas: activas.length, calzan: candidatas.length, nuevas: nuevas.length, detalles };
}

// --- Compra Ágil (API v2) ------------------------------------------------------------------
const montoCA = (x) => {
  const v = Number(x?.monto_disponible_clp ?? x?.monto_disponible ?? x?.presupuesto_estimado);
  return v > 0 ? v : null;
};
function desdeListadoCA(it) {
  const inst = it.institucion || {};
  return {
    codigo: it.codigo, nombre: it.nombre || "", fuente: "compra_agil", tipo: "COT",
    organismo: inst.organismo_comprador || null, unidad: inst.unidad_compra || null, rut_unidad: inst.rut || null,
    region: inst.nombre_region || null, estado: it.estado?.glosa || "Publicada",
    fecha_publicacion: fechaCA(it.fechas?.fecha_publicacion), fecha_cierre: fechaCA(it.fechas?.fecha_cierre),
    monto_estimado: montoCA(it.montos),
  };
}
function desdeDetalleCA(p) {
  const inst = p.institucion || {};
  return {
    nombre: p.nombre, descripcion: p.descripcion || null, fuente: "compra_agil", tipo: "COT",
    organismo: inst.organismo_comprador || null, unidad: inst.unidad_compra || null, rut_unidad: inst.rut || null,
    region: inst.nombre_region || null, comuna: p.entrega?.direccion_entrega ? String(p.entrega.direccion_entrega).slice(0, 100) : null,
    estado: p.estado?.glosa || null,
    fecha_publicacion: fechaCA(p.fechas?.fecha_publicacion), fecha_cierre: fechaCA(p.fechas?.fecha_cierre),
    monto_estimado: montoCA(p.presupuesto),
    items: (p.productos_solicitados || []).map((i) => ({
      producto: i.nombre || "", descripcion: i.descripcion || "", categoria: "", cantidad: Number(i.cantidad) || 1, unidad: i.unidad_medida || "",
    })),
    detalle_cargado: true,
  };
}

async function listarCA(params, avisar) {
  const base = { estado: "publicada", ordenar_por: "FechaPublicacion" };
  const regiones = codigosRegion(params);
  if (regiones.length) base.region = regiones.join(",");
  // Después de la primera vez se piden solo las publicadas desde la revisión anterior (con margen)
  if (params.mp_ca_ultima) base.publicado_desde = new Date(new Date(params.mp_ca_ultima).getTime() - 2 * 864e5).toISOString().slice(0, 19) + "Z";
  let tamano = 50, totalPaginas = 0;
  const items = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS_CA; pagina++) {
    avisar(`Compra Ágil: leyendo página ${pagina}${items.length ? ` (${items.length} encontradas)` : ""}...`, pagina - 1, totalPaginas || null);
    let r;
    try {
      r = await pedirCA("", { ...base, tamano_pagina: tamano, numero_pagina: pagina });
    } catch (e) {
      // Con páginas grandes la API a veces corta: se sigue con páginas de 10
      if (tamano > 10 && (e.httpStatus === 400 || e.httpStatus === 504 || /tard/.test(e.message))) {
        tamano = 10; pagina = Math.floor(items.length / 10); continue;
      }
      throw e;
    }
    items.push(...(r?.items || []));
    const total = r?.paginacion?.total_paginas || 0;
    totalPaginas = total;
    if (!r?.items?.length || pagina >= total) break;
    await pausa(600);
  }
  return [...new Map(items.filter((x) => x?.codigo).map((x) => [x.codigo, x])).values()];
}

async function sincronizarCompraAgil(params, avisar) {
  const inicio = new Date();
  const items = await listarCA(params, avisar);
  const datos = items.map(desdeListadoCA).filter((d) => visible(d, params));
  avisar(`Compra Ágil: ${items.length} publicadas, ${datos.length} cumplen región, monto y organismo. Guardando...`);

  const existentes = new Set((await Licitacion.findAll({ where: { codigo: datos.map((d) => d.codigo) }, attributes: ["codigo"], raw: true })).map((e) => e.codigo));
  const nuevas = datos.filter((d) => !existentes.has(d.codigo));
  const palabras = lista(params.mp_palabras);
  for (const d of nuevas) {
    d.palabras = calzan(d.nombre, palabras).join(", ") || null;
    d.prioridad = esPrioridad(d, params);
    const prohibida = palabraProhibida(d.nombre, params);
    if (prohibida) Object.assign(d, { estado_interno: "descartada", descarte_auto: true, motivo_relevancia: `No es del rubro ("${prohibida}")`, relevancia: 0 });
  }
  if (nuevas.length) await Licitacion.bulkCreate(nuevas, { ignoreDuplicates: true });

  // Claude puntúa las nuevas con el nombre; luego se pide el detalle (productos) solo de las que calzan
  try { await puntuarPendientes(avisar, params); } catch (e) { console.error("Claude relevancia:", e.message); }
  const sinDetalle = await Licitacion.findAll({
    where: { fuente: "compra_agil", detalle_cargado: false, estado_interno: { [Op.in]: ["nueva", "revisada"] }, fecha_cierre: { [Op.gte]: new Date() } },
    order: [["prioridad", "DESC"], ["fecha_cierre", "ASC"]], limit: MAX_DETALLES_CA,
  });
  let detalles = 0, hechos = 0, grave = null;
  const cola = [...sinDetalle];
  const trabajador = async (n) => {
    await pausa(n * 400);
    while (cola.length && !grave) {
      const l = cola.shift();
      try {
        const p = await pedirCA(`/${encodeURIComponent(l.codigo)}`);
        if (p) { await l.update(desdeDetalleCA(p)); detalles++; }
      } catch (e) {
        if (/ticket|cuota/i.test(e.message)) grave = e;
        else console.error("Compra Ágil detalle", l.codigo, e.message);
      }
      hechos++;
      avisar(`Compra Ágil: productos leídos ${hechos} de ${sinDetalle.length}`, hechos, sinDetalle.length);
      await pausa(400);
    }
  };
  avisar(`Compra Ágil: leyendo productos de ${sinDetalle.length} procesos...`, 0, sinDetalle.length);
  await Promise.all([0, 1, 2].map(trabajador));
  if (grave) throw grave;
  await setParametros({ mp_ca_ultima: inicio.toISOString() });
  return { publicadas: items.length, cumplen: datos.length, nuevas: nuevas.length, detalles };
}

// --- Revisión completa -----------------------------------------------------------------------
async function sincronizar({ onProgreso } = {}) {
  const avisar = (t) => { try { onProgreso?.(t); } catch { /* */ } };
  const params = await getParametros();
  const resumen = { nuevas: 0 };
  const errores = [];

  if (params.mp_compra_agil !== "0") {
    try {
      resumen.compra_agil = await sincronizarCompraAgil(params, avisar);
      resumen.nuevas += resumen.compra_agil.nuevas;
    } catch (e) {
      if (/ticket/i.test(e.message)) throw e;
      errores.push(`Compra Ágil: ${e.message}`);
      console.error("Compra Ágil:", e.message);
    }
  }
  try {
    resumen.licitaciones = await sincronizarLicitaciones(params, avisar);
    resumen.nuevas += resumen.licitaciones.nuevas;
  } catch (e) {
    if (/ticket/i.test(e.message) || !resumen.compra_agil) throw e;
    errores.push(`Licitaciones: ${e.message}`);
  }

  // Criterios de Config. sobre todo lo abierto (también lo guardado antes) y puntaje de Claude
  avisar("Aplicando criterios y prioridades...");
  const abiertas = await Licitacion.findAll({ where: { [Op.or]: [{ fecha_cierre: null }, { fecha_cierre: { [Op.gte]: new Date() } }] } });
  for (const l of abiertas) { const c = criterios(l, params); if (c) await l.update(c); }
  try { resumen.puntuadas = await puntuarPendientes(avisar, params); } catch (e) { errores.push(`Claude: ${e.message}`); }
  await aplicarRelevanciaMinima(params);

  // Las que ya cerraron dejan de mostrarse como abiertas; las descartadas solas y cerradas hace un mes se borran
  await Licitacion.update({ estado: "Cerrada" }, { where: { fecha_cierre: { [Op.lt]: new Date() }, estado: { [Op.notIn]: ["Cerrada", "Adjudicada", "Desierta", "Revocada"] } } });
  await Licitacion.destroy({ where: { descarte_auto: true, estado_interno: "descartada", fecha_cierre: { [Op.lt]: new Date(Date.now() - 30 * 864e5) } } });
  await setParametros({ mp_ultima_sincronizacion: new Date().toISOString() });
  if (errores.length) resumen.avisos = errores;
  return resumen;
}

// Detalle al abrir una ficha que aún no lo tiene
async function cargarDetalle(l) {
  if (l.detalle_cargado || !ticketConfigurado()) return l;
  if (l.fuente === "compra_agil") {
    const p = await pedirCA(`/${encodeURIComponent(l.codigo)}`);
    if (p) await l.update(desdeDetalleCA(p));
  } else {
    const d = await pedir({ codigo: l.codigo });
    const x = (d.Listado || [])[0];
    if (x) await l.update(desdeDetalle(x));
  }
  return l;
}

const fichaUrl = (l) => (l.fuente === "compra_agil"
  ? `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(l.codigo)}`
  : `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(l.codigo)}`);

module.exports = {
  fecha, fechaCA, sincronizar, ticketConfigurado, enRegiones, visible, pedir, pedirCA, desdeDetalle, desdeDetalleCA, desdeListadoCA,
  cargarDetalle, fichaUrl, aplicarRelevanciaMinima, codigosRegion, criterios, calzan,
};
