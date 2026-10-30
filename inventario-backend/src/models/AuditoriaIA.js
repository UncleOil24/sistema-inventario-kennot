const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Cada respuesta de Claude se guarda para auditar calces y mejorar las instrucciones con el tiempo
const AuditoriaIA = sequelize.define("AuditoriaIA", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  tipo: { type: DataTypes.STRING(40), allowNull: false },
  archivo: { type: DataTypes.STRING(255), allowNull: true },
  usuario: { type: DataTypes.STRING(100), allowNull: true },
  modelo: { type: DataTypes.STRING(60), allowNull: true },
  entrada_tokens: { type: DataTypes.INTEGER, allowNull: true },
  salida_tokens: { type: DataTypes.INTEGER, allowNull: true },
  respuesta: { type: DataTypes.JSONB, allowNull: true },
}, { tableName: "auditoria_ia", timestamps: true, updatedAt: false });

module.exports = AuditoriaIA;
