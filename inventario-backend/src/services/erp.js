// Lógica compartida del ERP: stock, totales y estado de pago.
const Producto = require("../models/Producto");
const MovimientoStock = require("../models/MovimientoStock");

const IVA = 0.19;

class ErrorNegocio extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Calcula subtotal / IVA / total a partir de items [{ cantidad, precio }]
const calcularTotales = (items) => {
  const subtotal = items.reduce((s, i) => s + Number(i.precio) * Number(i.cantidad), 0);
  const iva = Math.round(subtotal * IVA);
  return { subtotal, iva, total: subtotal + iva };
};

// Limpia y valida items que vienen del frontend
const normalizarItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) throw new ErrorNegocio("Debe incluir al menos un producto");
  return items.map((i) => {
    const producto_id = Number(i.producto_id ?? i.id);
    const cantidad = Math.trunc(Number(i.cantidad));
    const precio = Number(i.precio);
    if (!producto_id) throw new ErrorNegocio(`Producto inválido: ${i.nombre || "(sin nombre)"}`);
    if (!(cantidad > 0)) throw new ErrorNegocio(`Cantidad inválida para ${i.nombre || producto_id}`);
    if (!(precio >= 0)) throw new ErrorNegocio(`Precio inválido para ${i.nombre || producto_id}`);
    return { producto_id, nombre: i.nombre, unidad: i.unidad, cantidad, precio };
  });
};

// Bloquea (SELECT ... FOR UPDATE) los productos involucrados para que dos ventas
// simultáneas no descuenten el mismo stock. Devuelve un Map id -> producto.
const bloquearProductos = async (ids, t) => {
  const unicos = [...new Set(ids)];
  const productos = await Producto.findAll({
    where: { id: unicos },
    lock: t.LOCK.UPDATE,
    transaction: t,
    order: [["id", "ASC"]],
  });
  const mapa = new Map(productos.map((p) => [p.id, p]));
  const faltantes = unicos.filter((id) => !mapa.has(id));
  if (faltantes.length) throw new ErrorNegocio(`Productos no encontrados: ${faltantes.join(", ")}`, 404);
  return mapa;
};

// Mueve stock y deja registro en el kardex. delta > 0 entra, delta < 0 sale.
const moverStock = async (producto, delta, info, t) => {
  const anterior = Number(producto.stock);
  const resultante = anterior + delta;
  if (resultante < 0) {
    throw new ErrorNegocio(
      `Stock insuficiente de "${producto.nombre}": hay ${anterior}, se necesitan ${-delta}`
    );
  }
  await producto.update({ stock: resultante }, { transaction: t });
  await MovimientoStock.create({
    producto_id: producto.id,
    producto_nombre: producto.nombre,
    tipo: info.tipo || (delta >= 0 ? "entrada" : "salida"),
    cantidad: delta,
    stock_anterior: anterior,
    stock_resultante: resultante,
    costo_unitario: info.costo_unitario ?? producto.precio_compra,
    referencia_tipo: info.referencia_tipo,
    referencia_id: info.referencia_id,
    referencia_numero: info.referencia_numero,
    nota: info.nota,
    creado_por: info.creado_por,
  }, { transaction: t });
};

const estadoPago = (pagado, total) => {
  if (Number(pagado) <= 0) return "pendiente";
  if (Number(pagado) + 0.5 >= Number(total)) return "pagada";
  return "parcial";
};

const sumarDias = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + Number(dias));
  return d.toISOString().slice(0, 10);
};

// Wrapper para que cada handler responda errores de forma uniforme
const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    const status = error.status || (error.name === "SequelizeValidationError" ? 400 : 500);
    if (status >= 500) console.error(error);
    res.status(status).json({ ok: false, error: error.message });
  }
};

module.exports = {
  IVA, ErrorNegocio, calcularTotales, normalizarItems, bloquearProductos,
  moverStock, estadoPago, sumarDias, handler,
};
