// Uso: node scripts/importar-planilla.js ruta/LISTADO_CONSOLIDADO.xlsx [--desactivar-otros]
// Usa DATABASE_URL del .env. Hace lo mismo que Configuración > Importar planilla.
require("dotenv").config();
const fs = require("fs");
const sequelize = require("../config/database");
require("../src/models/Producto");
require("../src/models/PrecioProveedor");
require("../src/models/Proveedor");
require("../src/models/RegistroCambio");
const { importarPlanilla } = require("../src/services/importarPlanilla");

(async () => {
  const archivo = process.argv[2];
  if (!archivo) { console.error("Indica la ruta del .xlsx"); process.exit(1); }
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  const resumen = await importarPlanilla(fs.readFileSync(archivo), {
    usuario: "script", desactivarOtros: process.argv.includes("--desactivar-otros"),
  });
  console.log(resumen);
  await sequelize.close();
})().catch((e) => { console.error(e); process.exit(1); });
