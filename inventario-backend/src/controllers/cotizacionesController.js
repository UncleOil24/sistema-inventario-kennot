const ExcelJS = require("exceljs");
const Cotizacion = require("../models/Cotizacion");

// Genera número de cotización: COT-2024-0001
const generarNumero = async () => {
  const año = new Date().getFullYear();
  const ultima = await Cotizacion.findOne({ order: [["id", "DESC"]] });
  const siguiente = ultima ? ultima.id + 1 : 1;
  return `COT-${año}-${String(siguiente).padStart(4, "0")}`;
};

// POST /api/cotizaciones/export
// Genera Excel y opcionalmente guarda la cotización en BD
const exportarCotizacion = async (req, res) => {
  try {
    const { cliente, items, guardar = true } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ ok: false, error: "Sin items en la cotización" });
    }

    const subtotal = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
    const iva = Math.round(subtotal * 0.19);
    const total = subtotal + iva;
    const numero = await generarNumero();
    const fecha = new Date().toLocaleDateString("es-CL");

    // Guardar en BD si se solicita
    if (guardar) {
      await Cotizacion.create({ numero, cliente, subtotal, iva, total, items });
    }

    // ── Generar Excel ──────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = "InventarioSys";
    const ws = wb.addWorksheet("Cotización");

    // Colores
    const AMARILLO = "FFE8C547";
    const NEGRO = "FF0D0E0F";
    const GRIS_OSCURO = "FF1C1F22";
    const GRIS_CLARO = "FFE2E4E7";
    const BLANCO = "FFFFFFFF";

    // Anchos de columna
    ws.columns = [
      { key: "a", width: 10 },
      { key: "b", width: 40 },
      { key: "c", width: 16 },
      { key: "d", width: 14 },
      { key: "e", width: 18 },
    ];

    // ── Encabezado empresa ──────────────────────────────────────
    ws.mergeCells("A1:E1");
    const titulo = ws.getCell("A1");
    titulo.value = "INVENTARIO SYS";
    titulo.font = { name: "Arial", bold: true, size: 18, color: { argb: AMARILLO } };
    titulo.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NEGRO } };
    titulo.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 40;

    ws.mergeCells("A2:E2");
    const subtitulo = ws.getCell("A2");
    subtitulo.value = "Sistema de Gestión de Inventario";
    subtitulo.font = { name: "Arial", size: 10, color: { argb: "FF8B9099" } };
    subtitulo.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NEGRO } };
    subtitulo.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(2).height = 20;

    // ── Info cotización ─────────────────────────────────────────
    ws.getRow(4).height = 18;
    const setCeldaInfo = (celda, label, valor) => {
      const cL = ws.getCell(celda[0]);
      const cV = ws.getCell(celda[1]);
      cL.value = label;
      cL.font = { name: "Arial", bold: true, size: 9, color: { argb: "FF8B9099" } };
      cV.value = valor;
      cV.font = { name: "Arial", bold: true, size: 10 };
    };

    setCeldaInfo(["A4", "B4"], "N° COTIZACIÓN:", numero);
    setCeldaInfo(["A5", "B5"], "CLIENTE:", cliente || "Sin nombre");
    setCeldaInfo(["A6", "B6"], "FECHA:", fecha);
    setCeldaInfo(["D4", "E4"], "ESTADO:", "PENDIENTE");
    setCeldaInfo(["D5", "E5"], "MONEDA:", "CLP (Pesos Chilenos)");
    setCeldaInfo(["D6", "E6"], "IVA:", "19%");

    // ── Tabla de productos ──────────────────────────────────────
    const FILA_HEADER = 9;
    ws.getRow(FILA_HEADER).height = 22;

    const headers = ["ID", "PRODUCTO", "PRECIO UNIT.", "CANTIDAD", "SUBTOTAL"];
    headers.forEach((h, i) => {
      const cell = ws.getRow(FILA_HEADER).getCell(i + 1);
      cell.value = h;
      cell.font = { name: "Arial", bold: true, size: 9, color: { argb: BLANCO } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NEGRO } };
      cell.alignment = { horizontal: i === 1 ? "left" : "center", vertical: "middle" };
    });

    const fmtClp = (n) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(n);

    items.forEach((item, idx) => {
      const fila = FILA_HEADER + 1 + idx;
      const row = ws.getRow(fila);
      row.height = 18;

      const fillColor = idx % 2 === 0 ? BLANCO : "FFF5F6F7";

      const datos = [
        `#${String(item.id).padStart(4, "0")}`,
        item.nombre,
        fmtClp(item.precio),
        item.cantidad,
        fmtClp(item.precio * item.cantidad),
      ];

      datos.forEach((val, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value = val;
        cell.font = { name: "Arial", size: 9 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
        cell.alignment = { horizontal: ci === 1 ? "left" : "center", vertical: "middle" };
        // Borde inferior suave
        cell.border = { bottom: { style: "thin", color: { argb: "FFE0E0E0" } } };
      });
    });

    // ── Totales ─────────────────────────────────────────────────
    const FILA_TOT = FILA_HEADER + items.length + 2;

    const addTotal = (fila, label, valor, esGrand = false) => {
      ws.mergeCells(`A${fila}:C${fila}`);
      const cLabel = ws.getCell(`A${fila}`);
      cLabel.value = label;
      cLabel.font = { name: "Arial", bold: esGrand, size: esGrand ? 11 : 9, color: { argb: esGrand ? AMARILLO : "FF8B9099" } };
      cLabel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: esGrand ? NEGRO : BLANCO } };
      cLabel.alignment = { horizontal: "right" };

      ws.mergeCells(`D${fila}:E${fila}`);
      const cVal = ws.getCell(`D${fila}`);
      cVal.value = fmtClp(valor);
      cVal.font = { name: "Arial", bold: esGrand, size: esGrand ? 12 : 9, color: { argb: esGrand ? AMARILLO : NEGRO } };
      cVal.fill = { type: "pattern", pattern: "solid", fgColor: { argb: esGrand ? NEGRO : BLANCO } };
      cVal.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(fila).height = esGrand ? 24 : 18;
    };

    addTotal(FILA_TOT, "SUBTOTAL (sin IVA)", subtotal);
    addTotal(FILA_TOT + 1, "IVA (19%)", iva);
    addTotal(FILA_TOT + 2, "TOTAL A PAGAR", total, true);

    // ── Pie de página ───────────────────────────────────────────
    const FILA_PIE = FILA_TOT + 4;
    ws.mergeCells(`A${FILA_PIE}:E${FILA_PIE}`);
    const pie = ws.getCell(`A${FILA_PIE}`);
    pie.value = "Cotización válida por 30 días a partir de la fecha de emisión.";
    pie.font = { name: "Arial", italic: true, size: 8, color: { argb: "FF8B9099" } };
    pie.alignment = { horizontal: "center" };

    // ── Enviar archivo ──────────────────────────────────────────
    const nombreArchivo = `${numero}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// GET /api/cotizaciones
const getCotizaciones = async (req, res) => {
  try {
    const cotizaciones = await Cotizacion.findAll({ order: [["createdAt", "DESC"]] });
    res.json({ ok: true, data: cotizaciones });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// GET /api/cotizaciones/:id
const getCotizacion = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    res.json({ ok: true, data: cot });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = { exportarCotizacion, getCotizaciones, getCotizacion };
