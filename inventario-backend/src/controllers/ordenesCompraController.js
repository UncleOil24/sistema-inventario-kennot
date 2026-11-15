const { firma } = require("../middlewares/auth");
const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const OrdenCompra = require("../models/OrdenCompra");
const Proveedor = require("../models/Proveedor");
const Producto = require("../models/Producto");
const Pago = require("../models/Pago");
const Venta = require("../models/Venta");
const {
  handler, ErrorNegocio, calcularTotales, normalizarItems, estadoPago,
} = require("../services/erp");
const { origenDe, normProv } = require("../services/precios");

const numeroOC = (id) => `C-${String(id).padStart(4, "0")}`; // nuestra compra al proveedor (la OC es la del cliente)
const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const sumarDias = (f, n) => { const d = new Date(`${String(f).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10); };
const empresaValida = (e) => (["kenott", "tactics"].includes(e) ? e : null);
// Vencimiento de la factura del proveedor: fecha de la factura + su plazo de pago (vacío = contado)
const vencimientoDe = async (proveedorId, fechaFactura, t) => {
  const prov = proveedorId ? await Proveedor.findByPk(proveedorId, { transaction: t, attributes: ["plazo_pago_dias"] }) : null;
  return sumarDias(fechaFactura, prov?.plazo_pago_dias || 0);
};

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
  if (["kenott", "tactics"].includes(req.query.empresa)) where.empresa = req.query.empresa;
  if (busqueda) {
    where[Op.or] = ["numero", "proveedor_nombre", "documento", "notas"].map((c) => ({ [c]: { [Op.iLike]: `%${busqueda}%` } }));
  }
  const data = await OrdenCompra.findAll({ where, order: [["id", "DESC"]] });
  // Venta para la que se compró (para agrupar en la lista)
  const ventaIds = [...new Set(data.map((o) => o.venta_id).filter(Boolean))];
  const ventas = ventaIds.length ? await Venta.findAll({ where: { id: ventaIds }, attributes: ["id", "numero", "cliente_nombre", "orden_compra_cliente", "id_solicitud", "fecha", "subtotal", "empresa", "etapa", "estado"], raw: true }) : [];
  const v = new Map(ventas.map((x) => [x.id, x]));
  res.json({ ok: true, data: data.map((o) => ({ ...o.toJSON(), venta: v.get(o.venta_id) || null })) });
});

// GET /api/ordenes-compra/:id  (incluye pagos)
const getOrden = handler(async (req, res) => {
  const oc = await OrdenCompra.findByPk(req.params.id);
  if (!oc) throw new ErrorNegocio("Orden no encontrada", 404);
  const pagos = await Pago.findAll({ where: { orden_compra_id: oc.id }, order: [["fecha", "ASC"], ["id", "ASC"]] });
  const documentos = await require("../models/DocumentoCompra").findAll({ where: { orden_id: oc.id }, attributes: ["id", "tipo", "folio", "fecha", "monto", "nombre_archivo", "creado_por", "createdAt"], order: [["id", "ASC"]] });
  const grupo = oc.factura_grupo ? await sequelize.query(`SELECT o.id, o.numero, o.total::float AS total, o.monto_pagado::float AS pagado, v.numero AS venta_numero FROM ordenes_compra o LEFT JOIN ventas v ON v.id = o.venta_id
    WHERE o.factura_grupo = :g AND o.estado <> 'anulada' ORDER BY o.id`, { replacements: { g: oc.factura_grupo }, type: sequelize.QueryTypes.SELECT }) : [];
  res.json({ ok: true, data: { ...oc.toJSON(), pagos, documentos, grupo } });
});

// GET /api/ordenes-compra/:id/repartir   -> qué ventas necesitan cada producto de esta compra (para repartirla)
const datosRepartir = handler(async (req, res) => {
  const oc = await OrdenCompra.findByPk(req.params.id);
  if (!oc) throw new ErrorNegocio("Orden no encontrada", 404);
  const { pendientesPorProducto, repartoInicial } = require("../services/repartoCompra");
  const pend = await pendientesPorProducto((oc.items || []).map((i) => i.producto_id), oc.venta_id, { excluirOrdenId: oc.id });
  const actual = oc.venta_id ? await Venta.findByPk(oc.venta_id, { attributes: ["id", "numero", "cliente_nombre"] }) : null;
  const items = (oc.items || []).map((i, indice) => {
    const cands = [...(pend.get(Number(i.producto_id)) || [])];
    // La venta actual de la compra siempre es opción; el reparto parte como está hoy (todo a esa venta)
    if (actual && !cands.some((c) => c.venta_id === actual.id)) cands.unshift({ venta_id: actual.id, numero: actual.numero, cliente: actual.cliente_nombre, falta: 0 });
    return { indice, producto_id: i.producto_id, nombre: i.nombre, unidad: i.unidad, cantidad: Number(i.cantidad), precio: Number(i.precio), ventas_pendientes: cands,
      reparto: actual ? [{ venta_id: actual.id, cantidad: Number(i.cantidad) }] : repartoInicial(i.cantidad, cands, null) };
  });
  res.json({ ok: true, data: { orden: { id: oc.id, numero: oc.numero, venta_id: oc.venta_id, estado: oc.estado, monto_pagado: Number(oc.monto_pagado), documento: oc.documento }, items } });
});

// POST /api/ordenes-compra/:id/repartir   { items: [{ indice, reparto: [{ venta_id | null, cantidad }] }] }
// Corrige una compra registrada en el lugar equivocado: se divide en una compra por venta (mismo documento, IVA en proporción)
const repartir = handler(async (req, res) => {
  const { dividir } = require("../services/repartoCompra");
  const out = await sequelize.transaction(async (t) => {
    const oc = await OrdenCompra.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!oc) throw new ErrorNegocio("Orden no encontrada", 404);
    if (oc.estado === "anulada") throw new ErrorNegocio("La compra está anulada");
    await OrdenCompra.quitarPagosAutomaticos(oc, t); // contado / crédito empresa: se vuelven a pagar solas por parte
    if (Number(oc.monto_pagado) > 0) throw new ErrorNegocio("La compra ya tiene pagos: repártela antes de pagar, o quita el pago primero");
    const porIndice = new Map((req.body?.items || []).map((x) => [Number(x.indice), x.reparto]));
    const lineas = (oc.items || []).map((it, k) => ({ ...it, reparto: porIndice.get(k) }));
    const partes = dividir(lineas, { neto: Number(oc.subtotal), iva: Number(oc.iva), total: Number(oc.total), principal: oc.venta_id, ventaPorDefecto: oc.venta_id });
    const p0 = partes[0];
    const grupo = partes.length > 1 ? oc.factura_grupo || `F${oc.id}` : oc.factura_grupo;
    await oc.update({ items: p0.items, subtotal: p0.neto, iva: p0.iva, total: p0.total, venta_id: p0.venta_id, factura_grupo: grupo }, { transaction: t });
    const DocumentoCompra = require("../models/DocumentoCompra");
    const docs = await DocumentoCompra.findAll({ where: { orden_id: oc.id }, transaction: t });
    const nuevas = [];
    for (const [n, pt] of partes.slice(1).entries()) {
      const v2 = pt.venta_id ? await Venta.findByPk(pt.venta_id, { transaction: t, attributes: ["id", "empresa"] }) : null;
      const o2 = await OrdenCompra.create({
        proveedor_id: oc.proveedor_id, proveedor_nombre: oc.proveedor_nombre, venta_id: v2?.id || null, fecha: oc.fecha, empresa: oc.empresa || v2?.empresa || null,
        items: pt.items, subtotal: pt.neto, iva: pt.iva, total: pt.total, documento: oc.documento, fecha_factura: oc.fecha_factura,
        estado: oc.estado, fecha_recepcion: oc.fecha_recepcion, fecha_vencimiento: oc.fecha_vencimiento, factura_grupo: grupo, tipo_pago: oc.tipo_pago,
        notas: `Repartida desde ${oc.numero} (${n + 2} de ${partes.length})`, creado_por: firma(req),
      }, { transaction: t });
      await o2.update({ numero: `C-${String(o2.id).padStart(4, "0")}` }, { transaction: t });
      for (const d of docs) await DocumentoCompra.create({ orden_id: o2.id, folio: d.folio, fecha: d.fecha, monto: d.monto, nombre_archivo: d.nombre_archivo, mime: d.mime, datos: d.datos, creado_por: firma(req), tipo: d.tipo }, { transaction: t });
      nuevas.push(o2);
    }
    return [oc, ...nuevas].map((o) => ({ id: o.id, numero: o.numero, venta_id: o.venta_id, total: Number(o.total) }));
  });
  res.json({ ok: true, data: { partes: out } });
});

// PUT /api/ordenes-compra/:id/venta   { venta_id | null }   -> para qué venta se compró (sirve en cualquier estado)
const asignarVenta = handler(async (req, res) => {
  const oc = await OrdenCompra.findByPk(req.params.id);
  if (!oc) throw new ErrorNegocio("Orden no encontrada", 404);
  const ventaId = req.body?.venta_id ? Number(req.body.venta_id) : null;
  if (ventaId) {
    const v = await Venta.findByPk(ventaId);
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    await oc.update({ venta_id: v.id, proyecto_id: null });
  } else {
    await oc.update({ venta_id: null });
  }
  res.json({ ok: true, data: oc });
});

// POST /api/ordenes-compra   -> queda en "borrador"
const crearOrden = handler(async (req, res) => {
  const { proveedor_id, items, fecha_vencimiento, documento, notas } = req.body;
  const venta_id = req.body.venta_id ? Number(req.body.venta_id) : null;
  const oc = await sequelize.transaction(async (t) => {
    const prov = await datosProveedor(proveedor_id, t);
    const itemsOk = await prepararItems(items, t);
    const venta = venta_id ? await Venta.findByPk(venta_id, { transaction: t, attributes: ["empresa"] }) : null;
    const nueva = await OrdenCompra.create({
      ...prov, items: itemsOk, ...calcularTotales(itemsOk),
      empresa: empresaValida(req.body.empresa) || venta?.empresa || null,
      fecha_factura: documento ? (req.body.fecha_factura || hoyISO()) : null,
      fecha_vencimiento: fecha_vencimiento || null, documento, notas, venta_id,
      creado_por: firma(req),
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
    for (const c of ["fecha_vencimiento", "documento", "notas", "fecha_factura"]) if (c in req.body) cambios[c] = req.body[c] || null;
    if ("empresa" in req.body) cambios.empresa = empresaValida(req.body.empresa);
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
    const conFactura = documento || orden.documento;
    const fechaFactura = conFactura ? (req.body.fecha_factura || orden.fecha_factura || hoyISO()) : null;
    await orden.update({
      estado: "recibida", fecha_recepcion: new Date(),
      ...(documento ? { documento } : {}),
      ...(fechaFactura ? { fecha_factura: fechaFactura } : {}),
      // Si no se anotó el vencimiento, se calcula con el plazo del proveedor (desde la factura o, sin ella, desde hoy)
      ...(orden.fecha_vencimiento ? {} : { fecha_vencimiento: await vencimientoDe(orden.proveedor_id, fechaFactura || hoyISO(), t) }),
    }, { transaction: t });
    if (registrar) {
      const origen = await origenDe(orden.proveedor_nombre, t);
      const doc = orden.documento ? `FACT. ${orden.documento}` : orden.numero;
      const { precioDesdeFactura } = require("./facturaCompraController");
      for (const item of orden.items) {
        const p = await Producto.findByPk(item.producto_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!p || !(Number(item.precio) > 0)) continue;
        // Con la fecha de la factura (no la de hoy), para comparar bien por fecha
        await precioDesdeFactura(p, {
          proveedor: normProv(orden.proveedor_nombre), precio: Number(item.precio), fecha: fechaFactura || hoyISO(), documento: doc,
          cantidad: item.cantidad, unidad: item.unidad, origen, usuario: firma(req), motivo: `Compra ${orden.numero}`,
        }, t);
      }
    }
    return orden;
  });
  res.json({ ok: true, data: oc });
});

// PUT /api/ordenes-compra/:id/factura   { documento, fecha_factura, fecha_vencimiento, empresa }
// La factura del proveedor se puede anotar en cualquier momento (borrador o recibida). Es lo que suma al
// crédito fiscal del IVA del mes de la factura, en la empresa que compra.
const registrarFactura = handler(async (req, res) => {
  const oc = await sequelize.transaction(async (t) => {
    const orden = await OrdenCompra.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!orden) throw new ErrorNegocio("Orden no encontrada", 404);
    if (orden.estado === "anulada") throw new ErrorNegocio("La orden está anulada");
    const b = req.body || {};
    const documento = String(b.documento ?? orden.documento ?? "").trim() || null;
    const fechaFactura = documento ? (b.fecha_factura || orden.fecha_factura || hoyISO()) : null;
    const empresa = "empresa" in b ? empresaValida(b.empresa) : orden.empresa;
    if (documento && !empresa) throw new ErrorNegocio("Indica qué empresa compra (Kenott o Tactics): el IVA de la factura se descuenta en esa empresa");
    let vence = b.fecha_vencimiento || null;
    if (!vence && fechaFactura) vence = await vencimientoDe(orden.proveedor_id, fechaFactura, t);
    const tipo = ["contado", "credito_empresa", "credito_proveedor"].includes(b.tipo_pago) ? b.tipo_pago : orden.tipo_pago;
    // Pasa a crédito proveedor: se quitan los pagos automáticos y vuelve a Por pagar
    if (tipo === "credito_proveedor" && orden.tipo_pago !== "credito_proveedor") await OrdenCompra.quitarPagosAutomaticos(orden, t);
    await orden.update({ documento, fecha_factura: fechaFactura, empresa, fecha_vencimiento: vence || orden.fecha_vencimiento, tipo_pago: tipo }, { transaction: t });
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
    // Factura repartida entre ventas: el pago se reparte entre sus compras (se paga la factura completa)
    if (orden.factura_grupo) {
      const grupo = await OrdenCompra.findAll({ where: { factura_grupo: orden.factura_grupo, estado: { [Op.ne]: "anulada" } }, order: [["id", "ASC"]], transaction: t, lock: t.LOCK.UPDATE });
      const monto = Number(req.body.monto);
      const saldoG = grupo.reduce((s, o) => s + Number(o.total) - Number(o.monto_pagado), 0);
      if (!(monto > 0)) throw new ErrorNegocio("Monto inválido");
      if (monto > saldoG + 0.5) throw new ErrorNegocio(`El monto supera el saldo de la factura (${Math.round(saldoG)})`);
      let resto = monto; const pagos = [];
      for (const [k, o] of grupo.entries()) {
        const saldo = Number(o.total) - Number(o.monto_pagado);
        if (saldo <= 0.5) continue;
        const parte = k === grupo.length - 1 ? resto : Math.min(resto, Math.round(monto * saldo / saldoG));
        if (parte <= 0) continue;
        resto -= parte;
        pagos.push(await Pago.create({ tipo: "pago", orden_compra_id: o.id, monto: parte, fecha: req.body.fecha || new Date(), medio: req.body.medio || "transferencia",
          nota: [req.body.nota, `factura ${o.documento} repartida (${grupo.map((x) => x.numero).join(" + ")})`].filter(Boolean).join(" · "), creado_por: firma(req) }, { transaction: t }));
        const pagado = Number(o.monto_pagado) + parte;
        await o.update({ monto_pagado: pagado, estado_pago: estadoPago(pagado, o.total) }, { transaction: t });
      }
      return { orden, pago: pagos[0], pagos };
    }
    const monto = Number(req.body.monto);
    const saldo = Number(orden.total) - Number(orden.monto_pagado);
    if (!(monto > 0)) throw new ErrorNegocio("Monto inválido");
    if (monto > saldo + 0.5) throw new ErrorNegocio(`El monto supera el saldo pendiente (${Math.round(saldo)})`);
    const pago = await Pago.create({
      tipo: "pago", orden_compra_id: orden.id, monto,
      fecha: req.body.fecha || new Date(), medio: req.body.medio || "transferencia", nota: req.body.nota,
      creado_por: firma(req),
    }, { transaction: t });
    const pagado = Number(orden.monto_pagado) + monto;
    await orden.update({ monto_pagado: pagado, estado_pago: estadoPago(pagado, orden.total) }, { transaction: t });
    return { orden, pago };
  });
  res.status(201).json({ ok: true, data: resultado });
});

module.exports = {
  asignarVenta, registrarFactura, datosRepartir, repartir,
  getOrdenes, getOrden, crearOrden, actualizarOrden, recibirOrden, anularOrden, eliminarOrden, registrarPago,
};
