import { useState, useEffect, useCallback, useMemo } from "react";
import { Modal, Cargando, Estado, confirmar, pedirTexto } from "./ui";
import { api, fmt, descargar, imprimirHTML, escaparHTML as h } from "./lib";
import SubirDocumentosVenta from "./SubirDocumentosVenta";

// Cuadro de compra de una venta (Operativo y gerencia): todos los materiales en una tabla, con quién comprar cada uno.
// El sistema sugiere ("más barato" o "menos proveedores", hasta 10% más caro para juntar), tú eliges, y las órdenes
// se crean solo cuando las pides. Las facturas y boletas se suben todas juntas y quedan con el proveedor real.
const ESTADO_LINEA = {
  por_comprar: ["Por comprar", "warn"], pedido: ["Pedido", "info"], parcial: ["Parcial", "warn"], comprado: ["Comprado", "ok"], stock: ["Stock", "neutral"],
};

export default function CuadroCompra({ ventaId, notify, onClose, irACompra, esAdmin }) {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [provOrden, setProvOrden] = useState("");
  const [subir, setSubir] = useState(false);

  const cargar = useCallback(async () => {
    try { setData(await api(`/ventas/${ventaId}/cuadro-compra`)); }
    catch (e) { notify(e.message, "danger"); onClose(); }
  }, [ventaId, notify, onClose]);
  useEffect(() => { cargar(); }, [cargar]);

  const lineas = data?.lineas || [];
  const marcadas = lineas.filter((l) => sel.has(l.indice));
  // Proveedor propuesto para la orden: el que más se repite entre las líneas marcadas
  const provSugerido = useMemo(() => {
    const c = new Map();
    for (const l of marcadas) {
      // Lo que no vino con un proveedor se propone con el siguiente más barato
      const p = l.no_vino && l.proveedor.toUpperCase() === String(l.no_vino.proveedor).toUpperCase() ? (l.opciones.find((o) => o.proveedor.toUpperCase() !== l.proveedor.toUpperCase())?.proveedor || "") : l.proveedor;
      if (p && p !== "SIN PROVEEDOR") c.set(p, (c.get(p) || 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }, [marcadas]);
  useEffect(() => { setProvOrden(provSugerido); }, [provSugerido]);

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

  const aplicarSugerencia = async (modo) => {
    const lista = sugerencias[modo];
    if (!lista.length) return notify("No hay precios para sugerir: carga cotizaciones de proveedores", "danger");
    const r = sugerencias.resumen[modo];
    if (!(await confirmar(`Asignar ${lista.length} producto(s) por comprar a ${r.proveedores} proveedor(es), total ${fmt(r.total)} neto.\nCambia el costo y el margen de la venta; las líneas pedidas o compradas no se tocan.`, { titulo: modo === "barato" ? "Más barato por producto" : "Menos proveedores", boton: "Aplicar" }))) return;
    asignar(lista.map((a) => ({ indice: a.indice, proveedor: a.proveedor, costo: a.precio })), `✓ Sugerencia aplicada: ${r.proveedores} proveedor(es)`);
  };
  const cambiarLinea = async (l, valor) => {
    if (valor === "__otro") {
      const prov = await pedirTexto(`¿Con qué proveedor compras "${l.nombre}"?`, { titulo: "Otro proveedor", sugerencias: data.proveedores.slice(0, 12) });
      if (!prov) return;
      const precio = await pedirTexto(`Precio unitario neto con ${prov.toUpperCase()} (vacío = mantener ${fmt(l.compra_unit)})`, { titulo: "Precio" });
      return asignar([{ indice: l.indice, proveedor: prov, costo: precio ? Number(String(precio).replace(/[^\d]/g, "")) : null }], `✓ ${l.nombre}: ${prov.toUpperCase()}`);
    }
    const o = l.opciones.find((x) => x.proveedor === valor);
    asignar([{ indice: l.indice, proveedor: valor, costo: o ? o.precio : null }]);
  };
  const asignarMarcadas = async () => {
    const prov = await pedirTexto(`¿A qué proveedor asignas los ${marcadas.length} producto(s) marcados?`, { titulo: "Asignar proveedor", sugerencias: [...new Set(marcadas.flatMap((l) => l.opciones.map((o) => o.proveedor)))].slice(0, 10) });
    if (prov) asignar(marcadas.map((l) => ({ indice: l.indice, proveedor: prov })), `✓ ${marcadas.length} producto(s) asignados a ${prov.toUpperCase()}`);
  };
  const crearOrden = () => {
    if (!provOrden) return notify("Indica el proveedor de la orden", "danger");
    ejecutar(() => api(`/ventas/${ventaId}/crear-orden`, { method: "POST", body: { indices: [...sel], proveedor: provOrden } }), (r) => `✓ Orden ${r.numero} creada a ${r.proveedor_nombre}`);
  };
  // Hoja para imprimir (Carta horizontal): productos agrupados por proveedor, con casilla para marcar a mano
  const imprimir = () => {
    const grupos = new Map();
    for (const l of lineas) { if (!grupos.has(l.proveedor)) grupos.set(l.proveedor, []); grupos.get(l.proveedor).push(l); }
    const prov = [...grupos.entries()].sort((a, b) => (a[0] === "SIN PROVEEDOR") - (b[0] === "SIN PROVEEDOR") || a[0].localeCompare(b[0]));
    const contacto = Object.fromEntries((data.resumen_proveedores || []).map((p) => [p.proveedor, p.contacto]));
    const txt = { por_comprar: "Por comprar", pedido: "Pedido", parcial: "Parcial", comprado: "Comprado", stock: "Stock" };
    const cuerpo = `<h1>Cuadro de compra · ${h(venta.numero)} · ${h(venta.cliente_nombre || "Sin cliente")}</h1>
      <div class="sub">${[venta.orden_compra_cliente ? `OC ${h(venta.orden_compra_cliente)}` : "", venta.id_solicitud ? `ID ${h(venta.id_solicitud)}` : "", `impreso el ${new Date().toLocaleDateString("es-CL")}`].filter(Boolean).join(" · ")}</div>
      ${prov.map(([p, ls]) => `<div class="grupo"><h2><span>${h(p === "SIN PROVEEDOR" ? "Sin proveedor elegido" : p)}${contacto[p] ? ` <span class="mini">· ${h(contacto[p])}</span>` : ""}</span><span>${ls.length} prod. · ${fmt(ls.reduce((s2, l) => s2 + l.total_compra, 0))}</span></h2>
        <table><colgroup><col style="width:20px"><col><col style="width:50px"><col style="width:45px"><col style="width:72px"><col style="width:80px"><col style="width:85px"><col style="width:110px"></colgroup><thead><tr><th class="chk"></th><th>Producto</th><th>N°</th><th class="num">Cant.</th><th>Unidad</th><th class="num">Precio unit.</th><th class="num">Total</th><th>Estado</th></tr></thead><tbody>
        ${ls.map((l) => `<tr${l.estado === "stock" ? ' style="text-decoration:line-through;color:#777"' : ""}><td class="chk">${l.estado === "stock" ? "✓" : "☐"}</td><td>${h(l.nombre)}${l.stock > 0 && l.estado !== "stock" ? `<div class="mini">${l.stock} de stock · comprar ${l.cantidad - l.stock}</div>` : ""}${l.no_vino ? `<div class="aviso">no vino en ${h(l.no_vino.orden)} (${h(l.no_vino.proveedor)})</div>` : ""}</td><td>${h(l.codigo || "")}</td><td class="num">${l.cantidad}</td><td>${h(l.unidad || "")}</td>
          <td class="num">${l.compra_unit > 0 ? fmt(l.compra_unit) : "sin precio"}</td><td class="num">${fmt(l.total_compra)}</td><td>${txt[l.estado] || l.estado}${l.compras.length ? `<div class="mini">${l.compras.map((c) => h(c.numero)).join(", ")}</div>` : ""}</td></tr>`).join("")}
        </tbody></table></div>`).join("")}
      <div class="pie">Total compra: <strong>${fmt(lineas.reduce((s2, l) => s2 + l.total_compra, 0))}</strong> neto · falta comprar ${fmt(totales.falta_comprar)}${esAdmin ? ` · venta ${fmt(totales.venta)} · utilidad ${fmt(totales.utilidad_actual)}` : ""}</div>`;
    imprimirHTML(`Cuadro de compra ${venta.numero}`, cuerpo, { horizontal: true });
  };
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
  const pedido = () => descargar(`/ventas/${ventaId}/pedido?proveedor=${encodeURIComponent(provOrden || "")}&indices=${[...sel].join(",")}`).catch((e) => notify(e.message, "danger"));
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
                    {p.proveedor} · {p.lineas} prod. · {fmt(p.total)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {sel.size > 0 && !anulada && (
          <div className="panel barra-seleccion">
            <strong>{sel.size} marcado(s)</strong>
            <button className="btn btn-ghost btn-sm" disabled={ocupado} onClick={asignarMarcadas}>Asignar proveedor…</button>
            <span className="mini">Orden a</span>
            <input id="orden-a" list="cuadro-provs" className="input-mini" value={provOrden} onChange={(e) => setProvOrden(e.target.value.toUpperCase())} style={{ width: 200, padding: "5px 8px" }} />
            <datalist id="cuadro-provs">{data.proveedores.map((p) => <option key={p} value={p} />)}</datalist>
            <button className="btn btn-primary btn-sm" disabled={ocupado || !provOrden} onClick={crearOrden}>Crear orden</button>
            <button className="btn btn-ghost btn-sm" onClick={pedido}>↓ Pedido (Excel)</button>
            <button className="link mini" onClick={() => setSel(new Set())}>Quitar marcas</button>
          </div>
        )}

        <div className="table-wrap">
          <table className="table table-compacta">
            <thead><tr>
              <th><input type="checkbox" checked={porComprar.length > 0 && porComprar.every((l) => sel.has(l.indice))} onChange={(e) => setSel(e.target.checked ? new Set(porComprar.map((l) => l.indice)) : new Set())} title="Marcar todo lo por comprar" /></th>
              <th className="col-desc">Producto</th><th>Cant.</th><th>Comprar con</th><th>Compra unit.</th><th>Total compra</th><th>Venta unit.</th><th>Margen</th><th>Estado</th>
            </tr></thead>
            <tbody>
              {lineas.map((l) => {
                const [txt, tono] = ESTADO_LINEA[l.estado] || [l.estado, "neutral"];
                const bloqueada = anulada || l.estado === "comprado" || l.estado === "stock";
                const real = l.estado === "comprado" ? l.compras.find((c) => c.estado === "recibida") : null;
                return (
                  <tr key={l.indice} className={l.estado === "stock" ? "fila-stock" : !(l.compra_unit > 0) ? "fila-alerta" : ""}>
                    <td><input type="checkbox" disabled={bloqueada} checked={sel.has(l.indice)} onChange={() => toggle(l.indice)} /></td>
                    <td>{l.nombre}<div className="mini">{l.codigo ? `N° ${l.codigo}` : ""}</div></td>
                    <td className="mini">{l.cantidad} {l.unidad}</td>
                    <td>
                      {real ? <span><strong>{real.proveedor}</strong> <span className="mini">· {fmt(real.precio)}</span></span> :
                      <select className="select-linea" style={{ minWidth: 170 }} disabled={bloqueada || ocupado} value={l.proveedor} onChange={(e) => cambiarLinea(l, e.target.value)}>
                        {!l.opciones.some((o) => o.proveedor === l.proveedor) && <option value={l.proveedor}>{l.proveedor === "SIN PROVEEDOR" ? "— Elegir —" : l.proveedor}</option>}
                        {l.opciones.map((o, k) => (
                          <option key={o.proveedor} value={o.proveedor}>{o.proveedor} · {fmt(o.precio)}{k === 0 ? " ★" : ""}</option>
                        ))}
                        <option value="__otro">Otro proveedor…</option>
                      </select>}
                      {!real && (() => { const o = l.opciones.find((x) => x.proveedor === l.proveedor); return o ? <div className="mini">{o.fecha ? `precio del ${o.fecha.split("-").reverse().join("-")}` : "precio cotizado"}{l.opciones.length > 1 ? ` · ${l.opciones.length} opciones` : ""}</div> : null; })()}
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
      {subir && <SubirDocumentosVenta venta={venta} lineas={lineas} ordenes={ordenes} proveedores={data.proveedores} notify={notify} onClose={() => { setSubir(false); cargar(); }} />}
    </Modal>
  );
}
