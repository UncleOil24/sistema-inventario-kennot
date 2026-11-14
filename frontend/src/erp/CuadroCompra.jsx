import { useState, useEffect, useCallback, useMemo } from "react";
import { Modal, Cargando, Estado, confirmar, pedirTexto } from "./ui";
import { api, fmt, descargar } from "./lib";
import SubirDocumentosVenta from "./SubirDocumentosVenta";

// Cuadro de compra de una venta (Operativo y gerencia): todos los materiales en una tabla, con quién comprar cada uno.
// El sistema sugiere ("más barato" o "menos proveedores", hasta 10% más caro para juntar), tú eliges, y las órdenes
// se crean solo cuando las pides. Las facturas y boletas se suben todas juntas y quedan con el proveedor real.
const ESTADO_LINEA = {
  por_comprar: ["Por comprar", "warn"], pedido: ["Pedido", "info"], parcial: ["Parcial", "warn"], comprado: ["Comprado", "ok"],
};

export default function CuadroCompra({ ventaId, notify, onClose, irACompra }) {
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
    for (const l of marcadas) if (l.proveedor !== "SIN PROVEEDOR") c.set(l.proveedor, (c.get(l.proveedor) || 0) + 1);
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
        <button className="btn btn-ghost" onClick={() => window.print()}>Imprimir</button>
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
            <input list="cuadro-provs" className="input-mini" value={provOrden} onChange={(e) => setProvOrden(e.target.value.toUpperCase())} style={{ width: 200, padding: "5px 8px" }} />
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
                const bloqueada = anulada || l.estado === "comprado";
                const real = l.estado === "comprado" ? l.compras.find((c) => c.estado === "recibida") : null;
                return (
                  <tr key={l.indice} className={!(l.compra_unit > 0) ? "fila-alerta" : ""}>
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
                    <td className="price-cell compra">{fmt(real ? real.precio * l.cantidad : l.total_compra)}</td>
                    <td className="price-cell">{fmt(l.venta_unit)}</td>
                    <td className="mini" style={{ color: l.margen < 0 ? "var(--danger)" : undefined }}>{fmt(l.margen)} · {l.margen_pct}%</td>
                    <td>
                      <span className={`estado estado-${tono}`}>{txt}</span>
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
      {subir && <SubirDocumentosVenta venta={venta} lineas={lineas} proveedores={data.proveedores} notify={notify} onClose={() => { setSubir(false); cargar(); }} />}
    </Modal>
  );
}
