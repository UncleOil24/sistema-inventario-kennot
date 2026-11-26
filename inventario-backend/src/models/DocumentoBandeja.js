const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Bandeja de documentos: todo lo que se compra se sube aquí en el momento (foto, PDF, XML de factura electrónica)
// y después se procesa con calma (se registra la compra con su venta).
const DocumentoBandeja = sequelize.define("DocumentoBandeja", {
  nombre_archivo: { type: DataTypes.STRING(200), allowNull: false },
  mime: { type: DataTypes.STRING(100), allowNull: false },
  tipo: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "imagen" }, // imagen | pdf | xml
  tamano: { type: DataTypes.INTEGER, allowNull: true },
  hash: { type: DataTypes.STRING(64), allowNull: false },
  datos: { type: DataTypes.BLOB("long"), allowNull: false },
  venta_id: { type: DataTypes.INTEGER, allowNull: true },
  nota: { type: DataTypes.STRING(500), allowNull: true },
  // por_procesar | procesado | descartado | duplicado
  estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "por_procesar" },
  // Lectura del documento (encabezado, líneas, control), hecha al subirlo
  lectura: { type: DataTypes.JSONB, allowNull: true },
  leyendo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  error_lectura: { type: DataTypes.STRING(500), allowNull: true },
  proveedor: { type: DataTypes.STRING(150), allowNull: true },
  folio: { type: DataTypes.STRING(50), allowNull: true },
  fecha_documento: { type: DataTypes.DATEONLY, allowNull: true },
  total: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  empresa: { type: DataTypes.STRING(20), allowNull: true }, // a nombre de quién viene (kenott | tactics)
  duplicado_de: { type: DataTypes.STRING(200), allowNull: true },
  sugerencia: { type: DataTypes.JSONB, allowNull: true }, // { orden_id, orden_numero, venta_id, venta_numero, motivo }
  orden_id: { type: DataTypes.INTEGER, allowNull: true },
  gasto_id: { type: DataTypes.INTEGER, allowNull: true },
  subido_por: { type: DataTypes.STRING(150), allowNull: true },
  procesado_por: { type: DataTypes.STRING(150), allowNull: true },
  procesado_en: { type: DataTypes.DATE, allowNull: true },
}, { tableName: "documentos_bandeja", indexes: [{ fields: ["estado"] }, { fields: ["hash"] }] });

module.exports = DocumentoBandeja;
