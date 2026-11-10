const sequelize = require("../../config/database");
const { Op } = require("sequelize");
const Licitacion = require("../models/Licitacion");
const { handler, ErrorNegocio } = require("../services/erp");
const mp = require("../services/mercadoPublico");
const trabajos = require("../services/trabajos");
const { getParametros } = require("../services/parametros");

// GET /api/mercado-publico/licitaciones?vista=nuevas|abiertas|cotizadas|descartadas|todas&fuente=compra_agil|licitacion&busqueda=&todas_regiones=1
const listar = handler(async (req, res) => {
  const params = await getParametros();
  await mp.aplicarRelevanciaMinima(params);
  const { vista = "abiertas", busqueda, fuente } = req.query;
  const where = {};
  if (fuente === "compra_agil" || fuente === "licitacion") where.fuente = fuente;
  if (vista === "abiertas" || vista === "nuevas") {
    where.estado_interno = vista === "nuevas" ? "nueva" : { [Op.ne]: "descartada" };
    where[Op.or] = [{ fecha_cierre: null }, { fecha_cierre: { [Op.gte]: new Date() } }];
  }
  if (vista === "descartadas") where.estado_interno = "descartada";
  if (vista === "cotizadas") where.estado_interno = "cotizada";
  if (busqueda) {
    const q = `%${busqueda}%`;
    where[Op.and] = [{ [Op.or]: [{ nombre: { [Op.iLike]: q } }, { organismo: { [Op.iLike]: q } }, { codigo: { [Op.iLike]: q } }, { comuna: { [Op.iLike]: q } }] }];
  }
  const filas = await Licitacion.findAll({ where, order: [["prioridad", "DESC"], ["fecha_cierre", "ASC"], ["codigo", "ASC"]], limit: 500 });
  // Región, monto mínimo y organismos excluidos de Config. (en "Descartadas" y "Todas" se ve todo)
  const filtrar = vista === "descartadas" || vista === "todas" ? (l) => req.query.todas_regiones === "1" || mp.enRegiones(l.region, params)
    : req.query.todas_regiones === "1" ? (l) => mp.visible({ ...l.get(), region: null }, params) : (l) => mp.visible(l, params);
  const visibles = filas.filter(filtrar);
  // Cotizaciones hechas para cada proceso (por su ID de solicitud): qué empresa postuló
  const codigos = visibles.map((l) => l.codigo.toUpperCase());
  const [cots] = codigos.length ? await sequelize.query(`SELECT id, numero, empresa, estado, total, creado_por, "createdAt" AS fecha, UPPER(id_solicitud) AS sol FROM cotizaciones
    WHERE UPPER(id_solicitud) IN (:codigos) AND estado NOT IN ('rechazada','vencida') ORDER BY id`, { replacements: { codigos } }) : [[]];
  const data = visibles.map((l) => ({ ...l.get(), ficha: mp.fichaUrl(l), cotizaciones: cots.filter((c) => c.sol === l.codigo.toUpperCase()) }));
  res.json({
    ok: true,
    data: {
      licitaciones: data,
      ticket: mp.ticketConfigurado(),
      ultima_sincronizacion: params.mp_ultima_sincronizacion || null,
      regiones: params.mp_regiones,
      monto_minimo: Number(params.mp_monto_minimo) || 0,
      relevancia_minima: Number(params.mp_relevancia_minima) || 0,
      compra_agil: params.mp_compra_agil !== "0",
      sincronizando: trabajos.ultimo("mercado_publico"),
      consultas: await mp.usoConsultas(),
    },
  });
});

// GET /api/mercado-publico/licitaciones/:codigo
const detalle = handler(async (req, res) => {
  const l = await Licitacion.findByPk(req.params.codigo);
  if (!l) throw new ErrorNegocio("Licitación no encontrada", 404);
  // Si aún no tiene detalle, se pide en el momento (si Mercado Público no responde, se muestra lo que hay y el aviso)
  let aviso_mp = null;
  try { await mp.cargarDetalle(l); } catch (e) { aviso_mp = e.message; }
  const [cotizaciones] = await sequelize.query(`SELECT id, numero, empresa, estado, total, creado_por, "createdAt" AS fecha FROM cotizaciones
    WHERE UPPER(id_solicitud) = UPPER(:c) AND estado NOT IN ('rechazada','vencida') ORDER BY id`, { replacements: { c: l.codigo } });
  res.json({ ok: true, data: { ...l.get(), ficha: mp.fichaUrl(l), cotizaciones, aviso_mp } });
});

// PUT /api/mercado-publico/licitaciones/:codigo   { estado_interno, nota, cotizacion_id }
const actualizar = handler(async (req, res) => {
  const l = await Licitacion.findByPk(req.params.codigo);
  if (!l) throw new ErrorNegocio("Licitación no encontrada", 404);
  const cambios = {};
  if (req.body.estado_interno) {
    if (!["nueva", "revisada", "descartada", "cotizada"].includes(req.body.estado_interno)) throw new ErrorNegocio("Estado inválido");
    cambios.estado_interno = req.body.estado_interno;
    cambios.descarte_auto = false; // desde ahora la decisión es de una persona
  }
  if ("nota" in req.body) cambios.nota = req.body.nota || null;
  if ("cotizacion_id" in req.body) cambios.cotizacion_id = req.body.cotizacion_id || null;
  // Ficha para postular (M29, M32)
  if ("empresa_postula" in req.body) cambios.empresa_postula = ["kenott", "tactics", "ambas"].includes(req.body.empresa_postula) ? req.body.empresa_postula : null;
  if ("presupuesto" in req.body) cambios.presupuesto = Number(req.body.presupuesto) > 0 ? Math.round(Number(req.body.presupuesto)) : null;
  if ("grupos" in req.body) cambios.grupos = (Array.isArray(req.body.grupos) ? req.body.grupos : [])
    .map((g) => ({ nombre: String(g.nombre || "").trim(), monto: Math.round(Number(g.monto) || 0) })).filter((g) => g.nombre);
  for (const c of ["lugar_entrega", "criterios"]) if (c in req.body) cambios[c] = String(req.body[c] || "").trim() || null;
  if ("checklist" in req.body) cambios.checklist = (Array.isArray(req.body.checklist) ? req.body.checklist : [])
    .map((x) => ({ doc: String(x.doc || "").trim(), listo: !!x.listo })).filter((x) => x.doc);
  await l.update(cambios);
  res.json({ ok: true, data: l });
});

// POST /api/mercado-publico/traer   { codigo }  -> trae un proceso por su ID y explica por qué no aparecía
const traer = handler(async (req, res) => {
  try {
    const r = await mp.traerPorCodigo(req.body?.codigo);
    res.json({ ok: true, data: { ...r, licitacion: { ...r.licitacion.get(), ficha: mp.fichaUrl(r.licitacion) } } });
  } catch (e) {
    if (e.status) throw new ErrorNegocio(e.message, e.status);
    throw e;
  }
});

// POST /api/mercado-publico/sincronizar   -> { id } (segundo plano)
const sincronizar = handler(async (req, res) => {
  if (!mp.ticketConfigurado()) throw new ErrorNegocio("Falta configurar MERCADOPUBLICO_TICKET en Render", 503);
  // No se repite si se revisó hace menos de 30 minutos (ahorra consultas a Mercado Público)
  const params = await getParametros();
  const hace = params.mp_ultima_sincronizacion ? (Date.now() - new Date(params.mp_ultima_sincronizacion).getTime()) / 60000 : Infinity;
  if (hace < 30 && !req.body?.forzar) return res.json({ ok: true, data: { reciente: true, hace_min: Math.round(hace) } });
  const { id } = trabajos.iniciar("mercado_publico", (avisar) => mp.sincronizar({ onProgreso: avisar }));
  res.status(202).json({ ok: true, data: { id } });
});

// GET /api/mercado-publico/trabajo/:id
const trabajo = handler(async (req, res) => {
  const t = trabajos.estado(req.params.id);
  if (!t) throw new ErrorNegocio("No encontré esa sincronización (el servidor pudo reiniciarse)", 404);
  res.json({ ok: true, data: t });
});

module.exports = { listar, detalle, actualizar, sincronizar, trabajo, traer };
