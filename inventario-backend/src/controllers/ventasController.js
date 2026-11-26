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
const HistorialVenta = require("../models/HistorialVenta");
const { asignarUnidadCliente } = require("../services/clientesMP");
const { ETAPAS } = require("../models/Venta");
const {
  handler, ErrorNegocio, calcularTotales, normalizarItems, estadoPago, sumarDias, redondear,
} = require("../services/erp");
const { getParametros, precioVenta } = require("../services/parametros");
const { normProv, esGenerico } = require("../services/precios");
const { esAdmin, tieneRol, veCostos } = require("../middlewares/auth");
const { validarEmpresa, datosEmpresa } = require("../services/empresas");

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
// "pendiente", "sin OC", "s/oc", "-": la OC aún no llega (no es un N° de OC)
const esOcPendiente = (oc) => /^\s*(pendiente|por llegar|sin\s*oc|s\/?\s*oc|-+|\?)\s*$/i.test(String(oc || ""));
const ocLibre = async (oc, ventaId, t) => {
  const n = String(oc || "").trim();
  if (!n || esOcPendiente(n)) return;
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
      // Lo que pidió el cliente (tal como se cotizó): es lo que se compra y lo que sale en las hojas
      ...(original.descripcion_cliente ? { descripcion_cliente: original.descripcion_cliente } : {}),
      ...(original.caso ? { caso: original.caso } : {}),
      ...(original.clave ? { clave: original.clave } : {}),
      ...(original.complemento_de ? { complemento_de: original.complemento_de } : {}),
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
    orden_compra_cliente: esOcPendiente(datos.orden_compra_cliente) || datos.oc_pendiente ? null : String(datos.orden_compra_cliente || "").trim() || null,
    oc_pendiente: !!datos.oc_pendiente || esOcPendiente(datos.orden_compra_cliente),
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
  const resp = await require("../services/respaldoVenta").respaldos(data);
  res.json({ ok: true, data: data.map((v) => {
    const c = compras.get(v.id) || { ordenes: 0, recibidas: 0 };
    return { ...verVenta(req, v), tiene_compras: c.ordenes > 0, compras: c, respaldo: resp.get(v.id) || null };
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
  // Lo realmente comprado: compras recibidas (con su factura o boleta); las pedidas aún pueden cambiar
  const recibidas = ordenes.filter((o) => o.estado === "recibida");
  const compras_real = recibidas.reduce((s, o) => s + Number(o.subtotal), 0);
  return {
    gastos, ordenes: ordenes.map((o) => ({ id: o.id, numero: o.numero, proveedor_nombre: o.proveedor_nombre, estado: o.estado, subtotal: o.subtotal, estado_pago: o.estado_pago })),
    resumen: {
      margen: redondear(margen),
      margen_pct: Number(venta.subtotal) ? Math.round((margen / Number(venta.subtotal)) * 100) : 0,
      gastos: redondear(total_gastos),
      utilidad: redondear(margen - total_gastos),
      compras_real: redondear(compras_real),
      // Utilidad con lo que realmente se compró (si ya hay órdenes de compra)
      utilidad_real: recibidas.length ? redondear(Number(venta.subtotal) - compras_real - total_gastos) : null,
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
  const historial = await HistorialVenta.findAll({ where: { venta_id: venta.id }, order: [["createdAt", "ASC"], ["id", "ASC"]], attributes: ["id", "tipo", "texto", "motivo", "por", "createdAt"], raw: true });
  const respaldo = (await require("../services/respaldoVenta").respaldos([venta])).get(venta.id);
  const DocumentoVenta = require("../models/DocumentoVenta");
  const documentos = await DocumentoVenta.findAll({ where: { venta_id: venta.id }, attributes: ["id", "tipo", "folio", "fecha", "monto", "nombre_archivo", "createdAt", "creado_por"], order: [["id", "ASC"]] });
  res.json({ ok: true, data: { ...verVenta(req, venta), pagos, facturas, historial, respaldo, documentos, compras: { ordenes: ocs.length, recibidas: ocs.filter((o) => o.estado === "recibida").length, detalle: ocs }, ...extra } });
});

// Lo que pidió el cliente (descripción de la cotización); si no hay, el nombre del catálogo
const descCliente = (i) => String(i?.descripcion_cliente || "").trim() || i?.nombre || "";

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
      // Cada línea y, debajo, sus componentes (ej. bisagras de la puerta) como líneas a comprar con precio 0:
      // no se facturan al cliente, pero su costo es de la venta y aparecen en el cuadro de compra.
      items: cot.items.flatMap((i) => {
        const linea = {
          producto_id: i.producto_id ?? i.id, codigo: i.codigo, nombre: i.nombre, unidad: i.unidad,
          cantidad: i.cantidad, precio: i.precio,
          descripcion_cliente: i.descripcion_cliente || null, caso: i.caso || null, clave: i.clave || null,
          // Cotizaciones antiguas no guardaban costo: se toma del catálogo
          ...(i.costo !== undefined ? { costo: i.costo, proveedor: i.proveedor ?? null } : {}),
        };
        const comps = (i.componentes || []).map((c) => ({
          producto_id: c.producto_id, codigo: c.codigo, nombre: c.nombre, unidad: c.unidad,
          cantidad: Math.round(Number(c.por_unidad) * Number(i.cantidad) * 1000) / 1000, precio: 0, costo: Number(c.costo) || 0, proveedor: c.proveedor ?? null,
          complemento_de: i.descripcion_cliente || i.nombre,
        }));
        return [linea, ...comps];
      }),
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
    await HistorialVenta.anotar(v, "anulacion", "Anuló la venta", req, t, motivo);
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
  // OC: si llega el N°, deja de estar pendiente; "pendiente" (o la casilla) la deja pendiente sin N°
  if ("orden_compra_cliente" in req.body || "oc_pendiente" in req.body) {
    const pend = !!req.body.oc_pendiente || esOcPendiente(req.body.orden_compra_cliente);
    if (pend) { cambios.orden_compra_cliente = null; cambios.oc_pendiente = true; }
    else if (cambios.orden_compra_cliente) cambios.oc_pendiente = false;
    else if ("oc_pendiente" in req.body) cambios.oc_pendiente = false;
  }
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
  } else if (cambios.orden_compra_cliente && /^\d+-\d+-[A-Za-z]/.test(cambios.orden_compra_cliente) && !(v.id_solicitud || "").match(/^\d/)) {
    cliente = await Cliente.findOne({ where: { codigo: cambios.orden_compra_cliente.split("-")[0] } });
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
  const datos = await datosCuadro(venta);
  await sugerirEquivalentes(datos.lineas).catch((e) => console.error("sugerir equivalentes", e.message));
  res.json({ ok: true, data: datos });
});

// Líneas por comprar sin precio propio confiable (sin precio, solo el cotizado, "por confirmar" o de otra medida):
// se busca en el catálogo un producto con las mismas medidas y un precio con documento (cotización o factura),
// para ofrecerlo en la línea (ej. el terminal 25 MM X 3/4" que quedó en otro producto).
async function sugerirEquivalentes(lineas) {
  const { conflictoMedidas, mismasMedidas } = require("../services/medidas");
  const { conDocumento } = require("../services/precios");
  const { buscarParecidos } = require("./productosController");
  const CC = require("../services/cuadroCompra");
  const dudosa = (o) => o.cotizado || ["parecido", "equivalente", "similar"].includes(o.calce);
  const revisar = lineas.filter((l) => ["por_comprar", "parcial"].includes(l.estado) && !l.complemento_de && l.producto_id).filter((l) => {
    // Marca las opciones con otra medida que lo pedido
    for (const o of l.opciones) if (o.descripcion && conflictoMedidas(l.nombre, o.descripcion)) o.medida_distinta = true;
    const reales = l.opciones.filter((o) => !dudosa(o) && !o.medida_distinta);
    return !reales.length;
  }).slice(0, 30);
  if (!revisar.length) return;
  const cand = new Map();
  for (const l of revisar) {
    const ps = (await buscarParecidos(l.nombre, l.producto_id, { minimo: 0.4, max: 8 })).filter((p) => mismasMedidas(l.nombre, p.nombre));
    cand.set(l.indice, ps);
  }
  const ops = await CC.opcionesPorProducto([...new Set([...cand.values()].flat().map((p) => p.id))]);
  for (const l of revisar) {
    const sug = [];
    for (const p of cand.get(l.indice) || []) {
      const buenas = (ops.get(p.id) || []).filter((o) => conDocumento(o) && !["parecido", "equivalente", "similar"].includes(o.calce) && !(o.descripcion && conflictoMedidas(l.nombre, o.descripcion)));
      if (buenas.length) sug.push({ producto_id: p.id, codigo: p.codigo, nombre: p.nombre, parecido: p.parecido, opcion: buenas[0] });
    }
    if (sug.length) l.equivalentes = sug.sort((a, b) => b.parecido - a.parecido || a.opcion.precio - b.opcion.precio).slice(0, 2);
  }
}

// Datos del cuadro de compra de una venta (también para imprimir, el Excel y agrupar compras)
async function datosCuadro(venta) {
  const CC = require("../services/cuadroCompra");
  const ids = venta.items.map((i) => i.producto_id);
  const [productos, proveedores, extra, opciones, ordenesFull] = await Promise.all([
    Producto.findAll({ where: { id: ids.filter(Boolean) }, attributes: ["id", "codigo", "nombre", "unidad", "precio_compra", "proveedor"] }),
    Proveedor.findAll({ attributes: ["id", "nombre", "contacto", "telefono", "email"] }),
    resumenVenta(venta),
    CC.opcionesPorProducto(ids),
    OrdenCompra.findAll({ where: { venta_id: venta.id, estado: { [Op.ne]: "anulada" } }, order: [["id", "ASC"]] }),
  ]);
  const prodMap = new Map(productos.map((p) => [p.id, p]));
  const estados = CC.estadoLineas(venta.items, ordenesFull);

  const lineas = venta.items.map((i, indice) => {
    const prov = i.proveedor ? normProv(i.proveedor) : CC.SIN;
    const ops = [...(opciones.get(i.producto_id) || [])];
    // El proveedor y costo con que se cotizó también es una opción (aunque no tenga historial)
    if (prov !== CC.SIN && Number(i.costo) > 0 && !ops.some((o) => o.proveedor === prov)) ops.push({ proveedor: prov, precio: Math.round(Number(i.costo)), fecha: null, cotizado: true });
    ops.sort((a, b) => a.precio - b.precio);
    const enStock = CC.stockDe(i);
    const totalCompra = Number(i.costo) * (Number(i.cantidad) - enStock);
    const totalVenta = Number(i.precio) * Number(i.cantidad);
    const p = prodMap.get(i.producto_id);
    return {
      // Se muestra lo que pidió el cliente; el producto del catálogo queda como referencia (precios)
      indice, producto_id: i.producto_id, codigo: i.codigo, nombre: descCliente(i), nombre_catalogo: i.nombre, caso: i.caso || null, unidad: i.unidad, cantidad: Number(i.cantidad),
      complemento_de: i.complemento_de || null,
      proveedor: prov, compra_unit: Number(i.costo), total_compra: redondear(totalCompra),
      venta_unit: Number(i.precio), total_venta: redondear(totalVenta),
      margen: redondear(totalVenta - totalCompra), margen_pct: totalVenta ? Math.round(((totalVenta - totalCompra) / totalVenta) * 100) : 0,
      catalogo: p ? { proveedor: p.proveedor, precio: Number(p.precio_compra) || 0 } : null,
      opciones: ops.slice(0, 6),
      stock_info: i.stock || null,
      ...estados[indice],
    };
  });
  // Productos que no vinieron en una compra recibida (sin stock): vuelven a "por comprar" con la marca
  for (const l of lineas) {
    if (l.estado === "comprado" || l.estado === "pedido") continue;
    for (const o of ordenesFull) {
      const nv = (o.no_vinieron || []).find((x) => x.producto_id && x.producto_id === l.producto_id);
      if (nv) { l.no_vino = { orden: o.numero, proveedor: o.proveedor_nombre, cantidad: Number(nv.cantidad) }; break; }
    }
  }
  const sugerencias = CC.sugerir(lineas.filter((l) => l.estado === "por_comprar").map((l) => ({ ...l, cantidad: l.cantidad - (l.stock || 0) })));

  // Resumen por proveedor elegido (solo lo que falta comprar)
  const provMap = new Map(proveedores.map((p) => [normProv(p.nombre), p]));
  const porProv = new Map();
  for (const l of lineas) {
    if (l.estado !== "por_comprar") continue;
    const x = porProv.get(l.proveedor) || { proveedor: l.proveedor, lineas: 0, total: 0 };
    x.lineas += 1; x.total += l.total_compra;
    porProv.set(l.proveedor, x);
  }
  const resumen_proveedores = [...porProv.values()].sort((a, b) => (a.proveedor === CC.SIN) - (b.proveedor === CC.SIN) || b.total - a.total)
    .map((x) => { const f = provMap.get(x.proveedor); return { ...x, total: redondear(x.total), contacto: f ? [f.contacto, f.telefono, f.email].filter(Boolean).join(" · ") : null }; });

  return {
      venta: { id: venta.id, numero: venta.numero, cliente_nombre: venta.cliente_nombre, fecha: venta.fecha, estado: venta.estado, orden_compra_cliente: venta.orden_compra_cliente, id_solicitud: venta.id_solicitud, etapa: venta.etapa, empresa: venta.empresa },
      lineas, sugerencias, resumen_proveedores,
      totales: (() => {
        // Utilidad con lo ya comprado (facturas y boletas) + lo planificado de lo que falta comprar
        const falta = lineas.filter((l) => !["comprado", "stock"].includes(l.estado)).reduce((s2, l) => s2 + l.total_compra, 0);
        const todoComprado = lineas.every((l) => ["comprado", "stock"].includes(l.estado));
        const actual = Number(venta.subtotal) - Number(extra.resumen.compras_real || 0) - falta - Number(extra.resumen.gastos || 0);
        return { compra: redondear(Number(venta.costo_total)), venta: redondear(Number(venta.subtotal)), ...extra.resumen,
          falta_comprar: redondear(falta), utilidad_actual: redondear(actual), todo_comprado: todoComprado };
      })(),
      gastos: extra.gastos,
      ordenes: ordenesFull.map((o) => ({ id: o.id, numero: o.numero, proveedor_nombre: o.proveedor_nombre, estado: o.estado, subtotal: Number(o.subtotal), total: Number(o.total), documento: o.documento, lineas: (o.items || []).length,
        items: (o.items || []).map((it) => ({ producto_id: it.producto_id, nombre: it.nombre, cantidad: Number(it.cantidad) })), no_vinieron: o.no_vinieron || [] })),
      proveedores: proveedores.map((p) => p.nombre).filter((n) => !esGenerico(n)).sort(),
  };
}

// Precio de un producto con un proveedor: su precio vigente en el historial (o el de la línea si es el mismo proveedor)
async function precioCon(item, proveedor) {
  const CC = require("../services/cuadroCompra");
  const ops = (await CC.opcionesPorProducto([item.producto_id])).get(item.producto_id) || [];
  // Si la línea ya va con ese proveedor se respeta su costo (puede ser un precio puesto a mano)
  if (normProv(item.proveedor) === proveedor && Number(item.costo) > 0) return Number(item.costo);
  const o = ops.find((x) => x.proveedor === proveedor);
  return o ? o.precio : null;
}

// POST /api/ventas/:id/asignar   { asignaciones: [{ indice, proveedor, costo? }] }
// Con quién se compra cada línea (a mano o aplicando una sugerencia). Cambia el costo y el margen de la venta.
const asignarProveedores = handler(async (req, res) => {
  const lista = Array.isArray(req.body?.asignaciones) ? req.body.asignaciones : [];
  if (!lista.length) throw new ErrorNegocio("No hay líneas para asignar");
  await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta está anulada");
    const items = [...v.items];
    for (const a of lista) {
      const i = items[Number(a.indice)];
      const prov = normProv(a.proveedor || "");
      if (!i || !prov) continue;
      let costo = a.costo != null && a.costo !== "" ? Number(a.costo) : await precioCon(i, prov);
      // Sin precio con ese proveedor: si es el mismo proveedor se mantiene el costo; si es otro, queda sin precio
      // (antes quedaba el costo del proveedor anterior y parecía que el nuevo cobraba lo mismo)
      if (costo == null) costo = normProv(i.proveedor) === prov ? Number(i.costo) || 0 : 0;
      items[Number(a.indice)] = { ...i, proveedor: prov, costo: Math.round(costo) };
    }
    await v.update({ items, costo_total: require("../services/cuadroCompra").costoItems(items) }, { transaction: t });
  });
  res.json({ ok: true, data: { asignadas: lista.length } });
});

// POST /api/ventas/:id/crear-orden   { indices: [..], proveedor }
// Una orden (borrador) al proveedor que se elija, con las líneas marcadas. Las líneas quedan asignadas a ese proveedor.
const crearOrdenVenta = handler(async (req, res) => {
  const oc = await crearOrdenDe(req.params.id, req.body?.indices, req.body?.proveedor, req);
  res.status(201).json({ ok: true, data: oc });
});

// Ficha del proveedor de una orden (se crea si no existe). Los nombres de relleno (OTROS, COTIZAR…) no tienen ficha:
// la orden se crea igual con ese nombre, para comprar sin proveedor definido.
async function fichaProveedor(prov, t) {
  if (esGenerico(prov)) return null;
  return (await Proveedor.findOne({ where: { nombre: { [Op.iLike]: prov } }, transaction: t })) || Proveedor.create({ nombre: prov }, { transaction: t });
}

async function crearOrdenDe(ventaId, indicesBrutos, proveedor, req) {
  const prov = normProv(proveedor || "");
  const indices = (indicesBrutos || []).map(Number).filter((n) => n >= 0);
  if (!prov || prov === "SIN PROVEEDOR") throw new ErrorNegocio("Indica a qué proveedor va la orden");
  if (!indices.length) throw new ErrorNegocio("Marca los productos de la orden");
  return sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(ventaId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta está anulada");
    const items = [...v.items];
    const lineas = [];
    for (const k of indices) {
      const i = items[k];
      if (!i) continue;
      let precio = await precioCon(i, prov);
      if (precio == null) precio = Number(i.costo) || 0;
      items[k] = { ...i, proveedor: prov, costo: Math.round(precio) };
      const cant = Number(i.cantidad) - require("../services/cuadroCompra").stockDe(i);
      if (cant <= 0) continue; // cubierto con stock
      lineas.push({ producto_id: i.producto_id, codigo: i.codigo, nombre: i.nombre, descripcion_cliente: i.descripcion_cliente || null, unidad: i.unidad, cantidad: cant, precio: Math.round(precio) });
    }
    if (!lineas.length) throw new ErrorNegocio("Las líneas marcadas no existen");
    // Productos que este proveedor vende en pack (ej. pack x4): la orden indica cuántos packs comprar
    const ops = await require("../services/cuadroCompra").opcionesPorProducto(lineas.map((l) => l.producto_id));
    for (const l of lineas) {
      const o = (ops.get(l.producto_id) || []).find((x) => x.proveedor === prov);
      if (o?.pack) l.pack = o.pack;
    }
    const ficha = await fichaProveedor(prov, t);
    const orden = await OrdenCompra.create({
      proveedor_id: ficha?.id || null, proveedor_nombre: ficha?.nombre || prov, venta_id: v.id, empresa: v.empresa,
      items: lineas, ...calcularTotales(lineas),
      notas: `Para venta ${v.numero}${v.cliente_nombre ? ` · ${v.cliente_nombre}` : ""}`, creado_por: firma(req),
    }, { transaction: t });
    await orden.update({ numero: `C-${String(orden.id).padStart(4, "0")}` }, { transaction: t });
    const cambios = { items, costo_total: require("../services/cuadroCompra").costoItems(items) };
    if (v.etapa === "registrada") Object.assign(cambios, { etapa: "aceptada", aceptada_fecha: new Date(), aceptada_por: firma(req) });
    await v.update(cambios, { transaction: t });
    return orden;
  });
}

// POST /api/ventas/:id/descartar-borradores   — anula las órdenes en borrador de la venta (las líneas vuelven a "por comprar")
const descartarBorradores = handler(async (req, res) => {
  const v = await Venta.findByPk(req.params.id);
  if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
  const borradores = await OrdenCompra.findAll({ where: { venta_id: v.id, estado: "borrador" } });
  for (const o of borradores) await o.update({ estado: "anulada", notas: [o.notas, `Descartada desde el cuadro de compra por ${firma(req)}`].filter(Boolean).join(" · ").slice(0, 1000) });
  res.json({ ok: true, data: { descartadas: borradores.map((o) => o.numero) } });
});

// GET /api/ventas/:id/pedido?proveedor=X&indices=1,2,3   — Excel para pedir precio o hacer el pedido (sin crear orden)
const pedidoExcel = handler(async (req, res) => {
  const v = await Venta.findByPk(req.params.id);
  if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
  const prov = normProv(req.query.proveedor || "");
  const indices = String(req.query.indices || "").split(",").filter((x) => x !== "").map(Number);
  const CC = require("../services/cuadroCompra");
  const items = v.items.map((i, k) => ({ ...i, k, cantidad: Number(i.cantidad) - CC.stockDe(i) })).filter((i) => i.cantidad > 0 && (indices.length ? indices.includes(i.k) : normProv(i.proveedor || "") === prov));
  if (!items.length) throw new ErrorNegocio("No hay productos para el pedido");
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Pedido");
  ws.columns = [{ width: 6 }, { width: 60 }, { width: 12 }, { width: 10 }];
  ws.addRow([`Pedido de materiales${prov ? ` · ${prov}` : ""}`]).font = { bold: true, size: 14 };
  ws.addRow([`${v.empresa === "tactics" ? "Tactics Inversiones" : "Inversiones Kenott"} · ${new Date().toLocaleDateString("es-CL")}`]);
  ws.addRow([]);
  const h = ws.addRow(["N°", "Producto", "Unidad", "Cantidad"]);
  h.font = { bold: true }; h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE7E7" } }; });
  items.forEach((i, n) => {
    ws.addRow([n + 1, descCliente(i), i.unidad || "", Number(i.cantidad)]);
  });
  const nombre = `Pedido_${prov || "materiales"}_${v.numero}.xlsx`.replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  await wb.xlsx.write(res); res.end();
});

const ESTADO_TXT = { por_comprar: "Por comprar", parcial: "Parcial", pedido: "Pedido", comprado: "Comprado" };
// Columna "Compra": la orden a la que pertenece la línea (por comprar = vacío, la casilla ☐ ya lo dice)
function textoCompra(estado, ordenes = []) {
  const n = (ordenes || []).filter(Boolean).join(", ");
  if (estado === "stock") return "stock";
  if (estado === "comprado") return `✓ ${n}`.trim();
  if (estado === "parcial") return `parcial${n ? ` · ${n}` : ""}`;
  if (estado === "pedido") return n || "pedido";
  return "";
}
const EMP_CORTA = { kenott: "Kenott", tactics: "Tactics" };
const libro = () => { const ExcelJS = require("exceljs"); return new ExcelJS.Workbook(); };
const encabezado = (ws, valores, anchos) => {
  ws.columns = anchos.map((width) => ({ width }));
  const h = ws.addRow(valores);
  h.font = { bold: true }; h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE7E7" } }; c.alignment = { wrapText: true, vertical: "middle" }; });
  return h;
};
const enviarLibro = async (res, wb, nombre) => {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${nombre.replace(/[^\w.-]+/g, "_")}"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  await wb.xlsx.write(res); res.end();
};
const nombreHoja = (wb, t) => { let n = String(t || "Hoja").replace(/[*?:\\/[\]]/g, " ").slice(0, 28).trim() || "Hoja"; let k = 2; const base = n; while (wb.getWorksheet(n)) n = `${base.slice(0, 25)} ${k++}`; return n; };

// GET /api/ventas/:id/cuadro-excel   — hoja "Por proveedor" (como la impresa) y "Detalle" (con las opciones de precio)
const cuadroExcel = handler(async (req, res) => {
  const venta = await Venta.findByPk(req.params.id);
  if (!venta) throw new ErrorNegocio("Venta no encontrada", 404);
  const d = await datosCuadro(venta);
  const wb = libro();
  const ws = wb.addWorksheet("Por proveedor");
  ws.addRow([`Cuadro de compra ${venta.numero} · ${venta.cliente_nombre || ""}`]).font = { bold: true, size: 13 };
  ws.addRow([[venta.orden_compra_cliente ? `OC ${venta.orden_compra_cliente}` : null, venta.id_solicitud ? `ID ${venta.id_solicitud}` : null, new Date().toLocaleDateString("es-CL")].filter(Boolean).join(" · ")]);
  ws.addRow([]);
  encabezado(ws, ["N°", "✓", "Producto", "Unidad", "Cantidad", "Compra unit.", "Total", "Compra"], [8, 5, 55, 10, 10, 14, 14, 14]);
  const grupos = new Map();
  for (const l of d.lineas) { if (!grupos.has(l.proveedor)) grupos.set(l.proveedor, []); grupos.get(l.proveedor).push(l); }
  for (const [prov, ls] of [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const r = ws.addRow(["", "", prov]); r.font = { bold: true }; r.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F5" } }; });
    const desde = r.number + 1;
    for (const l of ls) {
      const x = ws.addRow([l.codigo || "", l.estado === "stock" ? "✓" : "☐", l.nombre + (l.no_vino ? ` (no vino en ${l.no_vino.orden})` : ""), l.unidad || "", l.cantidad, l.compra_unit, null, textoCompra(l.estado, (l.compras || []).map((c) => c.numero))]);
      x.getCell(7).value = { formula: `E${x.number}*F${x.number}`, result: l.total_compra };
    }
    const sub = ws.addRow(["", "", `Subtotal ${prov}`, "", "", "", null]); sub.font = { bold: true };
    sub.getCell(7).value = { formula: `SUM(G${desde}:G${sub.number - 1})`, result: ls.reduce((s2, l) => s2 + l.total_compra, 0) };
  }
  ws.getColumn(6).numFmt = '"$"#,##0'; ws.getColumn(7).numFmt = '"$"#,##0';
  ws.pageSetup = { orientation: "landscape", paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  const det = wb.addWorksheet("Detalle");
  encabezado(det, ["N°", "Producto", "Unidad", "Cantidad", "Proveedor elegido", "Compra unit.", "Total", "Estado", "Opción 1", "Opción 2", "Opción 3", "Opción 4"], [8, 50, 10, 10, 20, 13, 13, 12, 24, 24, 24, 24]);
  for (const l of d.lineas) det.addRow([l.codigo || "", l.nombre, l.unidad || "", l.cantidad, l.proveedor, l.compra_unit, l.total_compra, ESTADO_TXT[l.estado] || l.estado,
    ...l.opciones.slice(0, 4).map((o) => `${o.proveedor} · $${Math.round(o.precio).toLocaleString("es-CL")}${o.fecha ? ` (${new Date(o.fecha).toLocaleDateString("es-CL")})` : ""}`)]);
  det.getColumn(6).numFmt = '"$"#,##0'; det.getColumn(7).numFmt = '"$"#,##0';
  det.pageSetup = { orientation: "landscape", paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  await enviarLibro(res, wb, `Cuadro_compra_${venta.numero}.xlsx`);
});

// GET /api/ventas/agrupar/datos   — lo que falta comprar y lo pedido sin recibir de las ventas en curso
const agruparDatos = handler(async (req, res) => {
  const ventas = await Venta.findAll({ where: { estado: { [Op.ne]: "anulada" }, etapa: ["registrada", "aceptada"] }, order: [["id", "ASC"]] });
  const out = [];
  for (const v of ventas) {
    const d = await datosCuadro(v);
    const pendientes = new Map(); // producto -> órdenes pedidas sin recibir
    for (const o of d.ordenes) if (o.estado !== "recibida") for (const it of o.items) { if (!pendientes.has(it.producto_id)) pendientes.set(it.producto_id, []); pendientes.get(it.producto_id).push(`${o.numero} (${o.proveedor_nombre})`); }
    const lineas = d.lineas.filter((l) => !["comprado", "stock"].includes(l.estado)).map((l) => ({
      indice: l.indice, producto_id: l.producto_id, codigo: l.codigo, nombre: l.nombre, unidad: l.unidad,
      cantidad: l.cantidad, falta: Math.max(0, l.cantidad - (l.stock || 0) - (l.recibido || 0) - (l.pedido || 0)), pedido: l.pedido || 0,
      estado: l.estado, proveedor: l.proveedor, compra_unit: l.compra_unit, opciones: l.opciones, no_vino: l.no_vino || null,
      ordenes: pendientes.get(l.producto_id) || [],
    }));
    if (lineas.length) out.push({ id: v.id, numero: v.numero, cliente: v.cliente_nombre, empresa: v.empresa, fecha: v.fecha, lineas });
  }
  res.json({ ok: true, data: { ventas: out, proveedores: (await Proveedor.findAll({ attributes: ["nombre"] })).map((p) => p.nombre).sort() } });
});

// Versión sencilla (blanco y negro, como la hoja del cuadro de compra): lo que ya tiene orden va bajo
// "Orden de compra C-00xx · proveedor" y lo que no, bajo "Solicitud de cotización". Solo material, unidad y cantidad.
async function solicitudSimple(req, res, { pedidas, ventas, proyectoDe, params }) {
  const CC = require("../services/cuadroCompra");
  const ordenes = await OrdenCompra.findAll({ where: { venta_id: ventas.map((v) => v.id), estado: { [Op.ne]: "anulada" } }, order: [["id", "ASC"]] });
  const ordenDe = (ventaId, pid) => {
    const suyas = ordenes.filter((o) => o.venta_id === ventaId && (o.items || []).some((i) => i.producto_id === pid));
    return suyas.find((o) => o.estado !== "recibida") || suyas[0] || null;
  };
  const empresas = new Set(ventas.map((v) => (v.empresa === "tactics" ? "tactics" : "kenott")));
  const secciones = new Map();
  const proyectos = [];
  for (const l of pedidas) {
    const v = ventas.find((x) => x.id === Number(l.venta_id));
    const it = v?.items?.[Number(l.indice)];
    if (!it) continue;
    const cant = Number(l.cantidad) > 0 ? Number(l.cantidad) : Number(it.cantidad) - CC.stockDe(it);
    if (cant <= 0) continue;
    // Si se juntan ventas de las dos empresas, la solicitud sale solo a nombre de Tactics
    const emp = datosEmpresa(empresas.size > 1 ? "tactics" : v.empresa === "tactics" ? "tactics" : "kenott", params);
    const o = ordenDe(v.id, it.producto_id);
    const pref = "";
    // Todos los materiales marcados van en la lista (también los que ya tienen orden: se puede pedir otra cotización
    // en cualquier momento); la orden queda anotada en la observación interna
    const titulo = `${pref}Solicitud de cotización`;
    const orden = 0;
    const k = `s|${emp.clave}`;
    if (!secciones.has(k)) secciones.set(k, { titulo, orden, lineas: new Map(), proyectos: [] });
    const sec = secciones.get(k);
    const proy = proyectoDe(v);
    if (!sec.proyectos.includes(proy)) sec.proyectos.push(proy);
    if (!proyectos.includes(proy)) proyectos.push(proy);
    const pk = `${it.producto_id || ""}|${descCliente(it)}`; // mismo producto con otra descripción del cliente: fila aparte
    const x = sec.lineas.get(pk) || { nombre: descCliente(it), unidad: it.unidad, cantidad: 0, detalle: new Map(), ordenes: new Set() };
    x.cantidad += cant; x.detalle.set(v.numero, (x.detalle.get(v.numero) || 0) + cant); // de qué venta es cada cantidad
    if (o) x.ordenes.add(o.numero); // solo el N° de la orden, sin proveedor
    sec.lineas.set(pk, x);
  }
  // Primero la solicitud de cotización, después las órdenes por número
  const lista = [...secciones.values()].sort((a, b) => (a.orden > 0) - (b.orden > 0) || a.orden - b.orden).map((sec) => ({
    titulo: sec.titulo, proyectos: sec.proyectos,
    lineas: [...sec.lineas.values()].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
      .map((x) => ({ nombre: x.nombre, unidad: x.unidad, cantidad: x.cantidad, obs: [ventas.length > 1 ? [...x.detalle.entries()].map(([vn, c]) => `${String(c).padStart(2, "0")} de ${vn}`).join(" · ") : "", x.ordenes.size ? `ya en ${[...x.ordenes].join(", ")}` : ""].filter(Boolean).join(" · ") })),
  }));
  // Solo se detallan los materiales por cotizar; lo que ya tiene orden va al final como referencia (solo la orden)
  const porCotizar = lista.filter((x) => !/Orden de compra/.test(x.titulo));
  const conOrden = lista.filter((x) => /Orden de compra/.test(x.titulo)).map((x) => ({ titulo: x.titulo, productos: x.lineas.length }));
  const titulo = "Solicitud de cotización";
  // Datos de facturación (esquina superior derecha)
  const facturacion = (empresas.size > 1 ? ["tactics"] : [...empresas]).map((e) => { const d = datosEmpresa(e, params); return [d.nombre, d.rut ? `RUT ${d.rut}` : "", d.giro ? `Giro: ${d.giro}` : "", d.direccion || "", [d.contacto, d.fono].filter(Boolean).join(" · "), d.email || ""].filter(Boolean); });
  const fecha = new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago" });
  const nombre = `Solicitud_cotizacion_${new Date().toISOString().slice(0, 10)}`;
  // Para imprimir directo: los datos, y la pantalla arma la hoja (se ajusta al papel de la impresora)
  if (req.body?.formato === "datos") return res.json({ ok: true, data: { titulo, fecha, proyectos, secciones: porCotizar, facturacion, conOrden } });
  if (req.body?.formato === "excel") {
    const wb = libro();
    const ws = wb.addWorksheet("Solicitud");
    ws.columns = [{ width: 6 }, { width: 60 }, { width: 12 }, { width: 11 }, { width: 40 }];
    ws.addRow([titulo]).font = { bold: true, size: 14 };
    ws.addRow([`Fecha: ${fecha}`]);
    ws.addRow([`${proyectos.length > 1 ? "Proyectos" : "Proyecto"}: ${proyectos.join(" · ")}`]);
    for (const f of facturacion) { ws.addRow([]); f.forEach((t, k) => { const r = ws.addRow(["", t]); if (!k) r.font = { bold: true }; }); }
    for (const sec of porCotizar) {
      ws.addRow([]);
      if (porCotizar.length > 1) ws.addRow([sec.titulo]).font = { bold: true, size: 12 };
      const h = ws.addRow(["N°", "Material", "Unidad", "Cantidad", "Observación interna"]);
      h.font = { bold: true }; h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6E6E6" } }; });
      sec.lineas.forEach((l, n) => { const r = ws.addRow([n + 1, l.nombre, l.unidad || "", l.cantidad, l.obs]); r.alignment = { wrapText: true, vertical: "top" }; });
    }
    if (!porCotizar.length) { ws.addRow([]); ws.addRow(["", "Todos los productos marcados ya tienen orden de compra."]); }
    if (conOrden.length) {
      ws.addRow([]);
      ws.addRow(["", "Ya tienen orden de compra (no se cotizan):"]).font = { bold: true };
      conOrden.forEach((o) => ws.addRow(["", `${o.titulo} · ${o.productos} producto(s)`]));
    }
    ws.pageSetup = { orientation: "portrait", paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    return enviarLibro(res, wb, `${nombre}.xlsx`);
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nombre}.pdf"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  require("../services/cotizacionFormato").pdfMaterialesSimple({ titulo, sub: `Fecha: ${fecha}`, proyectos, secciones: porCotizar, facturacion, conOrden }, res);
}

// POST /api/ventas/solicitud-cotizacion   { lineas: [{ venta_id, indice, cantidad? }] }
// PDF para pedir cotización a proveedores nuevos: materiales, unidad y cantidad; encabezado de la empresa de cada venta,
// nombre del proyecto (sin ID ni cliente). Mismo producto de varias ventas: se suma y la observación interna dice de cuál es.
const solicitudCotizacion = handler(async (req, res) => {
  const pedidas = Array.isArray(req.body?.lineas) ? req.body.lineas : [];
  if (!pedidas.length) throw new ErrorNegocio("Selecciona productos para la solicitud");
  const ventas = await Venta.findAll({ where: { id: [...new Set(pedidas.map((l) => Number(l.venta_id)))] } });
  const cots = await Cotizacion.findAll({ where: { id: ventas.map((v) => v.cotizacion_id).filter(Boolean) }, attributes: ["id", "nombre_cotizacion"] });
  const proyectoDe = (v) => {
    const c = cots.find((x) => x.id === v.cotizacion_id);
    const id = String(v.id_solicitud || "").trim();
    let n = String(c?.nombre_cotizacion || v.notas || "").trim();
    if (id) n = n.replace(new RegExp(`^\\s*(compra\\s+[áa]gil|licitaci[óo]n)?\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[–—-]?\\s*`, "i"), "").trim();
    return n || `Venta ${v.numero}`;
  };
  const CC = require("../services/cuadroCompra");
  const porEmpresa = new Map();
  for (const l of pedidas) {
    const v = ventas.find((x) => x.id === Number(l.venta_id));
    const it = v?.items?.[Number(l.indice)];
    if (!it) continue;
    const cant = Number(l.cantidad) > 0 ? Number(l.cantidad) : Number(it.cantidad) - CC.stockDe(it);
    if (cant <= 0) continue;
    const mixto = new Set(ventas.map((x) => x.empresa === "tactics" ? "tactics" : "kenott")).size > 1;
    const emp = mixto || v.empresa === "tactics" ? "tactics" : "kenott"; // mezcla de empresas: solo Tactics
    if (!porEmpresa.has(emp)) porEmpresa.set(emp, { proyectos: [], lineas: new Map() });
    const g = porEmpresa.get(emp);
    const proy = proyectoDe(v);
    if (!g.proyectos.includes(proy)) g.proyectos.push(proy);
    const k = `${it.producto_id || ""}|${descCliente(it)}`;
    const x = g.lineas.get(k) || { nombre: descCliente(it), unidad: it.unidad, cantidad: 0, detalle: new Map() };
    x.cantidad += cant; x.detalle.set(proy, (x.detalle.get(proy) || 0) + cant);
    g.lineas.set(k, x);
  }
  if (!porEmpresa.size) throw new ErrorNegocio("No hay productos por cotizar en lo seleccionado");
  const params = await getParametros();
  if (req.body?.estilo !== "formal") return solicitudSimple(req, res, { pedidas, ventas, proyectoDe, params });
  const grupos = [...porEmpresa.entries()].map(([emp, g]) => ({
    emp: datosEmpresa(emp, params), proyectos: g.proyectos,
    lineas: [...g.lineas.values()].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
      .map((x) => ({ nombre: x.nombre, unidad: x.unidad, cantidad: x.cantidad, obs: g.proyectos.length > 1 ? [...x.detalle.entries()].map(([p, c]) => `${p}: ${c}`).join(" · ") : "" })),
  }));
  if (req.body?.formato === "excel") {
    // Mismo contenido en Excel: una hoja por empresa
    const wb = libro();
    for (const g of grupos) {
      const ws = wb.addWorksheet(nombreHoja(wb, g.emp.corto || g.emp.nombre));
      ws.addRow([g.emp.nombre]).font = { bold: true, size: 14 };
      ws.addRow([`R.U.T.: ${g.emp.rut || ""}`]);
      if (g.emp.giro) ws.addRow([`Giro: ${g.emp.giro}`]);
      ws.addRow([[g.emp.contacto ? `Contacto: ${g.emp.contacto}` : "", g.emp.email || "", g.emp.fono || ""].filter(Boolean).join(" · ")]);
      ws.addRow([]);
      ws.addRow(["SOLICITUD DE COTIZACIÓN"]).font = { bold: true, size: 13 };
      ws.addRow([`${g.proyectos.length > 1 ? "Proyectos" : "Proyecto"}: ${g.proyectos.join(" · ")}`]).font = { bold: true };
      ws.addRow([`Fecha: ${new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago" })}`]);
      ws.addRow([]);
      const conObs = false; // formal: sin observación interna
      encabezado(ws, ["N°", "Material", "Unidad", "Cantidad", ...(conObs ? ["Observación interna"] : [])], [6, 60, 12, 11, ...(conObs ? [40] : [])]);
      g.lineas.forEach((l, k) => { const r = ws.addRow([k + 1, l.nombre, l.unidad || "", l.cantidad, ...(conObs ? [l.obs] : [])]); r.alignment = { wrapText: true, vertical: "top" }; });
      ws.pageSetup = { orientation: "portrait", paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    }
    return enviarLibro(res, wb, `Solicitud_cotizacion_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Solicitud_cotizacion_${new Date().toISOString().slice(0, 10)}.pdf"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  require("../services/cotizacionFormato").pdfSolicitud(grupos, res);
});

// POST /api/ventas/agrupar/excel   { orden: "proveedor"|"venta", lineas: [{ venta, cliente, codigo, nombre, unidad, cantidad, proveedor, precio, estado, ordenes }] }
const agruparExcel = handler(async (req, res) => {
  const porVenta = req.body?.orden === "venta";
  const lineas = Array.isArray(req.body?.lineas) ? req.body.lineas : [];
  if (!lineas.length) throw new ErrorNegocio("No hay productos para el Excel");
  const wb = libro();
  const variasEmpresas = new Set(lineas.map((l) => l.empresa || "kenott")).size > 1;
  const clave = (l) => (porVenta ? `${l.venta}${l.cliente ? ` · ${l.cliente}` : ""}${variasEmpresas ? ` · ${EMP_CORTA[l.empresa] || "Kenott"}` : ""}` : l.proveedor || "SIN PROVEEDOR");
  // Proveedor con ventas de las dos empresas: pedir una factura a cada una
  const avisoFacturas = (ls) => {
    if (porVenta || new Set(ls.map((l) => l.empresa || "kenott")).size < 2) return "";
    return `⚠ Pedir 2 facturas · ${["kenott", "tactics"].map((e) => `${EMP_CORTA[e]}: ${[...new Set(ls.filter((l) => (l.empresa || "kenott") === e).map((l) => l.venta))].join(", ")}`).join(" · ")}`;
  };
  const grupos = new Map();
  for (const l of lineas) { const k = clave(l); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(l); }
  const orden = [...grupos.entries()].map(([k, ls]) => ({ k, ls, total: ls.reduce((s2, l) => s2 + Number(l.precio || 0) * Number(l.cantidad || 0), 0) }))
    .sort((a, b) => (porVenta ? a.k.localeCompare(b.k) : b.total - a.total));
  const res0 = wb.addWorksheet("Resumen");
  res0.addRow([`Compras agrupadas por ${porVenta ? "venta" : "proveedor"} · ${new Date().toLocaleDateString("es-CL")}`]).font = { bold: true, size: 13 };
  res0.addRow([]);
  encabezado(res0, [porVenta ? "Venta" : "Proveedor", "Productos", "Total neto", porVenta ? "Proveedores" : "Ventas", "Aviso"], [40, 12, 16, 50, 50]);
  for (const g of orden) res0.addRow([g.k, g.ls.length, g.total, [...new Set(g.ls.map((l) => (porVenta ? l.proveedor : l.venta)))].join(", "), avisoFacturas(g.ls)]);
  res0.addRow(["Total", lineas.length, orden.reduce((s2, g) => s2 + g.total, 0)]).font = { bold: true };
  res0.getColumn(3).numFmt = '"$"#,##0';
  for (const g of orden) {
    const ws = wb.addWorksheet(nombreHoja(wb, g.k));
    ws.addRow([g.k]).font = { bold: true, size: 13 };
    const av = avisoFacturas(g.ls);
    const r2 = ws.addRow([av]); if (av) r2.font = { bold: true, color: { argb: "FFB8382C" } };
    let filas = g.ls;
    if (!porVenta) {
      // Mismo producto en varias ventas: una fila con la cantidad sumada y el detalle por venta
      const m = new Map();
      for (const l of g.ls) {
        const k = `${l.producto_id || ""}|${l.nombre}`;
        const x = m.get(k) || { ...l, cantidad: 0, detalle: [], estados: new Set(), ordenes: new Set() };
        x.cantidad += Number(l.cantidad || 0); x.detalle.push(`${l.venta}${av ? ` ${EMP_CORTA[l.empresa] || "Kenott"}` : ""}: ${l.cantidad}`); x.estados.add(l.estado); (l.ordenes || []).forEach((o) => x.ordenes.add(o));
        m.set(k, x);
      }
      filas = [...m.values()].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
      encabezado(ws, ["N°", "✓", "Producto", "Unidad", "Cantidad", "De qué ventas", "Precio unit.", "Total", "Compra"], [8, 5, 50, 10, 10, 34, 13, 14, 16]);
      for (const l of filas) {
        const r = ws.addRow([l.codigo || "", "☐", l.nombre, l.unidad || "", l.cantidad, l.detalle.join(" · "), Number(l.precio) || null, null,
          textoCompra([...l.estados][0], [...l.ordenes])]);
        r.getCell(8).value = { formula: `E${r.number}*G${r.number}`, result: Number(l.precio || 0) * l.cantidad };
      }
    } else {
      encabezado(ws, ["N°", "✓", "Producto", "Unidad", "Cantidad", "Proveedor", "Precio unit.", "Total", "Compra"], [8, 5, 50, 10, 10, 22, 13, 14, 16]);
      for (const l of [...filas].sort((a, b) => String(a.proveedor).localeCompare(String(b.proveedor)))) {
        const r = ws.addRow([l.codigo || "", "☐", l.nombre, l.unidad || "", Number(l.cantidad), l.proveedor, Number(l.precio) || null, null, textoCompra(l.estado, l.ordenes)]);
        r.getCell(8).value = { formula: `E${r.number}*G${r.number}`, result: Number(l.precio || 0) * Number(l.cantidad) };
      }
    }
    const t = ws.addRow(["", "", "Total", "", "", "", "", null]); t.font = { bold: true };
    t.getCell(8).value = { formula: `SUM(H4:H${t.number - 1})`, result: g.total };
    ws.getColumn(7).numFmt = '"$"#,##0'; ws.getColumn(8).numFmt = '"$"#,##0';
    ws.pageSetup = { orientation: "landscape", paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  }
  await enviarLibro(res, wb, `Compras_agrupadas_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

// POST /api/ventas/agrupar/ordenes   { lineas: [{ venta_id, indice, proveedor }] }
// Crea las órdenes (borrador) de los proveedores elegidos: una por venta y proveedor, para que cada compra siga cargada a su venta
const agruparOrdenes = handler(async (req, res) => {
  const lineas = Array.isArray(req.body?.lineas) ? req.body.lineas : [];
  const grupos = new Map();
  for (const l of lineas) {
    const prov = normProv(l.proveedor || "");
    if (!prov || prov === "SIN PROVEEDOR" || !Number(l.venta_id)) continue;
    const k = `${l.venta_id}|${prov}`;
    if (!grupos.has(k)) grupos.set(k, { venta_id: Number(l.venta_id), proveedor: prov, indices: [] });
    grupos.get(k).indices.push(Number(l.indice));
  }
  if (!grupos.size) throw new ErrorNegocio("Elige el proveedor de los productos para crear las órdenes");
  const creadas = [];
  for (const g of grupos.values()) {
    const o = await crearOrdenDe(g.venta_id, g.indices, g.proveedor, req);
    creadas.push({ numero: o.numero, proveedor: o.proveedor_nombre, venta_id: g.venta_id, lineas: g.indices.length, total: Number(o.total) });
  }
  res.status(201).json({ ok: true, data: { creadas } });
});

// POST /api/ventas/:id/stock   { indice, cantidad }  (cantidad 0 = deshacer)
// Parte o toda la línea se cubre con stock de bodega (comprado antes, va en gastos generales): no se compra y su costo es $0
const marcarStock = handler(async (req, res) => {
  const k = Number(req.body?.indice);
  const cantidad = Math.max(0, Number(req.body?.cantidad) || 0);
  await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta está anulada");
    const items = [...v.items];
    const i = items[k];
    if (!i) throw new ErrorNegocio("Línea no encontrada", 404);
    if (cantidad > Number(i.cantidad)) throw new ErrorNegocio(`La línea pide ${i.cantidad}: no puede salir más de stock`);
    const antes = Number(i.stock?.cantidad) || 0;
    if (cantidad > 0) items[k] = { ...i, stock: { cantidad, fecha: new Date().toISOString(), por: firma(req) } };
    else { const { stock, ...resto } = i; items[k] = resto; } // eslint-disable-line no-unused-vars
    await v.update({ items, costo_total: require("../services/cuadroCompra").costoItems(items) }, { transaction: t });
    await HistorialVenta.anotar(v, "paso", `${i.nombre}: ${cantidad ? `${cantidad} de ${i.cantidad} desde stock (costo $0, va en gastos generales)` : `ya no sale de stock (eran ${antes})`}`, req, t);
  });
  res.json({ ok: true });
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
    await v.update({ items, costo_total: require("../services/cuadroCompra").costoItems(items) }, { transaction: t });
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
      const ficha = await fichaProveedor(prov, t);
      const lineas = items.map((i) => ({
        producto_id: i.producto_id, codigo: i.codigo, nombre: i.nombre, descripcion_cliente: i.descripcion_cliente || null, unidad: i.unidad,
        cantidad: Number(i.cantidad), precio: Number(i.costo),
      }));
      const oc = await OrdenCompra.create({
        proveedor_id: ficha?.id || null, proveedor_nombre: ficha?.nombre || prov, venta_id: v.id, empresa: v.empresa,
        items: lineas, ...calcularTotales(lineas),
        notas: `Para venta ${v.numero}${v.cliente_nombre ? ` · ${v.cliente_nombre}` : ""}`,
        creado_por: firma(req),
      }, { transaction: t });
      await oc.update({ numero: `C-${String(oc.id).padStart(4, "0")}` }, { transaction: t });
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
// accion: texto (o función) que queda en el historial de la venta
const conVenta = (fn, accion, tipo = "paso") => handler(async (req, res) => {
  const venta = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta está anulada");
    await fn(v, req, t);
    if (accion) await HistorialVenta.anotar(v, tipo, typeof accion === "function" ? accion(v, req) : accion, req, t);
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
}, "Aceptó la venta");

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
}, "Confirmó productos listos");

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
}, (v) => `Despachó${v.guia_despacho ? ` · guía ${v.guia_despacho}` : ""}`);

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
}, (v) => `Marcó entregada${v.recibido_por ? ` · recibió ${v.recibido_por}` : ""}`);

// POST /api/ventas/:id/retroceder   (gerencia: deshace el último paso si se marcó por error)
const NOMBRE_ETAPA = { registrada: "Registrada", aceptada: "En compra", lista: "Productos listos", despachada: "Despachada", entregada: "Entregada" };
const retrocederEtapa = conVenta(async (v, req, t) => {
  const i = ETAPAS.indexOf(v.etapa);
  if (i <= 0) throw new ErrorNegocio("La venta ya está en la primera etapa");
  const motivo = String(req.body?.motivo || "").trim();
  if (!motivo) throw new ErrorNegocio("Indica el motivo para deshacer el paso");
  if (v.etapa === "lista" && Number(v.monto_facturado) > 0) throw new ErrorNegocio("La venta ya tiene factura: primero Comercial debe quitar la factura (con su motivo) para volver a En compra");
  if (v.etapa === "entregada" && Number(v.monto_pagado) > 0) throw new ErrorNegocio("La venta ya tiene cobros registrados: no se puede deshacer la entrega");
  const extra = v.etapa === "despachada" && v.guia_despacho ? ` (tenía guía ${v.guia_despacho} del ${v.despacho_fecha || "—"})` : v.etapa === "entregada" && v.recibido_por ? ` (recibió ${v.recibido_por})` : "";
  await HistorialVenta.anotar(v, "retroceso", `Deshizo "${NOMBRE_ETAPA[v.etapa]}" → vuelve a "${NOMBRE_ETAPA[ETAPAS[i - 1]]}"${extra}`, req, t, motivo);
  const limpiar = {
    aceptada: { aceptada_fecha: null, aceptada_por: null },
    lista: { lista_fecha: null, lista_por: null },
    despachada: { despacho_fecha: null, guia_despacho: null, despacho_por: null },
    entregada: { entrega_fecha: null, recibido_por: null },
  }[v.etapa];
  await v.update({ etapa: ETAPAS[i - 1], ...limpiar }, { transaction: t });
});

// Recalcula lo facturado de la venta y el resumen de N° de facturas
// Monto de una factura (con IVA). Si se escribió el NETO de lo que falta, se toma como el total con IVA
// (era la causa de ventas que quedaban "parcial" con la factura ya emitida).
const montoConIva = (valor, falta, v) => {
  if (valor === undefined || valor === "" || valor === null) return falta;
  const m = Math.round(Number(valor));
  const tasa = Number(v.subtotal) > 0 ? Number(v.total) / Number(v.subtotal) : 1.19;
  if (tasa > 1.001 && Math.abs(m - falta / tasa) <= 2) return falta;
  return m;
};

// POST /api/ventas/:id/facturas/cerrar  { abrir }  la factura cubre toda la venta aunque el monto no calce exacto
const cerrarFacturacion = conVenta(async (v, req, t) => {
  const abrir = !!req.body?.abrir;
  if (!abrir && !Number(v.monto_facturado)) throw new ErrorNegocio("Primero registra la factura");
  await v.update({ factura_cerrada: !abrir }, { transaction: t });
  await recalcularFacturas(v, t);
}, (v, req) => (req.body?.abrir ? "Reabrió la facturación" : `Dio por facturada (${Math.round(Number(v.monto_facturado)).toLocaleString("es-CL")} de ${Math.round(Number(v.total)).toLocaleString("es-CL")})`), "factura");

const recalcularFacturas = async (v, t) => {
  const facturas = await Factura.findAll({ where: { venta_id: v.id }, order: [["fecha", "ASC"], ["id", "ASC"]], transaction: t });
  const monto = facturas.reduce((s, f) => s + Number(f.monto), 0);
  const cerrada = !!facturas.length && !!v.factura_cerrada;
  const estado = !facturas.length ? "sin_factura" : monto >= Number(v.total) - 1 || cerrada ? "facturada" : "parcial";
  const cambios = { factura_cerrada: cerrada, monto_facturado: monto, estado_factura: estado, documento: facturas.map((f) => f.numero).join(", ").slice(0, 255) || null };
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
  const monto = montoConIva(req.body?.monto, falta, v);
  if (!(monto > 0)) throw new ErrorNegocio(falta <= 0 ? "La venta ya está facturada completa" : "Monto inválido");
  if (monto > falta + 1) throw new ErrorNegocio(`El monto supera lo que falta por facturar ($${falta.toLocaleString("es-CL")})`);
  await Factura.create({ venta_id: v.id, numero, fecha: req.body?.fecha || hoy(), monto, notas: req.body?.notas || null, creado_por: firma(req) }, { transaction: t });
  await recalcularFacturas(v, t);
}, (v, req) => `Registró factura ${String(req.body?.numero || "").trim()}`, "factura");

// DELETE /api/ventas/:id/facturas/:facturaId   (se ingresó por error)
const quitarFactura = conVenta(async (v, req, t) => {
  const motivo = String(req.body?.motivo || req.query?.motivo || "").trim();
  if (!motivo) throw new ErrorNegocio("Indica el motivo para quitar la factura");
  const f = await Factura.findOne({ where: { id: req.params.facturaId, venta_id: v.id }, transaction: t });
  if (!f) throw new ErrorNegocio("Factura no encontrada", 404);
  await HistorialVenta.anotar(v, "factura_quitada", `Quitó la factura ${f.numero} ($${Math.round(Number(f.monto)).toLocaleString("es-CL")})`, req, t, motivo);
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

// POST /api/ventas/:id/cambiar-producto  { indice, producto_id, precio?, cantidad?, motivo }
// El cliente cambió de opinión (ej. pernos 1/2 x 1 1/4 → 1/2 x 1 1/2): se cambia el producto de la línea de la venta,
// con el costo y proveedor del catálogo. La cotización queda como se envió (registro de lo ofertado).
// No se puede si esa línea ya tiene orden de compra: primero se anula o descarta la orden.
const cambiarProducto = handler(async (req, res) => {
  const b = req.body || {};
  const motivo = String(b.motivo || "").trim();
  if (!motivo) throw new ErrorNegocio("Indica por qué se cambia el producto (queda en el historial)");
  const r = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta está anulada");
    const items = [...v.items];
    const k = Number(b.indice);
    const i = items[k];
    if (!i) throw new ErrorNegocio("Línea no encontrada");
    const ordenes = await OrdenCompra.findAll({ where: { venta_id: v.id, estado: { [Op.ne]: "anulada" } }, transaction: t });
    const est = require("../services/cuadroCompra").estadoLineas(items, ordenes)[k];
    if (est && ["pedido", "parcial", "comprado"].includes(est.estado)) {
      throw new ErrorNegocio(`${i.nombre} ya está en ${est.compras.map((c) => c.numero).join(", ")}: anula o descarta esa orden antes de cambiar el producto`);
    }
    const p = await Producto.findByPk(b.producto_id, { transaction: t });
    if (!p) throw new ErrorNegocio("Elige el producto nuevo");
    const precio = b.precio != null && b.precio !== "" ? Math.round(Number(b.precio)) : Number(i.precio);
    const cantidad = b.cantidad != null && b.cantidad !== "" ? Number(b.cantidad) : Number(i.cantidad);
    if (!(precio >= 0) || !(cantidad > 0)) throw new ErrorNegocio("Revisa precio y cantidad");
    const { stock, ...resto } = i; void stock; // el stock marcado era del producto anterior
    items[k] = { ...resto, producto_id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad || i.unidad, precio, cantidad,
      costo: Math.round(Number(p.precio_compra) || 0), proveedor: p.proveedor ? normProv(p.proveedor) : SIN_PROVEEDOR,
      cambio: { antes: i.nombre, fecha: new Date().toISOString().slice(0, 10) } };
    const totales = calcularTotales(items);
    const subtotalAntes = Number(v.subtotal) || 0;
    await v.update({ items, ...totales, costo_total: require("../services/cuadroCompra").costoItems(items) }, { transaction: t });
    if (totales.subtotal !== subtotalAntes) await recalcularFacturas(v, t);
    const extra = [precio !== Number(i.precio) ? `precio ${Math.round(i.precio)} → ${precio}` : "", cantidad !== Number(i.cantidad) ? `cantidad ${i.cantidad} → ${cantidad}` : ""].filter(Boolean).join(", ");
    await HistorialVenta.anotar(v, "paso", `Cambió producto: ${i.nombre} → ${p.nombre}${extra ? ` (${extra})` : ""}`, req, t, motivo);
    return { linea: items[k], total_cambio: Math.round(totales.subtotal - subtotalAntes) };
  });
  res.json({ ok: true, data: r });
});

// POST /api/ventas/:id/linea-comprada   { indice, orden_id, item }  (cuadro de compra, Operativo y gerencia)
// Corrige una línea que quedó "por comprar" o "no vino" aunque se compró: la línea pasa al producto con que quedó
// registrado en la compra (ej. la factura conectó el guardapolvo con el junquillo). La descripción del cliente no cambia.
const lineaComprada = handler(async (req, res) => {
  const b = req.body || {};
  const r = await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    const items = [...v.items];
    const k = Number(b.indice);
    const i = items[k];
    if (!i) throw new ErrorNegocio("Línea no encontrada");
    const o = await OrdenCompra.findOne({ where: { id: Number(b.orden_id), venta_id: v.id, estado: { [Op.ne]: "anulada" } }, transaction: t });
    if (!o) throw new ErrorNegocio("Compra no encontrada en esta venta");
    const it = (o.items || [])[Number(b.item)];
    if (!it || !it.producto_id) throw new ErrorNegocio("Producto de la compra no encontrado");
    if (Number(it.producto_id) === Number(i.producto_id)) throw new ErrorNegocio("La línea ya tiene ese producto");
    const { stock, ...resto } = i; void stock;
    items[k] = { ...resto, producto_id: Number(it.producto_id), codigo: it.codigo ?? null, nombre: it.nombre, unidad: it.unidad || i.unidad,
      costo: Math.round(Number(it.precio) || 0), proveedor: o.proveedor_nombre || i.proveedor,
      cambio: { antes: i.nombre, fecha: new Date().toISOString().slice(0, 10), motivo: `Comprado en ${o.numero}` } };
    await v.update({ items, costo_total: require("../services/cuadroCompra").costoItems(items) }, { transaction: t });
    await HistorialVenta.anotar(v, "paso", `Línea conectada con lo comprado: ${i.descripcion_cliente || i.nombre} → ${it.nombre} (${o.numero})`, req, t, String(b.motivo || "").trim() || "Corrección: ya se compró");
    return { linea: items[k] };
  });
  res.json({ ok: true, data: r });
});

// POST /api/ventas/:id/respaldo  (multipart: archivo, tipo, folio, fecha)  — cedible o guía recepcionada, acta…
const subirRespaldo = handler(async (req, res) => {
  const { TIPOS_RESPALDO } = require("../services/respaldoVenta");
  const v = await Venta.findByPk(req.params.id, { attributes: ["id", "numero"] });
  if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
  if (!req.file) throw new ErrorNegocio("Adjunta el documento (foto o PDF)");
  const tipo = TIPOS_RESPALDO[req.body?.tipo] ? req.body.tipo : "otro_respaldo";
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.fecha || "") ? req.body.fecha : null;
  const d = await require("../models/DocumentoVenta").create({ venta_id: v.id, tipo, folio: String(req.body?.folio || "").trim().slice(0, 40) || null, fecha,
    nombre_archivo: String(req.file.originalname || "respaldo").slice(0, 200), mime: req.file.mimetype || "application/octet-stream", datos: req.file.buffer, creado_por: firma(req) });
  await HistorialVenta.anotar(v, "paso", `${TIPOS_RESPALDO[tipo]}${d.folio ? ` N° ${d.folio}` : ""} subida`, req, null);
  res.status(201).json({ ok: true, data: { id: d.id } });
});

// GET /api/ventas/:id/buscar-precio?indice=&q=   (cuadro de compra)
// Precios de hoy del producto de la línea (todos sus proveedores) y de productos parecidos del catálogo,
// por si el precio quedó cargado en otro producto (otra forma de escribirlo)
const buscarPrecio = handler(async (req, res) => {
  const venta = await Venta.findByPk(req.params.id);
  if (!venta) return res.status(404).json({ ok: false, error: "Venta no encontrada" });
  const linea = (venta.items || [])[Number(req.query.indice)];
  if (!linea) throw new ErrorNegocio("Línea no encontrada");
  const { opcionesPorProducto } = require("../services/cuadroCompra");
  const { buscarParecidos } = require("./productosController");
  const q = String(req.query.q || "").trim() || linea.nombre;
  const parecidos = await buscarParecidos(q, linea.producto_id, { minimo: req.query.q ? 0.4 : 0.3 });
  const ops = await opcionesPorProducto([linea.producto_id, ...parecidos.map((p) => p.id)]);
  res.json({ ok: true, data: {
    linea: { indice: Number(req.query.indice), nombre: linea.nombre, codigo: linea.codigo, unidad: linea.unidad, producto_id: linea.producto_id, proveedor: linea.proveedor, costo: Number(linea.costo) || 0 },
    q, propios: ops.get(linea.producto_id) || [],
    parecidos: parecidos.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, parecido: p.parecido, opciones: ops.get(p.id) || [] })).filter((p) => p.opciones.length).slice(0, 15),
  } });
});

// POST /api/ventas/:id/precio-linea  { indice, proveedor, precio, desde_producto_id, guardar }
// Usa ese proveedor y precio en la línea. Con "guardar", el precio queda también en el catálogo para el producto
// de la línea (con la misma fecha), así la próxima vez sale solo.
const precioLinea = handler(async (req, res) => {
  const b = req.body || {};
  const prov = normProv(b.proveedor || ""); const precio = Math.round(Number(b.precio) || 0);
  if (!prov || !(precio > 0)) throw new ErrorNegocio("Falta el proveedor o el precio");
  const PrecioProveedor = require("../models/PrecioProveedor");
  const { origenDe, recalcular, registrar } = require("../services/precios");
  await sequelize.transaction(async (t) => {
    const v = await Venta.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!v) throw new ErrorNegocio("Venta no encontrada", 404);
    if (v.estado === "anulada") throw new ErrorNegocio("La venta está anulada");
    const items = [...v.items];
    const i = items[Number(b.indice)];
    if (!i) throw new ErrorNegocio("Línea no encontrada");
    items[Number(b.indice)] = { ...i, proveedor: prov, costo: precio };
    await v.update({ items, costo_total: require("../services/cuadroCompra").costoItems(items) }, { transaction: t });
    if (b.guardar && i.producto_id && Number(b.desde_producto_id) !== Number(i.producto_id)) {
      const PrecioOrigen = b.desde_producto_id ? await PrecioProveedor.findOne({ where: { producto_id: b.desde_producto_id, proveedor: prov, descartado: false }, order: [["fecha", "DESC"], ["id", "DESC"]], transaction: t }) : null;
      const desde = b.desde_producto_id ? await Producto.findByPk(b.desde_producto_id, { transaction: t }) : null;
      await PrecioProveedor.create({
        producto_id: i.producto_id, proveedor: prov, precio, fecha: PrecioOrigen?.fecha || new Date(), documento: PrecioOrigen?.documento || null,
        descripcion_proveedor: desde ? `Mismo precio que N° ${desde.codigo ?? desde.id} ${desde.nombre}`.slice(0, 250) : null,
        origen: await origenDe(prov, t), creado_por: firma(req),
      }, { transaction: t });
      const p = await Producto.findByPk(i.producto_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (p) await recalcular(p, { t, usuario: firma(req), motivo: `Cuadro de compra ${v.numero}: precio de ${prov}${desde ? ` copiado de N° ${desde.codigo ?? desde.id}` : ""}` });
      await registrar({ usuario: firma(req), tabla: "productos", registro_id: i.producto_id, campo: "precio_proveedor", despues: `${prov} ${precio}`, motivo: `Desde cuadro de compra ${v.numero}` }, t);
    }
  });
  res.json({ ok: true, data: { indice: Number(b.indice), proveedor: prov, costo: precio } });
});

// GET /api/ventas/:id/interna-simple  (solo quien ve costos) — para imprimir desde la venta:
// producto cotizado, caso, venta, compra, 3 mejores proveedores del catálogo de hoy y utilidad
const internaSimple = handler(async (req, res) => {
  if (!veCostos(req)) return res.status(403).json({ ok: false, error: "Sin acceso a costos" });
  const venta = await Venta.findByPk(req.params.id);
  if (!venta) return res.status(404).json({ ok: false, error: "Venta no encontrada" });
  // Lo que pidió el cliente y el caso vienen de la cotización (la venta guarda el producto nuestro)
  const cot = venta.cotizacion_id ? await Cotizacion.findByPk(venta.cotizacion_id) : null;
  const deCot = new Map();
  for (const i of cot?.items || []) { const k = i.clave || i.producto_id; if (!deCot.has(k)) deCot.set(k, []); deCot.get(k).push(i); }
  const items = (venta.items || []).map((i) => {
    const c = (deCot.get(i.clave || i.producto_id) || deCot.get(i.producto_id) || []).shift();
    return { ...i, descripcion_cliente: i.descripcion_cliente || c?.descripcion_cliente, caso: i.caso || c?.caso };
  });
  const { opcionesInterna } = require("../services/cuadroCompra");
  const { filasInternaSimple } = require("../services/cotizacionFormato");
  const r = filasInternaSimple(items, await opcionesInterna(items));
  res.json({ ok: true, data: { venta: { numero: venta.numero, cliente: venta.cliente_nombre, empresa: venta.empresa, id_solicitud: venta.id_solicitud, orden_compra_cliente: venta.orden_compra_cliente }, ...r } });
});

module.exports = {
  internaSimple, buscarPrecio, precioLinea, cambiarProducto,
  resumenAnulacion,
  aceptarVenta, confirmarVenta, despacharVenta, entregarVenta, retrocederEtapa, agregarFactura, quitarFactura, listarFacturas, recalcularFacturas, montoConIva, cerrarFacturacion,
  verVenta, SIN_PROVEEDOR,
  getVentas, getVenta, crearVenta, ventaDesdeCotizacion, anularVenta, registrarCobro, actualizarDatos,
  getCuadroCompra, marcarStock, lineaComprada, subirRespaldo, solicitudCotizacion, cuadroExcel, agruparDatos, agruparExcel, agruparOrdenes, cambiarProveedorLinea, generarOrdenes, asignarProveedores, crearOrdenVenta, descartarBorradores, pedidoExcel,
};
