// El ID de un cliente institucional es su unidad de compra de Mercado Público: las cifras antes del primer guion
// del ID de la solicitud (1422-20-COT26 → 1422). Si el cliente tiene un ID automático (P-###) y cotizamos o vendemos
// con un ID de Mercado Público, el cliente toma la unidad de compra como ID (si nadie más la tiene).
// Un ID puesto a mano (que no sea P-###) no se toca.
const sequelize = require("../../config/database");
const Cliente = require("../models/Cliente");

const unidadDe = (idSolicitud) => {
  const m = String(idSolicitud || "").trim().match(/^(\d+)-\d+-[A-Z]/i);
  return m ? m[1] : null;
};

async function asignarUnidadCliente(clienteId, idSolicitud, t) {
  const unidad = unidadDe(idSolicitud);
  if (!clienteId || !unidad) return null;
  const c = await Cliente.findByPk(clienteId, { transaction: t });
  if (!c || !/^P-\d+$/.test(c.codigo || "")) return null;
  const otro = await Cliente.findOne({ where: { codigo: unidad }, transaction: t });
  if (otro) return null;
  const viejo = c.codigo;
  await c.update({ codigo: unidad }, { transaction: t });
  // Las cotizaciones y ventas que llevaban el ID antiguo del cliente pasan al nuevo
  for (const tabla of ["cotizaciones", "ventas"]) {
    await sequelize.query(`UPDATE ${tabla} SET id_solicitud = :u WHERE cliente_id = :id AND id_solicitud = :viejo`, { replacements: { u: unidad, id: c.id, viejo }, transaction: t });
  }
  return unidad;
}

module.exports = { unidadDe, asignarUnidadCliente };
