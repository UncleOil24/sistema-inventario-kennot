import { useState } from "react";
import { Modal, Estado, SelectorProducto } from "./ui";
import { api, fmt, subirArchivo, useProductos, invalidarProductos, hoyISO, authFetch, API_URL, envaseEnFactura } from "./lib";

// "Subir factura de compra": Claude lee la factura del proveedor; se compara con nuestra compra (C-0001...) si existe,
// o se crea una compra nueva. Los precios entran al catálogo con la fecha de la factura y el PDF queda en la compra.
// props: orden (compra existente, opcional), gasto (si viene de Gastos, opcional)
export default function FacturaCompra({ orden, gasto, notify, onClose, onListo, proveedores = [] }) {
  const productos = useProductos();
  const [archivo, setArchivo] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [res, setRes] = useState(null);
  const [enc, setEnc] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const leer = async () => {
    if (!archivo) return;
    setLeyendo(true);
    try {
      let r;
      if (orden) {
        const fd = new FormData();
        fd.append("archivo", archivo);
        fd.append("orden_id", orden.id);
        const resp = await authFetch(`${API_URL}/api/ordenes-compra/factura/leer`, { method: "POST", body: fd });
        const d = await resp.json();
        if (!d.ok) throw new Error(d.error || "No se pudo leer");
        r = d.data;
      } else r = await subirArchivo("/ordenes-compra/factura/leer", archivo);
      setRes(r);
      const e = r.encabezado;
      setEnc({
        proveedor: e.proveedor || orden?.proveedor_nombre || "", documento: e.numero_documento || "", fecha: e.fecha || hoyISO(),
        neto: r.totales.neto, iva: r.totales.iva, total: r.control.precios_incluyen_iva && r.control.total_documento ? r.control.total_documento : r.totales.total,
        orden_id: orden?.id || "", empresa: orden?.empresa || gasto?.empresa || "", razon_social: e.razon_social, rut: e.rut,
      });
      setLineas(r.lineas.map((l) => ({ ...l, omitir: false, accion: l.producto ? "existente" : "nuevo", nuevo: { nombre: String(l.descripcion).toUpperCase(), unidad: (l.unidad || "UNIDAD").toUpperCase() } })));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLeyendo(false); }
  };

  const set = (i, c) => setLineas((ls) => ls.map((l) => (l.i === i ? { ...l, ...c } : l)));
  const activas = lineas.filter((l) => !l.omitir && (l.accion === "nuevo" ? l.nuevo.nombre : l.producto));
  const neto = activas.reduce((s, l) => s + Math.round(Number(l.precio_neto) * Number(l.cantidad)), 0);

  const registrar = async () => {
    setGuardando(true);
    try {
      const r = await api("/ordenes-compra/factura/registrar", {
        method: "POST",
        body: {
          ...enc, archivo_token: res.archivo_token, orden_id: enc.orden_id || null, gasto_id: gasto?.id || null,
          lineas: activas.map((l) => ({
            producto_id: l.accion === "existente" ? l.producto.id : null, nuevo: l.accion === "nuevo" ? l.nuevo : null,
            descripcion: l.descripcion, cantidad: Number(l.cantidad), precio: Number(l.precio_neto), unidad: l.unidad, marca: l.marca, calce: l.calce,
          })),
        },
      });
      invalidarProductos();
      setResultado(r);
      notify(`✓ Factura registrada en ${r.orden.numero}`);
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  if (resultado) {
    return (
      <Modal titulo={`// Factura registrada · ${resultado.orden.numero}`} onClose={() => { onListo?.(resultado.orden); onClose(); }} ancho={760}
        footer={<button className="btn btn-primary" onClick={() => { onListo?.(resultado.orden); onClose(); }}>Listo</button>}>
        <div className="mini">
          Compra <strong>{resultado.orden.numero}</strong> recibida con la factura {resultado.orden.documento} · {resultado.precios} precios al catálogo (fecha de la factura)
          {resultado.productos_nuevos ? ` · ${resultado.productos_nuevos} productos nuevos en POR CLASIFICAR` : ""}{gasto ? " · el gasto se reemplazó por esta compra" : ""}.
        </div>
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
    <Modal titulo={`// Subir factura de compra${orden ? ` · ${orden.numero}` : ""}`} onClose={onClose} ancho={1200}
      footer={res ? <>
        <span className="mini" style={{ marginRight: "auto" }}>{activas.length} de {lineas.length} líneas · neto {fmt(neto)}</span>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!activas.length || !enc.proveedor || !enc.documento || guardando} onClick={registrar}>
          {guardando ? "Guardando..." : enc.orden_id ? "Registrar factura y recibir compra" : "Crear compra con esta factura"}
        </button>
      </> : <>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!archivo || leyendo} onClick={leer}>{leyendo ? <><span className="spinner"></span>Leyendo la factura...</> : "Leer factura"}</button>
      </>}>
      {!res ? (
        <>
          <div className="mini">
            Sube el PDF o la foto de la factura del proveedor. El sistema lee el N°, la fecha, los montos y cada producto, {orden ? `lo compara con la compra ${orden.numero}` : "la asocia a una compra pendiente o crea una compra nueva"} y
            pasa los precios al catálogo con la fecha de la factura. Nada se guarda hasta que confirmes.
            {gasto && <> El gasto <strong>{gasto.descripcion || ""} {fmt(gasto.monto)}</strong> se reemplazará por la compra.</>}
          </div>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
        </>
      ) : (
        <>
          <div className="fields-row tres">
            <div className="field">
              <label>Proveedor {res.proveedor_existente ? "" : "(nuevo)"}</label>
              <input list="lista-prov-fc" value={enc.proveedor} onChange={(e) => setEnc({ ...enc, proveedor: e.target.value.toUpperCase() })} />
              <datalist id="lista-prov-fc">{proveedores.map((p) => <option key={p.id} value={p.nombre} />)}</datalist>
            </div>
            <div className="field"><label>N° factura</label><input value={enc.documento} onChange={(e) => setEnc({ ...enc, documento: e.target.value })} /></div>
            <div className="field"><label>Fecha factura</label><input type="date" value={enc.fecha} onChange={(e) => setEnc({ ...enc, fecha: e.target.value })} /></div>
          </div>
          <div className="fields-row tres">
            <div className="field"><label>Neto</label><input type="number" value={enc.neto} onChange={(e) => setEnc({ ...enc, neto: e.target.value })} /></div>
            <div className="field"><label>IVA</label><input type="number" value={enc.iva} onChange={(e) => setEnc({ ...enc, iva: e.target.value })} /></div>
            <div className="field"><label>Total</label><input type="number" value={enc.total} onChange={(e) => setEnc({ ...enc, total: e.target.value })} /></div>
          </div>
          <div className="fields-row tres">
            {!orden && (
              <div className="field"><label>Compra pendiente de este proveedor</label>
                <select value={enc.orden_id} onChange={(e) => setEnc({ ...enc, orden_id: e.target.value })}>
                  <option value="">Crear compra nueva</option>
                  {res.sugeridas.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.fecha} · {fmt(o.total)}</option>)}
                </select></div>
            )}
            <div className="field"><label>Empresa que compra</label>
              <select value={enc.empresa} onChange={(e) => setEnc({ ...enc, empresa: e.target.value })}>
                <option value="">— Elegir —</option><option value="kenott">Kenott</option><option value="tactics">Tactics</option>
              </select></div>
          </div>
          <div className="pago-form">
            {res.control.precios_incluyen_iva && <span className="estado estado-info">Precios venían con IVA: ya se dividieron por 1,19</span>}
            {res.control.cuadra === true && <span className="estado estado-ok">✓ La suma de las líneas cuadra con el total de la factura</span>}
            {res.control.cuadra === false && <span className="estado estado-warn">⚠ La suma de las líneas ({fmt(res.control.suma_lineas)}) no cuadra con la factura ({fmt(res.control.total_documento)}): revisa</span>}
          </div>
          {res.orden && res.faltan.length > 0 && <div className="aviso">En la compra {res.orden.numero} y no en la factura: {res.faltan.map((f) => `${f.nombre} (${f.cantidad})`).join(" · ")}</div>}
          {res.truncado && <div className="aviso">La factura es muy larga y la lectura pudo quedar incompleta.</div>}
          <div className="table-wrap">
            <table className="table table-compacta">
              <thead><tr><th></th><th>En la factura</th><th>Cant.</th><th>Neto unit.</th><th className="col-desc">Producto nuestro</th><th>Catálogo hoy</th>{res.orden && <th>vs compra</th>}</tr></thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.i} className={l.omitir ? "fila-anulada" : l.alza || l.diferencia ? "fila-alerta" : ""}>
                    <td><input type="checkbox" checked={!l.omitir} onChange={(e) => set(l.i, { omitir: !e.target.checked })} title="Incluir" /></td>
                    <td>{l.descripcion}<div className="mini">{[l.codigo_proveedor, l.marca, l.unidad].filter(Boolean).join(" · ")}</div></td>
                    <td><input className="qty-input" style={{ width: 60 }} type="number" value={l.cantidad} onChange={(e) => set(l.i, { cantidad: e.target.value })} /></td>
                    <td><input className="qty-input" style={{ width: 90 }} type="number" value={l.precio_neto} onChange={(e) => set(l.i, { precio_neto: e.target.value })} /></td>
                    <td>
                      <select className="select-linea" value={l.accion} onChange={(e) => set(l.i, { accion: e.target.value })} style={{ marginBottom: 4 }}>
                        <option value="existente">Producto del catálogo</option>
                        <option value="nuevo">Producto nuevo (POR CLASIFICAR)</option>
                      </select>
                      {l.accion === "existente"
                        ? <SelectorProducto valor={l.producto} candidatos={l.candidatos} productos={productos} precioDe={(p) => p.precio_compra} onChange={(p) => set(l.i, { producto: p, calce: "exacto" })} />
                        : <input className="qty-input" style={{ width: "100%", textAlign: "left" }} value={l.nuevo.nombre} onChange={(e) => set(l.i, { nuevo: { ...l.nuevo, nombre: e.target.value.toUpperCase() } })} />}
                      {l.accion === "existente" && <Estado valor={l.calce} />}
                      {l.accion === "existente" && l.producto && (() => { const pr = productos.find((x) => x.id === l.producto.id) || l.producto; const e = envaseEnFactura(l, pr); return e ? (
                        <div className="aviso-envase">Facturado por unidad: {l.cantidad} un = {e.cantidad} envase(s) de {e.contenido} a ${e.precio.toLocaleString("es-CL")}.{" "}
                          <button className="link" onClick={() => set(l.i, { cantidad: e.cantidad, precio_neto: e.precio, envase_ok: true })}>Convertir</button>{" · "}
                          <button className="link" onClick={() => set(l.i, { envase_ok: true })}>Está bien así</button></div>) : null; })()}
                    </td>
                    <td className="mini">
                      {l.accion === "existente" && l.producto ? (Number(l.producto.precio_compra) > 0 ? <>{fmt(l.producto.precio_compra)} {l.producto.proveedor}
                        {l.alza && <div style={{ color: "var(--danger)" }}>▲ alza {l.alza}%</div>}
                        {Number(l.precio_neto) < Number(l.producto.precio_compra) && <div style={{ color: "var(--success)" }}>más barato</div>}</> : <span style={{ color: "var(--success)" }}>sin precio: se llena</span>) : "—"}
                    </td>
                    {res.orden && <td className="mini">{l.diferencia || "✓"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mini">Los precios entran al catálogo con la fecha de la factura y las reglas de siempre (mismo proveedor: el más reciente; entre proveedores: el más barato; los confirmados se respetan).</div>
        </>
      )}
    </Modal>
  );
}
