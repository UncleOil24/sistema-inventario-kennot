const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Usuario = require("../models/Usuario");
const { handler, ErrorNegocio } = require("../services/erp");
const { hashear, validarPassword, publico } = require("./authController");

const ROLES = ["admin", "usuario"];

// Evita que el sistema quede sin ningún administrador activo
const verificarQuedaAdmin = async (excluirId, t) => {
  const otros = await Usuario.count({
    where: { rol: "admin", activo: true, id: { [Op.ne]: excluirId } },
    transaction: t,
  });
  if (otros === 0) throw new ErrorNegocio("Debe quedar al menos un administrador activo");
};

// GET /api/usuarios
const getUsuarios = handler(async (req, res) => {
  const usuarios = await Usuario.findAll({ order: [["nombre", "ASC"]] });
  res.json({ ok: true, data: usuarios.map(publico) });
});

// POST /api/usuarios   { nombre, email, password, rol }
const crearUsuario = handler(async (req, res) => {
  const { nombre, email, password, rol = "usuario" } = req.body || {};
  if (!nombre || !email) throw new ErrorNegocio("Nombre y email son obligatorios");
  if (!ROLES.includes(rol)) throw new ErrorNegocio("Rol inválido");
  validarPassword(password);
  const existe = await Usuario.findOne({ where: { email: String(email).trim().toLowerCase() } });
  if (existe) throw new ErrorNegocio("Ya existe un usuario con ese email");
  const u = await Usuario.create({ nombre, email, rol, password_hash: await hashear(password) });
  res.status(201).json({ ok: true, data: publico(u) });
});

// PUT /api/usuarios/:id   { nombre, email, rol, activo, password }
// password es opcional: si viene, se restablece y se cierran sus sesiones.
const actualizarUsuario = handler(async (req, res) => {
  const data = await sequelize.transaction(async (t) => {
    const u = await Usuario.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!u) throw new ErrorNegocio("Usuario no encontrado", 404);
    const { nombre, email, rol, activo, password } = req.body || {};
    const cambios = {};
    if (nombre !== undefined) cambios.nombre = nombre;
    if (email !== undefined && String(email).trim().toLowerCase() !== u.email) {
      const existe = await Usuario.findOne({ where: { email: String(email).trim().toLowerCase() }, transaction: t });
      if (existe) throw new ErrorNegocio("Ya existe un usuario con ese email");
      cambios.email = email;
    }
    if (rol !== undefined && rol !== u.rol) {
      if (!ROLES.includes(rol)) throw new ErrorNegocio("Rol inválido");
      cambios.rol = rol;
    }
    if (activo !== undefined && !!activo !== u.activo) cambios.activo = !!activo;

    const pierdeAdmin = u.rol === "admin" && ((cambios.rol && cambios.rol !== "admin") || cambios.activo === false);
    if (pierdeAdmin) await verificarQuedaAdmin(u.id, t);

    if (password) {
      validarPassword(password);
      cambios.password_hash = await hashear(password);
    }
    // Cambio de contraseña, rol o desactivación: se cierran sus sesiones abiertas
    if (password || cambios.rol || cambios.activo === false) cambios.token_version = u.token_version + 1;

    await u.update(cambios, { transaction: t });
    return publico(u);
  });
  res.json({ ok: true, data });
});

module.exports = { getUsuarios, crearUsuario, actualizarUsuario };
