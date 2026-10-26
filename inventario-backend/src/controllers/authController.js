const bcrypt = require("bcryptjs");
const Usuario = require("../models/Usuario");
const { firmarToken } = require("../middlewares/auth");
const { handler, ErrorNegocio } = require("../services/erp");

const MIN_PASSWORD = 8;
const validarPassword = (pw) => {
  if (!pw || String(pw).length < MIN_PASSWORD) throw new ErrorNegocio(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
};
const hashear = (pw) => bcrypt.hash(String(pw), 10);
const publico = (u) => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo, ultimo_acceso: u.ultimo_acceso });

// --- Freno simple contra fuerza bruta: 5 intentos fallidos por IP+email cada 15 min ---
const VENTANA_MS = 15 * 60 * 1000;
const MAX_FALLOS = 5;
const fallos = new Map();
const claveIntento = (req, email) => `${req.ip}|${email}`;
const bloqueado = (k) => {
  const f = fallos.get(k);
  if (!f) return false;
  if (Date.now() - f.desde > VENTANA_MS) { fallos.delete(k); return false; }
  return f.n >= MAX_FALLOS;
};
const registrarFallo = (k) => {
  const f = fallos.get(k);
  if (!f || Date.now() - f.desde > VENTANA_MS) fallos.set(k, { n: 1, desde: Date.now() });
  else f.n += 1;
};

// POST /api/auth/login   { email, password }
const login = handler(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) throw new ErrorNegocio("Ingresa email y contraseña");
  const k = claveIntento(req, email);
  if (bloqueado(k)) throw new ErrorNegocio("Demasiados intentos fallidos. Espera 15 minutos.", 429);

  const usuario = await Usuario.scope("conPassword").findOne({ where: { email } });
  const ok = usuario && usuario.activo && (await bcrypt.compare(password, usuario.password_hash));
  if (!ok) {
    registrarFallo(k);
    throw new ErrorNegocio("Email o contraseña incorrectos", 401);
  }
  fallos.delete(k);
  await usuario.update({ ultimo_acceso: new Date() });
  res.json({ ok: true, data: { token: firmarToken(usuario), usuario: publico(usuario) } });
});

// GET /api/auth/me
const yo = handler(async (req, res) => {
  res.json({ ok: true, data: publico(req.usuario) });
});

// POST /api/auth/cambiar-password   { actual, nueva }
const cambiarPassword = handler(async (req, res) => {
  const { actual, nueva } = req.body || {};
  validarPassword(nueva);
  const usuario = await Usuario.scope("conPassword").findByPk(req.usuario.id);
  if (!(await bcrypt.compare(String(actual || ""), usuario.password_hash))) {
    throw new ErrorNegocio("La contraseña actual no es correcta");
  }
  await usuario.update({ password_hash: await hashear(nueva), token_version: usuario.token_version + 1 });
  // Devuelve un token nuevo para que esta sesión siga abierta (las demás se cierran)
  res.json({ ok: true, data: { token: firmarToken(usuario) } });
});

// Crea el primer administrador desde ADMIN_EMAIL / ADMIN_PASSWORD si no hay usuarios
const crearAdminInicial = async () => {
  const total = await Usuario.count();
  if (total > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("⚠ No hay usuarios. Define ADMIN_EMAIL y ADMIN_PASSWORD para crear el administrador inicial.");
    return;
  }
  validarPassword(password);
  await Usuario.create({
    nombre: process.env.ADMIN_NOMBRE || "Administrador",
    email,
    password_hash: await hashear(password),
    rol: "admin",
  });
  console.log(`✓ Administrador inicial creado: ${email.toLowerCase()}`);
};

module.exports = { login, yo, cambiarPassword, crearAdminInicial, hashear, validarPassword, publico };
