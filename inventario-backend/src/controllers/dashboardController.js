const { Op, fn, col, literal } = require("sequelize");
const sequelize = require("../../config/database");
const Venta = require("../models/Venta");
const OrdenCompra = require("../models/OrdenCompra");
const Producto = require("../models/Producto");
const Cotizacion = require("../models/Cotizacion");
const Pago = require("../models/Pago");
const Gasto = require("../models/Gasto");
const { handler } = require("../services/erp");
const { esAdmin } = require("../middlewares/auth");
const { SQL_AVISO } = require("../services/precios");

const n = (v) => Math.round(Number(v) || 0);
const ymd = (d) => d.toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const claveMes = (fecha) => String(fecha).slice(0, 7); // "2026-10"

// GET /api/dashboard?meses=6
const getDashboard = handler(async (req, res) => {
  const meses = Math.min(Math.max(Number(req.query.meses) || 6, 1), 24);
  const hoy = new Date();
  const inicioMes = ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const inicioSerie = ymd(new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1));
  const hoyStr = ymd(hoy);

  await Cotizacion.update({ estado: "vencida", motivo_estado: "Venció su validez" }, { where: { estado: "cotizacion", fecha_validez: { [Op.lt]: hoyStr } } });

  const [ventasPeriodo, comprasPeriodo, gastosPeriodo, cotizaciones, pagosMes, porCobrar, porPagar, ventasActivas, ocsVenta, catalogo] = await Promise.all([
    Venta.findAll({ where: { estado: "emitida", fecha: { [Op.gte]: inicioSerie } }, order: [["fecha", "DESC"], ["id", "DESC"]] }),
    OrdenCompra.findAll({ where: { estado: "recibida", fecha_recepcion: { [Op.gte]: inicioSerie } }, attributes: ["fecha_recepcion", "subtotal"] }),
    Gasto.findAll({ where: { fecha: { [Op.gte]: inicioSerie } }, attributes: ["fecha", "monto", "tipo"] }),
    Cotizacion.findAll({ attributes: ["estado", "total", "subtotal", "createdAt"] }),
    Pago.findAll({ where: { fecha: { [Op.gte]: inicioMes } }, attributes: ["tipo", [fn("SUM", col("monto")), "total"]], group: ["tipo"], raw: true }),
    Venta.findAll({
      where: { estado: "emitida", estado_pago: { [Op.ne]: "pagada" } },
      attributes: ["id", "numero", "cliente_nombre", "fecha", "fecha_vencimiento", "total", "monto_pagado"],
      order: [[literal("fecha_vencimiento IS NULL"), "ASC"], ["fecha_vencimiento", "ASC"]],
    }),
    OrdenCompra.findAll({
      where: { estado: "recibida", estado_pago: { [Op.ne]: "pagada" } },
      attributes: ["id", "numero", "proveedor_nombre", "fecha_vencimiento", "total", "monto_pagado"],
    }),
    Venta.findAll({ where: { estado: "emitida" }, attributes: ["id", "numero", "cliente_nombre", "fecha", "subtotal"], order: [["id", "DESC"]], limit: 300 }),
    OrdenCompra.findAll({ where: { venta_id: { [Op.ne]: null }, estado: { [Op.ne]: "anulada" } }, attributes: ["venta_id"], raw: true }),
    sequelize.query(`SELECT COUNT(*)::int AS productos,
        COUNT(*) FILTER (WHERE precio_compra IS NULL OR precio_compra <= 0)::int AS sin_precio,
        COUNT(*) FILTER (WHERE ${SQL_AVISO})::int AS con_aviso,
        COUNT(*) FILTER (WHERE confirmado)::int AS confirmados
      FROM productos WHERE activo`, { plain: true }),
  ]);

  // --- Serie mensual: ventas, costo, margen, gastos, utilidad y compras ---
  const serie = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    serie.push({ mes: ymd(d).slice(0, 7), ventas: 0, costo: 0, margen: 0, gastos: 0, utilidad: 0, compras: 0, cantidad: 0 });
  }
  const idx = new Map(serie.map((s, i) => [s.mes, i]));
  for (const v of ventasPeriodo) {
    const s = serie[idx.get(claveMes(v.fecha))];
    if (!s) continue;
    s.ventas += Number(v.subtotal);
    s.costo += Number(v.costo_total);
    s.cantidad += 1;
  }
  for (const oc of comprasPeriodo) {
    const s = serie[idx.get(ymd(new Date(oc.fecha_recepcion)).slice(0, 7))];
    if (s) s.compras += Number(oc.subtotal);
  }
  for (const g of gastosPeriodo) {
    const s = serie[idx.get(claveMes(g.fecha))];
    if (s) s.gastos += Number(g.monto);
  }
  serie.forEach((s) => {
    s.margen = s.ventas - s.costo;
    s.utilidad = s.margen - s.gastos;
    ["ventas", "costo", "margen", "gastos", "utilidad", "compras"].forEach((k) => (s[k] = n(s[k])));
  });
  const mesActual = serie[serie.length - 1];

  // --- Top productos del período (por venta neta) ---
  const top = new Map();
  for (const v of ventasPeriodo) {
    for (const it of v.items) {
      const t = top.get(it.producto_id) || { producto_id: it.producto_id, nombre: it.nombre, cantidad: 0, venta: 0, margen: 0 };
      t.cantidad += Number(it.cantidad);
      t.venta += Number(it.precio) * Number(it.cantidad);
      t.margen += (Number(it.precio) - Number(it.costo || 0)) * Number(it.cantidad);
      top.set(it.producto_id, t);
    }
  }
  const topProductos = [...top.values()]
    .sort((a, b) => b.venta - a.venta).slice(0, 8)
    .map((t) => ({ ...t, venta: n(t.venta), margen: n(t.margen) }));

  // --- Cuentas por cobrar / pagar ---
  const saldo = (d) => Number(d.total) - Number(d.monto_pagado);
  const vencida = (d) => d.fecha_vencimiento && d.fecha_vencimiento < hoyStr;
  const cxc = {
    total: n(porCobrar.reduce((s, v) => s + saldo(v), 0)),
    vencido: n(porCobrar.filter(vencida).reduce((s, v) => s + saldo(v), 0)),
    documentos: porCobrar.length,
    detalle: porCobrar.slice(0, 10).map((v) => ({
      id: v.id, numero: v.numero, nombre: v.cliente_nombre, vence: v.fecha_vencimiento, saldo: n(saldo(v)), vencida: !!vencida(v),
    })),
  };
  const cxp = {
    total: n(porPagar.reduce((s, o) => s + saldo(o), 0)),
    vencido: n(porPagar.filter(vencida).reduce((s, o) => s + saldo(o), 0)),
    documentos: porPagar.length,
  };

  // --- Ventas confirmadas que aún no tienen órdenes de compra ---
  const conOC = new Set(ocsVenta.map((o) => o.venta_id));
  const porComprar = ventasActivas.filter((v) => !conOC.has(v.id));

  // --- Caja del mes ---
  const sumaTipo = (tipo) => n(pagosMes.find((p) => p.tipo === tipo)?.total);
  const caja = { cobros: sumaTipo("cobro"), pagos: sumaTipo("pago") };
  caja.neto = caja.cobros - caja.pagos;

  // --- Cotizaciones del período: emitidas, ganadas, perdidas, vencidas ---
  const delPeriodo = cotizaciones.filter((c) => ymd(new Date(c.createdAt)) >= inicioSerie && c.estado !== "borrador");
  const por = (e) => delPeriodo.filter((c) => c.estado === e);
  const monto = (l) => n(l.reduce((s, c) => s + Number(c.subtotal), 0));
  const abiertas = cotizaciones.filter((c) => c.estado === "cotizacion");
  const ganadas = por("aceptada").length;
  const cerradas = ganadas + por("rechazada").length + por("vencida").length;
  const cotizacionesKpi = {
    emitidas: delPeriodo.length, monto_emitido: monto(delPeriodo),
    ganadas, monto_ganado: monto(por("aceptada")),
    rechazadas: por("rechazada").length, monto_rechazado: monto(por("rechazada")),
    vencidas: por("vencida").length, monto_vencido: monto(por("vencida")),
    conversion: cerradas ? Math.round((ganadas / cerradas) * 100) : 0,
    abiertas: abiertas.length, monto_abierto: monto(abiertas),
    borradores: cotizaciones.filter((c) => c.estado === "borrador").length,
  };

  const data = {
    generado: new Date().toISOString(),
    mes_actual: {
      mes: mesActual.mes,
      ventas: mesActual.ventas,
      margen: mesActual.margen,
      margen_pct: mesActual.ventas ? Math.round((mesActual.margen / mesActual.ventas) * 100) : 0,
      gastos: mesActual.gastos,
      utilidad: mesActual.utilidad,
      cantidad: mesActual.cantidad,
      ticket_promedio: mesActual.cantidad ? n(mesActual.ventas / mesActual.cantidad) : 0,
      compras: mesActual.compras,
    },
    serie,
    top_productos: topProductos,
    catalogo,
    por_comprar: { cantidad: porComprar.length, detalle: porComprar.slice(0, 10).map((v) => ({ id: v.id, numero: v.numero, cliente: v.cliente_nombre, fecha: v.fecha, neto: n(v.subtotal) })) },
    cuentas_por_cobrar: cxc,
    cuentas_por_pagar: cxp,
    caja,
    cotizaciones: cotizacionesKpi,
    ultimas_ventas: ventasPeriodo.slice(0, 5).map((v) => ({
      id: v.id, numero: v.numero, cliente: v.cliente_nombre, fecha: v.fecha, total: n(v.total), estado_pago: v.estado_pago,
    })),
  };

  // Rol "usuario": sin costos, márgenes, gastos, compras, caja ni cuentas por pagar
  if (!esAdmin(req)) {
    ["margen", "margen_pct", "gastos", "utilidad", "compras"].forEach((k) => delete data.mes_actual[k]);
    data.serie = data.serie.map(({ mes, ventas, cantidad }) => ({ mes, ventas, cantidad }));
    data.top_productos = data.top_productos.map(({ margen, ...resto }) => resto);
    delete data.cuentas_por_pagar;
    delete data.caja;
    delete data.por_comprar;
    data.limitado = true;
  }
  res.json({ ok: true, data });
});

// GET /api/dashboard/reportes?desde=2026-01-01&hasta=2026-12-31   (solo admin)
// Utilidad por cliente y por proveedor, ahorro frente a la opción 2 y diferencia cotizado vs. pagado.
const getReportes = handler(async (req, res) => {
  const hoy = new Date();
  const desde = req.query.desde || ymd(new Date(hoy.getFullYear(), 0, 1));
  const hasta = req.query.hasta || ymd(hoy);
  const ventas = await Venta.findAll({ where: { estado: "emitida", fecha: { [Op.between]: [desde, hasta] } } });
  const ventaIds = ventas.map((v) => v.id);
  const [gastos, ordenes, productos] = await Promise.all([
    Gasto.findAll({ where: { fecha: { [Op.between]: [desde, hasta] } } }),
    ventaIds.length ? OrdenCompra.findAll({ where: { venta_id: ventaIds, estado: "recibida" } }) : [],
    Producto.findAll({ attributes: ["id", "opcion2_proveedor", "opcion2_precio"] }),
  ]);
  const prod = new Map(productos.map((p) => [p.id, p]));

  // Gastos asociados a cada venta
  const gastoVenta = new Map();
  let gastosGenerales = 0;
  for (const g of gastos) {
    if (g.venta_id) gastoVenta.set(g.venta_id, (gastoVenta.get(g.venta_id) || 0) + Number(g.monto));
    else gastosGenerales += Number(g.monto);
  }

  const porCliente = new Map();
  const porProveedor = new Map();
  for (const v of ventas) {
    const k = v.cliente_nombre || "Sin cliente";
    const c = porCliente.get(k) || { cliente: k, ventas: 0, neto: 0, margen: 0, gastos: 0 };
    c.ventas += 1;
    c.neto += Number(v.subtotal);
    c.margen += Number(v.subtotal) - Number(v.costo_total);
    c.gastos += gastoVenta.get(v.id) || 0;
    porCliente.set(k, c);
    for (const i of v.items) {
      const pk = i.proveedor || "SIN PROVEEDOR";
      const p = porProveedor.get(pk) || { proveedor: pk, compra: 0, venta: 0, margen: 0, ahorro_vs_opcion2: 0 };
      const compra = Number(i.costo) * Number(i.cantidad);
      p.compra += compra;
      p.venta += Number(i.precio) * Number(i.cantidad);
      p.margen += Number(i.precio) * Number(i.cantidad) - compra;
      const op2 = prod.get(i.producto_id);
      if (op2?.opcion2_precio && op2.opcion2_proveedor !== i.proveedor) p.ahorro_vs_opcion2 += (Number(op2.opcion2_precio) - Number(i.costo)) * Number(i.cantidad);
      porProveedor.set(pk, p);
    }
  }

  // Cotizado (costo copiado en la venta) vs. pagado real (orden de compra recibida)
  const diferencias = [];
  const ventaMap = new Map(ventas.map((v) => [v.id, v]));
  for (const oc of ordenes) {
    const v = ventaMap.get(oc.venta_id);
    for (const it of oc.items) {
      const vi = v?.items.find((x) => x.producto_id === it.producto_id);
      if (!vi) continue;
      const dif = Number(it.precio) - Number(vi.costo);
      if (Math.abs(dif) >= 1) {
        diferencias.push({ venta: v.numero, orden: oc.numero, proveedor: oc.proveedor_nombre, producto: it.nombre, cotizado: n(vi.costo), pagado: n(it.precio), diferencia: n(dif), cantidad: Number(it.cantidad) });
      }
    }
  }

  const redondearObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" && k !== "ventas" ? n(v) : v]));
  res.json({
    ok: true,
    data: {
      desde, hasta,
      totales: {
        ventas: ventas.length,
        neto: n(ventas.reduce((s, v) => s + Number(v.subtotal), 0)),
        margen: n(ventas.reduce((s, v) => s + Number(v.subtotal) - Number(v.costo_total), 0)),
        gastos_ventas: n([...gastoVenta.values()].reduce((s, x) => s + x, 0)),
        gastos_generales: n(gastosGenerales),
      },
      por_cliente: [...porCliente.values()].map((c) => redondearObj({ ...c, utilidad: c.margen - c.gastos })).sort((a, b) => b.neto - a.neto),
      por_proveedor: [...porProveedor.values()].map(redondearObj).sort((a, b) => b.compra - a.compra),
      diferencias: diferencias.sort((a, b) => Math.abs(b.diferencia * b.cantidad) - Math.abs(a.diferencia * a.cantidad)).slice(0, 100),
    },
  });
});

module.exports = { getDashboard, getReportes };
