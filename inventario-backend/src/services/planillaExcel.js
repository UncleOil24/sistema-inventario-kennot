// Genera la planilla LISTADO_CONSOLIDADO_FERRETERIA desde el sistema (M37), en el formato que se vuelve a importar:
// LISTADO CONSOLIDADO, una hoja por categoría, RESUMEN, REGISTRO DE CAMBIOS, EXTRAS PROVEEDORES y COTIZACIONES.
// Precio particular = compra × 1,5 y convenio = compra × 1,3, como fórmulas de Excel.
const ExcelJS = require("exceljs");
const sequelize = require("../../config/database");
const Producto = require("../models/Producto");

const fechaCL = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10).split("-").reverse().join("-") : "");
const VERDE = "FF26747B";
const encabezado = (ws, titulos, anchos) => {
  ws.columns = anchos.map((width) => ({ width }));
  const h = ws.addRow(titulos);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.alignment = { vertical: "middle", wrapText: true };
  h.height = 30;
  h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } }; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: titulos.length } };
};
const PESOS = '"$"#,##0';
const COLS = ["N°", "CATEGORÍA", "DESCRIPCIÓN", "UNIDAD", "PRECIO REAL COMPRA", "PRECIO CONVENIO (x1,3)", "PRECIO PARTICULAR (x1,5)",
  "PROVEEDOR", "CONTACTO", "FECHA ACT.", "REVISAR", "PROVEEDOR OPCIÓN 2", "PRECIO OPCIÓN 2", "FECHA OPCIÓN 2",
  "PROVEEDOR OPCIÓN 3", "PRECIO OPCIÓN 3", "FECHA OPCIÓN 3", "CAMBIO"];
const ANCHOS = [8, 20, 60, 11, 15, 15, 15, 22, 22, 12, 30, 20, 13, 12, 20, 13, 12, 18];
const COLOR = { "Nuevo sin precio": "FFFDE2C4", "Nuevo con precio": "FFD8EFDF", "Precio actualizado": "FFFFF3B0" };
const nombreHoja = (s, usados) => {
  let n = String(s || "SIN CATEGORÍA").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "SIN CATEGORÍA";
  let k = 2;
  while (usados.has(n.toUpperCase())) n = `${n.slice(0, 28)} ${k++}`;
  usados.add(n.toUpperCase());
  return n;
};

async function generarPlanilla({ version, desde } = {}) {
  const productos = await Producto.findAll({ where: { activo: true }, order: [["categoria", "ASC"], ["nombre", "ASC"]], raw: true });
  const cambio = (p) => {
    const conPrecio = Number(p.precio_compra) > 0;
    if (!p.en_planilla) return conPrecio ? "Nuevo con precio" : "Nuevo sin precio";
    if (desde && conPrecio && p.fecha_precio && String(p.fecha_precio) >= desde) return "Precio actualizado";
    return "";
  };
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sistema SyncroGes-Control";
  const fila = (ws, p) => {
    const n = ws.rowCount + 1;
    const compra = Number(p.precio_compra) > 0 ? Math.round(Number(p.precio_compra)) : null;
    const c = cambio(p);
    const r = ws.addRow([
      p.codigo, p.categoria, p.nombre, p.unidad, compra,
      compra ? { formula: `ROUND(E${n}*1.3,0)`, result: Math.round(compra * 1.3) } : null,
      compra ? { formula: `ROUND(E${n}*1.5,0)`, result: Math.round(compra * 1.5) } : null,
      p.proveedor || "", p.contacto || "", fechaCL(p.fecha_precio), p.confirmado ? "OK CONFIRMADO" : (p.revisar || ""),
      p.opcion2_proveedor || "", p.opcion2_precio ? Math.round(Number(p.opcion2_precio)) : null, fechaCL(p.opcion2_fecha),
      p.opcion3_proveedor || "", p.opcion3_precio ? Math.round(Number(p.opcion3_precio)) : null, fechaCL(p.opcion3_fecha), c,
    ]);
    [5, 6, 7, 13, 16].forEach((k) => { r.getCell(k).numFmt = PESOS; });
    if (c) r.getCell(18).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR[c] } };
    if (!compra) r.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2C4" } };
  };

  // 1) Listado completo
  const wsL = wb.addWorksheet("LISTADO CONSOLIDADO");
  encabezado(wsL, COLS, ANCHOS);
  productos.forEach((p) => fila(wsL, p));

  // 2) Una hoja por categoría
  const porCat = new Map();
  productos.forEach((p) => { const k = p.categoria || "SIN CATEGORÍA"; if (!porCat.has(k)) porCat.set(k, []); porCat.get(k).push(p); });
  const usados = new Set(["LISTADO CONSOLIDADO", "RESUMEN", "REGISTRO DE CAMBIOS", "EXTRAS PROVEEDORES", "COTIZACIONES"]);
  const hojasCat = [];
  for (const [cat, lista] of porCat) {
    const ws = wb.addWorksheet(nombreHoja(cat, usados));
    encabezado(ws, COLS, ANCHOS);
    lista.forEach((p) => fila(ws, p));
    hojasCat.push([cat, lista]);
  }

  // 3) Resumen
  const res = wb.addWorksheet("RESUMEN");
  res.columns = [{ width: 32 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  const t = res.addRow([`LISTADO CONSOLIDADO FERRETERÍA v${version || ""}`]); t.font = { bold: true, size: 14 };
  res.addRow(["Generado", new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })]);
  res.addRow(["Precio convenio", "compra × 1,3"]);
  res.addRow(["Precio particular", "compra × 1,5"]);
  res.addRow([]);
  const h = res.addRow(["CATEGORÍA", "PRODUCTOS", "CON PRECIO", "SIN PRECIO", "CONFIRMADOS"]);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } }; h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } }; });
  const tot = [0, 0, 0, 0];
  for (const [cat, lista] of hojasCat) {
    const v = [lista.length, lista.filter((p) => Number(p.precio_compra) > 0).length, lista.filter((p) => !(Number(p.precio_compra) > 0)).length, lista.filter((p) => p.confirmado).length];
    v.forEach((x, i) => { tot[i] += x; });
    res.addRow([cat, ...v]);
  }
  const rt = res.addRow(["TOTAL", ...tot]); rt.font = { bold: true };
  res.addRow([]);
  res.addRow(["Para volver a cargarla: Configuración → Importar planilla. Se combina con el sistema (no borra productos) y muestra una vista previa antes de guardar."]);

  // 4) Registro de cambios
  const wsR = wb.addWorksheet("REGISTRO DE CAMBIOS");
  encabezado(wsR, ["FECHA", "USUARIO", "N° ORIGINAL", "DESCRIPCIÓN", "CAMPO", "ANTES", "DESPUÉS", "MOTIVO"], [18, 22, 10, 50, 16, 20, 20, 40]);
  const [reg] = await sequelize.query(`SELECT r."createdAt", r.usuario, p.codigo, p.nombre, r.campo, r.antes, r.despues, r.motivo
    FROM registro_cambios r LEFT JOIN productos p ON p.id = r.registro_id WHERE r.tabla = 'productos' ORDER BY r."createdAt" DESC, r.id DESC LIMIT 20000`);
  reg.forEach((r) => wsR.addRow([new Date(r.createdAt).toLocaleString("es-CL", { timeZone: "America/Santiago" }), r.usuario, r.codigo, r.nombre, r.campo, r.antes, r.despues, r.motivo]));

  // 5) Historial de precios
  const [precios] = await sequelize.query(`SELECT h.*, p.codigo, p.nombre, pr.contacto AS prov_contacto FROM precios_proveedor h JOIN productos p ON p.id = h.producto_id
    LEFT JOIN proveedores pr ON UPPER(TRIM(pr.nombre)) = UPPER(TRIM(h.proveedor)) WHERE p.activo ORDER BY h.fecha DESC, h.id DESC`);
  const wsE = wb.addWorksheet("EXTRAS PROVEEDORES");
  encabezado(wsE, ["N° NUESTRO", "DESCRIPCIÓN NUESTRA", "PROVEEDOR", "N° COT", "FECHA", "DESCRIPCIÓN DEL PROVEEDOR", "MARCA", "UNID", "PRECIO NETO", "CALCE", "USO EN PLANILLA"],
    [10, 45, 20, 14, 12, 45, 16, 10, 13, 13, 16]);
  precios.filter((x) => x.marca || x.calce || x.descripcion_proveedor).forEach((x) => {
    const r = wsE.addRow([x.codigo, x.nombre, x.proveedor, x.documento, fechaCL(x.fecha), x.descripcion_proveedor, x.marca, x.unidad, Math.round(Number(x.precio)),
      x.calce ? String(x.calce).toUpperCase() : "", x.descartado ? "DESCARTADO" : ""]);
    r.getCell(9).numFmt = PESOS;
  });
  const wsC = wb.addWorksheet("COTIZACIONES");
  encabezado(wsC, ["FECHA", "EMPRESA", "CONTACTO", "N° COTIZACIÓN", "DESCRIPCIÓN EN COTIZACIÓN", "UNIDAD", "CANTIDAD", "PRECIO UNITARIO", "N° PRODUCTO", "DESCRIPCIÓN NUESTRA", "ORIGEN", "ESTADO"],
    [12, 20, 22, 16, 45, 10, 10, 14, 11, 45, 12, 14]);
  precios.forEach((x) => {
    const r = wsC.addRow([fechaCL(x.fecha), x.proveedor, x.prov_contacto || "", x.documento, x.descripcion_proveedor, x.unidad, x.cantidad ? Number(x.cantidad) : null,
      Math.round(Number(x.precio)), x.codigo, x.nombre, x.origen === "web" ? "WEB" : x.origen === "proveedor" ? "PROVEEDOR" : String(x.origen || "").toUpperCase(), x.descartado ? "DESCARTADO" : "VIGENTE"]);
    r.getCell(8).numFmt = PESOS;
  });

  // Orden de las hojas como la planilla: listado, categorías, resumen, registro, extras, cotizaciones
  return wb;
}

module.exports = { generarPlanilla };
