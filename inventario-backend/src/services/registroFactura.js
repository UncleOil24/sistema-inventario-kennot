// Deshacer el registro de una factura de compra.
// Mientras se registra, unos ganchos anotan (en la transacción) lo que se crea y el valor anterior de lo que se cambia;
// al final queda una fila en registros_factura con esa "foto". Deshacer vuelve todo a como estaba y deja el
// documento otra vez por procesar en la bandeja.
const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const OrdenCompra = require("../models/OrdenCompra");
const Venta = require("../models/Venta");
const Producto = require("../models/Producto");
const Gasto = require("../models/Gasto");
const Pago = require("../models/Pago");
const PrecioProveedor = require("../models/PrecioProveedor");
const DocumentoCompra = require("../models/DocumentoCompra");
const RegistroFactura = require("../models/RegistroFactura");
const { registrar } = require("./precios");
const { ErrorNegocio } = require("./erp");

const MODELOS = { ordenes: OrdenCompra, ventas: Venta, productos: Producto, gastos: Gasto, pagos: Pago, precios: PrecioProveedor, documentos: DocumentoCompra };
const CON_FOTO = new Set(["ordenes", "ventas", "productos", "gastos"]); // de estos se guarda el valor anterior al cambiarlos
let instalado = false;
function instalar() {
  if (instalado) return;
  instalado = true;
  for (const [nombre, M] of Object.entries(MODELOS)) {
    M.addHook("afterCreate", "registroFactura", (inst, opt) => {
      const r = opt?.transaction?.__registroFactura;
      if (r) (r.creados[nombre] = r.creados[nombre] || []).push(inst.id);
    });
    if (CON_FOTO.has(nombre)) {
      M.addHook("beforeUpdate", "registroFactura", (inst, opt) => {
        const r = opt?.transaction?.__registroFactura;
        if (!r || (r.creados[nombre] || []).includes(inst.id)) return;
        const k = `${nombre}:${inst.id}`;
        const f = r.antes[k] = r.antes[k] || { tabla: nombre, id: inst.id, campos: {} };
        for (const c of inst.changed() || []) if (!(c in f.campos)) f.campos[c] = inst.previous(c) ?? null;
      });
      M.addHook("beforeDestroy", "registroFactura", (inst, opt) => {
        const r = opt?.transaction?.__registroFactura;
        if (r && !(r.creados[nombre] || []).includes(inst.id)) r.borrados.push({ tabla: nombre, fila: inst.get({ plain: true }) });
      });
    }
  }
}

// Al empezar a registrar (dentro de la transacción)
function iniciar(t) { instalar(); t.__registroFactura = { creados: {}, antes: {}, borrados: [] }; }

// Al terminar de registrar (dentro de la transacción): guarda la foto
async function guardar(t, { folio, proveedor, total, bandeja_id, usuario }) {
  const r = t.__registroFactura;
  if (!r) return null;
  t.__registroFactura = null;
  const tocadas = Object.values(r.antes).filter((f) => f.tabla === "ordenes").map((f) => f.id);
  const ordenes = [...new Set([...(r.creados.ordenes || []), ...tocadas])];
  return RegistroFactura.create({ folio, proveedor, total, bandeja_id: Number(bandeja_id) || null, ordenes,
    antes: { filas: Object.values(r.antes), borrados: r.borrados }, creados: r.creados, creado_por: usuario }, { transaction: t });
}

// Registro vigente (no deshecho) de una compra o de un documento de la bandeja
async function buscar({ orden_id, bandeja_id }) {
  const where = { deshecho_en: null };
  if (Number(orden_id)) where.ordenes = { [Op.contains]: [Number(orden_id)] };
  else if (Number(bandeja_id)) where.bandeja_id = Number(bandeja_id);
  else return null;
  return RegistroFactura.findOne({ where, order: [["id", "DESC"]] });
}

// Qué impide deshacer o qué hay que confirmar
async function revisar(reg) {
  const bloqueos = [], avisos = [];
  const posteriores = await RegistroFactura.findAll({ where: { id: { [Op.gt]: reg.id }, deshecho_en: null }, attributes: ["id", "folio", "proveedor", "ordenes"] });
  for (const p of posteriores) if ((p.ordenes || []).some((o) => (reg.ordenes || []).includes(o))) bloqueos.push(`Primero deshaz la factura ${p.folio} de ${p.proveedor}, que se registró después en la misma compra.`);
  const pagosNuevos = await Pago.findAll({ where: { orden_compra_id: reg.ordenes || [], id: { [Op.notIn]: reg.creados.pagos?.length ? reg.creados.pagos : [0] }, createdAt: { [Op.gt]: reg.createdAt }, nota: { [Op.or]: [null, { [Op.notLike]: "Pago automático%" }] } }, attributes: ["id", "monto", "orden_compra_id"] });
  if (pagosNuevos.length) bloqueos.push(`Hay ${pagosNuevos.length} pago(s) al proveedor registrados después en estas compras: quítalos primero en Finanzas.`);
  const ventasIds = [...new Set((reg.antes.filas || []).filter((f) => f.tabla === "ventas").map((f) => f.id))];
  const ordenes = await OrdenCompra.findAll({ where: { id: reg.ordenes || [] }, attributes: ["id", "numero", "venta_id"] });
  for (const o of ordenes) if (o.venta_id) ventasIds.push(o.venta_id);
  const ventas = await Venta.findAll({ where: { id: [...new Set(ventasIds)] }, attributes: ["id", "numero", "etapa"] });
  for (const v of ventas) if (["despachada", "entregada"].includes(v.etapa)) avisos.push(`La venta ${v.numero} ya está ${v.etapa}.`);
  return { bloqueos, avisos, compras: ordenes.map((o) => o.numero).filter(Boolean), ventas: ventas.map((v) => v.numero) };
}

async function deshacer(reg, { usuario, motivo, confirmar }) {
  if (reg.deshecho_en) throw new ErrorNegocio("Este registro ya se deshizo");
  const rev = await revisar(reg);
  if (rev.bloqueos.length) throw new ErrorNegocio(rev.bloqueos.join(" "));
  if (rev.avisos.length && !confirmar) throw new ErrorNegocio(`Confirma para deshacer: ${rev.avisos.join(" ")}`, 409);
  const C = reg.creados || {};
  const doc = `factura ${reg.folio} de ${reg.proveedor}`;
  return sequelize.transaction(async (t) => {
    // Archivo de la factura (para dejarlo otra vez en la bandeja si no venía de ahí)
    const archivo = !reg.bandeja_id && C.documentos?.length ? await DocumentoCompra.findOne({ where: { id: C.documentos }, transaction: t }) : null;
    // 1. Lo que el registro creó
    if (C.pagos?.length) await Pago.destroy({ where: { id: C.pagos }, transaction: t, hooks: false });
    if (C.documentos?.length) await DocumentoCompra.destroy({ where: { id: C.documentos }, transaction: t, hooks: false });
    if (C.gastos?.length) await Gasto.destroy({ where: { id: C.gastos }, transaction: t, hooks: false });
    const preciosDe = C.precios?.length ? (await PrecioProveedor.findAll({ where: { id: C.precios }, attributes: ["producto_id"], transaction: t })).map((p) => p.producto_id) : [];
    if (C.precios?.length) await PrecioProveedor.destroy({ where: { id: C.precios }, transaction: t, hooks: false });
    for (const id of C.ordenes || []) {
      await OrdenCompra.update({ estado: "anulada", monto_pagado: 0, estado_pago: "pendiente", notas: `Anulada al deshacer la ${doc}${motivo ? `: ${motivo}` : ""}`.slice(0, 500) }, { where: { id }, transaction: t, hooks: false });
    }
    // 2. Lo que cambió vuelve a su valor anterior (sin ganchos: no se generan pagos automáticos)
    for (const f of reg.antes.filas || []) {
      const M = MODELOS[f.tabla];
      if (!M || !Object.keys(f.campos).length) continue;
      await M.update(f.campos, { where: { id: f.id }, transaction: t, hooks: false });
    }
    // 3. Lo que se borró (un gasto que pasó a compra) vuelve
    for (const b of reg.antes.borrados || []) if (MODELOS[b.tabla]) await MODELOS[b.tabla].create(b.fila, { transaction: t, hooks: false });
    // 4. Pagado de las compras tocadas: según los pagos que quedan
    for (const o of await OrdenCompra.findAll({ where: { id: reg.ordenes || [], estado: { [Op.ne]: "anulada" } }, transaction: t })) {
      const pagado = Number(await Pago.sum("monto", { where: { orden_compra_id: o.id }, transaction: t })) || 0;
      await OrdenCompra.update({ monto_pagado: pagado, estado_pago: pagado <= 0 ? "pendiente" : pagado >= Number(o.total) ? "pagada" : "parcial" }, { where: { id: o.id }, transaction: t, hooks: false });
    }
    // 5. Precio vigente de los productos que tenían precio de esta factura
    const { recalcular } = require("./precios");
    for (const pid of [...new Set(preciosDe)]) {
      const p = await Producto.findByPk(pid, { transaction: t });
      if (p) await recalcular(p, { t, usuario, motivo: `Se deshizo la ${doc}` });
    }
    // 6. El documento vuelve a la bandeja para corregirlo y registrarlo otra vez
    const DocumentoBandeja = require("../models/DocumentoBandeja");
    let bandejaId = reg.bandeja_id;
    if (bandejaId) {
      await DocumentoBandeja.update({ estado: "por_procesar", orden_id: null, gasto_id: null, procesado_por: null, procesado_en: null }, { where: { id: bandejaId }, transaction: t });
    } else if (archivo) {
      const crypto = require("crypto");
      const buf = Buffer.from(archivo.datos);
      const ventaOrigen = (await OrdenCompra.findOne({ where: { id: reg.ordenes || [] }, attributes: ["venta_id"], transaction: t }))?.venta_id || null;
      const d = await DocumentoBandeja.create({ nombre_archivo: archivo.nombre_archivo, mime: archivo.mime, tipo: /xml/i.test(archivo.mime) ? "xml" : /pdf/i.test(archivo.mime) ? "pdf" : "imagen",
        tamano: buf.length, hash: crypto.createHash("sha256").update(buf).digest("hex"), datos: buf, venta_id: ventaOrigen, clase: "compra", leyendo: false,
        estado: "por_procesar", folio: reg.folio, proveedor: reg.proveedor, nota: `Vuelve de deshacer el registro${motivo ? `: ${motivo}` : ""}`.slice(0, 500), subido_por: usuario }, { transaction: t });
      bandejaId = d.id;
    }
    await reg.update({ deshecho_en: new Date(), deshecho_por: usuario, motivo: String(motivo || "").slice(0, 300) || null }, { transaction: t });
    await registrar({ usuario, tabla: "registros_factura", registro_id: reg.id, campo: "deshecho", antes: rev.compras.join(", "), despues: "deshecho", motivo: `${doc}${motivo ? ` · ${motivo}` : ""}` }, t);
    return { bandeja_id: bandejaId, compras: rev.compras, releer: !reg.bandeja_id && !!archivo };
  });
}

module.exports = { iniciar, guardar, buscar, revisar, deshacer };
