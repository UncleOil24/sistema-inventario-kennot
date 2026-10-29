const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Catálogo. El precio de compra vigente, el proveedor principal y las opciones 2 y 3
// los calcula services/precios.js a partir del historial (tabla precios_proveedor).
// Los precios de venta (convenio / particular) NO se guardan: se calculan con los
// márgenes de la tabla parametros.
const Producto = sequelize.define("Producto", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  codigo: { type: DataTypes.INTEGER, allowNull: true }, // N° de la planilla consolidada
  nombre: { type: DataTypes.STRING(255), allowNull: false, validate: { notEmpty: true } }, // descripción estándar
  categoria: { type: DataTypes.STRING(100), allowNull: false, defaultValue: "General" },
  unidad: { type: DataTypes.STRING(50), allowNull: false, defaultValue: "UNIDAD" },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  en_planilla: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // vino de la planilla consolidada

  // --- Precio vigente ---
  precio_compra: { type: DataTypes.DECIMAL(12, 2), allowNull: true, defaultValue: 0 }, // neto
  proveedor: { type: DataTypes.STRING(255), allowNull: true }, // proveedor principal
  contacto: { type: DataTypes.STRING(255), allowNull: true },
  fecha_precio: { type: DataTypes.DATEONLY, allowNull: true },
  opcion2_proveedor: { type: DataTypes.STRING(255), allowNull: true },
  opcion2_precio: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  opcion2_fecha: { type: DataTypes.DATEONLY, allowNull: true },
  opcion3_proveedor: { type: DataTypes.STRING(255), allowNull: true },
  opcion3_precio: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  opcion3_fecha: { type: DataTypes.DATEONLY, allowNull: true },
  revisar: { type: DataTypes.TEXT, allowNull: true }, // avisos (columna REVISAR)
  confirmado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  fecha_confirmado: { type: DataTypes.DATE, allowNull: true }, // momento en que se confirmó

  // Columnas antiguas: ya no se usan (sin control de stock). Se conservan para no borrar datos.
  precio_venta: { type: DataTypes.DECIMAL(12, 2), allowNull: true, defaultValue: 0 },
  stock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  stock_minimo: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  tableName: "productos",
  timestamps: true,
  indexes: [{ name: "productos_codigo_idx", fields: ["codigo"] }],
});

module.exports = Producto;
