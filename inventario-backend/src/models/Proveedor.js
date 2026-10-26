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
}, {
  tableName: "proveedores",
  timestamps: true,
});

module.exports = Proveedor;
