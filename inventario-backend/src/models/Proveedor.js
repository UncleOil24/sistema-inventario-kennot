const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const Proveedor = sequelize.define("Proveedor", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(255), allowNull: false, validate: { notEmpty: true } },
  rut: { type: DataTypes.STRING(20), allowNull: true },
  telefono: { type: DataTypes.STRING(30), allowNull: true },
  email: { type: DataTypes.STRING(100), allowNull: true },
  direccion: { type: DataTypes.STRING(255), allowNull: true },
  rubro: { type: DataTypes.STRING(100), allowNull: true },
  notas: { type: DataTypes.TEXT, allowNull: true },
  razon_social: { type: DataTypes.STRING(255), allowNull: true },
  contacto: { type: DataTypes.STRING(255), allowNull: true }, // vendedor / datos de contacto
  tipo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "proveedor" }, // proveedor | web
  comuna: { type: DataTypes.STRING(100), allowNull: true },
  // Plazo de pago que nos da el proveedor (días desde la factura; vacío o 0 = contado) y descuento por pronto pago
  plazo_pago_dias: { type: DataTypes.INTEGER, allowNull: true },
  descuento_pronto_pago: { type: DataTypes.DECIMAL(5, 2), allowNull: true }, // %
  dias_pronto_pago: { type: DataTypes.INTEGER, allowNull: true }, // si se paga dentro de estos días desde la factura
  // Excluido (M7): sus cotizaciones quedan como historial pero no compiten por el precio vigente (ej. flete caro)
  excluido: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  motivo_exclusion: { type: DataTypes.STRING(255), allowNull: true },
}, {
  tableName: "proveedores",
  timestamps: true,
});

module.exports = Proveedor;
