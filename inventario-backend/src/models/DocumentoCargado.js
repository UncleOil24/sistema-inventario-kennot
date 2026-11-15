const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Documentos de proveedores subidos al catálogo (cotizaciones, facturas, páginas web): para ver cuáles ya se cargaron
// y avisar si se vuelve a subir el mismo (mismo archivo, mismo N° o casi todos los precios iguales).
const DocumentoCargado = sequelize.define("DocumentoCargado", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  hash: { type: DataTypes.STRING(64), allowNull: true }, // huella del archivo (sha256)
  archivo: { type: DataTypes.STRING(255), allowNull: true },
  proveedor: { type: DataTypes.STRING(255), allowNull: false },
  documento: { type: DataTypes.STRING(100), allowNull: true },
  fecha: { type: DataTypes.DATEONLY, allowNull: true },
  origen: { type: DataTypes.STRING(20), allowNull: true },
  productos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  cambios: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  lineas: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, // [{ producto_id, codigo, nombre, precio, antes }]
  usuario: { type: DataTypes.STRING(150), allowNull: true },
}, { tableName: "documentos_cargados", timestamps: true, updatedAt: false, indexes: [{ fields: ["hash"] }, { fields: ["proveedor", "documento"] }] });

module.exports = DocumentoCargado;
