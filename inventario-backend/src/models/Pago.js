const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// tipo "cobro" = plata que entra (de una venta)
// tipo "pago"  = plata que sale (a una orden de compra)
const Pago = sequelize.define("Pago", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  tipo: { type: DataTypes.STRING(10), allowNull: false },
  venta_id: { type: DataTypes.INTEGER, allowNull: true },
  orden_compra_id: { type: DataTypes.INTEGER, allowNull: true },
  monto: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  medio: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "transferencia" }, // transferencia | efectivo | cheque | tarjeta | vale vista | factoring | otro
  // Factoring: entidad y comisión (la comisión queda además como gasto financiero de la venta)
  factoring_entidad: { type: DataTypes.STRING(100), allowNull: true },
  factoring_comision: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  gasto_id: { type: DataTypes.INTEGER, allowNull: true },
  nota: { type: DataTypes.STRING(255), allowNull: true },
  creado_por: { type: DataTypes.STRING(100), allowNull: true }, // nombre del usuario que lo registró
}, {
  tableName: "pagos",
  timestamps: true,
});

module.exports = Pago;
