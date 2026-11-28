const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Foto de cómo estaba todo antes de registrar una factura de compra, para poder deshacer el registro
// (compras, ventas, productos renombrados) y lo que el registro creó (compras, gastos, precios, documentos).
const RegistroFactura = sequelize.define("RegistroFactura", {
  folio: { type: DataTypes.STRING(60), allowNull: true },
  proveedor: { type: DataTypes.STRING(150), allowNull: true },
  total: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  bandeja_id: { type: DataTypes.INTEGER, allowNull: true },
  ordenes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, // ids de compras tocadas o creadas
  antes: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }, // { ordenes: [fila], ventas: [{id, items, costo_total}], productos: [{id, nombre}], gasto: fila|null }
  creados: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }, // { ordenes, gastos, precios, documentos, productos, pago_max }
  creado_por: { type: DataTypes.STRING(120), allowNull: true },
  deshecho_en: { type: DataTypes.DATE, allowNull: true },
  deshecho_por: { type: DataTypes.STRING(120), allowNull: true },
  motivo: { type: DataTypes.STRING(300), allowNull: true },
}, { tableName: "registros_factura", timestamps: true });

module.exports = RegistroFactura;
