// Respaldo de una venta: en qué va y qué documentos de recepción faltan (factura cedible recepcionada por el
// cliente y guía de despacho recepcionada). Se calcula de a muchas ventas a la vez (lista de ventas).
const { Op } = require("sequelize");
const Factura = require("../models/Factura");
const DocumentoVenta = require("../models/DocumentoVenta");
const OrdenCompra = require("../models/OrdenCompra");

const TIPOS_RESPALDO = { cedible: "Factura cedible recepcionada", guia_recepcion: "Guía de despacho recepcionada", recepcion: "Recepción conforme / acta", otro_respaldo: "Otro respaldo" };
const norm = (f) => String(f || "").replace(/\D/g, "").replace(/^0+/, "");

async function respaldos(ventas) {
  const ids = ventas.map((v) => v.id);
  if (!ids.length) return new Map();
  const [facturas, docs, ocs] = await Promise.all([
    Factura.findAll({ where: { venta_id: ids }, attributes: ["venta_id", "numero"], raw: true }),
    DocumentoVenta.findAll({ where: { venta_id: ids, tipo: { [Op.in]: Object.keys(TIPOS_RESPALDO) } }, attributes: ["venta_id", "tipo", "folio"], raw: true }),
    OrdenCompra.findAll({ where: { venta_id: ids, estado: { [Op.ne]: "anulada" } }, attributes: ["venta_id", "estado"], raw: true }),
  ]);
  const out = new Map();
  for (const v of ventas) {
    if (v.estado === "anulada") { out.set(v.id, { checks: [], faltan: [] }); continue; }
    const fs = facturas.filter((f) => f.venta_id === v.id);
    const ds = docs.filter((d) => d.venta_id === v.id);
    const os = ocs.filter((o) => o.venta_id === v.id);
    const despachada = ["despachada", "entregada"].includes(v.etapa);
    const entregada = v.etapa === "entregada";
    const recibidas = os.filter((o) => o.estado === "recibida").length;
    const comprasOk = ["productos_listos", "despachada", "entregada"].includes(v.etapa) || (os.length > 0 && recibidas === os.length);
    const facturada = v.estado_factura === "facturada";
    const cedibles = new Set(ds.filter((d) => d.tipo === "cedible").map((d) => norm(d.folio)));
    const sinCedible = (despachada || facturada) ? fs.filter((f) => !cedibles.has(norm(f.numero))).map((f) => f.numero) : [];
    const guiaRecep = ds.some((d) => d.tipo === "guia_recepcion" && (!v.guia_despacho || !d.folio || norm(d.folio) === norm(v.guia_despacho)));
    const faltaGuia = !!v.guia_despacho && despachada && !guiaRecep;
    const pagada = v.estado_pago === "pagada";
    const checks = [
      { clave: "compras", ok: comprasOk, texto: comprasOk ? "Material comprado y recepcionado" : os.length ? `Compras recepcionadas ${recibidas} de ${os.length}` : "Material por comprar" },
      { clave: "despacho", ok: despachada, texto: despachada ? `Productos despachados${v.guia_despacho ? ` (guía ${v.guia_despacho})` : ""}` : "Por despachar" },
      { clave: "factura", ok: facturada, texto: fs.length ? `Factura${fs.length > 1 ? "s" : ""} ${fs.map((f) => f.numero).join(", ")}${facturada ? "" : " (parcial)"}` : "Sin factura" },
      { clave: "cedible", ok: fs.length > 0 && !sinCedible.length && (despachada || facturada), texto: !fs.length ? "Cedible: falta la factura" : sinCedible.length ? `FALTA DOC CEDIBLE: factura ${sinCedible.join(", ")}` : (despachada || facturada) ? "Cedible recepcionada" : "Cedible: después del despacho" },
      ...(v.guia_despacho ? [{ clave: "guia", ok: guiaRecep, texto: guiaRecep ? `Guía ${v.guia_despacho} recepcionada` : `FALTA GUÍA RECEPCIONADA: ${v.guia_despacho}` }] : []),
      { clave: "entrega", ok: entregada, texto: entregada ? "Cliente recibió" : "Por entregar" },
      { clave: "pago", ok: pagada, texto: pagada ? "Pagada" : v.estado_pago === "parcial" ? "Pago parcial" : "Por cobrar" },
    ];
    const faltan = [...sinCedible.map((n) => `cedible ${n}`), ...(faltaGuia ? [`guía ${v.guia_despacho}`] : [])];
    const completada = entregada && pagada && facturada && !faltan.length;
    out.set(v.id, { checks, faltan, completada });
  }
  return out;
}

module.exports = { respaldos, TIPOS_RESPALDO };
