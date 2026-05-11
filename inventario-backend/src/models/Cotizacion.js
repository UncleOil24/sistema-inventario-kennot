const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const Cotizacion = sequelize.define("Cotizacion", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  numero: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true,
  },
  cliente: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  subtotal: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
  },
  iva: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
  },
  total: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
  },
  // Items guardados como JSON
  items: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  },
}, {
  tableName: "cotizaciones",
  timestamps: true,
});

module.exports = Cotizacion;
