import { useState } from "react";
import { PresentacionLinea, presentacionParaEnviar, prepararLineas, EmpresaCompra, AvisoCamposClave, CuadreDocumento, confirmar, aplicarFactorPrecios, montosTrasFactor } from "./ui";
import { Modal, Estado, SelectorProducto, RepartoLinea, repartoParaEnviar } from "./ui";
import { TIPOS_PAGO } from "./lib";
import { api, fmt, subirArchivo, useProductos, invalidarProductos, hoyISO, envaseEnFactura } from "./lib";

// "Subir facturas y boletas" de una venta: se suben todos los documentos juntos; el sistema lee cada uno
// (proveedor, N°, fecha, productos y montos), lo calza con las líneas de la venta y lo guarda con el proveedor
// que aparece en el documento. Lo que no es mercadería (flete, combustible, otros) queda como gasto de la venta.
const TIPOS_GASTO = [["flete", "Flete / despacho"], ["combustible", "Combustible / peajes"], ["comision", "Comisión"], ["general", "Otro gasto"]];

export default function SubirDocumentosVenta({ venta, lineas: lineasVenta = [], ordenes = [], proveedores = [], notify, onClose }) {
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
            empresa: e.empresa_documento || venta.empresa || "",
          },
          gasto: { tipo: "flete", descripcion: "" },
          // Cada línea se conecta con su línea de la venta (aunque el documento la escriba distinto) y su presentación
          lineas: prepararLineas(r.lineas.map((l) => ({ ...l, reparto_de: l.producto?.id, omitir: false, accion: l.producto && l.calce !== "parecido" ? "existente" : "nuevo", nuevo: { nombre: String(l.descripcion).toUpperCase(), unidad: (l.unidad || "UNIDAD").toUpperCase() } })),
            (r.venta_items || []).map((x) => ({ ...x, clave: `v${x.k}` })), productos),
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
    if (d.res.ya_registrada?.length && !(await confirmar(`Este documento ya está registrado: ${d.res.ya_registrada.map((o) => `${o.numero} (${o.venta})`).join(", ")}.\n\nGuardarlo otra vez DUPLICA el monto (dos compras y doble IVA). Si parte de la factura era para otra venta, no la subas de nuevo: abre la compra ya registrada y usa "Repartir entre ventas".`, { titulo: "Documento ya registrado", boton: "Guardar igual", peligro: true }))) return;
    setGuardando(true);
    try {
      let resultado;
      if (d.como === "gasto") {
        resultado = await api("/ordenes-compra/factura/gasto", {
          method: "POST",
          body: { archivo_token: d.res.archivo_token, venta_id: venta.id, empresa: d.enc.empresa, tipo: d.gasto.tipo, descripcion: d.gasto.descripcion || TIPOS_GASTO.find(([v]) => v === d.gasto.tipo)?.[1],
            proveedor: d.enc.proveedor, documento: d.enc.documento, tipo_documento: d.enc.tipo_documento, fecha: d.enc.fecha, total: d.enc.total, iva: d.enc.iva },
        });
        resultado = { texto: `Gasto de la venta · ${fmt(resultado.monto)}` };
      } else {
        const activas = d.lineas.filter((l) => !l.omitir && (l.accion === "nuevo" ? l.nuevo.nombre : l.producto));
        if (!activas.length) throw new Error("No hay líneas con producto: márcalo como gasto u omítelo");
        const r = await api("/ordenes-compra/factura/registrar", {
          method: "POST",
          body: {
            ...d.enc, archivo_token: d.res.archivo_token, orden_id: d.enc.orden_id || null, venta_id: venta.id, empresa: d.enc.empresa,
            lineas: activas.map((l) => ({
              producto_id: l.accion === "existente" ? l.producto.id : null, nuevo: l.accion === "nuevo" ? l.nuevo : null,
              descripcion: l.descripcion, unidad: l.unidad, marca: l.marca, calce: l.calce,
              ...presentacionParaEnviar(l, repartoParaEnviar(l)),
            })),
          },
        });
        invalidarProductos();
        resultado = { texto: `Compra ${r.orden.numero} · ${r.orden.proveedor_nombre} · ${fmt(r.orden.subtotal)}${r.alzas.length ? ` · ⚠ ${r.alzas.length} alza(s) de precio` : ""}${r.no_vinieron?.length ? ` · ⚠ No vino: ${r.no_vinieron.map((x) => `${x.nombre} (${x.cantidad})`).join(", ")}. Vuelve a "por comprar" en el cuadro` : ""}${r.reparto?.length > 1 ? ` · repartida: ${r.reparto.map((p) => p.numero).join(" + ")}` : ""}`, alzas: r.alzas };
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
<div className="aviso-clave" style={{ marginTop: 8 }}>⚠ Cada factura se sube <strong>una sola vez</strong> al sistema. Si sirve a varias ventas, se reparte al subirla (en "Para:" de cada línea) o después con "Repartir entre ventas" en la compra. Subirla de nuevo duplica el monto y el IVA.</div>
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setArchivos([...(e.target.files || [])])} style={{ marginTop: 10 }} />
        {archivos.length > 0 && <ul className="mini" style={{ margin: "8px 0 0 18px" }}>{archivos.map((a) => <li key={a.name}>{a.name}</li>)}</ul>}
      </Modal>
    );
  }

  return (
    <Modal titulo={`// Facturas y boletas · ${venta.numero}${venta.cliente_nombre ? ` · ${venta.cliente_nombre}` : ""}`} onClose={onClose} ancho={1250}
      footer={terminado ? <button className="btn btn-primary" onClick={onClose}>Listo</button> : d && d.estado === "leido" ? <>
        <span className="mini" style={{ marginRight: "auto" }}>{pendientes} por revisar</span>
        <button className="btn btn-ghost" disabled={guardando} onClick={omitir}>Omitir este</button>
        {d.como === "materiales" && d.lineas.some((l) => !l.omitir && l.decidir) && <span className="mini" style={{ color: "var(--warn)" }}>Define en las líneas marcadas si es el mismo producto o uno nuevo</span>}
        {!d.enc.empresa && <span className="mini" style={{ color: "var(--danger)" }}>Elige la empresa que compra</span>}
        <button className="btn btn-primary" disabled={guardando || !d.enc.empresa || (d.como === "materiales" && (!d.enc.proveedor || (!d.enc.documento && d.enc.tipo_documento !== "boleta") || d.lineas.some((l) => !l.omitir && l.decidir)))} onClick={guardar}>
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
        <AvisoCamposClave />
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
          <div className={`field campo-clave ${d.enc.proveedor ? "" : "vacio"}`}><label>★ Proveedor {d.res.proveedor_existente ? "" : "(nuevo)"}</label>
            <input list="lista-prov-docs" value={d.enc.proveedor} onChange={(e) => setEnc({ proveedor: e.target.value.toUpperCase() })} />
            <datalist id="lista-prov-docs">{proveedores.map((p) => <option key={p} value={p} />)}</datalist></div>
        </div>
        <div className="fields-row tres">
          <div className={`field campo-clave ${d.enc.documento || d.enc.tipo_documento === "boleta" ? "" : "vacio"}`}><label>★ N° {d.enc.tipo_documento === "boleta" ? "boleta (opcional)" : "factura"}</label><input value={d.enc.documento} onChange={(e) => setEnc({ documento: e.target.value })} /></div>
          <div className={`field campo-clave ${d.enc.fecha ? "" : "vacio"}`}><label>★ Fecha</label><input type="date" value={d.enc.fecha} onChange={(e) => setEnc({ fecha: e.target.value })} /></div>
          {d.como !== "gasto" && <div className="field campo-clave"><label>★ Tipo de pago</label><select value={d.enc.tipo_pago || "contado"} onChange={(e) => setEnc({ tipo_pago: e.target.value })}>{TIPOS_PAGO.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>}
          <div className="field campo-clave"><label>★ Total pagado</label><input type="number" value={d.enc.total} onChange={(e) => setEnc({ total: e.target.value })} /></div>
        </div>
        <div className="fields-row"><EmpresaCompra valor={d.enc.empresa} detectada={d.res.encabezado.empresa_documento} ventaEmpresa={venta.empresa} onChange={(empresa) => setEnc({ empresa })} /></div>
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
              <div className="field campo-clave"><label>★ Neto</label><input type="number" value={d.enc.neto} onChange={(e) => setEnc({ neto: e.target.value })} /></div>
              <div className="field campo-clave"><label>★ IVA</label><input type="number" value={d.enc.iva} onChange={(e) => setEnc({ iva: e.target.value })} /></div>
            </>}
            <div className="field"><label>Orden de compra de esta venta</label>
              <select value={d.enc.orden_id} onChange={(e) => setEnc({ orden_id: e.target.value })}>
                <option value="">Sin orden (compra nueva)</option>
                {d.res.sugeridas.map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.proveedor_nombre} · {fmt(o.total)}</option>)}
              </select></div>
          </div>
          {(() => {
            // Comparación con la orden elegida: lo que no vino (sin stock) y lo que viene de más
            const o = ordenes.find((x) => String(x.id) === String(d.enc.orden_id));
            if (!o) return null;
            const enDoc = new Map();
            for (const l of d.lineas) if (!l.omitir && l.accion === "existente" && l.producto) enDoc.set(l.producto.id, (enDoc.get(l.producto.id) || 0) + Number(l.cantidad || 0) * (Number(l.factor) > 0 ? Number(l.factor) : 1));
            const casi = (x, n) => !Number.isInteger(Math.round(x * 1000) / 1000) && x >= n * 0.97; // presentación: 26,76 de 27 m²
            const noVino = o.items.filter((it) => it.producto_id && (enDoc.get(it.producto_id) || 0) < it.cantidad && !casi(enDoc.get(it.producto_id) || 0, it.cantidad)).map((it) => `${it.descripcion_cliente || it.nombre} (${Math.round((it.cantidad - Math.min(it.cantidad, enDoc.get(it.producto_id) || 0)) * 100) / 100} de ${it.cantidad})`);
            const extra = d.lineas.filter((l) => !l.omitir && !(l.accion === "existente" && l.producto && o.items.some((it) => it.producto_id === l.producto.id))).length;
            return (noVino.length > 0 || extra > 0) && (
              <div className="aviso">
                {noVino.length > 0 && <div>⚠ <strong>No vino en el documento</strong> (pedido en {o.numero}): {noVino.join(" · ")}. Al guardar vuelve a "por comprar" en el cuadro, para comprarlo con otro proveedor.</div>}
                {extra > 0 && <div>Trae {extra} producto(s) que no estaban en {o.numero}: se registran en esta compra y su costo suma a la venta. Si alguno no es de esta venta, quítale la marca.</div>}
              </div>
            );
          })()}
          <div className="pago-form">
            {d.res.ya_registrada?.length > 0 && <span className="estado estado-danger">⚠ Ya registrado: {d.res.ya_registrada.map((o) => `${o.numero} (${o.venta})`).join(", ")}</span>}
            {d.res.control.precios_incluyen_iva && <span className="estado estado-info">Precios con IVA: ya se dividieron por 1,19</span>}
            {d.como !== "gasto" && <CuadreDocumento control={d.res.control} lineas={d.lineas} onAplicar={(f) => { const nl = aplicarFactorPrecios(d.lineas, f); const m = montosTrasFactor(nl, d.res.control);
              setDoc({ lineas: nl, enc: { ...d.enc, neto: m.neto, iva: d.enc.tipo_documento === "boleta" ? 0 : m.iva, total: d.enc.tipo_documento === "boleta" ? d.enc.total : m.total } }); }} />}
          </div>
          <div className="table-wrap">
            <table className="table table-compacta">
              <thead><tr><th></th><th>En el documento</th><th>Cant.</th><th>Neto unit.</th><th className="col-desc">Producto nuestro</th><th>Línea de la venta</th></tr></thead>
              <tbody>
                {d.lineas.map((l0) => { const vl = /^v\d+$/.test(l0.para || "") ? lineasVenta.find((x) => x.indice === Number(l0.para.slice(1))) : l0.accion === "existente" && l0.producto ? lineasVenta.find((x) => x.producto_id === l0.producto.id) : null; const l = { ...l0, venta_linea: vl ? { nombre: vl.nombre, cantidad: vl.cantidad } : null }; return (
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
                      <PresentacionLinea l={l} productos={productos} complementos={d.res.complementos || []} onChange={(c) => setLinea(l.i, c)}
                        items={(d.res.venta_items || []).map((x) => ({ ...x, clave: `v${x.k}`, etiqueta: venta.numero }))} />
                      {l.accion === "existente" && l.producto && (() => { const pr = productos.find((x) => x.id === l.producto.id) || l.producto; const e = envaseEnFactura(l, pr); return e ? (
                        <div className="aviso-envase">Facturado por unidad: {l.cantidad} un = {e.cantidad} envase(s) de {e.contenido} a ${e.precio.toLocaleString("es-CL")}.{" "}
                          <button className="link" onClick={() => setLinea(l.i, { cantidad: e.cantidad, precio_neto: e.precio, envase_ok: true })}>Convertir</button>{" · "}
                          <button className="link" onClick={() => setLinea(l.i, { envase_ok: true })}>Está bien así</button></div>) : null; })()}
                    </td>
                    <td className="mini">
                      {l.venta_linea ? (() => { const c = Number(l.cantidad) * (Number(l.factor) > 0 ? Number(l.factor) : 1); return <>✓ {l.venta_linea.nombre}<div>necesita {l.venta_linea.cantidad}{c > l.venta_linea.cantidad ? ` · se compraron ${c}, se pidieron ${l.venta_linea.cantidad}: lo que sobra cuenta como compra extra` : c < l.venta_linea.cantidad ? ` · faltan ${l.venta_linea.cantidad - c}: siguen por comprar` : ""}</div></>; })()
                        : <span style={{ color: "var(--warn)" }}>no está en la venta: compra extra, su costo suma a la venta</span>}
                      <RepartoLinea l={l} onChange={(r) => setLinea(l.i, { reparto: r })} />
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
