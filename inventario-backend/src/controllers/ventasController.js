const { firma } = require("../middlewares/auth");
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
const Factura = require("../models/Factura");
const { asignarUnidadCliente } = require("../services/clientesMP");
const { ETAPAS } = require("../models/Venta");
const {
  handler, ErrorNegocio, calcularTotales, normalizarItems, estadoPago, sumarDias, redondear,
} = require("../services/erp");
const { getParametros, precioVenta } = require("../services/parametros");
const { normProv } = require("../services/precios");
const { esAdmin, tieneRol } = require("../middlewares/auth");
const { validarEmpresa } = require("../services/empresas");

const SIN_PROVEEDOR = "SIN PROVEEDOR";

// El rol "usuario" no ve costos, proveedores ni márgenes
const sinCostos = (v) => {
  const j = typeof v.toJSON === "function" ? v.toJSON() : { ...v };
  delete j.costo_total;
  j.items = (j.items || []).map(({ costo, proveedor, ...resto }) => resto);
  return j;
};
// Comercial ve la venta sin costos ni proveedores; Operativo los necesita para comprar; gerencia ve todo
const verVenta = (req, v) => (tieneRol(req, "operativo") ? (typeof v.toJSON === "function" ? v.toJSON() : v) : sinCostos(v));

const numeroVenta = (id) => `V-${String(id).padStart(4, "0")}`;

// Crea la venta dentro de la transacción t. Sin control de stock: primero se vende y
// después se compra al proveedor (cuadro de compra).
// datos.items: [{ producto_id, cantidad, precio?, costo?, proveedor?, nombre? }]
// Si vienen costo/proveedor (desde la cotización) se respetan; si no, se toman del catálogo.
// Una OC = una venta: el N° de OC del cliente no puede estar en otra venta vigente
const ocLibre = async (oc, ventaId, t) => {
  const n = String(oc || "").trim();
  if (!n) return;
  const otra = await Venta.findOne({ where: { orden_compra_cliente: { [Op.iLike]: n }, estado: { [Op.ne]: "anulada" }, ...(ventaId ? { id: { [Op.ne]: ventaId } } : {}) }, transaction: t });
  if (otra) throw new ErrorNegocio(`La OC ${n} ya está registrada en la venta ${otra.numero}. Una OC es una sola venta: si tiene varias facturas, regístralas en esa venta.`);
};

const crearVentaEnTransaccion = async (datos, t) => {
  await ocLibre(datos.orden_compra_cliente, null, t);
  const items = normalizarItems((datos.items || []).map((i) => ({ ...i, precio: i.precio ?? 0 })));
  const productos = await Producto.findAll({ where: { id: items.map((i) => i.producto_id) }, transaction: t });
  const mapa = new Map(productos.map((p) => [p.id, p]));
  const params = await getParametros(t);

  let cliente_nombre = datos.cliente_nombre || null;
  let tipo = datos.tipo_precio || "convenio";
  let codigo_cliente = null;
  let fichaCli = null;
  if (datos.cliente_id) {
    const c = await Cliente.findByPk(datos.cliente_id, { transaction: t });
    if (!c) throw new ErrorNegocio("Cliente no encontrado", 404);
    fichaCli = c;
    if (c.estado_credito === "suspendido" && !datos.forzar && !datos.pagada_al_contado) {
      throw new ErrorNegocio(`${c.nombre} tiene el crédito suspendido (deuda vencida). ¿Registrar la venta igual?`, 409);
    }
    // Cliente general: se respeta el nombre escrito para esta venta
    cliente_nombre = c.codigo === "P-001" && datos.cliente_nombre ? datos.cliente_nombre : c.nombre;
    codigo_cliente = c.codigo;
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

  // Plazo de pago: el indicado en la venta o el de la ficha del cliente (nunca 30 días para todos)
  const plazo = datos.pagada_al_contado ? 0
    : datos.dias_credito !== undefined && datos.dias_credito !== null && datos.dias_credito !== "" ? Math.max(0, Math.round(Number(datos.dias_credito) || 0))
    : fichaCli ? Number(fichaCli.plazo_pago_dias) : 30;
  const base = datos.base_vencimiento === "recepcion" || (!datos.base_vencimiento && fichaCli?.base_vencimiento === "recepcion") ? "recepcion" : "factura";
  // Vencimiento provisorio desde hoy; se corrige al registrar la factura o la recepción conforme
  const venc = datos.fecha_vencimiento || (plazo > 0 ? sumarDias(plazo) : null);

  const venta = await Venta.create({
    cliente_id: datos.cliente_id || null,
    cliente_nombre,
    cotizacion_id: datos.cotizacion_id || null,
    empresa: validarEmpresa(datos.empresa),
    orden_compra_cliente: String(datos.orden_compra_cliente || "").trim() || null,
    // ID del cliente o de la solicitud (ventas sin OC se identifican con él)
    id_solicitud: String(datos.id_solicitud || "").trim() || (codigo_cliente && codigo_cliente !== "P-001" ? codigo_cliente : null),
    fecha_vencimiento: venc,
    plazo_pago_dias: plazo,
    base_vencimiento: base,
    notas: datos.notas || null, // la factura no se pide al crear: se registra después en Facturación
    creado_por: datos.creado_por || null,
    items: itemsFinal,
    ...totales,
    costo_total,
  }, { transaction: t });
  await venta.update({ numero: numeroVenta(venta.id) }, { transaction: t });
  await asignarUnidadCliente(venta.cliente_id, venta.id_solicitud, t);

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
    where[Op.or] = ["numero", "cliente_nombre", "documento", "orden_compra_cliente", "id_solicitud"].map((c) => ({ [c]: { [Op.iLike]: `%${busqueda}%` } }));
  }
  if (req.query.empresa) where.empresa = req.query.empresa;
  if (req.query.etapa) where.etapa = String(req.query.etapa).split(",");
  if (req.query.estado_factura) where.estado_factura = String(req.query.estado_factura).split(",");
  const data = await Venta.findAll({ where, order: [["id", "DESC"]] });
  // Órdenes de compra de cada venta: cuántas hay y cuántas llegaron (para saber qué falta comprar o recibir)
  const ocs = data.length ? await OrdenCompra.findAll({
    where: { estado: { [Op.ne]: "anulada" }, venta_id: data.map((v) => v.id) }, attributes: ["venta_id", "estado"], raw: true,
  }) : [];
  const compras = new Map();
  for (const o of ocs) {
    const c = compras.get(o.venta_id) || { ordenes: 0, recibidas: 0 };
    c.ordenes += 1; if (o.estado === "recibida") c.recibidas += 1;
    compras.set(o.venta_id, c);
  }
  res.json({ ok: true, data: data.map((v) => {
    const c = compras.get(v.id) || { ordenes: 0, recibidas: 0 };
    return { ...verVenta(req, v), tiene_compras: c.ordenes > 0, compras: c };
  }) });
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
  let extra = tieneRol(req, "operativo") ? await resumenVenta(venta) : {};
  // Márgenes y utilidad son de Finanzas (gerencia)
  if (extra.resumen && !esAdmin(req)) extra = { ...extra, resumen: undefined, gastos: [] };
  const facturas = await Factura.findAll({ where: { venta_id: venta.id }, order: [["fecha", "ASC"], ["id", "ASC"]] });
  const ocs = await OrdenCompra.findAll({ where: { venta_id: venta.id, estado: { [Op.ne]: "anulada" } }, attributes: ["id", "numero", "proveedor_nombre", "estado"], raw: true });
  res.json({ ok: true, data: { ...verVenta(req, venta), pagos, facturas, compras: { ordenes: ocs.length, recibidas: ocs.filter((o) => o.estado === "recibida").length, detalle: ocs }, ...extra } });
});

// POST /api/ventas   (venta directa, sin cotización)
const crearVenta = handler(async (req, res) => {
  const venta = await sequelize.transaction((t) =>
    crearVentaEnTransaccion({ ...req.body, creado_por: firma(req) }, t));
  res.status(201).json({ ok: true, data: verVenta(req, venta) });
});

// POST /api/ventas/desde-cotizacion/:id   { orden_compra_cliente, dias_credito, documento, pagada_al_contado, medio_pago }
// El cliente aceptó: la cotización pasa a "aceptada" y nace la venta con los mismos precios y costos.
const ventaDesdeCotizacion = handler(async (req, res) => {
  const venta = await sequelize.transaction(async (t) => {
    const cot = await Cotizacion.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
    if (cot.estado === "aceptada" || cot.venta_id) throw new ErrorNegocio("Esta cotización ya fue convertida en venta");
    if (["borrador", "espera_proveedor"].includes(cot.estado)) throw new ErrorNegocio("La cotización aún está en preparación: finalízala antes de convertirla en venta");
    const sinProducto = (cot.items || []).filter((i) => !i.producto_id);
    if (sinProducto.length) throw new ErrorNegocio(`Hay ${sinProducto.length} línea(s) que no están en el catálogo (en rojo): asócialas a un producto (o agrégalo al catálogo) en la cotización antes de convertirla en venta, para poder comprarlas. Ej: "${sinProducto[0].descripcion_cliente || sinProducto[0].nombre}"`);

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
      id_solicitud: cot.id_solicitud,
      empresa: cot.empresa,
      creado_por: firma(req),
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

// Qué tiene la venta y qué impide anularla (la misma revisión en Comercial y en Operativo)
const revisarAnulacion = async (v, t) => {
  const [ocs, facturas] = await Promise.all([
    OrdenCompra.findAll({ where: { venta_id: v.id, estado: { [Op.ne]: "anulada" } }, attributes: ["id", "numero", "proveedor_nombre", "estado", "total"], transaction: t }),
    Factura.findAll({ where: { venta_id: v.id }, attributes: ["id", "numero", "monto", "fecha"], transaction: t }),
  ]);
  const pedidas = ocs.filter((o) => o.estado === "borrador");
  const recibidas = ocs.filter((o) => o.estado === "recibida");
  const bloqueos = [];
  if (Number(v.monto_pagado) > 0) bloqueos.push({ que: `Tiene cobros registrados por $${Math.round(Number(v.monto_pagado)).toLocaleString("es-CL")}`, donde: "Finanzas → Ventas y cobros: elimina los cobros (o devuelve el pago) antes de anular" });
  if (facturas.length) bloqueos.push({ que: `Tiene ${facturas.length} factura(s) emitida(s): ${facturas.map((f) => `N° ${f.numero}`).join(", ")}`, donde: "Emite la nota de crédito y quita la factura en la venta (Comercial → Facturación)" });
  if (recibidas.length) bloqueos.push({ que: `Tiene ${recibidas.length} compra(s) ya recibida(s): ${recibidas.map((o) => `${o.numero} de ${o.proveedor_nombre}`).join(", ")}`, donde: "Operativo → Compras: decide qué hacer con esos productos (devolución al proveedor o guardarlos para otra venta) y anula o suelta la compra" });
  return {
    estado: v.estado, etapa: v.etapa, numero: v.numero,
    compras_pedidas: pedidas.map((o) => ({ numero: o.numero, proveedor: o.proveedor_nombre, total: Math.round(Number(o.total)) })),
    compras_recibidas: recibidas.map((o) => ({ numero: o.numero, proveedor: o.proveedor_nombre, total: Math.round(Number(o.total)) })),
    facturas: facturas.map((f) => ({ numero: f.numero, monto: Math.round(Number(f.monto)) })),
    cobrado: Math.round(Number(v.monto_pagado) || 0),
    bloqueos, puede: v.estado !== "anulada" && !bloqueos.length,
  };
};

// GET /api/ventas/:id/anulacion   -> resumen para la ventana de anulación
const resumenAnulacion = handler(async (req, res) => {
  const v = await Venta.findByPk(req.params.id);
  if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
  res.json({ ok: true, data: await revisarAnulacion(v) });
});

// POST /api/ventas/:id/anular   { motivo }  -> la cotización vuelve a quedar abierta
const anularVenta = handler(async (req, res) => {
  const motivo = String(req.body?.motivo || "").trim();
  if (!motivo) throw new ErrorNegocio("Indica el motivo de la anulación");
  const venta = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta ya está anulada");
    const r = await revisarAnulacion(v, t);
    if (r.bloqueos.length) throw new ErrorNegocio(`No se puede anular todavía: ${r.bloqueos.map((b) => b.que).join(" · ")}`);
    await OrdenCompra.update({ estado: "anulada" }, { where: { venta_id: v.id, estado: "borrador" }, transaction: t });
    await v.update({ estado: "anulada", motivo_anulacion: motivo.slice(0, 255), anulada_por: firma(req), anulada_fecha: new Date() }, { transaction: t });
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
    const medio = req.body.medio || "transferencia";
    const comision = medio === "factoring" ? Math.round(Number(req.body.factoring_comision) || 0) : 0;
    // Factoring: la factura queda saldada por el monto cedido; la comisión es un gasto financiero de la venta
    const gasto = comision > 0 ? await Gasto.create({
      fecha: req.body.fecha || new Date(), tipo: "financiero", monto: comision, venta_id: v.id, empresa: v.empresa,
      descripcion: `Comisión factoring ${req.body.factoring_entidad || ""} · ${v.numero}`.replace(/\s+·/, " ·").trim(), creado_por: firma(req),
    }, { transaction: t }) : null;
    const pago = await Pago.create({
      tipo: "cobro", venta_id: v.id, monto,
      fecha: req.body.fecha || new Date(), medio, nota: req.body.nota,
      factoring_entidad: medio === "factoring" ? String(req.body.factoring_entidad || "").trim() || null : null,
      factoring_comision: comision || null, gasto_id: gasto?.id || null,
      creado_por: firma(req),
    }, { transaction: t });
    const pagado = Number(v.monto_pagado) + monto;
    await v.update({ monto_pagado: pagado, estado_pago: estadoPago(pagado, v.total) }, { transaction: t });
    return { venta: verVenta(req, v), pago };
  });
  res.status(201).json({ ok: true, data: resultado });
});

// PUT /api/ventas/:id/datos   { orden_compra_cliente, id_solicitud, fecha_vencimiento, notas }
// (las facturas se registran aparte: POST /api/ventas/:id/facturas)
const actualizarDatos = handler(async (req, res) => {
  const v = await Venta.findByPk(req.params.id);
  if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
  if ("orden_compra_cliente" in req.body) await ocLibre(req.body.orden_compra_cliente, v.id);
  const cambios = {};
  for (const c of ["orden_compra_cliente", "id_solicitud", "fecha_vencimiento", "notas"]) if (c in req.body) cambios[c] = String(req.body[c] ?? "").trim() || null;
  // Plazo de pago de esta venta (si la OC o las bases dicen otro): recalcula el vencimiento
  if ("plazo_pago_dias" in req.body || "base_vencimiento" in req.body) {
    const plazo = "plazo_pago_dias" in req.body ? Math.max(0, Math.round(Number(req.body.plazo_pago_dias) || 0)) : v.plazo_pago_dias;
    const base = "base_vencimiento" in req.body ? (req.body.base_vencimiento === "recepcion" ? "recepcion" : "factura") : v.base_vencimiento;
    Object.assign(cambios, { plazo_pago_dias: plazo, base_vencimiento: base });
    const [primera] = await Factura.findAll({ where: { venta_id: v.id }, order: [["fecha", "ASC"]], limit: 1 });
    const desde = base === "recepcion" ? v.entrega_fecha : primera?.fecha;
    if (desde && !("fecha_vencimiento" in req.body)) cambios.fecha_vencimiento = sumarDesde(desde, plazo);
  }
  // Cliente: se elige a mano o se asocia solo por el ID (unidad de compra = números antes del primer guion)
  let cliente = null;
  if ("cliente_id" in req.body && req.body.cliente_id) {
    cliente = await Cliente.findByPk(req.body.cliente_id);
    if (!cliente) throw new ErrorNegocio("Cliente no encontrado", 404);
  } else if (cambios.id_solicitud && cambios.id_solicitud !== v.id_solicitud) {
    const unidad = cambios.id_solicitud.split("-")[0].trim();
    if (/^\d+$/.test(unidad)) cliente = await Cliente.findOne({ where: { codigo: unidad } });
  }
  if (cliente && cliente.id !== v.cliente_id) {
    const general = ["P-001", "CG"].includes(cliente.codigo);
    cambios.cliente_id = cliente.id;
    if (!general) cambios.cliente_nombre = cliente.nombre;
    if (!general && (!cambios.id_solicitud && (!v.id_solicitud || /^P-\d+$/.test(v.id_solicitud)))) cambios.id_solicitud = cliente.codigo;
    if (v.cotizacion_id) await Cotizacion.update({ cliente_id: cliente.id }, { where: { id: v.cotizacion_id } });
  }
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
      venta: { id: venta.id, numero: venta.numero, cliente_nombre: venta.cliente_nombre, fecha: venta.fecha, estado: venta.estado, orden_compra_cliente: venta.orden_compra_cliente, id_solicitud: venta.id_solicitud, etapa: venta.etapa, subtotal: venta.subtotal, costo_total: venta.costo_total },
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
    const existentes = await OrdenCompra.findAll({ where: { estado: { [Op.ne]: "anulada" }, venta_id: v.id }, transaction: t });
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
        proveedor_id: ficha.id, proveedor_nombre: ficha.nombre, venta_id: v.id, empresa: v.empresa,
        items: lineas, ...calcularTotales(lineas),
        notas: `Para venta ${v.numero}${v.cliente_nombre ? ` · ${v.cliente_nombre}` : ""}`,
        creado_por: firma(req),
      }, { transaction: t });
      await oc.update({ numero: `OC-${String(oc.id).padStart(4, "0")}` }, { transaction: t });
      creadas.push(oc);
    }
    // Generar las compras significa que Operativo tomó la venta
    if (creadas.length && v.etapa === "registrada") await v.update({ etapa: "aceptada", aceptada_fecha: new Date(), aceptada_por: firma(req) }, { transaction: t });
    return { creadas, omitidos };
  });
  res.status(201).json({ ok: true, data: resultado });
});

// --- Recorrido de la venta: aceptar, confirmar, facturar, despachar, entregar ---------------

const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const sumarDesde = (iso, dias) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + Number(dias || 0))).toISOString().slice(0, 10);
};
const conVenta = (fn) => handler(async (req, res) => {
  const venta = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta está anulada");
    await fn(v, req, t);
    return v;
  });
  res.json({ ok: true, data: verVenta(req, venta) });
});
const exigirEtapa = (v, ...etapas) => {
  if (!etapas.includes(v.etapa)) throw new ErrorNegocio(`La venta ${v.numero} está "${v.etapa}"; esta acción es para ventas ${etapas.join(" o ")}`);
};

// POST /api/ventas/:id/aceptar   (Operativo toma la venta para comprar)
const aceptarVenta = conVenta(async (v, req, t) => {
  exigirEtapa(v, "registrada");
  await v.update({ etapa: "aceptada", aceptada_fecha: new Date(), aceptada_por: firma(req) }, { transaction: t });
});

// POST /api/ventas/:id/confirmar   (Operativo: llegaron los productos -> lista para facturar y despachar)
// { forzar: true } para confirmar aunque haya órdenes de compra sin recibir (p.ej. se retiró en el local)
const confirmarVenta = conVenta(async (v, req, t) => {
  exigirEtapa(v, "registrada", "aceptada");
  const ocs = await OrdenCompra.findAll({ where: { venta_id: v.id, estado: { [Op.ne]: "anulada" } }, transaction: t });
  const pendientes = ocs.filter((o) => o.estado !== "recibida");
  if (pendientes.length && !req.body?.forzar) {
    throw new ErrorNegocio(`Faltan por recibir: ${pendientes.map((o) => `${o.numero} (${o.proveedor_nombre})`).join(", ")}. Márcalas recibidas en Compras o confirma igual.`, 409);
  }
  await v.update({
    etapa: "lista", lista_fecha: new Date(), lista_por: firma(req),
    ...(v.aceptada_fecha ? {} : { aceptada_fecha: new Date(), aceptada_por: firma(req) }),
  }, { transaction: t });
});

// Para despachar (o entregar sin despacho, retiro en local) debe haber guía de despacho o al menos una factura:
// así no se salta la facturación (decisión de gerencia, 10-nov-2026)
const exigirDocumentoDespacho = async (v, guia, t) => {
  if (String(guia || v.guia_despacho || "").trim()) return;
  if (await Factura.count({ where: { venta_id: v.id }, transaction: t })) return;
  throw new ErrorNegocio("Para despachar se necesita el N° de guía de despacho o una factura registrada. Pide a Comercial que facture o anota la guía.");
};

// POST /api/ventas/:id/despachar   { fecha, guia }
const despacharVenta = conVenta(async (v, req, t) => {
  exigirEtapa(v, "lista");
  await exigirDocumentoDespacho(v, req.body?.guia, t);
  await v.update({ etapa: "despachada", despacho_fecha: req.body?.fecha || hoy(), guia_despacho: String(req.body?.guia || "").trim() || null, despacho_por: firma(req) }, { transaction: t });
});

// POST /api/ventas/:id/entregar   { fecha, recibido_por }
const entregarVenta = conVenta(async (v, req, t) => {
  exigirEtapa(v, "despachada", "lista");
  if (v.etapa === "lista") await exigirDocumentoDespacho(v, req.body?.guia, t);
  await v.update({
    etapa: "entregada", entrega_fecha: req.body?.fecha || hoy(), recibido_por: String(req.body?.recibido_por || "").trim() || null,
    ...(String(req.body?.guia || "").trim() ? { guia_despacho: String(req.body.guia).trim() } : {}),
    // Plazo contado desde la recepción conforme
    ...(v.base_vencimiento === "recepcion" && v.plazo_pago_dias != null ? { fecha_vencimiento: sumarDesde(req.body?.fecha || hoy(), v.plazo_pago_dias) } : {}),
    ...(v.despacho_fecha ? {} : { despacho_fecha: req.body?.fecha || hoy(), despacho_por: firma(req) }),
  }, { transaction: t });
});

// POST /api/ventas/:id/retroceder   (gerencia: deshace el último paso si se marcó por error)
const retrocederEtapa = conVenta(async (v, req, t) => {
  const i = ETAPAS.indexOf(v.etapa);
  if (i <= 0) throw new ErrorNegocio("La venta ya está en la primera etapa");
  const limpiar = {
    aceptada: { aceptada_fecha: null, aceptada_por: null },
    lista: { lista_fecha: null, lista_por: null },
    despachada: { despacho_fecha: null, guia_despacho: null, despacho_por: null },
    entregada: { entrega_fecha: null, recibido_por: null },
  }[v.etapa];
  await v.update({ etapa: ETAPAS[i - 1], ...limpiar }, { transaction: t });
});

// Recalcula lo facturado de la venta y el resumen de N° de facturas
const recalcularFacturas = async (v, t) => {
  const facturas = await Factura.findAll({ where: { venta_id: v.id }, order: [["fecha", "ASC"], ["id", "ASC"]], transaction: t });
  const monto = facturas.reduce((s, f) => s + Number(f.monto), 0);
  const estado = !facturas.length ? "sin_factura" : monto >= Number(v.total) - 1 ? "facturada" : "parcial";
  const cambios = { monto_facturado: monto, estado_factura: estado, documento: facturas.map((f) => f.numero).join(", ").slice(0, 255) || null };
  // Plazo contado desde la factura: vence a los N días de la primera factura
  if (v.base_vencimiento !== "recepcion" && v.plazo_pago_dias != null && facturas.length) cambios.fecha_vencimiento = sumarDesde(facturas[0].fecha, v.plazo_pago_dias);
  await v.update(cambios, { transaction: t });
};

// POST /api/ventas/:id/facturas   { numero, fecha, monto (con IVA; vacío = lo que falta por facturar), notas }
const agregarFactura = conVenta(async (v, req, t) => {
  if (!["lista", "despachada", "entregada"].includes(v.etapa) && !req.body?.forzar) {
    throw new ErrorNegocio("Operativo aún no confirma esta venta (productos listos). ¿Facturar igual?", 409);
  }
  const numero = String(req.body?.numero || "").trim();
  if (!numero) throw new ErrorNegocio("Indica el N° de factura");
  const repetida = await Factura.findOne({ where: { numero }, transaction: t });
  if (repetida) {
    const otra = await Venta.findByPk(repetida.venta_id, { attributes: ["numero"], transaction: t });
    throw new ErrorNegocio(`La factura ${numero} ya está registrada${otra ? ` en la venta ${otra.numero}` : ""}`);
  }
  const falta = Math.round(Number(v.total) - Number(v.monto_facturado));
  const monto = req.body?.monto === undefined || req.body?.monto === "" || req.body?.monto === null ? falta : Math.round(Number(req.body.monto));
  if (!(monto > 0)) throw new ErrorNegocio(falta <= 0 ? "La venta ya está facturada completa" : "Monto inválido");
  if (monto > falta + 1) throw new ErrorNegocio(`El monto supera lo que falta por facturar ($${falta.toLocaleString("es-CL")})`);
  await Factura.create({ venta_id: v.id, numero, fecha: req.body?.fecha || hoy(), monto, notas: req.body?.notas || null, creado_por: firma(req) }, { transaction: t });
  await recalcularFacturas(v, t);
});

// DELETE /api/ventas/:id/facturas/:facturaId   (se ingresó por error)
const quitarFactura = conVenta(async (v, req, t) => {
  const f = await Factura.findOne({ where: { id: req.params.facturaId, venta_id: v.id }, transaction: t });
  if (!f) throw new ErrorNegocio("Factura no encontrada", 404);
  await f.destroy({ transaction: t });
  await recalcularFacturas(v, t);
});

// GET /api/ventas/facturas/lista?desde=&hasta=   (registro de facturas emitidas)
const listarFacturas = handler(async (req, res) => {
  const where = {};
  if (req.query.desde || req.query.hasta) where.fecha = { ...(req.query.desde && { [Op.gte]: req.query.desde }), ...(req.query.hasta && { [Op.lte]: req.query.hasta }) };
  const facturas = await Factura.findAll({ where, order: [["fecha", "DESC"], ["id", "DESC"]], limit: 500 });
  const ventas = facturas.length ? await Venta.findAll({ where: { id: [...new Set(facturas.map((f) => f.venta_id))] }, attributes: ["id", "numero", "cliente_nombre", "empresa", "orden_compra_cliente", "id_solicitud"], raw: true }) : [];
  const mapa = new Map(ventas.map((v) => [v.id, v]));
  res.json({ ok: true, data: facturas.map((f) => ({ ...f.toJSON(), venta: mapa.get(f.venta_id) || null })) });
});

module.exports = {
  resumenAnulacion,
  aceptarVenta, confirmarVenta, despacharVenta, entregarVenta, retrocederEtapa, agregarFactura, quitarFactura, listarFacturas, recalcularFacturas,
  verVenta, SIN_PROVEEDOR,
  getVentas, getVenta, crearVenta, ventaDesdeCotizacion, anularVenta, registrarCobro, actualizarDatos,
  getCuadroCompra, cambiarProveedorLinea, generarOrdenes,
};
