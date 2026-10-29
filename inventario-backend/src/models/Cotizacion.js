const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Estados: borrador -> cotizacion -> aceptada (pasa a venta) | rechazada | vencida
// Las rechazadas y vencidas no se borran: sirven para medir cuánto se cotiza y se gana.
const Cotizacion = sequelize.define("Cotizacion", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  numero: { type: DataTypes.STRING(20), allowNull: false, unique: true }, // correlativo
  cliente_id: { type: DataTypes.INTEGER, allowNull: true },
  cliente: { type: DataTypes.STRING(255), allowNull: true }, // nombre (se conserva aunque se borre la ficha)
  tipo_precio: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "convenio" }, // convenio | particular
  nombre_cotizacion: { type: DataTypes.STRING(255), allowNull: true },
  fecha: { type: DataTypes.DATEONLY, allowNull: true, defaultValue: DataTypes.NOW },
  validez_dias: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
  fecha_validez: { type: DataTypes.DATEONLY, allowNull: true },
  subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  iva: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  total: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  costo_total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "cotizacion" },
  motivo_estado: { type: DataTypes.STRING(255), allowNull: true }, // p.ej. por qué se rechazó
  venta_id: { type: DataTypes.INTEGER, allowNull: true },
  notas: { type: DataTypes.TEXT, allowNull: true },
  creado_por: { type: DataTypes.STRING(100), allowNull: true },
  // items: [{ producto_id, nombre, descripcion_cliente, unidad, cantidad, precio, costo, proveedor }]
  // "precio" (venta) y "costo" (compra) se COPIAN al cotizar: si el catálogo cambia
  // después, la cotización y su margen no se mueven.
  items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
}, {
  tableName: "cotizaciones",
  timestamps: true,
});

module.exports = Cotizacion;
