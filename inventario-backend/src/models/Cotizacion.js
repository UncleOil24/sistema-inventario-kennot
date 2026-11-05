const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Estados: borrador -> cotizacion -> aceptada (pasa a venta) | rechazada | vencida
// Las rechazadas y vencidas no se borran: sirven para medir cuánto se cotiza y se gana.
const Cotizacion = sequelize.define("Cotizacion", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  numero: { type: DataTypes.STRING(20), allowNull: false }, // correlativo (propio de cada empresa)
  empresa: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "kenott" }, // kenott | tactics
  cliente_id: { type: DataTypes.INTEGER, allowNull: true },
  cliente: { type: DataTypes.STRING(255), allowNull: true }, // nombre (se conserva aunque se borre la ficha)
  // ID que se imprime en la cotización: código del cliente (p.ej. 1422, P-001) o ID de la solicitud
  // de Mercado Público (p.ej. 1422-20-COT26). Queda también en la venta y sus compras.
  id_solicitud: { type: DataTypes.STRING(60), allowNull: true },
  plazo_entrega: { type: DataTypes.STRING(255), allowNull: true }, // texto de "Plazo de entrega" en las condiciones
  lugar_entrega: { type: DataTypes.STRING(255), allowNull: true }, // se imprime en las condiciones si se indica (M22)
  // Cotizaciones de antes de partir la numeración en 100: se conservan pero no cuentan para el correlativo
  anterior: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // Control de presupuesto (M27): { total, grupos: [{ nombre, monto }] } montos con IVA; cada línea puede tener "grupo"
  presupuesto: { type: DataTypes.JSONB, allowNull: true },
  tipo_precio: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "convenio" }, // convenio | particular
  nombre_cotizacion: { type: DataTypes.STRING(255), allowNull: true },
  fecha: { type: DataTypes.DATEONLY, allowNull: true, defaultValue: DataTypes.NOW },
  validez_dias: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
  fecha_validez: { type: DataTypes.DATEONLY, allowNull: true },
  subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  iva: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  total: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  costo_total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "cotizacion" },
  motivo_estado: { type: DataTypes.STRING(255), allowNull: true }, // p.ej. por qué se rechazó
  venta_id: { type: DataTypes.INTEGER, allowNull: true },
  notas: { type: DataTypes.TEXT, allowNull: true },
  // Seguimiento: cuándo se habló por última vez con el cliente y cuándo volver a llamar
  ultimo_contacto: { type: DataTypes.DATEONLY, allowNull: true },
  proximo_contacto: { type: DataTypes.DATEONLY, allowNull: true },
  seguimientos: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }, // [{ fecha, nota, usuario, proximo }]
  archivo_cliente: { type: DataTypes.STRING(255), allowNull: true }, // nombre del archivo que envió el cliente
  creado_por: { type: DataTypes.STRING(100), allowNull: true },
  // items: [{ producto_id, nombre, descripcion_cliente, unidad, cantidad, precio, costo, proveedor }]
  // "precio" (venta) y "costo" (compra) se COPIAN al cotizar: si el catálogo cambia
  // después, la cotización y su margen no se mueven.
  items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
}, {
  tableName: "cotizaciones",
  timestamps: true,
  // El N° es único por empresa entre las cotizaciones nuevas (las "anteriores" pueden repetir número)
  indexes: [{ name: "cotizaciones_empresa_numero_nuevas_uq", unique: true, fields: ["empresa", "numero"], where: { anterior: false } }],
});

module.exports = Cotizacion;
