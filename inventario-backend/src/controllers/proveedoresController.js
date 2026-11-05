const { firma } = require("../middlewares/auth");
const { Op } = require("sequelize");
const Proveedor = require("../models/Proveedor");
const { handler, ErrorNegocio } = require("../services/erp");
const sequelize = require("../../config/database");
const Producto = require("../models/Producto");
const { recalcular } = require("../services/precios");
const { esGerencia } = require("../middlewares/auth");

// Recalcula el precio vigente de los productos que tienen precios de este proveedor
const recalcularDeProveedor = async (nombre, usuario, motivo) => {
  const [filas] = await sequelize.query(`SELECT DISTINCT producto_id FROM precios_proveedor WHERE UPPER(TRIM(proveedor)) = UPPER(TRIM(:n))`, { replacements: { n: nombre } });
  for (const { producto_id } of filas) {
    await sequelize.transaction(async (t) => {
      const p = await Producto.findByPk(producto_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (p) await recalcular(p, { t, usuario, motivo });
    });
  }
  return filas.length;
};

const CAMPOS = ["nombre", "razon_social", "rut", "contacto", "telefono", "email", "direccion", "comuna", "rubro", "tipo", "notas", "excluido", "motivo_exclusion"];
const pick = (body) => {
  const d = Object.fromEntries(CAMPOS.filter((c) => c in body).map((c) => [c, body[c]]));
  if (d.nombre) d.nombre = String(d.nombre).trim().toUpperCase(); // nombre corto: MADESUR, CYC...
  if ("tipo" in d) d.tipo = d.tipo === "web" ? "web" : "proveedor";
  if ("excluido" in d) d.excluido = !!d.excluido;
  return d;
};

// GET /api/proveedores
const getProveedores = handler(async (req, res) => {
  const { busqueda } = req.query;
  const where = {};
  if (busqueda) {
    where[Op.or] = ["nombre", "razon_social", "rut", "rubro", "contacto"].map((c) => ({ [c]: { [Op.iLike]: `%${busqueda}%` } }));
  }
  const data = await Proveedor.findAll({ where, order: [["nombre", "ASC"]] });
  res.json({ ok: true, data });
});

// POST /api/proveedores
const crearProveedor = handler(async (req, res) => {
  if (!req.body.nombre) throw new ErrorNegocio("Nombre requerido");
  const datos = pick(req.body);
  if (!esGerencia(req)) { delete datos.excluido; delete datos.motivo_exclusion; }
  const data = await Proveedor.create(datos);
  res.status(201).json({ ok: true, data });
});

// PUT /api/proveedores/:id
const actualizarProveedor = handler(async (req, res) => {
  const prov = await Proveedor.findByPk(req.params.id);
  if (!prov) throw new ErrorNegocio("Proveedor no encontrado", 404);
  const antes = prov.excluido;
  const datos = pick(req.body);
  if (!esGerencia(req)) { delete datos.excluido; delete datos.motivo_exclusion; } // excluir proveedores lo decide gerencia
  await prov.update(datos);
  // Excluir o volver a incluir un proveedor (M7) cambia el precio vigente de sus productos
  if (antes !== prov.excluido) await recalcularDeProveedor(prov.nombre, firma(req), prov.excluido ? `Proveedor ${prov.nombre} excluido` : `Proveedor ${prov.nombre} vuelve a competir`);
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

module.exports = {
  recalcularDeProveedor, getProveedores, crearProveedor, actualizarProveedor, eliminarProveedor };
