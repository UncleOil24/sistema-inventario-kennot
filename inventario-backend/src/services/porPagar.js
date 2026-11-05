// Finanzas fase 2: lo que debemos a proveedores y el IVA mensual de cada empresa.
// Reglas (decisiones de gerencia y traspaso financiero):
//  - Una compra es deuda desde que llega (recibida) o desde que tiene factura del proveedor.
//  - Vence en la fecha que se anotó; si no, fecha de la factura (o de recepción) + plazo del proveedor (vacío = contado).
//  - Descuento por pronto pago: si el proveedor lo da y aún estamos dentro del plazo, se muestra cuánto se ahorra.
//  - IVA: débito (facturas emitidas) − crédito (facturas de proveedores y gastos con IVA) − remanente del mes anterior.
//    Se paga a más tardar el día 20 del mes siguiente. Cada empresa por separado: nunca se compensa entre empresas.
const sequelize = require("../../config/database");
const { getParametros, setParametros } = require("./parametros");

const EMPRESAS = ["kenott", "tactics"];
const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const ymd = (x) => (x ? (x instanceof Date ? x.toLocaleDateString("sv-SE", { timeZone: "America/Santiago" }) : String(x).slice(0, 10)) : null);
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10); };
const dias = (desde, hasta) => Math.round((new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)) / 864e5);

const TRAMOS_PAGO = [["por_vencer", "Por vencer"], ["v1_30", "Vencido 1-30"], ["v31_60", "Vencido 31-60"], ["v60", "Más de 60 días"]];
const tramoPago = (dv) => (dv <= 0 ? "por_vencer" : dv <= 30 ? "v1_30" : dv <= 60 ? "v31_60" : "v60");

async function calcularPorPagar({ empresa } = {}) {
  const params = await getParametros();
  const hoy = hoyISO();
  const [filas] = await sequelize.query(`SELECT o.id, o.numero, o.empresa, o.proveedor_id, o.proveedor_nombre, o.documento, o.fecha, o.fecha_factura,
      o.fecha_recepcion, o.fecha_vencimiento, o.estado, o.total::float AS total, o.monto_pagado::float AS pagado, o.venta_id,
      v.numero AS venta_numero, v.cliente_nombre, p.plazo_pago_dias, p.descuento_pronto_pago::float AS dcto, p.dias_pronto_pago, p.contacto, p.telefono
    FROM ordenes_compra o LEFT JOIN proveedores p ON p.id = o.proveedor_id LEFT JOIN ventas v ON v.id = o.venta_id
    WHERE o.estado <> 'anulada' AND o.total - o.monto_pagado > 0.5 AND (o.estado = 'recibida' OR o.documento IS NOT NULL)
      ${empresa ? "AND (o.empresa = :e OR o.empresa IS NULL)" : ""}`, { replacements: { e: empresa } });

  const documentos = filas.map((o) => {
    const base = ymd(o.fecha_factura) || ymd(o.fecha_recepcion) || ymd(o.fecha);
    const vence = ymd(o.fecha_vencimiento) || sumarDias(base, o.plazo_pago_dias || 0);
    const dv = dias(vence, hoy);
    const saldo = Math.round(o.total - o.pagado);
    let pronto = null;
    if (o.dcto > 0 && o.dias_pronto_pago > 0 && !(o.pagado > 0)) {
      const limite = sumarDias(base, o.dias_pronto_pago);
      if (limite >= hoy) pronto = { hasta: limite, pct: o.dcto, ahorro: Math.round(saldo * o.dcto / 100) };
    }
    return {
      id: o.id, numero: o.numero, empresa: o.empresa, proveedor_id: o.proveedor_id, proveedor: o.proveedor_nombre,
      contacto: [o.contacto, o.telefono].filter(Boolean).join(" · ") || null,
      factura: o.documento, fecha_factura: ymd(o.fecha_factura), recibida: o.estado === "recibida",
      venta_id: o.venta_id, venta_numero: o.venta_numero, cliente: o.cliente_nombre,
      total: Math.round(o.total), saldo, fecha_vencimiento: vence, plazo: o.plazo_pago_dias,
      vence_estimado: !o.fecha_vencimiento, sin_factura: !o.documento,
      dias_vencida: dv, tramo: tramoPago(dv), pronto_pago: pronto,
    };
  }).sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));

  const resumenDe = (lista) => {
    const r = { por_pagar: 0, vencido: 0, proximos_7: 0, documentos: lista.length, ahorro_pronto_pago: 0 };
    for (const [k] of TRAMOS_PAGO) r[k] = 0;
    for (const d of lista) {
      r.por_pagar += d.saldo; r[d.tramo] += d.saldo;
      if (d.dias_vencida > 0) r.vencido += d.saldo;
      else if (d.dias_vencida >= -7) r.proximos_7 += d.saldo;
      if (d.pronto_pago) r.ahorro_pronto_pago += d.pronto_pago.ahorro;
    }
    return r;
  };
  const resumen = { ambas: resumenDe(documentos) };
  for (const e of EMPRESAS) resumen[e] = resumenDe(documentos.filter((d) => d.empresa === e));

  // Por proveedor
  const porProv = new Map();
  for (const d of documentos) {
    const k = d.proveedor_id || d.proveedor;
    const r = porProv.get(k) || { proveedor_id: d.proveedor_id, proveedor: d.proveedor, contacto: d.contacto, plazo: d.plazo, deuda: 0, vencido: 0, documentos: 0, proximo: null, max_dias: null };
    r.deuda += d.saldo; r.documentos += 1;
    if (d.dias_vencida > 0) { r.vencido += d.saldo; r.max_dias = Math.max(r.max_dias || 0, d.dias_vencida); }
    if (!r.proximo || d.fecha_vencimiento < r.proximo) r.proximo = d.fecha_vencimiento;
    porProv.set(k, r);
  }
  const proveedores = [...porProv.values()].sort((a, b) => b.vencido - a.vencido || a.proximo.localeCompare(b.proximo));

  // Calendario: lo que vence en cada una de las próximas semanas (para ver la caja)
  const semanas = [0, 1, 2, 3].map((i) => {
    const desde = sumarDias(hoy, i * 7 + (i ? 1 : 0)), hasta = sumarDias(hoy, (i + 1) * 7);
    const lista = documentos.filter((d) => (i === 0 ? d.fecha_vencimiento <= hasta : d.fecha_vencimiento >= desde && d.fecha_vencimiento <= hasta));
    return { desde: i === 0 ? null : desde, hasta, monto: lista.reduce((s, d) => s + d.saldo, 0), documentos: lista.length };
  });

  return {
    hoy, tramos: TRAMOS_PAGO, resumen, documentos, proveedores, semanas,
    sin_empresa: documentos.filter((d) => !d.empresa).length,
    saldo_minimo: { kenott: Number(params.saldo_minimo_caja_kenott) || 0, tactics: Number(params.saldo_minimo_caja_tactics) || 0 },
  };
}

// ---------- IVA ----------
const mesDe = (fecha) => String(fecha).slice(0, 7);
const mesSiguiente = (m) => { const [y, mm] = m.split("-").map(Number); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; };
const nombreMes = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("es-CL", { month: "long", year: "numeric", timeZone: "UTC" });
// Vencimiento del IVA del período m: día N del mes siguiente; sábado o domingo pasa al lunes
const venceIva = (m, diaPago) => {
  const [y, mm] = mesSiguiente(m).split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 1, Math.min(Number(diaPago) || 20, 28)));
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const leerPagos = (params) => { try { return JSON.parse(params.iva_pagos || "{}") || {}; } catch { return {}; } };

// Débito y crédito de cada mes, de una empresa
async function movimientosIva(empresa, desde, hasta) {
  const r = { empresa: empresa, desde: `${desde}-01`, hasta: `${mesSiguiente(hasta)}-01` };
  const [deb] = await sequelize.query(`SELECT to_char(f.fecha, 'YYYY-MM') AS mes, SUM(f.monto)::float AS total, COUNT(*)::int AS n
    FROM facturas f JOIN ventas v ON v.id = f.venta_id WHERE v.empresa = :empresa AND v.estado <> 'anulada' AND f.fecha >= :desde AND f.fecha < :hasta GROUP BY 1`, { replacements: r });
  const [cred] = await sequelize.query(`SELECT to_char(COALESCE(fecha_factura, fecha_recepcion::date, fecha), 'YYYY-MM') AS mes, SUM(iva)::float AS iva, SUM(total)::float AS total, COUNT(*)::int AS n
    FROM ordenes_compra WHERE empresa = :empresa AND estado <> 'anulada' AND documento IS NOT NULL
      AND COALESCE(fecha_factura, fecha_recepcion::date, fecha) >= :desde AND COALESCE(fecha_factura, fecha_recepcion::date, fecha) < :hasta GROUP BY 1`, { replacements: r });
  const [gas] = await sequelize.query(`SELECT to_char(fecha, 'YYYY-MM') AS mes, SUM(iva)::float AS iva, COUNT(*)::int AS n
    FROM gastos WHERE empresa = :empresa AND iva > 0 AND fecha >= :desde AND fecha < :hasta GROUP BY 1`, { replacements: r });
  const m = (lista) => new Map(lista.map((x) => [x.mes, x]));
  return { deb: m(deb), cred: m(cred), gas: m(gas) };
}

async function calcularIva({ empresa, mes } = {}) {
  const params = await getParametros();
  const hoy = hoyISO();
  const pagos = leerPagos(params);
  // Mes a mostrar: por defecto, el período que se paga ahora (el mes anterior hasta el día de pago; después, el actual)
  const actual = mesDe(hoy);
  const [y, mm] = actual.split("-").map(Number);
  const anterior = mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`;
  const porDefecto = hoy <= venceIva(anterior, params.iva_dia_pago) ? anterior : actual;
  const objetivo = /^\d{4}-\d{2}$/.test(mes || "") ? mes : porDefecto;
  let desde = /^\d{4}-\d{2}$/.test(params.iva_desde || "") ? params.iva_desde : objetivo;
  if (desde > objetivo) desde = objetivo;
  const hasta = objetivo > actual ? objetivo : actual;

  const resultado = {};
  for (const e of (empresa ? [empresa] : EMPRESAS)) {
    const { deb, cred, gas } = await movimientosIva(e, desde, hasta);
    const meses = [];
    let remanente = Math.round(Number(params[`iva_remanente_${e}`]) || 0);
    for (let m = desde; m <= hasta; m = mesSiguiente(m)) {
      const ventasTotal = deb.get(m)?.total || 0;
      const debito = Math.round(ventasTotal * 19 / 119);
      const creditoCompras = Math.round(cred.get(m)?.iva || 0);
      const creditoGastos = Math.round(gas.get(m)?.iva || 0);
      const credito = creditoCompras + creditoGastos;
      const neto = debito - credito - remanente;
      const pago = pagos[`${e}:${m}`] || null;
      const vence = venceIva(m, params.iva_dia_pago);
      meses.push({
        mes: m, nombre: nombreMes(m), facturado: Math.round(ventasTotal), facturas: deb.get(m)?.n || 0,
        debito, credito_compras: creditoCompras, compras: cred.get(m)?.n || 0, credito_gastos: creditoGastos, gastos: gas.get(m)?.n || 0,
        credito, remanente_anterior: remanente, a_pagar: Math.max(neto, 0), remanente_siguiente: Math.max(-neto, 0),
        vence, dias: dias(hoy, vence), en_curso: m >= actual, pagado: pago,
      });
      remanente = Math.max(-neto, 0);
    }
    resultado[e] = { meses: meses.reverse(), actual: meses.find((x) => x.mes === objetivo) };
  }

  // Detalle del mes elegido: qué facturas suman a cada lado
  const r = { empresa: empresa || null, desde: `${objetivo}-01`, hasta: `${mesSiguiente(objetivo)}-01` };
  const filtroE = (col) => (empresa ? `AND ${col} = :empresa` : "");
  const [emitidas] = await sequelize.query(`SELECT f.id, f.numero, f.fecha, f.monto::float AS total, v.empresa, v.id AS venta_id, v.numero AS venta, v.cliente_nombre AS cliente
    FROM facturas f JOIN ventas v ON v.id = f.venta_id WHERE v.estado <> 'anulada' AND f.fecha >= :desde AND f.fecha < :hasta ${filtroE("v.empresa")} ORDER BY f.fecha, f.id`, { replacements: r });
  const [recibidas] = await sequelize.query(`SELECT id, numero, documento AS factura, COALESCE(fecha_factura, fecha_recepcion::date, fecha) AS fecha, empresa, proveedor_nombre AS proveedor,
      subtotal::float AS neto, iva::float AS iva, total::float AS total
    FROM ordenes_compra WHERE estado <> 'anulada' AND documento IS NOT NULL AND COALESCE(fecha_factura, fecha_recepcion::date, fecha) >= :desde
      AND COALESCE(fecha_factura, fecha_recepcion::date, fecha) < :hasta ${empresa ? "AND empresa = :empresa" : "AND empresa IS NOT NULL"} ORDER BY 4, id`, { replacements: r });
  const [gastos] = await sequelize.query(`SELECT id, fecha, tipo, descripcion, comprobante, empresa, monto::float AS total, iva::float AS iva
    FROM gastos WHERE iva > 0 AND fecha >= :desde AND fecha < :hasta ${empresa ? "AND empresa = :empresa" : "AND empresa IS NOT NULL"} ORDER BY fecha, id`, { replacements: r });
  // Avisos: compras del mes que no suman crédito porque les falta la factura o la empresa
  const [faltan] = await sequelize.query(`SELECT id, numero, proveedor_nombre AS proveedor, total::float AS total, empresa, documento
    FROM ordenes_compra WHERE estado = 'recibida' AND (documento IS NULL OR empresa IS NULL)
      AND COALESCE(fecha_factura, fecha_recepcion::date, fecha) >= :desde AND COALESCE(fecha_factura, fecha_recepcion::date, fecha) < :hasta
      ${empresa ? "AND (empresa = :empresa OR empresa IS NULL)" : ""} ORDER BY id`, { replacements: r });

  return {
    hoy, mes: objetivo, nombre: nombreMes(objetivo), desde, empresas: resultado,
    detalle: { emitidas, recibidas, gastos, faltan },
    remanente_inicial: { kenott: Number(params.iva_remanente_kenott) || 0, tactics: Number(params.iva_remanente_tactics) || 0 },
    dia_pago: Number(params.iva_dia_pago) || 20,
  };
}

async function registrarPagoIva({ empresa, mes, fecha, monto, folio, por }) {
  const params = await getParametros();
  const pagos = leerPagos(params);
  const k = `${empresa}:${mes}`;
  if (monto == null) delete pagos[k];
  else pagos[k] = { fecha: fecha || hoyISO(), monto: Math.round(Number(monto) || 0), folio: folio || null, por };
  await setParametros({ iva_pagos: JSON.stringify(pagos) });
  return pagos[k] || null;
}

module.exports = { calcularPorPagar, calcularIva, registrarPagoIva, venceIva, TRAMOS_PAGO, EMPRESAS };
