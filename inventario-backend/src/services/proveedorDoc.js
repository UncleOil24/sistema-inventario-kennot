// Proveedor de un documento: por RUT (lo más seguro, el XML siempre lo trae), por nombre, o un proveedor nuestro
// cuyo nombre aparece en la razón social ("MADESUR" en "COMERCIAL MADESUR LTDA").
const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Proveedor = require("../models/Proveedor");
const { normProv } = require("./precios");

const rutBase = (r) => String(r || "").toUpperCase().replace(/[^0-9K]/g, "").slice(0, -1);

async function proveedorDeDocumento(enc = {}) {
  const r = rutBase(enc.rut);
  if (r.length >= 7) {
    const todos = await Proveedor.findAll({ where: { rut: { [Op.ne]: null } }, attributes: ["id", "nombre", "rut"] });
    const p = todos.find((x) => rutBase(x.rut) === r);
    if (p) return p;
  }
  if (enc.proveedor) {
    const p = await Proveedor.findOne({ where: sequelize.where(sequelize.fn("upper", sequelize.col("nombre")), normProv(enc.proveedor)) });
    if (p) return p;
  }
  const razon = String(enc.razon_social || enc.proveedor || "").toUpperCase();
  if (razon.length >= 4) {
    const todos = await Proveedor.findAll({ attributes: ["id", "nombre", "rut"] });
    const cand = todos.filter((x) => String(x.nombre).length >= 4 && new RegExp(`\\b${String(x.nombre).toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(razon))
      .sort((a, b) => b.nombre.length - a.nombre.length);
    if (cand.length) return cand[0];
  }
  return null;
}

module.exports = { proveedorDeDocumento, rutBase };
