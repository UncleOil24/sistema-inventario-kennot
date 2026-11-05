const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const Cliente = sequelize.define("Cliente", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  // ID del cliente: unidad de compra de Mercado Público (p.ej. 1422 = CONAF), P-001... para el resto,
  // y "CG" para el Cliente general (ventas sueltas, el nombre se escribe en cada documento)
  codigo: { type: DataTypes.STRING(30), allowNull: true },
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
  indexes: [{ name: "clientes_codigo_uq", unique: true, fields: ["codigo"] }],
});

module.exports = Cliente;