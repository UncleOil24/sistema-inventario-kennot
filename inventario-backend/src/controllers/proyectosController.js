// Proyectos: todo lo de una licitación ganada en un solo lugar.
// El organismo suele mandar VARIAS órdenes de compra por una licitación: cada una es una venta (con su factura y
// su cobro), y el proyecto las une. Las compras a proveedores se pueden hacer consolidadas para todo el proyecto
// (una OC por proveedor sumando todas las ventas) o unir órdenes en borrador del mismo proveedor.
const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Proyecto = require("../models/Proyecto");
const Venta = require("../models/Venta");
const OrdenCompra = require("../models/OrdenCompra");
const Proveedor = require("../models/Proveedor");
const Cliente = require("../models/Cliente");
const Gasto = require("../models/Gasto");
const Cotizacion = require("../models/Cotizacion");
const { handler, ErrorNegocio, calcularTotales, redondear } = require("../services/erp");
const { normProv } = require("../services/precios");
const { esAdmin } = require("../middlewares/auth");
const { verVenta, SIN_PROVEEDOR } = require("./ventasController");

const numeroProyecto = (id) => `P-${String(id).padStart(4, "0")}`;
const n = (v) => Number(v) || 0;

// Ventas (no anuladas) y órdenes de compra (no anuladas) de un proyecto
async function contenido(proyecto, t) {
  const ventas = await Venta.findAll({ where: { proyecto_id: proyecto.id }, order: [["fecha", "ASC"], ["id", "ASC"]], transaction: t });
  const idsVentas = ventas.map((v) => v.id);
  const ordenes = await OrdenCompra.findAll({
    where: { estado: { [Op.ne]: "anulada" }, [Op.or]: [{ proyecto_id: proyecto.id }, ...(idsVentas.length ? [{ venta_id: idsVentas }] : [])] },
    order: [["id", "ASC"]], transaction: t,
  });
  return { ventas, ordenes };
}

function resumen(ventas, ordenes, gastos) {
  const activas = ventas.filter((v) => v.estado !== "anulada");
  const neto = activas.reduce((s, v) => s + n(v.subtotal), 0);
  const costo = activas.reduce((s, v) => s + n(v.costo_total), 0);
  const totalGastos = gastos.reduce((s, g) => s + n(g.monto), 0);
  const compras = ordenes.reduce((s, o) => s + n(o.subtotal), 0);
  return {
    ventas: activas.length,
    neto: redondear(neto),
    total: redondear(activas.reduce((s, v) => s + n(v.total), 0)),
    cobrado: redondear(activas.reduce((s, v) => s + n(v.monto_pagado), 0)),
    por_cobrar: redondear(activas.reduce((s, v) => s + n(v.total) - n(v.monto_pagado), 0)),
    costo_cotizado: redondear(costo),
    margen: redondear(neto - costo),
    margen_pct: neto ? Math.round(((neto - costo) / neto) * 100) : 0,
    gastos: redondear(totalGastos),
    utilidad: redondear(neto - costo - totalGastos),
    compras: redondear(compras),
    compras_recibidas: redondear(ordenes.filter((o) => o.estado === "recibida").reduce((s, o) => s + n(o.subtotal), 0)),
    por_pagar: redondear(ordenes.filter((o) => o.estado === "recibida").reduce((s, o) => s + n(o.total) - n(o.monto_pagado), 0)),
    utilidad_real: ordenes.length ? redondear(neto - compras - totalGastos) : null,
  };
}

const verOrden = (o) => ({ id: o.id, numero: o.numero, proveedor_nombre: o.proveedor_nombre, estado: o.estado, estado_pago: o.estado_pago,
  subtotal: o.subtotal, total: o.total, monto_pagado: o.monto_pagado, venta_id: o.venta_id, proyecto_id: o.proyecto_id, fecha: o.fecha, documento: o.documento, items: o.items.length });

// GET /api/proyectos?estado=abierto
const getProyectos = handler(async (req, res) => {
  const where = {};
  if (req.query.estado) where.estado = req.query.estado;
  const proyectos = await Proyecto.findAll({ where, order: [["id", "DESC"]] });
  const ids = proyectos.map((p) => p.id);
  const ventas = ids.length ? await Venta.findAll({ where: { proyecto_id: ids } }) : [];
  const idsVentas = ventas.map((v) => v.id);
  const ordenes = ids.length ? await OrdenCompra.findAll({
    where: { estado: { [Op.ne]: "anulada" }, [Op.or]: [{ proyecto_id: ids }, ...(idsVentas.length ? [{ venta_id: idsVentas }] : [])] },
  }) : [];
  const gastos = idsVentas.length ? await Gasto.findAll({ where: { venta_id: idsVentas } }) : [];
  const proyDeVenta = new Map(ventas.map((v) => [v.id, v.proyecto_id]));
  const data = proyectos.map((p) => {
    const vs = ventas.filter((v) => v.proyecto_id === p.id);
    const os = ordenes.filter((o) => o.proyecto_id === p.id || proyDeVenta.get(o.venta_id) === p.id);
    const gs = gastos.filter((g) => proyDeVenta.get(g.venta_id) === p.id);
    const r = resumen(vs, os, gs);
    if (!esAdmin(req)) ["costo_cotizado", "margen", "margen_pct", "gastos", "utilidad", "compras", "compras_recibidas", "por_pagar", "utilidad_real"].forEach((k) => delete r[k]);
    return { ...p.toJSON(), resumen: r, ordenes_cliente: vs.filter((v) => v.estado !== "anulada").map((v) => v.orden_compra_cliente).filter(Boolean), ordenes_proveedor: esAdmin(req) ? os.length : undefined };
  });
  res.json({ ok: true, data });
});

// GET /api/proyectos/:id
const getProyecto = handler(async (req, res) => {
  const p = await Proyecto.findByPk(req.params.id);
  if (!p) throw new ErrorNegocio("Proyecto no encontrado", 404);
  const { ventas, ordenes } = await contenido(p);
  const gastos = ventas.length ? await Gasto.findAll({ where: { venta_id: ventas.map((v) => v.id) }, order: [["fecha", "ASC"]] }) : [];
  const r = resumen(ventas, ordenes, gastos);
  const admin = esAdmin(req);
  res.json({
    ok: true,
    data: {
      ...p.toJSON(),
      ventas: ventas.map((v) => verVenta(req, v)),
      ordenes: admin ? ordenes.map(verOrden) : [],
      gastos: admin ? gastos : [],
      resumen: admin ? r : { ventas: r.ventas, neto: r.neto, total: r.total, cobrado: r.cobrado, por_cobrar: r.por_cobrar },
    },
  });
});

// Busca el código de licitación en la cotización de origen ("Mercado Público 1234-5-LE26")
async function codigoDesdeVentas(ventas, t) {
  const cotIds = ventas.map((v) => v.cotizacion_id).filter(Boolean);
  if (!cotIds.length) return null;
  const cots = await Cotizacion.findAll({ where: { id: cotIds }, attributes: ["notas", "archivo_cliente", "nombre_cotizacion"], transaction: t });
  for (const c of cots) {
    const m = `${c.notas || ""} ${c.archivo_cliente || ""} ${c.nombre_cotizacion || ""}`.match(/\b\d{2,7}-\d{1,5}-[A-Z]{1,3}\d{2}\b/);
    if (m) return m[0];
  }
  return null;
}

async function asignarVentas(proyecto, ventaIds, t) {
  const ventas = await Venta.findAll({ where: { id: ventaIds }, transaction: t, lock: t.LOCK.UPDATE });
  if (ventas.length !== ventaIds.length) throw new ErrorNegocio("Alguna venta no existe", 404);
  const otra = ventas.find((v) => v.proyecto_id && v.proyecto_id !== proyecto.id);
  if (otra) throw new ErrorNegocio(`La venta ${otra.numero} ya está en otro proyecto: quítala de ese primero`);
  await Venta.update({ proyecto_id: proyecto.id }, { where: { id: ventaIds }, transaction: t });
  return ventas;
}

// POST /api/proyectos   { nombre, licitacion_codigo?, cliente_id?, notas?, venta_ids: [] }
const crearProyecto = handler(async (req, res) => {
  const b = req.body || {};
  const ventaIds = (Array.isArray(b.venta_ids) ? b.venta_ids : []).map(Number).filter(Boolean);
  const p = await sequelize.transaction(async (t) => {
    const ventas = ventaIds.length ? await Venta.findAll({ where: { id: ventaIds }, transaction: t }) : [];
    let cliente_id = b.cliente_id ? Number(b.cliente_id) : ventas.find((v) => v.cliente_id)?.cliente_id || null;
    let cliente_nombre = ventas.find((v) => v.cliente_nombre)?.cliente_nombre || null;
    if (b.cliente_id) cliente_nombre = (await Cliente.findByPk(cliente_id, { transaction: t }))?.nombre || cliente_nombre;
    const nombre = String(b.nombre || "").trim() || `Licitación ${cliente_nombre || ""}`.trim();
    const proyecto = await Proyecto.create({
      nombre, cliente_id, cliente_nombre, notas: b.notas || null, creado_por: req.usuario.nombre,
      licitacion_codigo: String(b.licitacion_codigo || "").trim() || (await codigoDesdeVentas(ventas, t)),
    }, { transaction: t });
    await proyecto.update({ numero: numeroProyecto(proyecto.id) }, { transaction: t });
    if (ventaIds.length) await asignarVentas(proyecto, ventaIds, t);
    return proyecto;
  });
  res.status(201).json({ ok: true, data: p });
});

// PUT /api/proyectos/:id   { nombre, licitacion_codigo, notas, estado }
const actualizarProyecto = handler(async (req, res) => {
  const p = await Proyecto.findByPk(req.params.id);
  if (!p) throw new ErrorNegocio("Proyecto no encontrado", 404);
  const b = req.body || {};
  const cambios = {};
  if ("nombre" in b) { if (!String(b.nombre).trim()) throw new ErrorNegocio("El nombre no puede quedar vacío"); cambios.nombre = String(b.nombre).trim(); }
  if ("licitacion_codigo" in b) cambios.licitacion_codigo = String(b.licitacion_codigo || "").trim() || null;
  if ("notas" in b) cambios.notas = b.notas || null;
  if ("estado" in b) { if (!["abierto", "cerrado"].includes(b.estado)) throw new ErrorNegocio("Estado inválido"); cambios.estado = b.estado; }
  await p.update(cambios);
  res.json({ ok: true, data: p });
});

// POST /api/proyectos/:id/ventas   { venta_ids: [] }   -> agrega ventas (órdenes de compra del organismo)
const agregarVentas = handler(async (req, res) => {
  const ids = (req.body?.venta_ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new ErrorNegocio("Elige al menos una venta");
  await sequelize.transaction(async (t) => {
    const p = await Proyecto.findByPk(req.params.id, { transaction: t });
    if (!p) throw new ErrorNegocio("Proyecto no encontrado", 404);
    await asignarVentas(p, ids, t);
  });
  res.json({ ok: true, data: { agregadas: ids.length } });
});

// DELETE /api/proyectos/:id/ventas/:ventaId   -> la venta sale del proyecto (no se borra)
const quitarVenta = handler(async (req, res) => {
  const v = await Venta.findOne({ where: { id: req.params.ventaId, proyecto_id: req.params.id } });
  if (!v) throw new ErrorNegocio("Esa venta no está en el proyecto", 404);
  await v.update({ proyecto_id: null });
  res.json({ ok: true, data: { quitada: v.id } });
});

// DELETE /api/proyectos/:id   -> deshace la agrupación (ventas y órdenes quedan tal cual, sueltas)
const eliminarProyecto = handler(async (req, res) => {
  await sequelize.transaction(async (t) => {
    const p = await Proyecto.findByPk(req.params.id, { transaction: t });
    if (!p) throw new ErrorNegocio("Proyecto no encontrado", 404);
    await Venta.update({ proyecto_id: null }, { where: { proyecto_id: p.id }, transaction: t });
    await OrdenCompra.update({ proyecto_id: null }, { where: { proyecto_id: p.id }, transaction: t });
    await p.destroy({ transaction: t });
  });
  res.json({ ok: true, data: { eliminado: true } });
});

// Suma lo que hay que comprar en todo el proyecto, por proveedor y producto
function consolidar(ventas) {
  const grupos = new Map();
  for (const v of ventas.filter((x) => x.estado !== "anulada")) {
    for (const i of v.items || []) {
      const prov = i.proveedor ? normProv(i.proveedor) : SIN_PROVEEDOR;
      if (!grupos.has(prov)) grupos.set(prov, new Map());
      const clave = `${i.producto_id ?? i.nombre}|${n(i.costo)}`;
      const g = grupos.get(prov);
      const l = g.get(clave) || { producto_id: i.producto_id, codigo: i.codigo, nombre: i.nombre, unidad: i.unidad, cantidad: 0, costo: n(i.costo), venta: 0, ventas: [] };
      l.cantidad += n(i.cantidad);
      l.venta += n(i.precio) * n(i.cantidad);
      if (!l.ventas.includes(v.numero)) l.ventas.push(v.numero);
      g.set(clave, l);
    }
  }
  return grupos;
}

// GET /api/proyectos/:id/cuadro-compra   -> lo que hay que comprar en todo el proyecto, por proveedor
const getCuadroCompra = handler(async (req, res) => {
  const p = await Proyecto.findByPk(req.params.id);
  if (!p) throw new ErrorNegocio("Proyecto no encontrado", 404);
  const { ventas, ordenes } = await contenido(p);
  const grupos = consolidar(ventas);
  const lista = [...grupos.entries()].map(([prov, lineas]) => {
    const ls = [...lineas.values()].map((l) => ({ ...l, total_compra: redondear(l.costo * l.cantidad), venta: redondear(l.venta) }));
    const compra = ls.reduce((s, l) => s + l.total_compra, 0);
    const venta = ls.reduce((s, l) => s + l.venta, 0);
    return {
      proveedor: prov, lineas: ls, total_compra: redondear(compra), total_venta: redondear(venta), margen: redondear(venta - compra),
      ordenes: ordenes.filter((o) => normProv(o.proveedor_nombre) === prov).map(verOrden),
    };
  }).sort((a, b) => (a.proveedor === SIN_PROVEEDOR) - (b.proveedor === SIN_PROVEEDOR) || b.total_compra - a.total_compra);
  res.json({ ok: true, data: { proyecto: { id: p.id, numero: p.numero, nombre: p.nombre }, grupos: lista } });
});

// POST /api/proyectos/:id/generar-ordenes   { proveedores?: [] }
// Una OC por proveedor con lo de TODAS las ventas del proyecto (cantidades sumadas).
// Se omiten los proveedores que ya tienen orden en el proyecto o en alguna de sus ventas.
const generarOrdenes = handler(async (req, res) => {
  const resultado = await sequelize.transaction(async (t) => {
    const p = await Proyecto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new ErrorNegocio("Proyecto no encontrado", 404);
    const { ventas, ordenes } = await contenido(p, t);
    if (!ventas.some((v) => v.estado !== "anulada")) throw new ErrorNegocio("El proyecto no tiene ventas");
    const yaTiene = new Set(ordenes.map((o) => normProv(o.proveedor_nombre)));
    const filtro = Array.isArray(req.body?.proveedores) ? new Set(req.body.proveedores.map(normProv)) : null;
    const nums = ventas.filter((v) => v.estado !== "anulada").map((v) => v.numero).join(", ");
    const creadas = [], omitidos = [];
    for (const [prov, lineas] of consolidar(ventas)) {
      if (filtro && !filtro.has(prov)) continue;
      if (prov === SIN_PROVEEDOR) { omitidos.push(`${lineas.size} producto(s) sin proveedor`); continue; }
      if (yaTiene.has(prov)) { omitidos.push(`${prov} ya tiene orden`); continue; }
      let ficha = await Proveedor.findOne({ where: { nombre: { [Op.iLike]: prov } }, transaction: t });
      if (!ficha) ficha = await Proveedor.create({ nombre: prov }, { transaction: t });
      const items = [...lineas.values()].map((l) => ({ producto_id: l.producto_id, codigo: l.codigo, nombre: l.nombre, unidad: l.unidad, cantidad: l.cantidad, precio: l.costo }));
      const oc = await OrdenCompra.create({
        proveedor_id: ficha.id, proveedor_nombre: ficha.nombre, proyecto_id: p.id, items, ...calcularTotales(items),
        notas: `Proyecto ${p.numero} · ${p.nombre} (ventas ${nums})`, creado_por: req.usuario.nombre,
      }, { transaction: t });
      await oc.update({ numero: `OC-${String(oc.id).padStart(4, "0")}` }, { transaction: t });
      creadas.push(verOrden(oc));
    }
    return { creadas, omitidos };
  });
  res.status(201).json({ ok: true, data: resultado });
});

// POST /api/proyectos/:id/unir-ordenes   { orden_ids: [] }
// Une órdenes en BORRADOR del mismo proveedor en una sola (suma cantidades del mismo producto y precio).
// Las demás quedan anuladas con una nota que dice a cuál se unieron.
const unirOrdenes = handler(async (req, res) => {
  const ids = [...new Set((req.body?.orden_ids || []).map(Number).filter(Boolean))];
  if (ids.length < 2) throw new ErrorNegocio("Elige al menos dos órdenes para unir");
  const unida = await sequelize.transaction(async (t) => {
    const p = await Proyecto.findByPk(req.params.id, { transaction: t });
    if (!p) throw new ErrorNegocio("Proyecto no encontrado", 404);
    const { ordenes: delProyecto } = await contenido(p, t);
    const permitidas = new Set(delProyecto.map((o) => o.id));
    const ocs = await OrdenCompra.findAll({ where: { id: ids }, order: [["id", "ASC"]], transaction: t, lock: t.LOCK.UPDATE });
    if (ocs.length !== ids.length) throw new ErrorNegocio("Alguna orden no existe", 404);
    const noBorrador = ocs.find((o) => o.estado !== "borrador");
    if (noBorrador) throw new ErrorNegocio(`La ${noBorrador.numero} ya está ${noBorrador.estado}: solo se unen órdenes en borrador`);
    if (ocs.some((o) => !permitidas.has(o.id))) throw new ErrorNegocio("Alguna orden no es de este proyecto");
    if (ocs.some((o) => n(o.monto_pagado) > 0)) throw new ErrorNegocio("Alguna orden tiene pagos registrados");
    const prov = normProv(ocs[0].proveedor_nombre);
    if (ocs.some((o) => normProv(o.proveedor_nombre) !== prov)) throw new ErrorNegocio("Solo se pueden unir órdenes del mismo proveedor");

    const lineas = new Map();
    for (const o of ocs) {
      for (const i of o.items) {
        const clave = `${i.producto_id ?? i.nombre}|${n(i.precio)}`;
        const l = lineas.get(clave) || { ...i, cantidad: 0 };
        l.cantidad += n(i.cantidad);
        lineas.set(clave, l);
      }
    }
    const [principal, ...resto] = ocs;
    const items = [...lineas.values()];
    const notas = [principal.notas, `Unida con ${resto.map((o) => o.numero).join(", ")}`].filter(Boolean).join(" · ");
    await principal.update({ items, ...calcularTotales(items), proyecto_id: p.id, venta_id: null, notas }, { transaction: t });
    for (const o of resto) {
      await o.update({ estado: "anulada", notas: [o.notas, `Unida a ${principal.numero}`].filter(Boolean).join(" · ") }, { transaction: t });
    }
    return principal;
  });
  res.json({ ok: true, data: verOrden(unida) });
});

module.exports = { getProyectos, getProyecto, crearProyecto, actualizarProyecto, agregarVentas, quitarVenta, eliminarProyecto, getCuadroCompra, generarOrdenes, unirOrdenes };
