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
  ...(cot.lugar_entrega ? [`• Lugar de entrega: ${String(cot.lugar_entrega).replace(/\.\s*$/, "")}.`] : []),
  fmt.servicio,
  "• Precios válidos hasta la fecha indicada.",
];
// Lo que se imprime en cada línea: la descripción del cliente (con sus especificaciones) si la hay (M20)
const descImpresa = (it) => it.descripcion_cliente || it.nombre;

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
    // Texto largo (descripción del proyecto): se ajusta a la celda en varias líneas en vez de achicarse
    const largo = String(a || "").length;
    if (largo > 70) alto(r, 20.1 * Math.min(4, Math.ceil(largo / 70)));
    ws.getCell(`A${r}`).alignment = { vertical: "middle", wrapText: true };
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
      ? [idx + 1, descImpresa(it), it.unidad || "Unidad", Number(it.cantidad), Math.round(Number(it.precio)), { formula: `IF(E${r}="","",E${r}*D${r})`, result: Math.round(Number(it.precio) * Number(it.cantidad)) }]
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
    ws.getRow(r).height = it ? Math.max(18, Math.ceil(String(descImpresa(it) || "").length / 55) * 14) : 18;
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
  // Recuadro del cliente: cada fila crece si el texto es largo (la descripción no se corta)
  const filas = filasCliente(fmt, cot);
  doc.font("Helvetica").fontSize(8.5);
  const altos = filas.map(([a]) => Math.max(17, doc.heightOfString(a, { width: W * 0.58 }) + 6));
  const altoCli = altos.reduce((s, h) => s + h, 0) + 3;
  doc.rect(X, y, W, altoCli).fill(CLARO);
  doc.lineWidth(1.2).strokeColor(COLOR).rect(X, y, W, altoCli).stroke();
  let yy = y + 5;
  filas.forEach(([a, d, e], k) => {
    doc.fillColor("black").font("Helvetica").fontSize(8.5).text(a, X + 5, yy, { width: W * 0.58 });
    doc.fillColor(COLOR).font("Helvetica-Bold").text(d, X + W * 0.6, yy, { width: W * 0.17, align: "right" });
    doc.fillColor("black").font("Helvetica").text(e, X + W * 0.79, yy, { width: W * 0.2, align: "center" });
    yy += altos[k];
  });
  y += altoCli + 10;
  y = encabezadoTabla(y);

  (cot.items || []).forEach((it, idx) => {
    doc.font("Helvetica").fontSize(8.5);
    const alto = Math.max(17, doc.heightOfString(descImpresa(it) || "", { width: col[1].w - 8 }) + 8);
    if (y + alto > doc.page.height - 60) {
      doc.addPage();
      y = encabezadoTabla(cabecera());
    }
    const valores = [idx + 1, descImpresa(it), it.unidad || "Unidad", cantidadTxt(it.cantidad), `$ ${pesos(it.precio)}`, `$ ${pesos(Number(it.precio) * Number(it.cantidad))}`];
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

// ---------------------------------------------------------------- Hoja interna (M21, no se envía al cliente)
// Por cada línea: lo que pidió el cliente, el caso, el producto nuestro, su compra, convenio, particular, proveedor y nota.
async function excelInterno(cot, params, precioVenta) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Interna (no enviar)", { views: [{ state: "frozen", ySplit: 3 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [
    { header: "N°", width: 5 }, { header: "Lo que pidió el cliente (se imprime)", width: 46 }, { header: "Caso", width: 11 },
    { header: "Producto nuestro", width: 44 }, { header: "Unidad", width: 9 }, { header: "Cant.", width: 8 },
    { header: "Compra", width: 11 }, { header: "Convenio", width: 11 }, { header: "Particular", width: 11 },
    { header: "Proveedor", width: 18 }, { header: "Precio cotizado", width: 13 }, { header: "Total", width: 13 },
    { header: "Margen %", width: 9 }, { header: "Grupo", width: 14 }, { header: "Nota interna", width: 40 },
  ];
  ws.spliceRows(1, 0, [`HOJA INTERNA — ${String(cot.empresa).toUpperCase()} N${cot.numero} · ${cot.cliente || ""} · ID ${cot.id_solicitud || "—"} · NO ENVIAR AL CLIENTE`], []);
  ws.getCell("A1").font = { bold: true, size: 12, color: { argb: "FFC00000" } };
  const enc = ws.getRow(3);
  enc.font = { bold: true, color: { argb: "FFFFFFFF" } };
  enc.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF444444" } }; });
  const COLOR = { similar: "FFFFF2CC", nuevo: "FFF8D7DA" };
  (cot.items || []).forEach((it, k) => {
    const comps = it.componentes || [];
    const costo = Number(it.costo) || 0;
    const costoTot = costo + comps.reduce((s2, c) => s2 + Number(c.costo || 0) * Number(c.por_unidad || 0), 0);
    const precio = Number(it.precio) || 0;
    const row = ws.addRow([
      k + 1, it.descripcion_cliente || it.nombre, { mismo: "Mismo", similar: "Similar", nuevo: "No está" }[it.caso || "mismo"],
      it.producto_id ? `${it.codigo ?? ""} ${it.nombre}`.trim() : "— (no está en catálogo)", it.unidad, Number(it.cantidad),
      costo || null, costo ? precioVenta(costo, "convenio", params) : null, costo ? precioVenta(costo, "particular", params) : null,
      it.proveedor || "", precio, Math.round(precio * Number(it.cantidad)),
      precio && costoTot ? Math.round(((precio - costoTot) / precio) * 1000) / 10 : null, it.grupo || "", [it.nota_interna, comps.length ? "margen con componentes" : ""].filter(Boolean).join(" · "),
    ]);
    [7, 8, 9, 11, 12].forEach((c) => { row.getCell(c).numFmt = '"$" #,##0'; });
    row.alignment = { vertical: "top", wrapText: true };
    if (COLOR[it.caso]) row.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR[it.caso] } }; });
    // Componentes (no se imprimen al cliente): una fila debajo con su costo
    for (const c of comps) {
      const r = ws.addRow(["", `   ↳ componente: ${c.nombre}`, "Componente", `${c.codigo ?? ""} ${c.nombre}`.trim(), c.unidad, Math.round(Number(c.por_unidad) * Number(it.cantidad) * 1000) / 1000,
        Number(c.costo) || null, null, null, c.proveedor || "", null, null, null, "", `${c.por_unidad} por ${it.unidad || "unidad"} · costo incluido en la línea`]);
      r.getCell(7).numFmt = '"$" #,##0'; r.font = { italic: true, color: { argb: "FF555555" } };
    }
  });
  const tot = ws.addRow(["", "TOTAL NETO", "", "", "", "", Math.round(Number(cot.costo_total) || 0), "", "", "", "", Math.round(Number(cot.subtotal) || 0),
    Number(cot.subtotal) ? Math.round(((Number(cot.subtotal) - Number(cot.costo_total || 0)) / Number(cot.subtotal)) * 1000) / 10 : null]);
  tot.font = { bold: true };
  [7, 12].forEach((c) => { tot.getCell(c).numFmt = '"$" #,##0'; });
  return wb;
}

// Hoja interna simple: lo cotizado, el caso, venta, compra, los 3 mejores proveedores y la utilidad.
// opciones: Map(producto_id -> [{ proveedor, precio }]) ordenado del más barato al más caro
const GENERICOS = ["SISTEMA", "SIN PROVEEDOR", "SIN IDENTIFICAR"];
const CASO_SIMPLE = { mismo: "Exacto", similar: "Similar", nuevo: "Sin catálogo" };
// Filas de la hoja interna simple (se usan en el Excel de la cotización y en la impresión desde la venta)
// opciones: arreglo por línea [{ opciones, parecido }] (opcionesInterna)
function filasInternaSimple(items, opciones) {
  let tv = 0; let tc = 0; let sinCosto = 0;
  const filas = (items || []).map((it, k) => {
    // Con componentes (cotización), el costo de la línea los incluye
    const comps = it.componentes || [];
    const costo = Math.round((Number(it.costo) || 0) + comps.reduce((s2, c) => s2 + Number(c.costo || 0) * Number(c.por_unidad || 0), 0));
    const precio = Math.round(Number(it.precio) || 0);
    const cant = Number(it.cantidad) || 0;
    const caso = it.caso || (it.producto_id ? "mismo" : "nuevo");
    const esComp = !!it.complemento_de; // componente en la venta: sin precio, su costo es de la línea principal
    // Proveedores reales del catálogo hoy (incluye las cotizaciones subidas después de cotizar); sin los genéricos de la planilla
    const usado = String(it.proveedor || "").toUpperCase();
    const op = opciones[k] || { opciones: [] };
    const proveedores = op.opciones.filter((o) => !GENERICOS.includes(String(o.proveedor).toUpperCase())).slice(0, 3)
      .map((o) => ({ proveedor: o.proveedor, precio: o.precio, usado: !!usado && String(o.proveedor).toUpperCase() === usado }));
    const venta = Math.round(precio * cant); const compra = Math.round(costo * cant);
    tv += venta; if (costo) tc += compra; else sinCosto += 1;
    return {
      n: k + 1, producto: esComp ? `↳ ${it.descripcion_cliente || it.nombre} (complemento de: ${it.complemento_de})` : `${it.descripcion_cliente || it.nombre}${comps.length ? ` (+ ${comps.map((c) => `${c.nombre} ×${c.por_unidad}`).join(", ")})` : ""}`,
      parecido: op.parecido, caso, caso_txt: esComp ? "Complemento" : CASO_SIMPLE[caso] || "", precio, costo: costo || null,
      proveedores, unidad: it.unidad || "", cantidad: cant, total_venta: venta, total_compra: costo ? compra : null,
      utilidad: costo && !esComp ? venta - compra : null, margen: precio && costo ? Math.round(((precio - costo) / precio) * 1000) / 10 : null,
    };
  });
  return { filas, totales: { venta: tv, compra: tc, utilidad: tv - tc, margen: tv ? Math.round(((tv - tc) / tv) * 1000) / 10 : null, sin_costo: sinCosto } };
}
async function excelInternoSimple(cot, opciones) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Interna simple", { views: [{ state: "frozen", ySplit: 3, xSplit: 2 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const cols = [
    ["N°", 5], ["Producto cotizado", 46], ["Caso", 11], ["Precio venta", 13], ["Precio compra", 13],
    ["Proveedor 1 (mejor)", 17], ["Precio 1", 11], ["Proveedor 2", 17], ["Precio 2", 11], ["Proveedor 3", 17], ["Precio 3", 11],
    ["Unidad", 9], ["Cant.", 8], ["Total venta", 13], ["Total compra", 13], ["Utilidad", 13], ["Margen %", 9],
  ];
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  ws.spliceRows(1, 0, [`HOJA INTERNA SIMPLE — ${String(cot.empresa).toUpperCase()} N${cot.numero} · ${cot.cliente || ""} · ID ${cot.id_solicitud || "—"} · NO ENVIAR AL CLIENTE`], []);
  ws.getCell("A1").font = { bold: true, size: 12, color: { argb: "FFC00000" } };
  const enc = ws.getRow(3);
  enc.font = { bold: true, color: { argb: "FFFFFFFF" } };
  enc.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  enc.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF444444" } }; });
  const COLOR = { similar: "FFFFF2CC", nuevo: "FFF8D7DA" };
  const PESOS = '"$" #,##0';
  const { filas, totales } = filasInternaSimple(cot.items, opciones);
  const tv = totales.venta; const tc = totales.compra; const sinCosto = totales.sin_costo;
  filas.forEach((f) => {
    const prov = []; for (let n = 0; n < 3; n++) prov.push(f.proveedores[n]?.proveedor || "", f.proveedores[n]?.precio ?? null);
    const row = ws.addRow([f.n, f.parecido ? `${f.producto}\n≈ precios de ${f.parecido}` : f.producto, f.caso_txt, f.precio, f.costo, ...prov, f.unidad, f.cantidad, f.total_venta, f.total_compra, f.utilidad, f.margen]);
    [4, 5, 7, 9, 11, 14, 15, 16].forEach((c) => { row.getCell(c).numFmt = PESOS; });
    row.alignment = { vertical: "top", wrapText: true };
    [1, 3, 12, 13, 17].forEach((c) => { row.getCell(c).alignment = { vertical: "top", horizontal: "center" }; });
    if (COLOR[f.caso]) [1, 2, 3].forEach((c) => { row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR[f.caso] } }; });
    // El proveedor con que se cotizó, en negrita
    f.proveedores.forEach((o, n) => { if (o.usado) { row.getCell(6 + n * 2).font = { bold: true }; row.getCell(7 + n * 2).font = { bold: true }; } });
    // Pérdida (compra más cara que la venta): se marca en utilidad y margen, sin tocar descripción, cantidad ni unidad
    if (f.margen != null && f.margen < 0) {
      [16, 17].forEach((c) => { row.getCell(c).font = { bold: true, color: { argb: "FFC00000" } }; row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8D7DA" } }; });
      row.getCell(16).note = "Pérdida: el precio de compra es mayor que el de venta";
    }
  });
  ws.addRow([]);
  const fila = (t, v, fmt) => { const r = ws.addRow(["", t, "", v]); r.font = { bold: true }; if (fmt) r.getCell(4).numFmt = fmt; return r; };
  fila("TOTAL VENTA NETO", tv, PESOS);
  fila("TOTAL COMPRA NETO", tc, PESOS);
  fila("UTILIDAD", tv - tc, PESOS);
  fila("MARGEN %", tv ? Math.round(((tv - tc) / tv) * 1000) / 10 : null);
  if (sinCosto) { const r = ws.addRow(["", `Ojo: ${sinCosto} línea(s) sin precio de compra; no suman a la compra ni a la utilidad.`]); r.font = { italic: true, color: { argb: "FFC00000" } }; }
  const r = ws.addRow(["", "Caso: Exacto = mismo producto · Similar = equivalente nuestro · Sin catálogo = precio a mano. En negrita, el proveedor con que se cotizó. ≈ = el producto no tiene precios; se muestran los de un producto parecido del catálogo."]);
  r.font = { italic: true, size: 9 };
  return wb;
}

// Nombre visible y de archivo: Cotizacion_KENOTT_N100  (las de antes del cambio: "Kenott N276 (anterior)")
const idCotizacion = (cot) => `Cotizacion_${String(cot.empresa || "kenott").toUpperCase()}_N${cot.numero}`;

// Solicitud de cotización a proveedores: solo materiales, unidad y cantidad (sin precios, sin proveedor, sin ID).
// grupos: [{ emp, proyectos: [nombre], lineas: [{ nombre, unidad, cantidad, obs }] }] -> una sección por empresa (página aparte)
function pdfSolicitud(grupos, destino) {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 30, bottom: 30, left: 36, right: 36 }, bufferPages: true, info: { Title: "Solicitud de cotización" } });
  doc.pipe(destino);
  const X = 36;
  const W = doc.page.width - 72;
  grupos.forEach((g, gi) => {
    if (gi > 0) doc.addPage();
    const emp = g.emp;
    const clave = emp.clave === "tactics" ? "tactics" : "kenott";
    const fmt = FORMATOS[clave];
    const COLOR = `#${fmt.color}`; const CLARO = `#${fmt.claro}`; const LINEA = `#${fmt.linea}`; const BORDE = `#${BORDE_TABLA}`;
    const conObs = false; // la formal va al proveedor: la observación interna solo sale en la versión sencilla
    const col = [{ t: "N°", w: W * 0.07, a: "center" }, { t: "Material", w: W * 0.65, a: "left" }, { t: "Unidad", w: W * 0.14, a: "center" }, { t: "Cantidad", w: W * 0.14, a: "center" }];
    const cabecera = () => {
      doc.fillColor(COLOR).font("Helvetica-Bold").fontSize(14).text(emp.nombre, X, 36, { lineBreak: false });
      if (clave === "tactics") doc.moveTo(X, 56).lineTo(X + 270, 56).lineWidth(2).strokeColor(LINEA).stroke();
      doc.fillColor("black").font("Helvetica").fontSize(8.5);
      let y = clave === "tactics" ? 64 : 58;
      lineasEmpresa(clave, emp).forEach((t) => { doc.text(t, X, y, { width: 290 }); y = doc.y + 3; });
      if (emp.logo && fs.existsSync(emp.logo)) {
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
        doc.fillColor("white").font("Helvetica-Bold").fontSize(8.5).text(c.t, x + 4, y + 6, { width: c.w - 8, align: c.a });
        x += c.w;
      });
      return y + 20;
    };
    let y = cabecera();
    const altoTit = clave === "tactics" ? 20 : 24;
    doc.rect(X, y, W, altoTit).fill(COLOR);
    doc.fillColor("white").font("Helvetica-Bold").fontSize(clave === "tactics" ? 12 : 13.5).text("SOLICITUD DE COTIZACIÓN", X, y + (altoTit - 12) / 2 + 1, { width: W, align: "center" });
    y += altoTit + 8;
    const proy = `${g.proyectos.length > 1 ? "Proyectos" : "Proyecto"}: ${g.proyectos.join(" · ") || "—"}`;
    doc.font("Helvetica").fontSize(9);
    const altoP = Math.max(34, doc.heightOfString(proy, { width: W - 150 }) + 14);
    doc.rect(X, y, W, altoP).fill(CLARO);
    doc.lineWidth(1.2).strokeColor(COLOR).rect(X, y, W, altoP).stroke();
    doc.fillColor("black").font("Helvetica-Bold").fontSize(9).text(proy, X + 6, y + 7, { width: W - 150 });
    doc.font("Helvetica").text(`Fecha: ${new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago" })}`, X + W - 140, y + 7, { width: 134, align: "right" });
    y += altoP + 10;
    y = encabezadoTabla(y);
    g.lineas.forEach((l, k) => {
      const vals = [String(k + 1), l.nombre || "", l.unidad || "", String(l.cantidad), ...(conObs ? [l.obs || ""] : [])];
      doc.font("Helvetica").fontSize(8.5);
      const alto = Math.max(17, ...vals.map((v, i) => doc.heightOfString(v, { width: col[i].w - 8 }) + 8));
      if (y + alto > doc.page.height - 50) { doc.addPage(); y = encabezadoTabla(cabecera()); }
      let x = X;
      vals.forEach((v, i) => {
        doc.lineWidth(0.6).strokeColor(BORDE).rect(x, y, col[i].w, alto).stroke();
        doc.fillColor(i === 4 ? "#555555" : "black").font("Helvetica").fontSize(i === 4 ? 7.5 : 8.5).text(v, x + 4, y + 4, { width: col[i].w - 8, align: col[i].a });
        x += col[i].w;
      });
      y += alto;
    });
  });
  doc.end();
}

// Lista de materiales sencilla, en blanco y negro (como la hoja impresa del cuadro de compra):
// { titulo, sub, proyectos, secciones: [{ titulo, lineas: [{ nombre, unidad, cantidad, obs }] }] }
function pdfMaterialesSimple({ titulo, sub, proyectos, secciones, facturacion = [], conOrden = [] }, destino) {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 30, bottom: 30, left: 30, right: 30 }, info: { Title: titulo } });
  doc.pipe(destino);
  const X = 30;
  const W = doc.page.width - 60;
  let y = 40;
  // Datos de facturación: recuadro en la mitad derecha, alineado a la izquierda, con etiquetas
  const anchoF = W / 2 - 6;
  const xf = X + W - anchoF;
  let yf = 38;
  facturacion.forEach((f) => {
    const y0 = yf;
    yf += 6;
    f.forEach((t, k) => {
      const m = /^(RUT|Giro):?\s*(.*)$/i.exec(t);
      if (k === 0) { doc.fillColor("black").font("Helvetica-Bold").fontSize(9.5).text(t, xf + 8, yf, { width: anchoF - 16 }); }
      else if (m) {
        doc.fillColor("black").font("Helvetica-Bold").fontSize(8).text(`${m[1].toUpperCase()}: `, xf + 8, yf, { width: anchoF - 16, continued: true })
          .font("Helvetica").fillColor("#333").text(m[2]);
      } else { doc.fillColor("#333").font("Helvetica").fontSize(8).text(t, xf + 8, yf, { width: anchoF - 16 }); }
      yf = doc.y + 1.5;
    });
    yf += 5;
    doc.lineWidth(0.6).strokeColor("#999").rect(xf, y0, anchoF, yf - y0).stroke();
    yf += 6;
  });
  const anchoT = facturacion.length ? W - anchoF - 14 : W;
  doc.fillColor("black").font("Helvetica-Bold").fontSize(14).text(titulo, X, y, { width: anchoT });
  y = doc.y + 2;
  doc.font("Helvetica").fontSize(9).fillColor("#444").text(sub, X, y, { width: anchoT }); y = doc.y + 2;
  doc.text(`${proyectos.length > 1 ? "Proyectos" : "Proyecto"}: ${proyectos.join(" · ")}`, X, y, { width: anchoT }); y = Math.max(doc.y, yf) + 10;
  const fin = () => doc.page.height - 50;
  for (const sec of secciones) {
    // Siempre con la columna de observación interna (versión interna). Si viene vacía (una sola venta) es angosta,
    // para anotar a mano, y el material aprovecha el ancho de la hoja; si trae detalle, se mantiene ancha.
    const conObs = true;
    const obsLlena = sec.lineas.some((l) => l.obs);
    const anchoObs = obsLlena ? W * 0.27 : 95;
    const col = [{ t: "N°", w: 22, a: "right" }, { t: "", w: 16 }, { t: "MATERIAL", w: 0 }, { t: "UNIDAD", w: 58, a: "center" }, { t: "CANT.", w: 42, a: "right" },
      { t: obsLlena ? "OBSERVACIÓN INTERNA" : "OBSERVACIÓN", w: anchoObs, a: "center", celda: obsLlena ? "left" : "center", pad: 10 }];
    col[2].w = W - col.reduce((s2, c) => s2 + c.w, 0);
    const cabecera = () => {
      if (y + 50 > fin()) { doc.addPage(); y = 40; }
      doc.rect(X, y, 3, 16).fill("#333");
      doc.rect(X + 3, y, W - 3, 16).fill("#ececec");
      doc.fillColor("black").font("Helvetica-Bold").fontSize(9.5).text(sec.titulo, X + 8, y + 4, { width: W - 120 });
      doc.font("Helvetica").fontSize(8.5).text(`${sec.lineas.length} producto(s)`, X + W - 110, y + 4, { width: 104, align: "right" });
      y += 20;
      let x = X;
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#222");
      col.forEach((c) => { const pd = c.pad || 2; doc.text(c.t, x + pd, y, { width: c.w - pd - 2, align: c.a || "left" }); x += c.w; });
      y += 11;
      doc.moveTo(X, y).lineTo(X + W, y).lineWidth(1).strokeColor("#333").stroke();
      y += 3;
    };
    cabecera();
    sec.lineas.forEach((l, k) => {
      const vals = [String(k + 1), "☐", l.nombre || "", l.unidad || "", String(l.cantidad), ...(conObs ? [l.obs || ""] : [])];
      doc.font("Helvetica").fontSize(9);
      const alto = Math.max(14, ...vals.map((v, i) => doc.heightOfString(v, { width: col[i].w - (col[i].pad || 2) - 2 }) + 5));
      if (y + alto > fin()) { doc.addPage(); y = 40; cabecera(); }
      let x = X;
      vals.forEach((v, i) => {
        if (i === 1) doc.rect(x + 5, y + 2, 7, 7).lineWidth(0.7).strokeColor("#333").stroke();
        else { const pd = col[i].pad || 2; doc.fillColor(i === 5 ? "#555" : "black").font("Helvetica").fontSize(i === 5 ? 7.5 : 9).text(v, x + pd, y + 2, { width: col[i].w - pd - 2, align: col[i].celda || col[i].a || "left" }); }
        x += col[i].w;
      });
      y += alto;
      doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.4).strokeColor("#bbb").stroke();
      y += 2;
    });
    y += 12;
  }
  if (!secciones.length) { doc.fillColor("black").font("Helvetica").fontSize(9.5).text("Todos los productos marcados ya tienen orden de compra.", X, y, { width: W }); y = doc.y + 10; }
  // Lo que ya tiene orden: solo la referencia de la orden (sin detallar materiales)
  if (conOrden.length) {
    if (y + 30 + conOrden.length * 13 > doc.page.height - 50) { doc.addPage(); y = 40; }
    doc.fillColor("black").font("Helvetica-Bold").fontSize(9).text("Ya tienen orden de compra (no se cotizan):", X, y, { width: W }); y = doc.y + 3;
    doc.font("Helvetica").fontSize(8.5).fillColor("#333");
    conOrden.forEach((o) => { doc.text(`• ${o.titulo} · ${o.productos} producto(s)`, X + 8, y, { width: W - 8 }); y = doc.y + 2; });
  }
  doc.end();
}

module.exports = { excelCotizacion, pdfCotizacion, excelInterno, excelInternoSimple, filasInternaSimple, idCotizacion, pdfSolicitud, pdfMaterialesSimple, PLAZO_DEFECTO };
