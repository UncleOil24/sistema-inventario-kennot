// Una factura o boleta puede cubrir productos de varias ventas (ej. 9 rodillos: 4 para V-0004, 3 para V-0006 y 2 para V-0009).
// Aquí se busca qué ventas necesitan cada producto, se propone el reparto y se divide la factura en una compra por venta
// (mismo N° de factura, IVA repartido en proporción; la suma de las partes da exacto el total).
const { Op } = require("sequelize");
const Venta = require("../models/Venta");
const OrdenCompra = require("../models/OrdenCompra");
const { estadoLineas, stockDe } = require("./cuadroCompra");

// producto_id -> [{ venta_id, numero, cliente, falta }]  (lo que aún no se recibe, sin contar lo de stock)
// Orden: primero la venta desde la que se sube el documento, después las más antiguas
async function pendientesPorProducto(productoIds, ventaPrimero = null, { excluirOrdenId = null } = {}) {
  const ids = new Set(productoIds.filter(Boolean).map(Number));
  const out = new Map();
  if (!ids.size) return out;
  const ventas = await Venta.findAll({ where: { estado: { [Op.ne]: "anulada" }, etapa: ["registrada", "aceptada"] }, order: [["id", "ASC"]] });
  const conProducto = ventas.filter((v) => (v.items || []).some((i) => ids.has(Number(i.producto_id))));
  if (ventaPrimero) conProducto.sort((a, b) => (b.id === Number(ventaPrimero)) - (a.id === Number(ventaPrimero)) || a.id - b.id);
  const ordenes = conProducto.length ? await OrdenCompra.findAll({ where: { venta_id: conProducto.map((v) => v.id), estado: { [Op.ne]: "anulada" } } }) : [];
  for (const v of conProducto) {
    // La compra que se está registrando no cuenta como "pedida" (es justamente esta factura)
    const suyas = ordenes.filter((o) => o.venta_id === v.id && o.id !== excluirOrdenId && o.estado === "recibida");
    const est = estadoLineas(v.items, suyas);
    const porProd = new Map();
    v.items.forEach((i, k) => {
      const pid = Number(i.producto_id);
      if (!ids.has(pid)) return;
      const falta = Math.max(0, Number(i.cantidad) - stockDe(i) - (est[k].recibido || 0));
      if (falta > 0) porProd.set(pid, (porProd.get(pid) || 0) + falta);
    });
    for (const [pid, falta] of porProd) {
      if (!out.has(pid)) out.set(pid, []);
      out.get(pid).push({ venta_id: v.id, numero: v.numero, cliente: v.cliente_nombre, falta });
    }
  }
  return out;
}

// Reparto propuesto: se cubre lo que falta en el orden de la lista; lo que sobra va a la primera (o a la venta actual)
function repartoInicial(cantidad, candidatos = [], ventaActual = null) {
  let resto = Number(cantidad) || 0;
  const r = [];
  for (const c of candidatos) {
    if (resto <= 0) break;
    const usa = Math.min(resto, c.falta);
    r.push({ venta_id: c.venta_id, cantidad: usa }); resto -= usa;
  }
  if (resto > 0) {
    const destino = ventaActual ? Number(ventaActual) : r[0]?.venta_id || candidatos[0]?.venta_id || null;
    const x = r.find((y) => y.venta_id === destino);
    if (x) x.cantidad += resto; else r.push({ venta_id: destino, cantidad: resto });
  }
  return r;
}

// Divide las líneas en partes por venta. lineas: [{ ...item, reparto?: [{ venta_id|null, cantidad }] }]
// Devuelve [{ venta_id, items, neto, iva, total }] con la parte principal primero.
function dividir(lineas, { neto, iva, total, principal = null, ventaPorDefecto = null }) {
  const partes = new Map();
  const agregar = (vid, it) => { const k = vid ? Number(vid) : 0; if (!partes.has(k)) partes.set(k, []); partes.get(k).push(it); };
  for (const l of lineas) {
    const { reparto, ...it } = l;
    const rep = (Array.isArray(reparto) ? reparto : []).filter((r) => Number(r.cantidad) > 0);
    const suma = rep.reduce((s, r) => s + Number(r.cantidad), 0);
    if (!rep.length || Math.abs(suma - Number(it.cantidad)) > 1e-6) { agregar(ventaPorDefecto, it); continue; }
    for (const r of rep) agregar(r.venta_id, { ...it, cantidad: Number(r.cantidad) });
  }
  const netoLineas = [...partes.values()].flat().reduce((s, i) => s + i.precio * i.cantidad, 0) || 1;
  const claves = [...partes.keys()].sort((a, b) => (b === Number(principal || 0)) - (a === Number(principal || 0)) || a - b);
  let restoN = neto, restoI = iva, restoT = total;
  return claves.map((k, n) => {
    const items = partes.get(k);
    const ultimo = n === claves.length - 1;
    const prop = items.reduce((s, i) => s + i.precio * i.cantidad, 0) / netoLineas;
    const pN = ultimo ? restoN : Math.round(neto * prop), pI = ultimo ? restoI : Math.round(iva * prop), pT = ultimo ? restoT : Math.round(total * prop);
    restoN -= pN; restoI -= pI; restoT -= pT;
    return { venta_id: k || null, items, neto: pN, iva: pI, total: pT };
  });
}

module.exports = { pendientesPorProducto, repartoInicial, dividir };
