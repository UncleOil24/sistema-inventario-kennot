const { Sequelize } = require("sequelize");

// En Supabase/Render se usa SSL. Para una BD local sin SSL: DB_SSL=false en el .env
const usarSSL = process.env.DB_SSL !== "false";

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  dialectOptions: usarSSL ? { ssl: { require: true, rejectUnauthorized: false } } : {},
  logging: false,
});

module.exports = sequelize;
