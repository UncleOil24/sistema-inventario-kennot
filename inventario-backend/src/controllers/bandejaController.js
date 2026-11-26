const crypto = require("crypto");
const { Op } = require("sequelize");
const { firma } = require("../middlewares/auth");
const DocumentoBandeja = require("../models/DocumentoBandeja");
const OrdenCompra = require("../models/OrdenCompra");
const Venta = require("../models/Venta");
const { handler, ErrorNegocio } = require("../services/erp");
const { empresaCompradora } = require("../services/empresas");
const { getParametros } = require("../services/parametros");
const { normProv } = require("../services/precios");
const { proveedorDeDocumento } = require("../services/proveedorDoc");
const dte = require("../services/dte");
const ia = require("../services/ia");

// Bandeja de documentos: se sube todo en el momento (desde el celular: foto, PDF o el XML de la factura electrónica)
// y Operativo lo procesa después con "Subir factura" (registra la compra con su venta).

const SIN_DATOS = { exclude: ["datos"] };
const tipoDe = (f) => (dte.esXML(f) ? "xml" : /pdf/i.test(f.mimetype || "") || /\.pdf$/i.test(f.originalname || "") ? "pdf" : "imagen");
const hashDe = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// Lo que se lee del documento: proveedor (nuestro nombre), folio, fecha, total, empresa; duplicados y compra sugerida
async function completar(doc, lectura) {
  const e = lectura.encabezado || {};
  const prov = await proveedorDeDocumento(e);
  const proveedor = prov?.nombre || normProv(e.proveedor || "") || null;
  const folio = String(e.numero_documento || "").trim() || null;
  const total = Number(e.total_documento) || (lectura.control?.total_documento ? Math.round(lectura.control.total_documento * (lectura.control.precios_incluyen_iva ? 1 : 1.19)) : null);
  const empresa = empresaCompradora(e.cliente_rut, e.cliente_razon_social, await getParametros());
  const cambios = { lectura, proveedor, folio, fecha_documento: e.fecha || null, total, empresa, leyendo: false, error_lectura: null };
  // Duplicado: el mismo proveedor y N° ya registrado en una compra, o ya en la bandeja
  if (proveedor && folio) {
    const compra = await OrdenCompra.findOne({ where: { documento: { [Op.in]: [folio, `BOL ${folio}`] }, proveedor_nombre: proveedor, estado: { [Op.ne]: "anulada" } }, attributes: ["id", "numero"] });
    const otro = await DocumentoBandeja.findOne({ where: { id: { [Op.ne]: doc.id }, proveedor, folio, estado: { [Op.notIn]: ["descartado", "duplicado"] } }, attributes: ["id", "subido_por", "createdAt"] });
    if (compra) Object.assign(cambios, { estado: "duplicado", duplicado_de: `Ya registrado en ${compra.numero}` });
    else if (otro) Object.assign(cambios, { estado: "duplicado", duplicado_de: `Ya está en la bandeja (subido por ${otro.subido_por || "—"})` });
  }
  if (cambios.estado !== "duplicado") cambios.sugerencia = await sugerir(doc, proveedor, Number(e.neto) || Number(lectura.control?.total_documento) || 0);
  await doc.update(cambios);
}

// Compra sugerida: una orden sin recibir del mismo proveedor. Si se indicó la venta, SOLO entre las de esa venta
// (si no hay, es una compra nueva de esa venta); sin venta, entre todas, la de total más parecido.
async function sugerir(doc, proveedor, neto) {
  if (!proveedor) return doc.venta_id ? { orden_id: null, venta_id: doc.venta_id } : null;
  const where = { proveedor_nombre: proveedor, estado: { [Op.notIn]: ["anulada", "recibida"] }, ...(doc.venta_id ? { venta_id: doc.venta_id } : {}) };
  const ordenes = await OrdenCompra.findAll({ where, attributes: ["id", "numero", "venta_id", "subtotal"] });
  const orden = ordenes.sort((a, b) => Math.abs(Number(a.subtotal) - neto) - Math.abs(Number(b.subtotal) - neto))[0];
  if (!orden) return doc.venta_id ? { orden_id: null, venta_id: doc.venta_id } : null;
  const v = orden.venta_id ? await Venta.findByPk(orden.venta_id, { attributes: ["numero", "cliente_nombre"] }) : null;
  return { orden_id: orden.id, orden_numero: orden.numero, venta_id: orden.venta_id, venta_numero: v?.numero || null, cliente: v?.cliente_nombre || null };
}

// Lectura en segundo plano (fotos y PDF con IA), de a una para no saturar
let cola = Promise.resolve();
function leerEnFondo(id, usuario) {
  cola = cola.then(async () => {
    const doc = await DocumentoBandeja.findByPk(id);
    if (!doc) return;
    try {
      const lectura = await ia.extraerDocumento({ buffer: doc.datos, originalname: doc.nombre_archivo, mimetype: doc.mime }, usuario);
      await completar(doc, lectura);
    } catch (e) {
      await doc.update({ leyendo: false, error_lectura: String(e.message || e).slice(0, 480) });
    }
  }).catch(() => {});
}

// POST /api/bandeja   (multipart: archivos[], venta_id, nota)
const subir = handler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw new ErrorNegocio("Adjunta al menos un documento (foto, PDF o XML)");
  const usuario = firma(req);
  const ventaId = Number(req.body?.venta_id) || null;
  const nota = String(req.body?.nota || "").trim().slice(0, 500) || null;
  // Respaldo de venta (cedible o guía firmada por el cliente): no se lee con IA, solo se guarda para asignarlo a la venta
  const clase = req.body?.clase === "venta" ? "venta" : "compra";
  const out = [];
  for (const f of files) {
    const nombre = String(f.originalname || "documento").slice(0, 200);
    // XML: uno por cada factura que traiga; se leen al tiro (datos exactos, sin IA)
    const partes = clase === "compra" && tipoDe(f) === "xml"
      ? (() => { try { return dte.leerDTE(f.buffer).map((d, n, arr) => ({ buf: arr.length > 1 ? Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<DTE version="1.0"><Documento>${d.xml}</Documento></DTE>`, "utf8") : f.buffer, lectura: d.datos, nombre: arr.length > 1 ? `${nombre.replace(/\.xml$/i, "")}_${d.datos.encabezado.numero_documento || n + 1}.xml` : nombre })); }
        catch (e) { out.push({ nombre, error: e.message }); return []; } })()
      : [{ buf: f.buffer, lectura: null, nombre }];
    for (const p of partes) {
      const hash = hashDe(p.buf);
      const igual = await DocumentoBandeja.findOne({ where: { hash, estado: { [Op.ne]: "descartado" } }, attributes: SIN_DATOS });
      if (igual) { out.push({ nombre: p.nombre, repetido: true, id: igual.id, mensaje: `Ya estaba en la bandeja (subido por ${igual.subido_por || "—"})` }); continue; }
      const doc = await DocumentoBandeja.create({
        nombre_archivo: p.nombre, mime: p.lectura ? "application/xml" : f.mimetype || "application/octet-stream", tipo: p.lectura ? "xml" : tipoDe(f),
        tamano: p.buf.length, hash, datos: p.buf, venta_id: ventaId, nota, subido_por: usuario, leyendo: clase === "compra" && !p.lectura, clase,
      });
      if (clase === "venta") { /* se registra a mano en la venta */ }
      else if (p.lectura) await completar(doc, p.lectura); else leerEnFondo(doc.id, usuario);
      out.push({ nombre: p.nombre, id: doc.id });
    }
  }
  res.status(201).json({ ok: true, data: out });
});

// GET /api/bandeja?estado=por_procesar|procesado|descartado|duplicado|todos
const listar = handler(async (req, res) => {
  const estado = String(req.query.estado || "por_procesar");
  const where = estado === "todos" ? {} : { estado };
  const docs = await DocumentoBandeja.findAll({ where, attributes: { exclude: ["datos", "lectura"] }, order: [["createdAt", "DESC"]], limit: 300 });
  const ventaIds = [...new Set(docs.map((d) => d.venta_id).filter(Boolean))];
  const ventas = ventaIds.length ? await Venta.findAll({ where: { id: ventaIds }, attributes: ["id", "numero", "cliente_nombre", "empresa"] }) : [];
  const ordenIds = [...new Set(docs.map((d) => d.orden_id).filter(Boolean))];
  const ordenes = ordenIds.length ? await OrdenCompra.findAll({ where: { id: ordenIds }, attributes: ["id", "numero"] }) : [];
  // Compras abiertas de cada venta, para elegir a cuál pertenece el documento
  const abiertas = ventaIds.length ? await OrdenCompra.findAll({ where: { venta_id: ventaIds, estado: { [Op.notIn]: ["anulada", "recibida"] } }, attributes: ["id", "numero", "venta_id", "proveedor_nombre", "total"], order: [["id", "DESC"]] }) : [];
  const conteo = await DocumentoBandeja.count({ group: ["estado"] });
  res.json({ ok: true, data: {
    documentos: docs.map((d) => ({ ...d.toJSON(), venta: ventas.find((v) => v.id === d.venta_id) || null, orden_numero: ordenes.find((o) => o.id === d.orden_id)?.numero || null,
      compras_venta: abiertas.filter((o) => o.venta_id === d.venta_id).map((o) => ({ id: o.id, numero: o.numero, proveedor: o.proveedor_nombre, total: Number(o.total) })) })),
    conteo: Object.fromEntries(conteo.map((c) => [c.estado, Number(c.count)])),
  } });
});

// GET /api/bandeja/resumen  — cuántos hay por procesar (para el aviso)
const resumen = handler(async (req, res) => {
  res.json({ ok: true, data: { por_procesar: await DocumentoBandeja.count({ where: { estado: "por_procesar" } }) } });
});

// GET /api/bandeja/:id/archivo
const archivo = handler(async (req, res) => {
  const d = await DocumentoBandeja.findByPk(req.params.id);
  if (!d) throw new ErrorNegocio("Documento no encontrado", 404);
  res.setHeader("Content-Type", d.mime);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(d.nombre_archivo)}"`);
  res.send(d.datos);
});

// GET /api/bandeja/:id/lectura  — lo leído del documento (para ver un XML como factura)
const lectura = handler(async (req, res) => {
  const d = await DocumentoBandeja.findByPk(req.params.id, { attributes: SIN_DATOS });
  if (!d) throw new ErrorNegocio("Documento no encontrado", 404);
  res.json({ ok: true, data: d });
});

// PUT /api/bandeja/:id  { venta_id, nota, estado: "descartado" | "por_procesar" }
const actualizar = handler(async (req, res) => {
  const d = await DocumentoBandeja.findByPk(req.params.id, { attributes: SIN_DATOS });
  if (!d) throw new ErrorNegocio("Documento no encontrado", 404);
  const b = req.body || {};
  const cambios = {};
  if ("venta_id" in b) cambios.venta_id = Number(b.venta_id) || null;
  if ("nota" in b) cambios.nota = String(b.nota || "").trim().slice(0, 500) || null;
  if (b.estado === "descartado" || b.estado === "por_procesar") {
    if (d.estado === "procesado") throw new ErrorNegocio("Ya está procesado (tiene su compra registrada)");
    cambios.estado = b.estado;
    if (b.estado === "por_procesar") cambios.duplicado_de = null;
  }
  // Compra a la que pertenece, elegida a mano (null = compra nueva de la venta)
  if ("orden_id" in b) {
    const oid = Number(b.orden_id) || null;
    if (oid) {
      const o = await OrdenCompra.findByPk(oid, { attributes: ["id", "numero", "venta_id"] });
      if (!o) throw new ErrorNegocio("Compra no encontrada");
      const v = o.venta_id ? await Venta.findByPk(o.venta_id, { attributes: ["numero", "cliente_nombre"] }) : null;
      cambios.sugerencia = { orden_id: o.id, orden_numero: o.numero, venta_id: o.venta_id, venta_numero: v?.numero || null, cliente: v?.cliente_nombre || null, elegida: true };
      if (o.venta_id) cambios.venta_id = o.venta_id;
    } else cambios.sugerencia = { orden_id: null, venta_id: cambios.venta_id ?? d.venta_id, elegida: true };
  } else if ("venta_id" in cambios && cambios.venta_id !== d.venta_id) {
    d.venta_id = cambios.venta_id;
    cambios.sugerencia = await sugerir(d, d.proveedor, Number(d.total) ? Number(d.total) / 1.19 : 0);
  }
  await d.update(cambios);
  res.json({ ok: true, data: d });
});

// POST /api/bandeja/:id/leer  — volver a leer (si falló la lectura)
const releer = handler(async (req, res) => {
  const d = await DocumentoBandeja.findByPk(req.params.id, { attributes: SIN_DATOS });
  if (!d) throw new ErrorNegocio("Documento no encontrado", 404);
  await d.update({ leyendo: true, error_lectura: null });
  leerEnFondo(d.id, firma(req));
  res.json({ ok: true });
});

// POST /api/bandeja/:id/a-venta  { venta_id, tipo, folio, fecha } — guarda el documento como respaldo de la venta
const aVenta = handler(async (req, res) => {
  const { TIPOS_RESPALDO } = require("../services/respaldoVenta");
  const DocumentoVenta = require("../models/DocumentoVenta");
  const HistorialVenta = require("../models/HistorialVenta");
  const d = await DocumentoBandeja.findByPk(req.params.id);
  if (!d) throw new ErrorNegocio("Documento no encontrado", 404);
  if (d.documento_venta_id) throw new ErrorNegocio("Este documento ya se registró en una venta");
  const b = req.body || {};
  const v = await Venta.findByPk(Number(b.venta_id) || d.venta_id || 0);
  if (!v) throw new ErrorNegocio("Elige la venta a la que pertenece");
  const tipo = TIPOS_RESPALDO[b.tipo] ? b.tipo : "otro_respaldo";
  const folio = String(b.folio || "").trim().slice(0, 40) || null;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || "") ? b.fecha : null;
  const dv = await DocumentoVenta.create({ venta_id: v.id, tipo, folio, fecha, nombre_archivo: d.nombre_archivo, mime: d.mime, datos: d.datos, creado_por: firma(req) });
  await d.update({ venta_id: v.id, clase: "venta", documento_venta_id: dv.id, estado: "procesado", procesado_por: firma(req), procesado_en: new Date(), folio: folio || d.folio, leyendo: false });
  await HistorialVenta.anotar(v, "paso", `${TIPOS_RESPALDO[tipo]}${folio ? ` N° ${folio}` : ""} registrada desde Documentos`, req, null);
  res.json({ ok: true, data: { documento_venta_id: dv.id, venta_numero: v.numero } });
});

module.exports = { aVenta, subir, listar, resumen, archivo, lectura, actualizar, releer };
