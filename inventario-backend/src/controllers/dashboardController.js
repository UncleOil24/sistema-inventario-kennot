const { Op, fn, col, literal } = require("sequelize");
const sequelize = require("../../config/database");
const Venta = require("../models/Venta");
const OrdenCompra = require("../models/OrdenCompra");
const Producto = require("../models/Producto");
const Cotizacion = require("../models/Cotizacion");
const Pago = require("../models/Pago");
const Gasto = require("../models/Gasto");
const { handler } = require("../services/erp");
const { calcularCobranza, suspenderMorosos } = require("../services/cobranza");
const { esAdmin, tieneRol } = require("../middlewares/auth");
const { SQL_AVISO } = require("../services/precios");
const { getParametros } = require("../services/parametros");
const { wherePorSeguir } = require("./cotizacionesController");
const Licitacion = require("../models/Licitacion");
const { visible, fichaUrl, aplicarRelevanciaMinima } = require("../services/mercadoPublico");

const n = (v) => Math.round(Number(v) || 0);
const ymd = (d) => d.toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const claveMes = (fecha) => (fecha instanceof Date ? ymd(fecha) : String(fecha)).slice(0, 7); // "2026-10"
// Primer día del mes, "delta" meses antes/después del mes actual EN CHILE ("2026-10-01").
// Ojo: el servidor (Render) corre en UTC; con new Date(año, mes, 1) el 1 de octubre se convertía al 30 de septiembre.
const primerDiaMes = (delta = 0) => {
  const [y, m] = ymd(new Date()).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
};

// GET /api/dashboard?meses=6
const getDashboard = handler(async (req, res) => {
  const meses = Math.min(Math.max(Number(req.query.meses) || 6, 1), 24);
  const hoy = new Date();
  const inicioMes = primerDiaMes(0);
  const inicioSerie = primerDiaMes(-(meses - 1));
  const hoyStr = ymd(hoy);

  await Cotizacion.update({ estado: "vencida", motivo_estado: "Venció su validez" }, { where: { estado: "cotizacion", fecha_validez: { [Op.lt]: hoyStr } } });
  const params = await getParametros();
  await aplicarRelevanciaMinima(params).catch((e) => console.error("relevancia mínima:", e.message));
  const limAntiguo = new Date(); limAntiguo.setMonth(limAntiguo.getMonth() - (Number(params.meses_precio_antiguo) || 6));
  const licNuevas = (await Licitacion.findAll({
    where: { estado_interno: "nueva", [Op.or]: [{ fecha_cierre: null }, { fecha_cierre: { [Op.gte]: new Date() } }] },
    order: [["prioridad", "DESC"], ["fecha_cierre", "ASC"]],
    attributes: ["codigo", "nombre", "organismo", "unidad", "comuna", "region", "fecha_cierre", "monto_estimado", "items", "createdAt", "fuente", "prioridad", "relevancia", "motivo_relevancia"],
  })).filter((l) => visible(l, params));
  const porSeguir = await Cotizacion.findAll({ where: await wherePorSeguir(), order: [["fecha", "ASC"]], limit: 50,
    attributes: ["id", "numero", "cliente", "nombre_cotizacion", "fecha", "fecha_validez", "ultimo_contacto", "proximo_contacto", "subtotal"] });

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
    Venta.findAll({ where: { estado: "emitida", etapa: { [Op.ne]: "entregada" } }, attributes: ["id", "numero", "cliente_nombre", "fecha", "subtotal", "total", "etapa", "estado_factura", "monto_facturado", "orden_compra_cliente", "despacho_fecha", "lista_fecha"], order: [["id", "ASC"]], limit: 500 }),
    OrdenCompra.findAll({ where: { venta_id: { [Op.ne]: null }, estado: { [Op.ne]: "anulada" } }, attributes: ["venta_id", "estado"], raw: true }),
    sequelize.query(`SELECT COUNT(*)::int AS productos,
        COUNT(*) FILTER (WHERE precio_compra IS NULL OR precio_compra <= 0)::int AS sin_precio,
        COUNT(*) FILTER (WHERE ${SQL_AVISO})::int AS con_aviso,
        COUNT(*) FILTER (WHERE confirmado)::int AS confirmados,
        COUNT(*) FILTER (WHERE precio_compra > 0 AND fecha_precio < :lim)::int AS antiguos
      FROM productos WHERE activo`, { plain: true, replacements: { lim: ymd(limAntiguo) } }),
  ]);

  // --- Serie mensual: ventas, costo, margen, gastos, utilidad y compras ---
  const serie = [];
  for (let i = meses - 1; i >= 0; i--) {
    serie.push({ mes: primerDiaMes(-i).slice(0, 7), ventas: 0, costo: 0, margen: 0, gastos: 0, utilidad: 0, compras: 0, cantidad: 0 });
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
    const s = serie[idx.get(claveMes(oc.fecha_recepcion))];
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

  // --- Ventas en curso: por aceptar, por comprar, por confirmar, por facturar, por despachar ---
  const conOC = new Set(ocsVenta.map((o) => o.venta_id));
  const sinRecibir = new Set(ocsVenta.filter((o) => o.estado !== "recibida").map((o) => o.venta_id));
  const porAceptar = ventasActivas.filter((v) => v.etapa === "registrada");
  const porComprar = ventasActivas.filter((v) => ["registrada", "aceptada"].includes(v.etapa) && !conOC.has(v.id));
  const porConfirmar = ventasActivas.filter((v) => v.etapa === "aceptada" && conOC.has(v.id) && !sinRecibir.has(v.id));
  const porFacturar = ventasActivas.filter((v) => ["lista", "despachada"].includes(v.etapa) && v.estado_factura !== "facturada");
  const porDespachar = ventasActivas.filter((v) => v.etapa === "lista");
  const porEntregar = ventasActivas.filter((v) => v.etapa === "despachada");

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

  // --- Qué hacer hoy: acciones concretas, lo más urgente primero ---
  // urgencia: 0 = hoy/vencido, 1 = pronto, 2 = cuando se pueda
  const admin = esAdmin(req);
  const operativo = tieneRol(req, "operativo");
  const comercial = tieneRol(req, "comercial") || req.usuario?.rol === "usuario";
  const dias = (d) => (d ? Math.round((new Date(`${String(d).slice(0, 10)}T12:00:00`) - new Date(`${hoyStr}T12:00:00`)) / 864e5) : null);
  const cuando = (dd) => (dd === 0 ? "hoy" : dd === 1 ? "mañana" : dd < 0 ? `hace ${-dd} día(s)` : `en ${dd} días`);
  const tareas = [];
  const [ocBorrador, cotPorVencer] = await Promise.all([
    operativo ? OrdenCompra.findAll({ where: { estado: "borrador" }, attributes: ["id", "numero", "proveedor_nombre", "fecha", "subtotal"], order: [["fecha", "ASC"]], limit: 20 }) : [],
    Cotizacion.findAll({ where: { estado: "cotizacion", fecha_validez: { [Op.between]: [hoyStr, ymd(new Date(Date.now() + 3 * 864e5))] } }, attributes: ["id", "numero", "cliente", "fecha_validez", "empresa"], order: [["fecha_validez", "ASC"]], limit: 10 }),
  ]);
  // Oportunidades que cierran pronto (sin cotizar)
  for (const l of comercial ? licNuevas : []) {
    const dd = l.fecha_cierre ? Math.floor((new Date(l.fecha_cierre) - new Date()) / 864e5) : null;
    if (dd !== null && dd <= 1) tareas.push({ tipo: "oportunidad", urgencia: 0, texto: `Cotizar "${l.nombre}"`, detalle: `${l.organismo || ""} · cierra ${dd <= 0 ? "hoy" : "mañana"} ${new Date(l.fecha_cierre).toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" })}${l.monto_estimado ? ` · ${"$" + n(l.monto_estimado).toLocaleString("es-CL")}` : ""}`, vista: "licitaciones", boton: "Ver oportunidad" });
  }
  const otrasNuevas = licNuevas.filter((l) => !(l.fecha_cierre && Math.floor((new Date(l.fecha_cierre) - new Date()) / 864e5) <= 1)).length;
  if (comercial && otrasNuevas) tareas.push({ tipo: "oportunidad", urgencia: 1, texto: `Revisar ${otrasNuevas} oportunidad(es) nueva(s) de Mercado Público`, detalle: "Compra Ágil y licitaciones que calzan con lo que vendemos", vista: "licitaciones", boton: "Revisar" });
  // Cobranza por área (traspaso financiero 3.4): Comercial avisa antes del vencimiento y recuerda la morosidad
  // temprana; Finanzas (gerencia) ve la morosidad crítica (crédito suspendido), el IVA y los márgenes bajos.
  if (comercial || admin) {
    await suspenderMorosos();
    const cob = await calcularCobranza();
    const avisoDias = Number(params.dias_aviso_vencimiento) || 5;
    const pesosTxt = (x) => `$${n(x).toLocaleString("es-CL")}`;
    if (comercial) {
      for (const d of cob.documentos.filter((x) => !x.provisorio && x.dias_vencida != null && x.dias_vencida <= 0 && x.dias_vencida >= -avisoDias).slice(0, 8)) {
        tareas.push({ tipo: "avisar_cobro", urgencia: 1, texto: `Factura de ${d.numero} (${d.cliente || "cliente"}) vence ${cuando(-d.dias_vencida)}`, detalle: `${pesosTxt(d.saldo)} · confirma con el cliente que esté en pago`, vista: "ventas", id: d.id, boton: "Ver venta" });
      }
      for (const d of cob.documentos.filter((x) => x.tramo === "temprana").slice(0, 8)) {
        const c = cob.clientes.find((x) => x.cliente_id === d.cliente_id);
        tareas.push({ tipo: "recordar_cobro", urgencia: 0, texto: `Recordar el pago de ${d.numero} a ${d.cliente || "cliente"}`, detalle: `${pesosTxt(d.saldo)} · ${d.dias_vencida} día(s) vencida${c?.contacto_finanzas ? ` · ${c.contacto_finanzas}` : ""}`, vista: "ventas", id: d.id, boton: "Ver venta" });
      }
    }
    if (admin) {
      for (const c of cob.clientes.filter((x) => ["critica", "incobrable"].includes(x.peor_tramo)).slice(0, 8)) {
        tareas.push({ tipo: "moroso", urgencia: 0, texto: `${c.cliente}: ${pesosTxt(c.vencido)} vencido hace ${c.max_dias} días`, detalle: c.peor_tramo === "incobrable" ? "Más de 90 días: decidir cobranza externa o castigo" : `Morosidad crítica · crédito ${c.estado_credito === "suspendido" ? "suspendido" : "activo"}`, vista: "cobranza", boton: "Ver cobranza" });
      }
      if (cob.iva.dias <= 5) {
        tareas.push({ tipo: "iva", urgencia: cob.iva.dias <= 1 ? 0 : 1, texto: `Pagar el IVA de ${cob.iva.periodo} (Kenott y Tactics, cada una por separado)`, detalle: `Vence ${cuando(cob.iva.dias)} (${new Date(`${cob.iva.fecha}T12:00:00`).toLocaleDateString("es-CL")}) · el monto lo confirma el contador`, vista: "cobranza", boton: "Ver" });
      }
      const semana = new Date(Date.now() - 7 * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
      for (const v of cob.margen_bajo.filter((x) => String(x.fecha) >= semana).slice(0, 5)) {
        tareas.push({ tipo: "margen", urgencia: 1, texto: `Venta ${v.numero} con margen ${String(v.margen_pct).replace(".", ",")}%`, detalle: `${v.cliente || ""} · bajo el mínimo de ${String(cob.margen_minimo).replace(".", ",")}%`, vista: "ventas", id: v.id, boton: "Ver venta" });
      }
    }
  }
  // Comprar a proveedores
  const oc = (v) => (v.orden_compra_cliente ? ` · OC ${v.orden_compra_cliente}` : "");
  if (comercial) {
    for (const v of porFacturar.slice(0, 8)) tareas.push({ tipo: "facturar", urgencia: 0, texto: `Facturar ${v.numero} · ${v.cliente_nombre || "cliente"}`, detalle: `${v.estado_factura === "parcial" ? `Falta facturar $${n(Number(v.total) - Number(v.monto_facturado)).toLocaleString("es-CL")}` : `Total $${n(v.total).toLocaleString("es-CL")}`}${oc(v)} · productos listos`, vista: "facturacion", id: v.id, boton: "Facturar" });
  }
  if (operativo) {
    for (const v of porAceptar.slice(0, 8)) tareas.push({ tipo: "aceptar", urgencia: 0, texto: `Aceptar la venta ${v.numero} · ${v.cliente_nombre || "cliente"}`, detalle: `Registrada el ${new Date(`${v.fecha}T12:00:00`).toLocaleDateString("es-CL")}${oc(v)}: revísala y compra`, vista: "ventas", id: v.id, boton: "Ver venta" });
    for (const v of porConfirmar.slice(0, 8)) tareas.push({ tipo: "confirmar", urgencia: 0, texto: `Confirmar ${v.numero}: llegaron todos los productos`, detalle: `${v.cliente_nombre || ""}${oc(v)} · queda lista para facturar y despachar`, vista: "ventas", id: v.id, boton: "Confirmar" });
    for (const v of porDespachar.slice(0, 8)) tareas.push({ tipo: "despachar", urgencia: v.estado_factura === "sin_factura" ? 1 : 0, texto: `Despachar ${v.numero} · ${v.cliente_nombre || "cliente"}`, detalle: v.estado_factura === "sin_factura" ? "Aún sin factura (Comercial)" : "Facturada: lista para despacho", vista: "despachos", id: v.id, boton: "Despachar" });
    for (const v of porEntregar.slice(0, 8)) tareas.push({ tipo: "entregar", urgencia: 2, texto: `¿Recibió el cliente ${v.numero}?`, detalle: `Despachada el ${new Date(`${v.despacho_fecha}T12:00:00`).toLocaleDateString("es-CL")} · márcala entregada`, vista: "despachos", id: v.id, boton: "Ver" });
    for (const v of porComprar.filter((x) => x.etapa === "aceptada").slice(0, 8)) tareas.push({ tipo: "comprar", urgencia: 0, texto: `Comprar los productos de ${v.numero}`, detalle: `${v.cliente_nombre || ""} · vendida el ${new Date(`${v.fecha}T12:00:00`).toLocaleDateString("es-CL")}`, vista: "ventas", id: v.id, boton: "Ver qué comprar" });
    for (const o of ocBorrador.filter((o) => dias(o.fecha) <= -2).slice(0, 8)) tareas.push({ tipo: "recibir", urgencia: 1, texto: `¿Llegó el pedido ${o.numero} de ${o.proveedor_nombre}?`, detalle: `Pedido ${cuando(dias(o.fecha))}: márcalo recibido cuando llegue`, vista: "compras", id: o.id, boton: "Ver pedido" });
    for (const o of admin ? porPagar.filter(vencida).slice(0, 8) : []) tareas.push({ tipo: "pagar", urgencia: 0, texto: `Pagar ${o.numero} a ${o.proveedor_nombre}`, detalle: `$${n(saldo(o)).toLocaleString("es-CL")} · venció ${cuando(dias(o.fecha_vencimiento))}`, vista: "compras", id: o.id, boton: "Ver orden" });
  }
  // Llamar a clientes
  for (const c of comercial ? porSeguir.slice(0, 8) : []) tareas.push({ tipo: "llamar", urgencia: 1, texto: `Llamar a ${c.cliente || "cliente"} por la cotización N° ${c.numero}`, detalle: `${c.nombre_cotizacion || ""} · ${c.ultimo_contacto ? `último contacto ${cuando(dias(c.ultimo_contacto))}` : `enviada ${cuando(dias(c.fecha))}, sin respuesta`}`, vista: "cotizaciones-seguir", boton: "Ver" });
  for (const c of comercial ? cotPorVencer.filter((c) => !porSeguir.some((p) => p.id === c.id)) : []) tareas.push({ tipo: "llamar", urgencia: 1, texto: `La cotización N° ${c.numero} (${c.cliente || "sin cliente"}) vence ${cuando(dias(c.fecha_validez))}`, detalle: "Llama al cliente antes de que venza", vista: "cotizaciones", boton: "Ver" });
  // Departamento de cada tarea (cada pestaña muestra las suyas)
  const DEPTO = { avisar_cobro: "comercial", recordar_cobro: "comercial", moroso: "finanzas", iva: "finanzas", margen: "finanzas", oportunidad: "comercial", llamar: "comercial", facturar: "comercial", aceptar: "operativo", confirmar: "operativo", despachar: "operativo", entregar: "operativo", comprar: "operativo", recibir: "operativo", cobrar: "finanzas", pagar: "finanzas" };
  tareas.forEach((t) => { t.depto = DEPTO[t.tipo] || "comercial"; });
  tareas.sort((a, b) => a.urgencia - b.urgencia);

  // --- Total adjudicado (ventas registradas, con IVA) de la semana y del mes, por empresa ---
  const lunes = (() => { const d = new Date(`${hoyStr}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); })();
  const ventasRecientes = await Venta.findAll({ where: { estado: { [Op.ne]: "anulada" }, fecha: { [Op.gte]: lunes < inicioMes ? lunes : inicioMes } }, attributes: ["fecha", "total", "empresa"], raw: true });
  const ventasMes = ventasRecientes.filter((v) => v.fecha >= inicioMes);
  const sumar = (lista) => {
    const r = { kenott: { total: 0, cantidad: 0 }, tactics: { total: 0, cantidad: 0 } };
    for (const v of lista) { const e = r[v.empresa] ? v.empresa : "kenott"; r[e].total += Number(v.total); r[e].cantidad += 1; }
    r.kenott.total = n(r.kenott.total); r.tactics.total = n(r.tactics.total);
    return { ...r, ambas: { total: r.kenott.total + r.tactics.total, cantidad: r.kenott.cantidad + r.tactics.cantidad } };
  };
  const adjudicado = { semana: sumar(ventasRecientes.filter((v) => v.fecha >= lunes)), mes: sumar(ventasMes), desde_semana: lunes };

  const data = {
    tareas,
    adjudicado,
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
    catalogo: { ...catalogo, meses_antiguo: Number(params.meses_precio_antiguo) || 6 },
    licitaciones: {
      nuevas: licNuevas.length,
      ultima_revision: params.mp_ultima_sincronizacion || null,
      detalle: licNuevas.slice(0, 8).map((l) => ({ codigo: l.codigo, nombre: l.nombre, organismo: l.organismo, comuna: l.comuna, cierre: l.fecha_cierre, monto: l.monto_estimado ? n(l.monto_estimado) : null, productos: (l.items || []).length, fuente: l.fuente, prioridad: l.prioridad, relevancia: l.relevancia, ficha: fichaUrl(l) })),
    },
    por_seguir: { cantidad: porSeguir.length, detalle: porSeguir.slice(0, 10).map((c) => ({ id: c.id, numero: c.numero, empresa: c.empresa, anterior: c.anterior, id_solicitud: c.id_solicitud, cliente: c.cliente, nombre: c.nombre_cotizacion, fecha: c.fecha, vence: c.fecha_validez, ultimo_contacto: c.ultimo_contacto, proximo_contacto: c.proximo_contacto, neto: n(c.subtotal) })) },
    flujo: { por_aceptar: porAceptar.length, por_comprar: porComprar.length, por_confirmar: porConfirmar.length, por_facturar: porFacturar.length, por_despachar: porDespachar.length, por_entregar: porEntregar.length },
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
  const desde = req.query.desde || `${ymd(hoy).slice(0, 4)}-01-01`;
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
