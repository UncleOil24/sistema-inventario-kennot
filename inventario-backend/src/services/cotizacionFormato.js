// Cotización en Excel y PDF con las plantillas oficiales de cada empresa
// (Cotizacion_KENOTT_PLANTILLA.xlsx y Cotizacion_TACTICS_PLANTILLA.xlsx).
// Las dos comparten estructura: encabezado con datos y logo, título, recuadro de cliente
// (Cliente / Descripción o Proyecto / ID solicitud), tabla, condiciones + totales, firma,
// datos para transferencia y pie. Cambian colores, textos y la posición de logo y firma.
// La tabla crece con la cantidad de productos (mínimo 10 líneas en el Excel, para poder agregar a mano).
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const FORMATOS = {
  kenott: {
    color: "517B52", claro: "EEF4EE", linea: "517B52", // pie: línea delgada verde
    titulo: { size: 16, alto: 30 },
    fila2: "Descripción",
    servicio: "• Servicio: contratación de suministro de materiales.",
    responsable: true, // "Responsable comercial" + firma con nombre del representante
  },
  tactics: {
    color: "2A8C8C", claro: "EAF6F6", linea: "D6102A", // líneas rojas gruesas
    titulo: { size: 14, alto: 20.1 },
    fila2: "Proyecto",
    servicio: "• Servicio: Contratación de suministro de materiales.",
    responsable: false,
  },
};

const PLAZO_DEFECTO = "02 días hábiles una vez aceptada la propuesta y emitida la orden de compra";
const BORDE_TABLA = "C4CCD2";
const GRIS = "595959";
const fechaCL = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("-") : "");
const pesos = (n) => Math.round(Number(n) || 0).toLocaleString("es-CL");
const cantidadTxt = (n) => { const v = Number(n); return Number.isInteger(v) ? String(v) : v.toLocaleString("es-CL"); };

// Líneas de datos de la empresa bajo el nombre
const lineasEmpresa = (clave, emp) => (clave === "tactics"
  ? [`R.U.T.: ${emp.rut}`, `Giro: ${emp.giro}`, `Dirección: ${emp.direccion}`, `Contacto: ${emp.contacto}`, `Correo: ${emp.email}`, `Fono: ${emp.fono}`]
  : [`R.U.T.: ${emp.rut}`, emp.giro, `Contacto: ${emp.contacto}`, `Correo: ${emp.email}`, `Fono: ${emp.fono}`]);

const condiciones = (fmt, cot) => [
  "• Valores en pesos chilenos. Precio neto + IVA 19%.",
  `• Plazo de entrega: ${String(cot.plazo_entrega || PLAZO_DEFECTO).replace(/\.\s*$/, "")}.`,
  fmt.servicio,
  "• Precios válidos hasta la fecha indicada.",
];

const filasCliente = (fmt, cot) => [
  [`Cliente: ${cot.cliente || ""}`, "Fecha:", fechaCL(cot.fecha)],
  [`${fmt.fila2}: ${cot.nombre_cotizacion || ""}`, "Válida hasta:", fechaCL(cot.fecha_validez)],
  [`ID solicitud: ${cot.id_solicitud || ""}`, "", ""],
];

// ---------------------------------------------------------------- Excel
// Esquina de una imagen: columna/fila (desde 0) + desplazamiento en EMU
const ancla = (nativeCol, nativeColOff, nativeRow, nativeRowOff) => ({ nativeCol, nativeColOff, nativeRow, nativeRowOff });
async function excelCotizacion(cot, emp) {
  const clave = emp.clave === "tactics" ? "tactics" : "kenott";
  const fmt = FORMATOS[clave];
  const COLOR = `FF${fmt.color}`; const CLARO = `FF${fmt.claro}`; const LINEA = `FF${fmt.linea}`;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Cotización", {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  ws.columns = [{ width: 5 }, { width: 51 }, { width: 10 }, { width: 13 }, { width: 14 }, { width: 16 }];
  const f = (o = {}) => ({ name: "Arial", size: 10, ...o });
  const alto = (r, h) => { ws.getRow(r).height = h; };
  const relleno = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const caja = { top: { style: "thin", color: { argb: `FF${BORDE_TABLA}` } }, bottom: { style: "thin", color: { argb: `FF${BORDE_TABLA}` } }, left: { style: "thin", color: { argb: `FF${BORDE_TABLA}` } }, right: { style: "thin", color: { argb: `FF${BORDE_TABLA}` } } };

  // --- Encabezado ---
  const datos = lineasEmpresa(clave, emp);
  const primeraDato = clave === "tactics" ? 4 : 3;
  alto(1, 8.1); alto(2, 24);
  ws.mergeCells(clave === "tactics" ? "A2:B2" : "A2:C2");
  ws.getCell("A2").value = emp.nombre;
  ws.getCell("A2").font = f({ size: 15, bold: true, color: { argb: COLOR } });
  if (clave === "tactics") {
    alto(3, 9);
    for (const c of ["A2", "B2"]) ws.getCell(c).border = { bottom: { style: "thick", color: { argb: LINEA } } };
  }
  datos.forEach((t, k) => {
    const r = primeraDato + k;
    alto(r, clave === "tactics" && k === 1 ? 28 : 15.95);
    ws.mergeCells(`A${r}:C${r}`);
    ws.getCell(`A${r}`).value = t;
    ws.getCell(`A${r}`).font = f();
    ws.getCell(`A${r}`).alignment = { vertical: "middle", wrapText: true };
  });
  const ultimoDato = primeraDato + datos.length - 1;
  if (clave === "tactics") for (let c = 1; c <= 6; c++) ws.getCell(ultimoDato, c).border = { bottom: { style: "thick", color: { argb: LINEA } } };
  if (fs.existsSync(emp.logo)) {
    const id = wb.addImage({ filename: emp.logo, extension: "png" });
    // Misma posición que en la plantilla (en EMU, como las guarda Excel)
    if (clave === "tactics") ws.addImage(id, { tl: ancla(2, 561975, 1, 266700), ext: { width: 269, height: 116 } });
    else ws.addImage(id, { tl: ancla(3, 781050, 1, 38100), ext: { width: 151, height: 131 } });
  }

  // --- Título ---
  const TIT = ultimoDato + 2;
  alto(TIT - 1, 9.95);
  alto(TIT, fmt.titulo.alto);
  ws.mergeCells(`A${TIT}:F${TIT}`);
  ws.getCell(`A${TIT}`).value = `COTIZACIÓN N° ${cot.numero}`;
  ws.getCell(`A${TIT}`).font = f({ size: fmt.titulo.size, bold: true, color: { argb: "FFFFFFFF" } });
  ws.getCell(`A${TIT}`).fill = relleno(COLOR);
  ws.getCell(`A${TIT}`).alignment = { horizontal: "center", vertical: "middle" };

  // --- Recuadro del cliente ---
  const CLI = TIT + 2;
  alto(CLI - 1, 8.1);
  const MED = { style: "medium", color: { argb: COLOR } };
  filasCliente(fmt, cot).forEach(([a, d, e], k) => {
    const r = CLI + k;
    alto(r, 20.1);
    ws.mergeCells(`A${r}:C${r}`);
    ws.mergeCells(`E${r}:F${r}`);
    ws.getCell(`A${r}`).value = a;
    ws.getCell(`D${r}`).value = d;
    ws.getCell(`E${r}`).value = e;
    for (const c of ["A", "D", "E"]) ws.getCell(`${c}${r}`).fill = relleno(CLARO);
    ws.getCell(`A${r}`).font = f();
    ws.getCell(`A${r}`).alignment = { vertical: "middle", shrinkToFit: true };
    ws.getCell(`D${r}`).font = f({ bold: true, color: { argb: COLOR } });
    ws.getCell(`D${r}`).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(`E${r}`).font = f();
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

  // --- Tabla de productos ---
  const ENC = CLI + 4;
  alto(ENC - 1, 9.95);
  alto(ENC, 21.95);
  ["N°", "Producto o detalle", "Unidad", "Cantidad", "Precio unitario", "Total"].forEach((t, k) => {
    const c = ws.getCell(ENC, k + 1);
    c.value = t;
    c.font = f({ bold: true, color: { argb: "FFFFFFFF" } });
    c.fill = relleno(COLOR);
    c.alignment = { horizontal: k === 1 ? "left" : "center", vertical: "middle" };
    c.border = caja;
  });
  const items = cot.items || [];
  const lineas = Math.max(items.length, 10);
  for (let idx = 0; idx < lineas; idx++) {
    const r = ENC + 1 + idx;
    const it = items[idx];
    const valores = it
      ? [idx + 1, it.nombre, it.unidad || "Unidad", Number(it.cantidad), Math.round(Number(it.precio)), { formula: `IF(E${r}="","",E${r}*D${r})`, result: Math.round(Number(it.precio) * Number(it.cantidad)) }]
      : [idx + 1, null, null, null, null, { formula: `IF(E${r}="","",E${r}*D${r})`, result: "" }];
    valores.forEach((v, k) => {
      const c = ws.getCell(r, k + 1);
      c.value = v;
      c.font = f();
      c.border = caja;
      c.alignment = { horizontal: [0, 2, 3].includes(k) ? "center" : k >= 4 ? "right" : "left", vertical: "middle", wrapText: k === 1 };
      if (k >= 4) c.numFmt = '"$" #,##0';
      if (idx % 2 === 1) c.fill = relleno(CLARO);
    });
    ws.getRow(r).height = it ? Math.max(18, Math.ceil(String(it.nombre || "").length / 55) * 14) : 18;
  }
  const ultima = ENC + lineas;

  // --- Condiciones comerciales y totales ---
  const T = ultima + 2;
  alto(T - 1, 8.1);
  ws.getCell(`B${T}`).value = "Condiciones comerciales";
  ws.getCell(`B${T}`).font = f({ bold: true, color: { argb: COLOR } });
  condiciones(fmt, cot).forEach((t, k) => {
    const c = ws.getCell(`B${T + 1 + k}`);
    c.value = t;
    c.font = f({ size: 9, color: { argb: `FF${GRIS}` } });
    c.alignment = { vertical: "top", wrapText: true };
    alto(T + 1 + k, k === 1 ? 26 : 18);
  });
  alto(T, 18);
  [["Precio neto:", { formula: `SUM(F${ENC + 1}:F${ultima})`, result: Math.round(Number(cot.subtotal)) }],
    ["IVA 19%:", { formula: `ROUND(F${T}*0.19,0)`, result: Math.round(Number(cot.iva)) }],
    ["TOTAL:", { formula: `F${T}+F${T + 1}`, result: Math.round(Number(cot.total)) }]].forEach(([e, v], k) => {
    const total = k === 2;
    const ce = ws.getCell(`E${T + k}`); const cf = ws.getCell(`F${T + k}`);
    ce.value = e; cf.value = v;
    for (const c of [ce, cf]) {
      c.font = f({ bold: true, size: total ? 11 : 10, color: { argb: total ? "FFFFFFFF" : "FF000000" } });
      c.alignment = { horizontal: "right", vertical: "middle" };
      c.border = caja;
      if (total) c.fill = relleno(COLOR);
    }
    cf.numFmt = '"$" #,##0';
  });

  // --- Responsable, firma y datos para transferencia ---
  let D; // fila de "Datos para transferencia"
  if (fmt.responsable) {
    const R = T + 6;
    alto(R - 1, 9.95);
    ws.getCell(`B${R}`).value = `Responsable comercial: ${emp.responsable || ""}`;
    ws.getCell(`B${R}`).font = f({ size: 9, bold: true, color: { argb: "FF333333" } });
    ws.getCell(`B${R + 1}`).value = emp.cargo || "";
    ws.getCell(`B${R + 1}`).font = f({ size: 9, color: { argb: `FF${GRIS}` } });
    alto(R, 15.95); alto(R + 1, 15.95); alto(R + 2, 9.95);
    D = R + 3;
    // Firma sobre la línea con el nombre del representante
    ws.mergeCells(`D${D + 1}:F${D + 1}`);
    ws.mergeCells(`D${D + 2}:F${D + 2}`);
    ws.getCell(`D${D + 1}`).value = emp.representante || "";
    ws.getCell(`D${D + 1}`).font = f({ size: 9, bold: true, color: { argb: "FF333333" } });
    ws.getCell(`D${D + 2}`).value = "Representante Legal";
    ws.getCell(`D${D + 2}`).font = f({ size: 9, color: { argb: `FF${GRIS}` } });
    for (const c of ["D", "E", "F"]) ws.getCell(`${c}${D + 1}`).border = { top: { style: "thin", color: { argb: "FF999999" } } };
    for (const r of [D + 1, D + 2]) ws.getCell(`D${r}`).alignment = { horizontal: "center", vertical: "middle" };
    if (fs.existsSync(emp.firma)) {
      const id = wb.addImage({ filename: emp.firma, extension: "png" });
      ws.addImage(id, { tl: ancla(3, 457200, T + 4, 9525), ext: { width: 190, height: 125 } });
    }
  } else {
    alto(T + 5, 15); alto(T + 6, 17.1); alto(T + 7, 6);
    D = T + 8;
    if (fs.existsSync(emp.firma)) {
      const id = wb.addImage({ filename: emp.firma, extension: "png" });
      ws.addImage(id, { tl: ancla(1, 3314700, T + 2, 38100), ext: { width: 330, height: 162 } });
    }
  }
  ws.getCell(`B${D}`).value = "Datos para transferencia";
  ws.getCell(`B${D}`).font = f({ bold: true, color: { argb: COLOR } });
  alto(D, 15.95);
  [[`${emp.nombre}  ·  R.U.T. ${emp.rut}`, false], [`Banco ${emp.banco}  ·  ${emp.tipo_cuenta} N° ${emp.numero_cuenta}`, true]].forEach(([t, b], k) => {
    const c = ws.getCell(`B${D + 1 + k}`);
    c.value = t;
    c.font = f({ size: 9, bold: b, color: { argb: "FF333333" } });
    c.fill = relleno(CLARO);
    c.border = { left: { style: "thick", color: { argb: COLOR } } };
    alto(D + 1 + k, clave === "tactics" ? 18 : 15.95);
  });

  // --- Pie ---
  const P = D + (clave === "tactics" ? 4 : 5);
  if (clave !== "tactics") alto(P - 2, 9.95);
  alto(P - 1, clave === "tactics" ? 24.75 : 15);
  ws.mergeCells(`A${P}:F${P}`);
  ws.getCell(`A${P}`).value = `${emp.nombre}  ·  ${emp.email}  ·  ${emp.fono}`;
  ws.getCell(`A${P}`).font = f({ size: 9, color: { argb: `FF${GRIS}` } });
  ws.getCell(`A${P}`).alignment = { horizontal: "center", vertical: "middle" };
  for (let c = 1; c <= 6; c++) ws.getCell(P, c).border = { top: { style: clave === "tactics" ? "thick" : "thin", color: { argb: LINEA } } };
  ws.pageSetup.printArea = `A1:F${P}`;
  return wb;
}

// ---------------------------------------------------------------- PDF
// Escribe el PDF en `destino` (stream)
function pdfCotizacion(cot, emp, destino) {
  const clave = emp.clave === "tactics" ? "tactics" : "kenott";
  const fmt = FORMATOS[clave];
  const COLOR = `#${fmt.color}`; const CLARO = `#${fmt.claro}`; const LINEA = `#${fmt.linea}`; const BORDE = `#${BORDE_TABLA}`;
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 30, bottom: 30, left: 36, right: 36 }, bufferPages: true,
    info: { Title: `Cotización ${cot.numero}`, Author: emp.nombre } });
  doc.pipe(destino);
  const X = 36;
  const W = doc.page.width - 72;
  const col = [
    { t: "N°", w: W * 0.06, a: "center" },
    { t: "Producto o detalle", w: W * 0.46, a: "left" },
    { t: "Unidad", w: W * 0.1, a: "center" },
    { t: "Cantidad", w: W * 0.1, a: "center" },
    { t: "Precio unitario", w: W * 0.13, a: "right" },
    { t: "Total", w: W * 0.15, a: "right" },
  ];

  const cabecera = () => {
    doc.fillColor(COLOR).font("Helvetica-Bold").fontSize(14).text(emp.nombre, X, 36, { lineBreak: false });
    if (clave === "tactics") doc.moveTo(X, 56).lineTo(X + 270, 56).lineWidth(2).strokeColor(LINEA).stroke();
    doc.fillColor("black").font("Helvetica").fontSize(8.5);
    let y = clave === "tactics" ? 64 : 58;
    lineasEmpresa(clave, emp).forEach((t) => {
      doc.text(t, X, y, { width: 290 });
      y = doc.y + 3;
    });
    if (fs.existsSync(emp.logo)) {
      if (clave === "tactics") doc.image(emp.logo, X + W - 185, 46, { width: 180 });
      else doc.image(emp.logo, X + W - 150, 32, { height: 100 });
    }
    const yl = Math.max(y + 2, clave === "tactics" ? 140 : 136);
    if (clave === "tactics") doc.moveTo(X, yl).lineTo(X + W, yl).lineWidth(2).strokeColor(LINEA).stroke();
    return yl + 8;
  };

  const encabezadoTabla = (y) => {
    let x = X;
    col.forEach((c) => {
      doc.rect(x, y, c.w, 20).fillAndStroke(COLOR, BORDE);
      doc.fillColor("white").font("Helvetica-Bold").fontSize(8.5).text(c.t, x + 4, y + 6, { width: c.w - 8, align: c.a === "right" ? "center" : c.a });
      x += c.w;
    });
    return y + 20;
  };

  let y = cabecera();
  // Título
  const altoTit = clave === "tactics" ? 20 : 24;
  doc.rect(X, y, W, altoTit).fill(COLOR);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(clave === "tactics" ? 12 : 13.5).text(`COTIZACIÓN N° ${cot.numero}`, X, y + (altoTit - 12) / 2 + 1, { width: W, align: "center" });
  y += altoTit + 8;
  // Recuadro del cliente
  doc.rect(X, y, W, 54).fill(CLARO);
  doc.lineWidth(1.2).strokeColor(COLOR).rect(X, y, W, 54).stroke();
  filasCliente(fmt, cot).forEach(([a, d, e], k) => {
    const yy = y + 5 + k * 17;
    doc.fillColor("black").font("Helvetica").fontSize(8.5).text(a, X + 5, yy, { width: W * 0.58, height: 11, ellipsis: true });
    doc.fillColor(COLOR).font("Helvetica-Bold").text(d, X + W * 0.6, yy, { width: W * 0.17, align: "right" });
    doc.fillColor("black").font("Helvetica").text(e, X + W * 0.79, yy, { width: W * 0.2, align: "center" });
  });
  y += 64;
  y = encabezadoTabla(y);

  (cot.items || []).forEach((it, idx) => {
    doc.font("Helvetica").fontSize(8.5);
    const alto = Math.max(17, doc.heightOfString(it.nombre || "", { width: col[1].w - 8 }) + 8);
    if (y + alto > doc.page.height - 60) {
      doc.addPage();
      y = encabezadoTabla(cabecera());
    }
    const valores = [idx + 1, it.nombre, it.unidad || "Unidad", cantidadTxt(it.cantidad), `$ ${pesos(it.precio)}`, `$ ${pesos(Number(it.precio) * Number(it.cantidad))}`];
    let x = X;
    valores.forEach((v, k) => {
      if (idx % 2 === 1) doc.rect(x, y, col[k].w, alto).fill(CLARO);
      doc.lineWidth(0.5).strokeColor(BORDE).rect(x, y, col[k].w, alto).stroke();
      doc.fillColor("black").font("Helvetica").fontSize(8.5).text(String(v ?? ""), x + 4, y + 5, { width: col[k].w - 8, align: col[k].a });
      x += col[k].w;
    });
    y += alto;
  });

  // Condiciones, totales, firma y transferencia (página nueva si no caben)
  if (y > doc.page.height - 300) { doc.addPage(); y = cabecera(); }
  y += 12;
  const tx = X + W - col[4].w - col[5].w;
  [["Precio neto:", cot.subtotal], ["IVA 19%:", cot.iva], ["TOTAL:", cot.total]].forEach(([e, v], k) => {
    const yy = y + k * 19;
    const total = k === 2;
    const h = total ? 22 : 19;
    if (total) doc.rect(tx, yy, col[4].w + col[5].w, h).fill(COLOR);
    doc.lineWidth(0.5).strokeColor(BORDE).rect(tx, yy, col[4].w, h).stroke().rect(tx + col[4].w, yy, col[5].w, h).stroke();
    doc.fillColor(total ? "white" : "black").font("Helvetica-Bold").fontSize(total ? 10 : 8.5)
      .text(e, tx + 4, yy + (total ? 7 : 6), { width: col[4].w - 8, align: "right" })
      .text(`$ ${pesos(v)}`, tx + col[4].w + 4, yy + (total ? 7 : 6), { width: col[5].w - 8, align: "right" });
  });
  doc.fillColor(COLOR).font("Helvetica-Bold").fontSize(9).text("Condiciones comerciales", X + 20, y + 2);
  doc.fillColor(`#${GRIS}`).font("Helvetica").fontSize(7.8);
  let yc = y + 16;
  condiciones(fmt, cot).forEach((t) => {
    doc.text(t, X + 20, yc, { width: 250 });
    yc = doc.y + 4;
  });

  let yt;
  if (fmt.responsable) {
    // Responsable comercial a la izquierda; firma sobre la línea del representante a la derecha
    const yr = yc + 10;
    doc.fillColor("#333333").font("Helvetica-Bold").fontSize(8.5).text(`Responsable comercial: ${emp.responsable || ""}`, X + 20, yr);
    doc.fillColor(`#${GRIS}`).font("Helvetica").text(emp.cargo || "", X + 20, yr + 13);
    yt = yr + 36;
    const fx = X + W * 0.56; const fw = W * 0.4;
    const yLinea = yt + 18;
    if (fs.existsSync(emp.firma)) doc.image(emp.firma, fx + fw / 2 - 60, yLinea - 80, { height: 80 });
    doc.moveTo(fx, yLinea).lineTo(fx + fw, yLinea).lineWidth(0.6).strokeColor("#999999").stroke();
    doc.fillColor("#333333").font("Helvetica-Bold").fontSize(8.5).text(emp.representante || "", fx, yLinea + 4, { width: fw, align: "center" });
    doc.fillColor(`#${GRIS}`).font("Helvetica").text("Representante Legal", fx, yLinea + 16, { width: fw, align: "center" });
  } else {
    if (fs.existsSync(emp.firma)) doc.image(emp.firma, X + W * 0.47, y + 66, { width: 170 });
    yt = Math.max(yc + 18, y + 120);
  }

  doc.fillColor(COLOR).font("Helvetica-Bold").fontSize(9).text("Datos para transferencia", X + 20, yt);
  yt += 14;
  [[`${emp.nombre}  ·  R.U.T. ${emp.rut}`, false], [`Banco ${emp.banco}  ·  ${emp.tipo_cuenta} N° ${emp.numero_cuenta}`, true]].forEach(([t, b], k) => {
    doc.rect(X + 20, yt + k * 15, 245, 15).fill(CLARO);
    doc.rect(X + 20, yt + k * 15, 2.5, 15).fill(COLOR);
    doc.fillColor("#333333").font(b ? "Helvetica-Bold" : "Helvetica").fontSize(7.8).text(t, X + 27, yt + 4 + k * 15, { width: 236 });
  });

  // Pie en todas las páginas
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(i);
    const yp = doc.page.height - 48;
    doc.moveTo(X, yp).lineTo(X + W, yp).lineWidth(clave === "tactics" ? 2 : 0.8).strokeColor(LINEA).stroke();
    doc.fillColor(`#${GRIS}`).font("Helvetica").fontSize(8)
      .text(`${emp.nombre}  ·  ${emp.email}  ·  ${emp.fono}`, X, yp + 6, { width: W, align: "center", lineBreak: false });
    if (paginas.count > 1) doc.text(`Página ${i + 1} de ${paginas.count}`, X, yp + 6, { width: W, align: "right", lineBreak: false });
  }
  doc.end();
}

// Nombre visible y de archivo: Cotizacion_KENOTT_N100  (las de antes del cambio: "Kenott N276 (anterior)")
const idCotizacion = (cot) => `Cotizacion_${String(cot.empresa || "kenott").toUpperCase()}_N${cot.numero}`;

module.exports = { excelCotizacion, pdfCotizacion, idCotizacion, PLAZO_DEFECTO };
