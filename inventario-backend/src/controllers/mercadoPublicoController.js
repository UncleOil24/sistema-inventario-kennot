const { Op } = require("sequelize");
const Licitacion = require("../models/Licitacion");
const { handler, ErrorNegocio } = require("../services/erp");
const mp = require("../services/mercadoPublico");
const trabajos = require("../services/trabajos");
const { getParametros } = require("../services/parametros");

// GET /api/mercado-publico/licitaciones?vista=nuevas|abiertas|cotizadas|descartadas|todas&fuente=compra_agil|licitacion&busqueda=&todas_regiones=1
const listar = handler(async (req, res) => {
  const params = await getParametros();
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
  const data = filas.filter(filtrar).map((l) => ({ ...l.get(), ficha: mp.fichaUrl(l) }));
  res.json({
    ok: true,
    data: {
      licitaciones: data,
      ticket: mp.ticketConfigurado(),
      ultima_sincronizacion: params.mp_ultima_sincronizacion || null,
      regiones: params.mp_regiones,
      monto_minimo: Number(params.mp_monto_minimo) || 0,
      compra_agil: params.mp_compra_agil !== "0",
      sincronizando: trabajos.ultimo("mercado_publico"),
    },
  });
});

// GET /api/mercado-publico/licitaciones/:codigo
const detalle = handler(async (req, res) => {
  const l = await Licitacion.findByPk(req.params.codigo);
  if (!l) throw new ErrorNegocio("Licitación no encontrada", 404);
  // Si aún no tiene detalle, se pide en el momento
  await mp.cargarDetalle(l);
  res.json({ ok: true, data: { ...l.get(), ficha: mp.fichaUrl(l) } });
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
  await l.update(cambios);
  res.json({ ok: true, data: l });
});

// POST /api/mercado-publico/sincronizar   -> { id } (segundo plano)
const sincronizar = handler(async (req, res) => {
  if (!mp.ticketConfigurado()) throw new ErrorNegocio("Falta configurar MERCADOPUBLICO_TICKET en Render", 503);
  const { id } = trabajos.iniciar("mercado_publico", (avisar) => mp.sincronizar({ onProgreso: avisar }));
  res.status(202).json({ ok: true, data: { id } });
});

// GET /api/mercado-publico/trabajo/:id
const trabajo = handler(async (req, res) => {
  const t = trabajos.estado(req.params.id);
  if (!t) throw new ErrorNegocio("No encontré esa sincronización (el servidor pudo reiniciarse)", 404);
  res.json({ ok: true, data: t });
});

module.exports = { listar, detalle, actualizar, sincronizar, trabajo };
