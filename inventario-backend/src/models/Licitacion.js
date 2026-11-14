const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Procesos de Mercado Público (licitaciones y Compra Ágil) que pueden interesarnos.
// estado_interno: nueva | revisada | descartada | cotizada | postulada (confirmada a mano: se envió en Mercado Público)
const Licitacion = sequelize.define("Licitacion", {
  codigo: { type: DataTypes.STRING(40), primaryKey: true }, // CodigoExterno, ej. 2401-55-LE26
  nombre: { type: DataTypes.TEXT, allowNull: false },
  descripcion: { type: DataTypes.TEXT, allowNull: true },
  organismo: { type: DataTypes.STRING(255), allowNull: true },
  unidad: { type: DataTypes.STRING(255), allowNull: true },
  rut_unidad: { type: DataTypes.STRING(20), allowNull: true },
  region: { type: DataTypes.STRING(100), allowNull: true },
  comuna: { type: DataTypes.STRING(100), allowNull: true },
  tipo: { type: DataTypes.STRING(10), allowNull: true },
  estado: { type: DataTypes.STRING(30), allowNull: true },
  fecha_publicacion: { type: DataTypes.DATE, allowNull: true },
  fecha_cierre: { type: DataTypes.DATE, allowNull: true },
  monto_estimado: { type: DataTypes.DECIMAL(16, 2), allowNull: true },
  palabras: { type: DataTypes.STRING(255), allowNull: true }, // palabras clave que calzaron
  items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, // [{ producto, descripcion, cantidad, unidad }]
  detalle_cargado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  estado_interno: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "nueva" },
  nota: { type: DataTypes.TEXT, allowNull: true },
  cotizacion_id: { type: DataTypes.INTEGER, allowNull: true },
  avisada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // ya salió en el resumen de la mañana
  fuente: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "licitacion" }, // licitacion | compra_agil
  prioridad: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // organismo de la lista de prioridad
  relevancia: { type: DataTypes.INTEGER, allowNull: true }, // 0-100: qué tanto calza con lo que vendemos (Claude)
  motivo_relevancia: { type: DataTypes.STRING(255), allowNull: true },
  descarte_auto: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // la descartó el sistema, no una persona
  manual: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // traída por código: se muestra aunque no cumpla los filtros
  // --- Ficha para postular (M29, M32) ---
  empresa_postula: { type: DataTypes.STRING(20), allowNull: true }, // kenott | tactics | ambas
  presupuesto: { type: DataTypes.DECIMAL(16, 2), allowNull: true }, // disponible, con IVA (si las bases lo informan)
  grupos: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, // [{ nombre, monto }] montos por grupo de ítems, con IVA
  lugar_entrega: { type: DataTypes.STRING(255), allowNull: true },
  criterios: { type: DataTypes.TEXT, allowNull: true }, // ej. "precio 50%, plazo 30%, localidad 20%"
  checklist: { type: DataTypes.JSONB, allowNull: true }, // [{ doc, listo }] documentos exigidos
  // --- Postulación confirmada (se envió en Mercado Público): no basta con cotizar ---
  postulada_en: { type: DataTypes.DATE, allowNull: true },
  postulada_por: { type: DataTypes.STRING(120), allowNull: true },
  postulada_empresa: { type: DataTypes.STRING(20), allowNull: true }, // kenott | tactics | ambas
  postulada_cotizacion_id: { type: DataTypes.INTEGER, allowNull: true }, // null = se postuló sin cotización en el sistema
}, {
  tableName: "licitaciones",
  timestamps: true,
  indexes: [{ name: "licitaciones_cierre_idx", fields: ["fecha_cierre"] }],
});

module.exports = Licitacion;
