const ExcelJS = require("exceljs");
const path = require("path");
const Cotizacion = require("../models/Cotizacion");

const PLANTILLA = path.join(__dirname, "../../plantillas/Cotizacion_Kenott_corregida.xlsx");

const generarNumero = async () => {
  const ultima = await Cotizacion.findOne({ order: [["id", "DESC"]] });
  const siguiente = ultima ? ultima.id + 1 : 1;
  return String(siguiente).padStart(3, "0");
};

const exportarCotizacion = async (req, res) => {
  try {
    const { cliente, items, guardar = true } = req.body;
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
      await Cotizacion.create({ numero, cliente, subtotal, iva, total, items });
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(PLANTILLA);
    const ws = wb.getWorksheet("Cotización") || wb.worksheets[0];

    // Campos fijos
    ws.getCell("F4").value = numero;
    ws.getCell("C8").value = cliente || "Sin nombre";
    ws.getCell("F8").value = fecha;
    ws.getCell("F9").value = fechaValido.toLocaleDateString("es-CL");

    const FILA_INICIO = 12;
    const FILAS_DISPONIBLES = 57; // filas 12 a 68

    // Si hay más productos que filas, insertar filas extras antes de los totales
    if (items.length > FILAS_DISPONIBLES) {
      const extra = items.length - FILAS_DISPONIBLES;
      ws.spliceRows(FILA_INICIO + FILAS_DISPONIBLES, 0, ...Array(extra).fill([]));
    }

    // Rellenar productos
    items.forEach((item, idx) => {
      const fila = ws.getRow(FILA_INICIO + idx);
      fila.getCell(2).value = item.nombre;
      fila.getCell(2).font = { name: "Arial", size: 9 };
      fila.getCell(3).value = item.unidad || "UNID";
      fila.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      fila.getCell(3).font = { name: "Arial", size: 9 };
      fila.getCell(4).value = item.cantidad;
      fila.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
      fila.getCell(4).font = { name: "Arial", bold: true, size: 9 };
      fila.getCell(5).value = Number(item.precio);
      fila.getCell(5).numFmt = "#,##0";
      fila.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
      fila.getCell(5).font = { name: "Arial", size: 9 };
      fila.getCell(6).value = Number(item.precio) * item.cantidad;
      fila.getCell(6).numFmt = "#,##0";
      fila.getCell(6).alignment = { horizontal: "right", vertical: "middle" };
      fila.getCell(6).font = { name: "Arial", size: 9 };
    });

    // Totales en las filas correctas (después de los productos)
    const FILA_TOTALES = FILA_INICIO + Math.max(items.length, FILAS_DISPONIBLES) + 1;
    ws.getCell(`F${FILA_TOTALES}`).value = subtotal;
    ws.getCell(`F${FILA_TOTALES}`).numFmt = "#,##0";
    ws.getCell(`F${FILA_TOTALES + 1}`).value = iva;
    ws.getCell(`F${FILA_TOTALES + 1}`).numFmt = "#,##0";
    ws.getCell(`F${FILA_TOTALES + 2}`).value = total;
    ws.getCell(`F${FILA_TOTALES + 2}`).numFmt = "#,##0";
    ws.getCell(`F${FILA_TOTALES + 2}`).font = { name: "Arial", bold: true, size: 10 };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="COT-${numero}.xlsx"`);
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

module.exports = { exportarCotizacion, getCotizaciones, getCotizacion };