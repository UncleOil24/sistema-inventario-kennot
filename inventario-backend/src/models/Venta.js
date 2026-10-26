const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Estados: emitida | anulada (anular devuelve el stock)
// Pago: pendiente | parcial | pagada
const Venta = sequelize.define("Venta", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  numero: { type: DataTypes.STRING(20), allowNull: true },
  cliente_id: { type: DataTypes.INTEGER, allowNull: true },
  cliente_nombre: { type: DataTypes.STRING(255), allowNull: true },
  cotizacion_id: { type: DataTypes.INTEGER, allowNull: true },
  fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  fecha_vencimiento: { type: DataTypes.DATEONLY, allowNull: true },
  documento: { type: DataTypes.STRING(50), allowNull: true }, // N° factura/boleta emitida
  estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "emitida" },
  // items: [{ producto_id, nombre, unidad, cantidad, precio, costo }]
  // "costo" es el precio_compra al momento de vender -> permite calcular margen real
  items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  iva: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  costo_total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  monto_pagado: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  estado_pago: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pendiente" },
  notas: { type: DataTypes.TEXT, allowNull: true },
  creado_por: { type: DataTypes.STRING(100), allowNull: true }, // nombre del usuario que lo registró
}, {
  tableName: "ventas",
  timestamps: true,
  indexes: [{ name: "ventas_numero_uq", unique: true, fields: ["numero"] }],
});

module.exports = Venta;
