// Cotización en PDF con el formato Kenott (mismo diseño que plantilla_cotizacion.xlsx).
// Los datos de la empresa salen de parametros (editables en Configuración).
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { datosEmpresa } = require("./empresas");

const VERDE = "#1A4731";
const VERDE_CLARO = "#D6EFE1";
const VERDE_FILA = "#F1F8F4";
const GRIS = "#555555";
const LOGO = path.join(__dirname, "../../plantillas/logo_kenott.png");
const FIRMA = path.join(__dirname, "../../plantillas/firma.png");

const pesos = (n) => Math.round(Number(n) || 0).toLocaleString("es-CL");
const fechaCL = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-") : "");
const cantidad = (n) => { const v = Number(n); return Number.isInteger(v) ? String(v) : v.toLocaleString("es-CL"); };

// Escribe el PDF en `destino` (stream). empresa: parámetros. Tactics tiene su propio formato.
function generarPdfCotizacion(cot, empresa, destino) {
  if (cot.empresa === "tactics") return pdfTactics(cot, datosEmpresa("tactics", empresa), destino);
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 30, bottom: 30, left: 30, right: 30 }, bufferPages: true,
    info: { Title: `Cotización ${cot.numero}`, Author: empresa.empresa_nombre } });
  doc.pipe(destino);
  const X = 30;
  const W = doc.page.width - 60; // ancho útil
  // Columnas: producto | unidad | cant | p. unitario | total
  const col = [
    { t: "PRODUCTO / DETALLE", w: W * 0.47, a: "left" },
    { t: "UNIDAD", w: W * 0.12, a: "center" },
    { t: "CANT.", w: W * 0.09, a: "center" },
    { t: "P. UNITARIO", w: W * 0.15, a: "right" },
    { t: "TOTAL", w: W * 0.17, a: "right" },
  ];

  const cabecera = () => {
    // Banda verde con logo, datos de la empresa y número
    doc.rect(X, 30, W, 92).fill(VERDE);
    if (fs.existsSync(LOGO)) doc.image(LOGO, X + 8, 34, { height: 84 });
    doc.fillColor("white").font("Helvetica-Bold").fontSize(14).text(empresa.empresa_nombre, X + 110, 40);
    doc.font("Helvetica").fontSize(8.5)
      .text(`R.U.T: ${empresa.empresa_rut}`, X + 110, 60)
      .text(empresa.empresa_giro, X + 110, 72)
      .text(`Contacto: ${empresa.empresa_contacto}  |  Fono: ${empresa.empresa_fono}`, X + 110, 84)
      .text(empresa.empresa_email, X + 110, 96);
    doc.font("Helvetica-Bold").fontSize(16).text("COTIZACIÓN", X + W - 160, 48, { width: 150, align: "center" });
    doc.fontSize(13).text(`N° ${cot.numero}`, X + W - 160, 80, { width: 150, align: "center" });
  };

  const datosCliente = (y) => {
    const fila = (yy, etiqueta, valor, etiqueta2, valor2) => {
      doc.rect(X, yy, W, 18).fill("white").strokeColor(VERDE).lineWidth(0.6).rect(X, yy, W, 18).stroke();
      doc.rect(X, yy, 80, 18).fill(VERDE_CLARO);
      doc.rect(X + W - 160, yy, 60, 18).fill(VERDE_CLARO);
      doc.fillColor(VERDE).font("Helvetica-Bold").fontSize(8.5).text(etiqueta, X + 5, yy + 5);
      doc.text(etiqueta2, X + W - 155, yy + 5);
      doc.fillColor("black").font("Helvetica").fontSize(8.5)
        .text(valor || "", X + 85, yy + 5, { width: W - 255, height: 10, ellipsis: true })
        .text(valor2 || "", X + W - 95, yy + 5, { width: 90, align: "center" });
    };
    fila(y, "CLIENTE:", cot.cliente || "", "FECHA:", fechaCL(cot.fecha));
    fila(y + 18, "DESCRIPCIÓN:", cot.nombre_cotizacion || "", "VÁLIDO:", fechaCL(cot.fecha_validez));
    return y + 36 + 8;
  };

  const encabezadoTabla = (y) => {
    doc.rect(X, y, W, 18).fill(VERDE);
    let x = X;
    doc.fillColor("white").font("Helvetica-Bold").fontSize(8);
    col.forEach((c) => { doc.text(c.t, x + 4, y + 5, { width: c.w - 8, align: "center" }); x += c.w; });
    return y + 18;
  };

  cabecera();
  let y = datosCliente(130);
  y = encabezadoTabla(y);

  const items = cot.items || [];
  const LIMITE = doc.page.height - 30 - 200; // espacio reservado para totales y pie en la última página
  items.forEach((it, idx) => {
    doc.font("Helvetica").fontSize(8);
    const alto = Math.max(16, doc.heightOfString(it.nombre || "", { width: col[0].w - 8 }) + 7);
    if (y + alto > doc.page.height - 50) {
      doc.addPage();
      cabecera();
      y = encabezadoTabla(130);
    }
    if (idx % 2 === 1) doc.rect(X, y, W, alto).fill(VERDE_FILA);
    doc.strokeColor("#B7D9C4").lineWidth(0.4).moveTo(X, y + alto).lineTo(X + W, y + alto).stroke();
    const valores = [it.nombre, it.unidad || "UNID", cantidad(it.cantidad), pesos(it.precio), pesos(Number(it.precio) * Number(it.cantidad))];
    let x = X;
    valores.forEach((v, k) => {
      doc.fillColor("black").font(k === 2 ? "Helvetica-Bold" : "Helvetica").fontSize(8)
        .text(String(v ?? ""), x + 4, y + 4, { width: col[k].w - 8, align: col[k].a });
      x += col[k].w;
    });
    y += alto;
  });
  doc.strokeColor(VERDE).lineWidth(0.8).moveTo(X, y).lineTo(X + W, y).stroke();

  // Totales y pie (página nueva si no caben)
  if (y > LIMITE) { doc.addPage(); cabecera(); y = 130; }
  y += 10;
  const tx = X + W - 200;
  [["NETO:", cot.subtotal, false], ["IVA (19%):", cot.iva, false], ["TOTAL:", cot.total, true]].forEach(([e, v, total], k) => {
    const yy = y + k * 18;
    doc.rect(tx, yy, 90, 18).fill(total ? VERDE : VERDE_CLARO);
    doc.rect(tx + 90, yy, 110, 18).fill(total ? VERDE : "white").strokeColor(VERDE).lineWidth(0.5).rect(tx, yy, 200, 18).stroke();
    doc.fillColor(total ? "white" : VERDE).font("Helvetica-Bold").fontSize(9).text(e, tx + 6, yy + 5, { width: 80, align: "right" });
    doc.fillColor(total ? "white" : "black").font(total ? "Helvetica-Bold" : "Helvetica").text(`$ ${pesos(v)}`, tx + 95, yy + 5, { width: 100, align: "right" });
  });
  doc.fillColor(GRIS).font("Helvetica").fontSize(8.5)
    .text(empresa.texto_agradecimiento, X, y + 2, { width: W - 220 });
  y += 66;

  // Responsable comercial
  doc.fillColor(VERDE).font("Helvetica-Bold").fontSize(8.5).text("Responsable Comercial:", X, y);
  doc.fillColor("black").font("Helvetica").text(empresa.responsable_nombre, X + 115, y);
  doc.fillColor(VERDE).font("Helvetica-Bold").text("Cargo:", X, y + 13);
  doc.fillColor("black").font("Helvetica").text(empresa.responsable_cargo, X + 115, y + 13);

  // Datos de transferencia + firma
  y += 36;
  doc.fillColor(VERDE).font("Helvetica-Bold").fontSize(8.5).text("DATOS PARA TRANSFERENCIA", X, y);
  doc.fillColor("black").font("Helvetica").fontSize(8.5);
  [empresa.empresa_nombre, `RUT: ${empresa.empresa_rut}`, `Banco: ${empresa.banco}`, empresa.tipo_cuenta, `N° Cuenta: ${empresa.numero_cuenta}`]
    .forEach((t, k) => doc.text(t, X, y + 13 + k * 12));
  if (fs.existsSync(FIRMA)) doc.image(FIRMA, X + 290, y - 22, { height: 78 });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(VERDE)
    .text(empresa.representante_nombre, X + 280, y + 52, { width: 160, align: "center" })
    .text("Representante Legal", X + 280, y + 64, { width: 160, align: "center" });

  // Pie en todas las páginas
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(i);
    const yp = doc.page.height - 50;
    doc.rect(X, yp, W, 6).fill(VERDE);
    doc.fillColor(GRIS).font("Helvetica").fontSize(8)
      .text(`${empresa.empresa_nombre} | RUT ${empresa.empresa_rut} | ${empresa.empresa_email} | ${empresa.empresa_fono}`, X, yp + 10, { width: W, align: "center", lineBreak: false });
    if (paginas.count > 1) doc.text(`Página ${i + 1} de ${paginas.count}`, X, yp + 10, { width: W, align: "right", lineBreak: false });
  }
  doc.end();
}

// --- Formato Tactics Inversiones (mismo diseño que Cotizacion_TACTICS_N592.xlsx) ---
const TEAL = "#2A8C8C";
const TEAL_CLARO = "#EAF6F6";
const ROJO = "#D6102A";
const BORDE = "#C4CCD2";

function pdfTactics(cot, emp, destino) {
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
    doc.fillColor(TEAL).font("Helvetica-Bold").fontSize(14).text(emp.nombre, X, 36);
    doc.moveTo(X, 56).lineTo(X + 270, 56).lineWidth(2).strokeColor(ROJO).stroke();
    doc.fillColor("black").font("Helvetica").fontSize(8.5);
    let y = 64;
    [`R.U.T.: ${emp.rut}`, `Giro: ${emp.giro}`, `Dirección: ${emp.direccion}`, `Contacto: ${emp.contacto}`, `Correo: ${emp.email}`, `Fono: ${emp.fono}`].forEach((t) => {
      doc.text(t, X, y, { width: 290 });
      y = doc.y + 3;
    });
    if (fs.existsSync(emp.logo)) doc.image(emp.logo, X + W - 185, 46, { width: 180 });
    const yl = Math.max(y + 2, 140);
    doc.moveTo(X, yl).lineTo(X + W, yl).lineWidth(2).strokeColor(ROJO).stroke();
    return yl + 8;
  };

  const encabezadoTabla = (y) => {
    let x = X;
    col.forEach((c) => {
      doc.rect(x, y, c.w, 20).fillAndStroke(TEAL, BORDE);
      doc.fillColor("white").font("Helvetica-Bold").fontSize(8.5).text(c.t, x + 4, y + 6, { width: c.w - 8, align: c.a === "right" ? "center" : c.a });
      x += c.w;
    });
    return y + 20;
  };

  let y = cabecera();
  // Título
  doc.rect(X, y, W, 20).fill(TEAL);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(12).text(`COTIZACIÓN N° ${cot.numero}`, X, y + 5, { width: W, align: "center" });
  y += 28;
  // Cliente / proyecto / entrega
  doc.rect(X, y, W, 54).fill(TEAL_CLARO);
  doc.lineWidth(1.2).strokeColor(TEAL).rect(X, y, W, 54).stroke();
  const filas = [[`Cliente: ${cot.cliente || "________________________"}`, "Fecha:", fechaCL(cot.fecha)],
    [`Proyecto: ${cot.nombre_cotizacion || ""}`, "Válida hasta:", fechaCL(cot.fecha_validez)],
    [`Entrega: ${emp.entrega || ""}`, "", ""]];
  filas.forEach(([a, d, e], k) => {
    const yy = y + 5 + k * 17;
    doc.fillColor("black").font("Helvetica").fontSize(8.5).text(a, X + 5, yy, { width: W * 0.58, height: 11, ellipsis: true });
    doc.fillColor(TEAL).font("Helvetica-Bold").text(d, X + W * 0.6, yy, { width: W * 0.17, align: "right" });
    doc.fillColor("black").font("Helvetica").text(e, X + W * 0.79, yy, { width: W * 0.2, align: "center" });
  });
  y += 64;
  y = encabezadoTabla(y);

  const items = cot.items || [];
  items.forEach((it, idx) => {
    doc.font("Helvetica").fontSize(8.5);
    const alto = Math.max(17, doc.heightOfString(it.nombre || "", { width: col[1].w - 8 }) + 8);
    if (y + alto > doc.page.height - 60) {
      doc.addPage();
      y = encabezadoTabla(cabecera());
    }
    const valores = [idx + 1, it.nombre, it.unidad || "Unidad", cantidad(it.cantidad), `$ ${pesos(it.precio)}`, `$ ${pesos(Number(it.precio) * Number(it.cantidad))}`];
    let x = X;
    valores.forEach((v, k) => {
      if (idx % 2 === 1) doc.rect(x, y, col[k].w, alto).fill(TEAL_CLARO);
      doc.lineWidth(0.5).strokeColor(BORDE).rect(x, y, col[k].w, alto).stroke();
      doc.fillColor("black").font("Helvetica").fontSize(8.5).text(String(v ?? ""), x + 4, y + 5, { width: col[k].w - 8, align: col[k].a });
      x += col[k].w;
    });
    y += alto;
  });

  // Condiciones, totales, firma y transferencia (página nueva si no caben)
  if (y > doc.page.height - 290) { doc.addPage(); y = cabecera(); }
  y += 12;
  const tx = X + W - col[4].w - col[5].w;
  [["Precio neto:", cot.subtotal], ["IVA 19%:", cot.iva], ["TOTAL:", cot.total]].forEach(([e, v], k) => {
    const yy = y + k * 19;
    const total = k === 2;
    const h = total ? 22 : 19;
    if (total) doc.rect(tx, yy, col[4].w + col[5].w, h).fill(TEAL);
    doc.lineWidth(0.5).strokeColor(BORDE).rect(tx, yy, col[4].w, h).stroke().rect(tx + col[4].w, yy, col[5].w, h).stroke();
    doc.fillColor(total ? "white" : "black").font("Helvetica-Bold").fontSize(total ? 10 : 8.5)
      .text(e, tx + 4, yy + (total ? 7 : 6), { width: col[4].w - 8, align: "right" })
      .text(`$ ${pesos(v)}`, tx + col[4].w + 4, yy + (total ? 7 : 6), { width: col[5].w - 8, align: "right" });
  });
  doc.fillColor(TEAL).font("Helvetica-Bold").fontSize(9).text("Condiciones comerciales", X + 20, y + 2);
  doc.fillColor("#595959").font("Helvetica").fontSize(7.8);
  let yc = y + 16;
  ["• Valores en pesos chilenos. Precio neto + IVA 19%.",
    `• Plazo de entrega: ${emp.entrega || "a convenir"} una vez aceptada la propuesta y emitida la orden de compra.`,
    `• Garantía: ${emp.garantia || "según fabricante"}.`,
    `• Modalidad de servicio: ${emp.modalidad || "suministro de materiales"}.`,
    "• Precios válidos hasta la fecha indicada."].forEach((t) => {
    doc.text(t, X + 20, yc, { width: 250 });
    yc = doc.y + 4;
  });
  if (fs.existsSync(emp.firma)) doc.image(emp.firma, X + W * 0.47, y + 66, { width: 170 });

  // Datos para transferencia
  let yt = Math.max(yc + 18, y + 120);
  doc.fillColor(TEAL).font("Helvetica-Bold").fontSize(9).text("Datos para transferencia", X + 20, yt);
  yt += 14;
  [[`${emp.nombre}  ·  R.U.T. ${emp.rut}`, false], [`Banco ${emp.banco}  ·  ${emp.tipo_cuenta} N° ${emp.numero_cuenta}`, true]].forEach(([t, b], k) => {
    doc.rect(X + 20, yt + k * 15, 245, 15).fill(TEAL_CLARO);
    doc.rect(X + 20, yt + k * 15, 2.5, 15).fill(TEAL);
    doc.fillColor("#333333").font(b ? "Helvetica-Bold" : "Helvetica").fontSize(7.8).text(t, X + 27, yt + 4 + k * 15, { width: 236 });
  });

  // Pie en todas las páginas
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(i);
    const yp = doc.page.height - 48;
    doc.moveTo(X, yp).lineTo(X + W, yp).lineWidth(2).strokeColor(ROJO).stroke();
    doc.fillColor("#595959").font("Helvetica").fontSize(8)
      .text(`${emp.nombre}  ·  ${emp.email}  ·  ${emp.fono}`, X, yp + 6, { width: W, align: "center", lineBreak: false });
    if (paginas.count > 1) doc.text(`Página ${i + 1} de ${paginas.count}`, X, yp + 6, { width: W, align: "right", lineBreak: false });
  }
  doc.end();
}

module.exports = { generarPdfCotizacion };
