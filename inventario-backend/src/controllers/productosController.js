const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Producto = require("../models/Producto");
const MovimientoStock = require("../models/MovimientoStock");
const { moverStock, handler, ErrorNegocio } = require("../services/erp");
const { esAdmin } = require("../middlewares/auth");

// El rol "usuario" no ve el precio de compra
const verProducto = (req, p) => {
  if (esAdmin(req)) return p;
  const j = typeof p.toJSON === "function" ? p.toJSON() : { ...p };
  delete j.precio_compra;
  return j;
};

// GET /api/productos
const getProductos = async (req, res) => {
  try {
    const { busqueda, categoria, sort = "id", dir = "ASC" } = req.query;

    const where = {};
    if (busqueda) {
      where[Op.or] = [
        { nombre: { [Op.iLike]: `%${busqueda}%` } },
        { categoria: { [Op.iLike]: `%${busqueda}%` } },
        { proveedor: { [Op.iLike]: `%${busqueda}%` } },
      ];
    }
    if (categoria && categoria !== "Todas") {
      where.categoria = categoria;
    }

    const camposValidos = ["id", "nombre", "categoria", "precio_compra", "precio_venta", "stock", "proveedor"];
    const ordenBy = camposValidos.includes(sort) ? sort : "id";
    const ordenDir = dir.toUpperCase() === "DESC" ? "DESC" : "ASC";

    const productos = await Producto.findAll({
      where,
      order: [[ordenBy, ordenDir]],
    });

    res.json({ ok: true, data: productos.map((p) => verProducto(req, p)) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// GET /api/productos/:id
const getProducto = async (req, res) => {
  try {
    const producto = await Producto.findByPk(req.params.id);
    if (!producto) return res.status(404).json({ ok: false, error: "Producto no encontrado" });
    res.json({ ok: true, data: verProducto(req, producto) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// POST /api/productos
const crearProducto = async (req, res) => {
  try {
    const { nombre, categoria, precio_venta, stock, stock_minimo, unidad, proveedor, contacto } = req.body;
    // El costo lo define un admin o la recepción de una orden de compra
    const precio_compra = esAdmin(req) ? req.body.precio_compra : 0;
    if (!nombre || precio_venta === undefined || stock === undefined) {
      return res.status(400).json({ ok: false, error: "nombre, precio y stock son requeridos" });
    }

    const producto = await sequelize.transaction(async (t) => {
      const p = await Producto.create(
        { nombre, categoria, precio_compra, precio_venta, stock: 0, stock_minimo, unidad, proveedor, contacto },
        { transaction: t }
      );
      // El stock inicial queda registrado en el kardex
      if (Number(stock) > 0) {
        await moverStock(p, Number(stock), {
          tipo: "entrada", referencia_tipo: "inicial", nota: "Stock inicial", creado_por: req.usuario.nombre,
        }, t);
      }
      return p;
    });
    res.status(201).json({ ok: true, data: verProducto(req, producto) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// PUT /api/productos/:id
const actualizarProducto = async (req, res) => {
  try {
    const { nombre, categoria, precio_venta, stock_minimo, unidad, proveedor, contacto } = req.body;
    // Solo un admin puede cambiar el costo o corregir el stock a mano
    const precio_compra = esAdmin(req) ? req.body.precio_compra : undefined;
    const stock = esAdmin(req) ? req.body.stock : undefined;
    const producto = await sequelize.transaction(async (t) => {
      const p = await Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
      const cambios = { nombre, categoria, precio_compra, precio_venta, stock_minimo, unidad, proveedor, contacto };
      Object.keys(cambios).forEach((k) => cambios[k] === undefined && delete cambios[k]);
      await p.update(cambios, { transaction: t });
      // Si cambiaron el stock a mano, se registra como ajuste en el kardex
      if (stock !== undefined && stock !== null && stock !== "" && Number(stock) !== Number(p.stock)) {
        await moverStock(p, Number(stock) - Number(p.stock), {
          tipo: "ajuste", referencia_tipo: "ajuste", nota: "Edición manual del producto", creado_por: req.usuario.nombre,
        }, t);
      }
      return p;
    });
    res.json({ ok: true, data: verProducto(req, producto) });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
};

// DELETE /api/productos/:id
const eliminarProducto = async (req, res) => {
  try {
    const producto = await Producto.findByPk(req.params.id);
    if (!producto) return res.status(404).json({ ok: false, error: "Producto no encontrado" });

    await producto.destroy();
    res.json({ ok: true, message: "Producto eliminado" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// GET /api/productos/:id/movimientos   (kardex del producto)
const getMovimientos = handler(async (req, res) => {
  const data = await MovimientoStock.findAll({
    where: { producto_id: req.params.id },
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit: 200,
  });
  res.json({
    ok: true,
    data: esAdmin(req) ? data : data.map((m) => { const j = m.toJSON(); delete j.costo_unitario; return j; }),
  });
});

// POST /api/productos/:id/ajuste   { stock_real, nota }  -> para conteos físicos / mermas
const ajustarStock = handler(async (req, res) => {
  const { stock_real, nota } = req.body;
  if (stock_real === undefined || stock_real === "" || Number(stock_real) < 0) {
    throw new ErrorNegocio("Indica el stock real (0 o más)");
  }
  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    const delta = Math.trunc(Number(stock_real)) - Number(p.stock);
    if (delta !== 0) {
      await moverStock(p, delta, {
        tipo: "ajuste", referencia_tipo: "ajuste", nota: nota || "Ajuste de inventario", creado_por: req.usuario.nombre,
      }, t);
    }
    return p;
  });
  res.json({ ok: true, data: producto });
});

module.exports = {
  getProductos, getProducto, crearProducto, actualizarProducto, eliminarProducto, getMovimientos, ajustarStock,
};
