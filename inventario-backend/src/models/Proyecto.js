const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Proyecto: agrupa todo lo de una licitación (o pedido grande) ganada:
//  - las ventas: una por cada orden de compra que envía el organismo
//  - las órdenes de compra a proveedores (de cada venta o consolidadas para el proyecto)
// Estados: abierto | cerrado
const Proyecto = sequelize.define("Proyecto", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  numero: { type: DataTypes.STRING(20), allowNull: true },
  nombre: { type: DataTypes.STRING(255), allowNull: false, validate: { notEmpty: true } },
  licitacion_codigo: { type: DataTypes.STRING(40), allowNull: true }, // código de Mercado Público
  cliente_id: { type: DataTypes.INTEGER, allowNull: true },
  cliente_nombre: { type: DataTypes.STRING(255), allowNull: true },
  estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "abierto" },
  notas: { type: DataTypes.TEXT, allowNull: true },
  creado_por: { type: DataTypes.STRING(100), allowNull: true },
}, {
  tableName: "proyectos",
  timestamps: true,
  indexes: [{ name: "proyectos_numero_uq", unique: true, fields: ["numero"] }],
});

module.exports = Proyecto;
