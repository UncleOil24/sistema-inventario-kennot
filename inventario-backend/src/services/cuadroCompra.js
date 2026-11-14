// Cuadro de compra de una venta: todos los materiales en una tabla, con quién conviene comprar cada uno
// (sugerencias "más barato" y "menos proveedores") y en qué va cada línea (por comprar, pedida, comprada).
const PrecioProveedor = require("../models/PrecioProveedor");
const Proveedor = require("../models/Proveedor");
const { vigentesPorProveedor, normProv, REFERENCIA } = require("./precios");

const TOLERANCIA = 0.10; // "Menos proveedores": se junta en un proveedor si cuesta hasta 10% más que el más barato
const SIN = "SIN PROVEEDOR";

// Precio vigente de cada proveedor para cada producto (el más reciente de cada proveedor), del más barato al más caro.
// No entran los proveedores excluidos ni los precios de referencia (OC de cliente, factura sin proveedor).
async function opcionesPorProducto(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  const [precios, excluidos] = await Promise.all([
    PrecioProveedor.findAll({ where: { producto_id: unicos, descartado: false }, raw: true }),
    Proveedor.findAll({ where: { excluido: true }, attributes: ["nombre"], raw: true }),
  ]);
  const fuera = new Set(excluidos.map((p) => normProv(p.nombre)));
  const porProd = new Map();
  for (const p of precios) {
    if (REFERENCIA.includes(p.origen) || fuera.has(normProv(p.proveedor)) || !(Number(p.precio) > 0)) continue;
    if (!porProd.has(p.producto_id)) porProd.set(p.producto_id, []);
    porProd.get(p.producto_id).push(p);
  }
  const out = new Map();
  for (const [id, lista] of porProd) {
    out.set(id, vigentesPorProveedor(lista).map((p) => ({ proveedor: normProv(p.proveedor), precio: Math.round(Number(p.precio)), fecha: String(p.fecha).slice(0, 10) })));
  }
  return out;
}

// Sugerencias para todas las líneas. lineas: [{ indice, cantidad, opciones: [{proveedor, precio}] }]
// "barato": cada línea con su proveedor más barato.
// "menos": se eligen pocos proveedores: cada línea puede ir a un proveedor que cueste hasta 10% más que su mejor
// precio; se toma primero el proveedor que cubre más líneas (y, en empate, el que suma menos), y así sucesivamente.
function sugerir(lineas, tolerancia = TOLERANCIA) {
  const conPrecio = lineas.filter((l) => l.opciones.length);
  const barato = conPrecio.map((l) => ({ indice: l.indice, ...l.opciones[0] }));

  const elegibles = new Map(); // indice -> Map(proveedor -> precio)
  for (const l of conPrecio) {
    const tope = l.opciones[0].precio * (1 + tolerancia);
    elegibles.set(l.indice, new Map(l.opciones.filter((o) => o.precio <= tope + 0.5).map((o) => [o.proveedor, o.precio])));
  }
  const sinCubrir = new Set(conPrecio.map((l) => l.indice));
  const cant = new Map(conPrecio.map((l) => [l.indice, Number(l.cantidad) || 0]));
  const menos = [];
  while (sinCubrir.size) {
    const puntaje = new Map(); // proveedor -> { n, total }
    for (const i of sinCubrir) {
      for (const [prov, precio] of elegibles.get(i)) {
        const x = puntaje.get(prov) || { n: 0, total: 0 };
        x.n += 1; x.total += precio * cant.get(i);
        puntaje.set(prov, x);
      }
    }
    const [mejor] = [...puntaje.entries()].sort((a, b) => b[1].n - a[1].n || a[1].total - b[1].total);
    for (const i of [...sinCubrir]) {
      const precio = elegibles.get(i).get(mejor[0]);
      if (precio != null) { menos.push({ indice: i, proveedor: mejor[0], precio }); sinCubrir.delete(i); }
    }
  }
  const resumen = (asig) => {
    const total = asig.reduce((s, a) => s + a.precio * (cant.get(a.indice) || 0), 0);
    return { total: Math.round(total), proveedores: new Set(asig.map((a) => a.proveedor)).size };
  };
  return { barato, menos, resumen: { barato: resumen(barato), menos: resumen(menos) }, tolerancia: Math.round(tolerancia * 100) };
}

// En qué va cada línea según las compras de la venta (las anuladas no cuentan).
// Se reparte por producto: primero lo recibido, después lo pedido. Una compra de 10 cuando se necesitaban 5 cubre la línea.
function estadoLineas(items, ordenes) {
  const recibido = new Map(); const pedido = new Map(); const docs = new Map();
  for (const o of ordenes) {
    if (o.estado === "anulada") continue;
    for (const it of o.items || []) {
      if (!it.producto_id) continue;
      const m = o.estado === "recibida" ? recibido : pedido;
      m.set(it.producto_id, (m.get(it.producto_id) || 0) + Number(it.cantidad || 0));
      if (!docs.has(it.producto_id)) docs.set(it.producto_id, []);
      docs.get(it.producto_id).push({ id: o.id, numero: o.numero, proveedor: o.proveedor_nombre, estado: o.estado, precio: Math.round(Number(it.precio) || 0) });
    }
  }
  return items.map((i) => {
    const necesita = Number(i.cantidad) || 0;
    const r = recibido.get(i.producto_id) || 0;
    const p = pedido.get(i.producto_id) || 0;
    const usaR = Math.min(r, necesita); recibido.set(i.producto_id, r - usaR);
    const usaP = Math.min(p, necesita - usaR); pedido.set(i.producto_id, p - usaP);
    const estado = usaR >= necesita && necesita > 0 ? "comprado" : usaR + usaP >= necesita && necesita > 0 ? "pedido" : usaR + usaP > 0 ? "parcial" : "por_comprar";
    return { estado, recibido: usaR, pedido: usaP, compras: docs.get(i.producto_id) || [] };
  });
}

module.exports = { opcionesPorProducto, sugerir, estadoLineas, TOLERANCIA, SIN };
