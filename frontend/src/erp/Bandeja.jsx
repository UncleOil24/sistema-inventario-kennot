import { useState, useEffect, useCallback, useRef } from "react";
import { api, fmt, authFetch, API_URL } from "./lib";
import { Cargando, confirmar, GastoVenta } from "./ui";
import FacturaCompra from "./FacturaCompra";
import DocumentoProveedor from "./DocumentoProveedor";
import { RegistrarEnVenta, Recortador, comprimirImagen, esImagen } from "./Respaldo";

// Bandeja de documentos: todo lo que se compra se sube aquí en el momento (desde el celular: foto, PDF o el XML
// de la factura electrónica) y después se procesa con calma: se registra la compra con su venta.
const ESTADOS = [["por_procesar", "Por procesar"], ["duplicado", "Duplicados"], ["procesado", "Procesados"], ["descartado", "Descartados"]];
const ICONO = { xml: "XML", pdf: "PDF", imagen: "FOTO" };
const fechaHora = (f) => (f ? new Date(f).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const fechaCorta = (f) => (f ? String(f).slice(0, 10).split("-").reverse().join("-") : "");

export default function Bandeja({ notify, puedeOperar, proveedores = [], compartidos = null, onCompartidosUsados }) {
  const [estado, setEstado] = useState("por_procesar");
  const [datos, setDatos] = useState(null);
  const [ventas, setVentas] = useState([]);
  const [archivos, setArchivos] = useState([]);
  const [ventaId, setVentaId] = useState("");
  const [nota, setNota] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [procesar, setProcesar] = useState(null); // { doc, orden }
  const [gastoDe, setGastoDe] = useState(null); // documento que se registra como gasto
  const [clase, setClase] = useState("compra"); // compra | venta (cedible o guía firmada por el cliente)
  const [aVenta, setAVenta] = useState(null); // documento que se guarda como respaldo de una venta
  const [recortar, setRecortar] = useState(null); // índice del archivo que se encuadra
  const [todasVentas, setTodasVentas] = useState([]);
  const [cotizacion, setCotizacion] = useState(null); // { doc, archivo } cotización de proveedor que se procesa
  const camara = useRef(null);
  const galeria = useRef(null);

  const cargar = useCallback(async () => {
    try { setDatos(await api(`/bandeja?estado=${estado}`)); } catch (e) { notify(e.message, "danger"); }
  }, [estado, notify]);
  useEffect(() => { cargar(); }, [cargar]);
  // Mientras haya documentos leyéndose, se actualiza solo
  useEffect(() => {
    if (!datos?.documentos?.some((d) => d.leyendo)) return;
    const t = setTimeout(cargar, 5000);
    return () => clearTimeout(t);
  }, [datos, cargar]);
  useEffect(() => {
    api("/ventas").then((vs) => {
      const activas = (Array.isArray(vs) ? vs : vs.ventas || []).filter((v) => v.estado !== "anulada");
      setTodasVentas(activas);
      setVentas(activas.filter((v) => v.etapa !== "entregada"));
    }).catch(() => {});
  }, []);
  // Archivos compartidos desde otra app del celular (WhatsApp, Archivos…)
  useEffect(() => { if (compartidos?.length) { agregar(compartidos); onCompartidosUsados?.(); } }, [compartidos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Se copia la lista antes de limpiar el input (si no, queda vacía)
  // Las fotos pesadas del celular se achican al tiro (se ven igual, pesan ~10 veces menos)
  const agregar = async (lista) => {
    const nuevos = Array.from(lista || []);
    const listos = await Promise.all(nuevos.map((f) => comprimirImagen(f)));
    setArchivos((a) => [...a, ...listos]);
  };
  const subir = async () => {
    if (!archivos.length) return;
    setSubiendo(true);
    try {
      const fd = new FormData();
      archivos.forEach((f) => fd.append("archivos", f, f.name));
      if (ventaId) fd.append("venta_id", ventaId);
      fd.append("clase", clase);
      if (nota.trim()) fd.append("nota", nota.trim());
      const r = await authFetch(`${API_URL}/api/bandeja`, { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "No se pudo subir");
      const nuevos = d.data.filter((x) => x.id && !x.repetido).length;
      const repetidos = d.data.filter((x) => x.repetido);
      const errores = d.data.filter((x) => x.error);
      notify(`✓ ${nuevos} documento(s) en la bandeja${repetidos.length ? ` · ${repetidos.length} ya estaban` : ""}${errores.length ? ` · ${errores.length} con error: ${errores.map((x) => x.error).join("; ")}` : ""}`, errores.length ? "danger" : undefined);
      setArchivos([]); setNota("");
      if (estado !== "por_procesar") setEstado("por_procesar"); else cargar();
    } catch (e) { notify(e.message, "danger"); }
    finally { setSubiendo(false); }
  };

  const ver = async (d) => {
    try {
      const r = await authFetch(`${API_URL}/api/bandeja/${d.id}/archivo`);
      if (!r.ok) throw new Error("No se pudo abrir");
      const url = URL.createObjectURL(await r.blob());
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { notify(e.message, "danger"); }
  };
  const cambiar = async (d, cambios, msg) => {
    try { await api(`/bandeja/${d.id}`, { method: "PUT", body: cambios }); if (msg) notify(msg); cargar(); } catch (e) { notify(e.message, "danger"); }
  };
  const descartar = async (d) => {
    if (!(await confirmar(`¿Descartar "${d.nombre_archivo}"? Queda en Descartados (no se borra) y se puede recuperar.`, { titulo: "Descartar documento", boton: "Descartar" }))) return;
    cambiar(d, { estado: "descartado" }, "Documento descartado");
  };
  const releer = async (d) => { try { await api(`/bandeja/${d.id}/leer`, { method: "POST" }); cargar(); } catch (e) { notify(e.message, "danger"); } };
  // Cotización: se abre con su archivo en el lector de documentos de proveedor (el mismo de Catálogo y Compras)
  const abrirCotizacion = async (d) => {
    try {
      const r = await authFetch(`${API_URL}/api/bandeja/${d.id}/archivo`);
      if (!r.ok) throw new Error("No se pudo abrir el documento");
      setCotizacion({ doc: d, archivo: new File([await r.blob()], d.nombre_archivo, { type: d.mime }) });
    } catch (e) { notify(e.message, "danger"); }
  };
  const abrirProcesar = async (d) => {
    let orden = null;
    // Solo la compra elegida o sugerida dentro de la venta del documento (sin venta: se elige al procesar)
    if (d.sugerencia?.orden_id && d.venta_id) { try { orden = await api(`/ordenes-compra/${d.sugerencia.orden_id}`); } catch { /* sin orden */ } }
    setProcesar({ doc: d, orden });
  };

  const conteo = datos?.conteo || {};
  return (
    <div className="bandeja">
      <div className="panel bandeja-subir">
        <div className="panel-titulo">Subir documentos</div>
        <div className="empresa-btns" style={{ marginBottom: 8 }} role="group" aria-label="Tipo de documento">
          <button type="button" className={`empresa-btn ${clase === "compra" ? "activo" : ""}`} onClick={() => setClase("compra")}>🧾 Compra o gasto<span className="mini">factura, boleta del proveedor</span></button>
          <button type="button" className={`empresa-btn ${clase === "venta" ? "activo" : ""}`} onClick={() => setClase("venta")}>✍ Respaldo de venta<span className="mini">cedible o guía firmada por el cliente</span></button>
          <button type="button" className={`empresa-btn ${clase === "cotizacion" ? "activo" : ""}`} onClick={() => setClase("cotizacion")}>📋 Cotización de proveedor<span className="mini">precios para el catálogo</span></button>
        </div>
        <div className="mini" style={{ marginBottom: 10 }}>{clase === "cotizacion"
          ? "Foto o PDF de la cotización que te mandó el proveedor. Después se procesa con calma: se leen los productos y precios y se conectan con el catálogo (quedan como precio con documento)."
          : clase === "compra"
          ? "Sube en el momento la factura, boleta o comprobante: una foto, un PDF o el XML de la factura electrónica (el XML se lee exacto). Después se procesa con calma desde aquí."
          : "Foto o PDF de la copia cedible o de la guía de despacho con la firma y timbre de recepción del cliente. Queda guardada en la venta como respaldo de que el cliente recibió."}</div>
        <div className="bandeja-botones">
          <button className="btn btn-primary btn-grande-movil" type="button" onClick={() => camara.current?.click()}>📷 Sacar foto</button>
          <button className="btn btn-ghost btn-grande-movil" type="button" onClick={() => galeria.current?.click()}>📁 Fotos, PDF o XML</button>
          <input ref={camara} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { agregar(e.target.files); e.target.value = ""; }} />
          <input ref={galeria} type="file" accept="image/*,application/pdf,.pdf,.xml,text/xml,application/xml" multiple hidden onChange={(e) => { agregar(e.target.files); e.target.value = ""; }} />
        </div>
        {archivos.length > 0 && <>
          <ul className="bandeja-archivos">
            {archivos.map((f, k) => <li key={k}><span>{f.name}</span><span className="mini">{Math.round(f.size / 1024)} KB</span>{esImagen(f) && <button className="link" type="button" title="Recortar el margen o girar la foto" onClick={() => setRecortar(k)}>✂ Encuadrar</button>}<button className="link" type="button" aria-label={`Quitar ${f.name}`} onClick={() => setArchivos((a) => a.filter((_, j) => j !== k))}>✕</button></li>)}
          </ul>
          <div className="fields-row">
            <div className="field"><label htmlFor="bandeja-venta">¿Para qué venta? (opcional)</label>
              <select id="bandeja-venta" value={ventaId} onChange={(e) => setVentaId(e.target.value)}>
                <option value="">No sé / después</option>
                {(clase === "venta" ? todasVentas : ventas).map((v) => <option key={v.id} value={v.id}>{v.numero} · {v.cliente_nombre}</option>)}
              </select></div>
            <div className="field"><label htmlFor="bandeja-nota">Nota (opcional)</label>
              <input id="bandeja-nota" value={nota} placeholder="Ej: compré en Sodimac para Maule" onChange={(e) => setNota(e.target.value)} /></div>
          </div>
          <button className="btn btn-primary btn-grande-movil" type="button" disabled={subiendo} onClick={subir}>{subiendo ? "Subiendo..." : `Subir ${archivos.length} documento(s)`}</button>
        </>}
      </div>

      <div className="chips" style={{ margin: "14px 0 10px" }}>
        {ESTADOS.map(([e, t]) => <button key={e} className={`chip ${estado === e ? "activo" : ""}`} onClick={() => setEstado(e)}>{t}{conteo[e] ? ` (${conteo[e]})` : ""}</button>)}
      </div>

      {!datos ? <Cargando /> : !datos.documentos.length ? <div className="empty">// no hay documentos {ESTADOS.find(([e]) => e === estado)?.[1].toLowerCase()}</div> : (
        <div className="bandeja-lista">
          {datos.documentos.map((d) => (
            <div key={d.id} className={`bandeja-doc estado-${d.estado}`}>
              <div className="bandeja-doc-tipo" aria-hidden="true">{ICONO[d.tipo] || "DOC"}</div>
              <div className="bandeja-doc-cuerpo">
                {d.clase === "venta" && <div className="mini" style={{ color: "var(--accent)", fontWeight: 600 }}>✍ Respaldo de venta (cedible / guía firmada)</div>}
                {d.clase === "cotizacion" && <div className="mini" style={{ color: "var(--info)", fontWeight: 600 }}>📋 Cotización de proveedor</div>}
                {d.leyendo ? <div><span className="spinner"></span> Leyendo el documento…</div>
                  : d.proveedor || d.folio ? <div className="bandeja-doc-titulo">{d.proveedor || "Proveedor ?"}{d.folio ? ` · N° ${d.folio}` : ""}</div>
                  : <div className="bandeja-doc-titulo">{d.nombre_archivo}</div>}
                <div className="mini">
                  {[d.fecha_documento && fechaCorta(d.fecha_documento), d.total && fmt(d.total), d.empresa && (d.empresa === "tactics" ? "a nombre de Tactics" : "a nombre de Kenott")].filter(Boolean).join(" · ")}
                </div>
                {d.error_lectura && <div className="mini" style={{ color: "var(--danger)" }}>No se pudo leer: {d.error_lectura} <button className="link mini" onClick={() => releer(d)}>leer de nuevo</button></div>}
                {d.duplicado_de && <div className="mini" style={{ color: "var(--danger)", fontWeight: 600 }}>⚠ {d.duplicado_de}</div>}
                <div className="mini">Venta: {d.venta ? `${d.venta.numero} · ${d.venta.cliente_nombre}` : "sin indicar"}
                  {d.estado === "por_procesar" && <select className="select-linea" style={{ marginLeft: 6, maxWidth: 220 }} aria-label="Cambiar la venta" value={d.venta_id || ""} onChange={(e) => cambiar(d, { venta_id: e.target.value || null })}>
                    <option value="">— cambiar —</option>
                    {ventas.map((v) => <option key={v.id} value={v.id}>{v.numero} · {v.cliente_nombre}</option>)}
                  </select>}
                </div>
                {d.estado === "por_procesar" && d.clase === "compra" && (d.venta_id ? (
                  <div className="mini">Compra:
                    <select className="select-linea" style={{ marginLeft: 6, maxWidth: 260 }} aria-label="A qué compra de la venta pertenece" value={d.sugerencia?.orden_id || ""} onChange={(e) => cambiar(d, { orden_id: e.target.value || null })}>
                      <option value="">Compra nueva de la venta</option>
                      {(d.compras_venta || []).map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.proveedor} · {fmt(o.total)}</option>)}
                    </select>
                    {d.sugerencia?.orden_id && !d.sugerencia.elegida && <span style={{ color: "var(--accent)" }}> (sugerida)</span>}
                  </div>
                ) : d.sugerencia?.orden_id ? <div className="mini" style={{ color: "var(--accent)" }}>Compra sugerida: {d.sugerencia.orden_numero}{d.sugerencia.venta_numero ? ` (${d.sugerencia.venta_numero}${d.sugerencia.cliente ? ` · ${d.sugerencia.cliente}` : ""})` : ""} · elige la venta para confirmarla</div> : null)}
                {d.estado === "procesado" && <div className="mini" style={{ color: "var(--success)" }}>✓ {d.clase === "cotizacion" ? `Precios guardados en el catálogo${d.folio ? ` (${d.folio})` : ""}` : "Registrado"}{d.clase === "cotizacion" ? "" : d.documento_venta_id ? ` como respaldo de ${d.venta?.numero || "la venta"}${d.folio ? ` (N° ${d.folio})` : ""}` : d.orden_numero ? ` en ${d.orden_numero}` : d.gasto_id ? " como gasto" : ""} · {d.procesado_por} · {fechaHora(d.procesado_en)}</div>}
                {d.nota && <div className="mini">Nota: {d.nota}</div>}
                <div className="mini bandeja-doc-quien">Subido por {d.subido_por || "—"} · {fechaHora(d.createdAt)} · {d.nombre_archivo}</div>
              </div>
              <div className="bandeja-doc-acciones">
                <button className="btn btn-ghost btn-sm" onClick={() => ver(d)}>Ver</button>
                {d.estado === "por_procesar" && d.clase === "venta" && <button className="btn btn-primary btn-sm" onClick={() => setAVenta(d)}>Registrar en la venta</button>}
                {puedeOperar && d.clase === "cotizacion" && d.estado === "por_procesar" && <button className="btn btn-primary btn-sm" onClick={() => abrirCotizacion(d)}>Procesar cotización</button>}
                {puedeOperar && d.clase === "compra" && ["por_procesar", "duplicado"].includes(d.estado) && !d.leyendo && <button className="btn btn-primary btn-sm" onClick={() => abrirProcesar(d)}>Procesar compra</button>}
                {d.clase === "compra" && d.estado === "por_procesar" && !d.leyendo && <button className="btn btn-ghost btn-sm" title="Es la cedible o la guía firmada de una venta, no una compra" onClick={() => setAVenta(d)}>Es respaldo de venta</button>}
                {puedeOperar && d.clase === "compra" && d.estado === "por_procesar" && !d.leyendo && <button className="btn btn-ghost btn-sm" title="Bencina, flete, comisión u otro gasto del proyecto" onClick={() => setGastoDe(d)}>Es un gasto</button>}
                {["por_procesar", "duplicado"].includes(d.estado) && <button className="btn btn-ghost btn-sm" onClick={() => descartar(d)}>Descartar</button>}
                {["descartado", "duplicado"].includes(d.estado) && <button className="btn btn-ghost btn-sm" onClick={() => cambiar(d, { estado: "por_procesar" }, "Vuelve a Por procesar")}>Recuperar</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {gastoDe && <GastoVenta ventas={ventas} notify={notify} onClose={() => setGastoDe(null)} onListo={() => { setGastoDe(null); cargar(); }}
        inicial={{ bandeja_id: gastoDe.id, total: gastoDe.total, proveedor: gastoDe.proveedor, documento: gastoDe.folio, fecha: gastoDe.fecha_documento, empresa: gastoDe.empresa, venta_id: gastoDe.venta_id, descripcion: gastoDe.nota || "" }} />}
      {cotizacion && <DocumentoProveedor notify={notify} proveedores={proveedores} archivoInicial={cotizacion.archivo}
        onAprobado={(r, enc) => cambiar(cotizacion.doc, { estado: "procesado", folio: enc?.documento || "", proveedor: enc?.proveedor || "" })}
        onClose={() => { setCotizacion(null); cargar(); }} />}
      {aVenta && <RegistrarEnVenta doc={aVenta} ventas={todasVentas} notify={notify} onClose={() => setAVenta(null)} onHecho={() => { setAVenta(null); cargar(); }} />}
      {recortar != null && archivos[recortar] && <Recortador archivo={archivos[recortar]} onClose={() => setRecortar(null)}
        onListo={(f) => { setArchivos((a) => a.map((x, j) => (j === recortar ? f : x))); setRecortar(null); }} />}
      {procesar && <FacturaCompra bandeja={procesar.doc} orden={procesar.orden} notify={notify} proveedores={proveedores}
        onClose={() => { setProcesar(null); cargar(); }} onListo={() => { setProcesar(null); cargar(); }} />}
    </div>
  );
}
