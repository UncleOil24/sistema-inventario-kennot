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
  // El N° de cotización ya no es único global sino por empresa (Kenott y Tactics llevan su propia numeración):
  // se borran los índices/restricciones únicos que eran solo sobre "numero"
  const [unicos] = await sequelize.query(`
    SELECT con.conname AS nombre, 'constraint' AS tipo FROM pg_constraint con
      JOIN pg_class t ON t.oid = con.conrelid
     WHERE t.relname = 'cotizaciones' AND con.contype = 'u'
       AND array_length(con.conkey, 1) = 1
       AND (SELECT attname FROM pg_attribute WHERE attrelid = t.oid AND attnum = con.conkey[1]) = 'numero'
    UNION
    SELECT i.relname, 'index' FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
     WHERE t.relname = 'cotizaciones' AND x.indisunique AND NOT x.indisprimary AND x.indnatts = 1
       AND (SELECT attname FROM pg_attribute WHERE attrelid = t.oid AND attnum = x.indkey[0]) = 'numero'
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)`);
  for (const u of unicos) {
    await q(u.tipo === "constraint" ? `ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS "${u.nombre}"` : `DROP INDEX IF EXISTS "${u.nombre}"`);
  }
  // Ventas que nacieron de una cotización: misma empresa
  await q(`UPDATE ventas v SET empresa = c.empresa FROM cotizaciones c WHERE v.cotizacion_id = c.id AND v.empresa <> c.empresa`);
  // Nombres de proveedor en mayúsculas (nombre corto)
  await q(`UPDATE proveedores SET nombre = UPPER(TRIM(nombre)) WHERE nombre <> UPPER(TRIM(nombre))`);
}

module.exports = { migrar };
