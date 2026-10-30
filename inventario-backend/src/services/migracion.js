// Ajustes de datos al pasar del sistema de inventario al de ventas y cotizaciones.
// Es idempotente: se puede correr en cada arranque.
const sequelize = require("../../config/database");

async function migrar() {
  const q = (sql) => sequelize.query(sql);
  // Estados antiguos de cotización: pendiente -> cotizacion, vendida -> aceptada
  await q(`UPDATE cotizaciones SET estado = 'cotizacion' WHERE estado = 'pendiente'`);
  await q(`UPDATE cotizaciones SET estado = 'aceptada' WHERE estado = 'vendida'`);
  await q(`UPDATE cotizaciones SET fecha = "createdAt"::date WHERE fecha IS NULL`);
  await q(`UPDATE cotizaciones SET fecha_validez = fecha + COALESCE(validez_dias, 30) WHERE fecha_validez IS NULL`);
  // Nombres de proveedor en mayúsculas (nombre corto)
  await q(`UPDATE proveedores SET nombre = UPPER(TRIM(nombre)) WHERE nombre <> UPPER(TRIM(nombre))`);
}

module.exports = { migrar };
