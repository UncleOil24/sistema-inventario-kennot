const { Op } = require("sequelize");
const Proveedor = require("../models/Proveedor");
const { handler, ErrorNegocio } = require("../services/erp");

const CAMPOS = ["nombre", "rut", "telefono", "email", "direccion", "rubro", "notas"];
const pick = (body) => Object.fromEntries(CAMPOS.filter((c) => c in body).map((c) => [c, body[c]]));

// GET /api/proveedores
const getProveedores = handler(async (req, res) => {
  const { busqueda } = req.query;
  const where = {};
  if (busqueda) {
    where[Op.or] = ["nombre", "rut", "rubro"].map((c) => ({ [c]: { [Op.iLike]: `%${busqueda}%` } }));
  }
  const data = await Proveedor.findAll({ where, order: [["nombre", "ASC"]] });
  res.json({ ok: true, data });
});

// POST /api/proveedores
const crearProveedor = handler(async (req, res) => {
  if (!req.body.nombre) throw new ErrorNegocio("Nombre requerido");
  const data = await Proveedor.create(pick(req.body));
  res.status(201).json({ ok: true, data });
});

// PUT /api/proveedores/:id
const actualizarProveedor = handler(async (req, res) => {
  const prov = await Proveedor.findByPk(req.params.id);
  if (!prov) throw new ErrorNegocio("Proveedor no encontrado", 404);
  await prov.update(pick(req.body));
  res.json({ ok: true, data: prov });
});

// DELETE /api/proveedores/:id
// Las órdenes de compra guardan el nombre del proveedor, así que no se pierde historial.
const eliminarProveedor = handler(async (req, res) => {
  const prov = await Proveedor.findByPk(req.params.id);
  if (!prov) throw new ErrorNegocio("Proveedor no encontrado", 404);
  await prov.destroy();
  res.json({ ok: true, message: "Proveedor eliminado" });
});

module.exports = { getProveedores, crearProveedor, actualizarProveedor, eliminarProveedor };
