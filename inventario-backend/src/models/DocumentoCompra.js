const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// PDF de la factura del proveedor guardado en nuestra compra (C-0001...)
const DocumentoCompra = sequelize.define("DocumentoCompra", {
  orden_id: { type: DataTypes.INTEGER, allowNull: true },
  gasto_id: { type: DataTypes.INTEGER, allowNull: true }, // documento de un gasto de la venta (flete, combustible...)
  tipo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "factura" },
  folio: { type: DataTypes.STRING(50), allowNull: true },
  fecha: { type: DataTypes.DATEONLY, allowNull: true },
  monto: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  nombre_archivo: { type: DataTypes.STRING(200), allowNull: false },
  mime: { type: DataTypes.STRING(100), allowNull: false },
  datos: { type: DataTypes.BLOB("long"), allowNull: false },
  creado_por: { type: DataTypes.STRING(150), allowNull: true },
}, { tableName: "documentos_compra", indexes: [{ fields: ["orden_id"] }] });

module.exports = DocumentoCompra;
