const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Venta = require("../models/Venta");
const Cliente = require("../models/Cliente");
const Cotizacion = require("../models/Cotizacion");
const Pago = require("../models/Pago");
const {
  handler, ErrorNegocio, calcularTotales, normalizarItems, bloquearProductos,
  moverStock, estadoPago, sumarDias,
} = require("../services/erp");

const numeroVenta = (id) => `V-${String(id).padStart(4, "0")}`;

// Crea la venta y descuenta stock dentro de la transacción t.
// datos: { cliente_id, cliente_nombre, items, documento, dias_credito, fecha_vencimiento,
//          notas, cotizacion_id, pagada_al_contado, medio_pago }
const crearVentaEnTransaccion = async (datos, t) => {
  // Precio por defecto = precio_venta actual del producto
  const base = (datos.items || []).map((i) => ({ ...i, precio: i.precio ?? 0 }));
  const items = normalizarItems(base);
  const productos = await bloquearProductos(items.map((i) => i.producto_id), t);

  const itemsFinal = items.map((i, idx) => {
    const p = productos.get(i.producto_id);
    const precioDado = datos.items[idx].precio;
    return {
      producto_id: p.id,
      nombre: p.nombre,
      unidad: p.unidad,
      cantidad: i.cantidad,
      precio: precioDado === undefined || precioDado === null || precioDado === "" ? Number(p.precio_venta) : i.precio,
      costo: Number(p.precio_compra) || 0,
    };
  });
  const totales = calcularTotales(itemsFinal);
  const costo_total = itemsFinal.reduce((s, i) => s + i.costo * i.cantidad, 0);

  let cliente_nombre = datos.cliente_nombre || null;
  if (datos.cliente_id) {
    const c = await Cliente.findByPk(datos.cliente_id, { transaction: t });
    if (!c) throw new ErrorNegocio("Cliente no encontrado", 404);
    cliente_nombre = c.nombre;
  }

  const venc = datos.fecha_vencimiento
    || (Number(datos.dias_credito) > 0 ? sumarDias(datos.dias_credito) : null);

  const venta = await Venta.create({
    cliente_id: datos.cliente_id || null,
    cliente_nombre,
    cotizacion_id: datos.cotizacion_id || null,
    fecha_vencimiento: venc,
    documento: datos.documento || null,
    notas: datos.notas || null,
    items: itemsFinal,
    ...totales,
    costo_total,
  }, { transaction: t });
  await venta.update({ numero: numeroVenta(venta.id) }, { transaction: t });

  for (const item of itemsFinal) {
    await moverStock(productos.get(item.producto_id), -item.cantidad, {
      tipo: "salida", referencia_tipo: "venta", referencia_id: venta.id,
      referencia_numero: venta.numero, costo_unitario: item.costo,
    }, t);
  }

  if (datos.pagada_al_contado) {
    await Pago.create({
      tipo: "cobro", venta_id: venta.id, monto: totales.total,
      medio: datos.medio_pago || "efectivo", nota: "Pago al contado",
    }, { transaction: t });
    await venta.update({ monto_pagado: totales.total, estado_pago: "pagada" }, { transaction: t });
  }
  return venta;
};

// GET /api/ventas?estado=&estado_pago=&cliente_id=&busqueda=&desde=&hasta=
const getVentas = handler(async (req, res) => {
  const { estado, estado_pago, cliente_id, busqueda, desde, hasta } = req.query;
  const where = {};
  if (estado) where.estado = estado;
  if (estado_pago) where.estado_pago = estado_pago;
  if (cliente_id) where.cliente_id = cliente_id;
  if (desde || hasta) where.fecha = { ...(desde && { [Op.gte]: desde }), ...(hasta && { [Op.lte]: hasta }) };
  if (busqueda) {
    where[Op.or] = ["numero", "cliente_nombre", "documento"].map((c) => ({ [c]: { [Op.iLike]: `%${busqueda}%` } }));
  }
  const data = await Venta.findAll({ where, order: [["id", "DESC"]] });
  res.json({ ok: true, data });
});

// GET /api/ventas/:id  (incluye cobros)
const getVenta = handler(async (req, res) => {
  const venta = await Venta.findByPk(req.params.id);
  if (!venta) throw new ErrorNegocio("Venta no encontrada", 404);
  const pagos = await Pago.findAll({ where: { venta_id: venta.id }, order: [["fecha", "ASC"], ["id", "ASC"]] });
  res.json({ ok: true, data: { ...venta.toJSON(), pagos } });
});

// POST /api/ventas
const crearVenta = handler(async (req, res) => {
  const venta = await sequelize.transaction((t) => crearVentaEnTransaccion(req.body, t));
  res.status(201).json({ ok: true, data: venta });
});

// POST /api/ventas/desde-cotizacion/:id   { dias_credito, documento, pagada_al_contado, medio_pago }
// Convierte una cotización guardada en venta: descuenta stock y la marca como "vendida".
const ventaDesdeCotizacion = handler(async (req, res) => {
  const venta = await sequelize.transaction(async (t) => {
    const cot = await Cotizacion.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
    if (cot.estado === "vendida") throw new ErrorNegocio("Esta cotización ya fue convertida en venta");

    // Las cotizaciones guardan el nombre del cliente; intentamos enlazarlo con la ficha
    let cliente_id = req.body?.cliente_id || null;
    if (!cliente_id && cot.cliente) {
      const c = await Cliente.findOne({ where: { nombre: { [Op.iLike]: cot.cliente } }, transaction: t });
      if (c) cliente_id = c.id;
    }
    const nueva = await crearVentaEnTransaccion({
      ...(req.body || {}),
      cliente_id,
      cliente_nombre: cot.cliente,
      cotizacion_id: cot.id,
      notas: req.body?.notas || cot.nombre_cotizacion,
      items: cot.items.map((i) => ({
        producto_id: i.producto_id ?? i.id, nombre: i.nombre, cantidad: i.cantidad, precio: i.precio,
      })),
    }, t);
    await cot.update({ estado: "vendida", venta_id: nueva.id }, { transaction: t });
    return nueva;
  });
  res.status(201).json({ ok: true, data: venta });
});

// POST /api/ventas/:id/anular   -> devuelve el stock
const anularVenta = handler(async (req, res) => {
  const venta = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta ya está anulada");
    if (Number(v.monto_pagado) > 0) throw new ErrorNegocio("La venta tiene cobros registrados. Elimínalos antes de anular.");
    const productos = await bloquearProductos(v.items.map((i) => i.producto_id), t);
    for (const item of v.items) {
      await moverStock(productos.get(item.producto_id), item.cantidad, {
        tipo: "entrada", referencia_tipo: "anulacion_venta", referencia_id: v.id,
        referencia_numero: v.numero, costo_unitario: item.costo,
      }, t);
    }
    await v.update({ estado: "anulada" }, { transaction: t });
    if (v.cotizacion_id) {
      await Cotizacion.update({ estado: "pendiente", venta_id: null }, { where: { id: v.cotizacion_id }, transaction: t });
    }
    return v;
  });
  res.json({ ok: true, data: venta });
});

// POST /api/ventas/:id/cobros   { monto, fecha, medio, nota }
const registrarCobro = handler(async (req, res) => {
  const resultado = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("No se puede cobrar una venta anulada");
    const monto = Number(req.body.monto);
    const saldo = Number(v.total) - Number(v.monto_pagado);
    if (!(monto > 0)) throw new ErrorNegocio("Monto inválido");
    if (monto > saldo + 0.5) throw new ErrorNegocio(`El monto supera el saldo pendiente (${Math.round(saldo)})`);
    const pago = await Pago.create({
      tipo: "cobro", venta_id: v.id, monto,
      fecha: req.body.fecha || new Date(), medio: req.body.medio || "transferencia", nota: req.body.nota,
    }, { transaction: t });
    const pagado = Number(v.monto_pagado) + monto;
    await v.update({ monto_pagado: pagado, estado_pago: estadoPago(pagado, v.total) }, { transaction: t });
    return { venta: v, pago };
  });
  res.status(201).json({ ok: true, data: resultado });
});

module.exports = { getVentas, getVenta, crearVenta, ventaDesdeCotizacion, anularVenta, registrarCobro };
