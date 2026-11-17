import { useState, useEffect, useCallback } from "react";
import { Modal, Cargando, Estado, confirmar, pedirTexto, BotonesSolicitud } from "./ui";
import { api, fmt, descargar, imprimirHTML, escaparHTML as h } from "./lib";
import SubirDocumentosVenta from "./SubirDocumentosVenta";

// Cuadro de compra de una venta (Operativo y gerencia): todos los materiales en una tabla, con quién comprar cada uno.
// El sistema sugiere ("más barato" o "menos proveedores", hasta 10% más caro para juntar), tú eliges, y las órdenes
// se crean solo cuando las pides. Las facturas y boletas se suben todas juntas y quedan con el proveedor real.
const ESTADO_LINEA = {
  por_comprar: ["Por comprar", "warn"], pedido: ["Pedido", "info"], parcial: ["Parcial", "warn"], comprado: ["Comprado", "ok"], stock: ["Stock", "neutral"],
};

const AVISO_SEL = "Selecciona productos para generar la orden";
// Marcas de un precio: vigencia de la cotización, pack y calce dudoso (parecido/equivalente = por confirmar)
const hoyTxt = () => new Date().toLocaleDateString("sv-SE");
export const vigencia = (o) => (!o?.valido_hasta ? null : o.valido_hasta < hoyTxt() ? "vencida" : o.valido_hasta === hoyTxt() ? "vence hoy" : null);
const porConfirmar = (o) => o?.calce === "parecido" || o?.calce === "equivalente";
const marcas = (o) => [vigencia(o), o?.pack ? `pack x${o.pack}` : null, porConfirmar(o) ? "⚠ por confirmar" : null].filter(Boolean);
const textoPack = (cant, pack) => { const n = Math.ceil(cant / pack); const sobra = n * pack - cant; return `${cant} un = ${n} pack${n > 1 ? "s" : ""} de ${pack}${sobra ? ` (sobran ${sobra})` : ""}`; };
export default function CuadroCompra({ ventaId, notify, onClose, irACompra, esAdmin }) {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [subir, setSubir] = useState(false);
  const [buscar, setBuscar] = useState(null); // índice de la línea donde se busca precio
  const [elegir, setElegir] = useState(null); // { l } una línea · { ls } las marcadas

  const cargar = useCallback(async () => {
    try { setData(await api(`/ventas/${ventaId}/cuadro-compra`)); }
    catch (e) { notify(e.message, "danger"); onClose(); }
  }, [ventaId, notify, onClose]);
  useEffect(() => { cargar(); }, [cargar]);

  const lineas = data?.lineas || [];
  const marcadas = lineas.filter((l) => sel.has(l.indice));

  if (!data) return <Modal titulo="// Cuadro de compra" onClose={onClose} ancho={1250}><Cargando /></Modal>;
  const { venta, sugerencias, resumen_proveedores, totales, ordenes, gastos } = data;
  const anulada = venta.estado === "anulada";
  const porComprar = lineas.filter((l) => l.estado === "por_comprar");
  const borradores = ordenes.filter((o) => o.estado === "borrador");

  const ejecutar = async (fn, ok) => {
    setOcupado(true);
    try { const r = await fn(); if (ok) notify(typeof ok === "function" ? ok(r) : ok); setSel(new Set()); await cargar(); }
    catch (e) { notify(e.message, "danger"); }
    finally { setOcupado(false); }
  };
  const asignar = (asignaciones, msg) => ejecutar(() => api(`/ventas/${ventaId}/asignar`, { method: "POST", body: { asignaciones } }), msg);

  // La sugerencia se aplica a lo marcado (o a todo lo por comprar si no hay nada marcado) y solo cambia
  // las líneas donde el proveedor es distinto; antes se muestra qué cambia
  const aplicarSugerencia = async (modo) => {
    const lista = sugerencias[modo];
    if (!lista.length) return notify("No hay precios para sugerir: carga cotizaciones de proveedores", "danger");
    const destino = sel.size ? new Set(sinOrden(marcadas).map((l) => l.indice)) : null;
    if (destino && !destino.size) return notify("Los productos marcados ya tienen orden de compra o están comprados", "danger");
    const porIndice = new Map(lineas.map((l) => [l.indice, l]));
    const cambios = lista.filter((a) => (!destino || destino.has(a.indice)) && porIndice.get(a.indice)?.proveedor !== a.proveedor);
    if (!cambios.length) return notify("Los productos ya están con esos proveedores: no hay nada que cambiar");
    const detalle = cambios.slice(0, 15).map((a) => { const l = porIndice.get(a.indice); return `• ${l.nombre}: ${l.proveedor === "SIN PROVEEDOR" ? "—" : l.proveedor} → ${a.proveedor} (${fmt(a.precio)})`; }).join("\n");
    if (!(await confirmar(`${destino ? `Sobre los ${destino.size} producto(s) marcados` : "Sobre todos los productos por comprar"}, cambian ${cambios.length}:\n${detalle}${cambios.length > 15 ? `\n… y ${cambios.length - 15} más` : ""}\n\nLos que no tienen precio de proveedor, los pedidos y los comprados no se tocan. Cambia el costo y el margen de la venta.`, { titulo: modo === "barato" ? "Más barato por producto" : "Menos proveedores", boton: "Aplicar" }))) return;
    asignar(cambios.map((a) => ({ indice: a.indice, proveedor: a.proveedor, costo: a.precio })), `✓ ${cambios.length} producto(s) cambiados de proveedor`);
  };
  const cambiarLinea = async (l, valor) => {
    if (valor === "__buscar") return setBuscar(l.indice);
    if (valor === "__otro") return setElegir({ l });
    const o = l.opciones.find((x) => x.proveedor === valor);
    asignar([{ indice: l.indice, proveedor: valor, costo: o ? o.precio : null }]);
  };
  // Se puede marcar todo (para la solicitud, el pedido o imprimir), pero órdenes y proveedor solo para lo que falta comprar:
  // lo que ya tiene orden o está comprado no se duplica
  const sinOrden = (ls) => ls.filter((l) => l.estado === "por_comprar");
  const avisoOmitidos = (n) => n > 0 ? ` · ${n} ya tenían orden o estaban compradas: se omitieron` : "";
  const asignarMarcadas = async () => {
    if (!sel.size) return notify(AVISO_SEL, "danger");
    const ls = sinOrden(marcadas);
    if (!ls.length) return notify("Los productos marcados ya tienen orden de compra o están comprados", "danger");
    setElegir({ ls, omitidos: marcadas.length - ls.length });
  };
  // Una orden por cada proveedor elegido en las líneas marcadas ("Comprar con"): no se cambia el proveedor de ninguna línea
  const crearOrden = async () => {
    if (!sel.size) return notify(AVISO_SEL, "danger");
    const ls = sinOrden(marcadas);
    if (!ls.length) return notify("Los productos marcados ya tienen orden de compra o están comprados: no se duplican", "danger");
    const sinProv = ls.filter((l) => !l.proveedor || l.proveedor === "SIN PROVEEDOR");
    if (sinProv.length) return notify(`Elige el proveedor de: ${sinProv.slice(0, 3).map((l) => l.nombre).join(", ")}${sinProv.length > 3 ? ` y ${sinProv.length - 3} más` : ""}`, "danger");
    const grupos = new Map();
    for (const l of ls) { if (!grupos.has(l.proveedor)) grupos.set(l.proveedor, []); grupos.get(l.proveedor).push(l); }
    const repetir = ls.filter((l) => l.no_vino && l.proveedor.toUpperCase() === String(l.no_vino.proveedor).toUpperCase());
    const omitidos = marcadas.length - ls.length;
    const texto = [...grupos].map(([p, g]) => { const n = g.reduce((s2, l) => s2 + l.total_compra, 0); return `• ${p}: ${g.length} prod. · ${fmt(n)} neto · ${fmt(Math.round(n * 1.19))} con IVA`; }).join("\n");
    if (!(await confirmar(`Se ${grupos.size === 1 ? "creará 1 orden" : `crearán ${grupos.size} órdenes`} (borrador), cada producto con el proveedor que tiene elegido:\n${texto}${repetir.length ? `\n\nOjo: ${repetir.map((l) => l.nombre).join(", ")} no vino antes con ese mismo proveedor.` : ""}${omitidos ? `\n\n${omitidos} marcado(s) ya tenían orden o estaban comprados: se omiten.` : ""}`, { titulo: "Crear órdenes", boton: grupos.size === 1 ? "Crear orden" : "Crear órdenes" }))) return;
    ejecutar(() => api("/ventas/agrupar/ordenes", { method: "POST", body: { lineas: ls.map((l) => ({ venta_id: ventaId, indice: l.indice, proveedor: l.proveedor })) } }),
      (r) => `✓ ${r.creadas.map((c) => `${c.numero} a ${c.proveedor}`).join(" · ")}`);
  };
  const imprimir = () => imprimirCuadroDatos(data, esAdmin);
  const excelCuadro = () => descargar(`/ventas/${ventaId}/cuadro-excel`).catch((e) => notify(e.message, "danger"));
  // OK stock: la línea (o parte) sale de bodega; costo $0 para la venta (ya está en gastos generales)
  const okStock = async (l) => {
    const falta = Math.max(0, l.cantidad - (l.stock || 0) - (l.recibido || 0) - (l.pedido || 0)) + (l.stock || 0);
    const r = await pedirTexto(`¿Cuántos de "${l.nombre}" salen de stock? (pide ${l.cantidad} ${l.unidad || ""})`, { titulo: "OK stock", valor: String(falta || l.cantidad) });
    if (r == null) return;
    const n = Number(String(r).replace(",", "."));
    if (!(n > 0) || n > l.cantidad) return notify(`Cantidad entre 1 y ${l.cantidad}`, "danger");
    ejecutar(() => api(`/ventas/${ventaId}/stock`, { method: "POST", body: { indice: l.indice, cantidad: n } }), n < l.cantidad ? `${n} de stock: faltan ${l.cantidad - n} por comprar` : "✓ Sale de stock");
  };
  const quitarStock = (l) => ejecutar(() => api(`/ventas/${ventaId}/stock`, { method: "POST", body: { indice: l.indice, cantidad: 0 } }), "Ya no sale de stock");
  const comprarConOtro = (l) => { setSel(new Set([l.indice])); setTimeout(() => document.getElementById("orden-a")?.focus(), 50); };
  const descartar = async () => {
    if (!(await confirmar(`¿Descartar ${borradores.length} orden(es) en borrador (${borradores.map((o) => o.numero).join(", ")})?\nSus productos vuelven a "por comprar".`, { titulo: "Descartar borradores", boton: "Descartar", peligro: true }))) return;
    ejecutar(() => api(`/ventas/${ventaId}/descartar-borradores`, { method: "POST" }), (r) => `✓ Descartadas: ${r.descartadas.join(", ")}`);
  };
  const toggle = (i) => setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const marcarProveedor = (prov) => setSel(new Set(porComprar.filter((l) => l.proveedor === prov).map((l) => l.indice)));

  return (
    <Modal titulo={`// Cuadro de compra · ${venta.numero} · ${venta.cliente_nombre || "Sin cliente"}`} onClose={onClose} ancho={1250}
      footer={<>
        <button className="btn btn-ghost" onClick={imprimir}>🖨 Imprimir</button>
        <button className="btn btn-ghost" onClick={excelCuadro}>↓ Excel del cuadro</button>
        {!anulada && borradores.length > 0 && <button className="btn btn-ghost" disabled={ocupado} onClick={descartar}>Descartar borradores ({borradores.length})</button>}
        {!anulada && <button className="btn btn-primary" onClick={() => setSubir(true)}>⇪ Subir facturas y boletas</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="cuadro-imprimible">
        {venta.orden_compra_cliente && <div className="mini">OC del cliente: <strong>{venta.orden_compra_cliente}</strong></div>}

        {!anulada && porComprar.length > 0 && (
          <div className="panel">
            <div className="panel-titulo">Sugerencia para lo que falta comprar ({porComprar.length} productos)</div>
            <div className="mini" style={{ marginBottom: 6 }}>Solo es una ayuda: "Aplicar" cambia lo marcado (o todo si no marcas nada) y antes te muestra qué cambia. Lo que eliges a mano en cada línea es lo que va a la orden.</div>
            <div className="fields-row" style={{ alignItems: "stretch" }}>
              <div className="sugerencia-caja">
                <strong>Más barato por producto</strong>
                <div className="mini">{fmt(sugerencias.resumen.barato.total)} neto · {sugerencias.resumen.barato.proveedores} proveedor(es)</div>
                <button className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => aplicarSugerencia("barato")}>Aplicar</button>
              </div>
              <div className="sugerencia-caja">
                <strong>Menos proveedores</strong> <span className="mini">(hasta {sugerencias.tolerancia}% más caro por producto)</span>
                <div className="mini">
                  {fmt(sugerencias.resumen.menos.total)} neto · {sugerencias.resumen.menos.proveedores} proveedor(es)
                  {sugerencias.resumen.menos.total > sugerencias.resumen.barato.total && ` · ${fmt(sugerencias.resumen.menos.total - sugerencias.resumen.barato.total)} más, ${sugerencias.resumen.barato.proveedores - sugerencias.resumen.menos.proveedores} viaje(s) menos`}
                </div>
                <button className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => aplicarSugerencia("menos")}>Aplicar</button>
              </div>
            </div>
            {resumen_proveedores.length > 0 && (
              <div className="chips" style={{ marginTop: 8 }}>
                <span className="mini" style={{ alignSelf: "center" }}>Elegido hoy:</span>
                {resumen_proveedores.map((p) => (
                  <button key={p.proveedor} className="chip" title={p.contacto || ""} onClick={() => marcarProveedor(p.proveedor)}>
                    {p.proveedor} · {p.lineas} prod. · {fmt(p.total)} neto · {fmt(Math.round(p.total * 1.19))} c/IVA
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!anulada && (
          <div className="panel barra-seleccion">
            {sel.size ? <strong>{sel.size} marcado(s)</strong> : <strong style={{ color: "var(--warn)" }}>{AVISO_SEL} ↓</strong>}
            <button className="btn btn-ghost btn-sm" disabled={ocupado} onClick={asignarMarcadas}>Asignar proveedor…</button>
            <button className="btn btn-primary btn-sm" disabled={ocupado} onClick={crearOrden} title="Una orden por cada proveedor elegido en las líneas marcadas">Crear orden(es)</button>
            <BotonesSolicitud notify={notify} lineas={() => marcadas.map((l) => ({ venta_id: ventaId, indice: l.indice }))} />
            {(() => { const sp = porComprar.filter((l) => !(l.compra_unit > 0)); return sp.length > 0 && <button className="btn btn-ghost btn-sm" title="Marca los productos por comprar que no tienen precio, para pedir cotización" onClick={() => setSel(new Set(sp.map((l) => l.indice)))}>Sin precio ({sp.length})</button>; })()}
            {sel.size > 0 && <button className="link mini" onClick={() => setSel(new Set())}>Quitar marcas</button>}
          </div>
        )}

        <div className="table-wrap">
          <table className="table table-compacta">
            <thead><tr>
              <th><input type="checkbox" disabled={anulada} checked={lineas.length > 0 && lineas.every((l) => sel.has(l.indice))} onChange={(e) => setSel(e.target.checked ? new Set(lineas.map((l) => l.indice)) : new Set())} title="Marcar todo (las órdenes se crean solo con lo que falta comprar)" /></th>
              <th className="col-desc">Producto</th><th>Cant.</th><th>Comprar con</th><th>Compra unit.</th><th>Total compra</th><th>Venta unit.</th><th>Margen</th><th>Estado</th>
            </tr></thead>
            <tbody>
              {lineas.map((l) => {
                const [txt, tono] = ESTADO_LINEA[l.estado] || [l.estado, "neutral"];
                const bloqueada = anulada || l.estado === "comprado" || l.estado === "stock";
                const real = l.estado === "comprado" ? l.compras.find((c) => c.estado === "recibida") : null;
                return (
                  <tr key={l.indice} className={l.estado === "stock" ? "fila-stock" : !(l.compra_unit > 0) ? "fila-alerta" : ""}>
                    <td><input type="checkbox" disabled={anulada} checked={sel.has(l.indice)} onChange={() => toggle(l.indice)} /></td>
                    <td>{l.nombre}<div className="mini">{l.codigo ? `N° ${l.codigo}` : ""}</div></td>
                    <td className="mini">{l.cantidad} {l.unidad}</td>
                    <td>
                      {real ? <span><strong>{real.proveedor}</strong> <span className="mini">· {fmt(real.precio)}</span></span> :
                      <select className="select-linea" style={{ minWidth: 170 }} disabled={bloqueada || ocupado} value={l.proveedor} onChange={(e) => cambiarLinea(l, e.target.value)}>
                        {!l.opciones.some((o) => o.proveedor === l.proveedor) && <option value={l.proveedor}>{l.proveedor === "SIN PROVEEDOR" ? "— Elegir —" : l.proveedor}</option>}
                        {l.opciones.map((o, k) => (
                          <option key={o.proveedor} value={o.proveedor}>{o.proveedor} · {fmt(o.precio)}{k === 0 ? " ★" : ""}{marcas(o).length ? ` · ${marcas(o).join(" · ")}` : ""}</option>
                        ))}
                        <option value="__buscar">🔍 Buscar precio en el catálogo…</option>
                        <option value="__otro">Elegir otro proveedor…</option>
                      </select>}
                      {!real && !bloqueada && <button className="link mini" style={{ display: "block" }} title="Todos los precios de este producto y de productos parecidos del catálogo" onClick={() => setBuscar(l.indice)}>🔍 buscar precio</button>}
                      {!real && (() => { const o = l.opciones.find((x) => x.proveedor === l.proveedor); if (!o) return null; const v = vigencia(o); return <div className="mini">{o.fecha ? `precio del ${o.fecha.split("-").reverse().join("-")}` : "precio cotizado"}{l.opciones.length > 1 ? ` · ${l.opciones.length} opciones` : ""}
                        {v && <div style={{ color: "var(--danger)" }} title={`Cotización válida hasta ${o.valido_hasta}`}>⚠ cotización {v}: confirmar precio</div>}
                        {porConfirmar(o) && <div style={{ color: "var(--warn)" }} title={o.descripcion || ""}>⚠ por confirmar: {o.descripcion || "producto parecido"}</div>}
                        {o.pack && <div><strong>{textoPack(l.cantidad - (l.stock || 0), o.pack)}</strong></div>}</div>; })()}
                    </td>
                    <td className="price-cell compra">{real ? fmt(real.precio) : l.compra_unit > 0 ? fmt(l.compra_unit) : "sin precio"}</td>
                    <td className="price-cell compra">{fmt(real ? real.precio * (l.cantidad - (l.stock || 0)) : l.total_compra)}</td>
                    <td className="price-cell">{fmt(l.venta_unit)}</td>
                    <td className="mini" style={{ color: l.margen < 0 ? "var(--danger)" : undefined }}>{fmt(l.margen)} · {l.margen_pct}%</td>
                    <td>
                      <span className={`estado estado-${tono}`}>{txt}</span>
                      {l.stock > 0 && <div className="mini">{l.stock} de stock{l.stock < l.cantidad ? ` · faltan ${l.cantidad - l.stock}` : ""}{!anulada && <> · <button className="link mini" onClick={() => quitarStock(l)}>deshacer</button></>}</div>}
                      {!anulada && ["por_comprar", "parcial"].includes(l.estado) && <div><button className="link mini" title="Se cubre con lo que hay en bodega (va en gastos generales: costo $0 para la venta)" onClick={() => okStock(l)}>OK stock</button></div>}
                      {l.no_vino && <div className="mini" style={{ color: "var(--danger)" }}>no vino en {l.no_vino.orden} ({l.no_vino.proveedor})
                        {!anulada && <div><button className="link mini" onClick={() => comprarConOtro(l)}>Comprar con otro proveedor</button></div>}</div>}
                      {l.compras.map((c) => <div key={c.id + c.numero}><button className="link mini" onClick={() => irACompra?.(c.id)}>{c.numero} {c.proveedor}</button></div>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mini">★ = más barato. Las fechas son las del último precio de cada proveedor. Cambiar el proveedor cambia el costo y el margen de la venta.</div>

        {(ordenes.length > 0 || gastos.length > 0) && (
          <div className="panel">
            <div className="panel-titulo">Compras y gastos de la venta</div>
            <table className="table table-compacta">
              <thead><tr><th>Compra</th><th>Proveedor</th><th>Documento</th><th>Estado</th><th>Neto</th></tr></thead>
              <tbody>
                {ordenes.map((o) => (
                  <tr key={o.id}>
                    <td><button className="link" onClick={() => irACompra?.(o.id)}>{o.numero}</button></td>
                    <td>{o.proveedor_nombre}</td><td className="mini">{o.documento || "—"}</td><td><Estado valor={o.estado} /></td>
                    <td className="price-cell compra">{fmt(o.subtotal)}</td>
                  </tr>
                ))}
                {gastos.map((g) => (
                  <tr key={`g${g.id}`}><td className="mini">Gasto</td><td>{g.descripcion}</td><td className="mini">{g.comprobante || "—"}</td><td><span className="estado estado-neutral">{g.tipo}</span></td><td className="price-cell compra">{fmt(g.monto)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="panel">
          <div className="resumen-utilidad">
            <div><span className="stat-label">Compra planificada</span><strong>{fmt(totales.compra)}</strong><span className="mini">neto</span></div>
            <div><span className="stat-label">Comprado (facturas y boletas)</span><strong>{fmt(totales.compras_real)}</strong><span className="mini">recibido</span></div>
            <div><span className="stat-label">Total venta</span><strong>{fmt(totales.venta)}</strong><span className="mini">neto</span></div>
            <div><span className="stat-label">Gastos de la venta</span><strong>−{fmt(totales.gastos)}</strong><span className="mini">flete, combustible, otros</span></div>
            <div><span className="stat-label">{totales.todo_comprado ? "Utilidad real" : "Utilidad estimada"}</span>
              <strong style={{ color: totales.utilidad_actual >= 0 ? "var(--success)" : "var(--danger)" }}>{fmt(totales.utilidad_actual)}</strong>
              <span className="mini">{totales.todo_comprado ? "con lo realmente comprado" : `lo comprado + ${fmt(totales.falta_comprar)} por comprar`}</span></div>
          </div>
        </div>
      </div>
      {elegir && <ElegirProveedor proveedores={data.proveedores} linea={elegir.l} lineas={elegir.ls} onClose={() => setElegir(null)}
        onElegir={(prov, precio) => {
          const e = elegir; setElegir(null);
          if (e.l) asignar([{ indice: e.l.indice, proveedor: prov, costo: precio }], `✓ ${e.l.nombre}: ${prov}`);
          else asignar(e.ls.map((l) => ({ indice: l.indice, proveedor: prov })), `✓ ${e.ls.length} producto(s) asignados a ${prov}${avisoOmitidos(e.omitidos)}`);
        }} />}
      {buscar != null && <BuscarPrecio ventaId={ventaId} indice={buscar} notify={notify} onClose={() => setBuscar(null)} onHecho={() => { setBuscar(null); cargar(); }} />}
      {subir && <SubirDocumentosVenta venta={venta} lineas={lineas} ordenes={ordenes} proveedores={data.proveedores} notify={notify} onClose={() => { setSubir(false); cargar(); }} />}
    </Modal>
  );
}

// Hoja para imprimir (Carta horizontal): productos agrupados por proveedor, con casilla para marcar a mano
export function imprimirCuadroDatos(data, esAdmin) {
  const { venta, totales } = data; const lineas = data.lineas || [];
  const grupos = new Map();
  for (const l of lineas) { if (!grupos.has(l.proveedor)) grupos.set(l.proveedor, []); grupos.get(l.proveedor).push(l); }
  const prov = [...grupos.entries()].sort((a, b) => (a[0] === "SIN PROVEEDOR") - (b[0] === "SIN PROVEEDOR") || a[0].localeCompare(b[0]));
  const contacto = Object.fromEntries((data.resumen_proveedores || []).map((p) => [p.proveedor, p.contacto]));
  const txt = { por_comprar: "Por comprar", pedido: "Pedido", parcial: "Parcial", comprado: "Comprado", stock: "Stock" };
  const cuerpo = `<h1>Cuadro de compra · ${h(venta.numero)} · ${h(venta.cliente_nombre || "Sin cliente")}</h1>
    <div class="sub">${[venta.orden_compra_cliente ? `OC ${h(venta.orden_compra_cliente)}` : "", venta.id_solicitud ? `ID ${h(venta.id_solicitud)}` : "", `impreso el ${new Date().toLocaleDateString("es-CL")}`].filter(Boolean).join(" · ")}</div>
    ${prov.map(([p, ls]) => `<div class="grupo"><h2><span>${h(p === "SIN PROVEEDOR" ? "Sin proveedor elegido" : p)}${contacto[p] ? ` <span class="mini">· ${h(contacto[p])}</span>` : ""}</span><span>${ls.length} prod. · ${fmt(ls.reduce((s2, l) => s2 + l.total_compra, 0))}</span></h2>
      <table><colgroup><col style="width:46px"><col style="width:18px"><col><col style="width:38px"><col style="width:66px"><col style="width:70px"><col style="width:80px"><col style="width:92px"></colgroup><thead><tr><th>N°</th><th class="chk"></th><th>Producto</th><th class="num">Cant.</th><th class="cen">Unidad</th><th class="num">Precio unit.</th><th class="num">Total</th><th class="obs">Estado</th></tr></thead><tbody>
      ${ls.map((l) => `<tr${l.estado === "stock" ? ' style="text-decoration:line-through;color:#777"' : ""}><td>${h(l.codigo || "")}</td><td class="chk">${l.estado === "stock" ? "✓" : "☐"}</td><td>${h(l.nombre)}${l.stock > 0 && l.estado !== "stock" ? `<div class="mini">${l.stock} de stock · comprar ${l.cantidad - l.stock}</div>` : ""}${l.no_vino ? `<div class="aviso">no vino en ${h(l.no_vino.orden)} (${h(l.no_vino.proveedor)})</div>` : ""}</td><td class="num">${l.cantidad}</td><td class="cen">${h(l.unidad || "")}</td>
        <td class="num">${l.compra_unit > 0 ? fmt(l.compra_unit) : "sin precio"}</td><td class="num">${fmt(l.total_compra)}</td><td class="obs">${txt[l.estado] || l.estado}${l.compras.length ? `<div class="mini">${l.compras.map((c) => h(c.numero)).join(", ")}</div>` : ""}</td></tr>`).join("")}
      </tbody></table></div>`).join("")}
    <div class="pie">Total compra: <strong>${fmt(lineas.reduce((s2, l) => s2 + l.total_compra, 0))}</strong> neto · falta comprar ${fmt(totales.falta_comprar)}${esAdmin ? ` · venta ${fmt(totales.venta)} · utilidad ${fmt(totales.utilidad_actual)}` : ""}</div>`;
  imprimirHTML(`Cuadro de compra ${venta.numero}`, cuerpo);
}
// Desde la venta: trae el cuadro y lo imprime
export async function imprimirCuadro(ventaId, esAdmin) {
  imprimirCuadroDatos(await api(`/ventas/${ventaId}/cuadro-compra`), esAdmin);
}

// Buscar precio para una línea: todos los proveedores del producto y de productos parecidos del catálogo
// (precios cargados en otro producto escrito distinto). Al usar uno de un parecido, se puede guardar en el producto de la línea.
function BuscarPrecio({ ventaId, indice, notify, onClose, onHecho }) {
  const [d, setD] = useState(null);
  const [q, setQ] = useState("");
  const [guardar, setGuardar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const cargar = useCallback((texto) => {
    setD(null);
    api(`/ventas/${ventaId}/buscar-precio?indice=${indice}${texto ? `&q=${encodeURIComponent(texto)}` : ""}`)
      .then((r) => { setD(r); setQ((x) => x || r.q); }).catch((e) => { notify(e.message, "danger"); onClose(); });
  }, [ventaId, indice, notify, onClose]);
  useEffect(() => { cargar(""); }, [cargar]);
  const usar = async (o, desde) => {
    setOcupado(true);
    try {
      await api(`/ventas/${ventaId}/precio-linea`, { method: "POST", body: { indice, proveedor: o.proveedor, precio: o.precio, desde_producto_id: desde || null, guardar: !!desde && guardar } });
      notify(`✓ ${d.linea.nombre}: ${o.proveedor} ${fmt(o.precio)}${desde && guardar ? " · guardado en el catálogo" : ""}`);
      onHecho();
    } catch (e) { notify(e.message, "danger"); setOcupado(false); }
  };
  const fechaTxt = (f) => (f ? f.split("-").reverse().join("-") : "");
  // "No cumple" (ej. fotocelda 5A cuando se pide 10A): ese precio deja de competir para ese producto
  const noCumple = async (o) => {
    if (!o.id) return;
    const motivo = await pedirTexto(`¿Por qué el precio de ${o.proveedor} (${o.descripcion || fmt(o.precio)}) no cumple?`, { titulo: "No cumple la especificación", placeholder: "Ej.: es de 5A, se pide 10A", obligatorio: true, boton: "No cumple" });
    if (!motivo) return;
    try { await api(`/precios/${o.id}/no-cumple`, { method: "POST", body: { motivo } }); notify(`Precio de ${o.proveedor} descartado para ese producto`); cargar(q === d?.q ? "" : q); }
    catch (e) { notify(e.message, "danger"); }
  };
  const filas = (ops, desde, actual) => ops.map((o, k) => (
    <tr key={o.proveedor}>
      <td><strong>{o.proveedor}</strong>{k === 0 ? " ★" : ""}{actual && actual === o.proveedor ? <span className="mini"> · elegido</span> : ""}
        {o.descripcion && <div className="mini" title="Así lo escribió el proveedor">{o.descripcion}</div>}
        {marcas(o).length > 0 && <div className="mini" style={{ color: vigencia(o) ? "var(--danger)" : "var(--warn)" }}>{marcas(o).join(" · ")}</div>}</td>
      <td className="price-cell compra">{fmt(o.precio)}{o.pack ? <div className="mini">c/u (pack x{o.pack})</div> : null}</td>
      <td className="mini">{fechaTxt(o.fecha)}{o.documento ? <div>{o.documento}</div> : null}{o.valido_hasta ? <div>válida hasta {fechaTxt(o.valido_hasta)}</div> : null}</td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {o.id && !desde && <button className="btn btn-ghost btn-sm" style={{ marginRight: 4 }} disabled={ocupado} title="No cumple la especificación (medida, potencia, amperaje…): deja de competir" onClick={() => noCumple(o)}>No cumple</button>}
        <button className="btn btn-primary btn-sm" disabled={ocupado} onClick={() => usar(o, desde)}>Usar</button></td>
    </tr>
  ));
  return (
    <Modal titulo="// Buscar precio" onClose={onClose} ancho={760} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {!d ? <Cargando /> : <>
        <div style={{ marginBottom: 10 }}><strong>{d.linea.nombre}</strong> <span className="mini">· N° {d.linea.codigo} · {d.linea.unidad} · ahora {d.linea.proveedor} {d.linea.costo ? fmt(d.linea.costo) : "sin precio"}</span></div>
        <div className="panel-titulo">Precios de este producto</div>
        {d.propios.length ? <table className="table table-compacta"><tbody>{filas(d.propios, null, d.linea.proveedor)}</tbody></table>
          : <div className="aviso" style={{ marginBottom: 8 }}>Este producto no tiene precios en el catálogo. Busca abajo si el precio quedó cargado en un producto escrito distinto.</div>}
        <div className="panel-titulo" style={{ marginTop: 14 }}>Productos parecidos del catálogo con precio</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input className="input-mini" style={{ flex: 1, padding: "5px 8px" }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && cargar(q)} placeholder="Ej: perno 1/2 x 1 1/4" />
          <button className="btn btn-ghost btn-sm" onClick={() => cargar(q)}>Buscar</button>
        </div>
        <label className="mini" style={{ display: "block", marginBottom: 8 }}><input type="checkbox" checked={guardar} onChange={(e) => setGuardar(e.target.checked)} /> Al usar un precio de un producto parecido, guardarlo también en N° {d.linea.codigo} (así la próxima vez sale solo)</label>
        {!d.parecidos.length ? <div className="mini">No hay productos parecidos con precio. Prueba con menos palabras (ej. "perno 1/2").</div>
          : d.parecidos.map((p) => (
            <div key={p.id} style={{ borderTop: "1px solid var(--border, #ddd)", padding: "6px 0" }}>
              <div>{p.nombre} <span className="mini">· N° {p.codigo} · {p.unidad}{p.unidad !== d.linea.unidad ? " ⚠ otra unidad" : ""} · {p.parecido}% parecido</span></div>
              <table className="table table-compacta"><tbody>{filas(p.opciones, p.id)}</tbody></table>
            </div>
          ))}
      </>}
    </Modal>
  );
}

// Nombres de relleno: sirven como nota en la línea, pero no son proveedores (no se crean órdenes a ellos)
const RELLENO = ["OTRO", "OTROS", "COTIZAR", "POR COTIZAR", "A COTIZAR", "VARIOS", "PENDIENTE", "POR DEFINIR", "SIN PROVEEDOR", "SIN IDENTIFICAR", "SISTEMA", "?", "-", "X"];
const esRelleno = (s) => RELLENO.includes(String(s || "").trim().toUpperCase().replace(/\.$/, ""));

// Elegir proveedor de una lista (todos los proveedores, buscando por nombre), con los precios que tenga el producto.
// linea: una línea (se puede poner precio) · lineas: varias marcadas (cada una toma su precio con ese proveedor)
function ElegirProveedor({ proveedores, linea, lineas, onElegir, onClose }) {
  const [q, setQ] = useState("");
  const [elegido, setElegido] = useState(null);
  const [precio, setPrecio] = useState("");
  const precios = new Map();
  if (linea) for (const o of linea.opciones) precios.set(o.proveedor, o.precio);
  const cuenta = new Map();
  if (lineas) for (const l of lineas) for (const o of l.opciones) cuenta.set(o.proveedor, (cuenta.get(o.proveedor) || 0) + 1);
  const Q = q.trim().toUpperCase();
  const todos = [...new Set([...precios.keys(), ...cuenta.keys(), ...proveedores])].filter((p) => !esRelleno(p));
  const filtrados = todos.filter((p) => !Q || p.includes(Q))
    .sort((a, b) => (precios.has(b) - precios.has(a)) || ((precios.get(a) || 0) - (precios.get(b) || 0)) || ((cuenta.get(b) || 0) - (cuenta.get(a) || 0)) || a.localeCompare(b));
  const nuevo = Q && !todos.includes(Q) ? Q : null;
  const tomar = (p) => {
    if (lineas) return onElegir(p, null);
    setElegido(p); setPrecio(precios.has(p) ? String(precios.get(p)) : "");
  };
  const confirmarLinea = () => {
    const n = Number(String(precio).replace(/[^\d]/g, ""));
    onElegir(elegido, n > 0 ? n : null);
  };
  return (
    <Modal titulo={linea ? "// Elegir proveedor" : `// Asignar proveedor a ${lineas.length} producto(s)`} onClose={onClose} ancho={560}
      footer={<>{elegido && <button className="btn btn-primary" onClick={confirmarLinea}>Usar {elegido}</button>}<button className="btn btn-ghost" onClick={onClose}>Cancelar</button></>}>
      {linea && <div style={{ marginBottom: 8 }}><strong>{linea.nombre}</strong> <span className="mini">· {linea.cantidad} {linea.unidad} · ahora {linea.proveedor} {linea.compra_unit > 0 ? fmt(linea.compra_unit) : "sin precio"}</span></div>}
      {!elegido ? <>
        <input autoFocus className="input-mini" style={{ width: "100%", padding: "6px 8px", marginBottom: 8 }} placeholder="Buscar proveedor (ej. bac)" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (filtrados[0] || nuevo)) tomar(filtrados[0] || nuevo); }} />
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          {filtrados.slice(0, 80).map((p) => (
            <button key={p} className="fila-elegir" onClick={() => tomar(p)}>
              <span>{p}</span>
              <span className="mini">{precios.has(p) ? fmt(precios.get(p)) : cuenta.has(p) ? `precio en ${cuenta.get(p)} de ${lineas.length}` : ""}</span>
            </button>
          ))}
          {!filtrados.length && !nuevo && <div className="mini">No hay proveedores con ese nombre.</div>}
        </div>
        {!Q && <div className="mini" style={{ marginTop: 8 }}>Sin proveedor definido (se puede crear la orden; no se guarda como proveedor):{" "}
          {["OTROS", "COTIZAR"].map((n) => <button key={n} className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => tomar(n)}>{n}</button>)}</div>}
        {nuevo && <div style={{ marginTop: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => tomar(nuevo)}>Usar «{nuevo}» {esRelleno(nuevo) ? "(sin proveedor definido)" : "(proveedor nuevo)"}</button>
          <div className="mini">{esRelleno(nuevo) ? `"${nuevo}" no se guarda como proveedor ni con precios en el catálogo, pero se puede crear la orden de compra con ese nombre.` : "No se guarda en ninguna parte hasta crear la orden de compra."}</div>
        </div>}
      </> : <>
        <div style={{ marginBottom: 8 }}>Proveedor: <strong>{elegido}</strong> <button className="link mini" onClick={() => setElegido(null)}>cambiar</button></div>
        <div className="field"><label>Precio unitario neto{precios.has(elegido) ? " (del catálogo)" : ""}</label>
          <input autoFocus value={precio} onChange={(e) => setPrecio(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmarLinea()} placeholder={elegido === linea.proveedor && linea.compra_unit > 0 ? `vacío = mantener ${fmt(linea.compra_unit)}` : "vacío = queda sin precio"} /></div>
      </>}
    </Modal>
  );
}
