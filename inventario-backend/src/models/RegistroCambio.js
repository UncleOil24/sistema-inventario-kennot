const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const RegistroCambio = sequelize.define("RegistroCambio", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  usuario: { type: DataTypes.STRING(100), allowNull: true },
  tabla: { type: DataTypes.STRING(50), allowNull: false },
  registro_id: { type: DataTypes.INTEGER, allowNull: true },
  campo: { type: DataTypes.STRING(60), allowNull: true },
  antes: { type: DataTypes.TEXT, allowNull: true },
  despues: { type: DataTypes.TEXT, allowNull: true },
  motivo: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: "registro_cambios",
  timestamps: true,
  updatedAt: false,
  indexes: [{ name: "registro_cambios_tabla_idx", fields: ["tabla", "registro_id"] }],
});

module.exports = RegistroCambio;
