const ExcelJS = require("exceljs");
const path = require("path");
const Cotizacion = require("../models/Cotizacion");

const PLANTILLA = path.join(__dirname, "../../plantillas/plantilla_cotizacion.xlsx");

const generarNumero = async () => {
  const ultima = await Cotizacion.findOne({ order: [["id", "DESC"]] });
  const siguiente = ultima ? ultima.id + 1 : 1;
  return String(siguiente).padStart(3, "0");
};

const exportarCotizacion = async (req, res) => {
  try {
    const { cliente, items, guardar = true, nombre_cotizacion } = req.body;
    if (!items || items.length === 0)
      return res.status(400).json({ ok: false, error: "Sin items" });

    const subtotal = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
    const iva = Math.round(subtotal * 0.19);
    const total = subtotal + iva;
    const numero = await generarNumero();
    const fecha = new Date().toLocaleDateString("es-CL");
    const fechaValido = new Date();
    fechaValido.setDate(fechaValido.getDate() + 30);

    if (guardar) {
      await Cotizacion.create({
        numero,
        cliente,
        nombre_cotizacion: nombre_cotizacion || `Cotización ${numero}`,
        subtotal,
        iva,
        total,
        items,
      });
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(PLANTILLA);
    const ws = wb.getWorksheet("Cotización") || wb.worksheets[0];

    // Campos fijos
    ws.getCell("H5").value = numero;
    ws.getCell("C8").value = cliente || "Sin nombre";
    ws.getCell("H8").value = fecha;
    ws.getCell("H9").value = fechaValido.toLocaleDateString("es-CL");

    // Productos desde fila 12
    const FILA_INICIO = 12;
    const FILA_TOTALES_ORIG = 42;
    const FILAS_DISPONIBLES = FILA_TOTALES_ORIG - FILA_INICIO;

    if (items.length > FILAS_DISPONIBLES) {
      const extra = items.length - FILAS_DISPONIBLES;
      ws.spliceRows(FILA_TOTALES_ORIG, 0, ...Array(extra).fill([]));
    }

    items.forEach((item, idx) => {
      const fila = ws.getRow(FILA_INICIO + idx);
      fila.getCell(2).value = item.nombre;
      fila.getCell(2).font = { name: "Arial", size: 9 };
      fila.getCell(5).value = item.unidad || "UNID";
      fila.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
      fila.getCell(5).font = { name: "Arial", size: 9 };
      fila.getCell(6).value = item.cantidad;
      fila.getCell(6).alignment = { horizontal: "center", vertical: "middle" };
      fila.getCell(6).font = { name: "Arial", bold: true, size: 9 };
      fila.getCell(7).value = Number(item.precio);
      fila.getCell(7).numFmt = "#,##0";
      fila.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
      fila.getCell(7).font = { name: "Arial", size: 9 };
      fila.getCell(8).value = Number(item.precio) * item.cantidad;
      fila.getCell(8).numFmt = "#,##0";
      fila.getCell(8).alignment = { horizontal: "right", vertical: "middle" };
      fila.getCell(8).font = { name: "Arial", size: 9 };
    });

    const FILA_TOT = FILA_INICIO + Math.max(items.length, FILAS_DISPONIBLES);
    ws.getCell(`H${FILA_TOT}`).value = subtotal;
    ws.getCell(`H${FILA_TOT}`).numFmt = "#,##0";
    ws.getCell(`H${FILA_TOT + 1}`).value = iva;
    ws.getCell(`H${FILA_TOT + 1}`).numFmt = "#,##0";
    ws.getCell(`H${FILA_TOT + 2}`).value = total;
    ws.getCell(`H${FILA_TOT + 2}`).numFmt = "#,##0";
    ws.getCell(`H${FILA_TOT + 2}`).font = { name: "Arial", bold: true, size: 10 };

    const nombreArchivo = `COT-${numero}-${cliente || "cliente"}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

const getCotizaciones = async (req, res) => {
  try {
    const cotizaciones = await Cotizacion.findAll({ order: [["createdAt", "DESC"]] });
    res.json({ ok: true, data: cotizaciones });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

const getCotizacion = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    res.json({ ok: true, data: cot });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

const eliminarCotizacion = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    await cot.destroy();
    res.json({ ok: true, message: "Cotización eliminada" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

const reexportarCotizacion = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });

    req.body = {
      cliente: cot.cliente,
      items: cot.items,
      nombre_cotizacion: cot.nombre_cotizacion,
      guardar: false,
    };

    return exportarCotizacion(req, res);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = { exportarCotizacion, getCotizaciones, getCotizacion, eliminarCotizacion, reexportarCotizacion };