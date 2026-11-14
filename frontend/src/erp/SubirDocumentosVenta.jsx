import { useState } from "react";
import { Modal, Estado, SelectorProducto } from "./ui";
import { api, fmt, subirArchivo, useProductos, invalidarProductos, hoyISO, envaseEnFactura } from "./lib";

// "Subir facturas y boletas" de una venta: se suben todos los documentos juntos; el sistema lee cada uno
// (proveedor, N°, fecha, productos y montos), lo calza con las líneas de la venta y lo guarda con el proveedor
// que aparece en el documento. Lo que no es mercadería (flete, combustible, otros) queda como gasto de la venta.
const TIPOS_GASTO = [["flete", "Flete / despacho"], ["combustible", "Combustible / peajes"], ["comision", "Comisión"], ["general", "Otro gasto"]];

export default function SubirDocumentosVenta({ venta, lineas: lineasVenta = [], proveedores = [], notify, onClose }) {
  const productos = useProductos();
  const [archivos, setArchivos] = useState([]);
  const [docs, setDocs] = useState([]);       // [{ archivo, estado: leyendo|leido|error|guardado|omitido, res, enc, lineas, como, gasto, error, resultado }]
  const [actual, setActual] = useState(0);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const leerTodos = async () => {
    setLeyendo(true);
    const lista = archivos.map((a) => ({ archivo: a, estado: "leyendo" }));
    setDocs(lista);
    for (let k = 0; k < lista.length; k++) {
      try {
        const r = await subirArchivo("/ordenes-compra/factura/leer", lista[k].archivo, { venta_id: venta.id });
        const e = r.encabezado;
        const boleta = e.tipo_documento === "boleta";
        const propia = r.sugeridas.find((o) => o.venta_id === venta.id && o.proveedor_nombre === (r.proveedor_existente?.nombre || e.proveedor));
        lista[k] = {
          ...lista[k], estado: "leido", res: r, como: "materiales",
          enc: {
            tipo_documento: boleta ? "boleta" : "factura", proveedor: e.proveedor || "", documento: e.numero_documento || "", fecha: e.fecha || hoyISO(),
            neto: r.totales.neto, iva: boleta ? 0 : r.totales.iva,
            total: e.total_documento || (r.control.precios_incluyen_iva && r.control.total_documento ? r.control.total_documento : r.totales.total),
            orden_id: propia ? String(propia.id) : "", razon_social: e.razon_social, rut: e.rut,
          },
          gasto: { tipo: "flete", descripcion: "" },
          lineas: r.lineas.map((l) => ({ ...l, omitir: false, accion: l.producto ? "existente" : "nuevo", nuevo: { nombre: String(l.descripcion).toUpperCase(), unidad: (l.unidad || "UNIDAD").toUpperCase() } })),
        };
      } catch (err) { lista[k] = { ...lista[k], estado: "error", error: err.message }; }
      setDocs([...lista]);
    }
    setActual(Math.max(0, lista.findIndex((d) => d.estado === "leido")));
    setLeyendo(false);
  };

  const d = docs[actual];
  const setDoc = (cambios) => setDocs((ds) => ds.map((x, k) => (k === actual ? { ...x, ...cambios } : x)));
  const setEnc = (c) => setDoc({ enc: { ...d.enc, ...c } });
  const setLinea = (i, c) => setDoc({ lineas: d.lineas.map((l) => (l.i === i ? { ...l, ...c } : l)) });
  const siguientePendiente = (ds) => { const k = ds.findIndex((x) => x.estado === "leido"); if (k >= 0) setActual(k); };

  const guardar = async () => {
    setGuardando(true);
    try {
      let resultado;
      if (d.como === "gasto") {
        resultado = await api("/ordenes-compra/factura/gasto", {
          method: "POST",
          body: { archivo_token: d.res.archivo_token, venta_id: venta.id, empresa: venta.empresa, tipo: d.gasto.tipo, descripcion: d.gasto.descripcion || TIPOS_GASTO.find(([v]) => v === d.gasto.tipo)?.[1],
            proveedor: d.enc.proveedor, documento: d.enc.documento, tipo_documento: d.enc.tipo_documento, fecha: d.enc.fecha, total: d.enc.total, iva: d.enc.iva },
        });
        resultado = { texto: `Gasto de la venta · ${fmt(resultado.monto)}` };
      } else {
        const activas = d.lineas.filter((l) => !l.omitir && (l.accion === "nuevo" ? l.nuevo.nombre : l.producto));
        if (!activas.length) throw new Error("No hay líneas con producto: márcalo como gasto u omítelo");
        const r = await api("/ordenes-compra/factura/registrar", {
          method: "POST",
          body: {
            ...d.enc, archivo_token: d.res.archivo_token, orden_id: d.enc.orden_id || null, venta_id: venta.id, empresa: venta.empresa,
            lineas: activas.map((l) => ({
              producto_id: l.accion === "existente" ? l.producto.id : null, nuevo: l.accion === "nuevo" ? l.nuevo : null,
              descripcion: l.descripcion, cantidad: Number(l.cantidad), precio: Number(l.precio_neto), unidad: l.unidad, marca: l.marca, calce: l.calce,
            })),
          },
        });
        invalidarProductos();
        resultado = { texto: `Compra ${r.orden.numero} · ${r.orden.proveedor_nombre} · ${fmt(r.orden.subtotal)}${r.alzas.length ? ` · ⚠ ${r.alzas.length} alza(s) de precio` : ""}`, alzas: r.alzas };
      }
      const nuevos = docs.map((x, k) => (k === actual ? { ...x, estado: "guardado", resultado } : x));
      setDocs(nuevos); siguientePendiente(nuevos);
      notify(`✓ ${resultado.texto}`);
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };
  const omitir = () => { const nuevos = docs.map((x, k) => (k === actual ? { ...x, estado: "omitido" } : x)); setDocs(nuevos); siguientePendiente(nuevos); };

  const pendientes = docs.filter((x) => x.estado === "leido").length;
  const terminado = docs.length > 0 && !leyendo && pendientes === 0;

  if (!docs.length) {
    return (
      <Modal titulo={`// Subir facturas y boletas · ${venta.numero}`} onClose={onClose} ancho={720}
        footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={!archivos.length} onClick={leerTodos}>Leer {archivos.length || ""} documento(s)</button></>}>
        <div className="mini">
          Sube todas las facturas y boletas de esta venta juntas (PDF o fotos). El sistema lee cada una, la guarda con el proveedor que aparece en
          el documento, calza los productos con la venta y actualiza los precios del catálogo. Lo que no es material (flete, combustible, otros)
          lo puedes dejar como gasto de la venta. Nada se guarda hasta que revises cada documento.
        </div>
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setArchivos([...(e.target.files || [])])} style={{ marginTop: 10 }} />
        {archivos.length > 0 && <ul className="mini" style={{ margin: "8px 0 0 18px" }}>{archivos.map((a) => <li key={a.name}>{a.name}</li>)}</ul>}
      </Modal>
    );
  }

  return (
    <Modal titulo={`// Facturas y boletas · ${venta.numero}`} onClose={onClose} ancho={1250}
      footer={terminado ? <button className="btn btn-primary" onClick={onClose}>Listo</button> : d && d.estado === "leido" ? <>
        <span className="mini" style={{ marginRight: "auto" }}>{pendientes} por revisar</span>
        <button className="btn btn-ghost" disabled={guardando} onClick={omitir}>Omitir este</button>
        <button className="btn btn-primary" disabled={guardando || (d.como === "materiales" && (!d.enc.proveedor || (!d.enc.documento && d.enc.tipo_documento !== "boleta")))} onClick={guardar}>
          {guardando ? "Guardando..." : d.como === "gasto" ? "Guardar como gasto de la venta" : d.enc.orden_id ? "Guardar y recibir la compra" : "Guardar compra"}
        </button>
      </> : <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div className="chips" style={{ marginBottom: 10 }}>
        {docs.map((x, k) => (
          <button key={k} className={`chip ${k === actual ? "activo" : ""}`} onClick={() => setActual(k)} title={x.archivo.name}>
            {x.estado === "leyendo" ? "⏳" : x.estado === "guardado" ? "✓" : x.estado === "omitido" ? "—" : x.estado === "error" ? "⚠" : "•"} {x.enc?.proveedor || x.archivo.name.slice(0, 18)}
          </button>
        ))}
      </div>

      {terminado && (
        <div className="panel">
          <div className="panel-titulo">Resumen</div>
          <ul className="mini" style={{ margin: "0 0 0 18px" }}>
            {docs.map((x, k) => <li key={k}><strong>{x.archivo.name}</strong>: {x.estado === "guardado" ? x.resultado.texto : x.estado === "omitido" ? "omitido" : `no se pudo leer (${x.error})`}</li>)}
          </ul>
        </div>
      )}

      {d && d.estado === "leyendo" && <div className="mini"><span className="spinner"></span>Leyendo {d.archivo.name}...</div>}
      {d && d.estado === "error" && <div className="aviso">No se pudo leer {d.archivo.name}: {d.error}</div>}
      {d && (d.estado === "guardado" || d.estado === "omitido") && !terminado && <div className="mini">{d.estado === "guardado" ? `✓ ${d.resultado.texto}` : "Omitido"}</div>}

      {d && d.estado === "leido" && <>
        <div className="fields-row tres">
          <div className="field"><label>Este documento es</label>
            <div className="chips">
              <button className={`chip ${d.como === "materiales" ? "activo" : ""}`} onClick={() => setDoc({ como: "materiales" })}>Materiales de la venta</button>
              <button className={`chip ${d.como === "gasto" ? "activo" : ""}`} onClick={() => setDoc({ como: "gasto" })}>Gasto de la venta</button>
            </div>
          </div>
          <div className="field"><label>Tipo</label>
            <select value={d.enc.tipo_documento} onChange={(e) => setEnc({ tipo_documento: e.target.value, ...(e.target.value === "boleta" ? { iva: 0 } : {}) })}>
              <option value="factura">Factura (con IVA)</option><option value="boleta">Boleta (sin crédito de IVA)</option>
            </select></div>
          <div className="field"><label>Proveedor {d.res.proveedor_existente ? "" : "(nuevo)"}</label>
            <input list="lista-prov-docs" value={d.enc.proveedor} onChange={(e) => setEnc({ proveedor: e.target.value.toUpperCase() })} />
            <datalist id="lista-prov-docs">{proveedores.map((p) => <option key={p} value={p} />)}</datalist></div>
        </div>
        <div className="fields-row tres">
          <div className="field"><label>N° {d.enc.tipo_documento === "boleta" ? "boleta (opcional)" : "factura"}</label><input value={d.enc.documento} onChange={(e) => setEnc({ documento: e.target.value })} /></div>
          <div className="field"><label>Fecha</label><input type="date" value={d.enc.fecha} onChange={(e) => setEnc({ fecha: e.target.value })} /></div>
          <div className="field"><label>Total pagado</label><input type="number" value={d.enc.total} onChange={(e) => setEnc({ total: e.target.value })} /></div>
        </div>
        {d.enc.tipo_documento === "boleta" && <div className="mini">Boleta: el costo de la venta es el total pagado (no hay crédito de IVA). Los precios pasan al catálogo sin IVA.</div>}

        {d.como === "gasto" ? (
          <div className="fields-row tres">
            <div className="field"><label>Tipo de gasto</label>
              <select value={d.gasto.tipo} onChange={(e) => setDoc({ gasto: { ...d.gasto, tipo: e.target.value } })}>{TIPOS_GASTO.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
            <div className="field" style={{ gridColumn: "span 2" }}><label>Descripción</label>
              <input value={d.gasto.descripcion} placeholder="Ej: flete a Linares" onChange={(e) => setDoc({ gasto: { ...d.gasto, descripcion: e.target.value } })} /></div>
          </div>
        ) : <>
          <div className="fields-row tres">
            {d.enc.tipo_documento !== "boleta" && <>
              <div className="field"><label>Neto</label><input type="number" value={d.enc.neto} onChange={(e) => setEnc({ neto: e.target.value })} /></div>
              <div className="field"><label>IVA</label><input type="number" value={d.enc.iva} onChange={(e) => setEnc({ iva: e.target.value })} /></div>
            </>}
            <div className="field"><label>Orden de compra de esta venta</label>
              <select value={d.enc.orden_id} onChange={(e) => setEnc({ orden_id: e.target.value })}>
                <option value="">Sin orden (compra nueva)</option>
                {d.res.sugeridas.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.proveedor_nombre} · {fmt(o.total)}</option>)}
              </select></div>
          </div>
          <div className="pago-form">
            {d.res.control.precios_incluyen_iva && <span className="estado estado-info">Precios con IVA: ya se dividieron por 1,19</span>}
            {d.res.control.cuadra === true && <span className="estado estado-ok">✓ Las líneas cuadran con el total</span>}
            {d.res.control.cuadra === false && <span className="estado estado-warn">⚠ Las líneas ({fmt(d.res.control.suma_lineas)}) no cuadran con el documento ({fmt(d.res.control.total_documento)})</span>}
          </div>
          <div className="table-wrap">
            <table className="table table-compacta">
              <thead><tr><th></th><th>En el documento</th><th>Cant.</th><th>Neto unit.</th><th className="col-desc">Producto nuestro</th><th>Línea de la venta</th></tr></thead>
              <tbody>
                {d.lineas.map((l0) => { const vl = l0.accion === "existente" && l0.producto ? lineasVenta.find((x) => x.producto_id === l0.producto.id) : null; const l = { ...l0, venta_linea: vl ? { nombre: vl.nombre, cantidad: vl.cantidad } : null }; return (
                  <tr key={l.i} className={l.omitir ? "fila-anulada" : l.alza ? "fila-alerta" : ""}>
                    <td><input type="checkbox" checked={!l.omitir} onChange={(e) => setLinea(l.i, { omitir: !e.target.checked })} /></td>
                    <td>{l.descripcion}<div className="mini">{[l.codigo_proveedor, l.marca, l.unidad].filter(Boolean).join(" · ")}</div></td>
                    <td><input className="qty-input" style={{ width: 60 }} type="number" value={l.cantidad} onChange={(e) => setLinea(l.i, { cantidad: e.target.value })} /></td>
                    <td><input className="qty-input" style={{ width: 90 }} type="number" value={l.precio_neto} onChange={(e) => setLinea(l.i, { precio_neto: e.target.value })} />
                      {l.alza && <div className="mini" style={{ color: "var(--danger)" }}>▲ alza {l.alza}%</div>}</td>
                    <td>
                      <select className="select-linea" value={l.accion} onChange={(e) => setLinea(l.i, { accion: e.target.value })} style={{ marginBottom: 4 }}>
                        <option value="existente">Producto del catálogo</option><option value="nuevo">Producto nuevo (POR CLASIFICAR)</option>
                      </select>
                      {l.accion === "existente"
                        ? <SelectorProducto valor={l.producto} candidatos={l.candidatos} productos={productos} precioDe={(p) => p.precio_compra} onChange={(p) => setLinea(l.i, { producto: p, calce: "exacto" })} />
                        : <input className="qty-input" style={{ width: "100%", textAlign: "left" }} value={l.nuevo.nombre} onChange={(e) => setLinea(l.i, { nuevo: { ...l.nuevo, nombre: e.target.value.toUpperCase() } })} />}
                      {l.accion === "existente" && <Estado valor={l.calce} />}
                      {l.accion === "existente" && l.producto && (() => { const pr = productos.find((x) => x.id === l.producto.id) || l.producto; const e = envaseEnFactura(l, pr); return e ? (
                        <div className="aviso-envase">Facturado por unidad: {l.cantidad} un = {e.cantidad} envase(s) de {e.contenido} a ${e.precio.toLocaleString("es-CL")}.{" "}
                          <button className="link" onClick={() => setLinea(l.i, { cantidad: e.cantidad, precio_neto: e.precio, envase_ok: true })}>Convertir</button>{" · "}
                          <button className="link" onClick={() => setLinea(l.i, { envase_ok: true })}>Está bien así</button></div>) : null; })()}
                    </td>
                    <td className="mini">
                      {l.venta_linea ? <>✓ {l.venta_linea.nombre}<div>necesita {l.venta_linea.cantidad}{Number(l.cantidad) > l.venta_linea.cantidad ? ` · se compraron ${l.cantidad}: cuenta el total pagado` : Number(l.cantidad) < l.venta_linea.cantidad ? ` · faltan ${l.venta_linea.cantidad - Number(l.cantidad)}` : ""}</div></>
                        : <span style={{ color: "var(--warn)" }}>no está en la venta</span>}
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
          <div className="mini">El documento queda guardado con el proveedor que aparece en él, aunque hayas planeado comprar con otro. Si compraste más de lo necesario (ej. oferta de 10 cuando eran 5), se registra lo comprado y el gasto total cuenta para la venta.</div>
        </>}
      </>}
    </Modal>
  );
}
