const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const Cliente = sequelize.define("Cliente", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  // ID del cliente: unidad de compra de Mercado Público (p.ej. 1422 = CONAF), P-001... para el resto,
  // y "CG" para el Cliente general (ventas sueltas, el nombre se escribe en cada documento)
  codigo: { type: DataTypes.STRING(30), allowNull: true },
  nombre: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  rut: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  telefono: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  direccion: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  // convenio (instituciones: compra x 1,30) | particular (compra x 1,50)
  tipo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "convenio" },
  contacto: { type: DataTypes.STRING(150), allowNull: true },
  comuna: { type: DataTypes.STRING(100), allowNull: true },
  // Institución a la que pertenece la unidad de compra (una municipalidad puede tener varios ID:
  // 2295 = Municipalidad de Talca compras generales, 2292 = Municipalidad de Talca Salud)
  organismo: { type: DataTypes.STRING(255), allowNull: true },
  empresa: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "ambas" }, // kenott | tactics | ambas
  // Cobranza: cada cliente paga con su plazo; se copia a sus ventas y se puede cambiar en cada una
  plazo_pago_dias: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
  base_vencimiento: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "factura" }, // factura | recepcion (recepción conforme)
  contacto_finanzas: { type: DataTypes.STRING(150), allowNull: true },
  limite_credito: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  estado_credito: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "activo" }, // activo | suspendido
  motivo_credito: { type: DataTypes.STRING(255), allowNull: true }, // por qué se suspendió (ej. automático por morosidad crítica)
  usa_factoring: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // sus facturas a veces se ceden a factoring
  notas: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: "clientes",
  timestamps: true,
  indexes: [{ name: "clientes_codigo_uq", unique: true, fields: ["codigo"] }],
});

module.exports = Cliente;