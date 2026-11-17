const { firma } = require("../middlewares/auth");
const sequelize = require("../../config/database");
const Producto = require("../models/Producto");
const PrecioProveedor = require("../models/PrecioProveedor");
const Proveedor = require("../models/Proveedor");
const AuditoriaIA = require("../models/AuditoriaIA");
const Licitacion = require("../models/Licitacion");
const { handler, ErrorNegocio } = require("../services/erp");
const ia = require("../services/ia");
const { getParametros } = require("../services/parametros");
const { recalcular, normProv, origenDe, registrar } = require("../services/precios");
const { vista } = require("./productosController");
const { esAdmin, esGerencia } = require("../middlewares/auth");
const { unidadDeProducto } = require("../services/unidades");

// Índice de búsqueda: descripción estándar + descripciones con que los proveedores cotizaron cada producto
async function indiceCatalogo() {
  const [productos, descs] = await Promise.all([
    Producto.findAll({ where: { activo: true } }),
    PrecioProveedor.findAll({ attributes: ["producto_id", "descripcion_proveedor"], where: { descartado: false }, raw: true }),
  ]);
  const mapa = new Map();
  for (const d of descs) {
    if (!d.descripcion_proveedor) continue;
    const l = mapa.get(d.producto_id) || [];
    if (l.length < 6 && !l.includes(d.descripcion_proveedor)) l.push(d.descripcion_proveedor);
    mapa.set(d.producto_id, l);
  }
  return { indice: ia.crearIndice(productos, mapa), productos: new Map(productos.map((p) => [p.id, p])) };
}

// GET /api/ia/estado
const estado = handler(async (req, res) => {
  res.json({ ok: true, data: { configurada: ia.iaConfigurada(), modelo: ia.MODELO() } });
});

// POST /api/ia/lista-cliente   (multipart: archivo)
// Devuelve cada línea del cliente con el producto propuesto. Los precios los pone el sistema.
// Descarga un documento desde un enlace (bases o anexos publicados en la web) como si fuera un archivo subido
const MIMES = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", csv: "text/csv" };
async function archivoDesdeUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { throw new ErrorNegocio("El enlace no es válido"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new ErrorNegocio("El enlace debe empezar con http:// o https://");
  const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!r || !r.ok) throw new ErrorNegocio(`No pude descargar el documento (${r ? r.status : "sin respuesta"}). Si pide clave o es una página, descárgalo y súbelo desde el computador.`);
  const buffer = Buffer.from(await r.arrayBuffer());
  if (buffer.length > 15 * 1024 * 1024) throw new ErrorNegocio("El documento pesa más de 15 MB");
  let nombre = decodeURIComponent(u.pathname.split("/").pop() || "documento");
  const disp = r.headers.get("content-disposition") || "";
  const m = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m) nombre = decodeURIComponent(m[1]);
  const ext = (nombre.split(".").pop() || "").toLowerCase();
  let mimetype = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!mimetype || mimetype === "application/octet-stream") mimetype = MIMES[ext] || mimetype;
  if (mimetype === "text/html") throw new ErrorNegocio("El enlace abre una página web, no un documento. Abre la página, descarga el PDF o Excel y súbelo.");
  return { originalname: nombre, mimetype, buffer, size: buffer.length };
}

const listaCliente = handler(async (req, res) => {
  if (!req.file && req.body?.url) req.file = await archivoDesdeUrl(req.body.url);
  if (!req.file) throw new ErrorNegocio("Sube un archivo o pega el enlace del documento");
  const { indice, productos } = await indiceCatalogo();
  const r = await ia.leerListaCliente(req.file, indice, firma(req));
  const params = await getParametros();
  const ver = vista(req, params);
  res.json({
    ok: true,
    data: {
      ...r,
      archivo: req.file.originalname,
      lineas: r.lineas.map((l) => ({
        descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, calce: l.calce, nota: l.nota,
        producto: l.producto_id ? ver(productos.get(l.producto_id)) : null,
        candidatos: l.candidatos.slice(0, 6).map((p) => ver(p)),
      })),
    },
  });
});

// POST /api/ia/licitacion/:codigo   -> los productos de la licitación calzados con el catálogo
const licitacion = handler(async (req, res) => {
  const l = await Licitacion.findByPk(req.params.codigo);
  if (!l) throw new ErrorNegocio("Licitación no encontrada", 404);
  // Si Mercado Público no responde o limitó las consultas, igual se abre el cotizador para subir el anexo o las bases
  let avisoMP = null;
  if (!l.detalle_cargado) {
    try { await require("../services/mercadoPublico").cargarDetalle(l); } catch (e) { avisoMP = e.message; }
  }
  const base = { archivo: `${l.fuente === "compra_agil" ? "Compra Ágil" : "Licitación"} ${l.codigo}`, cliente: l.organismo || "", observaciones: l.nombre,
    presupuesto: l.presupuesto || l.monto_estimado || null, cierre: l.fecha_cierre, codigo: l.codigo };
  // Sin productos detallados en Mercado Público: se devuelve vacío para que suban las bases o el anexo
  if (!l.items?.length) return res.json({ ok: true, data: { ...base, lineas: [], sin_detalle: true, aviso_mp: avisoMP } });
  const lineas = l.items.map((i) => {
    const extra = i.descripcion && sinTildes(i.descripcion) !== sinTildes(i.producto) ? ` - ${String(i.descripcion).slice(0, 160)}` : "";
    return { descripcion: `${i.producto}${extra}`.trim(), cantidad: Number(i.cantidad) || 1, unidad: i.unidad || "" };
  });
  const { indice, productos } = await indiceCatalogo();
  const calzadas = await ia.calzarLineas(lineas, indice, { usuario: firma(req), tipo: "licitacion", archivo: l.codigo });
  const ver = vista(req, await getParametros());
  res.json({
    ok: true,
    data: {
      ...base,
      lineas: calzadas.map((x) => ({
        descripcion: x.descripcion, cantidad: x.cantidad, unidad: x.unidad, calce: x.calce, nota: x.nota,
        producto: x.producto_id ? ver(productos.get(x.producto_id)) : null,
        candidatos: x.candidatos.slice(0, 6).map((p) => ver(p)),
      })),
    },
  });
});
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// POST /api/ia/documento-proveedor   (multipart: archivo)  -> propuesta para revisar
const documentoProveedor = handler(async (req, res) => {
  const DocumentoCargado = require("../models/DocumentoCargado");
  const hash = require("crypto").createHash("sha256").update(req.file.buffer).digest("hex");
  const mismoArchivo = await DocumentoCargado.findOne({ where: { hash }, order: [["id", "DESC"]] });
  const { indice, productos } = await indiceCatalogo();
  const r = await ia.leerDocumentoProveedor(req.file, indice, firma(req));
  const ver = vista(req, await getParametros());
  const prov = r.encabezado.proveedor
    ? await Proveedor.findOne({ where: sequelize.where(sequelize.fn("upper", sequelize.col("nombre")), r.encabezado.proveedor) })
    : null;
  const nombreProv = prov?.nombre || normProv(r.encabezado.proveedor || "");
  const numero = String(r.encabezado.numero_documento || "").trim();

  // ¿Ya se cargó? Mismo archivo, mismo proveedor y N°, o casi todos los precios iguales a los últimos de ese proveedor
  const ids = r.lineas.map((l) => l.producto_id).filter(Boolean);
  const ultimos = new Map();
  if (nombreProv && ids.length) {
    const filas = await PrecioProveedor.findAll({ where: { producto_id: ids, proveedor: nombreProv, descartado: false }, order: [["fecha", "DESC"], ["id", "DESC"]], raw: true });
    for (const f of filas) if (!ultimos.has(f.producto_id)) ultimos.set(f.producto_id, f);
  }
  const lineas = r.lineas.map((l) => {
    const u = l.producto_id ? ultimos.get(l.producto_id) : null;
    const precio = Math.round(Number(l.precio_neto) || 0);
    return {
      descripcion: l.descripcion, codigo_proveedor: l.codigo_proveedor, marca: l.marca, unidad: l.unidad, cantidad: l.cantidad,
      precio_neto: l.precio_neto, total_linea: l.total_linea, calce: l.calce, nota: l.nota,
      producto: l.producto_id ? ver(productos.get(l.producto_id)) : null,
      candidatos: l.candidatos.slice(0, 6).map((p) => ver(p)),
      anterior: u ? { precio: Math.round(Number(u.precio)), fecha: u.fecha, documento: u.documento } : null,
      ya_cargado: !!u && Math.abs(Math.round(Number(u.precio)) - precio) <= 1,
    };
  });
  let repetido = null;
  if (mismoArchivo) repetido = { motivo: "archivo", fecha: mismoArchivo.createdAt, usuario: mismoArchivo.usuario, proveedor: mismoArchivo.proveedor, documento: mismoArchivo.documento };
  if (!repetido && nombreProv && numero) {
    const d = await DocumentoCargado.findOne({ where: { proveedor: nombreProv, documento: numero }, order: [["id", "DESC"]] });
    const p = d ? null : await PrecioProveedor.findOne({ where: { proveedor: nombreProv, documento: numero }, order: [["id", "DESC"]], raw: true });
    if (d || p) repetido = { motivo: "numero", fecha: d?.createdAt || p?.createdAt, usuario: d?.usuario || p?.creado_por || null, proveedor: nombreProv, documento: numero };
  }
  const calzadas = lineas.filter((l) => l.producto && l.anterior);
  const iguales = lineas.filter((l) => l.ya_cargado).length;
  if (!repetido && calzadas.length >= 3 && iguales / Math.max(1, lineas.filter((l) => l.producto).length) >= 0.8) {
    repetido = { motivo: "precios", iguales, total: lineas.length, proveedor: nombreProv };
  }
  res.json({
    ok: true,
    data: {
      ...r,
      archivo: req.file.originalname, hash, repetido,
      proveedor_existente: prov ? { id: prov.id, nombre: prov.nombre, tipo: prov.tipo } : null,
      lineas,
    },
  });
});

// GET /api/ia/documentos-cargados?proveedor=&q=   -> últimos documentos de proveedores cargados al catálogo
// Los registrados desde ahora + los anteriores, armados desde el historial de precios (proveedor, N° y fecha)
const documentosCargados = handler(async (req, res) => {
  const DocumentoCargado = require("../models/DocumentoCargado");
  const prov = req.query.proveedor ? normProv(req.query.proveedor) : null;
  const q = String(req.query.q || "").trim();
  const [registrados] = await sequelize.query(`SELECT id, proveedor, documento, fecha, origen, productos, cambios, usuario, archivo, "createdAt" AS subido
    FROM documentos_cargados WHERE (:prov::text IS NULL OR proveedor = :prov) AND (:q = '' OR proveedor ILIKE :ql OR documento ILIKE :ql OR archivo ILIKE :ql)
    ORDER BY id DESC LIMIT 300`, { replacements: { prov, q, ql: `%${q}%` } });
  const [historial] = await sequelize.query(`SELECT pp.proveedor, pp.documento, pp.fecha, MIN(pp.origen) AS origen, COUNT(*)::int AS productos, MIN(pp.creado_por) AS usuario, MIN(pp."createdAt") AS subido
    FROM precios_proveedor pp
    WHERE pp.documento IS NOT NULL AND pp.documento <> '' AND (:prov::text IS NULL OR pp.proveedor = :prov) AND (:q = '' OR pp.proveedor ILIKE :ql OR pp.documento ILIKE :ql)
      AND NOT EXISTS (SELECT 1 FROM documentos_cargados d WHERE d.proveedor = pp.proveedor AND d.documento = pp.documento)
    GROUP BY pp.proveedor, pp.documento, pp.fecha ORDER BY MIN(pp."createdAt") DESC LIMIT 300`, { replacements: { prov, q, ql: `%${q}%` } });
  const lista = [...registrados.map((d) => ({ ...d, tipo: "registrado" })), ...historial.map((d) => ({ ...d, tipo: "historial", cambios: null }))]
    .sort((a, b) => new Date(b.subido) - new Date(a.subido)).slice(0, 300);
  void DocumentoCargado;
  const { arreglar } = require("../services/nombresArchivo");
  res.json({ ok: true, data: lista.map((d) => (d.archivo ? { ...d, archivo: arreglar(d.archivo) } : d)) });
});

// POST /api/ia/documentos-cargados/proveedor   { id? | proveedor, documento, fecha ; nuevo }
// Cambia el proveedor de los precios que cargó ese documento (ej. quedó "SIN IDENTIFICAR" y era TIGERO)
const cambiarProveedorDocumento = handler(async (req, res) => {
  const DocumentoCargado = require("../models/DocumentoCargado");
  const nuevo = normProv(req.body?.nuevo || "");
  if (!nuevo) throw new ErrorNegocio("Indica el proveedor");
  let prov = req.body?.proveedor ? normProv(req.body.proveedor) : null;
  let doc = String(req.body?.documento || "").trim() || null;
  let fecha = req.body?.fecha ? String(req.body.fecha).slice(0, 10) : null;
  let reg = null;
  if (req.body?.id) {
    reg = await DocumentoCargado.findByPk(req.body.id);
    if (!reg) throw new ErrorNegocio("Documento no encontrado", 404);
    prov = reg.proveedor; doc = reg.documento; fecha = reg.fecha;
  }
  if (!prov) throw new ErrorNegocio("Falta el proveedor actual del documento");
  const ids = await sequelize.transaction(async (t) => {
    // La ficha del proveedor nuevo (se crea si no existe)
    if (!(await Proveedor.findOne({ where: sequelize.where(sequelize.fn("upper", sequelize.col("nombre")), nuevo), transaction: t }))) await Proveedor.create({ nombre: nuevo }, { transaction: t });
    const [filas] = await sequelize.query(`UPDATE precios_proveedor SET proveedor = :nuevo
      WHERE UPPER(TRIM(proveedor)) = UPPER(TRIM(:prov)) AND ${doc ? "documento = :doc" : "documento IS NULL"} ${fecha ? "AND fecha::date = :fecha::date" : ""} RETURNING producto_id`,
    { replacements: { nuevo, prov, doc, fecha }, transaction: t });
    if (reg) await reg.update({ proveedor: nuevo }, { transaction: t });
    else await DocumentoCargado.update({ proveedor: nuevo }, { where: { proveedor: prov, documento: doc }, transaction: t });
    return [...new Set(filas.map((f) => f.producto_id))];
  });
  const { recalcular } = require("../services/precios");
  for (const id of ids) {
    await sequelize.transaction(async (t) => {
      const p = await Producto.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (p) await recalcular(p, { t, usuario: firma(req), motivo: `Documento ${doc || "sin N°"}: proveedor ${prov} → ${nuevo}` });
    });
  }
  res.json({ ok: true, data: { productos: ids.length, proveedor: nuevo } });
});

// GET /api/ia/documentos-cargados/detalle?id=  |  ?proveedor=&documento=&fecha=   -> productos y precios de ese documento
const detalleDocumento = handler(async (req, res) => {
  const DocumentoCargado = require("../models/DocumentoCargado");
  if (req.query.id) {
    const d = await DocumentoCargado.findByPk(req.query.id);
    if (!d) throw new ErrorNegocio("Documento no encontrado", 404);
    return res.json({ ok: true, data: { ...d.toJSON(), lineas: d.lineas } });
  }
  const [lineas] = await sequelize.query(`SELECT pp.producto_id, p.codigo, p.nombre, pp.precio::float AS precio, pp.descripcion_proveedor, pp.fecha
    FROM precios_proveedor pp LEFT JOIN productos p ON p.id = pp.producto_id
    WHERE pp.proveedor = :prov AND pp.documento = :doc ${req.query.fecha ? "AND pp.fecha = :fecha" : ""} ORDER BY p.nombre`,
  { replacements: { prov: req.query.proveedor || "", doc: req.query.documento || "", fecha: req.query.fecha || null } });
  res.json({ ok: true, data: { proveedor: req.query.proveedor, documento: req.query.documento, fecha: req.query.fecha, lineas } });
});

// POST /api/ia/documento-proveedor/aprobar
// { proveedor, documento, fecha, origen, lineas: [{ producto_id | nuevo:{nombre,categoria,unidad}, precio, descripcion_proveedor, marca, unidad, cantidad, calce }] }
// Guarda los precios en el historial y recalcula precio vigente, opciones y avisos de REVISAR.
const aprobarDocumento = handler(async (req, res) => {
  const b = req.body || {};
  const proveedor = normProv(b.proveedor);
  if (!proveedor) throw new ErrorNegocio("Indica el proveedor");
  if (require("../services/precios").esGenerico(proveedor)) throw new ErrorNegocio(`"${proveedor}" no es un proveedor: escribe el nombre real del proveedor del documento`);
  const lineas = (b.lineas || []).filter((l) => !l.omitir);
  if (!lineas.length) throw new ErrorNegocio("No hay líneas para guardar");

  const resumen = await sequelize.transaction(async (t) => {
    let ficha = await Proveedor.findOne({ where: sequelize.where(sequelize.fn("upper", sequelize.col("nombre")), proveedor), transaction: t });
    if (!ficha) ficha = await Proveedor.create({ nombre: proveedor, razon_social: b.razon_social || null, rut: b.rut || null, tipo: b.origen === "web" ? "web" : "proveedor" }, { transaction: t });
    const origen = b.origen || (await origenDe(proveedor, t));
    const out = { precios: 0, productos_nuevos: 0, cambios_precio: [] };
    let siguienteCodigo = (Number(await Producto.max("codigo", { transaction: t })) || 0) + 1;

    for (const l of lineas) {
      const precio = Math.round(Number(l.precio));
      if (!(precio > 0)) throw new ErrorNegocio(`Precio inválido en "${l.descripcion_proveedor || l.nuevo?.nombre || "línea"}"`);
      let p;
      if (l.producto_id) {
        p = await Producto.findByPk(l.producto_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!p) throw new ErrorNegocio(`Producto ${l.producto_id} no existe`, 404);
      } else if (l.nuevo?.nombre) {
        p = await Producto.create({
          codigo: siguienteCodigo++, nombre: String(l.nuevo.nombre).trim().toUpperCase(),
          categoria: esGerencia(req) ? String(l.nuevo.categoria || "POR CLASIFICAR").toUpperCase() : "POR CLASIFICAR",
          unidad: unidadDeProducto(l.nuevo.nombre, l.nuevo.unidad),
        }, { transaction: t });
        await registrar({ usuario: firma(req), tabla: "productos", registro_id: p.id, campo: "creado", despues: p.nombre, motivo: `Desde documento ${proveedor} ${b.documento || ""}`.trim() }, t);
        out.productos_nuevos++;
      } else continue;

      const antes = Number(p.precio_compra) || 0;
      await PrecioProveedor.create({
        producto_id: p.id, proveedor: ficha.nombre, precio, fecha: b.fecha || new Date(), documento: b.documento || null,
        descripcion_proveedor: l.descripcion_proveedor || null, marca: l.marca || null, unidad: l.unidad || null,
        cantidad: l.cantidad || null, calce: l.calce && l.calce !== "sin_producto" ? l.calce : null, origen, creado_por: firma(req),
      }, { transaction: t });
      await recalcular(p, { t, usuario: firma(req), motivo: `Documento ${ficha.nombre} ${b.documento || ""}`.trim() });
      out.precios++;
      if (Number(p.precio_compra) !== antes) out.cambios_precio.push({ codigo: p.codigo, nombre: p.nombre, antes, despues: Number(p.precio_compra), proveedor: p.proveedor });
      out.lineas_doc = out.lineas_doc || [];
      out.lineas_doc.push({ producto_id: p.id, codigo: p.codigo, nombre: p.nombre, precio, antes: l.antes != null ? Math.round(Number(l.antes)) : null });
    }
    // Registro del documento (para la lista de documentos cargados y el aviso de repetido)
    await require("../models/DocumentoCargado").create({
      hash: b.hash || null, archivo: b.archivo || null, proveedor: ficha.nombre, documento: b.documento || null, fecha: b.fecha || null, origen,
      productos: out.precios, cambios: (out.lineas_doc || []).filter((x) => x.antes == null || x.antes !== x.precio).length, lineas: out.lineas_doc || [], usuario: firma(req),
    }, { transaction: t });
    delete out.lineas_doc;
    return out;
  });
  res.json({ ok: true, data: resumen });
});

// GET /api/ia/auditoria   (últimas respuestas guardadas, solo admin)
const auditoria = handler(async (req, res) => {
  const data = await AuditoriaIA.findAll({ order: [["id", "DESC"]], limit: 50, attributes: { exclude: esAdmin(req) ? [] : ["respuesta"] } });
  res.json({ ok: true, data });
});

module.exports = { licitacion, estado, listaCliente, documentoProveedor, aprobarDocumento, documentosCargados, detalleDocumento, cambiarProveedorDocumento, auditoria, indiceCatalogo };
