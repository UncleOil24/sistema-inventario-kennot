// Cotización en PDF con el formato Kenott (mismo diseño que plantilla_cotizacion.xlsx).
// Los datos de la empresa salen de parametros (editables en Configuración).
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const VERDE = "#1A4731";
const VERDE_CLARO = "#D6EFE1";
const VERDE_FILA = "#F1F8F4";
const GRIS = "#555555";
const LOGO = path.join(__dirname, "../../plantillas/logo_kenott.png");
const FIRMA = path.join(__dirname, "../../plantillas/firma.png");

const pesos = (n) => Math.round(Number(n) || 0).toLocaleString("es-CL");
const fechaCL = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-") : "");
const cantidad = (n) => { const v = Number(n); return Number.isInteger(v) ? String(v) : v.toLocaleString("es-CL"); };

// Escribe el PDF en `destino` (stream). empresa: parámetros de la empresa.
function generarPdfCotizacion(cot, empresa, destino) {
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

module.exports = { generarPdfCotizacion };
