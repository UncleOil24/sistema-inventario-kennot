const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Historial de precios: nunca se borra un precio, se agrega uno nuevo con su fecha.
// calce: exacto | equivalente | parecido
// origen: proveedor | web (un precio web ya viene convertido a neto)
//         | oc_cliente | factura_sin_proveedor  → precios de referencia (M8): cualquier cotización real los reemplaza
const PrecioProveedor = sequelize.define("PrecioProveedor", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  producto_id: { type: DataTypes.INTEGER, allowNull: false },
  proveedor: { type: DataTypes.STRING(255), allowNull: false }, // nombre corto (MADESUR, CYC...)
  precio: { type: DataTypes.DECIMAL(12, 2), allowNull: false }, // neto unitario
  fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  documento: { type: DataTypes.STRING(100), allowNull: true }, // N° cotización o factura
  descripcion_proveedor: { type: DataTypes.TEXT, allowNull: true },
  marca: { type: DataTypes.STRING(100), allowNull: true },
  unidad: { type: DataTypes.STRING(30), allowNull: true },
  cantidad: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  calce: { type: DataTypes.STRING(20), allowNull: true },
  origen: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "proveedor" },
  // Descuento por volumen (M2): se anota aparte y NO baja el precio de compra (precio lista)
  descuento_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
  descuento_desde: { type: DataTypes.DECIMAL(12, 2), allowNull: true }, // desde qué cantidad aplica
  descartado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  motivo: { type: DataTypes.TEXT, allowNull: true },
  creado_por: { type: DataTypes.STRING(100), allowNull: true },
}, {
  tableName: "precios_proveedor",
  timestamps: true,
  indexes: [{ name: "precios_proveedor_producto_idx", fields: ["producto_id"] }],
});

module.exports = PrecioProveedor;
