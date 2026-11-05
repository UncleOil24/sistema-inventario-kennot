const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// tipo: flete | combustible | comision | general | financiero (comisión de factoring, intereses)
const Gasto = sequelize.define("Gasto", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  tipo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "general" },
  monto: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  descripcion: { type: DataTypes.STRING(255), allowNull: true },
  venta_id: { type: DataTypes.INTEGER, allowNull: true }, // opcional: gasto asociado a una venta
  empresa: { type: DataTypes.STRING(20), allowNull: true }, // kenott | tactics (cada empresa tiene sus gastos)
  iva: { type: DataTypes.DECIMAL(14, 2), allowNull: true }, // IVA de la factura del gasto (crédito fiscal); el monto es el total
  comprobante: { type: DataTypes.STRING(100), allowNull: true },
  creado_por: { type: DataTypes.STRING(100), allowNull: true },
}, { tableName: "gastos", timestamps: true });

module.exports = Gasto;
