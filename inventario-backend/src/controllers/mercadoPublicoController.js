const { Op } = require("sequelize");
const Licitacion = require("../models/Licitacion");
const { handler, ErrorNegocio } = require("../services/erp");
const mp = require("../services/mercadoPublico");
const trabajos = require("../services/trabajos");
const { getParametros } = require("../services/parametros");

// GET /api/mercado-publico/licitaciones?vista=abiertas|todas|descartadas&busqueda=&todas_regiones=1
const listar = handler(async (req, res) => {
  const params = await getParametros();
  const { vista = "abiertas", busqueda } = req.query;
  const where = {};
  if (vista === "abiertas") {
    where.estado_interno = { [Op.ne]: "descartada" };
    where[Op.or] = [{ fecha_cierre: null }, { fecha_cierre: { [Op.gte]: new Date() } }];
  }
  if (vista === "descartadas") where.estado_interno = "descartada";
  if (vista === "cotizadas") where.estado_interno = "cotizada";
  if (busqueda) {
    const q = `%${busqueda}%`;
    where[Op.and] = [{ [Op.or]: [{ nombre: { [Op.iLike]: q } }, { organismo: { [Op.iLike]: q } }, { codigo: { [Op.iLike]: q } }, { comuna: { [Op.iLike]: q } }] }];
  }
  const filas = await Licitacion.findAll({ where, order: [["fecha_cierre", "ASC"], ["codigo", "ASC"]], limit: 500 });
  const data = req.query.todas_regiones === "1" ? filas : filas.filter((l) => mp.enRegiones(l.region, params));
  res.json({
    ok: true,
    data: {
      licitaciones: data,
      ticket: mp.ticketConfigurado(),
      ultima_sincronizacion: params.mp_ultima_sincronizacion || null,
      regiones: params.mp_regiones,
      sincronizando: trabajos.ultimo("mercado_publico"),
    },
  });
});

// GET /api/mercado-publico/licitaciones/:codigo
const detalle = handler(async (req, res) => {
  const l = await Licitacion.findByPk(req.params.codigo);
  if (!l) throw new ErrorNegocio("Licitación no encontrada", 404);
  // Si aún no tiene detalle, se pide en el momento
  if (!l.detalle_cargado && mp.ticketConfigurado()) {
    const d = await mp.pedir({ codigo: l.codigo });
    const x = (d.Listado || [])[0];
    if (x) await l.update(mp.desdeDetalle(x));
  }
  res.json({ ok: true, data: l });
});

// PUT /api/mercado-publico/licitaciones/:codigo   { estado_interno, nota, cotizacion_id }
const actualizar = handler(async (req, res) => {
  const l = await Licitacion.findByPk(req.params.codigo);
  if (!l) throw new ErrorNegocio("Licitación no encontrada", 404);
  const cambios = {};
  if (req.body.estado_interno) {
    if (!["nueva", "revisada", "descartada", "cotizada"].includes(req.body.estado_interno)) throw new ErrorNegocio("Estado inválido");
    cambios.estado_interno = req.body.estado_interno;
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
