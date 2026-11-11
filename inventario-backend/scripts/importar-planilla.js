// Uso: node scripts/importar-planilla.js ruta/LISTADO_CONSOLIDADO.xlsx [--solo-ver]
// Usa DATABASE_URL del .env. Hace lo mismo que Configuración > Importar planilla.
require("dotenv").config();
const fs = require("fs");
const sequelize = require("../config/database");
require("../src/models/Producto");
require("../src/models/PrecioProveedor");
require("../src/models/Proveedor");
require("../src/models/RegistroCambio");
const { leerPlanilla, planificar, aplicar } = require("../src/services/importarPlanilla");
require("../src/models/RespaldoCatalogo");
const { respaldar } = require("../src/controllers/importarController");

(async () => {
  const archivo = process.argv[2];
  if (!archivo) { console.error("Indica la ruta del .xlsx"); process.exit(1); }
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  // Combina como la pantalla (acepta lo sugerido en "a revisar"); deja respaldo antes
  const datos = await leerPlanilla(fs.readFileSync(archivo));
  const plan = await planificar(datos);
  console.log(plan.resumen);
  if (process.argv.includes("--solo-ver")) { await sequelize.close(); return; }
  await respaldar(`Antes de importar ${archivo} (script)`, "script", archivo);
  const resumen = await aplicar(datos, plan, { usuario: "script" });
  console.log(resumen);
  await sequelize.close();
})().catch((e) => { console.error(e); process.exit(1); });
