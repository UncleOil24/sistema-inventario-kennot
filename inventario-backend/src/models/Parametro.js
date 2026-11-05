const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

// Parámetros editables (márgenes, correlativos). Nada de esto va escrito en el código.
const Parametro = sequelize.define("Parametro", {
  clave: { type: DataTypes.STRING(60), primaryKey: true },
  valor: { type: DataTypes.TEXT, allowNull: false },
}, { tableName: "parametros", timestamps: true });

module.exports = Parametro;
