const crypto = require("crypto");
const { firma, esGerencia } = require("../middlewares/auth");
const sequelize = require("../../config/database");
const OrdenCompra = require("../models/OrdenCompra");
const Proveedor = require("../models/Proveedor");
const Producto = require("../models/Producto");
const Venta = require("../models/Venta");
const Gasto = require("../models/Gasto");
const PrecioProveedor = require("../models/PrecioProveedor");
const DocumentoCompra = require("../models/DocumentoCompra");
const { handler, ErrorNegocio } = require("../services/erp");
const { recalcular, origenDe, normProv, registrar } = require("../services/precios");
const { unidadDeProducto } = require("../services/unidades");
const ia = require("../services/ia");

// "Subir factura de compra" (Operativo): Claude lee la factura del proveedor, se compara con nuestra compra
// (C-0001...) o se crea una compra nueva, y los precios entran al catálogo con la fecha de la factura.
const ALZA = 0.10; // más de 10% sobre el precio del catálogo: aviso a gerencia
const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const sumarDias = (f, n) => { const d = new Date(`${String(f).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10); };
const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const numeroCompra = (id) => `C-${String(id).padStart(4, "0")}`;

// Archivos leídos esperando que se registre la factura (30 min)
const pendientes = new Map();
const guardarPendiente = (file) => {
  const ahora = Date.now();
  for (const [k, x] of pendientes) if (ahora - x.t > 30 * 60e3) pendientes.delete(k);
  const token = crypto.randomUUID();
  pendientes.set(token, { buf: file.buffer, nombre: file.originalname, mime: file.mimetype || "application/pdf", t: ahora });
  return token;
};

// Precio de una factura al catálogo: historial con la fecha de la factura, reglas de siempre y aviso de alza (> 10%)
async function precioDesdeFactura(p, { proveedor, precio, fecha, documento, cantidad, unidad, descripcion, marca, calce, origen, usuario, motivo }, t) {
  const antes = Number(p.precio_compra) || 0;
  await PrecioProveedor.create({
    producto_id: p.id, proveedor, precio: Math.round(precio), fecha: fecha || hoyISO(), documento, cantidad: cantidad || null, unidad: unidad || null,
    descripcion_proveedor: descripcion || null, marca: marca || null, calce: calce && calce !== "sin_producto" ? calce : null, origen, creado_por: usuario,
  }, { transaction: t });
  await recalcular(p, { t, usuario, motivo });
  let alza = null;
  if (antes > 0 && precio > antes * (1 + ALZA)) {
    const pct = Math.round((precio / antes - 1) * 100);
    alza = { producto_id: p.id, codigo: p.codigo, nombre: p.nombre, antes, ahora: Math.round(precio), pct, proveedor };
    const aviso = `ALZA ${pct}% ${proveedor} ${documento || ""} (${pesos(precio)} vs ${pesos(antes)})`.replace(/\s+/g, " ");
    await p.update({ revisar: [aviso, p.revisar].filter(Boolean).join(" | ").slice(0, 1000) }, { transaction: t });
    await registrar({ usuario, tabla: "productos", registro_id: p.id, campo: "alza", antes: String(antes), despues: String(Math.round(precio)), motivo: `Alza ${pct}% en ${documento || "factura"} de ${proveedor}` }, t);
  }
  return { antes, despues: Number(p.precio_compra) || 0, alza };
}

// POST /api/ordenes-compra/factura/leer   (multipart: archivo, orden_id opcional)
const leer = handler(async (req, res) => {
  if (!req.file) throw new ErrorNegocio("Adjunta la factura (PDF o foto)");
  const { indiceCatalogo } = require("./iaController");
  const { indice, productos } = await indiceCatalogo();
  const r = await ia.leerDocumentoProveedor(req.file, indice, firma(req));
  const ordenId = Number(req.body?.orden_id) || null;
  const orden = ordenId ? await OrdenCompra.findByPk(ordenId) : null;
  if (ordenId && !orden) throw new ErrorNegocio("Compra no encontrada", 404);
  // Subida desde el cuadro de compra de una venta: cada producto se calza con las líneas de la venta
  const ventaId = Number(req.body?.venta_id) || null;
  const venta = ventaId ? await Venta.findByPk(ventaId, { attributes: ["id", "numero", "items", "empresa"] }) : null;
  const usadosVenta = new Set();

  const ver = (p) => (p ? { id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, precio_compra: Number(p.precio_compra) || 0, proveedor: p.proveedor } : null);
  const usados = new Set();
  const lineas = r.lineas.map((l, i) => {
    const prod = l.producto_id ? productos.get(l.producto_id) : null;
    let pedido = null;
    if (orden) {
      const k = orden.items.findIndex((it, j) => !usados.has(j) && prod && it.producto_id === prod.id);
      if (k >= 0) { usados.add(k); pedido = { cantidad: Number(orden.items[k].cantidad), precio: Number(orden.items[k].precio) }; }
    }
    const precio = Number(l.precio_neto) || 0;
    const antes = Number(prod?.precio_compra) || 0;
    let venta_indice = null;
    if (venta && prod) {
      const k = venta.items.findIndex((it, j) => !usadosVenta.has(j) && it.producto_id === prod.id);
      if (k >= 0) { usadosVenta.add(k); venta_indice = k; }
    }
    return {
      venta_indice, venta_linea: venta_indice != null ? { nombre: venta.items[venta_indice].nombre, cantidad: Number(venta.items[venta_indice].cantidad) } : null,
      i, descripcion: l.descripcion, codigo_proveedor: l.codigo_proveedor, marca: l.marca, unidad: l.unidad, cantidad: l.cantidad,
      precio_neto: precio, total_linea: l.total_linea, calce: l.calce, nota: l.nota,
      producto: ver(prod), candidatos: (l.candidatos || []).slice(0, 6).map(ver),
      pedido,
      diferencia: orden ? (!pedido ? "No estaba en la compra" : [
        Math.abs(pedido.precio - precio) > Math.max(1, pedido.precio * 0.01) ? `precio ${pesos(pedido.precio)} → ${pesos(precio)}` : null,
        Number(pedido.cantidad) !== Number(l.cantidad) ? `cantidad ${pedido.cantidad} → ${l.cantidad}` : null,
      ].filter(Boolean).join(" · ") || null) : null,
      alza: antes > 0 && precio > antes * (1 + ALZA) ? Math.round((precio / antes - 1) * 100) : null,
    };
  });
  const faltan = orden ? orden.items.filter((_, j) => !usados.has(j)).map((it) => ({ nombre: it.nombre, cantidad: Number(it.cantidad), precio: Number(it.precio) })) : [];

  // Proveedor y compras pendientes del mismo proveedor (para asociar la factura)
  const e = r.encabezado;
  const prov = e.proveedor ? await Proveedor.findOne({ where: sequelize.where(sequelize.fn("upper", sequelize.col("nombre")), normProv(e.proveedor)) }) : null;
  const { Op } = require("sequelize");
  const donde = venta
    ? { estado: "borrador", [Op.or]: [{ venta_id: venta.id }, ...(prov ? [{ proveedor_id: prov.id }] : [])] }
    : prov ? { proveedor_id: prov.id, estado: "borrador" } : null;
  const sugeridas = !orden && donde ? await OrdenCompra.findAll({ where: donde, attributes: ["id", "numero", "fecha", "total", "venta_id", "proveedor_nombre"], order: [["id", "DESC"]], limit: 15, raw: true }) : [];
  const neto = lineas.reduce((s, l) => s + Math.round(l.precio_neto * l.cantidad), 0);
  res.json({
    ok: true,
    data: {
      archivo_token: guardarPendiente(req.file), archivo: req.file.originalname,
      encabezado: { ...e, proveedor: prov?.nombre || e.proveedor },
      proveedor_existente: prov ? { id: prov.id, nombre: prov.nombre } : null,
      control: r.control, truncado: r.truncado, lineas, faltan, sugeridas,
      totales: { neto, iva: Math.round(neto * 0.19), total: neto + Math.round(neto * 0.19) },
      orden: orden ? { id: orden.id, numero: orden.numero, total: Number(orden.total), estado: orden.estado, documento: orden.documento } : null,
      venta: venta ? { id: venta.id, numero: venta.numero, empresa: venta.empresa } : null,
    },
  });
});

// POST /api/ordenes-compra/factura/registrar
// { archivo_token, orden_id | null, venta_id, gasto_id, proveedor, documento, fecha, empresa, neto, iva, total,
//   lineas: [{ producto_id | nuevo: { nombre, unidad, categoria }, descripcion, cantidad, precio, unidad, marca, calce }] }
const registrarFactura = handler(async (req, res) => {
  const b = req.body || {};
  const proveedor = normProv(b.proveedor);
  if (!proveedor) throw new ErrorNegocio("Indica el proveedor");
  const boleta = b.tipo_documento === "boleta";
  const folio = String(b.documento || "").trim() || (boleta ? "S/N" : "");
  if (!folio) throw new ErrorNegocio("Indica el N° de factura");
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || "") ? b.fecha : hoyISO();
  const lineas = (b.lineas || []).filter((l) => (l.producto_id || l.nuevo?.nombre) && Number(l.precio) > 0 && Number(l.cantidad) > 0);
  if (!lineas.length) throw new ErrorNegocio("No hay líneas con producto, cantidad y precio");
  if (b.gasto_id && !esGerencia(req)) throw new ErrorNegocio("Solo gerencia puede pasar un gasto a compra", 403);
  const usuario = firma(req);
  const doc = `${boleta ? "BOL." : "FACT."} ${folio}`;

  const out = await sequelize.transaction(async (t) => {
    // Proveedor
    let ficha = await Proveedor.findOne({ where: sequelize.where(sequelize.fn("upper", sequelize.col("nombre")), proveedor), transaction: t });
    if (!ficha) ficha = await Proveedor.create({ nombre: proveedor, razon_social: b.razon_social || null, rut: b.rut || null, tipo: "proveedor" }, { transaction: t });
    const origen = await origenDe(ficha.nombre, t);
    const resumen = { precios: 0, productos_nuevos: 0, cambios_precio: [], alzas: [] };

    // Productos (los nuevos quedan POR CLASIFICAR)
    let siguiente = (Number(await Producto.max("codigo", { transaction: t })) || 0) + 1;
    const items = [];
    for (const l of lineas) {
      let p;
      if (l.producto_id) {
        p = await Producto.findByPk(l.producto_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!p) throw new ErrorNegocio(`Producto ${l.producto_id} no existe`, 404);
      } else {
        p = await Producto.create({
          codigo: siguiente++, nombre: String(l.nuevo.nombre).trim().toUpperCase(),
          categoria: esGerencia(req) && l.nuevo.categoria ? String(l.nuevo.categoria).toUpperCase() : "POR CLASIFICAR",
          unidad: unidadDeProducto(l.nuevo.nombre, l.nuevo.unidad || l.unidad), revisar: `Agregado desde ${doc} ${proveedor} por ${usuario}`.slice(0, 250),
        }, { transaction: t });
        await registrar({ usuario, tabla: "productos", registro_id: p.id, campo: "creado", despues: p.nombre, motivo: `Desde ${doc} ${proveedor}` }, t);
        resumen.productos_nuevos++;
      }
      items.push({ p, l });
    }
    const itemsOrden = items.map(({ p, l }) => ({ producto_id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: Number(l.cantidad), precio: Math.round(Number(l.precio)) }));
    const netoLineas = itemsOrden.reduce((s, i) => s + i.precio * i.cantidad, 0);
    let neto = Number(b.neto) > 0 ? Math.round(Number(b.neto)) : netoLineas;
    let iva = Number(b.iva) >= 0 && b.iva !== "" && b.iva != null ? Math.round(Number(b.iva)) : Math.round(neto * 0.19);
    const total = Number(b.total) > 0 ? Math.round(Number(b.total)) : neto + iva;
    // Boleta: no da crédito de IVA, así que el costo de la compra es el total pagado
    if (boleta) { neto = total; iva = 0; }
    const vence = sumarDias(fecha, ficha.plazo_pago_dias || 0);

    // Compra: la que ya existía (se completa con la factura y queda recibida) o una nueva
    let orden;
    const ventaId = Number(b.venta_id) || null;
    const venta = ventaId ? await Venta.findByPk(ventaId, { transaction: t, attributes: ["id", "empresa"] }) : null;
    const empresa = ["kenott", "tactics"].includes(b.empresa) ? b.empresa : venta?.empresa || null;
    if (b.orden_id) {
      orden = await OrdenCompra.findByPk(b.orden_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!orden) throw new ErrorNegocio("Compra no encontrada", 404);
      if (orden.estado === "anulada") throw new ErrorNegocio("La compra está anulada");
      await orden.update({
        proveedor_id: ficha.id, proveedor_nombre: ficha.nombre, items: itemsOrden, subtotal: neto, iva, total,
        documento: boleta ? `BOL ${folio}` : folio, fecha_factura: fecha, empresa: empresa || orden.empresa,
        estado: "recibida", fecha_recepcion: orden.fecha_recepcion || new Date(),
        fecha_vencimiento: orden.fecha_vencimiento || vence,
        ...(venta ? { venta_id: venta.id } : {}),
      }, { transaction: t });
    } else {
      orden = await OrdenCompra.create({
        proveedor_id: ficha.id, proveedor_nombre: ficha.nombre, venta_id: venta?.id || null, fecha,
        items: itemsOrden, subtotal: neto, iva, total, documento: boleta ? `BOL ${folio}` : folio, fecha_factura: fecha, empresa,
        estado: "recibida", fecha_recepcion: new Date(), fecha_vencimiento: vence,
        notas: b.gasto_id ? "Registrada desde Gastos (compra de materiales)" : `Registrada desde la ${boleta ? "boleta" : "factura"} del proveedor`, creado_por: usuario,
      }, { transaction: t });
      await orden.update({ numero: numeroCompra(orden.id) }, { transaction: t });
    }

    // Precios al catálogo con la fecha de la factura
    for (const { p, l } of items) {
      const r = await precioDesdeFactura(p, {
        proveedor: ficha.nombre, precio: Number(l.precio), fecha, documento: doc, cantidad: l.cantidad, unidad: l.unidad,
        descripcion: l.descripcion, marca: l.marca, calce: l.calce, origen, usuario, motivo: `${doc} ${ficha.nombre} (${orden.numero})`,
      }, t);
      resumen.precios++;
      if (r.antes !== r.despues) resumen.cambios_precio.push({ codigo: p.codigo, nombre: p.nombre, antes: r.antes, despues: r.despues, proveedor: p.proveedor });
      if (r.alza) resumen.alzas.push(r.alza);
    }

    // Venía de Gastos: el gasto se reemplaza por esta compra (para no contarlo dos veces)
    if (b.gasto_id) {
      const g = await Gasto.findByPk(b.gasto_id, { transaction: t });
      if (g) {
        await registrar({ usuario, tabla: "gastos", registro_id: g.id, campo: "pasado_a_compra", antes: `${g.descripcion || ""} ${pesos(g.monto)}`, despues: orden.numero, motivo: "Era compra de materiales" }, t);
        await g.destroy({ transaction: t });
      }
    }

    // PDF guardado en la compra
    const archivo = b.archivo_token ? pendientes.get(b.archivo_token) : null;
    if (archivo) {
      await DocumentoCompra.create({ orden_id: orden.id, folio, fecha, monto: total, nombre_archivo: archivo.nombre, mime: archivo.mime, datos: archivo.buf, creado_por: usuario }, { transaction: t });
      pendientes.delete(b.archivo_token);
    }
    return { orden, resumen };
  });
  res.json({ ok: true, data: { orden: out.orden, ...out.resumen } });
});

// POST /api/ordenes-compra/factura/gasto
// { archivo_token, venta_id, tipo, descripcion, proveedor, documento, tipo_documento, fecha, empresa, total, iva }
// Un documento que no es mercadería (flete, combustible, peajes, otros) queda como gasto de la venta, con su archivo.
const registrarGasto = handler(async (req, res) => {
  const b = req.body || {};
  const total = Math.round(Number(b.total) || 0);
  if (!(total > 0)) throw new ErrorNegocio("Indica el monto total del documento");
  const boleta = b.tipo_documento === "boleta";
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || "") ? b.fecha : hoyISO();
  const venta = Number(b.venta_id) ? await Venta.findByPk(Number(b.venta_id), { attributes: ["id", "numero", "empresa"] }) : null;
  const TIPOS = ["flete", "combustible", "comision", "general"];
  const usuario = firma(req);
  const folio = String(b.documento || "").trim();
  const g = await sequelize.transaction(async (t) => {
    const gasto = await Gasto.create({
      fecha, tipo: TIPOS.includes(b.tipo) ? b.tipo : "general", monto: total,
      iva: boleta ? 0 : Number(b.iva) >= 0 && b.iva !== "" && b.iva != null ? Math.round(Number(b.iva)) : Math.round(total - total / 1.19),
      descripcion: [String(b.descripcion || "").trim(), b.proveedor ? normProv(b.proveedor) : null].filter(Boolean).join(" · ").slice(0, 250) || "Gasto",
      venta_id: venta?.id || null, empresa: ["kenott", "tactics"].includes(b.empresa) ? b.empresa : venta?.empresa || null,
      comprobante: folio ? `${boleta ? "BOL" : "FACT"} ${folio}`.slice(0, 100) : null, creado_por: usuario,
    }, { transaction: t });
    const archivo = b.archivo_token ? pendientes.get(b.archivo_token) : null;
    if (archivo) {
      await DocumentoCompra.create({ gasto_id: gasto.id, folio: folio || null, fecha, monto: total, nombre_archivo: archivo.nombre, mime: archivo.mime, datos: archivo.buf, creado_por: usuario }, { transaction: t });
      pendientes.delete(b.archivo_token);
    }
    await registrar({ usuario, tabla: "gastos", registro_id: gasto.id, campo: "creado", despues: `${gasto.descripcion} ${pesos(total)}`, motivo: venta ? `Gasto de la venta ${venta.numero}` : "Gasto" }, t);
    return gasto;
  });
  res.status(201).json({ ok: true, data: g });
});

// GET /api/ordenes-compra/gastos/:gastoId/documento   — el archivo de un gasto
const descargarGasto = handler(async (req, res) => {
  const d = await DocumentoCompra.findOne({ where: { gasto_id: req.params.gastoId }, order: [["id", "DESC"]] });
  if (!d) throw new ErrorNegocio("Documento no encontrado", 404);
  res.setHeader("Content-Type", d.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(d.nombre_archivo)}"`);
  res.end(d.datos);
});

// GET /api/ordenes-compra/:id/documentos/:docId
const descargar = handler(async (req, res) => {
  const d = await DocumentoCompra.findOne({ where: { id: req.params.docId, orden_id: req.params.id } });
  if (!d) throw new ErrorNegocio("Documento no encontrado", 404);
  res.setHeader("Content-Type", d.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(d.nombre_archivo)}"`);
  res.end(d.datos);
});

module.exports = { leer, registrarFactura, registrarGasto, descargar, descargarGasto, precioDesdeFactura };
