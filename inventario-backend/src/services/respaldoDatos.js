// Respaldo completo de los datos del sistema (gerencia), para guardarlo o restaurarlo en otra instalación.
//  - JSON comprimido (.json.gz): todas las tablas, se restaura con scripts/restaurar-datos.js
//  - Excel: una hoja por tabla, para mirar los datos
// Las claves de los usuarios se guardan cifradas (como están en la base); nunca se guardan claves del SII.
const zlib = require("zlib");
const ExcelJS = require("exceljs");
const sequelize = require("../../config/database");
const { QueryTypes } = require("sequelize");
const sel = (sql) => sequelize.query(sql, { type: QueryTypes.SELECT });

const VERSION = 1;
// Tablas que no aportan al respaldo o son muy pesadas (respaldos del catálogo: ya son copias)
const OMITIR = new Set(["SequelizeMeta"]);

async function tablas() {
  const t = await sel(`SELECT table_name::text AS table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  return t.map((x) => x.table_name).filter((n) => !OMITIR.has(n));
}
async function columnasBinarias() {
  const c = await sel(`SELECT table_name::text AS table_name, column_name::text AS column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'bytea'`);
  const m = new Map();
  for (const x of c) { if (!m.has(x.table_name)) m.set(x.table_name, []); m.get(x.table_name).push(x.column_name); }
  return m;
}

// conArchivos: incluye los PDF guardados (facturas SII y de compras) en base64; el Excel de los respaldos del catálogo nunca
async function generarJSON({ conArchivos = true } = {}) {
  const bin = await columnasBinarias();
  const out = { sistema: "SyncroGes-Control", version: VERSION, generado: new Date().toISOString(), tablas: {} };
  for (const t of await tablas()) {
    // Las copias internas del catálogo (para "deshacer importación") no se respaldan: pesan mucho y no se restauran
    if (t === "respaldos_catalogo") continue;
    const binarias = bin.get(t) || [];
    const quitar = conArchivos ? [] : binarias;
    const filas = await sel(`SELECT * FROM "${t}" ORDER BY 1`);
    out.tablas[t] = filas.map((f) => {
      for (const c of quitar) f[c] = null;
      for (const c of binarias) if (Buffer.isBuffer(f[c])) f[c] = { __base64: f[c].toString("base64") };
      return f;
    });
  }
  return zlib.gzipSync(Buffer.from(JSON.stringify(out)));
}

async function generarExcel() {
  const bin = await columnasBinarias();
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet("INFO");
  info.columns = [{ width: 32 }, { width: 14 }];
  info.addRow(["Respaldo de datos — Sistema SyncroGes-Control"]).font = { bold: true, size: 13 };
  info.addRow(["Generado", new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })]);
  info.addRow(["Para restaurar use el archivo .json.gz (este Excel es para consulta)."]);
  info.addRow([]);
  info.addRow(["TABLA", "FILAS"]).font = { bold: true };
  for (const t of await tablas()) {
    const binarias = new Set(bin.get(t) || []);
    if (t === "respaldos_catalogo") binarias.add("productos");
    const filas = await sel(`SELECT * FROM "${t}" ORDER BY 1`);
    info.addRow([t, filas.length]);
    const ws = wb.addWorksheet(t.slice(0, 31));
    const cols = filas.length ? Object.keys(filas[0]).filter((c) => !binarias.has(c)) : [];
    if (!cols.length) { ws.addRow(["(sin datos)"]); continue; }
    const h = ws.addRow(cols); h.font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const f of filas) {
      ws.addRow(cols.map((c) => {
        const v = f[c];
        if (v == null) return null;
        if (v instanceof Date) return v;
        if (typeof v === "object") return JSON.stringify(v).slice(0, 32000);
        return typeof v === "string" ? v.slice(0, 32000) : v;
      }));
    }
    cols.forEach((_, i) => { ws.getColumn(i + 1).width = 18; });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generarJSON, generarExcel, VERSION };
