// Facturas y guías emitidas en el portal gratuito del SII (decisión de gerencia, 10-nov-2026: 3 a 5 facturas al mes,
// no se contrata aún un proveedor con API). El sistema NO se conecta al SII ni guarda la clave ni la firma:
//  - GET  /api/ventas/:id/sii                  ficha con los datos que pide el portal, en su orden, para copiar
//  - POST /api/ventas/:id/sii/leer             lee el PDF del documento emitido (Claude) y lo compara con la venta
//  - POST /api/ventas/:id/sii/registrar        registra la factura o la guía y guarda el PDF en la venta
//  - GET  /api/ventas/:id/documentos/:docId    descarga el PDF guardado
const { firma } = require("../middlewares/auth");
const sequelize = require("../../config/database");
const Venta = require("../models/Venta");
const Cliente = require("../models/Cliente");
const Cotizacion = require("../models/Cotizacion");
const Factura = require("../models/Factura");
const DocumentoVenta = require("../models/DocumentoVenta");
const { handler, ErrorNegocio } = require("../services/erp");
const { getParametros } = require("../services/parametros");
const { datosEmpresa } = require("../services/empresas");
const ia = require("../services/ia");

// El PDF leído queda en memoria 30 minutos hasta que se confirme el registro (así no se sube dos veces)
const pendientes = new Map();
const guardarPendiente = (file) => {
  const ahora = Date.now();
  for (const [k, x] of pendientes) if (ahora - x.t > 30 * 60e3) pendientes.delete(k);
  const token = `${ahora.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  pendientes.set(token, { buf: file.buffer, nombre: file.originalname, mime: file.mimetype || "application/pdf", t: ahora });
  return token;
};
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const rutLimpio = (r) => String(r || "").replace(/[^0-9kK]/g, "").toUpperCase();

const ficha = handler(async (req, res) => {
  const v = await Venta.findByPk(req.params.id);
  if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
  const [cli, cot, params, docs] = await Promise.all([
    v.cliente_id ? Cliente.findByPk(v.cliente_id) : null,
    v.cotizacion_id ? Cotizacion.findByPk(v.cotizacion_id, { attributes: ["numero", "empresa", "lugar_entrega", "anterior"] }) : null,
    getParametros(),
    DocumentoVenta.findAll({ where: { venta_id: v.id }, attributes: ["id", "tipo", "folio", "fecha", "monto", "nombre_archivo", "createdAt", "creado_por"], order: [["id", "ASC"]] }),
  ]);
  const emp = datosEmpresa(v.empresa, params);
  const items = (v.items || []).map((i, k) => ({
    n: k + 1, descripcion: i.descripcion_cliente || i.nombre, cantidad: Number(i.cantidad), unidad: i.unidad || "",
    precio_neto: Math.round(Number(i.precio)), total_neto: Math.round(Number(i.precio) * Number(i.cantidad)),
  }));
  const falta = Math.round(Number(v.total) - Number(v.monto_facturado || 0));
  res.json({ ok: true, data: {
    venta: { id: v.id, numero: v.numero, etapa: v.etapa, estado_factura: v.estado_factura, guia: v.guia_despacho },
    emisor: { empresa: emp.corto || v.empresa, razon_social: emp.nombre, rut: emp.rut, giro: emp.giro },
    receptor: {
      rut: cli?.rut || null, razon_social: v.cliente_nombre || cli?.nombre || null, giro: cli?.giro || null,
      direccion: cli?.direccion || null, comuna: cli?.comuna || null, contacto: cli?.contacto || null, email: cli?.email || null,
      faltan: [!cli?.rut && "RUT", !cli?.giro && "giro", !cli?.direccion && "dirección", !cli?.comuna && "comuna"].filter(Boolean),
    },
    referencias: { oc: v.orden_compra_cliente || null, id_solicitud: v.id_solicitud || null, cotizacion: cot ? `${cot.empresa === "tactics" ? "Tactics" : "Kenott"} N°${cot.numero}` : null },
    entrega: { lugar: cot?.lugar_entrega || null, comuna: cli?.comuna || null },
    items, neto: Math.round(Number(v.subtotal)), iva: Math.round(Number(v.iva)), total: Math.round(Number(v.total)),
    falta_facturar: falta, plazo_pago: v.plazo_pago_dias,
    documentos: docs,
  } });
});

// Lee el PDF y compara con la venta (no guarda nada todavía)
const leer = handler(async (req, res) => {
  const v = await Venta.findByPk(req.params.id);
  if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
  if (!req.file) throw new ErrorNegocio("Adjunta el PDF de la factura o guía emitida en el SII");
  const d = await ia.leerDocumentoSII(req.file, firma(req));
  const [cli, params] = await Promise.all([v.cliente_id ? Cliente.findByPk(v.cliente_id) : null, getParametros()]);
  const emp = datosEmpresa(v.empresa, params);
  const total = Math.round(Number(d.total) || 0);
  const falta = Math.round(Number(v.total) - Number(v.monto_facturado || 0));
  const avisos = [];
  if (d.rut_emisor && emp.rut && rutLimpio(d.rut_emisor) !== rutLimpio(emp.rut)) avisos.push(`El emisor (${d.rut_emisor}) no es ${emp.corto || v.empresa} (${emp.rut}): ¿se emitió con la otra empresa?`);
  if (d.rut_receptor && cli?.rut && rutLimpio(d.rut_receptor) !== rutLimpio(cli.rut)) avisos.push(`El receptor (${d.rut_receptor} ${d.razon_social_receptor || ""}) no coincide con el cliente de la venta (${cli.rut})`);
  if (["factura", "factura_exenta"].includes(d.tipo)) {
    if (falta <= 0) avisos.push("La venta ya está facturada completa");
    else if (Math.abs(total - falta) > 2) avisos.push(`El total del documento ($${total.toLocaleString("es-CL")}) es distinto a lo que falta facturar ($${falta.toLocaleString("es-CL")}): quedará como factura parcial o revisa el monto`);
  }
  if (d.tipo === "guia" && total && Math.abs(total - Math.round(Number(v.total))) > 2) avisos.push(`El total de la guía ($${total.toLocaleString("es-CL")}) es distinto al de la venta ($${Math.round(Number(v.total)).toLocaleString("es-CL")})`);
  res.json({ ok: true, data: { ...d, total, falta_facturar: falta, avisos, archivo_token: guardarPendiente(req.file), nombre_archivo: req.file.originalname } });
});

// Registra: factura -> se agrega a las facturas de la venta (y al IVA); guía -> N° de guía (habilita el despacho)
const registrar = handler(async (req, res) => {
  const b = req.body || {};
  const tipo = ["factura", "factura_exenta", "guia", "nota_credito", "otro"].includes(b.tipo) ? b.tipo : null;
  if (!tipo) throw new ErrorNegocio("Tipo de documento inválido");
  const folio = String(b.folio || "").trim();
  if (!folio) throw new ErrorNegocio("Falta el N° de folio");
  const venta = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta está anulada");
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || "") ? b.fecha : hoy();
    if (tipo === "factura" || tipo === "factura_exenta") {
      if (await Factura.findOne({ where: { numero: folio }, transaction: t })) throw new ErrorNegocio(`La factura ${folio} ya está registrada`);
      const falta = Math.round(Number(v.total) - Number(v.monto_facturado || 0));
      const monto = require("./ventasController").montoConIva(Number(b.monto) || "", falta, v);
      if (!(monto > 0)) throw new ErrorNegocio(falta <= 0 ? "La venta ya está facturada completa" : "Monto inválido");
      if (monto > falta + 2) throw new ErrorNegocio(`El monto supera lo que falta por facturar ($${falta.toLocaleString("es-CL")})`);
      await Factura.create({ venta_id: v.id, numero: folio, fecha, monto, notas: "Emitida en el portal del SII", creado_por: firma(req) }, { transaction: t });
      const { recalcularFacturas } = require("./ventasController");
      await recalcularFacturas(v, t);
    } else if (tipo === "guia") {
      await v.update({ guia_despacho: folio }, { transaction: t });
    }
    const archivo = b.archivo_token ? pendientes.get(b.archivo_token) : null;
    if (archivo) {
      await DocumentoVenta.create({ venta_id: v.id, tipo: tipo.startsWith("factura") ? "factura" : tipo, folio, fecha, monto: Math.round(Number(b.monto) || 0) || null,
        nombre_archivo: String(archivo.nombre || `${tipo}_${folio}.pdf`).slice(0, 200), mime: archivo.mime, datos: archivo.buf, creado_por: firma(req) }, { transaction: t });
      pendientes.delete(b.archivo_token);
    }
    return v;
  });
  res.json({ ok: true, data: { id: venta.id, numero: venta.numero, estado_factura: venta.estado_factura, guia: venta.guia_despacho } });
});

const descargar = async (req, res) => {
  try {
    const d = await DocumentoVenta.findOne({ where: { id: req.params.docId, venta_id: req.params.id } });
    if (!d) return res.status(404).json({ ok: false, error: "Documento no encontrado" });
    res.setHeader("Content-Type", d.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(d.nombre_archivo)}"`);
    res.end(d.datos);
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: "No se pudo descargar" }); }
};

module.exports = { ficha, leer, registrar, descargar };
