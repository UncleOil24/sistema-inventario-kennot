// Restaura un respaldo de datos (Respaldo_datos_SyncroGes_....json.gz) en la base de datos configurada en .env
// (DATABASE_URL). Pensado para una instalación nueva: primero inicie el servidor una vez (crea las tablas),
// deténgalo y luego ejecute:
//   node scripts/restaurar-datos.js ruta/Respaldo_datos_SyncroGes_AAAA-MM-DD_HH-MM.json.gz --confirmar
// ATENCIÓN: reemplaza TODOS los datos de las tablas incluidas en el respaldo.
require("dotenv").config();
const fs = require("fs");
const zlib = require("zlib");
const sequelize = require("../config/database");
const { QueryTypes } = require("sequelize");

(async () => {
  const archivo = process.argv[2];
  if (!archivo || !fs.existsSync(archivo)) { console.error("Indique el archivo .json.gz del respaldo"); process.exit(1); }
  const datos = JSON.parse(zlib.gunzipSync(fs.readFileSync(archivo)).toString("utf8"));
  if (datos.sistema !== "SyncroGes-Control") { console.error("El archivo no es un respaldo del sistema"); process.exit(1); }
  const tablas = Object.keys(datos.tablas);
  console.log(`Respaldo del ${datos.generado}: ${tablas.length} tablas`);
  if (!process.argv.includes("--confirmar")) { console.log("Revise y vuelva a ejecutar con --confirmar para reemplazar los datos."); process.exit(0); }
  const existentes = await sequelize.query(`SELECT table_name::text AS table_name FROM information_schema.tables WHERE table_schema = 'public'`, { type: QueryTypes.SELECT });
  const hay = new Set(existentes.map((x) => x.table_name));
  await sequelize.transaction(async (t) => {
    for (const nombre of tablas) {
      if (nombre === "respaldos_catalogo") continue;
      if (!hay.has(nombre)) { console.log(`  (se omite ${nombre}: la tabla no existe; inicie el servidor una vez antes)`); continue; }
      const cols = await sequelize.query(`SELECT column_name::text AS column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :n`, { replacements: { n: nombre }, transaction: t, type: QueryTypes.SELECT });
      const validas = new Set(cols.map((c) => c.column_name));
      await sequelize.query(`DELETE FROM "${nombre}"`, { transaction: t });
      const filas = datos.tablas[nombre].map((f) => {
        const o = {};
        for (const [k, v] of Object.entries(f)) {
          if (!validas.has(k)) continue;
          o[k] = v && typeof v === "object" && v.__base64 ? Buffer.from(v.__base64, "base64") : v && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
        }
        return o;
      });
      for (let i = 0; i < filas.length; i += 500) {
        const lote = filas.slice(i, i + 500);
        if (lote.length) await sequelize.getQueryInterface().bulkInsert(nombre, lote, { transaction: t });
      }
      // Que los nuevos registros sigan después del último id
      if (validas.has("id")) {
        await sequelize.query(`SELECT setval(pg_get_serial_sequence('"${nombre}"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${nombre}"), 0), 1))`, { transaction: t }).catch(() => {});
      }
      console.log(`  ✓ ${nombre}: ${filas.length}`);
    }
  });
  console.log("Restauración terminada.");
  await sequelize.close();
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
