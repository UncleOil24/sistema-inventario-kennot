const Cliente = require("../models/Cliente");
const { Op } = require("sequelize");
const sequelize = require("../../config/database");

// Siguiente ID automático P-001, P-002... (para clientes que no son una unidad de compra de Mercado Público)
const siguienteCodigo = async () => {
  const [[f]] = await sequelize.query(`SELECT COALESCE(MAX(SUBSTRING(codigo FROM 3)::int), 0) AS n FROM clientes WHERE codigo ~ '^P-[0-9]+$'`);
  return `P-${String(Number(f.n) + 1).padStart(3, "0")}`;
};
const limpiarCodigo = (c) => String(c || "").trim().toUpperCase();
const codigoLibre = async (codigo, id) => {
  const otro = await Cliente.findOne({ where: { codigo } });
  if (otro && otro.id !== Number(id)) throw Object.assign(new Error(`El ID ${codigo} ya lo tiene ${otro.nombre}`), { status: 400 });
};
const responderError = (res, error) => res.status(error.status || 500).json({ ok: false, error: error.message });

// GET /api/clientes
const getClientes = async (req, res) => {
  try {
    const { busqueda } = req.query;
    const where = {};
    if (busqueda) {
      where[Op.or] = [
        { nombre: { [Op.iLike]: `%${busqueda}%` } },
        { rut: { [Op.iLike]: `%${busqueda}%` } },
        { codigo: { [Op.iLike]: `%${busqueda}%` } },
      ];
    }
    // El Cliente general va primero
    const clientes = await Cliente.findAll({ where, order: [[sequelize.literal(`(codigo = 'CG')`), "DESC NULLS LAST"], ["nombre", "ASC"]] });
    res.json({ ok: true, data: clientes });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// POST /api/clientes
const crearCliente = async (req, res) => {
  try {
    const { nombre, rut, telefono, email, direccion, contacto, comuna } = req.body;
    if (!nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });
    const tipo = req.body.tipo === "particular" ? "particular" : "convenio";
    // ID: el que se indique (p.ej. unidad de compra 1422) o el siguiente P-###
    const codigo = limpiarCodigo(req.body.codigo) || await siguienteCodigo();
    await codigoLibre(codigo);
    const cliente = await Cliente.create({ codigo, nombre, rut, telefono, email, direccion, contacto, comuna, tipo });
    res.status(201).json({ ok: true, data: cliente });
  } catch (error) {
    responderError(res, error);
  }
};

// PUT /api/clientes/:id
const actualizarCliente = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    if (!cliente) return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    const { nombre, rut, telefono, email, direccion, contacto, comuna } = req.body;
    const tipo = req.body.tipo === undefined ? cliente.tipo : (req.body.tipo === "particular" ? "particular" : "convenio");
    const cambios = { nombre, rut, telefono, email, direccion, contacto, comuna, tipo };
    if (req.body.codigo !== undefined && cliente.codigo !== "CG") {
      cambios.codigo = limpiarCodigo(req.body.codigo) || cliente.codigo || await siguienteCodigo();
      if (cambios.codigo === "CG") throw Object.assign(new Error("El ID CG es del Cliente general"), { status: 400 });
      await codigoLibre(cambios.codigo, cliente.id);
    }
    await cliente.update(cambios);
    res.json({ ok: true, data: cliente });
  } catch (error) {
    responderError(res, error);
  }
};

// DELETE /api/clientes/:id
const eliminarCliente = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    if (!cliente) return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    if (cliente.codigo === "CG") return res.status(400).json({ ok: false, error: "El Cliente general no se puede borrar" });
    await cliente.destroy();
    res.json({ ok: true, message: "Cliente eliminado" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = { siguienteCodigo, getClientes, crearCliente, actualizarCliente, eliminarCliente };