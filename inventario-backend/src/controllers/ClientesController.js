const Cliente = require("../models/Cliente");
const { Op } = require("sequelize");

// GET /api/clientes
const getClientes = async (req, res) => {
  try {
    const { busqueda } = req.query;
    const where = {};
    if (busqueda) {
      where[Op.or] = [
        { nombre: { [Op.iLike]: `%${busqueda}%` } },
        { rut: { [Op.iLike]: `%${busqueda}%` } },
      ];
    }
    const clientes = await Cliente.findAll({ where, order: [["nombre", "ASC"]] });
    res.json({ ok: true, data: clientes });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// POST /api/clientes
const crearCliente = async (req, res) => {
  try {
    const { nombre, rut, telefono, email, direccion } = req.body;
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });
    const cliente = await Cliente.create({ nombre, rut, telefono, email, direccion });
    res.status(201).json({ ok: true, data: cliente });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// PUT /api/clientes/:id
const actualizarCliente = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    if (!cliente) return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    const { nombre, rut, telefono, email, direccion } = req.body;
    await cliente.update({ nombre, rut, telefono, email, direccion });
    res.json({ ok: true, data: cliente });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// DELETE /api/clientes/:id
const eliminarCliente = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    if (!cliente) return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    await cliente.destroy();
    res.json({ ok: true, message: "Cliente eliminado" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = { getClientes, crearCliente, actualizarCliente, eliminarCliente };