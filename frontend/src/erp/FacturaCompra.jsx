import { useState, useEffect } from "react";
import { Modal, Estado, SelectorProducto, RepartoLinea, repartoParaEnviar, PresentacionLinea, presentacionParaEnviar, prepararLineas, EmpresaCompra, AvisoCamposClave, CuadreDocumento, confirmar, aplicarFactorPrecios, montosTrasFactor, TIPOS_GASTO } from "./ui";
import { api, fmt, subirArchivo, useProductos, invalidarProductos, cargarProductos, hoyISO, authFetch, API_URL, envaseEnFactura, TIPOS_PAGO, esGerenciaSesion } from "./lib";
import { PreciosProducto } from "./Catalogo";

// Líneas a las que puede ir una línea de la factura ("Es para:"): las de la compra y las de la venta que no estaban en ella
function itemsPara(res) {
  const oc = (res?.orden_items || []).map((x) => ({ ...x, clave: `o${x.k}`, etiqueta: res.orden?.numero || "Pedido", grupo: res.orden ? `De esta compra ${res.orden.numero}` : "" }));
  const enOrden = new Set(oc.map((x) => Number(x.producto_id)));
  const vt = (res?.venta_items || []).filter((x) => !enOrden.has(Number(x.producto_id)))
    .map((x) => ({ ...x, clave: `v${x.k}`, etiqueta: res.venta?.numero || "Venta", grupo: res.orden ? `De la venta ${res.venta?.numero || ""} (no estaban en esta compra)` : `De la venta ${res.venta?.numero || ""}` }));
  return [...oc, ...vt];
}

// "Subir factura de compra": Claude lee la factura del proveedor; se compara con nuestra compra (C-0001...) si existe,
// o se crea una compra nueva. Los precios entran al catálogo con la fecha de la factura y el PDF queda en la compra.
// props: orden (compra existente, opcional), gasto (si viene de Gastos, opcional),
// bandeja (documento de la bandeja: ya está subido y leído; se lee solo al abrir)
export default function FacturaCompra({ orden, gasto, bandeja, notify, onClose, onListo, proveedores = [] }) {
  // Al abrir se cargan de nuevo los productos: así los precios son los de hoy (aunque el detalle se haya subido en otro equipo)
  useState(() => invalidarProductos());
  const productos = useProductos();
  const gerencia = esGerenciaSesion();
  const [verPrecios, setVerPrecios] = useState(null);
  // Si la lista de productos llega (o cambia) después de leer, se actualiza el precio de cada línea
  useEffect(() => {
    if (!productos.length) return;
    setLineas((ls) => ls.map((l) => {
      if (!l.producto) return l;
      const p = productos.find((x) => x.id === l.producto.id);
      return p && (Number(p.precio_compra) || 0) !== (Number(l.producto.precio_compra) || 0) ? { ...l, producto: { ...l.producto, precio_compra: Number(p.precio_compra) || 0, proveedor: p.proveedor } } : l;
    }));
  }, [productos]);
  const [archivo, setArchivo] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [res, setRes] = useState(null);
  const [enc, setEnc] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [ventas, setVentas] = useState([]); // para mandar líneas a otra venta, como complemento o como gasto
  useEffect(() => { api("/ventas").then((vs) => setVentas((vs || []).filter((v) => v.estado !== "anulada"))).catch(() => {}); }, []);

  const leer = async () => {
    if (!archivo && !bandeja) return;
    setLeyendo(true);
    try {
      let r;
      if (bandeja) r = await api("/ordenes-compra/factura/leer", { method: "POST", body: { bandeja_id: bandeja.id, orden_id: orden?.id || undefined } });
      else if (orden) {
        const fd = new FormData();
        fd.append("archivo", archivo);
        fd.append("orden_id", orden.id);
        const resp = await authFetch(`${API_URL}/api/ordenes-compra/factura/leer`, { method: "POST", body: fd });
        const d = await resp.json();
        if (!d.ok) throw new Error(d.error || "No se pudo leer");
        r = d.data;
      } else r = await subirArchivo("/ordenes-compra/factura/leer", archivo);
      const prods = await cargarProductos().catch(() => productos);
      setRes(r);
      const e = r.encabezado;
      setEnc({
        proveedor: e.proveedor || orden?.proveedor_nombre || "", documento: e.numero_documento || "", fecha: e.fecha || hoyISO(),
        neto: r.totales.neto, iva: r.totales.iva, total: r.control.precios_incluyen_iva && r.control.total_documento ? r.control.total_documento : r.totales.total,
        orden_id: orden?.id || "", empresa: e.empresa_documento || orden?.empresa || gasto?.empresa || "", razon_social: e.razon_social, rut: e.rut, tipo_pago: orden?.tipo_pago || "contado",
      });
      const items = (r.orden_items || []).map((x) => ({ ...x, clave: `o${x.k}` }));
      setLineas(prepararLineas(r.lineas.map((l) => ({ ...l, reparto_de: l.producto?.id, omitir: false, accion: l.producto && l.calce !== "parecido" ? "existente" : "nuevo", nuevo: { nombre: String(l.descripcion).toUpperCase(), unidad: (l.unidad || "UNIDAD").toUpperCase() } })), items, prods));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLeyendo(false); }
  };

  useEffect(() => { if (bandeja) leer(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i, c) => setLineas((ls) => ls.map((l) => (l.i === i ? { ...l, ...c } : l)));
  const esGasto = (l) => l.destino?.tipo === "gasto";
  const activas = lineas.filter((l) => !l.omitir && (esGasto(l) || (l.accion === "nuevo" ? l.nuevo.nombre : l.producto)));
  const ventaActual = res?.venta?.id || null;
  // Destino incompleto (falta elegir venta o línea): no se puede registrar
  const destinoIncompleto = activas.some((l) => (l.destino?.tipo === "venta" && !l.destino.venta_id) || (l.destino?.tipo === "complemento" && (!l.destino.venta_id || l.destino.indice === "" || l.destino.indice == null)));
  // Cómo queda repartida la factura (neto de las líneas)
  const repartoFactura = (() => {
    const m = new Map();
    const sumar = (k, v) => m.set(k, (m.get(k) || 0) + v);
    for (const l of activas) {
      const v = Math.round(Number(l.precio_neto) * Number(l.cantidad)) || 0;
      const d = l.destino || {};
      const vn = (id) => ventas.find((x) => String(x.id) === String(id))?.numero || "otra venta";
      if (d.tipo === "gasto") sumar(`Gasto ${d.venta_id ? vn(d.venta_id) : "general"}`, v);
      else if (d.tipo === "venta" || d.tipo === "complemento") sumar(vn(d.venta_id), v);
      else sumar(orden ? `Esta compra (${orden.numero})` : res?.venta ? `Esta compra (${res.venta.numero})` : "Esta compra", v);
    }
    return [...m.entries()];
  })();
  const neto = activas.reduce((s, l) => s + Math.round(Number(l.precio_neto) * Number(l.cantidad)), 0);

  const registrar = async () => {
    if (res.ya_registrada?.length && !(await confirmar(`Este documento ya está registrado: ${res.ya_registrada.map((o) => `${o.numero} (${o.venta})`).join(", ")}.\n\nGuardarlo otra vez DUPLICA el monto (dos compras y doble IVA). Si parte de la factura era para otra venta, no la subas de nuevo: abre la compra ya registrada y usa "Repartir entre ventas".`, { titulo: "Documento ya registrado", boton: "Guardar igual", peligro: true }))) return;
    setGuardando(true);
    try {
      const r = await api("/ordenes-compra/factura/registrar", {
        method: "POST",
        body: {
          ...enc, archivo_token: res.archivo_token, orden_id: enc.orden_id || null, gasto_id: gasto?.id || null, bandeja_id: res.bandeja_id || null,
          ordenes_por_venta: Object.fromEntries(activas.filter((l) => l.destino?.tipo === "venta" && l.destino.orden_id).map((l) => [l.destino.venta_id, l.destino.orden_id])),
          lineas: activas.map((l) => {
            const d = l.destino || {};
            if (d.tipo === "gasto") return { destino: { tipo: "gasto", gasto_tipo: d.gasto_tipo || "general", venta_id: d.venta_id || null, descripcion: d.descripcion || "" },
              descripcion: l.descripcion, cantidad: Number(l.cantidad), precio: Number(l.precio_neto) };
            const base = presentacionParaEnviar(l, repartoParaEnviar(l)); // bidón 5 L → litros, con su costo por litro
            const otra = (d.tipo === "venta" || d.tipo === "complemento") && d.venta_id;
            return {
              producto_id: l.accion === "existente" ? l.producto.id : null, nuevo: l.accion === "nuevo" ? l.nuevo : null,
              descripcion: l.descripcion, unidad: l.unidad, marca: l.marca, calce: l.calce, ...base,
              renombrar: l.accion === "existente" && l.producto && l.renombrar && l.renombrar.trim() && l.renombrar.trim() !== l.producto.nombre ? l.renombrar.trim() : null,
              ...(otra ? { reparto: [{ venta_id: Number(d.venta_id), cantidad: base.cantidad }],
                para: d.tipo === "complemento" ? { tipo: "complemento", indice: Number(d.indice), venta_id: Number(d.venta_id) } : undefined } : {}),
            };
          }),
        },
      });
      invalidarProductos();
      setResultado(r);
      notify(r.orden ? `✓ Factura registrada en ${r.orden.numero}${r.gastos?.length ? ` + ${r.gastos.length} gasto(s)` : ""}` : `✓ Factura registrada como ${r.gastos?.length || 0} gasto(s)`);
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  if (resultado) {
    return (
      <Modal titulo={`// Factura registrada${resultado.orden ? ` · ${resultado.orden.numero}` : " como gasto"}`} onClose={() => { onListo?.(resultado.orden); onClose(); }} ancho={760}
        footer={<button className="btn btn-primary" onClick={() => { onListo?.(resultado.orden); onClose(); }}>Listo</button>}>
        {resultado.gastos?.length > 0 && <div className="mini" style={{ marginBottom: 6 }}>Gastos: {resultado.gastos.map((g) => `${g.descripcion} ${fmt(g.monto)} (IVA crédito ${fmt(g.iva)})${g.venta ? ` → ${g.venta}` : " → gasto general"}`).join(" · ")}</div>}
        {resultado.orden && <div className="mini">
          Compra <strong>{resultado.orden.numero}</strong> recibida con la factura {resultado.orden.documento} · {resultado.precios} precios al catálogo (fecha de la factura)
          {resultado.productos_nuevos ? ` · ${resultado.productos_nuevos} productos nuevos en POR CLASIFICAR` : ""}{gasto ? " · el gasto se reemplazó por esta compra" : ""}.
          {resultado.reparto?.length > 1 && <div>Repartida entre ventas: {resultado.reparto.map((p) => `${p.numero} ${fmt(p.total)}`).join(" · ")} (misma factura, se paga junta).</div>}
          {resultado.compras_ajustadas?.length > 0 && <div>Se quitaron de otra compra (ya venían en esta factura): {resultado.compras_ajustadas.map((c) => `${c.numero}${c.anulada ? " (quedó vacía y se anuló)" : ""}`).join(", ")}.</div>}
          {resultado.renombrados ? <div>{resultado.renombrados} descripción(es) del catálogo actualizada(s).</div> : null}
          {resultado.no_vinieron?.length > 0 && <div style={{ color: "var(--danger)" }}>No vino: {resultado.no_vinieron.map((x) => `${x.nombre} (${x.cantidad})`).join(", ")}. Vuelve a "por comprar" en el cuadro de su venta.</div>}
        </div>}
        {resultado.alzas.length > 0 && (
          <div className="aviso" style={{ marginTop: 8 }}>
            <strong>Alza de precio (más de 10%):</strong> quedaron marcados en REVISAR y gerencia recibe el aviso.
            <ul style={{ margin: "6px 0 0 18px" }}>{resultado.alzas.map((a) => <li key={a.producto_id}>{a.nombre}: {fmt(a.antes)} → {fmt(a.ahora)} (+{a.pct}%)</li>)}</ul>
          </div>
        )}
        {resultado.cambios_precio.length > 0 && (
          <table className="table table-compacta" style={{ marginTop: 8 }}>
            <thead><tr><th>N°</th><th>Producto</th><th>Antes</th><th>Ahora</th><th>Proveedor</th></tr></thead>
            <tbody>{resultado.cambios_precio.map((c) => <tr key={c.codigo}><td className="id-cell">{c.codigo}</td><td>{c.nombre}</td><td className="price-cell compra">{c.antes ? fmt(c.antes) : "sin precio"}</td><td className="price-cell">{fmt(c.despues)}</td><td className="mini">{c.proveedor}</td></tr>)}</tbody>
          </table>
        )}
      </Modal>
    );
  }

  return (
    <Modal titulo={`// Subir factura de compra${orden ? ` · ${orden.numero}` : ""}${res?.venta ? ` · para ${res.venta.numero}${res.venta.cliente ? ` · ${res.venta.cliente}` : ""}` : ""}`} onClose={onClose} ancho="min(1600px, 98vw)"
      footer={res ? <>
        <span className="mini" style={{ marginRight: "auto" }}>{activas.length} de {lineas.length} líneas · neto {fmt(neto)}</span>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        {!enc.empresa && <span className="mini" style={{ color: "var(--danger)" }}>Elige la empresa que compra</span>}
        {destinoIncompleto && <span className="mini" style={{ color: "var(--warn)" }}>Falta elegir la venta o la línea de destino</span>}
        {activas.some((l) => l.decidir && !esGasto(l)) && <span className="mini" style={{ color: "var(--warn)" }}>Define en las líneas marcadas si es el mismo producto o uno nuevo</span>}
        <button className="btn btn-primary" disabled={!activas.length || !enc.proveedor || !enc.documento || !enc.empresa || guardando || destinoIncompleto || activas.some((l) => l.decidir && !esGasto(l))} onClick={registrar}>
          {guardando ? "Guardando..." : enc.orden_id ? "Registrar factura y recibir compra" : "Crear compra con esta factura"}
        </button>
      </> : <>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={(!archivo && !bandeja) || leyendo} onClick={leer}>{leyendo ? <><span className="spinner"></span>Leyendo la factura...</> : "Leer factura"}</button>
      </>}>
      {!res ? (
        <>
          <div className="mini">
            Sube el PDF o la foto de la factura del proveedor. El sistema lee el N°, la fecha, los montos y cada producto, {orden ? `lo compara con la compra ${orden.numero}` : "la asocia a una compra pendiente o crea una compra nueva"} y
            pasa los precios al catálogo con la fecha de la factura. Nada se guarda hasta que confirmes.
            {gasto && <> El gasto <strong>{gasto.descripcion || ""} {fmt(gasto.monto)}</strong> se reemplazará por la compra.</>}
          </div>
<div className="aviso-clave" style={{ marginTop: 8 }}>⚠ Cada factura se sube <strong>una sola vez</strong> al sistema. Si sirve a varias ventas, se reparte al subirla (en "Para:" de cada línea) o después con "Repartir entre ventas" en la compra. Subirla de nuevo duplica el monto y el IVA.</div>
          {bandeja ? <div style={{ marginTop: 8 }}>Documento de la bandeja: <strong>{bandeja.nombre_archivo}</strong>{leyendo ? " · leyendo..." : ""}</div>
            : <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xml" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />}
        </>
      ) : (
        <>
          <AvisoCamposClave />
          {(() => {
            // Productos que también necesitan otras ventas: se dice cuáles, para no confundir proyectos
            const propia = res.venta?.id;
            const otras = new Map();
            for (const l of lineas) for (const c of l.ventas_pendientes || []) if (c.venta_id !== propia) otras.set(c.venta_id, `${c.numero}${c.cliente ? ` · ${c.cliente}` : ""}`);
            return otras.size > 0 && <div className="aviso" style={{ margin: "0 0 8px" }}>
              {res.venta ? <>Esta compra es de <strong>{res.venta.numero}{res.venta.cliente ? ` · ${res.venta.cliente}` : ""}</strong>. </> : null}
              Algunos productos también los necesita{otras.size > 1 ? "n" : ""} <strong>{[...otras.values()].join(" / ")}</strong>: en cada línea, "Para:" dice cuánto va a cada venta.</div>;
          })()}
          <div className="fields-row tres">
            <div className={`field campo-clave ${enc.proveedor ? "" : "vacio"}`}>
              <label>★ Proveedor {res.proveedor_existente ? "" : "(nuevo)"}</label>
              <input list="lista-prov-fc" value={enc.proveedor} onChange={(e) => setEnc({ ...enc, proveedor: e.target.value.toUpperCase() })} />
              <datalist id="lista-prov-fc">{proveedores.map((p) => <option key={p.id} value={p.nombre} />)}</datalist>
            </div>
            <div className={`field campo-clave ${enc.documento ? "" : "vacio"}`}><label>★ N° factura</label><input value={enc.documento} onChange={(e) => setEnc({ ...enc, documento: e.target.value })} /></div>
            <div className={`field campo-clave ${enc.fecha ? "" : "vacio"}`}><label>★ Fecha factura</label><input type="date" value={enc.fecha} onChange={(e) => setEnc({ ...enc, fecha: e.target.value })} /></div>
            <div className="field campo-clave"><label>★ Tipo de pago</label><select value={enc.tipo_pago} onChange={(e) => setEnc({ ...enc, tipo_pago: e.target.value })}>{TIPOS_PAGO.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
          </div>
          <div className="fields-row tres">
            <div className="field campo-clave"><label>★ Neto</label><input type="number" value={enc.neto} onChange={(e) => setEnc({ ...enc, neto: e.target.value })} /></div>
            <div className="field campo-clave"><label>★ IVA</label><input type="number" value={enc.iva} onChange={(e) => setEnc({ ...enc, iva: e.target.value })} /></div>
            <div className="field campo-clave"><label>★ Total</label><input type="number" value={enc.total} onChange={(e) => setEnc({ ...enc, total: e.target.value })} /></div>
          </div>
          <div className="fields-row tres">
            {!orden && (
              <div className="field"><label>Compra pendiente de este proveedor</label>
                <select value={enc.orden_id} onChange={(e) => setEnc({ ...enc, orden_id: e.target.value })}>
                  <option value="">Crear compra nueva</option>
                  {res.sugeridas.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.fecha} · {fmt(o.total)}</option>)}
                </select></div>
            )}
            <EmpresaCompra valor={enc.empresa} detectada={res.encabezado.empresa_documento} ventaEmpresa={res.venta?.empresa || orden?.empresa || null}
              onChange={(empresa) => setEnc({ ...enc, empresa })} />
          </div>
          <div className="pago-form">
            {res.control.precios_incluyen_iva && <span className="estado estado-info">Precios venían con IVA: ya se dividieron por 1,19</span>}
            <CuadreDocumento control={res.control} lineas={lineas} onAplicar={(f) => { const nl = aplicarFactorPrecios(lineas, f); setLineas(nl); setEnc({ ...enc, ...montosTrasFactor(nl, res.control) }); }} />
          </div>
          {res.ya_registrada?.length > 0 && <div className="aviso" style={{ color: "var(--danger)" }}>⚠ Este documento ya está registrado: {res.ya_registrada.map((o) => `${o.numero} (${o.venta})`).join(", ")}. Guardarlo otra vez duplica el monto; para pasar parte a otra venta usa "Repartir entre ventas" en esa compra.</div>}
          {res.orden && res.faltan.length > 0 && <div className="aviso">En la compra {res.orden.numero} y no en la factura: {res.faltan.map((f) => `${f.nombre} (${f.cantidad})`).join(" · ")}</div>}
          {res.truncado && <div className="aviso">La factura es muy larga y la lectura pudo quedar incompleta.</div>}
          <div className="table-wrap">
            <table className="table table-compacta tabla-documento">
              <thead><tr><th></th><th>En la factura</th><th>Cant.</th><th>Neto unit.</th><th className="col-desc">Producto nuestro</th><th>Catálogo hoy</th>{res.orden && <th>vs compra</th>}</tr></thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.i} className={l.omitir ? "fila-anulada" : l.alza || l.diferencia ? "fila-alerta" : ""}>
                    <td><input type="checkbox" checked={!l.omitir} onChange={(e) => set(l.i, { omitir: !e.target.checked })} title="Incluir" /></td>
                    <td>{l.descripcion}
                      {l.omitir && <div className="aviso-fuera">Queda fuera: su monto y su IVA no se registran. <button className="link" onClick={() => set(l.i, { omitir: false, destino: { tipo: "gasto", gasto_tipo: "general", venta_id: ventaActual } })}>Es un gasto (recupera IVA)</button></div>}<div className="mini">{[l.codigo_proveedor, l.marca, l.unidad].filter(Boolean).join(" · ")}</div></td>
                    <td><input className="qty-input" style={{ width: 60 }} type="number" value={l.cantidad} onChange={(e) => set(l.i, { cantidad: e.target.value })} /></td>
                    <td><input className="qty-input" style={{ width: 90 }} type="number" value={l.precio_neto} onChange={(e) => set(l.i, { precio_neto: e.target.value })} /></td>
                    <td>
                      {!l.omitir && <DestinoLinea l={l} ventas={ventas} ventaActual={ventaActual} onChange={(destino) => set(l.i, { destino })} />}
                      {!esGasto(l) && <>
                      <select className="select-linea" value={l.accion} onChange={(e) => set(l.i, { accion: e.target.value })} style={{ marginBottom: 4 }}>
                        <option value="existente">Producto del catálogo</option>
                        <option value="nuevo">Producto nuevo (POR CLASIFICAR)</option>
                      </select>
                      {l.accion === "existente"
                        ? <><SelectorProducto valor={l.producto} candidatos={l.candidatos} productos={productos} precioDe={(p) => p.precio_compra} onChange={(p) => set(l.i, { producto: p, calce: "exacto", renombrar: undefined })} />
                          {gerencia && l.producto && (l.renombrar === undefined
                            ? <div><button className="link mini" title="Cambiar la descripción del producto en el catálogo al registrar" onClick={() => set(l.i, { renombrar: l.producto.nombre })}>✎ editar descripción</button></div>
                            : <div style={{ marginTop: 4 }}>
                                <input className="qty-input" style={{ width: "100%", textAlign: "left" }} aria-label="Nueva descripción del producto" value={l.renombrar} onChange={(e) => set(l.i, { renombrar: e.target.value.toUpperCase() })} />
                                <div className="mini">{l.renombrar.trim() && l.renombrar.trim() !== l.producto.nombre ? <>Al registrar, N° {l.producto.codigo} se llamará así en todo el catálogo.</> : "Sin cambios en la descripción."} <button className="link mini" onClick={() => set(l.i, { renombrar: undefined })}>cancelar</button></div>
                              </div>)}</>
                        : <input className="qty-input" style={{ width: "100%", textAlign: "left" }} value={l.nuevo.nombre} onChange={(e) => set(l.i, { nuevo: { ...l.nuevo, nombre: e.target.value.toUpperCase() } })} />}
                      {l.accion === "existente" && <Estado valor={l.calce} />}
                      <PresentacionLinea l={l} productos={productos} complementos={res.complementos || []} onChange={(c) => set(l.i, c)}
                        items={itemsPara(res)} />
                      {!l.destino?.tipo || l.destino.tipo === "compra" ? <RepartoLinea l={l} onChange={(r) => set(l.i, { reparto: r })} /> : null}
                      {l.accion === "existente" && l.producto && (() => { const pr = productos.find((x) => x.id === l.producto.id) || l.producto; const e = envaseEnFactura(l, pr); return e ? (
                        <div className="aviso-envase">Facturado por unidad: {l.cantidad} un = {e.cantidad} envase(s) de {e.contenido} a ${e.precio.toLocaleString("es-CL")}.{" "}
                          <button className="link" onClick={() => set(l.i, { cantidad: e.cantidad, precio_neto: e.precio, envase_ok: true })}>Convertir</button>{" · "}
                          <button className="link" onClick={() => set(l.i, { envase_ok: true })}>Está bien así</button></div>) : null; })()}
                      </>}
                    </td>
                    <td className="mini">
                      {esGasto(l) ? "no va al catálogo" : l.accion === "existente" && l.producto ? (Number(l.producto.precio_compra) > 0 ? <>{fmt(l.producto.precio_compra)} {l.producto.proveedor}
                        {l.alza && <div style={{ color: "var(--danger)" }}>▲ alza {l.alza}%</div>}
                        {Number(l.precio_neto) < Number(l.producto.precio_compra) && <div style={{ color: "var(--success)" }}>más barato</div>}</> : <>
                        <span style={{ color: "var(--success)" }}>sin precio en el catálogo: se llena con esta factura</span>
                        {gerencia && <div><button className="link mini" onClick={() => setVerPrecios(l.producto)}>ver precios de N° {l.producto.codigo}</button></div>}
                        {(() => { const par = (l.candidatos || []).find((c) => c.id !== l.producto.id && Number(c.precio_compra) > 0); return par ? <div className="aviso-parecido">Parecido con precio: N° {par.codigo} {par.nombre} {fmt(par.precio_compra)} <button className="link mini" onClick={() => set(l.i, { producto: par, calce: "exacto", renombrar: undefined })}>usar este</button></div> : null; })()}
                      </>) : "—"}
                    </td>
                    {res.orden && <td className="mini">{l.para ? "✓ asociada a mano (ver abajo del producto)" : l.diferencia || "✓"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {repartoFactura.length > 1 && <div className="reparto-factura">Así queda la factura (neto): {repartoFactura.map(([k, v]) => <span key={k}><b>{k}</b> {fmt(v)}</span>)}
            <span className="mini">· el IVA se reparte en la misma proporción: todo queda como crédito fiscal, con el mismo N° de factura.</span></div>}
          {verPrecios && <PreciosProducto producto={verPrecios} puedeConfirmar={gerencia} proveedores={proveedores} notify={notify} onClose={() => setVerPrecios(null)} onCambio={() => {}} />}
          <div className="mini">Los precios entran al catálogo con la fecha de la factura y las reglas de siempre (mismo proveedor: el más reciente; entre proveedores: el más barato; los confirmados se respetan).</div>
        </>
      )}
    </Modal>
  );
}

// Destino de una línea de la factura: esta compra, otra venta (con una compra abierta suya o compra nueva),
// complemento de una línea de otra venta, o gasto (con su parte del IVA como crédito fiscal)
function DestinoLinea({ l, ventas, ventaActual, onChange }) {
  const d = l.destino || { tipo: "compra" };
  const [compras, setCompras] = useState({});
  const otras = ventas.filter((v) => v.id !== ventaActual);
  const vSel = ventas.find((v) => String(v.id) === String(d.venta_id));
  useEffect(() => {
    if (d.tipo !== "venta" || !d.venta_id || compras[d.venta_id]) return;
    api(`/ordenes-compra?venta_id=${d.venta_id}`).then((os) => setCompras((c) => ({ ...c, [d.venta_id]: (os || []).filter((o) => !["anulada", "recibida"].includes(o.estado)) }))).catch(() => {});
  }, [d.tipo, d.venta_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cambiarTipo = (tipo) => onChange(tipo === "compra" ? null
    : tipo === "gasto" ? { tipo, gasto_tipo: "general", venta_id: ventaActual || "" }
    : { tipo, venta_id: "", orden_id: "", indice: "" });
  const corto = (v) => `${v.numero} · ${String(v.cliente_nombre || "").replace(/^(I\.?\s*)?MUNICIPALIDAD DE /i, "Muni ").slice(0, 28)}`;
  return (
    <div className={`destino-linea ${d.tipo !== "compra" ? "activo" : ""}`}>
      <select className="select-linea" aria-label="Destino de la línea" value={d.tipo} onChange={(e) => cambiarTipo(e.target.value)}>
        <option value="compra">→ Esta compra</option>
        <option value="venta">→ Otra venta</option>
        <option value="complemento">→ Complemento en otra venta</option>
        <option value="gasto">→ Gasto (recupera IVA)</option>
      </select>
      {(d.tipo === "venta" || d.tipo === "complemento") && (
        <select className="select-linea" aria-label="Venta de destino" value={d.venta_id || ""} onChange={(e) => onChange({ ...d, venta_id: e.target.value, orden_id: "", indice: "" })}>
          <option value="">— elige la venta —</option>
          {otras.map((v) => <option key={v.id} value={v.id}>{corto(v)}</option>)}
        </select>)}
      {d.tipo === "venta" && d.venta_id && (
        <select className="select-linea" aria-label="Compra de esa venta" value={d.orden_id || ""} onChange={(e) => onChange({ ...d, orden_id: e.target.value })}>
          <option value="">Compra nueva de {vSel?.numero} (misma factura)</option>
          {(compras[d.venta_id] || []).map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.proveedor_nombre} · {fmt(o.total)}</option>)}
        </select>)}
      {d.tipo === "complemento" && vSel && (
        <select className="select-linea" aria-label="Línea de esa venta" value={d.indice ?? ""} onChange={(e) => onChange({ ...d, indice: e.target.value })}>
          <option value="">— complemento de… —</option>
          {(vSel.items || []).map((it, k) => it.complemento_de ? null : <option key={k} value={k}>{(it.descripcion_cliente || it.nombre || "").slice(0, 60)}</option>)}
        </select>)}
      {d.tipo === "gasto" && <>
        <select className="select-linea" aria-label="Tipo de gasto" value={d.gasto_tipo} onChange={(e) => onChange({ ...d, gasto_tipo: e.target.value })}>
          {TIPOS_GASTO.filter(([v]) => v !== "mano_obra").map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <select className="select-linea" aria-label="Venta del gasto" value={d.venta_id || ""} onChange={(e) => onChange({ ...d, venta_id: e.target.value })}>
          {ventaActual && <option value={ventaActual}>De esta venta</option>}
          <option value="">Gasto general (sin venta)</option>
          {otras.map((v) => <option key={v.id} value={v.id}>{corto(v)}</option>)}
        </select>
        <div className="mini">No crea producto ni cambia precios; su IVA queda como crédito de la empresa de la factura.</div>
      </>}
      {d.tipo === "complemento" && <div className="mini">Se agrega a esa venta sin precio para el cliente; su costo es de esa venta.</div>}
    </div>
  );
}
