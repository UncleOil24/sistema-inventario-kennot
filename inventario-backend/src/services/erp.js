// Lógica compartida del ERP: totales, estado de pago y manejo de errores.

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
    const cantidad = Number(i.cantidad); // admite decimales (metros, kilos)
    const precio = Number(i.precio);
    if (!producto_id) throw new ErrorNegocio(`Producto inválido: ${i.nombre || "(sin nombre)"}`);
    if (!(cantidad > 0)) throw new ErrorNegocio(`Cantidad inválida para ${i.nombre || producto_id}`);
    if (!(precio >= 0)) throw new ErrorNegocio(`Precio inválido para ${i.nombre || producto_id}`);
    return { ...i, producto_id, cantidad, precio };
  });
};

const redondear = (n) => Math.round(Number(n) || 0);

const estadoPago = (pagado, total) => {
  if (Number(pagado) <= 0) return "pendiente";
  if (Number(pagado) + 0.5 >= Number(total)) return "pagada";
  return "parcial";
};

// Hoy (en Chile) + días, como "AAAA-MM-DD"
const sumarDias = (dias) => {
  const [y, m, d] = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" }).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + Number(dias))).toISOString().slice(0, 10);
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
  IVA, ErrorNegocio, calcularTotales, normalizarItems, estadoPago, sumarDias, handler, redondear,
};
