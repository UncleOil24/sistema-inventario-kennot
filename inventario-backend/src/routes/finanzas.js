const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const { handler } = require("../services/erp");
const { calcularCobranza, suspenderMorosos } = require("../services/cobranza");
const { calcularPorPagar, calcularIva, registrarPagoIva } = require("../services/porPagar");
const { firma } = require("../middlewares/auth");
const { ErrorNegocio } = require("../services/erp");
const emp = (e) => (["kenott", "tactics"].includes(e) ? e : undefined);

// Finanzas y Control: solo gerencia
router.use(soloAdmin);

// GET /api/finanzas/cobranza?empresa=kenott|tactics
router.get("/cobranza", handler(async (req, res) => {
  const suspendidos = await suspenderMorosos();
  const data = await calcularCobranza({ empresa: ["kenott", "tactics"].includes(req.query.empresa) ? req.query.empresa : undefined });
  res.json({ ok: true, data: { ...data, suspendidos_ahora: suspendidos } });
}));

// GET /api/finanzas/por-pagar?empresa=   -> deuda con proveedores, antigüedad, calendario y pronto pago
router.get("/por-pagar", handler(async (req, res) => {
  res.json({ ok: true, data: await calcularPorPagar({ empresa: emp(req.query.empresa) }) });
}));

// GET /api/finanzas/iva?empresa=&mes=YYYY-MM   -> débito, crédito, remanente y monto a pagar por empresa
router.get("/iva", handler(async (req, res) => {
  res.json({ ok: true, data: await calcularIva({ empresa: emp(req.query.empresa), mes: req.query.mes }) });
}));

// POST /api/finanzas/iva/pago   { empresa, mes, fecha, monto, folio }  (monto null = deshacer)
router.post("/iva/pago", handler(async (req, res) => {
  const { empresa, mes, fecha, monto, folio } = req.body || {};
  if (!emp(empresa) || !/^\d{4}-\d{2}$/.test(mes || "")) throw new ErrorNegocio("Empresa o mes inválido");
  const data = await registrarPagoIva({ empresa, mes, fecha, monto: monto === null ? null : Number(monto) || 0, folio, por: firma(req) });
  res.json({ ok: true, data });
}));

// GET /api/finanzas/produccion?desde=&hasta=   -> control de producción por persona (Comercial y Operativo)
// Cada acción guarda quién la hizo con su área ("Nicol Orellana (Comercial)", "Jorge Orellana (Gerencia)").
const sequelize = require("../../config/database");
router.get("/produccion", handler(async (req, res) => {
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || "") ? req.query.desde : `${hoy.slice(0, 8)}01`;
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || "") ? req.query.hasta : hoy;
  const r = { desde, hasta };
  const q = async (sql) => (await sequelize.query(sql, { replacements: { desde, hasta } }))[0];
  const enRango = (col) => `(${col} AT TIME ZONE 'America/Santiago')::date BETWEEN :desde AND :hasta`;
  // Mercado Público: procesos que cerraron en el período y qué pasó con cada uno
  const [mp] = await q(`SELECT
      COUNT(*)::int AS cerrados,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM cotizaciones c WHERE UPPER(c.id_solicitud) = UPPER(l.codigo)))::int AS cotizados,
      COUNT(*) FILTER (WHERE estado_interno = 'descartada')::int AS descartados,
      COUNT(*) FILTER (WHERE estado_interno <> 'descartada' AND NOT EXISTS (SELECT 1 FROM cotizaciones c WHERE UPPER(c.id_solicitud) = UPPER(l.codigo)))::int AS sin_postular,
      COUNT(*) FILTER (WHERE fuente = 'compra_agil')::int AS compra_agil,
      COUNT(*) FILTER (WHERE fuente <> 'compra_agil')::int AS licitaciones
    FROM licitaciones l WHERE ${enRango("l.fecha_cierre")} AND l.fecha_cierre < NOW()`);
  // Más los procesos ya borrados (cerrados hace más de 3 días sin cotizar): solo quedó su conteo por día
  try {
    const [arch] = await q(`SELECT COALESCE(SUM(cerrados),0)::int AS cerrados, COALESCE(SUM(descartados),0)::int AS descartados, COALESCE(SUM(sin_postular),0)::int AS sin_postular,
      COALESCE(SUM(compra_agil),0)::int AS compra_agil, COALESCE(SUM(licitaciones),0)::int AS licitaciones FROM mp_conteo_cerradas WHERE fecha BETWEEN :desde AND :hasta`);
    for (const k of Object.keys(arch)) mp[k] = (mp[k] || 0) + arch[k];
    mp.archivados = arch.cerrados;
  } catch { /* la tabla se crea con la primera limpieza */ }
  r.mercado_publico = mp;
  r.sin_postular = await q(`SELECT codigo, nombre, organismo, fecha_cierre, monto_estimado::float AS monto, fuente FROM licitaciones l
    WHERE ${enRango("l.fecha_cierre")} AND l.fecha_cierre < NOW() AND estado_interno <> 'descartada'
      AND NOT EXISTS (SELECT 1 FROM cotizaciones c WHERE UPPER(c.id_solicitud) = UPPER(l.codigo)) ORDER BY fecha_cierre DESC LIMIT 100`);
  // Comercial: cotizaciones por persona y empresa
  r.cotizaciones = await q(`SELECT COALESCE(creado_por, 'Sin registro') AS persona, empresa, COUNT(*)::int AS cantidad, SUM(total)::float AS monto,
      COUNT(*) FILTER (WHERE estado = 'aceptada')::int AS ganadas, SUM(total) FILTER (WHERE estado = 'aceptada')::float AS monto_ganado,
      COUNT(*) FILTER (WHERE id_solicitud ~ '^[0-9]+-[0-9]+-[A-Za-z]')::int AS mercado_publico
    FROM cotizaciones WHERE NOT anterior AND estado <> 'borrador' AND ${enRango('"createdAt"')} GROUP BY 1, 2 ORDER BY 1, 2`);
  r.ventas = await q(`SELECT COALESCE(creado_por, 'Sin registro') AS persona, empresa, COUNT(*)::int AS cantidad, SUM(total)::float AS monto
    FROM ventas WHERE estado <> 'anulada' AND fecha BETWEEN :desde AND :hasta GROUP BY 1, 2 ORDER BY 1, 2`);
  r.facturas = await q(`SELECT COALESCE(creado_por, 'Sin registro') AS persona, COUNT(*)::int AS cantidad, SUM(monto)::float AS monto
    FROM facturas WHERE fecha BETWEEN :desde AND :hasta GROUP BY 1 ORDER BY 1`);
  // Operativo: quién aceptó, confirmó y despachó ventas, y quién generó órdenes de compra
  const accion = (col, fechaCol) => q(`SELECT ${col} AS persona, COUNT(*)::int AS cantidad FROM ventas
    WHERE ${col} IS NOT NULL AND ${fechaCol} IS NOT NULL AND ${fechaCol.includes("_fecha") && !fechaCol.startsWith("despacho") ? enRango(fechaCol) : `${fechaCol} BETWEEN :desde AND :hasta`} GROUP BY 1 ORDER BY 1`);
  r.operativo = {
    aceptadas: await accion("aceptada_por", "aceptada_fecha"),
    confirmadas: await accion("lista_por", "lista_fecha"),
    despachadas: await accion("despacho_por", "despacho_fecha"),
    ordenes_compra: await q(`SELECT COALESCE(creado_por, 'Sin registro') AS persona, COUNT(*)::int AS cantidad, SUM(total)::float AS monto
      FROM ordenes_compra WHERE estado <> 'anulada' AND ${enRango('"createdAt"')} GROUP BY 1 ORDER BY 1`),
  };
  res.json({ ok: true, data: r });
}));

module.exports = router;
