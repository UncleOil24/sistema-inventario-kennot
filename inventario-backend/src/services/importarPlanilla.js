const { unidadDeProducto } = require("./unidades");
// Importa la planilla LISTADO_CONSOLIDADO_FERRETERIA (v61 o posterior) a la base:
//   LISTADO CONSOLIDADO  -> productos (precio vigente, opciones 2 y 3, REVISAR, confirmados)
//   COTIZACIONES         -> precios_proveedor (historia con fecha y documento)
//   EXTRAS PROVEEDORES   -> precios_proveedor (descripción del proveedor, marca, calce)
//   PROVEEDOR / CONTACTO -> proveedores
//   REGISTRO DE CAMBIOS  -> registro_cambios
// Se puede correr más de una vez: no duplica precios ni el registro de cambios.
const ExcelJS = require("exceljs");
const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Producto = require("../models/Producto");
const PrecioProveedor = require("../models/PrecioProveedor");
const Proveedor = require("../models/Proveedor");
const RegistroCambio = require("../models/RegistroCambio");
const { normProv, calcularPrecio } = require("./precios");

const DOC_PLANILLA = "PLANILLA";
const MOTIVO_REGISTRO = "Registro de cambios de la planilla";

// --- Lectura de celdas -------------------------------------------------------
const valor = (cell) => {
  let v = cell?.value;
  if (v && typeof v === "object") {
    if (v instanceof Date) return v;
    if ("result" in v) v = v.result;
    else if ("richText" in v) v = v.richText.map((r) => r.text).join("");
    else if ("text" in v) v = v.text;
    else if ("error" in v) v = null;
  }
  if (typeof v === "string") { v = v.trim(); if (v === "") v = null; }
  return v ?? null;
};
const numero = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/\$|\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const texto = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
// "27-10-2026" | Date -> "2026-10-27"
const fechaISO = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const m2 = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m2 ? m2[0] : null;
};
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

// Busca la hoja por nombre (sin importar tildes/mayúsculas) y mapea encabezados -> columna
const hoja = (wb, nombre) => wb.worksheets.find((w) => sinTildes(w.name) === sinTildes(nombre));
const mapaColumnas = (ws, filaEncabezado) => {
  const m = {};
  ws.getRow(filaEncabezado).eachCell((cell, col) => { const t = sinTildes(valor(cell)); if (t) m[t] = col; });
  return m;
};
const buscarEncabezado = (ws, debeTener, maxFila = 6) => {
  for (let f = 1; f <= maxFila; f++) {
    const m = mapaColumnas(ws, f);
    if (debeTener.every((h) => Object.keys(m).some((k) => k.startsWith(h)))) return { fila: f, m };
  }
  return null;
};
const col = (m, ...prefijos) => {
  for (const p of prefijos) {
    const k = Object.keys(m).find((x) => x === p) || Object.keys(m).find((x) => x.startsWith(p));
    if (k) return m[k];
  }
  return null;
};

const esWeb = (contacto, documento) =>
  /precio web/i.test(contacto || "") || /^WEB$/i.test(String(documento || "").trim());
const calceDe = (v) => {
  const t = sinTildes(v);
  if (t.startsWith("EXACTO")) return "exacto";
  if (t.startsWith("EQUIVALENTE")) return "equivalente";
  if (t.startsWith("PARECIDO")) return "parecido";
  return null;
};

async function leerPlanilla(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const wsL = hoja(wb, "LISTADO CONSOLIDADO");
  if (!wsL) throw Object.assign(new Error("No encontré la hoja LISTADO CONSOLIDADO"), { status: 400 });
  const encL = buscarEncabezado(wsL, ["N", "CATEGORIA", "DESCRIPCION"]);
  if (!encL) throw Object.assign(new Error("La hoja LISTADO CONSOLIDADO no tiene los encabezados esperados"), { status: 400 });
  const L = encL.m;
  const c = {
    n: col(L, "N°", "N"), cat: col(L, "CATEGORIA"), desc: col(L, "DESCRIPCION"), unidad: col(L, "UNIDAD"),
    compra: col(L, "PRECIO REAL COMPRA", "PRECIO COMPRA"), prov: col(L, "PROVEEDOR"), contacto: col(L, "CONTACTO"),
    fecha: col(L, "FECHA ACT", "FECHA"), revisar: col(L, "REVISAR"),
    p2: col(L, "PROVEEDOR OPCION 2"), pr2: col(L, "PRECIO OPCION 2"), f2: col(L, "FECHA OPCION 2"),
    p3: col(L, "PROVEEDOR OPCION 3"), pr3: col(L, "PRECIO OPCION 3"), f3: col(L, "FECHA OPCION 3"),
  };

  // 1) Filas del listado
  const filas = [];
  for (let r = encL.fila + 1; r <= wsL.rowCount; r++) {
    const row = wsL.getRow(r);
    const g = (k) => (c[k] ? valor(row.getCell(c[k])) : null);
    const n = numero(g("n"));
    const desc = texto(g("desc"));
    if (!n || !desc) continue;
    const revisar = g("revisar");
    filas.push({
      codigo: n, categoria: texto(g("cat")), nombre: desc.toUpperCase(), unidad: unidadDeProducto(desc, texto(g("unidad"))), traeUnidad: !!texto(g("unidad")),
      compra: numero(g("compra")), proveedor: texto(g("prov")), contacto: texto(g("contacto")), fecha: fechaISO(g("fecha")),
      revisar: texto(revisar), confirmado: revisar === 0 || /^0$/.test(String(revisar ?? "")) || /^OK CONFIRM/i.test(String(revisar ?? "")),
      op2: { proveedor: texto(g("p2")), precio: numero(g("pr2")), fecha: fechaISO(g("f2")) },
      op3: { proveedor: texto(g("p3")), precio: numero(g("pr3")), fecha: fechaISO(g("f3")) },
    });
  }
  if (filas.length === 0) throw Object.assign(new Error("No encontré productos en el listado"), { status: 400 });

  // 2) Cotizaciones de proveedores
  const cotizaciones = [];
  const wsC = hoja(wb, "COTIZACIONES");
  if (wsC) {
    const enc = buscarEncabezado(wsC, ["FECHA", "EMPRESA", "PRECIO UNITARIO"]);
    if (enc) {
      const m = enc.m;
      const cc = {
        fecha: col(m, "FECHA"), empresa: col(m, "EMPRESA"), contacto: col(m, "CONTACTO"), doc: col(m, "N° COTIZACION", "N COTIZACION"),
        desc: col(m, "DESCRIPCION EN COTIZACION"), unidad: col(m, "UNIDAD"), cant: col(m, "CANTIDAD"),
        precio: col(m, "PRECIO UNITARIO"), n: col(m, "N° PRODUCTO", "N PRODUCTO"),
      };
      for (let r = enc.fila + 1; r <= wsC.rowCount; r++) {
        const row = wsC.getRow(r);
        const g = (k) => (cc[k] ? valor(row.getCell(cc[k])) : null);
        const n = numero(g("n")); const precio = numero(g("precio")); const empresa = texto(g("empresa"));
        if (!n || !(precio > 0) || !empresa) continue;
        cotizaciones.push({
          codigo: n, proveedor: normProv(empresa), contacto: texto(g("contacto")), precio: Math.round(precio),
          fecha: fechaISO(g("fecha")), documento: texto(g("doc")), descripcion_proveedor: texto(g("desc")),
          unidad: texto(g("unidad")), cantidad: numero(g("cant")),
          origen: esWeb(texto(g("contacto")), texto(g("doc"))) ? "web" : "proveedor",
        });
      }
    }
  }

  // 3) Extras de proveedores (descripción original, marca y calce)
  const extras = [];
  const wsE = hoja(wb, "EXTRAS PROVEEDORES");
  if (wsE) {
    const enc = buscarEncabezado(wsE, ["N° NUESTRO", "PROVEEDOR", "PRECIO NETO"]) || buscarEncabezado(wsE, ["N NUESTRO", "PROVEEDOR", "PRECIO NETO"]);
    if (enc) {
      const m = enc.m;
      const ce = {
        n: col(m, "N° NUESTRO", "N NUESTRO"), prov: col(m, "PROVEEDOR"), doc: col(m, "N° COT", "N COT"), fecha: col(m, "FECHA"),
        desc: col(m, "DESCRIPCION DEL PROVEEDOR"), marca: col(m, "MARCA"), unidad: col(m, "UNID"),
        precio: col(m, "PRECIO NETO"), calce: col(m, "CALCE"), uso: col(m, "USO EN PLANILLA"),
      };
      for (let r = enc.fila + 1; r <= wsE.rowCount; r++) {
        const row = wsE.getRow(r);
        const g = (k) => (ce[k] ? valor(row.getCell(ce[k])) : null);
        const n = numero(g("n")); const precio = numero(g("precio")); const prov = texto(g("prov"));
        if (!n || !(precio > 0) || !prov) continue;
        extras.push({
          codigo: n, proveedor: normProv(prov), precio: Math.round(precio), fecha: fechaISO(g("fecha")),
          documento: texto(g("doc")), descripcion_proveedor: texto(g("desc")), marca: texto(g("marca")),
          unidad: texto(g("unidad")), calce: calceDe(g("calce")),
        });
      }
    }
  }

  // 4) Registro de cambios
  const registro = [];
  const wsR = hoja(wb, "REGISTRO DE CAMBIOS");
  if (wsR) {
    const enc = buscarEncabezado(wsR, ["DESCRIPCION", "CAMPO", "ANTES"]);
    if (enc) {
      const m = enc.m;
      const cr = { n: col(m, "N° ORIGINAL", "N ORIGINAL", "N°"), desc: col(m, "DESCRIPCION"), campo: col(m, "CAMPO"), antes: col(m, "ANTES"), despues: col(m, "DESPUES") };
      for (let r = enc.fila + 1; r <= wsR.rowCount; r++) {
        const row = wsR.getRow(r);
        const g = (k) => (cr[k] ? valor(row.getCell(cr[k])) : null);
        const campo = texto(g("campo"));
        if (!campo) continue;
        registro.push({ n: numero(g("n")), desc: texto(g("desc")), campo, antes: texto(g("antes")), despues: texto(g("despues")) });
      }
    }
  }

  return { filas, cotizaciones, extras, registro };
}

// --- Comparación de descripciones ---------------------------------------------------------------
// Exacta: sin tildes, mayúsculas y espacios repetidos. Parecida: mismas medidas (números) y casi las
// mismas palabras (en otro orden, abreviadas, con una palabra de más o de menos). Medidas distintas
// (50 mm vs 100 mm) nunca son el mismo producto.
const clave = (s) => sinTildes(s).replace(/\s+/g, " ").trim();
const ABREV = {
  GALV: "GALVANIZADO", GALVANIZ: "GALVANIZADO", GALVANIZADA: "GALVANIZADO", GALVANIZADOS: "GALVANIZADO",
  ACERO: "ACERO", INOX: "INOXIDABLE", INOXID: "INOXIDABLE", ALUM: "ALUMINIO", ELECT: "ELECTRICO", ELECTRICA: "ELECTRICO",
  CANT: "CANTIDAD", UNID: "UNIDAD", UN: "UNIDAD", UND: "UNIDAD", MTS: "METRO", MT: "METRO", M: "METRO", METROS: "METRO",
  KG: "KILO", KILOS: "KILO", GL: "GALON", GLN: "GALON", LT: "LITRO", LTS: "LITRO", LITROS: "LITRO", HEX: "HEXAGONAL",
  CAB: "CABEZA", AUTOP: "AUTOPERFORANTE", AUTOPERF: "AUTOPERFORANTE", PVC: "PVC", TUB: "TUBO", BLCO: "BLANCO", BCO: "BLANCO",
};
const VACIAS = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "PARA", "CON", "C", "S", "SIN", "EN", "A", "TIPO", "MOD", "MODELO"]);
const piezas = (s) => {
  const t = sinTildes(s).replace(/(\d),(\d)/g, "$1.$2").replace(/[^A-Z0-9./"]+/g, " ").replace(/"/g, " PULG ");
  const palabras = new Set();
  const numeros = new Set();
  for (let w of t.split(/\s+/).filter(Boolean)) {
    w = w.replace(/^\.+|\.+$/g, "");
    if (!w) continue;
    if (/\d/.test(w)) { numeros.add(w.replace(/^0+(?=\d)/, "")); continue; }
    w = w.replace(/\./g, "");
    w = ABREV[w] || w;
    if (w.length > 4 && w.endsWith("S") && !w.endsWith("SS")) w = w.slice(0, -1); // plural simple
    if (!VACIAS.has(w) && w.length > 1) palabras.add(w);
  }
  return { palabras, numeros: [...numeros].sort().join("|") };
};
const parecido = (a, b) => {
  if (a.numeros !== b.numeros) return 0;
  if (a.palabras.size < 1 || b.palabras.size < 1) return 0;
  let comunes = 0;
  for (const w of a.palabras) if (b.palabras.has(w)) comunes++;
  return comunes / (a.palabras.size + b.palabras.size - comunes);
};
const mismasPalabras = (a, b) => a.numeros === b.numeros && a.palabras.size === b.palabras.size && [...a.palabras].every((w) => b.palabras.has(w));
const CATEGORIA_VACIA = /^(GENERAL|POR CLASIFICAR|SIN CATEGORIA)?$/i;

// Líneas de precio que trae cada fila (principal, opciones 2 y 3, cotizaciones y extras de ese N°)
const lineasDePrecio = (datos, webs) => {
  const porCodigo = new Map();
  const add = (codigo, x) => { if (!porCodigo.has(codigo)) porCodigo.set(codigo, []); porCodigo.get(codigo).push(x); };
  for (const x of datos.cotizaciones) add(x.codigo, { ...x, origen: x.origen === "web" || webs.has(x.proveedor) ? "web" : "proveedor" });
  for (const x of datos.extras) add(x.codigo, { ...x, origen: webs.has(x.proveedor) ? "web" : "proveedor" });
  for (const f of datos.filas) {
    for (const l of [{ proveedor: f.proveedor, precio: f.compra, fecha: f.fecha, contacto: f.contacto }, { ...f.op2 }, { ...f.op3 }]) {
      if (!(l.precio > 0)) continue;
      const prov = normProv(l.proveedor) && normProv(l.proveedor) !== "USUARIO" ? normProv(l.proveedor) : "SIN PROVEEDOR";
      add(f.codigo, { proveedor: prov, precio: Math.round(l.precio), fecha: l.fecha, documento: DOC_PLANILLA, origen: webs.has(prov) || /precio web/i.test(l.contacto || "") ? "web" : "proveedor", principal: true });
    }
  }
  return porCodigo;
};
const claveHist = (x) => [x.producto_id, normProv(x.proveedor), x.fecha || "", Math.round(Number(x.precio)), sinTildes(x.documento || "")].join("|");
const claveSuelta = (x) => [x.producto_id, normProv(x.proveedor), Math.round(Number(x.precio))].join("|");
// Solo cuenta como cambio de precio lo que provoca la planilla: se compara el resultado con y sin sus líneas
const mismoPrecio = (a, b) => !a || !b ? !a === !b
  : ["precio_compra", "opcion2_precio", "opcion3_precio"].every((k) => Math.round(Number(a[k]) || 0) === Math.round(Number(b[k]) || 0))
    && ["proveedor", "opcion2_proveedor", "opcion3_proveedor"].every((k) => normProv(a[k]) === normProv(b[k]));
const hoyCL = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });

// Precio cargado a mano en el sistema que no está en el historial: entra al historial como un precio más
// (con su fecha), así compite con lo que trae la planilla según las reglas (por fecha y el más barato).
const precioManual = (p, historial) => {
  if (!(Number(p.precio_compra) > 0)) return null;
  const prov = normProv(p.proveedor) || "SISTEMA";
  const ya = historial.some((h) => normProv(h.proveedor) === prov && Math.round(Number(h.precio)) === Math.round(Number(p.precio_compra)));
  if (ya) return null;
  return { producto_id: p.id, proveedor: prov, precio: Math.round(Number(p.precio_compra)), fecha: p.fecha_precio || String(p.updatedAt || "").slice(0, 10) || hoyCL(),
    documento: "SISTEMA (precio manual)", origen: "proveedor", createdAt: p.updatedAt || new Date(0) };
};

// --- Vista previa: compara la planilla con el sistema, sin guardar nada ----------------------------
async function planificar(datos, { onProgreso } = {}) {
  const avisar = (t) => { try { onProgreso?.(t); } catch { /* */ } };
  avisar("Comparando con el catálogo del sistema...");
  const productos = await Producto.findAll({ raw: true });
  const historial = await PrecioProveedor.findAll({ raw: true });
  const provs = await Proveedor.findAll({ attributes: ["nombre", "tipo", "excluido"], raw: true });
  const webs = new Set(provs.filter((p) => p.tipo === "web").map((p) => normProv(p.nombre)));
  const excluidos = new Set(provs.filter((p) => p.excluido).map((p) => normProv(p.nombre)));
  const histPorProd = new Map();
  for (const h of historial) { if (!histPorProd.has(h.producto_id)) histPorProd.set(h.producto_id, []); histPorProd.get(h.producto_id).push(h); }
  const lineas = lineasDePrecio(datos, webs);

  const porClave = new Map();
  const porCodigo = new Map();
  const porMedidas = new Map(); // mismas medidas -> productos (para buscar parecidos rápido)
  for (const p of productos) {
    p._piezas = piezas(p.nombre);
    if (!porClave.has(clave(p.nombre)) || (p.activo && !porClave.get(clave(p.nombre)).activo)) porClave.set(clave(p.nombre), p);
    if (p.codigo) porCodigo.set(Number(p.codigo), p);
    if (!porMedidas.has(p._piezas.numeros)) porMedidas.set(p._piezas.numeros, []);
    porMedidas.get(p._piezas.numeros).push(p);
  }

  const usados = new Set();
  const filas = [];
  datos.filas.forEach((f, i) => {
    const fp = piezas(f.nombre);
    let p = porClave.get(clave(f.nombre));
    let tipo; let motivo = null; let candidato = null; let sugerido = null;
    if (p && usados.has(p.id)) { tipo = "revisar"; motivo = "Descripción repetida en la planilla"; candidato = p; sugerido = "ignorar"; p = null; }
    else if (p) tipo = p.activo ? "match" : "revisar";
    if (p && !p.activo) { motivo = "Está desactivado en el sistema (Es el mismo = se reactiva)"; candidato = p; sugerido = "ignorar"; p = null; }
    if (!tipo) {
      // Parecidos: mismas medidas, palabras casi iguales
      let mejor = null; let puntaje = 0;
      for (const q of porMedidas.get(fp.numeros) || []) {
        if (!q.activo || usados.has(q.id)) continue;
        const s = mismasPalabras(fp, q._piezas) ? 1 : parecido(fp, q._piezas);
        if (s > puntaje) { puntaje = s; mejor = q; }
      }
      const porN = porCodigo.get(f.codigo);
      if (puntaje >= 1) { tipo = "revisar"; candidato = mejor; sugerido = "mismo"; motivo = "Mismas palabras y medidas (otro orden, tildes o abreviaturas)"; }
      else if (porN && porN.activo && !usados.has(porN.id) && parecido(fp, porN._piezas) >= 0.5) { tipo = "revisar"; candidato = porN; sugerido = "mismo"; motivo = `Mismo N° ${f.codigo} y descripción parecida`; }
      else if (puntaje >= 0.6) { tipo = "revisar"; candidato = mejor; sugerido = "ignorar"; motivo = `Parecido (${Math.round(puntaje * 100)}%)`; }
      else tipo = "nuevo";
    }
    if (p) usados.add(p.id);
    if (candidato && sugerido === "mismo") usados.add(candidato.id);
    filas.push({ i, f, tipo, producto: p, candidato, motivo, sugerido });
  });

  // Simula el precio que quedaría con las reglas del sistema
  const ahora = new Date();
  const simular = (prod, codigo) => {
    const hist = histPorProd.get(prod.id) || [];
    const man = precioManual(prod, hist);
    const base = man ? [...hist, man] : [...hist];
    const antes = calcularPrecio(prod, base, excluidos);
    const vistos = new Set(base.map(claveHist));
    const sueltos = new Set(base.map(claveSuelta));
    let k = 0;
    for (const l of lineas.get(codigo) || []) {
      const reg = { ...l, producto_id: prod.id, fecha: l.fecha || hoyCL(), id: 1e9 + k++, createdAt: ahora };
      if (l.principal && sueltos.has(claveSuelta(reg))) continue;
      if (vistos.has(claveHist(reg))) continue;
      vistos.add(claveHist(reg)); sueltos.add(claveSuelta(reg));
      base.push(reg);
    }
    const despues = calcularPrecio(prod, base, excluidos);
    return mismoPrecio(antes, despues) ? null : despues;
  };
  const resumenCambio = (prod, f) => {
    const c = simular(prod, f.codigo) || {};
    const cambios = [];
    const antes = Math.round(Number(prod.precio_compra) || 0);
    const despues = c.precio_compra != null ? Math.round(c.precio_compra) : antes;
    if (antes !== despues) cambios.push(`precio ${antes ? `$${antes.toLocaleString("es-CL")}` : "sin precio"} → $${despues.toLocaleString("es-CL")}`);
    if (c.proveedor && normProv(c.proveedor) !== normProv(prod.proveedor) && antes === despues) cambios.push(`proveedor ${prod.proveedor || "—"} → ${c.proveedor}`);
    const cat = f.categoria && !CATEGORIA_VACIA.test(f.categoria) && f.categoria !== prod.categoria ? f.categoria : null;
    if (cat) cambios.push(`categoría ${prod.categoria} → ${cat}`);
    const uni = f.traeUnidad && f.unidad && f.unidad !== prod.unidad ? f.unidad : null;
    if (uni) cambios.push(`unidad ${prod.unidad} → ${uni}`);
    return { cambios, precio_antes: antes || null, precio_despues: despues || null, proveedor_despues: c.proveedor || prod.proveedor || null, categoria: cat, unidad: uni };
  };

  const items = filas.map((x) => {
    const base = { i: x.i, codigo: x.f.codigo, nombre: x.f.nombre, categoria: x.f.categoria || "POR CLASIFICAR", precio_planilla: x.f.compra > 0 ? Math.round(x.f.compra) : null, proveedor_planilla: x.f.proveedor || null };
    if (x.tipo === "nuevo") return { ...base, tipo: "nuevo" };
    if (x.tipo === "match") {
      const r = resumenCambio(x.producto, x.f);
      return { ...base, tipo: r.cambios.length ? "actualizado" : "sin_cambios", producto_id: x.producto.id, producto_nombre: x.producto.nombre, ...r };
    }
    const r = resumenCambio(x.candidato, x.f);
    return { ...base, tipo: "revisar", motivo: x.motivo, sugerido: x.sugerido, producto_id: x.candidato.id, producto_nombre: x.candidato.nombre, producto_codigo: x.candidato.codigo, ...r };
  });
  const cuenta = (t) => items.filter((x) => x.tipo === t).length;
  return {
    items,
    resumen: {
      filas: datos.filas.length, nuevos: cuenta("nuevo"), actualizados: cuenta("actualizado"), sin_cambios: cuenta("sin_cambios"), revisar: cuenta("revisar"),
      solo_en_sistema: productos.filter((p) => p.activo && !items.some((x) => x.producto_id === p.id && x.tipo !== "revisar")).length,
      cotizaciones: datos.cotizaciones.length, extras: datos.extras.length,
    },
  };
}

// --- Aplicar lo aprobado ---------------------------------------------------------------------------
// decisiones: { [fila]: "mismo" | "nuevo" | "ignorar" } para las filas a revisar; excluir: [fila] (nuevos o actualizados que no se quieren)
async function aplicar(datos, plan, { decisiones = {}, excluir = [], usuario = "importación", onProgreso } = {}) {
  const avisar = (t) => { try { onProgreso?.(t); } catch { /* */ } };
  const fuera = new Set(excluir.map(Number));
  return sequelize.transaction(async (t) => {
    const [[lock]] = await sequelize.query("SELECT pg_try_advisory_xact_lock(424242) AS ok", { transaction: t });
    if (!lock.ok) throw Object.assign(new Error("Ya hay una importación en curso. Espera a que termine."), { status: 409 });
    const resumen = { productos_nuevos: 0, productos_actualizados: 0, reactivados: 0, precios_agregados: 0, precios_cambiados: 0, proveedores_nuevos: 0, registro_cambios: 0, ignorados: 0 };

    // Proveedores (nombre corto + contacto + tipo)
    const provInfo = new Map();
    const anotar = (nombre, contacto, web) => {
      const k = normProv(nombre);
      if (!k || k === "USUARIO") return;
      const i = provInfo.get(k) || { nombre: k, contacto: null, web: false };
      if (contacto && !i.contacto && !/precio web/i.test(contacto)) i.contacto = contacto;
      if (web || /precio web/i.test(contacto || "")) i.web = true;
      provInfo.set(k, i);
    };
    datos.filas.forEach((f) => { anotar(f.proveedor, f.contacto); anotar(f.op2.proveedor); anotar(f.op3.proveedor); });
    datos.cotizaciones.forEach((x) => anotar(x.proveedor, x.contacto, x.origen === "web"));
    datos.extras.forEach((x) => anotar(x.proveedor));
    const existentes = await Proveedor.findAll({ transaction: t });
    const porNombre = new Map(existentes.map((p) => [normProv(p.nombre), p.toJSON()]));
    const provNuevos = []; const provCambios = [];
    for (const i of provInfo.values()) {
      const p = porNombre.get(i.nombre);
      if (!p) { const n = { nombre: i.nombre, contacto: i.contacto, tipo: i.web ? "web" : "proveedor" }; provNuevos.push(n); porNombre.set(i.nombre, n); }
      else if ((!p.contacto && i.contacto) || (i.web && p.tipo !== "web")) { if (!p.contacto && i.contacto) p.contacto = i.contacto; if (i.web) p.tipo = "web"; provCambios.push(p); }
    }
    if (provNuevos.length) await Proveedor.bulkCreate(provNuevos, { transaction: t });
    if (provCambios.length) await Proveedor.bulkCreate(provCambios, { transaction: t, updateOnDuplicate: ["contacto", "tipo", "updatedAt"] });
    resumen.proveedores_nuevos = provNuevos.length;
    const webs = new Set([...porNombre.values()].filter((p) => p.tipo === "web").map((p) => normProv(p.nombre)));
    const excluidos = new Set([...porNombre.values()].filter((p) => p.excluido).map((p) => normProv(p.nombre)));

    // Qué se hace con cada fila
    const idPorCodigo = new Map(); // N° de la planilla -> producto del sistema
    const actualizar = new Map(); // producto_id -> { categoria, unidad, activo }
    const crear = [];
    for (const it of plan.items) {
      const f = datos.filas[it.i];
      let accion = it.tipo === "revisar" ? (decisiones[it.i] || it.sugerido || "ignorar") : it.tipo;
      if (fuera.has(it.i) && accion !== "ignorar") accion = "ignorar";
      if (accion === "ignorar") { resumen.ignorados++; continue; }
      if (accion === "nuevo") { crear.push(f); continue; }
      // match, actualizado, sin_cambios o "mismo"
      idPorCodigo.set(f.codigo, it.producto_id);
      const c = {};
      if (f.categoria && !CATEGORIA_VACIA.test(f.categoria)) c.categoria = f.categoria;
      if (f.traeUnidad && f.unidad) c.unidad = f.unidad;
      if (it.tipo === "revisar") c.activo = true;
      c.en_planilla = true;
      actualizar.set(it.producto_id, c);
    }

    avisar("Guardando productos...");
    const prods = await Producto.findAll({ where: { id: [...actualizar.keys()] }, transaction: t });
    const prodPorId = new Map(prods.map((p) => [p.id, p]));
    const registros = [];
    for (const p of prods) {
      const c = actualizar.get(p.id);
      const cambia = Object.keys(c).filter((k) => String(p[k]) !== String(c[k]));
      if (cambia.includes("activo")) { resumen.reactivados++; registros.push({ usuario, tabla: "productos", registro_id: p.id, campo: "activo", antes: "false", despues: "true", motivo: "Importación de planilla (reactivado)" }); }
      for (const k of cambia.filter((x) => ["categoria", "unidad"].includes(x))) registros.push({ usuario, tabla: "productos", registro_id: p.id, campo: k, antes: p[k], despues: c[k], motivo: "Importación de planilla" });
      if (cambia.length) await p.update(c, { transaction: t });
    }
    // Nuevos: conservan su N° si está libre; si no, el siguiente libre
    const usados = new Set((await Producto.findAll({ attributes: ["codigo"], raw: true, transaction: t })).map((p) => Number(p.codigo)).filter(Boolean));
    let siguiente = Math.max(0, ...usados) + 1;
    const nuevosProd = crear.map((f) => {
      let codigo = f.codigo;
      if (usados.has(codigo)) codigo = siguiente++;
      usados.add(codigo);
      return { codigo, categoria: f.categoria && !CATEGORIA_VACIA.test(f.categoria) ? f.categoria : "POR CLASIFICAR", nombre: f.nombre, unidad: f.unidad, activo: true, en_planilla: true, _f: f };
    });
    for (let i = 0; i < nuevosProd.length; i += 500) {
      const lote = nuevosProd.slice(i, i + 500);
      const creados = await Producto.bulkCreate(lote.map(({ _f, ...x }) => x), { transaction: t, returning: true });
      creados.forEach((p, k) => { idPorCodigo.set(lote[k]._f.codigo, p.id); prodPorId.set(p.id, p); });
    }
    resumen.productos_nuevos = nuevosProd.length;

    // Historial de precios (sin duplicar) + precios cargados a mano que no tenían respaldo
    avisar("Cargando historial de precios...");
    const ids = [...new Set(idPorCodigo.values())];
    const previos = await PrecioProveedor.findAll({ where: { producto_id: ids }, raw: true, transaction: t });
    const histPorProd = new Map();
    previos.forEach((h) => { if (!histPorProd.has(h.producto_id)) histPorProd.set(h.producto_id, []); histPorProd.get(h.producto_id).push(h); });
    // Precio que resultaría sin la planilla (para no aplicar diferencias que ya existían en el sistema)
    const antesDe = new Map();
    for (const id of ids) {
      const p = prodPorId.get(id);
      if (!p) continue;
      const hist = histPorProd.get(id) || [];
      const man = precioManual(p, hist);
      antesDe.set(id, calcularPrecio(p, man ? [...hist, man] : hist, excluidos));
    }
    const vistos = new Map(previos.map((p) => [claveHist(p), p]));
    const sueltos = new Set(previos.map(claveSuelta));
    const completados = new Map();
    const nuevos = [];
    const hoy = hoyCL();
    for (const id of ids) {
      const man = precioManual(prodPorId.get(id) || {}, histPorProd.get(id) || []);
      if (man) { const { createdAt, ...m } = man; nuevos.push({ ...m, creado_por: "sistema (antes de importar)" }); vistos.set(claveHist(m), m); sueltos.add(claveSuelta(m)); }
    }
    const lineas = lineasDePrecio(datos, webs);
    for (const [codigo, lista] of lineas) {
      const producto_id = idPorCodigo.get(codigo);
      if (!producto_id) continue;
      for (const l of lista) {
        const { principal, ...x } = l;
        delete x.codigo; delete x.contacto;
        const reg = { ...x, producto_id, fecha: x.fecha || hoy, creado_por: usuario };
        if (principal && sueltos.has(claveSuelta(reg))) continue;
        const k = claveHist(reg);
        if (vistos.has(k)) {
          const e = vistos.get(k); let cambio = false;
          ["marca", "calce", "descripcion_proveedor"].forEach((c2) => { if (reg[c2] && !e[c2]) { e[c2] = reg[c2]; cambio = true; } });
          if (cambio && e.id) completados.set(e.id, e);
          continue;
        }
        vistos.set(k, reg); sueltos.add(claveSuelta(reg)); nuevos.push(reg);
      }
    }
    if (completados.size) await PrecioProveedor.bulkCreate([...completados.values()], { transaction: t, updateOnDuplicate: ["marca", "calce", "descripcion_proveedor", "updatedAt"] });
    for (let i = 0; i < nuevos.length; i += 1000) await PrecioProveedor.bulkCreate(nuevos.slice(i, i + 1000), { transaction: t });
    resumen.precios_agregados = nuevos.length;

    // Precio vigente según las reglas (mismo cálculo de la vista previa)
    avisar("Aplicando las reglas de precios...");
    const todos = await PrecioProveedor.findAll({ where: { producto_id: ids }, transaction: t });
    const porProd = new Map();
    todos.forEach((h) => { if (!porProd.has(h.producto_id)) porProd.set(h.producto_id, []); porProd.get(h.producto_id).push(h); });
    const confirmarCodigos = new Map(datos.filas.filter((f) => f.confirmado && f.compra > 0).map((f) => [f.codigo, Math.round(f.compra)]));
    const contactoDe = (prov) => { const p = porNombre.get(normProv(prov)); return p ? (p.contacto || p.telefono || p.email || null) : null; };
    const codigoPorId = new Map([...idPorCodigo].map(([c, id]) => [id, c]));
    for (const id of ids) {
      const p = prodPorId.get(id);
      if (!p) continue;
      const c = calcularPrecio(p, porProd.get(id) || [], excluidos);
      if (!c) continue;
      const conf0 = confirmarCodigos.get(codigoPorId.get(id));
      if (mismoPrecio(antesDe.get(id), c) && !(conf0 && !p.confirmado && Math.round(Number(p.precio_compra)) === conf0)) continue; // la planilla no cambia su precio
      if (normProv(c.proveedor) !== normProv(p.proveedor)) c.contacto = contactoDe(c.proveedor);
      // La planilla marca confirmado y su precio es el que quedó: queda confirmado
      const conf = confirmarCodigos.get(codigoPorId.get(id));
      if (conf && Math.round(c.precio_compra) === conf && !c.confirmado) { c.confirmado = true; c.fecha_confirmado = new Date(Date.now() + 1000); c.revisar = null; }
      for (const campo of ["precio_compra", "proveedor"]) {
        const antes = p[campo];
        if (String(Number(antes) || antes || "") !== String(Number(c[campo]) || c[campo] || "")) {
          registros.push({ usuario, tabla: "productos", registro_id: id, campo, antes: antes == null ? null : String(antes), despues: String(c[campo]), motivo: "Importación de planilla" });
          if (campo === "precio_compra") resumen.precios_cambiados++;
        }
      }
      await p.update(c, { transaction: t });
    }
    resumen.productos_actualizados = plan.items.filter((x) => x.tipo === "actualizado" && !fuera.has(x.i)).length;

    // Registro de cambios de la planilla (una sola vez)
    const yaImportado = await RegistroCambio.count({ where: { motivo: MOTIVO_REGISTRO }, transaction: t });
    if (!yaImportado && datos.registro.length) {
      datos.registro.forEach((r) => registros.push({ usuario: "planilla", tabla: "productos", registro_id: r.n ? idPorCodigo.get(r.n) || null : null, campo: r.campo, antes: r.antes, despues: r.despues, motivo: MOTIVO_REGISTRO }));
    }
    registros.push({ usuario, tabla: "productos", campo: "importación", despues: `${datos.filas.length} filas: ${resumen.productos_nuevos} nuevos, ${resumen.productos_actualizados} actualizados, ${resumen.ignorados} ignorados`, motivo: "Importación de planilla (combinada)" });
    for (let i = 0; i < registros.length; i += 2000) await RegistroCambio.bulkCreate(registros.slice(i, i + 2000), { transaction: t });
    resumen.registro_cambios = registros.length;
    resumen.filas = datos.filas.length;
    return resumen;
  });
}

module.exports = { leerPlanilla, planificar, aplicar, piezas, parecido };
