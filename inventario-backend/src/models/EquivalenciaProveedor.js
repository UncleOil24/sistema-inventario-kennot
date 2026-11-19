const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Lo que el sistema aprende al registrar facturas: "este producto del proveedor es este producto nuestro, y cada
// unidad suya trae N unidades nuestras" (ej. CYC [54514] ÁCIDO MURIÁTICO 5 LT → N° 937 × 5 litros).
// Se busca por código del proveedor; si la factura no trae código, por la descripción.
const EquivalenciaProveedor = sequelize.define("EquivalenciaProveedor", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  proveedor: { type: DataTypes.STRING(255), allowNull: false },
  codigo_proveedor: { type: DataTypes.STRING(60), allowNull: true },
  descripcion: { type: DataTypes.STRING(300), allowNull: true }, // normalizada (mayúsculas, sin tildes ni espacios dobles)
  producto_id: { type: DataTypes.INTEGER, allowNull: false },
  factor: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 1 },
  usos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  usuario: { type: DataTypes.STRING(150), allowNull: true },
}, { tableName: "equivalencias_proveedor", timestamps: true, indexes: [{ fields: ["proveedor", "codigo_proveedor"] }, { fields: ["proveedor", "descripcion"] }] });

module.exports = EquivalenciaProveedor;
