const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Facturas emitidas al cliente. Una venta (= una OC) puede tener varias facturas
// (p.ej. entregas parciales); la suma no puede pasar el total de la venta.
const Factura = sequelize.define("Factura", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  venta_id: { type: DataTypes.INTEGER, allowNull: false },
  numero: { type: DataTypes.STRING(40), allowNull: false },
  fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  monto: { type: DataTypes.DECIMAL(14, 2), allowNull: false }, // total facturado, IVA incluido
  notas: { type: DataTypes.STRING(255), allowNull: true },
  creado_por: { type: DataTypes.STRING(100), allowNull: true },
}, {
  tableName: "facturas",
  timestamps: true,
  indexes: [{ name: "facturas_venta_idx", fields: ["venta_id"] }],
});

module.exports = Factura;
