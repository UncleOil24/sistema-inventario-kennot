// Cotización en Excel con el formato de Tactics Inversiones (copia del diseño de Cotizacion_TACTICS_N592.xlsx).
// Se arma desde cero para que quepan todas las líneas y la firma quede siempre bajo los totales.
const fs = require("fs");
const ExcelJS = require("exceljs");

const TEAL = "FF2A8C8C";
const TEAL_CLARO = "FFEAF6F6";
const ROJO = "FFD6102A";
const GRIS = "FF595959";
const BORDE = { style: "thin", color: { argb: "FFC4CCD2" } };
const CAJA = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE };
const PESOS = '"$" #,##0';
const fechaExcel = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`) : null);

async function excelTactics(cot, emp) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Cotización", {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  ws.columns = [{ width: 5 }, { width: 51 }, { width: 10 }, { width: 13 }, { width: 14 }, { width: 16 }];
  const f = (o = {}) => ({ name: "Arial", size: 10, ...o });
  const alto = (r, h) => { ws.getRow(r).height = h; };
  const linea = (r, lado = "bottom") => { for (let c = 1; c <= 6; c++) ws.getCell(r, c).border = { [lado]: { style: "thick", color: { argb: ROJO } } }; };

  // --- Encabezado con datos de la empresa y logo ---
  [[1, 8], [2, 24], [3, 9], [4, 16], [5, 28], [6, 16], [7, 16], [8, 16], [9, 16], [10, 9], [11, 20], [12, 8]].forEach(([r, h]) => alto(r, h));
  ws.mergeCells("A2:B2");
  ws.getCell("A2").value = emp.nombre;
  ws.getCell("A2").font = f({ size: 15, bold: true, color: { argb: TEAL } });
  ws.getCell("A2").border = { bottom: { style: "thick", color: { argb: ROJO } } };
  ws.getCell("B2").border = { bottom: { style: "thick", color: { argb: ROJO } } };
  const datos = [`R.U.T.: ${emp.rut}`, `Giro: ${emp.giro}`, `Dirección: ${emp.direccion}`, `Contacto: ${emp.contacto}`, `Correo: ${emp.email}`, `Fono: ${emp.fono}`];
  datos.forEach((t, k) => {
    const r = 4 + k;
    ws.mergeCells(`A${r}:C${r}`);
    ws.getCell(`A${r}`).value = t;
    ws.getCell(`A${r}`).font = f();
    ws.getCell(`A${r}`).alignment = { vertical: "middle", wrapText: true };
  });
  linea(9);
  if (fs.existsSync(emp.logo)) {
    const id = wb.addImage({ filename: emp.logo, extension: "png" });
    ws.addImage(id, { tl: { col: 2.55, row: 1.3 }, ext: { width: 269, height: 116 } });
  }

  // --- Título ---
  ws.mergeCells("A11:F11");
  ws.getCell("A11").value = `COTIZACIÓN N° ${cot.numero}`;
  ws.getCell("A11").font = f({ size: 14, bold: true, color: { argb: "FFFFFFFF" } });
  ws.getCell("A11").fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  ws.getCell("A11").alignment = { horizontal: "center", vertical: "middle" };

  // --- Cliente / proyecto / entrega ---
  const MED = { style: "medium", color: { argb: TEAL } };
  const filasCliente = [
    [`Cliente: ${cot.cliente || "________________________"}`, "Fecha:", fechaExcel(cot.fecha)],
    [`Proyecto: ${cot.nombre_cotizacion || ""}`, "Válida hasta:", fechaExcel(cot.fecha_validez)],
    [`Entrega: ${emp.entrega || ""}`, "", null],
  ];
  filasCliente.forEach(([a, d, e], k) => {
    const r = 13 + k;
    alto(r, 20);
    ws.mergeCells(`A${r}:C${r}`);
    ws.mergeCells(`E${r}:F${r}`);
    ws.getCell(`A${r}`).value = a;
    ws.getCell(`D${r}`).value = d;
    ws.getCell(`E${r}`).value = e;
    for (const c of ["A", "D", "E"]) ws.getCell(`${c}${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_CLARO } };
    ws.getCell(`A${r}`).font = f();
    ws.getCell(`A${r}`).alignment = { vertical: "middle", shrinkToFit: true };
    ws.getCell(`D${r}`).font = f({ bold: true, color: { argb: TEAL } });
    ws.getCell(`D${r}`).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(`E${r}`).font = f();
    ws.getCell(`E${r}`).numFmt = "dd-mm-yyyy";
    ws.getCell(`E${r}`).alignment = { horizontal: "center", vertical: "middle" };
    for (let c = 1; c <= 6; c++) {
      const b = {};
      if (k === 0) b.top = MED;
      if (k === 2) b.bottom = MED;
      if (c === 1) b.left = MED;
      if (c === 6) b.right = MED;
      if (Object.keys(b).length) ws.getCell(r, c).border = b;
    }
  });
  alto(16, 10);

  // --- Tabla de productos ---
  const ENC = 17;
  alto(ENC, 22);
  ["N°", "Producto o detalle", "Unidad", "Cantidad", "Precio unitario", "Total"].forEach((t, k) => {
    const c = ws.getCell(ENC, k + 1);
    c.value = t;
    c.font = f({ bold: true, color: { argb: "FFFFFFFF" } });
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    c.alignment = { horizontal: k === 1 ? "left" : "center", vertical: "middle" };
    c.border = CAJA;
  });
  const items = cot.items || [];
  items.forEach((it, idx) => {
    const r = ENC + 1 + idx;
    const valores = [idx + 1, it.nombre, it.unidad || "Unidad", Number(it.cantidad), Math.round(Number(it.precio)), { formula: `D${r}*E${r}`, result: Math.round(Number(it.precio) * Number(it.cantidad)) }];
    valores.forEach((v, k) => {
      const c = ws.getCell(r, k + 1);
      c.value = v;
      c.font = f();
      c.border = CAJA;
      c.alignment = { horizontal: [0, 2, 3].includes(k) ? "center" : k >= 4 ? "right" : "left", vertical: "middle", wrapText: k === 1 };
      if (k >= 4) c.numFmt = PESOS;
      if (idx % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_CLARO } };
    });
    ws.getRow(r).height = Math.max(18, Math.ceil(String(it.nombre || "").length / 55) * 14);
  });
  const ultima = ENC + Math.max(items.length, 1);

  // --- Condiciones y totales ---
  const T = ultima + 2;
  alto(T - 1, 8);
  ws.getCell(`B${T}`).value = "Condiciones comerciales";
  ws.getCell(`B${T}`).font = f({ bold: true, color: { argb: TEAL } });
  const condiciones = [
    "• Valores en pesos chilenos. Precio neto + IVA 19%.",
    `• Plazo de entrega: ${emp.entrega || "a convenir"} una vez aceptada la propuesta y emitida la orden de compra.`,
    `• Garantía: ${emp.garantia || "según fabricante"}.`,
    `• Modalidad de servicio: ${emp.modalidad || "suministro de materiales"}.`,
    "• Precios válidos hasta la fecha indicada.",
  ];
  condiciones.forEach((t, k) => {
    const c = ws.getCell(`B${T + 1 + k}`);
    c.value = t;
    c.font = f({ size: 9, color: { argb: GRIS } });
    c.alignment = { vertical: "top", wrapText: true };
    alto(T + 1 + k, k === 1 ? 26 : 15);
  });
  const totales = [["Precio neto:", { formula: `SUM(F${ENC + 1}:F${ultima})`, result: Math.round(Number(cot.subtotal)) }],
    ["IVA 19%:", { formula: `ROUND(F${T}*0.19,0)`, result: Math.round(Number(cot.iva)) }],
    ["TOTAL:", { formula: `F${T}+F${T + 1}`, result: Math.round(Number(cot.total)) }]];
  totales.forEach(([e, v], k) => {
    const r = T + k;
    const total = k === 2;
    const ce = ws.getCell(`E${r}`); const cf = ws.getCell(`F${r}`);
    ce.value = e; cf.value = v;
    for (const c of [ce, cf]) {
      c.font = f({ bold: true, size: total ? 11 : 10, color: { argb: total ? "FFFFFFFF" : "FF000000" } });
      c.alignment = { horizontal: "right", vertical: "middle" };
      c.border = CAJA;
      if (total) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    }
    cf.numFmt = PESOS;
  });
  alto(T + 2, 26);

  // --- Firma (bajo los totales) ---
  if (fs.existsSync(emp.firma)) {
    const id = wb.addImage({ filename: emp.firma, extension: "png" });
    ws.addImage(id, { tl: { col: 2.05, row: T + 3.4 }, ext: { width: 270, height: 132 } });
  }

  // --- Datos para transferencia ---
  const D = T + 8;
  alto(D - 1, 6);
  ws.getCell(`B${D}`).value = "Datos para transferencia";
  ws.getCell(`B${D}`).font = f({ bold: true, color: { argb: TEAL } });
  [[`${emp.nombre}  ·  R.U.T. ${emp.rut}`, false], [`Banco ${emp.banco}  ·  ${emp.tipo_cuenta} N° ${emp.numero_cuenta}`, true]].forEach(([t, b], k) => {
    const c = ws.getCell(`B${D + 1 + k}`);
    c.value = t;
    c.font = f({ size: 9, bold: b, color: { argb: "FF333333" } });
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_CLARO } };
    c.border = { left: { style: "thick", color: { argb: TEAL } } };
    alto(D + 1 + k, 16);
  });

  // --- Pie ---
  const P = D + 4;
  alto(P - 1, 24);
  ws.getCell(`A${P}`).value = `${emp.nombre}  ·  ${emp.email}  ·  ${emp.fono}`;
  for (let c = 1; c <= 6; c++) {
    const cell = ws.getCell(P, c);
    cell.border = { top: { style: "thick", color: { argb: ROJO } } };
    cell.alignment = { horizontal: "centerContinuous" };
    cell.font = f({ size: 9, color: { argb: GRIS } });
  }
  ws.pageSetup.printArea = `A1:F${P}`;
  return wb;
}

module.exports = { excelTactics };
