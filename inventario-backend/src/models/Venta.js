const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Estados: emitida | anulada
// Pago: pendiente | parcial | pagada
const Venta = sequelize.define("Venta", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  numero: { type: DataTypes.STRING(20), allowNull: true },
  cliente_id: { type: DataTypes.INTEGER, allowNull: true },
  cliente_nombre: { type: DataTypes.STRING(255), allowNull: true },
  cotizacion_id: { type: DataTypes.INTEGER, allowNull: true },
  orden_compra_cliente: { type: DataTypes.STRING(60), allowNull: true }, // N° OC que envía el cliente
  fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  fecha_vencimiento: { type: DataTypes.DATEONLY, allowNull: true },
  documento: { type: DataTypes.STRING(50), allowNull: true }, // N° factura/boleta emitida
  estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "emitida" },
  // items: [{ producto_id, nombre, unidad, cantidad, precio, costo, proveedor }]
  // "costo" y "proveedor" se copian de la cotización (o del catálogo si es venta directa)
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
