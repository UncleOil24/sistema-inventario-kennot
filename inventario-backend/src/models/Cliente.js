const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const Cliente = sequelize.define("Cliente", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  nombre: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  rut: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  telefono: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  direccion: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  // convenio (instituciones: compra x 1,30) | particular (compra x 1,50)
  tipo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "convenio" },
  contacto: { type: DataTypes.STRING(150), allowNull: true },
  comuna: { type: DataTypes.STRING(100), allowNull: true },
}, {
  tableName: "clientes",
  timestamps: true,
});

module.exports = Cliente;