const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// rol: "admin" y "gerencia" (todo) | "comercial" (Dpto. 1) | "operativo" (Dpto. 2) | "usuario" (antiguo, igual a comercial sin costos)
const Usuario = sequelize.define("Usuario", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(100), allowNull: false, validate: { notEmpty: true } },
  email: {
    type: DataTypes.STRING(150),
    allowNull: false,
    validate: { isEmail: { msg: "Email inválido" } },
    set(v) { this.setDataValue("email", String(v || "").trim().toLowerCase()); },
  },
  password_hash: { type: DataTypes.STRING(100), allowNull: false },
  rol: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "usuario", validate: { isIn: [["admin", "gerencia", "comercial", "operativo", "usuario"]] } },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  ultimo_acceso: { type: DataTypes.DATE, allowNull: true },
  // Se incrementa al cambiar la contraseña: invalida las sesiones abiertas
  token_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  // Clave inicial entregada por gerencia: al entrar se pide cambiarla
  debe_cambiar_clave: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName: "usuarios",
  timestamps: true,
  indexes: [{ name: "usuarios_email_uq", unique: true, fields: ["email"] }],
  defaultScope: { attributes: { exclude: ["password_hash"] } },
  scopes: { conPassword: { attributes: { include: ["password_hash"] } } },
});

module.exports = Usuario;
