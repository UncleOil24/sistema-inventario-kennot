const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Pago = require("../models/Pago");
const Venta = require("../models/Venta");
const OrdenCompra = require("../models/OrdenCompra");
const { handler, ErrorNegocio, estadoPago } = require("../services/erp");

// GET /api/pagos?tipo=cobro|pago&desde=&hasta=   (flujo de caja)
const getPagos = handler(async (req, res) => {
  const { tipo, desde, hasta } = req.query;
  const where = {};
  if (tipo) where.tipo = tipo;
  if (desde || hasta) where.fecha = { ...(desde && { [Op.gte]: desde }), ...(hasta && { [Op.lte]: hasta }) };
  const pagos = await Pago.findAll({ where, order: [["fecha", "DESC"], ["id", "DESC"]], limit: 500 });

  // Adjunta número y contraparte para mostrarlos en la lista
  const ventaIds = pagos.filter((p) => p.venta_id).map((p) => p.venta_id);
  const ocIds = pagos.filter((p) => p.orden_compra_id).map((p) => p.orden_compra_id);
  const [ventas, ocs] = await Promise.all([
    ventaIds.length ? Venta.findAll({ where: { id: ventaIds }, attributes: ["id", "numero", "cliente_nombre"] }) : [],
    ocIds.length ? OrdenCompra.findAll({ where: { id: ocIds }, attributes: ["id", "numero", "proveedor_nombre"] }) : [],
  ]);
  const vMap = new Map(ventas.map((v) => [v.id, v]));
  const oMap = new Map(ocs.map((o) => [o.id, o]));
  const data = pagos.map((p) => {
    const ref = p.venta_id ? vMap.get(p.venta_id) : oMap.get(p.orden_compra_id);
    return {
      ...p.toJSON(),
      referencia_numero: ref?.numero || null,
      contraparte: ref ? (ref.cliente_nombre ?? ref.proveedor_nombre) : null,
    };
  });
  res.json({ ok: true, data });
});

// DELETE /api/pagos/:id   -> recalcula el saldo del documento
const eliminarPago = handler(async (req, res) => {
  await sequelize.transaction(async (t) => {
    const pago = await Pago.findByPk(req.params.id, { transaction: t });
    if (!pago) throw new ErrorNegocio("Pago no encontrado", 404);
    const Modelo = pago.venta_id ? Venta : OrdenCompra;
    const docId = pago.venta_id || pago.orden_compra_id;
    const doc = await Modelo.findByPk(docId, { transaction: t, lock: t.LOCK.UPDATE });
    await pago.destroy({ transaction: t });
    if (doc) {
      const pagado = Math.max(0, Number(doc.monto_pagado) - Number(pago.monto));
      await doc.update({ monto_pagado: pagado, estado_pago: estadoPago(pagado, doc.total) }, { transaction: t });
    }
  });
  res.json({ ok: true, message: "Pago eliminado" });
});

module.exports = { getPagos, eliminarPago };
