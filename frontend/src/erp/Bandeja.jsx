import { useState, useEffect, useCallback, useRef } from "react";
import { api, fmt, authFetch, API_URL } from "./lib";
import { Cargando, confirmar } from "./ui";
import FacturaCompra from "./FacturaCompra";

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
    api("/ventas").then((vs) => setVentas((Array.isArray(vs) ? vs : vs.ventas || []).filter((v) => v.estado !== "anulada" && v.etapa !== "entregada"))).catch(() => {});
  }, []);
  // Archivos compartidos desde otra app del celular (WhatsApp, Archivos…)
  useEffect(() => { if (compartidos?.length) { setArchivos(compartidos); onCompartidosUsados?.(); } }, [compartidos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Se copia la lista antes de limpiar el input (si no, queda vacía)
  const agregar = (lista) => { const nuevos = Array.from(lista || []); setArchivos((a) => [...a, ...nuevos]); };
  const subir = async () => {
    if (!archivos.length) return;
    setSubiendo(true);
    try {
      const fd = new FormData();
      archivos.forEach((f) => fd.append("archivos", f, f.name));
      if (ventaId) fd.append("venta_id", ventaId);
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
  const abrirProcesar = async (d) => {
    let orden = null;
    if (d.sugerencia?.orden_id) { try { orden = await api(`/ordenes-compra/${d.sugerencia.orden_id}`); } catch { /* sin orden */ } }
    setProcesar({ doc: d, orden });
  };

  const conteo = datos?.conteo || {};
  return (
    <div className="bandeja">
      <div className="panel bandeja-subir">
        <div className="panel-titulo">Subir documentos de compra</div>
        <div className="mini" style={{ marginBottom: 10 }}>Sube en el momento la factura, boleta o comprobante: una foto, un PDF o el XML de la factura electrónica (el XML se lee exacto). Después se procesa con calma desde aquí.</div>
        <div className="bandeja-botones">
          <button className="btn btn-primary btn-grande-movil" type="button" onClick={() => camara.current?.click()}>📷 Sacar foto</button>
          <button className="btn btn-ghost btn-grande-movil" type="button" onClick={() => galeria.current?.click()}>📁 Fotos, PDF o XML</button>
          <input ref={camara} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { agregar(e.target.files); e.target.value = ""; }} />
          <input ref={galeria} type="file" accept="image/*,application/pdf,.pdf,.xml,text/xml,application/xml" multiple hidden onChange={(e) => { agregar(e.target.files); e.target.value = ""; }} />
        </div>
        {archivos.length > 0 && <>
          <ul className="bandeja-archivos">
            {archivos.map((f, k) => <li key={k}><span>{f.name}</span><span className="mini">{Math.round(f.size / 1024)} KB</span><button className="link" type="button" aria-label={`Quitar ${f.name}`} onClick={() => setArchivos((a) => a.filter((_, j) => j !== k))}>✕</button></li>)}
          </ul>
          <div className="fields-row">
            <div className="field"><label htmlFor="bandeja-venta">¿Para qué venta? (opcional)</label>
              <select id="bandeja-venta" value={ventaId} onChange={(e) => setVentaId(e.target.value)}>
                <option value="">No sé / después</option>
                {ventas.map((v) => <option key={v.id} value={v.id}>{v.numero} · {v.cliente_nombre}</option>)}
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
                {d.sugerencia && d.estado === "por_procesar" && <div className="mini" style={{ color: "var(--accent)" }}>Compra sugerida: {d.sugerencia.orden_numero}{d.sugerencia.venta_numero ? ` (${d.sugerencia.venta_numero}${d.sugerencia.cliente ? ` · ${d.sugerencia.cliente}` : ""})` : ""}</div>}
                {d.estado === "procesado" && <div className="mini" style={{ color: "var(--success)" }}>✓ Registrado{d.orden_numero ? ` en ${d.orden_numero}` : d.gasto_id ? " como gasto" : ""} · {d.procesado_por} · {fechaHora(d.procesado_en)}</div>}
                {d.nota && <div className="mini">Nota: {d.nota}</div>}
                <div className="mini bandeja-doc-quien">Subido por {d.subido_por || "—"} · {fechaHora(d.createdAt)} · {d.nombre_archivo}</div>
              </div>
              <div className="bandeja-doc-acciones">
                <button className="btn btn-ghost btn-sm" onClick={() => ver(d)}>Ver</button>
                {puedeOperar && ["por_procesar", "duplicado"].includes(d.estado) && !d.leyendo && <button className="btn btn-primary btn-sm" onClick={() => abrirProcesar(d)}>Procesar</button>}
                {["por_procesar", "duplicado"].includes(d.estado) && <button className="btn btn-ghost btn-sm" onClick={() => descartar(d)}>Descartar</button>}
                {["descartado", "duplicado"].includes(d.estado) && <button className="btn btn-ghost btn-sm" onClick={() => cambiar(d, { estado: "por_procesar" }, "Vuelve a Por procesar")}>Recuperar</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {procesar && <FacturaCompra bandeja={procesar.doc} orden={procesar.orden} notify={notify} proveedores={proveedores}
        onClose={() => { setProcesar(null); cargar(); }} onListo={() => { setProcesar(null); cargar(); }} />}
    </div>
  );
}
