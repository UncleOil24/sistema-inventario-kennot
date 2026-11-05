const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Cotizacion = require("../models/Cotizacion");
const Cliente = require("../models/Cliente");
const Producto = require("../models/Producto");
const { handler, ErrorNegocio, calcularTotales, normalizarItems } = require("../services/erp");
const { getParametros, precioVenta } = require("../services/parametros");
const { veCostos } = require("../middlewares/auth");
const { validarEmpresa, datosEmpresa } = require("../services/empresas");
const { excelCotizacion, pdfCotizacion, idCotizacion } = require("../services/cotizacionFormato");
const ESTADOS = ["borrador", "cotizacion", "aceptada", "rechazada", "vencida"];
const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const sumarDias = (iso, dias) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + Number(dias))).toISOString().slice(0, 10);
};

// El rol "usuario" no ve costos, proveedores ni márgenes
const vista = (req) => (c) => {
  const j = typeof c.toJSON === "function" ? c.toJSON() : { ...c };
  j.id_cotizacion = j.anterior ? `${j.empresa === "tactics" ? "Tactics" : "Kenott"} N${j.numero} (anterior)` : idCotizacion(j);
  if (veCostos(req)) {
    j.margen = Math.round(Number(j.subtotal) - Number(j.costo_total || 0));
    j.margen_pct = Number(j.subtotal) ? Math.round((j.margen / Number(j.subtotal)) * 100) : 0;
    return j;
  }
  delete j.costo_total;
  j.items = (j.items || []).map(({ costo, proveedor, ...resto }) => resto);
  return j;
};

// Correlativo de cada empresa: el mayor entre el último usado y su parámetro de "último N°", + 1.
// Las cotizaciones "anteriores" (antes de partir en N°100) no cuentan.
const siguienteNumero = async (t, empresa = "kenott") => {
  const params = await getParametros(t);
  const [[fila]] = await sequelize.query(
    `SELECT COALESCE(MAX(CASE WHEN numero ~ '^[0-9]+$' THEN numero::int END), 0) AS max FROM cotizaciones WHERE empresa = :empresa AND anterior = false`,
    { transaction: t, replacements: { empresa } }
  );
  const n = Math.max(Number(fila.max) || 0, Number(datosEmpresa(empresa, params).ultimo_numero) || 0) + 1;
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
      fecha_precio: previo?.fecha_precio ?? p.fecha_precio ?? null,
    };
  });
};

const datosCliente = async (body, t) => {
  if (body.cliente_id) {
    const c = await Cliente.findByPk(body.cliente_id, { transaction: t });
    if (!c) throw new ErrorNegocio("Cliente no encontrado", 404);
    // Cliente general: el nombre se escribe solo para este documento
    const nombre = c.codigo === "CG" && String(body.cliente || "").trim() && body.cliente !== c.nombre ? String(body.cliente).trim() : c.nombre;
    return { cliente_id: c.id, cliente: nombre, codigo_cliente: c.codigo, tipo_precio: body.tipo_precio || c.tipo || "convenio" };
  }
  return { cliente_id: null, cliente: body.cliente || null, codigo_cliente: null, tipo_precio: body.tipo_precio || "convenio" };
};

// Cotizaciones abiertas a las que hay que llamar: la próxima fecha de contacto llegó, o no se ha
// hablado con el cliente en `dias_seguimiento` días desde que se envió (o desde el último contacto).
const wherePorSeguir = async () => {
  const params = await getParametros();
  const dias = Number(params.dias_seguimiento) || 5;
  const hoy = hoyISO();
  const limite = sumarDias(hoy, -dias);
  return {
    estado: "cotizacion",
    [Op.or]: [
      { proximo_contacto: { [Op.lte]: hoy } },
      { proximo_contacto: null, [Op.and]: [sequelize.where(sequelize.fn("COALESCE", sequelize.col("ultimo_contacto"), sequelize.col("fecha")), { [Op.lte]: limite })] },
    ],
  };
};

// GET /api/cotizaciones?estado=&busqueda=&seguimiento=1
const getCotizaciones = handler(async (req, res) => {
  await marcarVencidas();
  const { estado, busqueda } = req.query;
  const where = req.query.seguimiento === "1" ? await wherePorSeguir() : {};
  if (estado) where.estado = estado;
  if (req.query.empresa) where.empresa = req.query.empresa;
  if (busqueda) where[Op.or] = ["numero", "cliente", "nombre_cotizacion", "id_solicitud"].map((c) => ({ [c]: { [Op.iLike]: `%${busqueda}%` } }));
  const data = await Cotizacion.findAll({ where, order: [["anterior", "ASC"], ["createdAt", "DESC"]] });
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
    const { codigo_cliente, ...cliente } = await datosCliente(b, t);
    const items = await armarItems(b.items, cliente.tipo_precio, null, t);
    const params = await getParametros(t);
    const fecha = hoyISO();
    const validez = Number(b.validez_dias) || Number(params.validez_cotizacion_dias) || 30;
    const empresa = validarEmpresa(b.empresa);
    const numero = await siguienteNumero(t, empresa);
    return Cotizacion.create({
      numero, empresa, ...cliente,
      // ID impreso: el de la solicitud (licitación / compra ágil) o, si no hay, el del cliente
      id_solicitud: String(b.id_solicitud || "").trim() || (codigo_cliente && codigo_cliente !== "CG" ? codigo_cliente : null),
      plazo_entrega: String(b.plazo_entrega || "").trim() || params.plazo_entrega || null,
      nombre_cotizacion: b.nombre_cotizacion || null, // se imprime como "Descripción" (Kenott) o "Proyecto" (Tactics)
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
      const { codigo_cliente, ...cli } = await datosCliente({ cliente_id: c.cliente_id, cliente: c.cliente, ...b }, t);
      Object.assign(cambios, cli);
      // Si cambia el cliente y no se indicó otro ID, toma el del cliente nuevo
      if (cli.cliente_id !== c.cliente_id && !("id_solicitud" in b) && codigo_cliente && codigo_cliente !== "CG") cambios.id_solicitud = codigo_cliente;
    }
    if (b.id_solicitud !== undefined) cambios.id_solicitud = String(b.id_solicitud || "").trim() || null;
    if (b.plazo_entrega !== undefined) cambios.plazo_entrega = String(b.plazo_entrega || "").trim() || null;
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
    // Cambiar de empresa le da el número siguiente de la otra empresa
    if (b.empresa && validarEmpresa(b.empresa) !== c.empresa) {
      if (c.anterior) throw new ErrorNegocio("Una cotización anterior no se puede cambiar de empresa");
      cambios.empresa = validarEmpresa(b.empresa);
      cambios.numero = await siguienteNumero(t, cambios.empresa);
      if ((c.nombre_cotizacion || "") === `Cotización ${c.numero}`) cambios.nombre_cotizacion = `Cotización ${cambios.numero}`;
    }
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

// POST /api/cotizaciones/:id/seguimiento   { nota, proximo_contacto (AAAA-MM-DD) | dias }
// Registra que se habló con el cliente y cuándo volver a llamar.
const registrarSeguimiento = handler(async (req, res) => {
  const cot = await Cotizacion.findByPk(req.params.id);
  if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
  if (cot.estado !== "cotizacion") throw new ErrorNegocio("Solo se hace seguimiento a cotizaciones abiertas");
  const params = await getParametros();
  const hoy = hoyISO();
  const proximo = req.body?.proximo_contacto
    || (req.body?.dias === 0 || req.body?.dias === "0" ? null : sumarDias(hoy, Number(req.body?.dias) || Number(params.dias_seguimiento) || 5));
  const historial = [...(cot.seguimientos || []), { fecha: new Date().toISOString(), nota: req.body?.nota || "", usuario: req.usuario.nombre, proximo }];
  await cot.update({ seguimientos: historial, ultimo_contacto: hoy, proximo_contacto: proximo });
  res.json({ ok: true, data: vista(req)(cot) });
});

// GET /api/cotizaciones/por-seguir/cantidad
const cantidadPorSeguir = handler(async (req, res) => {
  await marcarVencidas();
  res.json({ ok: true, data: { cantidad: await Cotizacion.count({ where: await wherePorSeguir() }) } });
});

// DELETE /api/cotizaciones/:id
const eliminarCotizacion = handler(async (req, res) => {
  const cot = await Cotizacion.findByPk(req.params.id);
  if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
  if (cot.estado === "aceptada") throw new ErrorNegocio("No se puede borrar una cotización convertida en venta");
  await cot.destroy();
  res.json({ ok: true, message: "Cotización eliminada" });
});

// GET /api/cotizaciones/:id/excel   (plantilla de la empresa, sin costos)
const limpioArchivo = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s.-]/g, "").trim().slice(0, 60) || "cliente";
const nombreArchivo = (cot, ext) => `${idCotizacion(cot)}${cot.anterior ? "_anterior" : ""}-${limpioArchivo(cot.cliente)}.${ext}`;
const descargarExcel = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    const wb = await excelCotizacion(cot.toJSON(), datosEmpresa(cot.empresa, await getParametros()));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo(cot, "xlsx")}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ ok: false, error: error.message });
  }
};

// GET /api/cotizaciones/:id/pdf   (plantilla de la empresa, sin costos)
const descargarPdf = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    const emp = datosEmpresa(cot.empresa, await getParametros());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo(cot, "pdf")}"`);
    pdfCotizacion(cot.toJSON(), emp, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = {
  registrarSeguimiento, cantidadPorSeguir, wherePorSeguir,
  descargarPdf,
  getCotizaciones, getCotizacion, crearCotizacion, actualizarCotizacion, cambiarEstado, eliminarCotizacion, descargarExcel,
};
