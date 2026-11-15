const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Estados: borrador -> recibida | anulada  (sin control de stock)
// Pago: pendiente | parcial | pagada
const OrdenCompra = sequelize.define("OrdenCompra", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  numero: { type: DataTypes.STRING(20), allowNull: true },
  proveedor_id: { type: DataTypes.INTEGER, allowNull: true },
  venta_id: { type: DataTypes.INTEGER, allowNull: true }, // si nació del cuadro de compra de una venta
  proyecto_id: { type: DataTypes.INTEGER, allowNull: true }, // obsoleto (compras consolidadas de los proyectos eliminados)
  proveedor_nombre: { type: DataTypes.STRING(255), allowNull: true },
  fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  fecha_recepcion: { type: DataTypes.DATE, allowNull: true },
  fecha_vencimiento: { type: DataTypes.DATEONLY, allowNull: true },
  documento: { type: DataTypes.STRING(50), allowNull: true }, // N° factura del proveedor
  fecha_factura: { type: DataTypes.DATEONLY, allowNull: true }, // fecha de la factura del proveedor (crédito fiscal del IVA de ese mes)
  empresa: { type: DataTypes.STRING(20), allowNull: true }, // kenott | tactics: la empresa que compra (la de la venta)
  estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "borrador" },
  // items: [{ producto_id, nombre, unidad, cantidad, precio }]
  items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  factura_grupo: { type: DataTypes.STRING(30), allowNull: true }, // misma factura repartida entre varias ventas (una compra por venta)
  no_vinieron: { type: DataTypes.JSONB, allowNull: true }, // [{ producto_id, nombre, cantidad, pedido }] lo que no vino en la factura (sin stock)
  subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  iva: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  monto_pagado: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  estado_pago: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pendiente" },
  // Tipo de pago: contado (pagada al recibir) | credito_empresa (tarjeta o línea de la empresa: al proveedor queda pagada)
  //               | credito_proveedor (el proveedor da plazo: queda en Por pagar). Vacío = compras anteriores (como crédito proveedor)
  tipo_pago: { type: DataTypes.STRING(20), allowNull: true },
  notas: { type: DataTypes.TEXT, allowNull: true },
  creado_por: { type: DataTypes.STRING(100), allowNull: true }, // nombre del usuario que lo registró
}, {
  tableName: "ordenes_compra",
  timestamps: true,
  indexes: [{ name: "ordenes_compra_numero_uq", unique: true, fields: ["numero"] }],
});

const PAGO_AUTOMATICO = { contado: "contado", credito_empresa: "crédito empresa" };
OrdenCompra.PAGO_AUTOMATICO = PAGO_AUTOMATICO;
// Compras nuevas: contado por defecto
OrdenCompra.beforeCreate((o) => { if (!o.tipo_pago) o.tipo_pago = "contado"; });
// Al quedar recibida una compra de contado o con crédito de la empresa, queda pagada al proveedor (pago automático por el saldo)
OrdenCompra.afterSave(async (o, opciones) => {
  if (o.estado !== "recibida" || !PAGO_AUTOMATICO[o.tipo_pago]) return;
  const saldo = Math.round(Number(o.total) - Number(o.monto_pagado));
  if (saldo <= 0) return;
  const Pago = require("./Pago");
  const t = opciones?.transaction;
  await Pago.create({ tipo: "pago", orden_compra_id: o.id, monto: saldo, fecha: o.fecha_factura || new Date(), medio: o.tipo_pago,
    nota: `Pago automático (${PAGO_AUTOMATICO[o.tipo_pago]})`, creado_por: o.creado_por || null }, { transaction: t });
  await OrdenCompra.update({ monto_pagado: Number(o.total), estado_pago: "pagada" }, { where: { id: o.id }, transaction: t, hooks: false });
  o.setDataValue("monto_pagado", Number(o.total)); o.setDataValue("estado_pago", "pagada");
});
// Quita los pagos automáticos (al pasar a crédito proveedor o al repartir la compra)
OrdenCompra.quitarPagosAutomaticos = async (o, t) => {
  const Pago = require("./Pago");
  const { Op } = require("sequelize");
  const auto = await Pago.findAll({ where: { orden_compra_id: o.id, nota: { [Op.like]: "Pago automático%" } }, transaction: t });
  if (!auto.length) return 0;
  const monto = auto.reduce((s, p) => s + Number(p.monto), 0);
  await Pago.destroy({ where: { id: auto.map((p) => p.id) }, transaction: t });
  const pagado = Math.max(0, Number(o.monto_pagado) - monto);
  await OrdenCompra.update({ monto_pagado: pagado, estado_pago: pagado > 0 ? "parcial" : "pendiente" }, { where: { id: o.id }, transaction: t, hooks: false });
  o.setDataValue("monto_pagado", pagado);
  return monto;
};

module.exports = OrdenCompra;
