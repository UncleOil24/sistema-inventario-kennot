const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const Usuario = require("../models/Usuario");

// El secreto debe venir de Render (JWT_SECRET). Si falta, se genera uno temporal:
// funciona, pero las sesiones se cierran cada vez que el servidor reinicia.
const SECRETO = process.env.JWT_SECRET || (() => {
  console.warn("⚠ JWT_SECRET no está definido: se usa uno temporal (las sesiones se perderán al reiniciar)");
  return crypto.randomBytes(48).toString("hex");
})();
const DURACION = process.env.JWT_DURACION || "12h";

const firmarToken = (usuario) => jwt.sign({ sub: usuario.id, v: usuario.token_version }, SECRETO, { expiresIn: DURACION });

// Exige sesión válida. Carga el usuario desde la BD en cada request para que
// desactivar a alguien o cambiarle el rol tenga efecto inmediato.
const requiereAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "Debes iniciar sesión" });
    let payload;
    try {
      payload = jwt.verify(token, SECRETO);
    } catch {
      return res.status(401).json({ ok: false, error: "Sesión expirada, vuelve a iniciar sesión" });
    }
    const usuario = await Usuario.findByPk(payload.sub);
    if (!usuario || !usuario.activo) return res.status(401).json({ ok: false, error: "Usuario no autorizado" });
    if ((payload.v ?? 0) !== usuario.token_version) {
      return res.status(401).json({ ok: false, error: "Tu contraseña cambió, vuelve a iniciar sesión" });
    }
    req.usuario = usuario;
    next();
  } catch (err) {
    next(err);
  }
};

// Roles por departamento. "admin" y "gerencia" ven y hacen todo.
//   comercial  -> Dpto. 1 (licitaciones, cotizaciones, ventas, facturación, clientes, catálogo)
//   operativo  -> Dpto. 2 (ventas por ejecutar, compras, proveedores, despachos)
//   usuario    -> rol antiguo: como comercial, pero sin ver costos
const esGerencia = (req) => ["admin", "gerencia"].includes(req.usuario?.rol);
const esAdmin = esGerencia; // nombre antiguo: "ve todo" (márgenes, utilidades, configuración)
const tieneRol = (req, ...roles) => esGerencia(req) || roles.includes(req.usuario?.rol);
// Costos de compra y proveedores (catálogo, cotizaciones): todos menos el rol antiguo "usuario"
const veCostos = (req) => tieneRol(req, "comercial", "operativo");

const permite = (...roles) => (req, res, next) => {
  if (!tieneRol(req, ...roles)) return res.status(403).json({ ok: false, error: "Tu departamento no tiene acceso a esta acción" });
  next();
};
const soloAdmin = permite(); // solo gerencia
const soloGerencia = soloAdmin;

module.exports = { firmarToken, requiereAuth, soloAdmin, soloGerencia, esAdmin, esGerencia, tieneRol, veCostos, permite };
