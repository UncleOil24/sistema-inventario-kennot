const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Venta = require("../models/Venta");
const Cliente = require("../models/Cliente");
const Cotizacion = require("../models/Cotizacion");
const Producto = require("../models/Producto");
const Proveedor = require("../models/Proveedor");
const OrdenCompra = require("../models/OrdenCompra");
const Pago = require("../models/Pago");
const Gasto = require("../models/Gasto");
const {
  handler, ErrorNegocio, calcularTotales, normalizarItems, estadoPago, sumarDias, redondear,
} = require("../services/erp");
const { getParametros, precioVenta } = require("../services/parametros");
const { normProv } = require("../services/precios");
const { esAdmin } = require("../middlewares/auth");

const SIN_PROVEEDOR = "SIN PROVEEDOR";

// El rol "usuario" no ve costos, proveedores ni márgenes
const sinCostos = (v) => {
  const j = typeof v.toJSON === "function" ? v.toJSON() : { ...v };
  delete j.costo_total;
  j.items = (j.items || []).map(({ costo, proveedor, ...resto }) => resto);
  return j;
};
const verVenta = (req, v) => (esAdmin(req) ? (typeof v.toJSON === "function" ? v.toJSON() : v) : sinCostos(v));

const numeroVenta = (id) => `V-${String(id).padStart(4, "0")}`;

// Crea la venta dentro de la transacción t. Sin control de stock: primero se vende y
// después se compra al proveedor (cuadro de compra).
// datos.items: [{ producto_id, cantidad, precio?, costo?, proveedor?, nombre? }]
// Si vienen costo/proveedor (desde la cotización) se respetan; si no, se toman del catálogo.
const crearVentaEnTransaccion = async (datos, t) => {
  const items = normalizarItems((datos.items || []).map((i) => ({ ...i, precio: i.precio ?? 0 })));
  const productos = await Producto.findAll({ where: { id: items.map((i) => i.producto_id) }, transaction: t });
  const mapa = new Map(productos.map((p) => [p.id, p]));
  const params = await getParametros(t);

  let cliente_nombre = datos.cliente_nombre || null;
  let tipo = datos.tipo_precio || "convenio";
  if (datos.cliente_id) {
    const c = await Cliente.findByPk(datos.cliente_id, { transaction: t });
    if (!c) throw new ErrorNegocio("Cliente no encontrado", 404);
    cliente_nombre = c.nombre;
    tipo = datos.tipo_precio || c.tipo || "convenio";
  }

  const itemsFinal = items.map((i, idx) => {
    const p = mapa.get(i.producto_id);
    const original = datos.items[idx];
    if (!p && original.costo === undefined) throw new ErrorNegocio(`Producto ${i.producto_id} no existe`, 404);
    const costo = original.costo !== undefined && original.costo !== null ? Number(original.costo) : Number(p.precio_compra) || 0;
    const precioDado = original.precio;
    return {
      producto_id: i.producto_id,
      codigo: p?.codigo ?? original.codigo ?? null,
      nombre: original.nombre || p?.nombre,
      unidad: original.unidad || p?.unidad,
      cantidad: i.cantidad,
      precio: precioDado === undefined || precioDado === null || precioDado === "" ? precioVenta(costo, tipo, params) : Number(precioDado),
      costo,
      proveedor: original.proveedor !== undefined ? original.proveedor : (p?.proveedor || null),
    };
  });
  const totales = calcularTotales(itemsFinal);
  const costo_total = itemsFinal.reduce((s, i) => s + i.costo * i.cantidad, 0);

  const venc = datos.fecha_vencimiento
    || (Number(datos.dias_credito) > 0 ? sumarDias(datos.dias_credito) : null);

  const venta = await Venta.create({
    cliente_id: datos.cliente_id || null,
    cliente_nombre,
    cotizacion_id: datos.cotizacion_id || null,
    orden_compra_cliente: datos.orden_compra_cliente || null,
    fecha_vencimiento: venc,
    documento: datos.documento || null,
    notas: datos.notas || null,
    creado_por: datos.creado_por || null,
    items: itemsFinal,
    ...totales,
    costo_total,
  }, { transaction: t });
  await venta.update({ numero: numeroVenta(venta.id) }, { transaction: t });

  if (datos.pagada_al_contado) {
    await Pago.create({
      tipo: "cobro", venta_id: venta.id, monto: totales.total,
      medio: datos.medio_pago || "efectivo", nota: "Pago al contado", creado_por: datos.creado_por,
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
    where[Op.or] = ["numero", "cliente_nombre", "documento", "orden_compra_cliente"].map((c) => ({ [c]: { [Op.iLike]: `%${busqueda}%` } }));
  }
  const data = await Venta.findAll({ where, order: [["id", "DESC"]] });
  // Cuántas órdenes de compra tiene cada venta (para saber cuáles faltan por comprar)
  const ocs = data.length ? await OrdenCompra.findAll({
    where: { venta_id: data.map((v) => v.id), estado: { [Op.ne]: "anulada" } }, attributes: ["venta_id"], raw: true,
  }) : [];
  const conOC = new Set(ocs.map((o) => o.venta_id));
  res.json({ ok: true, data: data.map((v) => ({ ...verVenta(req, v), tiene_compras: conOC.has(v.id) })) });
});

// Gastos y utilidad de una venta
const resumenVenta = async (venta) => {
  const [gastos, ordenes] = await Promise.all([
    Gasto.findAll({ where: { venta_id: venta.id }, order: [["fecha", "ASC"], ["id", "ASC"]] }),
    OrdenCompra.findAll({ where: { venta_id: venta.id, estado: { [Op.ne]: "anulada" } }, order: [["id", "ASC"]] }),
  ]);
  const total_gastos = gastos.reduce((s, g) => s + Number(g.monto), 0);
  const margen = Number(venta.subtotal) - Number(venta.costo_total);
  const compras_real = ordenes.reduce((s, o) => s + Number(o.subtotal), 0);
  return {
    gastos, ordenes: ordenes.map((o) => ({ id: o.id, numero: o.numero, proveedor_nombre: o.proveedor_nombre, estado: o.estado, subtotal: o.subtotal, estado_pago: o.estado_pago })),
    resumen: {
      margen: redondear(margen),
      margen_pct: Number(venta.subtotal) ? Math.round((margen / Number(venta.subtotal)) * 100) : 0,
      gastos: redondear(total_gastos),
      utilidad: redondear(margen - total_gastos),
      compras_real: redondear(compras_real),
      // Utilidad con lo que realmente se compró (si ya hay órdenes de compra)
      utilidad_real: ordenes.length ? redondear(Number(venta.subtotal) - compras_real - total_gastos) : null,
    },
  };
};

// GET /api/ventas/:id  (incluye cobros; admin además gastos, órdenes y utilidad)
const getVenta = handler(async (req, res) => {
  const venta = await Venta.findByPk(req.params.id);
  if (!venta) throw new ErrorNegocio("Venta no encontrada", 404);
  const pagos = await Pago.findAll({ where: { venta_id: venta.id }, order: [["fecha", "ASC"], ["id", "ASC"]] });
  const extra = esAdmin(req) ? await resumenVenta(venta) : {};
  res.json({ ok: true, data: { ...verVenta(req, venta), pagos, ...extra } });
});

// POST /api/ventas   (venta directa, sin cotización)
const crearVenta = handler(async (req, res) => {
  const venta = await sequelize.transaction((t) =>
    crearVentaEnTransaccion({ ...req.body, creado_por: req.usuario.nombre }, t));
  res.status(201).json({ ok: true, data: verVenta(req, venta) });
});

// POST /api/ventas/desde-cotizacion/:id   { orden_compra_cliente, dias_credito, documento, pagada_al_contado, medio_pago }
// El cliente aceptó: la cotización pasa a "aceptada" y nace la venta con los mismos precios y costos.
const ventaDesdeCotizacion = handler(async (req, res) => {
  const venta = await sequelize.transaction(async (t) => {
    const cot = await Cotizacion.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
    if (cot.estado === "aceptada" || cot.venta_id) throw new ErrorNegocio("Esta cotización ya fue convertida en venta");
    if (cot.estado === "borrador") throw new ErrorNegocio("La cotización está en borrador: emítela antes de convertirla en venta");

    let cliente_id = cot.cliente_id || req.body?.cliente_id || null;
    if (!cliente_id && cot.cliente) {
      const c = await Cliente.findOne({ where: { nombre: { [Op.iLike]: cot.cliente } }, transaction: t });
      if (c) cliente_id = c.id;
    }
    const nueva = await crearVentaEnTransaccion({
      ...(req.body || {}),
      cliente_id,
      cliente_nombre: cot.cliente,
      tipo_precio: cot.tipo_precio,
      cotizacion_id: cot.id,
      creado_por: req.usuario.nombre,
      notas: req.body?.notas || cot.nombre_cotizacion,
      items: cot.items.map((i) => ({
        producto_id: i.producto_id ?? i.id, codigo: i.codigo, nombre: i.nombre, unidad: i.unidad,
        cantidad: i.cantidad, precio: i.precio,
        // Cotizaciones antiguas no guardaban costo: se toma del catálogo
        ...(i.costo !== undefined ? { costo: i.costo, proveedor: i.proveedor ?? null } : {}),
      })),
    }, t);
    await cot.update({ estado: "aceptada", venta_id: nueva.id, motivo_estado: null }, { transaction: t });
    return nueva;
  });
  res.status(201).json({ ok: true, data: verVenta(req, venta) });
});

// POST /api/ventas/:id/anular   -> la cotización vuelve a quedar abierta
const anularVenta = handler(async (req, res) => {
  const venta = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta ya está anulada");
    if (Number(v.monto_pagado) > 0) throw new ErrorNegocio("La venta tiene cobros registrados. Elimínalos antes de anular.");
    const ocs = await OrdenCompra.count({ where: { venta_id: v.id, estado: "recibida" }, transaction: t });
    if (ocs > 0) throw new ErrorNegocio("La venta tiene compras recibidas. Anúlalas primero en Compras.");
    await OrdenCompra.update({ estado: "anulada" }, { where: { venta_id: v.id, estado: "borrador" }, transaction: t });
    await v.update({ estado: "anulada" }, { transaction: t });
    if (v.cotizacion_id) {
      await Cotizacion.update({ estado: "cotizacion", venta_id: null }, { where: { id: v.cotizacion_id }, transaction: t });
    }
    return v;
  });
  res.json({ ok: true, data: verVenta(req, venta) });
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
      creado_por: req.usuario.nombre,
    }, { transaction: t });
    const pagado = Number(v.monto_pagado) + monto;
    await v.update({ monto_pagado: pagado, estado_pago: estadoPago(pagado, v.total) }, { transaction: t });
    return { venta: verVenta(req, v), pago };
  });
  res.status(201).json({ ok: true, data: resultado });
});

// PUT /api/ventas/:id/datos   { documento, orden_compra_cliente, fecha_vencimiento, notas }
const actualizarDatos = handler(async (req, res) => {
  const v = await Venta.findByPk(req.params.id);
  if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
  const cambios = {};
  for (const c of ["documento", "orden_compra_cliente", "fecha_vencimiento", "notas"]) if (c in req.body) cambios[c] = req.body[c] || null;
  await v.update(cambios);
  res.json({ ok: true, data: verVenta(req, v) });
});

// --- Cuadro de compra ------------------------------------------------------------

// GET /api/ventas/:id/cuadro-compra
// Agrupado por proveedor: qué comprar, cuánto, a qué precio y cuánto se gana por línea.
const getCuadroCompra = handler(async (req, res) => {
  const venta = await Venta.findByPk(req.params.id);
  if (!venta) throw new ErrorNegocio("Venta no encontrada", 404);
  const ids = venta.items.map((i) => i.producto_id);
  const [productos, proveedores, extra] = await Promise.all([
    Producto.findAll({ where: { id: ids } }),
    Proveedor.findAll(),
    resumenVenta(venta),
  ]);
  const prodMap = new Map(productos.map((p) => [p.id, p]));
  const provMap = new Map(proveedores.map((p) => [normProv(p.nombre), p]));
  const ocPorProv = new Map(extra.ordenes.map((o) => [normProv(o.proveedor_nombre), o]));

  const grupos = new Map();
  venta.items.forEach((i, indice) => {
    const prov = i.proveedor ? normProv(i.proveedor) : SIN_PROVEEDOR;
    const p = prodMap.get(i.producto_id);
    const totalCompra = Number(i.costo) * Number(i.cantidad);
    const totalVenta = Number(i.precio) * Number(i.cantidad);
    const margen = totalVenta - totalCompra;
    const linea = {
      indice, producto_id: i.producto_id, codigo: i.codigo, nombre: i.nombre, unidad: i.unidad, cantidad: Number(i.cantidad),
      compra_unit: Number(i.costo), total_compra: redondear(totalCompra),
      venta_unit: Number(i.precio), total_venta: redondear(totalVenta),
      margen: redondear(margen), margen_pct: totalVenta ? Math.round((margen / totalVenta) * 100) : 0,
      // Precio vigente hoy en el catálogo (para detectar si cambió desde que se cotizó)
      vigente: p ? { proveedor: p.proveedor, precio: Number(p.precio_compra) || 0 } : null,
      alternativa: p && p.opcion2_proveedor ? { proveedor: p.opcion2_proveedor, precio: Number(p.opcion2_precio) } : null,
      alternativa3: p && p.opcion3_proveedor ? { proveedor: p.opcion3_proveedor, precio: Number(p.opcion3_precio) } : null,
    };
    if (!grupos.has(prov)) {
      const ficha = provMap.get(prov);
      grupos.set(prov, {
        proveedor: prov,
        contacto: ficha ? [ficha.contacto, ficha.telefono, ficha.email].filter(Boolean).join(" · ") : null,
        proveedor_id: ficha?.id || null,
        orden: ocPorProv.get(prov) || null,
        lineas: [], total_compra: 0, total_venta: 0, margen: 0,
      });
    }
    const g = grupos.get(prov);
    g.lineas.push(linea);
    g.total_compra += linea.total_compra;
    g.total_venta += linea.total_venta;
    g.margen += linea.margen;
  });

  const lista = [...grupos.values()].sort((a, b) => (a.proveedor === SIN_PROVEEDOR) - (b.proveedor === SIN_PROVEEDOR) || b.total_compra - a.total_compra);
  res.json({
    ok: true,
    data: {
      venta: { id: venta.id, numero: venta.numero, cliente_nombre: venta.cliente_nombre, fecha: venta.fecha, estado: venta.estado, orden_compra_cliente: venta.orden_compra_cliente, subtotal: venta.subtotal, costo_total: venta.costo_total },
      grupos: lista,
      totales: {
        compra: redondear(Number(venta.costo_total)),
        venta: redondear(Number(venta.subtotal)),
        ...extra.resumen,
      },
      gastos: extra.gastos,
      ordenes: extra.ordenes,
    },
  });
});

// POST /api/ventas/:id/cambiar-proveedor   { indice, proveedor, costo }
// Para comprar una línea a otro proveedor (p.ej. la opción 2). Cambia el costo y el margen de la venta.
const cambiarProveedorLinea = handler(async (req, res) => {
  const { indice, proveedor, costo } = req.body || {};
  const venta = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta está anulada");
    const items = [...v.items];
    const i = items[Number(indice)];
    if (!i) throw new ErrorNegocio("Línea no encontrada", 404);
    if (!proveedor) throw new ErrorNegocio("Indica el proveedor");
    if (!(Number(costo) >= 0)) throw new ErrorNegocio("Costo inválido");
    items[Number(indice)] = { ...i, proveedor: normProv(proveedor), costo: Number(costo) };
    await v.update({ items, costo_total: items.reduce((s, x) => s + Number(x.costo) * Number(x.cantidad), 0) }, { transaction: t });
    return v;
  });
  res.json({ ok: true, data: verVenta(req, venta) });
});

// POST /api/ventas/:id/generar-ordenes   { proveedores?: ["MADESUR", ...] }
// Crea una orden de compra (borrador) por proveedor con lo que falta comprar.
const generarOrdenes = handler(async (req, res) => {
  const resultado = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta está anulada");
    const existentes = await OrdenCompra.findAll({ where: { venta_id: v.id, estado: { [Op.ne]: "anulada" } }, transaction: t });
    const yaTiene = new Set(existentes.map((o) => normProv(o.proveedor_nombre)));
    const filtro = Array.isArray(req.body?.proveedores) ? new Set(req.body.proveedores.map(normProv)) : null;

    const grupos = new Map();
    for (const i of v.items) {
      const prov = i.proveedor ? normProv(i.proveedor) : SIN_PROVEEDOR;
      if (!grupos.has(prov)) grupos.set(prov, []);
      grupos.get(prov).push(i);
    }
    const creadas = [];
    const omitidos = [];
    for (const [prov, items] of grupos) {
      if (filtro && !filtro.has(prov)) continue;
      if (prov === SIN_PROVEEDOR) { omitidos.push(`${items.length} producto(s) sin proveedor`); continue; }
      if (yaTiene.has(prov)) { omitidos.push(`${prov} ya tiene orden`); continue; }
      let ficha = await Proveedor.findOne({ where: { nombre: { [Op.iLike]: prov } }, transaction: t });
      if (!ficha) ficha = await Proveedor.create({ nombre: prov }, { transaction: t });
      const lineas = items.map((i) => ({
        producto_id: i.producto_id, codigo: i.codigo, nombre: i.nombre, unidad: i.unidad,
        cantidad: Number(i.cantidad), precio: Number(i.costo),
      }));
      const oc = await OrdenCompra.create({
        proveedor_id: ficha.id, proveedor_nombre: ficha.nombre, venta_id: v.id,
        items: lineas, ...calcularTotales(lineas),
        notas: `Para venta ${v.numero}${v.cliente_nombre ? ` · ${v.cliente_nombre}` : ""}`,
        creado_por: req.usuario.nombre,
      }, { transaction: t });
      await oc.update({ numero: `OC-${String(oc.id).padStart(4, "0")}` }, { transaction: t });
      creadas.push(oc);
    }
    return { creadas, omitidos };
  });
  res.status(201).json({ ok: true, data: resultado });
});

module.exports = {
  getVentas, getVenta, crearVenta, ventaDesdeCotizacion, anularVenta, registrarCobro, actualizarDatos,
  getCuadroCompra, cambiarProveedorLinea, generarOrdenes,
};
