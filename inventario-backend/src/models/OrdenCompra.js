const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Estados: borrador -> recibida | anulada  (sin control de stock)
// Pago: pendiente | parcial | pagada
const OrdenCompra = sequelize.define("OrdenCompra", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  numero: { type: DataTypes.STRING(20), allowNull: true },
  proveedor_id: { type: DataTypes.INTEGER, allowNull: true },
  venta_id: { type: DataTypes.INTEGER, allowNull: true }, // si nació del cuadro de compra de una venta
  proveedor_nombre: { type: DataTypes.STRING(255), allowNull: true },
  fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  fecha_recepcion: { type: DataTypes.DATE, allowNull: true },
  fecha_vencimiento: { type: DataTypes.DATEONLY, allowNull: true },
  documento: { type: DataTypes.STRING(50), allowNull: true }, // N° factura del proveedor
  estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "borrador" },
  // items: [{ producto_id, nombre, unidad, cantidad, precio }]
  items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  iva: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  monto_pagado: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  estado_pago: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pendiente" },
  notas: { type: DataTypes.TEXT, allowNull: true },
  creado_por: { type: DataTypes.STRING(100), allowNull: true }, // nombre del usuario que lo registró
}, {
  tableName: "ordenes_compra",
  timestamps: true,
  indexes: [{ name: "ordenes_compra_numero_uq", unique: true, fields: ["numero"] }],
});

module.exports = OrdenCompra;
