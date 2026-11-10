// Cobranza (Finanzas fase 1): quién debe, cuánto y desde cuándo.
// Reglas del traspaso financiero:
//  - Los días se cuentan desde el VENCIMIENTO (fecha base de la venta + plazo del cliente), no desde la emisión.
//  - Tramos: por vencer · morosidad temprana (1-30) · crítica (31-90, se suspende el crédito) · incobrable (>90).
//  - DSO = cuentas por cobrar / (ventas a crédito de los últimos 30 días / 30), por empresa y consolidado.
//  - Margen sobre el neto; bajo el mínimo (23,1% = compra × 1,30) la venta se marca.
const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Venta = require("../models/Venta");
const Cliente = require("../models/Cliente");
const { getParametros } = require("./parametros");

const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const dias = (desde, hasta) => Math.round((new Date(`${String(hasta).slice(0, 10)}T12:00:00`) - new Date(`${String(desde).slice(0, 10)}T12:00:00`)) / 864e5);
const TRAMOS = [
  ["por_vencer", "Por vencer"], ["temprana", "Morosidad temprana (1-30)"], ["critica", "Morosidad crítica (31-90)"], ["incobrable", "Más de 90 días"], ["sin_vencimiento", "Sin vencimiento"],
];
const tramoDe = (diasVencida) => (diasVencida == null ? "sin_vencimiento" : diasVencida <= 0 ? "por_vencer" : diasVencida <= 30 ? "temprana" : diasVencida <= 90 ? "critica" : "incobrable");
const ORDEN = { sin_vencimiento: 0, por_vencer: 1, temprana: 2, critica: 3, incobrable: 4 };

// Próximo vencimiento del IVA: día N del mes; si cae sábado o domingo pasa al lunes
function proximoIva(diaPago) {
  const hoy = hoyISO();
  const [y, m] = hoy.split("-").map(Number);
  const fechaDe = (yy, mm) => {
    const d = new Date(Date.UTC(yy, mm - 1, Math.min(Number(diaPago) || 20, 28)));
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  let f = fechaDe(y, m);
  if (f < hoy) f = m === 12 ? fechaDe(y + 1, 1) : fechaDe(y, m + 1);
  const [fy, fm] = f.split("-").map(Number);
  const periodo = new Date(Date.UTC(fy, fm - 2, 1)).toLocaleDateString("es-CL", { month: "long", year: "numeric", timeZone: "UTC" });
  return { fecha: f, dias: dias(hoy, f), periodo };
}

async function calcularCobranza({ empresa } = {}) {
  const params = await getParametros();
  const hoy = hoyISO();
  const whereEmp = empresa ? { empresa } : {};
  const pendientes = await Venta.findAll({
    where: { estado: "emitida", ...whereEmp, [Op.and]: [sequelize.where(sequelize.literal(`total - monto_pagado`), { [Op.gt]: 0.5 })] },
    order: [["fecha_vencimiento", "ASC"]],
  });
  const clientes = new Map((await Cliente.findAll({ where: { id: [...new Set(pendientes.map((v) => v.cliente_id).filter(Boolean))] } })).map((c) => [c.id, c]));

  const documentos = pendientes.map((v) => {
    const saldo = Math.round(Number(v.total) - Number(v.monto_pagado));
    const dv = v.fecha_vencimiento ? dias(v.fecha_vencimiento, hoy) : null;
    const c = clientes.get(v.cliente_id);
    return {
      id: v.id, numero: v.numero, empresa: v.empresa, cliente_id: v.cliente_id, cliente: v.cliente_nombre, codigo: c?.codigo || null,
      documento: v.documento, orden_compra_cliente: v.orden_compra_cliente, id_solicitud: v.id_solicitud,
      etapa: v.etapa, estado_factura: v.estado_factura, total: Math.round(Number(v.total)), saldo,
      fecha_vencimiento: v.fecha_vencimiento, plazo: v.plazo_pago_dias, base: v.base_vencimiento,
      // Antes de facturar (o de la recepción, según el cliente) el vencimiento es provisorio
      provisorio: v.base_vencimiento === "recepcion" ? !v.entrega_fecha : v.estado_factura === "sin_factura",
      dias_vencida: dv, tramo: tramoDe(dv),
    };
  });

  // Atraso real promedio de cada cliente (cobros de ventas ya pagadas, contra su vencimiento)
  const [atrasos] = await sequelize.query(`SELECT v.cliente_id, ROUND(AVG(p.ultimo - v.fecha_vencimiento))::int AS dias, COUNT(*)::int AS n
    FROM ventas v JOIN (SELECT venta_id, MAX(fecha)::date AS ultimo FROM pagos WHERE tipo = 'cobro' GROUP BY venta_id) p ON p.venta_id = v.id
    WHERE v.estado_pago = 'pagada' AND v.fecha_vencimiento IS NOT NULL AND v.cliente_id IS NOT NULL GROUP BY v.cliente_id`);
  const atraso = new Map(atrasos.map((a) => [a.cliente_id, a.dias]));

  // Por cliente
  const porCliente = new Map();
  for (const d of documentos) {
    const k = d.cliente_id || `x${d.cliente || ""}`;
    const c = clientes.get(d.cliente_id);
    const r = porCliente.get(k) || {
      cliente_id: d.cliente_id, cliente: d.cliente || "Sin cliente", codigo: c?.codigo || null, plazo: c?.plazo_pago_dias ?? null, base: c?.base_vencimiento || null,
      contacto_finanzas: c?.contacto_finanzas || null, estado_credito: c?.estado_credito || null, motivo_credito: c?.motivo_credito || null,
      usa_factoring: !!c?.usa_factoring, limite_credito: c?.limite_credito != null ? Number(c.limite_credito) : null,
      deuda: 0, vencido: 0, documentos: 0, peor_tramo: "sin_vencimiento", max_dias: null, atraso_promedio: atraso.get(d.cliente_id) ?? null,
    };
    r.deuda += d.saldo;
    r.documentos += 1;
    if (d.dias_vencida > 0) r.vencido += d.saldo;
    if (ORDEN[d.tramo] > ORDEN[r.peor_tramo]) r.peor_tramo = d.tramo;
    if (d.dias_vencida != null && (r.max_dias == null || d.dias_vencida > r.max_dias)) r.max_dias = d.dias_vencida;
    porCliente.set(k, r);
  }
  const listaClientes = [...porCliente.values()].map((r) => ({ ...r, sobre_limite: r.limite_credito > 0 && r.deuda > r.limite_credito }))
    .sort((a, b) => ORDEN[b.peor_tramo] - ORDEN[a.peor_tramo] || b.vencido - a.vencido || b.deuda - a.deuda);

  // Resumen por empresa y consolidado
  const desde30 = new Date(Date.now() - 30 * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
  const [ventas30] = await sequelize.query(`SELECT empresa, SUM(total)::float AS total FROM ventas
    WHERE estado <> 'anulada' AND fecha >= :d AND COALESCE(plazo_pago_dias, 1) > 0 ${empresa ? "AND empresa = :e" : ""} GROUP BY empresa`, { replacements: { d: desde30, e: empresa } });
  const resumenDe = (lista, ventas) => {
    const r = { por_cobrar: 0, vencido: 0, documentos: lista.length };
    for (const [k] of TRAMOS) r[k] = 0;
    for (const d of lista) { r.por_cobrar += d.saldo; r[d.tramo] += d.saldo; if (d.dias_vencida > 0) r.vencido += d.saldo; }
    r.dso = ventas > 0 ? Math.round(r.por_cobrar / (ventas / 30)) : null;
    r.ventas_credito_30d = Math.round(ventas);
    return r;
  };
  const v30 = (e) => ventas30.filter((x) => !e || x.empresa === e).reduce((s, x) => s + Number(x.total), 0);
  const resumen = {
    kenott: resumenDe(documentos.filter((d) => d.empresa === "kenott"), v30("kenott")),
    tactics: resumenDe(documentos.filter((d) => d.empresa === "tactics"), v30("tactics")),
    ambas: resumenDe(documentos, v30()),
  };

  // Ventas recientes con margen bajo el mínimo (sobre el neto). Tolerancia de 0,15 puntos: compra × 1,30 redondeado a peso da 23,07%
  const minimo = Number(params.margen_minimo) || 23.1;
  const desde90 = new Date(Date.now() - 90 * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
  const [margenBajo] = await sequelize.query(`SELECT id, numero, empresa, cliente_nombre AS cliente, fecha, subtotal::float AS neto, costo_total::float AS costo,
      ROUND(((subtotal - costo_total) / NULLIF(subtotal, 0) * 100)::numeric, 1)::float AS margen_pct
    FROM ventas WHERE estado <> 'anulada' AND fecha >= :d AND subtotal > 0 AND costo_total > 0 ${empresa ? "AND empresa = :e" : ""}
      AND (subtotal - costo_total) / subtotal * 100 < :m - 0.15 ORDER BY fecha DESC LIMIT 50`, { replacements: { d: desde90, m: minimo, e: empresa } });

  return {
    hoy, tramos: TRAMOS, resumen, clientes: listaClientes, documentos, margen_bajo: margenBajo, margen_minimo: minimo,
    iva: { ...proximoIva(params.iva_dia_pago), regimen_kenott: params.regimen_kenott, regimen_tactics: params.regimen_tactics },
    saldo_minimo: { kenott: Number(params.saldo_minimo_caja_kenott) || 0, tactics: Number(params.saldo_minimo_caja_tactics) || 0 },
  };
}

// Morosidad crítica (31+ días vencida): el crédito del cliente queda suspendido automáticamente.
// Solo suspende; reactivarlo lo decide gerencia en la ficha del cliente.
async function suspenderMorosos() {
  const hoy = hoyISO();
  const [filas] = await sequelize.query(`SELECT v.cliente_id, MIN(v.fecha_vencimiento) AS venc, MIN(v.numero) AS numero
    FROM ventas v JOIN clientes c ON c.id = v.cliente_id
    WHERE v.estado = 'emitida' AND v.total - v.monto_pagado > 0.5 AND v.fecha_vencimiento IS NOT NULL
      AND v.fecha_vencimiento <= (:hoy::date - 31) AND c.estado_credito = 'activo' AND COALESCE(c.codigo, '') <> 'P-001'
    GROUP BY v.cliente_id`, { replacements: { hoy } });
  for (const f of filas) {
    await Cliente.update({ estado_credito: "suspendido", motivo_credito: `Automático: ${f.numero} con ${dias(f.venc, hoy)} días vencida (morosidad crítica)` }, { where: { id: f.cliente_id } });
  }
  return filas.length;
}

module.exports = { calcularCobranza, suspenderMorosos, proximoIva, tramoDe, TRAMOS };
