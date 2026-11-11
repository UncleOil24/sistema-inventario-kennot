import { useState, useEffect, useMemo } from "react";
import { confirmar } from "./ui";
import { api, authFetch, API_URL, invalidarProductos, descargar } from "./lib";

// M37: importar la planilla LISTADO_CONSOLIDADO combinándola con el sistema.
// 1) se sube → vista previa (nuevos, actualizados, a revisar, sin cambios) sin guardar nada
// 2) se aprueba → respaldo automático y se combina. Nunca borra ni desactiva productos.
const TABS = [["nuevo", "Nuevos"], ["actualizado", "Actualizados"], ["revisar", "A revisar"], ["sin_cambios", "Sin cambios"]];
const pesos = (n) => (n ? `$${Math.round(n).toLocaleString("es-CL")}` : "—");

export default function ImportarPlanilla({ notify }) {
  const [archivo, setArchivo] = useState(null);
  const [trabajo, setTrabajo] = useState(null); // estado del servidor
  const [ocupado, setOcupado] = useState(false);
  const [tab, setTab] = useState("nuevo");
  const [excluir, setExcluir] = useState(new Set());
  const [decision, setDecision] = useState({});
  const [filtro, setFiltro] = useState("");
  const [respaldos, setRespaldos] = useState([]);
  const cargarRespaldos = () => api("/precios/respaldos").then(setRespaldos).catch(() => {});
  useEffect(() => { cargarRespaldos(); }, []);

  const seguir = async (id, hasta) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1200));
      let t;
      try { t = await api(`/precios/importar-planilla/${id}`); } catch (e) { notify(e.message, "danger"); setOcupado(false); return; }
      setTrabajo({ ...t, id });
      if (t.estado === "error") { notify(`Error: ${t.error}`, "danger"); break; }
      if (hasta.includes(t.estado)) break;
    }
    setOcupado(false);
  };

  const subir = async () => {
    if (!archivo) return;
    setOcupado(true); setTrabajo({ estado: "leyendo", paso: "Subiendo el archivo..." }); setExcluir(new Set()); setDecision({});
    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      const res = await authFetch(`${API_URL}/api/precios/importar-planilla`, { method: "POST", body: fd });
      const data = await res.json();
      if (res.status === 409 && data.data?.id) { notify(data.error, "danger"); return seguir(data.data.id, ["vista_previa", "listo"]); }
      if (!data.ok) throw new Error(data.error || "Error al subir");
      const t0 = { id: data.data.id };
      setTrabajo((t) => ({ ...t, ...t0 }));
      await seguir(data.data.id, ["vista_previa"]);
      setTab("nuevo");
      setDecision({});
    } catch (e) { notify(e.message, "danger"); setOcupado(false); setTrabajo(null); }
  };

  const vista = trabajo?.estado === "vista_previa" ? trabajo.vista : null;
  const items = useMemo(() => vista?.items || [], [vista]);
  const decisionDe = (x) => decision[x.i] || x.sugerido || "ignorar";
  const lista = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    return items.filter((x) => x.tipo === tab && (!f || x.nombre.includes(f) || (x.producto_nombre || "").includes(f)));
  }, [items, tab, filtro]);

  const aprobar = async () => {
    const r = vista.resumen;
    const ign = items.filter((x) => x.tipo === "revisar" && decisionDe(x) === "ignorar").length;
    if (!(await confirmar(`Se agregarán ${r.nuevos - [...excluir].filter((i) => items[i]?.tipo === "nuevo").length} productos nuevos y se actualizarán ${r.actualizados - [...excluir].filter((i) => items[i]?.tipo === "actualizado").length}.\nA revisar: ${r.revisar - ign} se aplican, ${ign} se ignoran.\nNo se borra ni se desactiva ningún producto. Antes se guarda un respaldo para poder deshacer.`, { titulo: "Aprobar importación", boton: "Aprobar y guardar" }))) return;
    setOcupado(true);
    try {
      const decisiones = Object.fromEntries(items.filter((x) => x.tipo === "revisar").map((x) => [x.i, decisionDe(x)]));
      await api(`/precios/importar-planilla/${trabajo.id}/aprobar`, { method: "POST", body: { decisiones, excluir: [...excluir] } });
      setTrabajo({ ...trabajo, estado: "aplicando", paso: "Guardando respaldo..." });
      await seguir(trabajo.id, ["listo"]);
      invalidarProductos(); cargarRespaldos(); notify("✓ Planilla importada");
    } catch (e) { notify(e.message, "danger"); setOcupado(false); }
  };

  const deshacer = async (r) => {
    if (!(await confirmar(`¿Dejar el catálogo como estaba antes de importar ${r.archivo || "la planilla"} (${new Date(r.createdAt).toLocaleString("es-CL")})?\nLos productos nuevos de esa importación quedan desactivados y se quitan los precios que agregó.`, { titulo: "Deshacer importación", boton: "Deshacer", peligro: true }))) return;
    try { const d = await api(`/precios/respaldos/${r.id}/deshacer`, { method: "POST" }); notify(`✓ Deshecha: ${d.productos_nuevos_desactivados} nuevos desactivados, ${d.precios_quitados} precios quitados`); invalidarProductos(); cargarRespaldos(); }
    catch (e) { notify(e.message, "danger"); }
  };

  const alternar = (i) => { const n = new Set(excluir); n.has(i) ? n.delete(i) : n.add(i); setExcluir(n); };
  const todos = (accion) => setDecision(Object.fromEntries(items.filter((x) => x.tipo === "revisar").map((x) => [x.i, accion])));
  const ultimo = respaldos.find((r) => !r.deshecho);

  return (
    <div className="panel" style={{ gridColumn: "1 / -1" }}>
      <div className="panel-titulo">Importar planilla LISTADO_CONSOLIDADO (se combina con el sistema)</div>
      <div className="mini">
        Sube la planilla (.xlsx). El sistema la compara con el catálogo y muestra una <strong>vista previa</strong>: no guarda nada hasta que apruebes.
        Agrega los nuevos, actualiza los que coinciden según las reglas de precios (mismo proveedor: vale el más reciente; entre proveedores: el más barato; los confirmados se respetan)
        y deja igual los que están solo en el sistema. <strong>Nunca borra ni desactiva productos.</strong> Antes de guardar hace un respaldo.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" accept=".xlsx" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
        <button className="btn btn-primary" disabled={!archivo || ocupado} onClick={subir}>{ocupado && !vista ? <><span className="spinner"></span>Revisando...</> : "Revisar planilla"}</button>
      </div>

      {trabajo && ["leyendo", "aplicando"].includes(trabajo.estado) && <div className="aviso"><span className="spinner"></span>{trabajo.paso} ({trabajo.segundos || 0} s)</div>}
      {trabajo?.estado === "error" && <div className="login-error">Error: {trabajo.error}</div>}

      {vista && (
        <>
          <div className="chips" style={{ margin: "10px 0" }}>
            {TABS.map(([k, t]) => {
              const n = items.filter((x) => x.tipo === k).length;
              return <button key={k} className={`chip ${tab === k ? "activo" : ""}`} onClick={() => setTab(k)}>{t} ({n})</button>;
            })}
            <span className="mini" style={{ alignSelf: "center" }}>· Solo en el sistema (quedan igual): {vista.resumen.solo_en_sistema} · Cotizaciones {vista.resumen.cotizaciones} · Extras {vista.resumen.extras}</span>
          </div>
          {vista.resumen.unidades_por_revisar?.length > 0 && <div className="aviso">Unidades que no están en la lista (se guardan tal cual y quedan en el filtro "Unidad por revisar"): {vista.resumen.unidades_por_revisar.join(", ")}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input className="search-input" placeholder="Buscar en la lista..." value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ maxWidth: 320 }} />
            {tab === "revisar" && <>
              <button className="btn btn-ghost btn-sm" onClick={() => todos("mismo")}>Todos: es el mismo</button>
              <button className="btn btn-ghost btn-sm" onClick={() => todos("nuevo")}>Todos: crear nuevos</button>
              <button className="btn btn-ghost btn-sm" onClick={() => todos("ignorar")}>Todos: ignorar</button>
            </>}
          </div>
          <div className="table-wrap" style={{ maxHeight: 420, overflow: "auto" }}>
            <table className="table table-compacta">
              <thead><tr>
                {tab !== "sin_cambios" && tab !== "revisar" && <th>Incluir</th>}
                <th>N°</th><th>En la planilla</th>
                {tab === "nuevo" && <><th>Categoría</th><th>Precio</th><th>Proveedor</th></>}
                {tab === "actualizado" && <th>Cambios</th>}
                {tab === "revisar" && <><th>En el sistema</th><th>Por qué</th><th>Qué hacer</th></>}
              </tr></thead>
              <tbody>
                {lista.slice(0, 400).map((x) => (
                  <tr key={x.i} className={excluir.has(x.i) ? "fila-anulada" : ""}>
                    {tab !== "sin_cambios" && tab !== "revisar" && <td><input type="checkbox" checked={!excluir.has(x.i)} onChange={() => alternar(x.i)} /></td>}
                    <td className="id-cell">{x.codigo}</td>
                    <td>{x.nombre}</td>
                    {tab === "nuevo" && <><td className="mini">{x.categoria}</td><td className="price-cell">{pesos(x.precio_planilla)}</td><td className="mini">{x.proveedor_planilla || "—"}</td></>}
                    {tab === "actualizado" && <td className="mini">{x.cambios.join(" · ")}</td>}
                    {tab === "revisar" && <>
                      <td className="mini">N° {x.producto_codigo} · {x.producto_nombre}{x.cambios?.length ? <div>Si es el mismo: {x.cambios.join(" · ")}</div> : null}</td>
                      <td className="mini">{x.motivo}</td>
                      <td>
                        <select className="filter-select" value={decisionDe(x)} onChange={(e) => setDecision({ ...decision, [x.i]: e.target.value })}>
                          <option value="mismo">Es el mismo</option>
                          <option value="nuevo">Crear como nuevo</option>
                          <option value="ignorar">Ignorar</option>
                        </select>
                      </td>
                    </>}
                  </tr>
                ))}
                {!lista.length && <tr className="empty-row"><td colSpan={6}>// nada en esta lista</td></tr>}
              </tbody>
            </table>
            {lista.length > 400 && <div className="mini">Mostrando 400 de {lista.length}. Usa el buscador para ver otros.</div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn btn-ghost" onClick={() => setTrabajo(null)} disabled={ocupado}>Cancelar</button>
            <button className="btn btn-primary" onClick={aprobar} disabled={ocupado}>✓ Aprobar y guardar</button>
          </div>
        </>
      )}

      {trabajo?.estado === "listo" && trabajo.resumen && (
        <table className="table table-compacta" style={{ marginTop: 10 }}>
          <tbody>
            {[["Productos nuevos", trabajo.resumen.productos_nuevos], ["Productos actualizados", trabajo.resumen.productos_actualizados],
              ["Reactivados", trabajo.resumen.reactivados], ["Precios que cambiaron", trabajo.resumen.precios_cambiados],
              ["Precios agregados al historial", trabajo.resumen.precios_agregados], ["Proveedores nuevos", trabajo.resumen.proveedores_nuevos],
              ["Filas ignoradas", trabajo.resumen.ignorados]].map(([k, v]) => <tr key={k}><td className="mini">{k}</td><td className="price-cell">{v}</td></tr>)}
          </tbody>
        </table>
      )}

      {respaldos.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="mini"><strong>Respaldos automáticos</strong> (antes de cada importación)</div>
          <table className="table table-compacta"><tbody>
            {respaldos.slice(0, 5).map((r) => (
              <tr key={r.id} className={r.deshecho ? "fila-anulada" : ""}>
                <td className="mini">{new Date(r.createdAt).toLocaleString("es-CL")}</td>
                <td className="mini">{r.motivo}{r.por ? ` · ${r.por}` : ""}{r.deshecho ? ` · deshecha por ${r.deshecho_por || ""}` : ""}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => descargar(`/precios/respaldos/${r.id}/excel`).catch((e) => notify(e.message, "danger"))}>↓ Excel</button>
                  {ultimo?.id === r.id && <button className="btn btn-danger btn-sm" onClick={() => deshacer(r)}>↺ Deshacer esta importación</button>}
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}
