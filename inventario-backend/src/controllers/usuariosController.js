const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Usuario = require("../models/Usuario");
const { handler, ErrorNegocio } = require("../services/erp");
const { hashear, validarPassword, publico } = require("./authController");

const ROLES = ["admin", "gerencia", "comercial", "operativo", "usuario"];
const crypto = require("crypto");
// Clave inicial legible (sin letras confusas), se cambia al entrar
const claveInicial = () => {
  const L = "abcdefghjkmnpqrstuvwxyz", N = "23456789";
  const r = (s) => s[crypto.randomInt(s.length)];
  return `${r(L).toUpperCase()}${r(L)}${r(L)}${r(L)}-${r(N)}${r(N)}${r(N)}${r(N)}`;
};

// Evita que el sistema quede sin ningún administrador activo
const verificarQuedaAdmin = async (excluirId, t) => {
  const otros = await Usuario.count({
    where: { rol: { [Op.in]: ["admin", "gerencia"] }, activo: true, id: { [Op.ne]: excluirId } },
    transaction: t,
  });
  if (otros === 0) throw new ErrorNegocio("Debe quedar al menos un usuario de gerencia o administrador activo");
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
  const u = await Usuario.create({ nombre, email, rol, password_hash: await hashear(password), debe_cambiar_clave: req.body?.debe_cambiar_clave !== false });
  res.status(201).json({ ok: true, data: publico(u) });
});

// POST /api/usuarios/equipo   -> crea a quienes falten del equipo con una clave inicial (se muestra una sola vez)
const EQUIPO = [
  { nombre: "Jorge Orellana", email: "tacticsinversionesspa@gmail.com", rol: "gerencia" },
  { nombre: "Nicol Orellana", email: "nicolorellanatapia@hotmail.com", rol: "comercial" },
  { nombre: "Marcela Tapia", email: "kenottinversiones@gmail.com", rol: "operativo" },
];
const crearEquipo = handler(async (req, res) => {
  const resultado = [];
  for (const p of EQUIPO) {
    const existe = await Usuario.findOne({ where: { email: p.email } });
    if (existe) { resultado.push({ ...p, estado: "ya existía", rol: existe.rol }); continue; }
    const clave = claveInicial();
    await Usuario.create({ ...p, password_hash: await hashear(clave), debe_cambiar_clave: true });
    resultado.push({ ...p, estado: "creado", clave });
  }
  res.status(201).json({ ok: true, data: resultado });
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

    const esJefe = (r) => ["admin", "gerencia"].includes(r);
    const pierdeAdmin = esJefe(u.rol) && ((cambios.rol && !esJefe(cambios.rol)) || cambios.activo === false);
    if (pierdeAdmin) await verificarQuedaAdmin(u.id, t);

    if (password) {
      validarPassword(password);
      cambios.password_hash = await hashear(password);
    }
    // Cambio de contraseña, rol o desactivación: se cierran sus sesiones abiertas
    if (password || cambios.rol || cambios.activo === false) cambios.token_version = u.token_version + 1;
    if (password) cambios.debe_cambiar_clave = true;

    await u.update(cambios, { transaction: t });
    return publico(u);
  });
  res.json({ ok: true, data });
});

module.exports = { getUsuarios, crearUsuario, actualizarUsuario, crearEquipo };
