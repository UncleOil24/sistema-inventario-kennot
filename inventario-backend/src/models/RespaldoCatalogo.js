const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Respaldo automático del catálogo antes de cada importación de planilla (M37).
// Guarda los productos tal como estaban, hasta dónde llegaba el historial y la planilla en Excel.
const RespaldoCatalogo = sequelize.define("RespaldoCatalogo", {
  motivo: { type: DataTypes.STRING(200), allowNull: false },
  por: { type: DataTypes.STRING(150), allowNull: true },
  archivo: { type: DataTypes.STRING(200), allowNull: true }, // planilla que se importó
  productos: { type: DataTypes.JSONB, allowNull: false },
  max_producto_id: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  max_precio_id: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  excel: { type: DataTypes.BLOB("long"), allowNull: true },
  resumen: { type: DataTypes.JSONB, allowNull: true },
  deshecho: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  deshecho_por: { type: DataTypes.STRING(150), allowNull: true },
}, { tableName: "respaldos_catalogo" });

module.exports = RespaldoCatalogo;
