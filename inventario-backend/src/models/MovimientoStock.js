const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Kardex: cada cambio de stock queda registrado con su origen.
// tipo: entrada | salida | ajuste
// referencia_tipo: compra | venta | anulacion_venta | ajuste | inicial
const MovimientoStock = sequelize.define("MovimientoStock", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  producto_id: { type: DataTypes.INTEGER, allowNull: false },
  producto_nombre: { type: DataTypes.STRING(255), allowNull: true },
  tipo: { type: DataTypes.STRING(10), allowNull: false },
  cantidad: { type: DataTypes.INTEGER, allowNull: false }, // + entra, - sale
  stock_anterior: { type: DataTypes.INTEGER, allowNull: false },
  stock_resultante: { type: DataTypes.INTEGER, allowNull: false },
  costo_unitario: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  referencia_tipo: { type: DataTypes.STRING(20), allowNull: true },
  referencia_id: { type: DataTypes.INTEGER, allowNull: true },
  referencia_numero: { type: DataTypes.STRING(20), allowNull: true },
  nota: { type: DataTypes.STRING(255), allowNull: true },
}, {
  tableName: "movimientos_stock",
  timestamps: true,
  updatedAt: false,
  indexes: [{ name: "movimientos_stock_producto_idx", fields: ["producto_id"] }],
});

module.exports = MovimientoStock;
