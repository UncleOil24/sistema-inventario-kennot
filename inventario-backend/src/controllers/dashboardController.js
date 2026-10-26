const { Op, fn, col, literal } = require("sequelize");
const Venta = require("../models/Venta");
const OrdenCompra = require("../models/OrdenCompra");
const Producto = require("../models/Producto");
const Cotizacion = require("../models/Cotizacion");
const Pago = require("../models/Pago");
const { handler } = require("../services/erp");

const n = (v) => Math.round(Number(v) || 0);
const ymd = (d) => d.toISOString().slice(0, 10);
const claveMes = (fecha) => String(fecha).slice(0, 7); // "2026-10"

// GET /api/dashboard?meses=6
const getDashboard = handler(async (req, res) => {
  const meses = Math.min(Math.max(Number(req.query.meses) || 6, 1), 24);
  const hoy = new Date();
  const inicioMes = ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const inicioSerie = ymd(new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1));
  const hoyStr = ymd(hoy);

  const [ventasPeriodo, comprasPeriodo, productos, cotizaciones, pagosMes, porCobrar, porPagar] = await Promise.all([
    Venta.findAll({ where: { estado: "emitida", fecha: { [Op.gte]: inicioSerie } }, order: [["fecha", "DESC"], ["id", "DESC"]] }),
    OrdenCompra.findAll({ where: { estado: "recibida", fecha_recepcion: { [Op.gte]: inicioSerie } }, attributes: ["fecha_recepcion", "subtotal"] }),
    Producto.findAll({ attributes: ["id", "nombre", "stock", "stock_minimo", "precio_compra", "precio_venta", "unidad", "proveedor"] }),
    Cotizacion.findAll({ where: { createdAt: { [Op.gte]: inicioSerie } }, attributes: ["estado", "total"] }),
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
  ]);

  // --- Serie mensual: ventas netas, costo, margen y compras ---
  const serie = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    serie.push({ mes: ymd(d).slice(0, 7), ventas: 0, costo: 0, margen: 0, compras: 0, cantidad: 0 });
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
  serie.forEach((s) => {
    s.margen = s.ventas - s.costo;
    ["ventas", "costo", "margen", "compras"].forEach((k) => (s[k] = n(s[k])));
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

  // --- Inventario ---
  const stockCritico = productos
    .filter((p) => Number(p.stock) <= Number(p.stock_minimo))
    .sort((a, b) => Number(a.stock) - Number(b.stock))
    .map((p) => ({ id: p.id, nombre: p.nombre, stock: p.stock, stock_minimo: p.stock_minimo, unidad: p.unidad, proveedor: p.proveedor }));
  const inventario = {
    productos: productos.length,
    valor_costo: n(productos.reduce((s, p) => s + Number(p.stock) * Number(p.precio_compra || 0), 0)),
    valor_venta: n(productos.reduce((s, p) => s + Number(p.stock) * Number(p.precio_venta || 0), 0)),
    criticos: stockCritico.length,
  };

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

  // --- Caja del mes y cotizaciones ---
  const sumaTipo = (tipo) => n(pagosMes.find((p) => p.tipo === tipo)?.total);
  const caja = { cobros: sumaTipo("cobro"), pagos: sumaTipo("pago") };
  caja.neto = caja.cobros - caja.pagos;

  const cotTotal = cotizaciones.length;
  const cotVendidas = cotizaciones.filter((c) => c.estado === "vendida").length;
  const cotPend = cotizaciones.filter((c) => c.estado !== "vendida");
  const cotizacionesKpi = {
    total: cotTotal,
    vendidas: cotVendidas,
    conversion: cotTotal ? Math.round((cotVendidas / cotTotal) * 100) : 0,
    pendientes: cotPend.length,
    monto_pendiente: n(cotPend.reduce((s, c) => s + Number(c.total), 0)),
  };

  res.json({
    ok: true,
    data: {
      generado: new Date().toISOString(),
      mes_actual: {
        mes: mesActual.mes,
        ventas: mesActual.ventas,
        margen: mesActual.margen,
        margen_pct: mesActual.ventas ? Math.round((mesActual.margen / mesActual.ventas) * 100) : 0,
        cantidad: mesActual.cantidad,
        ticket_promedio: mesActual.cantidad ? n(mesActual.ventas / mesActual.cantidad) : 0,
        compras: mesActual.compras,
      },
      serie,
      top_productos: topProductos,
      inventario,
      stock_critico: stockCritico.slice(0, 15),
      cuentas_por_cobrar: cxc,
      cuentas_por_pagar: cxp,
      caja,
      cotizaciones: cotizacionesKpi,
      ultimas_ventas: ventasPeriodo.slice(0, 5).map((v) => ({
        id: v.id, numero: v.numero, cliente: v.cliente_nombre, fecha: v.fecha, total: n(v.total), estado_pago: v.estado_pago,
      })),
    },
  });
});

module.exports = { getDashboard };
