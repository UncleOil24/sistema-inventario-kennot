const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const Producto = sequelize.define("Producto", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  nombre: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: { notEmpty: true },
  },
  categoria: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: "General",
  },
  precio: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    validate: { min: 0 },
  },
  stock: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  unidad: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: "unidad",
  },
  proveedor: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  contacto: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
}, {
  tableName: "productos",
  timestamps: true,
});

module.exports = Producto;
