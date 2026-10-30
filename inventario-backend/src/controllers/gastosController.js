const { Op } = require("sequelize");
const Gasto = require("../models/Gasto");
const Venta = require("../models/Venta");
const { handler, ErrorNegocio } = require("../services/erp");

const TIPOS = ["flete", "combustible", "comision", "general"];

const datos = async (b) => {
  const d = {};
  if ("fecha" in b) d.fecha = b.fecha || new Date();
  if ("tipo" in b) {
    if (!TIPOS.includes(b.tipo)) throw new ErrorNegocio("Tipo de gasto inválido");
    d.tipo = b.tipo;
  }
  if ("monto" in b) {
    if (!(Number(b.monto) > 0)) throw new ErrorNegocio("El monto debe ser mayor a 0");
    d.monto = Math.round(Number(b.monto));
  }
  if ("descripcion" in b) d.descripcion = b.descripcion || null;
  if ("comprobante" in b) d.comprobante = b.comprobante || null;
  if ("venta_id" in b) {
    d.venta_id = b.venta_id ? Number(b.venta_id) : null;
    if (d.venta_id && !(await Venta.findByPk(d.venta_id))) throw new ErrorNegocio("Venta no encontrada", 404);
  }
  return d;
};

// GET /api/gastos?mes=2026-10&venta_id=&tipo=
const getGastos = handler(async (req, res) => {
  const { mes, venta_id, tipo } = req.query;
  const where = {};
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split("-").map(Number);
    const fin = new Date(y, m, 0).getDate();
    where.fecha = { [Op.between]: [`${mes}-01`, `${mes}-${String(fin).padStart(2, "0")}`] };
  }
  if (venta_id) where.venta_id = venta_id;
  if (tipo) where.tipo = tipo;
  const gastos = await Gasto.findAll({ where, order: [["fecha", "DESC"], ["id", "DESC"]] });
  const ventas = await Venta.findAll({ where: { id: [...new Set(gastos.map((g) => g.venta_id).filter(Boolean))] }, attributes: ["id", "numero", "cliente_nombre"] });
  const vMap = new Map(ventas.map((v) => [v.id, v]));
  res.json({
    ok: true,
    data: gastos.map((g) => ({ ...g.toJSON(), venta_numero: vMap.get(g.venta_id)?.numero || null, venta_cliente: vMap.get(g.venta_id)?.cliente_nombre || null })),
  });
});

const crearGasto = handler(async (req, res) => {
  const d = await datos({ tipo: "general", ...req.body });
  if (!d.monto) throw new ErrorNegocio("Indica el monto");
  const g = await Gasto.create({ ...d, creado_por: req.usuario.nombre });
  res.status(201).json({ ok: true, data: g });
});

const actualizarGasto = handler(async (req, res) => {
  const g = await Gasto.findByPk(req.params.id);
  if (!g) throw new ErrorNegocio("Gasto no encontrado", 404);
  await g.update(await datos(req.body || {}));
  res.json({ ok: true, data: g });
});

const eliminarGasto = handler(async (req, res) => {
  const g = await Gasto.findByPk(req.params.id);
  if (!g) throw new ErrorNegocio("Gasto no encontrado", 404);
  await g.destroy();
  res.json({ ok: true, message: "Gasto eliminado" });
});

module.exports = { getGastos, crearGasto, actualizarGasto, eliminarGasto, TIPOS };
