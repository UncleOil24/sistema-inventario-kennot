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

// Cambia el nombre de un proveedor en todo el sistema: historial de precios, catálogo, compras, documentos cargados,
// cuadros de compra de las ventas y cotizaciones. Después recalcula el precio vigente de sus productos.
async function propagarNombre(viejo, nuevo, { proveedorId = null, t } = {}) {
  const r = { v: viejo.trim().toUpperCase(), n: nuevo.trim().toUpperCase(), id: proveedorId };
  const q = (sql) => sequelize.query(sql, { replacements: r, transaction: t });
  await q(`UPDATE precios_proveedor SET proveedor = :n WHERE UPPER(TRIM(proveedor)) = :v`);
  for (const c of ["proveedor", "opcion2_proveedor", "opcion3_proveedor"]) await q(`UPDATE productos SET ${c} = :n WHERE UPPER(TRIM(${c})) = :v`);
  await q(`UPDATE ordenes_compra SET proveedor_nombre = :n${proveedorId ? ", proveedor_id = :id" : ""} WHERE UPPER(TRIM(proveedor_nombre)) = :v`);
  await q(`UPDATE documentos_cargados SET proveedor = :n WHERE UPPER(TRIM(proveedor)) = :v`);
  for (const tabla of ["ventas", "cotizaciones"]) {
    await q(`UPDATE ${tabla} SET items = (SELECT jsonb_agg(CASE WHEN UPPER(TRIM(x->>'proveedor')) = :v THEN jsonb_set(x, '{proveedor}', to_jsonb(:n::text)) ELSE x END ORDER BY o)
      FROM jsonb_array_elements(items) WITH ORDINALITY e(x, o)) WHERE jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0 AND UPPER(items::text) LIKE '%' || :v || '%'`);
  }
}

const CAMPOS = ["nombre", "razon_social", "rut", "contacto", "telefono", "email", "direccion", "comuna", "rubro", "tipo", "notas", "excluido", "motivo_exclusion", "plazo_pago_dias", "descuento_pronto_pago", "dias_pronto_pago"];
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
  let prov = await Proveedor.findByPk(req.params.id);
  if (!prov) throw new ErrorNegocio("Proveedor no encontrado", 404);
  const antes = prov.excluido;
  const datos = pick(req.body);
  if (!esGerencia(req)) { delete datos.excluido; delete datos.motivo_exclusion; } // excluir proveedores lo decide gerencia
  // Cambio de nombre (ej. "SIN IDENTIFICAR" -> "TIGERO"): se cambia en todo el sistema; si ya existe otro con ese nombre, se juntan
  if (datos.nombre && datos.nombre !== prov.nombre) {
    if (!esGerencia(req)) throw new ErrorNegocio("Cambiar el nombre de un proveedor lo hace gerencia (cambia sus precios en el catálogo)");
    const viejo = prov.nombre;
    const otro = await Proveedor.findOne({ where: { id: { [Op.ne]: prov.id }, [Op.and]: sequelize.where(sequelize.fn("upper", sequelize.col("nombre")), datos.nombre) } });
    await sequelize.transaction(async (t) => {
      if (otro) {
        // Se juntan: queda el que ya existía, completando los datos que le falten
        const completar = {};
        for (const c of CAMPOS) if (c !== "nombre" && !otro[c] && (datos[c] ?? prov[c])) completar[c] = datos[c] ?? prov[c];
        await otro.update(completar, { transaction: t });
        await propagarNombre(viejo, otro.nombre, { proveedorId: otro.id, t });
        await prov.destroy({ transaction: t });
      } else {
        await prov.update(datos, { transaction: t });
        await propagarNombre(viejo, prov.nombre, { t });
      }
    });
    if (otro) prov = otro;
    const n = await recalcularDeProveedor(prov.nombre, firma(req), `Proveedor ${viejo} renombrado a ${prov.nombre}`);
    return res.json({ ok: true, data: prov, juntado: !!otro, productos: n, message: otro ? `${viejo} se juntó con ${prov.nombre} (${n} productos)` : `${viejo} ahora es ${prov.nombre} (${n} productos)` });
  }
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
  recalcularDeProveedor, propagarNombre, getProveedores, crearProveedor, actualizarProveedor, eliminarProveedor };
