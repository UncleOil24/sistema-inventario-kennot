// Cuadro de compra de una venta: todos los materiales en una tabla, con quién conviene comprar cada uno
// (sugerencias "más barato" y "menos proveedores") y en qué va cada línea (por comprar, pedida, comprada).
const PrecioProveedor = require("../models/PrecioProveedor");
const Proveedor = require("../models/Proveedor");
const { vigentesPorProveedor, normProv, REFERENCIA } = require("./precios");

// Cantidad de la línea que se cubre con stock de bodega (comprado antes, va en gastos generales: costo $0 para la venta)
const stockDe = (i) => Math.min(Number(i?.stock?.cantidad) || 0, Number(i?.cantidad) || 0);
// Costo de compra de la venta: lo de stock no suma
const costoItems = (items) => (items || []).reduce((s, x) => s + Number(x.costo || 0) * Math.max(0, Number(x.cantidad || 0) - stockDe(x)), 0);

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
    out.set(id, vigentesPorProveedor(lista).map((p) => ({
      id: p.id, proveedor: normProv(p.proveedor), precio: Math.round(Number(p.precio)), fecha: String(p.fecha).slice(0, 10),
      valido_hasta: p.valido_hasta ? String(p.valido_hasta).slice(0, 10) : null, pack: Number(p.pack) > 1 ? Number(p.pack) : null,
      calce: p.calce || null, descripcion: p.descripcion_proveedor || null, documento: p.documento || null, vendedor: p.vendedor || null,
    })));
  }
  return out;
}

// Opciones para la hoja interna: los proveedores del catálogo de hoy (sin los genéricos de la planilla) más el
// proveedor y costo de la propia línea si no está en el catálogo. Si el producto no tiene ningún precio, se usan los
// del producto más parecido del catálogo (precio subido con otra descripción), marcados con "parecido".
const GENERICOS = ["SISTEMA", "SIN PROVEEDOR", "SIN IDENTIFICAR"];
async function opcionesInterna(items) {
  const ops = await opcionesPorProducto((items || []).map((i) => i.producto_id));
  const { buscarParecidos } = require("../controllers/productosController");
  const out = [];
  for (const it of items || []) {
    let lista = (ops.get(it.producto_id) || []).filter((o) => !GENERICOS.includes(String(o.proveedor).toUpperCase()));
    let parecido = null;
    if (!lista.length && it.producto_id) {
      const cands = await buscarParecidos(it.nombre || it.descripcion_cliente || "", it.producto_id, { minimo: 0.6 });
      const conPrecio = await opcionesPorProducto(cands.slice(0, 15).map((c) => c.id));
      const mejor = cands.find((c) => (conPrecio.get(c.id) || []).some((o) => !GENERICOS.includes(String(o.proveedor).toUpperCase())));
      if (mejor) {
        lista = conPrecio.get(mejor.id).filter((o) => !GENERICOS.includes(String(o.proveedor).toUpperCase()));
        parecido = `N° ${mejor.codigo ?? mejor.id} ${mejor.nombre}`;
      }
    }
    const prov = String(it.proveedor || "").toUpperCase();
    if (prov && !GENERICOS.includes(prov) && Number(it.costo) > 0 && !lista.some((o) => String(o.proveedor).toUpperCase() === prov)) {
      lista = [...lista, { proveedor: prov, precio: Math.round(Number(it.costo)), fecha: null }].sort((a, b) => a.precio - b.precio);
    }
    out.push({ opciones: lista, parecido });
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
  const cant = new Map(conPrecio.map((l) => [l.indice, Number(l.cantidad) || 0]));
  // 1) Elegir pocos proveedores: primero el que cubre más líneas (en empate, el que suma menos), y así sucesivamente
  const sinCubrir = new Set(conPrecio.map((l) => l.indice));
  const elegidos = [];
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
    elegidos.push(mejor[0]);
    for (const i of [...sinCubrir]) if (elegibles.get(i).has(mejor[0])) sinCubrir.delete(i);
  }
  // 2) Sacar proveedores que sobran (todas sus líneas caben en otro elegido)
  const cubre = (set) => conPrecio.every((l) => [...set].some((p) => elegibles.get(l.indice).has(p)));
  const set = new Set(elegidos);
  for (const p of [...elegidos].reverse()) { set.delete(p); if (!cubre(set)) set.add(p); }
  // 3) Cada línea va al más barato de los proveedores elegidos (no al primero que la cubrió)
  const menos = conPrecio.map((l) => {
    const [prov, precio] = [...elegibles.get(l.indice)].filter(([p]) => set.has(p)).sort((a, b) => a[1] - b[1])[0];
    return { indice: l.indice, proveedor: prov, precio };
  });
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
    // Lo que se cubre con stock de bodega no se compra
    const stock = stockDe(i);
    const necesita = Math.max(0, (Number(i.cantidad) || 0) - stock);
    if (stock > 0 && necesita === 0) return { estado: "stock", recibido: 0, pedido: 0, stock, compras: docs.get(i.producto_id) || [] };
    const r = recibido.get(i.producto_id) || 0;
    const p = pedido.get(i.producto_id) || 0;
    const usaR = Math.min(r, necesita); recibido.set(i.producto_id, r - usaR);
    const usaP = Math.min(p, necesita - usaR); pedido.set(i.producto_id, p - usaP);
    const estado = usaR >= necesita && necesita > 0 ? "comprado" : usaR + usaP >= necesita && necesita > 0 ? "pedido" : usaR + usaP > 0 ? "parcial" : "por_comprar";
    return { estado, recibido: usaR, pedido: usaP, stock, compras: docs.get(i.producto_id) || [] };
  });
}

module.exports = {
  opcionesInterna, opcionesPorProducto, sugerir, estadoLineas, stockDe, costoItems, TOLERANCIA, SIN };
