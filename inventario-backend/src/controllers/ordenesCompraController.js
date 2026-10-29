const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const OrdenCompra = require("../models/OrdenCompra");
const Proveedor = require("../models/Proveedor");
const Producto = require("../models/Producto");
const Pago = require("../models/Pago");
const PrecioProveedor = require("../models/PrecioProveedor");
const {
  handler, ErrorNegocio, calcularTotales, normalizarItems, estadoPago,
} = require("../services/erp");
const { recalcular, origenDe, normProv } = require("../services/precios");

const numeroOC = (id) => `OC-${String(id).padStart(4, "0")}`;

// Completa nombre/unidad desde la BD y valida que los productos existan
const prepararItems = async (itemsBody, t) => {
  const items = normalizarItems(itemsBody);
  const productos = await Producto.findAll({ where: { id: items.map((i) => i.producto_id) }, transaction: t });
  const mapa = new Map(productos.map((p) => [p.id, p]));
  return items.map((i) => {
    const p = mapa.get(i.producto_id);
    if (!p) throw new ErrorNegocio(`Producto ${i.producto_id} no existe`, 404);
    return { producto_id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: i.cantidad, precio: i.precio };
  });
};

const datosProveedor = async (proveedor_id, t) => {
  if (!proveedor_id) throw new ErrorNegocio("Debe seleccionar un proveedor");
  const prov = await Proveedor.findByPk(proveedor_id, { transaction: t });
  if (!prov) throw new ErrorNegocio("Proveedor no encontrado", 404);
  return { proveedor_id: prov.id, proveedor_nombre: prov.nombre };
};

// GET /api/ordenes-compra?estado=&estado_pago=&proveedor_id=&venta_id=&busqueda=
const getOrdenes = handler(async (req, res) => {
  const { estado, estado_pago, proveedor_id, venta_id, busqueda } = req.query;
  const where = {};
  if (venta_id) where.venta_id = venta_id;
  if (estado) where.estado = estado;
  if (estado_pago) where.estado_pago = estado_pago;
  if (proveedor_id) where.proveedor_id = proveedor_id;
  if (busqueda) {
    where[Op.or] = ["numero", "proveedor_nombre", "documento"].map((c) => ({ [c]: { [Op.iLike]: `%${busqueda}%` } }));
  }
  const data = await OrdenCompra.findAll({ where, order: [["id", "DESC"]] });
  res.json({ ok: true, data });
});

// GET /api/ordenes-compra/:id  (incluye pagos)
const getOrden = handler(async (req, res) => {
  const oc = await OrdenCompra.findByPk(req.params.id);
  if (!oc) throw new ErrorNegocio("Orden no encontrada", 404);
  const pagos = await Pago.findAll({ where: { orden_compra_id: oc.id }, order: [["fecha", "ASC"], ["id", "ASC"]] });
  res.json({ ok: true, data: { ...oc.toJSON(), pagos } });
});

// POST /api/ordenes-compra   -> queda en "borrador"
const crearOrden = handler(async (req, res) => {
  const { proveedor_id, items, fecha_vencimiento, documento, notas } = req.body;
  const oc = await sequelize.transaction(async (t) => {
    const prov = await datosProveedor(proveedor_id, t);
    const itemsOk = await prepararItems(items, t);
    const nueva = await OrdenCompra.create({
      ...prov, items: itemsOk, ...calcularTotales(itemsOk),
      fecha_vencimiento: fecha_vencimiento || null, documento, notas,
      creado_por: req.usuario.nombre,
    }, { transaction: t });
    await nueva.update({ numero: numeroOC(nueva.id) }, { transaction: t });
    return nueva;
  });
  res.status(201).json({ ok: true, data: oc });
});

// PUT /api/ordenes-compra/:id   -> solo en borrador
const actualizarOrden = handler(async (req, res) => {
  const oc = await sequelize.transaction(async (t) => {
    const orden = await OrdenCompra.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden) throw new ErrorNegocio("Orden no encontrada", 404);
    if (orden.estado !== "borrador") throw new ErrorNegocio("Solo se pueden editar órdenes en borrador");
    const cambios = {};
    if (req.body.proveedor_id) Object.assign(cambios, await datosProveedor(req.body.proveedor_id, t));
    if (req.body.items) {
      const itemsOk = await prepararItems(req.body.items, t);
      Object.assign(cambios, { items: itemsOk, ...calcularTotales(itemsOk) });
    }
    for (const c of ["fecha_vencimiento", "documento", "notas"]) if (c in req.body) cambios[c] = req.body[c] || null;
    await orden.update(cambios, { transaction: t });
    return orden;
  });
  res.json({ ok: true, data: oc });
});

// POST /api/ordenes-compra/:id/recibir   { registrar_precios = true, documento }
// Marca la compra como recibida. Con registrar_precios, lo pagado real queda en el historial
// de precios del proveedor (documento = factura) y se recalcula el precio vigente.
const recibirOrden = handler(async (req, res) => {
  const { documento } = req.body || {};
  const registrar = (req.body?.registrar_precios ?? req.body?.actualizar_costos) !== false;
  const oc = await sequelize.transaction(async (t) => {
    const orden = await OrdenCompra.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden) throw new ErrorNegocio("Orden no encontrada", 404);
    if (orden.estado !== "borrador") throw new ErrorNegocio(`La orden ya está ${orden.estado}`);
    await orden.update({
      estado: "recibida", fecha_recepcion: new Date(),
      ...(documento ? { documento } : {}),
    }, { transaction: t });
    if (registrar) {
      const origen = await origenDe(orden.proveedor_nombre, t);
      const doc = orden.documento ? `FACT. ${orden.documento}` : orden.numero;
      for (const item of orden.items) {
        const p = await Producto.findByPk(item.producto_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!p || !(Number(item.precio) > 0)) continue;
        await PrecioProveedor.create({
          producto_id: p.id, proveedor: normProv(orden.proveedor_nombre), precio: Math.round(Number(item.precio)),
          fecha: new Date(), documento: doc, cantidad: item.cantidad, unidad: item.unidad,
          origen, creado_por: req.usuario.nombre,
        }, { transaction: t });
        await recalcular(p, { t, usuario: req.usuario.nombre, motivo: `Compra ${orden.numero}` });
      }
    }
    return orden;
  });
  res.json({ ok: true, data: oc });
});

// POST /api/ordenes-compra/:id/anular
const anularOrden = handler(async (req, res) => {
  const oc = await sequelize.transaction(async (t) => {
    const orden = await OrdenCompra.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden) throw new ErrorNegocio("Orden no encontrada", 404);
    if (orden.estado === "anulada") throw new ErrorNegocio("La orden ya está anulada");
    if (Number(orden.monto_pagado) > 0) throw new ErrorNegocio("La orden tiene pagos registrados. Elimínalos antes de anular.");
    await orden.update({ estado: "anulada" }, { transaction: t });
    return orden;
  });
  res.json({ ok: true, data: oc });
});

// DELETE /api/ordenes-compra/:id   -> solo borradores
const eliminarOrden = handler(async (req, res) => {
  const oc = await OrdenCompra.findByPk(req.params.id);
  if (!oc) throw new ErrorNegocio("Orden no encontrada", 404);
  if (oc.estado !== "borrador") throw new ErrorNegocio("Solo se pueden eliminar borradores. Usa 'Anular'.");
  await oc.destroy();
  res.json({ ok: true, message: "Orden eliminada" });
});

// POST /api/ordenes-compra/:id/pagos   { monto, fecha, medio, nota }
const registrarPago = handler(async (req, res) => {
  const resultado = await sequelize.transaction(async (t) => {
    const orden = await OrdenCompra.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden) throw new ErrorNegocio("Orden no encontrada", 404);
    if (orden.estado === "anulada") throw new ErrorNegocio("No se puede pagar una orden anulada");
    const monto = Number(req.body.monto);
    const saldo = Number(orden.total) - Number(orden.monto_pagado);
    if (!(monto > 0)) throw new ErrorNegocio("Monto inválido");
    if (monto > saldo + 0.5) throw new ErrorNegocio(`El monto supera el saldo pendiente (${Math.round(saldo)})`);
    const pago = await Pago.create({
      tipo: "pago", orden_compra_id: orden.id, monto,
      fecha: req.body.fecha || new Date(), medio: req.body.medio || "transferencia", nota: req.body.nota,
      creado_por: req.usuario.nombre,
    }, { transaction: t });
    const pagado = Number(orden.monto_pagado) + monto;
    await orden.update({ monto_pagado: pagado, estado_pago: estadoPago(pagado, orden.total) }, { transaction: t });
    return { orden, pago };
  });
  res.status(201).json({ ok: true, data: resultado });
});

module.exports = {
  getOrdenes, getOrden, crearOrden, actualizarOrden, recibirOrden, anularOrden, eliminarOrden, registrarPago,
};
