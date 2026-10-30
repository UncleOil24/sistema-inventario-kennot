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
const { normProv, vigentesPorProveedor } = require("./precios");

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

// --- Importación -------------------------------------------------------------
async function importarPlanilla(buffer, { usuario = "importación", desactivarOtros = false } = {}) {
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
      codigo: n, categoria: texto(g("cat")) || "General", nombre: desc.toUpperCase(), unidad: texto(g("unidad")) || "UNIDAD",
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

  return sequelize.transaction(async (t) => {
    const resumen = { productos_nuevos: 0, productos_actualizados: 0, precios_agregados: 0, proveedores_nuevos: 0, registro_cambios: 0, desactivados: 0 };

    // --- Proveedores (nombre corto + contacto + tipo) ---
    const provInfo = new Map();
    const anotar = (nombre, contacto, web) => {
      const k = normProv(nombre);
      if (!k || k === "USUARIO") return;
      const i = provInfo.get(k) || { nombre: k, contacto: null, web: false };
      if (contacto && !i.contacto && !/precio web/i.test(contacto)) i.contacto = contacto;
      if (web || /precio web/i.test(contacto || "")) i.web = true;
      provInfo.set(k, i);
    };
    filas.forEach((f) => { anotar(f.proveedor, f.contacto); anotar(f.op2.proveedor); anotar(f.op3.proveedor); });
    cotizaciones.forEach((x) => anotar(x.proveedor, x.contacto, x.origen === "web"));
    extras.forEach((x) => anotar(x.proveedor));

    const existentes = await Proveedor.findAll({ transaction: t });
    const porNombre = new Map(existentes.map((p) => [normProv(p.nombre), p]));
    for (const i of provInfo.values()) {
      const p = porNombre.get(i.nombre);
      if (!p) {
        const nuevo = await Proveedor.create({ nombre: i.nombre, contacto: i.contacto, tipo: i.web ? "web" : "proveedor" }, { transaction: t });
        porNombre.set(i.nombre, nuevo);
        resumen.proveedores_nuevos++;
      } else {
        const cambios = {};
        if (!p.contacto && i.contacto) cambios.contacto = i.contacto;
        if (i.web && p.tipo !== "web") cambios.tipo = "web";
        if (Object.keys(cambios).length) await p.update(cambios, { transaction: t });
      }
    }
    const webs = new Set([...porNombre.values()].filter((p) => p.tipo === "web").map((p) => normProv(p.nombre)));

    // --- Productos: por descripción exacta; si no, por N° (solo productos que ya vinieron de la planilla) ---
    const actuales = await Producto.findAll({ transaction: t });
    const porCodigo = new Map(actuales.filter((p) => p.codigo && p.en_planilla).map((p) => [Number(p.codigo), p]));
    const porDesc = new Map(actuales.map((p) => [sinTildes(p.nombre), p]));
    const idPorCodigo = new Map();
    const tocados = new Set();
    const confirmar = [];

    for (const f of filas) {
      let p = porDesc.get(sinTildes(f.nombre)) || porCodigo.get(f.codigo);
      if (p && tocados.has(p.id)) p = null; // descripción repetida en la planilla: va como producto aparte
      const datos = {
        codigo: f.codigo, categoria: f.categoria, nombre: f.nombre, unidad: f.unidad, activo: true, en_planilla: true,
        precio_compra: f.compra > 0 ? Math.round(f.compra) : null,
        proveedor: normProv(f.proveedor) && normProv(f.proveedor) !== "USUARIO" ? normProv(f.proveedor) : (f.proveedor || null),
        contacto: f.contacto, fecha_precio: f.fecha,
        opcion2_proveedor: f.op2.proveedor ? normProv(f.op2.proveedor) : null, opcion2_precio: f.op2.precio, opcion2_fecha: f.op2.fecha,
        opcion3_proveedor: f.op3.proveedor ? normProv(f.op3.proveedor) : null, opcion3_precio: f.op3.precio, opcion3_fecha: f.op3.fecha,
        confirmado: f.confirmado && f.compra > 0,
        revisar: f.confirmado ? null : f.revisar,
        fecha_confirmado: null,
      };
      if (p) { await p.update(datos, { transaction: t }); resumen.productos_actualizados++; }
      else { p = await Producto.create(datos, { transaction: t }); resumen.productos_nuevos++; }
      idPorCodigo.set(f.codigo, p.id);
      tocados.add(p.id);
      if (datos.confirmado) confirmar.push(p);
    }

    // --- Precios: historia sin duplicar ---
    const previos = await PrecioProveedor.findAll({ where: { producto_id: [...tocados] }, transaction: t });
    const clave = (x) => [x.producto_id, normProv(x.proveedor), x.fecha || "", Math.round(Number(x.precio)), sinTildes(x.documento || "")].join("|");
    const claveSuelta = (x) => [x.producto_id, normProv(x.proveedor), Math.round(Number(x.precio))].join("|");
    const vistos = new Map(previos.map((p) => [clave(p), p]));
    const vistosSueltos = new Set(previos.map(claveSuelta));
    const nuevos = [];
    const hoy = new Date().toISOString().slice(0, 10);
    const agregar = (x) => {
      const reg = { ...x, fecha: x.fecha || hoy, creado_por: usuario };
      const k = clave(reg);
      if (vistos.has(k)) {
        // ya existe: completar marca / calce / descripción si vienen de EXTRAS
        const e = vistos.get(k);
        ["marca", "calce", "descripcion_proveedor"].forEach((c2) => { if (reg[c2] && !e[c2]) e[c2] = reg[c2]; });
        return;
      }
      vistos.set(k, reg);
      vistosSueltos.add(claveSuelta(reg));
      nuevos.push(reg);
    };

    for (const x of cotizaciones) {
      const producto_id = idPorCodigo.get(x.codigo);
      if (producto_id) agregar({ ...x, producto_id, origen: x.origen === "web" || webs.has(x.proveedor) ? "web" : "proveedor" });
    }
    for (const x of extras) {
      const producto_id = idPorCodigo.get(x.codigo);
      if (producto_id) agregar({ ...x, producto_id, origen: webs.has(x.proveedor) ? "web" : "proveedor" });
    }
    // Precio principal y opciones del listado que no estén en la historia
    for (const f of filas) {
      const producto_id = idPorCodigo.get(f.codigo);
      const lineas = [
        { proveedor: f.proveedor, precio: f.compra, fecha: f.fecha, contacto: f.contacto },
        { ...f.op2 }, { ...f.op3 },
      ];
      for (const l of lineas) {
        if (!(l.precio > 0)) continue;
        const prov = normProv(l.proveedor) && normProv(l.proveedor) !== "USUARIO" ? normProv(l.proveedor) : "SIN PROVEEDOR";
        const reg = { producto_id, proveedor: prov, precio: Math.round(l.precio), fecha: l.fecha };
        if (vistosSueltos.has(claveSuelta(reg))) continue;
        agregar({ ...reg, documento: DOC_PLANILLA, origen: webs.has(prov) || /precio web/i.test(l.contacto || "") ? "web" : "proveedor" });
      }
    }
    for (const e of vistos.values()) if (e.changed && e.changed()) await e.save({ transaction: t });
    for (let i = 0; i < nuevos.length; i += 1000) {
      await PrecioProveedor.bulkCreate(nuevos.slice(i, i + 1000), { transaction: t });
    }
    resumen.precios_agregados = nuevos.length;

    // Precios más baratos que la planilla no aplicó (otro formato, medida, etc.): quedan descartados
    // con motivo, así el sistema parte con el mismo precio vigente que la planilla.
    const filaPorId = new Map(filas.map((f) => [idPorCodigo.get(f.codigo), f]));
    const todos = await PrecioProveedor.findAll({ where: { producto_id: [...tocados] }, transaction: t });
    const porProd = new Map();
    todos.forEach((x) => { if (!porProd.has(x.producto_id)) porProd.set(x.producto_id, []); porProd.get(x.producto_id).push(x); });
    resumen.precios_descartados = 0;
    for (const [pid, lista] of porProd) {
      const f = filaPorId.get(pid);
      if (!f || f.confirmado || !(f.compra > 0)) continue;
      const compra = Math.round(f.compra);
      for (let vuelta = 0; vuelta < 20; vuelta++) {
        const v = vigentesPorProveedor(lista)[0];
        if (!v || Math.round(Number(v.precio)) >= compra) break;
        v.descartado = true;
        v.motivo = "No aplicado en la planilla (más barato pero no se usó): revisar";
        await v.save({ transaction: t });
        resumen.precios_descartados++;
      }
    }

    // Confirmados: la fecha de confirmación es posterior a todos los precios cargados
    const ahora = new Date();
    if (confirmar.length) {
      await Producto.update({ fecha_confirmado: ahora }, { where: { id: confirmar.map((p) => p.id) }, transaction: t });
    }

    // Productos que no están en la planilla: si su N° choca con uno de la planilla, se renumeran al final
    const codigosPlanilla = new Set(filas.map((f) => f.codigo));
    const otros = await Producto.findAll({ where: { id: { [Op.notIn]: [...tocados] } }, order: [["id", "ASC"]], transaction: t });
    let siguiente = Math.max(0, ...filas.map((f) => f.codigo), ...otros.map((p) => Number(p.codigo) || 0)) + 1;
    for (const p of otros) {
      if (!p.codigo || codigosPlanilla.has(Number(p.codigo))) await p.update({ codigo: siguiente++, en_planilla: false }, { transaction: t });
    }

    // Productos antiguos que no están en la planilla
    if (desactivarOtros) {
      const [n] = await Producto.update({ activo: false }, { where: { id: { [Op.notIn]: [...tocados] }, activo: true }, transaction: t });
      resumen.desactivados = n;
    } else {
      resumen.fuera_de_planilla = await Producto.count({ where: { id: { [Op.notIn]: [...tocados] }, activo: true }, transaction: t });
    }

    // Registro de cambios (una sola vez)
    const yaImportado = await RegistroCambio.count({ where: { motivo: MOTIVO_REGISTRO }, transaction: t });
    if (!yaImportado && registro.length) {
      const filasReg = registro.map((r) => ({
        usuario: "planilla", tabla: "productos", registro_id: r.n ? idPorCodigo.get(r.n) || null : null,
        campo: r.campo, antes: r.antes, despues: r.despues, motivo: MOTIVO_REGISTRO,
      }));
      for (let i = 0; i < filasReg.length; i += 2000) await RegistroCambio.bulkCreate(filasReg.slice(i, i + 2000), { transaction: t });
      resumen.registro_cambios = filasReg.length;
    }

    await RegistroCambio.create({
      usuario, tabla: "productos", campo: "importación",
      despues: `${filas.length} productos, ${nuevos.length} precios nuevos`, motivo: "Importación de planilla",
    }, { transaction: t });

    resumen.productos_en_planilla = filas.length;
    resumen.con_precio = filas.filter((f) => f.compra > 0).length;
    resumen.confirmados = confirmar.length;
    resumen.cotizaciones_leidas = cotizaciones.length;
    resumen.extras_leidos = extras.length;
    return resumen;
  });
}

module.exports = { importarPlanilla };
