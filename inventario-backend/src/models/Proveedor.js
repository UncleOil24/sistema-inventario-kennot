const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const Proveedor = sequelize.define("Proveedor", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(255), allowNull: false, validate: { notEmpty: true } },
  rut: { type: DataTypes.STRING(20), allowNull: true },
  telefono: { type: DataTypes.STRING(30), allowNull: true },
  email: { type: DataTypes.STRING(100), allowNull: true },
  direccion: { type: DataTypes.STRING(255), allowNull: true },
  rubro: { type: DataTypes.STRING(100), allowNull: true },
  notas: { type: DataTypes.TEXT, allowNull: true },
  razon_social: { type: DataTypes.STRING(255), allowNull: true },
  contacto: { type: DataTypes.STRING(255), allowNull: true }, // vendedor / datos de contacto
  tipo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "proveedor" }, // proveedor | web
}, {
  tableName: "proveedores",
  timestamps: true,
});

module.exports = Proveedor;
