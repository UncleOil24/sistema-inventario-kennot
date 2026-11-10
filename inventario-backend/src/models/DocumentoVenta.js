const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// PDF de la factura o guía de despacho emitida en el portal del SII, guardado en la venta
const DocumentoVenta = sequelize.define("DocumentoVenta", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  venta_id: { type: DataTypes.INTEGER, allowNull: false },
  tipo: { type: DataTypes.STRING(20), allowNull: false }, // factura | guia | nota_credito | otro
  folio: { type: DataTypes.STRING(40), allowNull: true },
  fecha: { type: DataTypes.DATEONLY, allowNull: true },
  monto: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  nombre_archivo: { type: DataTypes.STRING(200), allowNull: false },
  mime: { type: DataTypes.STRING(100), allowNull: false },
  datos: { type: DataTypes.BLOB("long"), allowNull: false },
  creado_por: { type: DataTypes.STRING(100), allowNull: true },
}, {
  tableName: "documentos_venta",
  timestamps: true,
  indexes: [{ name: "documentos_venta_venta_idx", fields: ["venta_id"] }],
});

module.exports = DocumentoVenta;
