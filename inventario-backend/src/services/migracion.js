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
  // El índice único antiguo (empresa, numero) lo reemplaza uno que solo cuenta las cotizaciones nuevas
  await q(`DROP INDEX IF EXISTS cotizaciones_empresa_numero_uq`);
  await q(`ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_empresa_numero_uq`);
  await reinicioCotizaciones(q);
  await codigosClientes(q);
}

// Una sola vez (decisión de gerencia, nov-2026): las cotizaciones parten de cero en N°100 en ambas empresas.
// Se conservan las de la última semana (desde el 28-10-2026) y todas las que están conectadas con algo
// (ventas, licitaciones); quedan marcadas como "anteriores". Las demás se borran, con respaldo en
// la tabla cotizaciones_eliminadas por si hubiera que recuperar alguna.
async function reinicioCotizaciones(q) {
  const [[hecho]] = await sequelize.query(`SELECT valor FROM parametros WHERE clave = 'migracion_cotizaciones_100'`);
  if (hecho) return;
  await sequelize.transaction(async (t) => {
    const qt = (sql) => sequelize.query(sql, { transaction: t });
    const conservar = `(c.fecha >= DATE '2026-10-28' OR c."createdAt" >= TIMESTAMP '2026-10-28'
      OR c.venta_id IS NOT NULL OR c.estado = 'aceptada'
      OR EXISTS (SELECT 1 FROM ventas v WHERE v.cotizacion_id = c.id)
      OR EXISTS (SELECT 1 FROM licitaciones l WHERE l.cotizacion_id = c.id))`;
    await qt(`CREATE TABLE IF NOT EXISTS cotizaciones_eliminadas AS SELECT * FROM cotizaciones WITH NO DATA`);
    await qt(`INSERT INTO cotizaciones_eliminadas SELECT c.* FROM cotizaciones c WHERE NOT ${conservar}`);
    const [, borradas] = await qt(`DELETE FROM cotizaciones c WHERE NOT ${conservar}`);
    await qt(`UPDATE cotizaciones SET anterior = true`);
    for (const clave of ["ultimo_numero_cotizacion", "tactics_ultimo_numero_cotizacion"]) {
      await qt(`INSERT INTO parametros (clave, valor, "createdAt", "updatedAt") VALUES ('${clave}', '99', NOW(), NOW())
        ON CONFLICT (clave) DO UPDATE SET valor = '99', "updatedAt" = NOW()`);
    }
    await qt(`INSERT INTO parametros (clave, valor, "createdAt", "updatedAt") VALUES ('migracion_cotizaciones_100', NOW()::text, NOW(), NOW())`);
    console.log(`✓ Cotizaciones reiniciadas en N°100 (${borradas?.rowCount ?? "?"} antiguas borradas, con respaldo)`);
  });
}

// Cada cliente tiene su ID: los que no tienen quedan P-001, P-002...; existe el "Cliente general" (CG)
async function codigosClientes(q) {
  await q(`INSERT INTO clientes (codigo, nombre, tipo, "createdAt", "updatedAt")
    SELECT 'CG', 'Cliente general', 'particular', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM clientes WHERE codigo = 'CG')`);
  await q(`WITH base AS (SELECT COALESCE(MAX(SUBSTRING(codigo FROM 3)::int), 0) AS n FROM clientes WHERE codigo ~ '^P-[0-9]+$'),
    nuevos AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS k FROM clientes WHERE codigo IS NULL OR TRIM(codigo) = '')
    UPDATE clientes c SET codigo = 'P-' || LPAD((base.n + nuevos.k)::text, 3, '0') FROM nuevos, base WHERE c.id = nuevos.id`);
}

module.exports = { migrar };
