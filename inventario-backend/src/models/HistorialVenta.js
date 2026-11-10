const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Historial de cada venta: quién hizo cada paso y cuándo, con los retrocesos y facturas quitadas con su motivo.
// tipo: paso | factura | retroceso | factura_quitada | anulacion
const HistorialVenta = sequelize.define("HistorialVenta", {
  venta_id: { type: DataTypes.INTEGER, allowNull: false },
  tipo: { type: DataTypes.STRING(30), allowNull: false },
  texto: { type: DataTypes.STRING(300), allowNull: false },
  motivo: { type: DataTypes.TEXT, allowNull: true },
  por: { type: DataTypes.STRING(150), allowNull: true },
}, { tableName: "historial_venta", indexes: [{ fields: ["venta_id"] }, { fields: ["tipo", "createdAt"] }] });

HistorialVenta.anotar = (v, tipo, texto, req, t, motivo) => {
  const { firma } = require("../middlewares/auth");
  return HistorialVenta.create({ venta_id: v.id, tipo, texto: String(texto).slice(0, 300), motivo: motivo || null, por: req ? firma(req) : null }, { transaction: t });
};

module.exports = HistorialVenta;
