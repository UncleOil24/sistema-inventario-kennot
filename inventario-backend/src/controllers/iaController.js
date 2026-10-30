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
const { esAdmin } = require("../middlewares/auth");

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
const listaCliente = handler(async (req, res) => {
  const { indice, productos } = await indiceCatalogo();
  const r = await ia.leerListaCliente(req.file, indice, req.usuario.nombre);
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
  if (!l.detalle_cargado) await require("../services/mercadoPublico").cargarDetalle(l);
  if (!l.items?.length) throw new ErrorNegocio("Esta licitación no trae productos detallados: cotízala a mano");
  const lineas = l.items.map((i) => {
    const extra = i.descripcion && sinTildes(i.descripcion) !== sinTildes(i.producto) ? ` - ${String(i.descripcion).slice(0, 160)}` : "";
    return { descripcion: `${i.producto}${extra}`.trim(), cantidad: Number(i.cantidad) || 1, unidad: i.unidad || "" };
  });
  const { indice, productos } = await indiceCatalogo();
  const calzadas = await ia.calzarLineas(lineas, indice, { usuario: req.usuario.nombre, tipo: "licitacion", archivo: l.codigo });
  const ver = vista(req, await getParametros());
  res.json({
    ok: true,
    data: {
      archivo: `Licitación ${l.codigo}`, cliente: l.organismo || "", observaciones: l.nombre,
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
  const { indice, productos } = await indiceCatalogo();
  const r = await ia.leerDocumentoProveedor(req.file, indice, req.usuario.nombre);
  const ver = vista(req, await getParametros());
  const prov = r.encabezado.proveedor
    ? await Proveedor.findOne({ where: sequelize.where(sequelize.fn("upper", sequelize.col("nombre")), r.encabezado.proveedor) })
    : null;
  res.json({
    ok: true,
    data: {
      ...r,
      archivo: req.file.originalname,
      proveedor_existente: prov ? { id: prov.id, nombre: prov.nombre, tipo: prov.tipo } : null,
      lineas: r.lineas.map((l) => ({
        descripcion: l.descripcion, codigo_proveedor: l.codigo_proveedor, marca: l.marca, unidad: l.unidad, cantidad: l.cantidad,
        precio_neto: l.precio_neto, total_linea: l.total_linea, calce: l.calce, nota: l.nota,
        producto: l.producto_id ? ver(productos.get(l.producto_id)) : null,
        candidatos: l.candidatos.slice(0, 6).map((p) => ver(p)),
      })),
    },
  });
});

// POST /api/ia/documento-proveedor/aprobar
// { proveedor, documento, fecha, origen, lineas: [{ producto_id | nuevo:{nombre,categoria,unidad}, precio, descripcion_proveedor, marca, unidad, cantidad, calce }] }
// Guarda los precios en el historial y recalcula precio vigente, opciones y avisos de REVISAR.
const aprobarDocumento = handler(async (req, res) => {
  const b = req.body || {};
  const proveedor = normProv(b.proveedor);
  if (!proveedor) throw new ErrorNegocio("Indica el proveedor");
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
          categoria: String(l.nuevo.categoria || "General").toUpperCase(), unidad: String(l.nuevo.unidad || "UNIDAD").toUpperCase(),
        }, { transaction: t });
        await registrar({ usuario: req.usuario.nombre, tabla: "productos", registro_id: p.id, campo: "creado", despues: p.nombre, motivo: `Desde documento ${proveedor} ${b.documento || ""}`.trim() }, t);
        out.productos_nuevos++;
      } else continue;

      const antes = Number(p.precio_compra) || 0;
      await PrecioProveedor.create({
        producto_id: p.id, proveedor: ficha.nombre, precio, fecha: b.fecha || new Date(), documento: b.documento || null,
        descripcion_proveedor: l.descripcion_proveedor || null, marca: l.marca || null, unidad: l.unidad || null,
        cantidad: l.cantidad || null, calce: l.calce && l.calce !== "sin_producto" ? l.calce : null, origen, creado_por: req.usuario.nombre,
      }, { transaction: t });
      await recalcular(p, { t, usuario: req.usuario.nombre, motivo: `Documento ${ficha.nombre} ${b.documento || ""}`.trim() });
      out.precios++;
      if (Number(p.precio_compra) !== antes) out.cambios_precio.push({ codigo: p.codigo, nombre: p.nombre, antes, despues: Number(p.precio_compra), proveedor: p.proveedor });
    }
    return out;
  });
  res.json({ ok: true, data: resumen });
});

// GET /api/ia/auditoria   (últimas respuestas guardadas, solo admin)
const auditoria = handler(async (req, res) => {
  const data = await AuditoriaIA.findAll({ order: [["id", "DESC"]], limit: 50, attributes: { exclude: esAdmin(req) ? [] : ["respuesta"] } });
  res.json({ ok: true, data });
});

module.exports = { licitacion, estado, listaCliente, documentoProveedor, aprobarDocumento, auditoria };
