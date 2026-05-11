const { Op } = require("sequelize");
const Producto = require("../models/Producto");

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

    const camposValidos = ["id", "nombre", "categoria", "precio", "stock", "proveedor"];
    const ordenBy = camposValidos.includes(sort) ? sort : "id";
    const ordenDir = dir.toUpperCase() === "DESC" ? "DESC" : "ASC";

    const productos = await Producto.findAll({
      where,
      order: [[ordenBy, ordenDir]],
    });

    res.json({ ok: true, data: productos });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// GET /api/productos/:id
const getProducto = async (req, res) => {
  try {
    const producto = await Producto.findByPk(req.params.id);
    if (!producto) return res.status(404).json({ ok: false, error: "Producto no encontrado" });
    res.json({ ok: true, data: producto });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// POST /api/productos
const crearProducto = async (req, res) => {
  try {
    const { nombre, categoria, precio, stock, unidad, proveedor, contacto } = req.body;

    if (!nombre || precio === undefined || stock === undefined) {
      return res.status(400).json({ ok: false, error: "nombre, precio y stock son requeridos" });
    }

    const producto = await Producto.create({ nombre, categoria, precio, stock, unidad, proveedor, contacto });
    res.status(201).json({ ok: true, data: producto });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// PUT /api/productos/:id
const actualizarProducto = async (req, res) => {
  try {
    const producto = await Producto.findByPk(req.params.id);
    if (!producto) return res.status(404).json({ ok: false, error: "Producto no encontrado" });

    const { nombre, categoria, precio, stock, unidad, proveedor, contacto } = req.body;
    await producto.update({ nombre, categoria, precio, stock, unidad, proveedor, contacto });
    res.json({ ok: true, data: producto });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
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

module.exports = { getProductos, getProducto, crearProducto, actualizarProducto, eliminarProducto };
