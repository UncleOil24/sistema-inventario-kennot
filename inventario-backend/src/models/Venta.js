const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Estados: emitida | anulada
// Pago: pendiente | parcial | pagada
// Etapa (recorrido de la venta, una OC = una venta):
//   registrada (Comercial la ingresa) -> aceptada (Operativo la toma y compra) -> lista (llegaron los productos)
//   -> despachada -> entregada.   La facturación va aparte: estado_factura sin_factura | parcial | facturada
const ETAPAS = ["registrada", "aceptada", "lista", "despachada", "entregada"];
const Venta = sequelize.define("Venta", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  numero: { type: DataTypes.STRING(20), allowNull: true },
  cliente_id: { type: DataTypes.INTEGER, allowNull: true },
  cliente_nombre: { type: DataTypes.STRING(255), allowNull: true },
  cotizacion_id: { type: DataTypes.INTEGER, allowNull: true },
  proyecto_id: { type: DataTypes.INTEGER, allowNull: true }, // obsoleto (los proyectos que agrupaban OC se eliminaron)
  empresa: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "kenott" }, // kenott | tactics
  id_solicitud: { type: DataTypes.STRING(60), allowNull: true }, // ID del cliente o de la solicitud (viene de la cotización)
  orden_compra_cliente: { type: DataTypes.STRING(60), allowNull: true }, // N° OC que envía el cliente
  fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  fecha_vencimiento: { type: DataTypes.DATEONLY, allowNull: true },
  documento: { type: DataTypes.STRING(255), allowNull: true }, // N° de las facturas (resumen; el detalle está en "facturas")
  etapa: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "registrada" },
  aceptada_fecha: { type: DataTypes.DATE, allowNull: true },
  aceptada_por: { type: DataTypes.STRING(100), allowNull: true },
  lista_fecha: { type: DataTypes.DATE, allowNull: true },
  lista_por: { type: DataTypes.STRING(100), allowNull: true },
  despacho_fecha: { type: DataTypes.DATEONLY, allowNull: true },
  guia_despacho: { type: DataTypes.STRING(60), allowNull: true },
  despacho_por: { type: DataTypes.STRING(100), allowNull: true },
  entrega_fecha: { type: DataTypes.DATEONLY, allowNull: true },
  recibido_por: { type: DataTypes.STRING(150), allowNull: true }, // quién recibió en el cliente
  estado_factura: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "sin_factura" },
  monto_facturado: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "emitida" },
  // items: [{ producto_id, nombre, unidad, cantidad, precio, costo, proveedor }]
  // "costo" y "proveedor" se copian de la cotización (o del catálogo si es venta directa)
  items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  iva: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  costo_total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  monto_pagado: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  estado_pago: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pendiente" },
  notas: { type: DataTypes.TEXT, allowNull: true },
  creado_por: { type: DataTypes.STRING(100), allowNull: true }, // nombre del usuario que lo registró
}, {
  tableName: "ventas",
  timestamps: true,
  indexes: [{ name: "ventas_numero_uq", unique: true, fields: ["numero"] }],
});

module.exports = Venta;
module.exports.ETAPAS = ETAPAS;
