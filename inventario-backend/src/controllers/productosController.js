const { Op, fn, col, literal } = require("sequelize");
const sequelize = require("../../config/database");
const Producto = require("../models/Producto");
const PrecioProveedor = require("../models/PrecioProveedor");
const RegistroCambio = require("../models/RegistroCambio");
const { handler, ErrorNegocio } = require("../services/erp");
const { getParametros, precioVenta } = require("../services/parametros");
const { recalcular, precioNetoUnitario, origenDe, registrar, normProv, SQL_AVISO } = require("../services/precios");
const { esAdmin } = require("../middlewares/auth");

// Campos de costo que el rol "usuario" no ve
const CAMPOS_COSTO = [
  "precio_compra", "opcion2_proveedor", "opcion2_precio", "opcion2_fecha",
  "opcion3_proveedor", "opcion3_precio", "opcion3_fecha", "revisar", "contacto",
];
// Columnas antiguas sin uso
const CAMPOS_OCULTOS = ["precio_venta", "stock", "stock_minimo"];

// Agrega los precios de venta calculados y oculta costos si corresponde
const vista = (req, params) => (p) => {
  const j = typeof p.toJSON === "function" ? p.toJSON() : { ...p };
  j.precio_convenio = precioVenta(j.precio_compra, "convenio", params);
  j.precio_particular = precioVenta(j.precio_compra, "particular", params);
  CAMPOS_OCULTOS.forEach((c) => delete j[c]);
  if (!esAdmin(req)) CAMPOS_COSTO.forEach((c) => delete j[c]);
  return j;
};

// Palabras en cualquier orden, con o sin tilde (como el BUSCADOR de la planilla)
const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const filtroPalabras = (busqueda) => {
  const palabras = sinTildes(String(busqueda)).trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return palabras.map((w) => {
    const patron = `%${w.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const condiciones = [
      sequelize.where(fn("translate", fn("upper", col("nombre")), "ÁÉÍÓÚÜÑ", "AEIOUUN"), { [Op.iLike]: patron }),
      { proveedor: { [Op.iLike]: patron } },
    ];
    if (/^\d+$/.test(w)) condiciones.push({ codigo: Number(w) }, { id: Number(w) });
    return { [Op.or]: condiciones };
  });
};

// GET /api/productos?busqueda=&categoria=&revision=sin_precio|aviso|confirmados|sin_confirmar&activos=1&sort=&dir=&limite=
const getProductos = handler(async (req, res) => {
  const { busqueda, categoria, revision, sort = "codigo", dir = "ASC", limite } = req.query;
  const where = {};
  const y = [];
  if (busqueda) y.push(...filtroPalabras(busqueda));
  if (categoria && categoria !== "Todas") where.categoria = categoria;
  if (req.query.inactivos !== "1") where.activo = true;
  if (revision === "sin_precio") y.push({ [Op.or]: [{ precio_compra: null }, { precio_compra: { [Op.lte]: 0 } }] });
  if (revision === "aviso") y.push(literal(SQL_AVISO));
  if (revision === "confirmados") where.confirmado = true;
  if (revision === "sin_confirmar") y.push({ confirmado: false, precio_compra: { [Op.gt]: 0 } });
  if (y.length) where[Op.and] = y;

  const camposValidos = ["id", "codigo", "nombre", "categoria", "precio_compra", "proveedor", "fecha_precio"];
  const ordenBy = camposValidos.includes(sort) ? sort : "codigo";
  const ordenDir = String(dir).toUpperCase() === "DESC" ? "DESC" : "ASC";

  const [productos, params] = await Promise.all([
    Producto.findAll({
      where,
      order: [[literal(`"${ordenBy}" IS NULL`), "ASC"], [ordenBy, ordenDir], ["id", "ASC"]],
      limit: Math.min(Number(limite) || 5000, 5000),
    }),
    getParametros(),
  ]);
  res.json({ ok: true, data: productos.map(vista(req, params)) });
});

// GET /api/productos/categorias
const getCategorias = handler(async (req, res) => {
  const filas = await Producto.findAll({
    attributes: ["categoria", [fn("COUNT", col("id")), "cantidad"]],
    where: { activo: true },
    group: ["categoria"], order: [["categoria", "ASC"]], raw: true,
  });
  res.json({ ok: true, data: filas.map((f) => ({ categoria: f.categoria, cantidad: Number(f.cantidad) })) });
});

// GET /api/productos/resumen   (para la pantalla Por revisar)
const getResumen = handler(async (req, res) => {
  const [filas] = await sequelize.query(`
    SELECT categoria,
      COUNT(*)::int AS items,
      COUNT(*) FILTER (WHERE precio_compra > 0)::int AS con_precio,
      COUNT(*) FILTER (WHERE precio_compra IS NULL OR precio_compra <= 0)::int AS sin_precio,
      COUNT(*) FILTER (WHERE confirmado)::int AS confirmados,
      COUNT(*) FILTER (WHERE ${SQL_AVISO})::int AS con_aviso,
      COUNT(*) FILTER (WHERE NOT confirmado AND precio_compra > 0)::int AS sin_confirmar
    FROM productos WHERE activo GROUP BY categoria ORDER BY categoria`);
  res.json({ ok: true, data: filas });
});

// GET /api/productos/:id
const getProducto = handler(async (req, res) => {
  const producto = await Producto.findByPk(req.params.id);
  if (!producto) throw new ErrorNegocio("Producto no encontrado", 404);
  res.json({ ok: true, data: vista(req, await getParametros())(producto) });
});

const CAMPOS_EDITABLES = ["codigo", "nombre", "categoria", "unidad", "activo"];

// POST /api/productos
// Un producto parecido pero distinto (otra calidad, marca o medida) se crea como línea aparte.
const crearProducto = handler(async (req, res) => {
  const datos = Object.fromEntries(CAMPOS_EDITABLES.filter((c) => c in req.body).map((c) => [c, req.body[c]]));
  if (!datos.nombre) throw new ErrorNegocio("La descripción es obligatoria");
  datos.nombre = String(datos.nombre).trim().toUpperCase();
  if (!datos.codigo) {
    const max = await Producto.max("codigo");
    datos.codigo = (Number(max) || 0) + 1;
  }
  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.create(datos, { transaction: t });
    // Precio inicial opcional (solo admin): queda en el historial
    if (esAdmin(req) && Number(req.body.precio_compra) > 0 && req.body.proveedor) {
      await PrecioProveedor.create({
        producto_id: p.id, proveedor: normProv(req.body.proveedor), precio: Math.round(Number(req.body.precio_compra)),
        documento: req.body.documento || null, origen: await origenDe(req.body.proveedor, t), creado_por: req.usuario.nombre,
      }, { transaction: t });
      await recalcular(p, { t, usuario: req.usuario.nombre, motivo: "Producto nuevo" });
    }
    await registrar({ usuario: req.usuario.nombre, tabla: "productos", registro_id: p.id, campo: "creado", despues: p.nombre }, t);
    return p;
  });
  res.status(201).json({ ok: true, data: vista(req, await getParametros())(producto) });
});

// PUT /api/productos/:id   (datos del producto; los precios van por /precios)
const actualizarProducto = handler(async (req, res) => {
  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    const cambios = {};
    for (const c of CAMPOS_EDITABLES) {
      if (!(c in req.body)) continue;
      let v = req.body[c];
      if (c === "nombre") v = String(v).trim().toUpperCase();
      if (String(v) !== String(p[c])) cambios[c] = v;
    }
    for (const [campo, v] of Object.entries(cambios)) {
      await registrar({ usuario: req.usuario.nombre, tabla: "productos", registro_id: p.id, campo, antes: String(p[campo] ?? ""), despues: String(v), motivo: req.body.motivo || null }, t);
    }
    await p.update(cambios, { transaction: t });
    return p;
  });
  res.json({ ok: true, data: vista(req, await getParametros())(producto) });
});

// DELETE /api/productos/:id  -> si ya tiene historial se desactiva en vez de borrar
const eliminarProducto = handler(async (req, res) => {
  const producto = await Producto.findByPk(req.params.id);
  if (!producto) throw new ErrorNegocio("Producto no encontrado", 404);
  const precios = await PrecioProveedor.count({ where: { producto_id: producto.id } });
  if (precios > 0) {
    await producto.update({ activo: false });
    await registrar({ usuario: req.usuario.nombre, tabla: "productos", registro_id: producto.id, campo: "activo", antes: "true", despues: "false", motivo: "Eliminado (tenía historial de precios)" });
    return res.json({ ok: true, message: "Producto desactivado (se conserva su historial de precios)" });
  }
  await producto.destroy();
  res.json({ ok: true, message: "Producto eliminado" });
});

// GET /api/productos/:id/precios   (historial de precios por proveedor + cambios)
const getPrecios = handler(async (req, res) => {
  const [precios, cambios] = await Promise.all([
    PrecioProveedor.findAll({ where: { producto_id: req.params.id }, order: [["fecha", "DESC"], ["id", "DESC"]] }),
    RegistroCambio.findAll({ where: { tabla: "productos", registro_id: req.params.id }, order: [["createdAt", "DESC"]], limit: 50 }),
  ]);
  res.json({ ok: true, data: { precios, cambios } });
});

// POST /api/productos/:id/precios
// { proveedor, precio | (total_linea + cantidad), con_iva, fecha, documento, descripcion_proveedor, marca, calce, origen }
const agregarPrecio = handler(async (req, res) => {
  const b = req.body || {};
  if (!b.proveedor) throw new ErrorNegocio("Indica el proveedor");
  const resultado = await sequelize.transaction(async (t) => {
    const p = await Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    const origen = b.origen || (b.con_iva ? "web" : await origenDe(b.proveedor, t));
    const precio = await PrecioProveedor.create({
      producto_id: p.id,
      proveedor: normProv(b.proveedor),
      precio: precioNetoUnitario(b),
      fecha: b.fecha || new Date(),
      documento: b.documento || null,
      descripcion_proveedor: b.descripcion_proveedor || null,
      marca: b.marca || null,
      unidad: b.unidad || null,
      cantidad: b.cantidad || null,
      calce: b.calce || null,
      origen,
      creado_por: req.usuario.nombre,
    }, { transaction: t });
    await recalcular(p, { t, usuario: req.usuario.nombre, motivo: `Precio ${precio.proveedor} ${b.documento || ""}`.trim() });
    return { precio, producto: p };
  });
  res.status(201).json({ ok: true, data: { precio: resultado.precio, producto: vista(req, await getParametros())(resultado.producto) } });
});

// POST /api/precios/:id/descartar   { motivo }   (y /restaurar)
const descartarPrecio = (descartar) => handler(async (req, res) => {
  const resultado = await sequelize.transaction(async (t) => {
    const precio = await PrecioProveedor.findByPk(req.params.id, { transaction: t });
    if (!precio) throw new ErrorNegocio("Precio no encontrado", 404);
    if (descartar && !req.body?.motivo) throw new ErrorNegocio("Indica el motivo para descartar");
    await precio.update({ descartado: descartar, motivo: descartar ? req.body.motivo : null }, { transaction: t });
    const p = await Producto.findByPk(precio.producto_id, { transaction: t, lock: t.LOCK.UPDATE });
    await recalcular(p, { t, usuario: req.usuario.nombre, motivo: `${descartar ? "Descartado" : "Restaurado"} precio ${precio.proveedor}` });
    return p;
  });
  res.json({ ok: true, data: vista(req, await getParametros())(resultado) });
});

// POST /api/productos/:id/confirmar   { precio_id? }
// Confirma el precio vigente (o el de un registro del historial). Reemplaza el aviso de REVISAR.
const confirmarPrecio = handler(async (req, res) => {
  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    const cambios = { confirmado: true, fecha_confirmado: new Date(), revisar: null };
    if (req.body?.precio_id) {
      const pr = await PrecioProveedor.findOne({ where: { id: req.body.precio_id, producto_id: p.id }, transaction: t });
      if (!pr) throw new ErrorNegocio("Ese precio no es de este producto", 404);
      Object.assign(cambios, { precio_compra: Number(pr.precio), proveedor: pr.proveedor, fecha_precio: pr.fecha });
    }
    if (!(Number(cambios.precio_compra ?? p.precio_compra) > 0)) throw new ErrorNegocio("El producto no tiene precio para confirmar");
    await registrar({
      usuario: req.usuario.nombre, tabla: "productos", registro_id: p.id, campo: "confirmado",
      antes: `${p.proveedor || ""} ${p.precio_compra}`.trim(),
      despues: `${cambios.proveedor || p.proveedor || ""} ${cambios.precio_compra ?? p.precio_compra}`.trim(),
      motivo: req.body?.motivo || "Precio confirmado",
    }, t);
    await p.update(cambios, { transaction: t });
    // Las opciones 2 y 3 se recalculan sin tocar el principal confirmado
    await recalcular(p, { t, usuario: req.usuario.nombre, motivo: "Confirmación" });
    if (p.revisar) await p.update({ revisar: null }, { transaction: t });
    return p;
  });
  res.json({ ok: true, data: vista(req, await getParametros())(producto) });
});

// POST /api/productos/:id/desconfirmar
const desconfirmarPrecio = handler(async (req, res) => {
  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    await p.update({ confirmado: false, fecha_confirmado: null }, { transaction: t });
    await registrar({ usuario: req.usuario.nombre, tabla: "productos", registro_id: p.id, campo: "confirmado", antes: "sí", despues: "no" }, t);
    await recalcular(p, { t, usuario: req.usuario.nombre, motivo: "Quitar confirmación" });
    return p;
  });
  res.json({ ok: true, data: vista(req, await getParametros())(producto) });
});

module.exports = {
  getProductos, getCategorias, getResumen, getProducto, crearProducto, actualizarProducto, eliminarProducto,
  getPrecios, agregarPrecio, descartarPrecio, confirmarPrecio, desconfirmarPrecio, vista,
};
