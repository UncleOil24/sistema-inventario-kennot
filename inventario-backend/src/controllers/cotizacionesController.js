const ExcelJS = require("exceljs");
const path = require("path");
const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Cotizacion = require("../models/Cotizacion");
const Cliente = require("../models/Cliente");
const Producto = require("../models/Producto");
const { handler, ErrorNegocio, calcularTotales, normalizarItems } = require("../services/erp");
const { getParametros, precioVenta } = require("../services/parametros");
const { esAdmin } = require("../middlewares/auth");
const { generarPdfCotizacion } = require("../services/pdfCotizacion");

const PLANTILLA = path.join(__dirname, "../../plantillas/plantilla_cotizacion.xlsx");
const ESTADOS = ["borrador", "cotizacion", "aceptada", "rechazada", "vencida"];
const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const sumarDias = (iso, dias) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + Number(dias));
  return d.toISOString().slice(0, 10);
};

// El rol "usuario" no ve costos, proveedores ni márgenes
const vista = (req) => (c) => {
  const j = typeof c.toJSON === "function" ? c.toJSON() : { ...c };
  if (esAdmin(req)) {
    j.margen = Math.round(Number(j.subtotal) - Number(j.costo_total || 0));
    j.margen_pct = Number(j.subtotal) ? Math.round((j.margen / Number(j.subtotal)) * 100) : 0;
    return j;
  }
  delete j.costo_total;
  j.items = (j.items || []).map(({ costo, proveedor, ...resto }) => resto);
  return j;
};

// Correlativo: el mayor entre el último usado y el parámetro "ultimo_numero_cotizacion", + 1
const siguienteNumero = async (t) => {
  const params = await getParametros(t);
  const [[fila]] = await sequelize.query(
    `SELECT COALESCE(MAX(CASE WHEN numero ~ '^[0-9]+$' THEN numero::int END), 0) AS max FROM cotizaciones`,
    { transaction: t }
  );
  const n = Math.max(Number(fila.max) || 0, Number(params.ultimo_numero_cotizacion) || 0) + 1;
  return String(n).padStart(3, "0");
};

// Las cotizaciones abiertas cuya validez ya pasó quedan como "vencida"
const marcarVencidas = () => Cotizacion.update(
  { estado: "vencida", motivo_estado: "Venció su validez" },
  { where: { estado: "cotizacion", fecha_validez: { [Op.lt]: hoyISO() } } }
);

// Arma los items: copia descripción, unidad, costo y proveedor del catálogo.
// El precio de venta se calcula por tipo de cliente salvo que venga corregido a mano.
// Si una línea ya existía en la cotización, conserva su costo (no cambia el margen).
const armarItems = async (itemsBody, tipo, anteriores, t) => {
  const items = normalizarItems((itemsBody || []).map((i) => ({ ...i, precio: i.precio === "" || i.precio == null ? 0 : i.precio })));
  const params = await getParametros(t);
  const productos = await Producto.findAll({ where: { id: items.map((i) => i.producto_id) }, transaction: t });
  const mapa = new Map(productos.map((p) => [p.id, p]));
  const previos = new Map((anteriores || []).map((i) => [Number(i.producto_id ?? i.id), i]));
  return items.map((i, idx) => {
    const p = mapa.get(i.producto_id);
    if (!p) throw new ErrorNegocio(`Producto ${i.producto_id} no existe`, 404);
    const previo = previos.get(p.id);
    const costo = previo && previo.costo !== undefined ? Number(previo.costo) : Number(p.precio_compra) || 0;
    const precioDado = itemsBody[idx].precio;
    const precio = precioDado === "" || precioDado == null ? precioVenta(costo, tipo, params) : Number(precioDado);
    return {
      producto_id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      descripcion_cliente: itemsBody[idx].descripcion_cliente || previo?.descripcion_cliente || null,
      unidad: p.unidad,
      cantidad: i.cantidad,
      precio,
      costo,
      proveedor: previo?.proveedor ?? p.proveedor ?? null,
    };
  });
};

const datosCliente = async (body, t) => {
  if (body.cliente_id) {
    const c = await Cliente.findByPk(body.cliente_id, { transaction: t });
    if (!c) throw new ErrorNegocio("Cliente no encontrado", 404);
    return { cliente_id: c.id, cliente: c.nombre, tipo_precio: body.tipo_precio || c.tipo || "convenio" };
  }
  return { cliente_id: null, cliente: body.cliente || null, tipo_precio: body.tipo_precio || "convenio" };
};

// GET /api/cotizaciones?estado=&busqueda=
const getCotizaciones = handler(async (req, res) => {
  await marcarVencidas();
  const { estado, busqueda } = req.query;
  const where = {};
  if (estado) where.estado = estado;
  if (busqueda) where[Op.or] = ["numero", "cliente", "nombre_cotizacion"].map((c) => ({ [c]: { [Op.iLike]: `%${busqueda}%` } }));
  const data = await Cotizacion.findAll({ where, order: [["createdAt", "DESC"]] });
  res.json({ ok: true, data: data.map(vista(req)) });
});

// GET /api/cotizaciones/:id
const getCotizacion = handler(async (req, res) => {
  const cot = await Cotizacion.findByPk(req.params.id);
  if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
  res.json({ ok: true, data: vista(req)(cot) });
});

// POST /api/cotizaciones
// { cliente_id | cliente, tipo_precio, nombre_cotizacion, validez_dias, estado: borrador|cotizacion, notas,
//   items: [{ producto_id, cantidad, precio?, descripcion_cliente? }] }
const crearCotizacion = handler(async (req, res) => {
  const b = req.body || {};
  const cot = await sequelize.transaction(async (t) => {
    const cliente = await datosCliente(b, t);
    const items = await armarItems(b.items, cliente.tipo_precio, null, t);
    const params = await getParametros(t);
    const fecha = hoyISO();
    const validez = Number(b.validez_dias) || Number(params.validez_cotizacion_dias) || 30;
    const numero = await siguienteNumero(t);
    return Cotizacion.create({
      numero, ...cliente,
      nombre_cotizacion: b.nombre_cotizacion || `Cotización ${numero}`,
      fecha, validez_dias: validez, fecha_validez: sumarDias(fecha, validez),
      estado: b.estado === "borrador" ? "borrador" : "cotizacion",
      notas: b.notas || null,
      archivo_cliente: b.archivo_cliente || null,
      items, ...calcularTotales(items),
      costo_total: items.reduce((s, i) => s + i.costo * i.cantidad, 0),
      creado_por: req.usuario.nombre,
    }, { transaction: t });
  });
  res.status(201).json({ ok: true, data: vista(req)(cot) });
});

// PUT /api/cotizaciones/:id   (solo borrador o cotización abierta)
const actualizarCotizacion = handler(async (req, res) => {
  const b = req.body || {};
  const cot = await sequelize.transaction(async (t) => {
    const c = await Cotizacion.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!c) throw new ErrorNegocio("Cotización no encontrada", 404);
    if (!["borrador", "cotizacion"].includes(c.estado)) throw new ErrorNegocio(`No se puede editar una cotización ${c.estado}`);
    const cambios = {};
    if ("cliente_id" in b || "cliente" in b || "tipo_precio" in b) {
      Object.assign(cambios, await datosCliente({ cliente_id: c.cliente_id, cliente: c.cliente, ...b }, t));
    }
    if (b.items) {
      const items = await armarItems(b.items, cambios.tipo_precio || c.tipo_precio, b.actualizar_costos ? null : c.items, t);
      Object.assign(cambios, { items, ...calcularTotales(items), costo_total: items.reduce((s, i) => s + i.costo * i.cantidad, 0) });
    }
    if (b.nombre_cotizacion !== undefined) cambios.nombre_cotizacion = b.nombre_cotizacion;
    if (b.notas !== undefined) cambios.notas = b.notas;
    if (b.validez_dias) {
      cambios.validez_dias = Number(b.validez_dias);
      cambios.fecha_validez = sumarDias(c.fecha || hoyISO(), b.validez_dias);
    }
    if (b.estado && ["borrador", "cotizacion"].includes(b.estado)) cambios.estado = b.estado;
    await c.update(cambios, { transaction: t });
    return c;
  });
  res.json({ ok: true, data: vista(req)(cot) });
});

// POST /api/cotizaciones/:id/estado   { estado: cotizacion|rechazada|vencida|borrador, motivo }
// "aceptada" se marca solo al convertirla en venta.
const cambiarEstado = handler(async (req, res) => {
  const { estado, motivo } = req.body || {};
  if (!ESTADOS.includes(estado) || estado === "aceptada") throw new ErrorNegocio("Estado inválido. Para aceptarla, conviértela en venta.");
  const cot = await Cotizacion.findByPk(req.params.id);
  if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
  if (cot.estado === "aceptada") throw new ErrorNegocio("La cotización ya es una venta. Anula la venta para reabrirla.");
  const cambios = { estado, motivo_estado: motivo || null };
  // Reabrir una vencida le da una nueva validez desde hoy
  if (estado === "cotizacion" && cot.estado === "vencida") cambios.fecha_validez = sumarDias(hoyISO(), cot.validez_dias || 30);
  await cot.update(cambios);
  res.json({ ok: true, data: vista(req)(cot) });
});

// DELETE /api/cotizaciones/:id
const eliminarCotizacion = handler(async (req, res) => {
  const cot = await Cotizacion.findByPk(req.params.id);
  if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
  if (cot.estado === "aceptada") throw new ErrorNegocio("No se puede borrar una cotización convertida en venta");
  await cot.destroy();
  res.json({ ok: true, message: "Cotización eliminada" });
});

// GET /api/cotizaciones/:id/excel   (formato Kenott, sin costos)
const descargarExcel = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    const items = cot.items || [];
    const fecha = cot.fecha ? new Date(`${cot.fecha}T12:00:00`) : new Date(cot.createdAt);
    const validez = cot.fecha_validez ? new Date(`${cot.fecha_validez}T12:00:00`) : new Date(fecha.getTime() + 30 * 864e5);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(PLANTILLA);
    const ws = wb.getWorksheet("Cotización") || wb.worksheets[0];
    ws.getCell("H5").value = cot.numero;
    ws.getCell("D8").value = cot.cliente || "Sin nombre";
    ws.getCell("H8").value = fecha.toLocaleDateString("es-CL");
    ws.getCell("H9").value = validez.toLocaleDateString("es-CL");
    ws.getCell("D9").value = cot.nombre_cotizacion || "";

    const FILA_INICIO = 12;
    const FILA_TOTALES_ORIG = 42;
    const FILAS_DISPONIBLES = FILA_TOTALES_ORIG - FILA_INICIO;
    if (items.length > FILAS_DISPONIBLES) {
      ws.spliceRows(FILA_TOTALES_ORIG, 0, ...Array(items.length - FILAS_DISPONIBLES).fill([]));
    }
    const fuente = { name: "Arial", size: 9 };
    items.forEach((item, idx) => {
      const fila = ws.getRow(FILA_INICIO + idx);
      fila.getCell(2).value = item.nombre;
      fila.getCell(2).font = fuente;
      fila.getCell(5).value = item.unidad || "UNID";
      fila.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
      fila.getCell(5).font = fuente;
      fila.getCell(6).value = Number(item.cantidad);
      fila.getCell(6).alignment = { horizontal: "center", vertical: "middle" };
      fila.getCell(6).font = { ...fuente, bold: true };
      fila.getCell(7).value = Number(item.precio);
      fila.getCell(7).numFmt = "#,##0";
      fila.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
      fila.getCell(7).font = fuente;
      fila.getCell(8).value = Math.round(Number(item.precio) * Number(item.cantidad));
      fila.getCell(8).numFmt = "#,##0";
      fila.getCell(8).alignment = { horizontal: "right", vertical: "middle" };
      fila.getCell(8).font = fuente;
    });
    const FILA_TOT = FILA_INICIO + Math.max(items.length, FILAS_DISPONIBLES);
    [[0, cot.subtotal], [1, cot.iva], [2, cot.total]].forEach(([k, v]) => {
      const cell = ws.getCell(`H${FILA_TOT + k}`);
      cell.value = Math.round(Number(v));
      cell.numFmt = "#,##0";
    });
    ws.getCell(`H${FILA_TOT + 2}`).font = { name: "Arial", bold: true, size: 10 };

    const limpio = (s) => String(s || "").replace(/[^\w\s.-]/g, "").trim().slice(0, 60) || "cliente";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="COT-${cot.numero}-${limpio(cot.cliente)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ ok: false, error: error.message });
  }
};

// GET /api/cotizaciones/:id/pdf   (formato Kenott, sin costos)
const limpioArchivo = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s.-]/g, "").trim().slice(0, 60) || "cliente";
const descargarPdf = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    const empresa = await getParametros();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="COT-${cot.numero}-${limpioArchivo(cot.cliente)}.pdf"`);
    generarPdfCotizacion(cot.toJSON(), empresa, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = {
  descargarPdf,
  getCotizaciones, getCotizacion, crearCotizacion, actualizarCotizacion, cambiarEstado, eliminarCotizacion, descargarExcel,
};
