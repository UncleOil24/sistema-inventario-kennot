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
  nombre_cotizacion: {
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
  // pendiente | vendida (se convirtió en venta)
  estado: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: "pendiente",
  },
  venta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  creado_por: {
    type: DataTypes.STRING(100),
    allowNull: true,
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
