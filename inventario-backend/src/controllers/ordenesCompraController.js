const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const OrdenCompra = require("../models/OrdenCompra");
const Proveedor = require("../models/Proveedor");
const Producto = require("../models/Producto");
const Pago = require("../models/Pago");
const {
  handler, ErrorNegocio, calcularTotales, normalizarItems, bloquearProductos,
  moverStock, estadoPago,
} = require("../services/erp");

const numeroOC = (id) => `OC-${String(id).padStart(4, "0")}`;

// Completa nombre/unidad desde la BD y valida que los productos existan
const prepararItems = async (itemsBody, t) => {
  const items = normalizarItems(itemsBody);
  const productos = await Producto.findAll({ where: { id: items.map((i) => i.producto_id) }, transaction: t });
  const mapa = new Map(productos.map((p) => [p.id, p]));
  return items.map((i) => {
    const p = mapa.get(i.producto_id);
    if (!p) throw new ErrorNegocio(`Producto ${i.producto_id} no existe`, 404);
    return { ...i, nombre: p.nombre, unidad: p.unidad };
  });
};

const datosProveedor = async (proveedor_id, t) => {
  if (!proveedor_id) throw new ErrorNegocio("Debe seleccionar un proveedor");
  const prov = await Proveedor.findByPk(proveedor_id, { transaction: t });
  if (!prov) throw new ErrorNegocio("Proveedor no encontrado", 404);
  return { proveedor_id: prov.id, proveedor_nombre: prov.nombre };
};

// GET /api/ordenes-compra?estado=&estado_pago=&proveedor_id=&busqueda=
const getOrdenes = handler(async (req, res) => {
  const { estado, estado_pago, proveedor_id, busqueda } = req.query;
  const where = {};
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

// POST /api/ordenes-compra   -> queda en "borrador" (no mueve stock todavía)
const crearOrden = handler(async (req, res) => {
  const { proveedor_id, items, fecha_vencimiento, documento, notas } = req.body;
  const oc = await sequelize.transaction(async (t) => {
    const prov = await datosProveedor(proveedor_id, t);
    const itemsOk = await prepararItems(items, t);
    const nueva = await OrdenCompra.create({
      ...prov, items: itemsOk, ...calcularTotales(itemsOk),
      fecha_vencimiento: fecha_vencimiento || null, documento, notas,
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

// POST /api/ordenes-compra/:id/recibir   { actualizar_costos = true, documento }
// Suma el stock de cada producto y (opcional) actualiza su precio de compra.
const recibirOrden = handler(async (req, res) => {
  const { actualizar_costos = true, documento } = req.body || {};
  const oc = await sequelize.transaction(async (t) => {
    const orden = await OrdenCompra.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden) throw new ErrorNegocio("Orden no encontrada", 404);
    if (orden.estado !== "borrador") throw new ErrorNegocio(`La orden ya está ${orden.estado}`);
    const productos = await bloquearProductos(orden.items.map((i) => i.producto_id), t);
    for (const item of orden.items) {
      const p = productos.get(item.producto_id);
      await moverStock(p, item.cantidad, {
        tipo: "entrada", referencia_tipo: "compra", referencia_id: orden.id,
        referencia_numero: orden.numero, costo_unitario: item.precio,
      }, t);
      const cambios = {};
      if (actualizar_costos) cambios.precio_compra = item.precio;
      if (!p.proveedor) cambios.proveedor = orden.proveedor_nombre;
      if (Object.keys(cambios).length) await p.update(cambios, { transaction: t });
    }
    await orden.update({
      estado: "recibida", fecha_recepcion: new Date(),
      ...(documento ? { documento } : {}),
    }, { transaction: t });
    return orden;
  });
  res.json({ ok: true, data: oc });
});

// POST /api/ordenes-compra/:id/anular
// Borrador: solo cambia estado. Recibida: devuelve (resta) el stock, si alcanza.
const anularOrden = handler(async (req, res) => {
  const oc = await sequelize.transaction(async (t) => {
    const orden = await OrdenCompra.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden) throw new ErrorNegocio("Orden no encontrada", 404);
    if (orden.estado === "anulada") throw new ErrorNegocio("La orden ya está anulada");
    if (Number(orden.monto_pagado) > 0) throw new ErrorNegocio("La orden tiene pagos registrados. Elimínalos antes de anular.");
    if (orden.estado === "recibida") {
      const productos = await bloquearProductos(orden.items.map((i) => i.producto_id), t);
      for (const item of orden.items) {
        await moverStock(productos.get(item.producto_id), -item.cantidad, {
          tipo: "salida", referencia_tipo: "anulacion_compra", referencia_id: orden.id,
          referencia_numero: orden.numero, costo_unitario: item.precio,
        }, t);
      }
    }
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
