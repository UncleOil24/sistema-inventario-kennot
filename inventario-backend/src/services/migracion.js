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
  await recorridoVentas();
  await catalogoPaso7();
  // "Cotizada" solo si de verdad existe una cotización con el ID del proceso (antes se marcaba al abrir el cotizador)
  await q(`UPDATE licitaciones l SET estado_interno = 'revisada' WHERE estado_interno = 'cotizada'
    AND NOT EXISTS (SELECT 1 FROM cotizaciones c WHERE UPPER(c.id_solicitud) = UPPER(l.codigo) AND c.estado NOT IN ('rechazada','vencida'))`);
  await idsDeClientes(q);
  // Finanzas fase 2: cada compra y gasto pertenece a la empresa de su venta; la fecha de la factura del proveedor
  // (para el IVA) es la de recepción si no se anotó otra
  await q(`UPDATE ordenes_compra o SET empresa = v.empresa FROM ventas v WHERE o.venta_id = v.id AND o.empresa IS NULL`);
  await q(`UPDATE ordenes_compra SET fecha_factura = COALESCE(fecha_recepcion::date, fecha) WHERE documento IS NOT NULL AND fecha_factura IS NULL`);
  await q(`UPDATE gastos g SET empresa = v.empresa FROM ventas v WHERE g.venta_id = v.id AND g.empresa IS NULL`);
  // Ventas anteriores al plazo por cliente: su plazo es el que tenían (vencimiento − fecha)
  await q(`UPDATE ventas SET plazo_pago_dias = GREATEST(fecha_vencimiento - fecha, 0) WHERE plazo_pago_dias IS NULL AND fecha_vencimiento IS NOT NULL`);
}

// Paso 7 (catálogo): unidad de medida de la lista cerrada (M11) y Brizz Pinturas excluido (M7)
async function catalogoPaso7() {
  // (Ya no se normalizan las unidades al iniciar: cambiaba BOLSA, PACK o PLANCHA por SACO o PLIEGO. La unidad se guarda tal cual.)
  const [[hecho]] = await sequelize.query(`SELECT valor FROM parametros WHERE clave = 'migracion_catalogo_paso7'`);
  if (hecho) return;
  const [brizz] = await sequelize.query(`UPDATE proveedores SET excluido = true, motivo_exclusion = 'Es de Santiago: el flete sale más caro' WHERE nombre ILIKE 'BRIZZ%' RETURNING nombre`);
  const { recalcularDeProveedor } = require("../controllers/proveedoresController");
  for (const b of brizz) await recalcularDeProveedor(b.nombre, "Sistema", "Proveedor excluido (flete desde Santiago)");
  await sequelize.query(`INSERT INTO parametros (clave, valor, "createdAt", "updatedAt") VALUES ('migracion_catalogo_paso7', NOW()::text, NOW(), NOW())`);
}

// ID de cada cliente = unidad de compra de Mercado Público (cifras antes del primer guion del ID de la solicitud).
// Se asigna a los clientes que tienen un ID automático (P-###) cuando alguna de sus cotizaciones o ventas trae un
// ID de Mercado Público; también se completa el ID de las cotizaciones y ventas que no tenían.
async function idsDeClientes(q) {
  await q(`UPDATE cotizaciones c SET id_solicitud = l.codigo FROM licitaciones l WHERE l.cotizacion_id = c.id AND c.id_solicitud IS NULL`);
  await q(`UPDATE cotizaciones c SET id_solicitud = cl.codigo FROM clientes cl WHERE c.cliente_id = cl.id AND c.id_solicitud IS NULL AND cl.codigo IS NOT NULL AND cl.codigo <> 'P-001'`);
  await q(`UPDATE ventas v SET id_solicitud = c.id_solicitud FROM cotizaciones c WHERE v.cotizacion_id = c.id AND v.id_solicitud IS NULL AND c.id_solicitud IS NOT NULL`);
  const { asignarUnidadCliente } = require("./clientesMP");
  const [filas] = await sequelize.query(`SELECT DISTINCT ON (cliente_id) cliente_id, id_solicitud FROM (
      SELECT cliente_id, id_solicitud, "createdAt" FROM cotizaciones UNION ALL SELECT cliente_id, id_solicitud, "createdAt" FROM ventas) x
    JOIN clientes cl ON cl.id = x.cliente_id
    WHERE x.cliente_id IS NOT NULL AND x.id_solicitud ~ '^[0-9]+-[0-9]+-[A-Za-z]' AND cl.codigo ~ '^P-[0-9]+$'
    ORDER BY cliente_id, x."createdAt" DESC`);
  for (const f of filas) await asignarUnidadCliente(f.cliente_id, f.id_solicitud);
}

// Una sola vez (paso 3, nov-2026): cada venta toma su etapa según cómo va, el N° de factura que tenía pasa
// a ser una factura registrada, y se deshacen los "proyectos" que juntaban varias OC (una OC = una venta).
async function recorridoVentas() {
  const [[hecho]] = await sequelize.query(`SELECT valor FROM parametros WHERE clave = 'migracion_recorrido_ventas'`);
  if (hecho) return;
  await sequelize.transaction(async (t) => {
    const qt = (sql) => sequelize.query(sql, { transaction: t });
    // Facturas: el N° que estaba en "documento" queda como una factura por el total
    await qt(`INSERT INTO facturas (venta_id, numero, fecha, monto, notas, creado_por, "createdAt", "updatedAt")
      SELECT id, TRIM(documento), fecha, total, 'Traspasada del sistema anterior', creado_por, NOW(), NOW()
        FROM ventas v WHERE estado <> 'anulada' AND documento IS NOT NULL AND TRIM(documento) <> ''
         AND NOT EXISTS (SELECT 1 FROM facturas f WHERE f.venta_id = v.id)`);
    await qt(`UPDATE ventas v SET monto_facturado = s.monto,
        estado_factura = CASE WHEN s.monto >= v.total - 1 THEN 'facturada' ELSE 'parcial' END
      FROM (SELECT venta_id, SUM(monto) AS monto FROM facturas GROUP BY venta_id) s WHERE s.venta_id = v.id`);
    // Compras consolidadas de un proyecto con una sola venta: pasan a esa venta
    await qt(`UPDATE ordenes_compra o SET venta_id = p.venta_id
      FROM (SELECT proyecto_id, MIN(id) AS venta_id FROM ventas WHERE proyecto_id IS NOT NULL AND estado <> 'anulada'
             GROUP BY proyecto_id HAVING COUNT(*) = 1) p
     WHERE o.proyecto_id = p.proyecto_id AND o.venta_id IS NULL`);
    await qt(`UPDATE ventas SET proyecto_id = NULL WHERE proyecto_id IS NOT NULL`);
    await qt(`UPDATE ordenes_compra SET proyecto_id = NULL WHERE proyecto_id IS NOT NULL`);
    // Etapa según las compras: todas recibidas -> lista; con compras -> aceptada; sin compras -> registrada.
    // Las ya pagadas por el cliente se dan por entregadas.
    await qt(`UPDATE ventas v SET etapa = CASE
        WHEN v.estado_pago = 'pagada' THEN 'entregada'
        WHEN c.n > 0 AND c.n = c.recibidas THEN 'lista'
        WHEN c.n > 0 THEN 'aceptada'
        ELSE 'registrada' END,
        aceptada_fecha = CASE WHEN c.n > 0 OR v.estado_pago = 'pagada' THEN v."createdAt" END,
        lista_fecha = CASE WHEN (c.n > 0 AND c.n = c.recibidas) OR v.estado_pago = 'pagada' THEN v."updatedAt" END
      FROM (SELECT v2.id, COUNT(o.id) AS n, COUNT(o.id) FILTER (WHERE o.estado = 'recibida') AS recibidas
              FROM ventas v2 LEFT JOIN ordenes_compra o ON o.venta_id = v2.id AND o.estado <> 'anulada' GROUP BY v2.id) c
     WHERE c.id = v.id`);
    await qt(`INSERT INTO parametros (clave, valor, "createdAt", "updatedAt") VALUES ('migracion_recorrido_ventas', NOW()::text, NOW(), NOW())`);
    console.log("✓ Ventas con etapas y facturas (recorrido nuevo)");
  });
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

// Cada cliente tiene su ID: los que no tienen quedan P-002, P-003...; el "Cliente general" es P-001
async function codigosClientes(q) {
  // Reinicio de clientes (decisión de gerencia, 10-nov-2026): se borran todos y queda solo el Cliente general con
  // el ID P-001, para volver a ingresarlos ordenados por su ID. Las cotizaciones y ventas conservan el nombre escrito.
  const [[reinicio]] = await sequelize.query(`SELECT valor FROM parametros WHERE clave = 'migracion_clientes_reinicio'`);
  if (!reinicio) {
    await sequelize.transaction(async (t) => {
      const tq = (s) => sequelize.query(s, { transaction: t });
      await tq(`CREATE TABLE IF NOT EXISTS clientes_eliminados AS SELECT * FROM clientes WHERE false`);
      await tq(`INSERT INTO clientes_eliminados SELECT * FROM clientes WHERE NOT (codigo IN ('CG','P-001') OR nombre ILIKE 'cliente general')`);
      await tq(`UPDATE cotizaciones SET cliente_id = NULL WHERE cliente_id IN (SELECT id FROM clientes WHERE NOT (codigo IN ('CG','P-001') OR nombre ILIKE 'cliente general'))`);
      await tq(`UPDATE ventas SET cliente_id = NULL WHERE cliente_id IN (SELECT id FROM clientes WHERE NOT (codigo IN ('CG','P-001') OR nombre ILIKE 'cliente general'))`);
      const [, r] = await tq(`DELETE FROM clientes WHERE NOT (codigo IN ('CG','P-001') OR nombre ILIKE 'cliente general')`);
      await tq(`DELETE FROM clientes WHERE id NOT IN (SELECT MIN(id) FROM clientes)`);
      await tq(`UPDATE clientes SET codigo = 'P-001'`);
      await tq(`INSERT INTO parametros (clave, valor, "createdAt", "updatedAt") VALUES ('migracion_clientes_reinicio', '${new Date().toISOString()}', NOW(), NOW())`);
      console.log(`✓ Clientes reiniciados: ${r?.rowCount ?? "?"} borrados (respaldo en clientes_eliminados); queda Cliente general P-001`);
    });
  }
  // 10-nov-2026: el Cliente general (P-001) se editó como Ejército de Chile. Ese cliente pasa a su unidad de compra
  // 3385 (Mercado Público 3385-100-COT26) y se crea de nuevo el Cliente general P-001 para ventas al público.
  const [[ejercito]] = await sequelize.query(`SELECT valor FROM parametros WHERE clave = 'migracion_cliente_3385'`);
  if (!ejercito) {
    await sequelize.transaction(async (t) => {
      const tq = (s) => sequelize.query(s, { transaction: t });
      const [filas] = await tq(`SELECT id FROM clientes WHERE codigo = 'P-001' AND nombre NOT ILIKE 'cliente general'`);
      const [[ocupado]] = await tq(`SELECT COUNT(*)::int AS n FROM clientes WHERE codigo = '3385'`);
      if (filas.length && !ocupado.n) {
        const id = filas[0].id;
        await tq(`UPDATE clientes SET codigo = '3385' WHERE id = ${Number(id)}`);
        for (const tabla of ["cotizaciones", "ventas"]) await tq(`UPDATE ${tabla} SET id_solicitud = '3385' WHERE cliente_id = ${Number(id)} AND (id_solicitud IS NULL OR id_solicitud = 'P-001')`);
        console.log("✓ Cliente P-001 (Ejército) pasa a ID 3385; se crea de nuevo el Cliente general P-001");
      }
      await tq(`INSERT INTO parametros (clave, valor, "createdAt", "updatedAt") VALUES ('migracion_cliente_3385', '${new Date().toISOString()}', NOW(), NOW())`);
    });
  }
  // Facturas ingresadas por el NETO: la venta quedaba "parcial" con lo facturado igual al neto. Se corrige la última
  // factura al total con IVA y la venta queda facturada (idempotente).
  const [netos] = await q(`SELECT v.id, v.total, v.monto_facturado FROM ventas v
    WHERE v.estado <> 'anulada' AND v.estado_factura = 'parcial' AND v.total > v.subtotal + 1 AND ABS(v.monto_facturado - v.subtotal) <= 2`);
  for (const v of netos) {
    const dif = Math.round(Number(v.total) - Number(v.monto_facturado));
    await q(`UPDATE facturas SET monto = monto + ${dif}, notas = TRIM(COALESCE(notas, '') || ' (se había ingresado el neto; corregido al total con IVA)')
      WHERE id = (SELECT id FROM facturas WHERE venta_id = ${Number(v.id)} ORDER BY fecha DESC, id DESC LIMIT 1)`);
    await q(`UPDATE ventas SET monto_facturado = total, estado_factura = 'facturada' WHERE id = ${Number(v.id)}`);
    console.log(`✓ Venta ${v.id}: factura ingresada por el neto, corregida al total con IVA`);
  }
  // Unidades que antes se cambiaban mal (BOLSA→SACO, PLANCHA→PLIEGO): se corrigen una vez según la descripción.
  // Las demás las corrige la próxima planilla que se importe (la unidad de la planilla manda).
  const [[uniHecha]] = await sequelize.query(`SELECT valor FROM parametros WHERE clave = 'migracion_unidades_bolsa'`);
  if (!uniHecha) {
    const reglas = [["BOLSA", "SACO", "\\mBOLSAS?\\M"], ["PLANCHA", "PLIEGO", "\\mPLANCHAS?\\M"], ["PACK", "UNIDAD", "\\m(PACK|PAQUETE)S?\\M"]];
    for (const [nueva, vieja, patron] of reglas) {
      const [filas] = await q(`UPDATE productos SET unidad = '${nueva}' WHERE unidad = '${vieja}' AND nombre ~* '${patron}' RETURNING id`);
      if (filas.length) {
        await q(`INSERT INTO registro_cambios (usuario, tabla, registro_id, campo, antes, despues, motivo, "createdAt")
          SELECT 'sistema', 'productos', id, 'unidad', '${vieja}', '${nueva}', 'Corrección de unidad (antes se cambiaba al importar)', NOW() FROM productos WHERE id IN (${filas.map((f) => Number(f.id)).join(",")})`);
        console.log(`✓ Unidad ${vieja} → ${nueva}: ${filas.length} productos`);
      }
    }
    await q(`INSERT INTO parametros (clave, valor, "createdAt", "updatedAt") VALUES ('migracion_unidades_bolsa', '${new Date().toISOString()}', NOW(), NOW())`);
  }
  // Gerencia (11-nov-2026): eliminar el registro cargado por error (no es un producto). Si estuviera usado en algún
  // documento, solo se desactiva para no dejar líneas rotas. Queda en el registro de cambios.
  const [[elimHecho]] = await sequelize.query(`SELECT valor FROM parametros WHERE clave = 'eliminar_producto_liceo'`);
  if (!elimHecho) {
    const [malos] = await q(`SELECT id, codigo, nombre, categoria, precio_compra, proveedor FROM productos
      WHERE UPPER(TRIM(nombre)) LIKE 'MATERIALES DE FERRETER%PARA EL ESTABLECIMIENTO EDUCACIONAL LICEO BICENTENARIO POLIT%'`);
    for (const p of malos) {
      const [[uso]] = await q(`SELECT
        (SELECT COUNT(*) FROM cotizaciones WHERE jsonb_path_exists(items, '$[*] ? (@.producto_id == ${Number(p.id)})'))
        + (SELECT COUNT(*) FROM ventas WHERE jsonb_path_exists(items, '$[*] ? (@.producto_id == ${Number(p.id)})'))
        + (SELECT COUNT(*) FROM ordenes_compra WHERE jsonb_path_exists(items, '$[*] ? (@.producto_id == ${Number(p.id)})')) AS n`);
      const detalle = `${p.nombre} · ${p.categoria} · $${Math.round(Number(p.precio_compra) || 0)} · ${p.proveedor || ""}`.slice(0, 250);
      if (Number(uso.n) > 0) {
        await q(`UPDATE productos SET activo = false WHERE id = ${Number(p.id)}`);
        await q(`INSERT INTO registro_cambios (usuario, tabla, registro_id, campo, antes, despues, motivo, "createdAt") VALUES ('Gerencia', 'productos', ${Number(p.id)}, 'activo', 'true', 'false', 'Cargado por error (no es un producto). Usado en ${Number(uso.n)} documento(s): se desactiva en vez de eliminar', NOW())`);
        console.log(`✓ Producto ${p.id} desactivado (usado en ${uso.n} documentos)`);
      } else {
        await q(`DELETE FROM precios_proveedor WHERE producto_id = ${Number(p.id)}`);
        await q(`DELETE FROM productos WHERE id = ${Number(p.id)}`);
        await sequelize.query(`INSERT INTO registro_cambios (usuario, tabla, registro_id, campo, antes, despues, motivo, "createdAt") VALUES ('Gerencia', 'productos', :id, 'eliminado', :antes, 'eliminado', 'Cargado por error (no es un producto). Eliminación autorizada por gerencia', NOW())`, { replacements: { id: p.id, antes: detalle } });
        console.log(`✓ Producto ${p.id} eliminado (cargado por error)`);
      }
    }
    await q(`INSERT INTO parametros (clave, valor, "createdAt", "updatedAt") VALUES ('eliminar_producto_liceo', '${new Date().toISOString()}', NOW(), NOW())`);
  }
  // Nuestras compras a proveedores se numeran C-0001 (la OC es la del cliente)
  await q(`UPDATE ordenes_compra SET numero = 'C-' || SUBSTRING(numero FROM 4) WHERE numero LIKE 'OC-%'`);
  // Ventas y cotizaciones sin cliente (o con el general) cuyo ID empieza con la unidad de compra de un cliente:
  // se asocian a ese cliente (ej. V-0001 Regimiento Linares → Ejército de Chile 3385). Es idempotente.
  await q(`UPDATE ventas v SET cliente_id = c.id, cliente_nombre = c.nombre FROM clientes c
    WHERE c.codigo ~ '^[0-9]+$' AND SPLIT_PART(TRIM(v.id_solicitud), '-', 1) = c.codigo
      AND (v.cliente_id IS NULL OR v.cliente_id IN (SELECT id FROM clientes WHERE codigo IN ('P-001','CG')) OR v.cliente_id NOT IN (SELECT id FROM clientes))`);
  // Igual con el N° de OC de Mercado Público (su primer número también es la unidad de compra), si la venta no tiene ID
  await q(`UPDATE ventas v SET cliente_id = c.id, cliente_nombre = c.nombre, id_solicitud = COALESCE(NULLIF(TRIM(v.id_solicitud), ''), c.codigo) FROM clientes c
    WHERE c.codigo ~ '^[0-9]+$' AND v.orden_compra_cliente ~ '^[0-9]+-[0-9]+-[A-Za-z]' AND SPLIT_PART(TRIM(v.orden_compra_cliente), '-', 1) = c.codigo
      AND (v.id_solicitud IS NULL OR TRIM(v.id_solicitud) = '' OR v.id_solicitud ~ '^P-')
      AND (v.cliente_id IS NULL OR v.cliente_id IN (SELECT id FROM clientes WHERE codigo IN ('P-001','CG')) OR v.cliente_id NOT IN (SELECT id FROM clientes))`);
  await q(`UPDATE cotizaciones z SET cliente_id = c.id FROM clientes c
    WHERE c.codigo ~ '^[0-9]+$' AND SPLIT_PART(TRIM(z.id_solicitud), '-', 1) = c.codigo
      AND (z.cliente_id IS NULL OR z.cliente_id IN (SELECT id FROM clientes WHERE codigo IN ('P-001','CG')) OR z.cliente_id NOT IN (SELECT id FROM clientes))`);
  await q(`INSERT INTO clientes (codigo, nombre, tipo, "createdAt", "updatedAt")
    SELECT 'P-001', 'Cliente general', 'particular', NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM clientes WHERE codigo = 'P-001')`);
  await q(`WITH base AS (SELECT COALESCE(MAX(SUBSTRING(codigo FROM 3)::int), 0) AS n FROM clientes WHERE codigo ~ '^P-[0-9]+$'),
    nuevos AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS k FROM clientes WHERE codigo IS NULL OR TRIM(codigo) = '')
    UPDATE clientes c SET codigo = 'P-' || LPAD((base.n + nuevos.k)::text, 3, '0') FROM nuevos, base WHERE c.id = nuevos.id`);
}

module.exports = { migrar };
