const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// rol: "admin" (todo) | "usuario" (opera, sin costos/márgenes, sin anular ni borrar)
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
  rol: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "usuario", validate: { isIn: [["admin", "usuario"]] } },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  ultimo_acceso: { type: DataTypes.DATE, allowNull: true },
  // Se incrementa al cambiar la contraseña: invalida las sesiones abiertas
  token_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  tableName: "usuarios",
  timestamps: true,
  indexes: [{ name: "usuarios_email_uq", unique: true, fields: ["email"] }],
  defaultScope: { attributes: { exclude: ["password_hash"] } },
  scopes: { conPassword: { attributes: { include: ["password_hash"] } } },
});

module.exports = Usuario;
