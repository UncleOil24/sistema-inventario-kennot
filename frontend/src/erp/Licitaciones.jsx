import { useState, useEffect, useCallback } from "react";
import { Modal } from "./ui";
import ImportarLista from "./ImportarLista";
import { api, fmt, fecha, sinTildes } from "./lib";

const VISTAS = [["nuevas", "Nuevas"], ["abiertas", "Abiertas"], ["cotizadas", "Cotizadas"], ["descartadas", "Descartadas"], ["todas", "Todas"]];
const FUENTES = [["", "Todo"], ["compra_agil", "Compra Ágil"], ["licitacion", "Licitaciones"]];
const tipoDe = (l) => (l.fuente === "compra_agil" ? "Compra Ágil" : "Licitación");
const colorCalce = (r) => (r >= 80 ? "estado-ok" : r >= 50 ? "estado-neutral" : "estado-muted");
const diasPara = (d) => (d ? Math.ceil((new Date(d) - new Date()) / 864e5) : null);

// Licitaciones de Mercado Público que calzan con nuestras palabras clave y región.
const rutLimpio = (r) => String(r || "").replace(/[^0-9kK]/g, "").toUpperCase();
// ¿El organismo de la licitación ya está en Clientes? (por RUT o por nombre)
const clienteDe = (l, clientes) => {
  const org = sinTildes(l.organismo || "");
  return clientes.find((c) => (l.rut_unidad && c.rut && rutLimpio(c.rut) === rutLimpio(l.rut_unidad)) || (org && sinTildes(c.nombre) === org));
};

export default function Licitaciones({ esAdmin, notify, clientes, onCotizar, recargarClientes }) {
  const [nuevoCliente, setNuevoCliente] = useState(null);
  const [data, setData] = useState(null);
  const [vista, setVista] = useState("abiertas");
  const [fuente, setFuente] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [todasRegiones, setTodasRegiones] = useState(false);
  const [avance, setAvance] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [cotizar, setCotizar] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const p = new URLSearchParams({ vista });
      if (fuente) p.append("fuente", fuente);
      if (busqueda) p.append("busqueda", busqueda);
      if (todasRegiones) p.append("todas_regiones", "1");
      setData(await api(`/mercado-publico/licitaciones?${p}`));
    } catch (e) { notify(e.message, "danger"); }
  }, [vista, fuente, busqueda, todasRegiones, notify]);
  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  const sincronizar = async () => {
    try {
      const { id } = await api("/mercado-publico/sincronizar", { method: "POST" });
      setAvance({ estado: "corriendo", paso: "Conectando con Mercado Público...", segundos: 0 });
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const t = await api(`/mercado-publico/trabajo/${id}`);
        setAvance(t);
        if (t.estado === "listo") {
          const r = t.resumen || {};
          notify(`✓ ${r.nuevas || 0} procesos nuevos${r.compra_agil ? ` (Compra Ágil: ${r.compra_agil.nuevas}; licitaciones: ${r.licitaciones?.nuevas ?? 0})` : ""}`);
          if (r.avisos?.length) notify(r.avisos.join(" · "), "danger");
          break;
        }
        if (t.estado === "error") { notify(t.error, "danger"); break; }
      }
      cargar();
    } catch (e) { notify(e.message, "danger"); setAvance(null); }
  };

  const marcar = async (l, estado_interno) => {
    try { await api(`/mercado-publico/licitaciones/${encodeURIComponent(l.codigo)}`, { method: "PUT", body: { estado_interno } }); cargar(); }
    catch (e) { notify(e.message, "danger"); }
  };

  // Pasa las líneas revisadas al cotizador, con el organismo como cliente si ya existe
  const alCotizador = (l, nuevas) => {
    const cliente = clienteDe(l, clientes);
    onCotizar({
      cliente_id: cliente?.id || "", tipo_precio: cliente?.tipo || "convenio",
      nombre_cotizacion: `${tipoDe(l)} ${l.codigo} – ${l.nombre}`.slice(0, 250),
      id_solicitud: l.codigo,
      validez_dias: l.fuente === "compra_agil" ? 10 : 30, notas: `Mercado Público ${l.codigo}`, archivo_cliente: `${tipoDe(l)} ${l.codigo}`, items: nuevas,
    });
    marcar(l, "cotizada");
    if (!cliente && l.organismo) notify(`"${l.organismo}" no está en Clientes: usa "+ Agregar cliente" en la licitación y elígelo en la cotización`);
  };

  if (!data) return <div className="cot-empty"><span className="spinner"></span>Cargando...</div>;
  const lista = data.licitaciones;

  return (
    <>
      {!data.ticket && (
        <div className="aviso">
          Falta conectar Mercado Público. Pide el ticket gratuito en chilecompra.cl/api con tu Clave Única y agrégalo en Render como
          <strong> MERCADOPUBLICO_TICKET</strong>. Después las licitaciones se revisan solas cada tarde a las 18:00.
        </div>
      )}
      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por nombre, organismo, comuna o código..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="chips">{VISTAS.map(([v, t]) => <button key={v} className={`chip ${vista === v ? "activo" : ""}`} onClick={() => setVista(v)}>{t}</button>)}</div>
        <div className="chips">{FUENTES.map(([v, t]) => <button key={v} className={`chip ${fuente === v ? "activo" : ""}`} onClick={() => setFuente(v)}>{t}</button>)}</div>
        <label className="check"><input type="checkbox" checked={todasRegiones} onChange={(e) => setTodasRegiones(e.target.checked)} />Todo Chile</label>
        {esAdmin && <button className="btn btn-primary" disabled={!data.ticket || avance?.estado === "corriendo"} onClick={sincronizar}>{avance?.estado === "corriendo" ? <><span className="spinner"></span>Buscando...</> : "↻ Buscar nuevas"}</button>}
      </div>
      <div className="mini" style={{ marginBottom: 10 }}>
        {lista.length} procesos{!todasRegiones && data.regiones ? ` · región: ${data.regiones}` : ""}{data.monto_minimo ? ` · desde ${fmt(data.monto_minimo)}` : ""}{data.relevancia_minima ? ` · calce desde ${data.relevancia_minima}%` : ""}
        {data.ultima_sincronizacion ? ` · revisado ${new Date(data.ultima_sincronizacion).toLocaleString("es-CL")}` : " · aún no se ha revisado"}
        {" · se buscan solas cada tarde a las 18:00 (nuevas listas en la mañana) · ★ = organismo prioritario · criterios en Config."}
      </div>
      {avance && avance.estado === "corriendo" && (
        <div className="aviso">
          <span className="spinner"></span>{avance.paso} · {Math.floor((avance.segundos || 0) / 60)} min {(avance.segundos || 0) % 60} s
          {avance.total > 0 && <div className="progreso"><div style={{ width: `${Math.min(100, Math.round(((avance.actual || 0) / avance.total) * 100))}%` }} /></div>}
          <div className="mini" style={{ marginTop: 6 }}>Sigue trabajando aunque cierres esta pantalla. Las siguientes revisiones son más rápidas: solo traen lo nuevo.</div>
        </div>
      )}

      {lista.length === 0 ? <div className="cot-empty">// sin procesos {vista === "abiertas" ? "abiertos" : ""} que calcen con los criterios</div> : (
        <div className="hist-list">
          {lista.map((l) => {
            const dias = diasPara(l.fecha_cierre);
            return (
              <div key={l.codigo} className={`hist-card ${l.estado_interno === "nueva" ? "lic-nueva" : ""}`}>
                <div className="hist-info">
                  <div className="hist-nombre">{l.prioridad && <span title="Organismo prioritario" style={{ color: "var(--accent, #e3b341)" }}>★ </span>}{l.nombre}</div>
                  <div className="hist-meta">
                    <span className={`estado ${l.fuente === "compra_agil" ? "estado-ok" : "estado-neutral"}`}>{tipoDe(l)}</span>
                    <a className="link" href={l.ficha} target="_blank" rel="noreferrer">{l.codigo} ↗</a>
                    <span>{l.organismo || "Organismo sin detalle"}</span>
                    {l.region && <span>{l.region}</span>}
                    {l.items?.length > 0 && <span>{l.items.length} productos</span>}
                    {l.organismo && (clienteDe(l, clientes)
                      ? <span className="estado estado-ok" title="Ya está en Clientes">✓ cliente</span>
                      : <button className="link" onClick={() => setNuevoCliente(l)}>+ Agregar cliente</button>)}
                    {l.estado_interno !== "nueva" && <span className={`estado estado-${l.estado_interno === "cotizada" ? "ok" : l.estado_interno === "descartada" ? "muted" : "neutral"}`}>{l.estado_interno}{l.descarte_auto ? " (auto)" : ""}</span>}
                  </div>
                  {l.relevancia != null
                    ? <div className="mini"><span className={`estado ${colorCalce(l.relevancia)}`}>calce {l.relevancia}%</span> {l.motivo_relevancia}</div>
                    : l.motivo_relevancia ? <div className="mini">{l.motivo_relevancia}</div>
                    : l.palabras && <div className="mini">Calza con: {l.palabras}</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                  <div className={`mini ${dias !== null && dias <= 3 ? "stock-low" : ""}`} style={{ fontSize: 12 }}>
                    {l.fecha_cierre ? `cierra ${new Date(l.fecha_cierre).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${dias !== null && dias >= 0 ? ` · ${dias === 0 ? "hoy" : `${dias} día(s)`}` : ""}` : "sin fecha de cierre"}
                  </div>
                  {l.monto_estimado && <div className="hist-total">{fmt(l.monto_estimado)}</div>}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setAbierta(l); if (l.estado_interno === "nueva") marcar(l, "revisada"); }}>Ver productos</button>
                    {l.items?.length > 0 && <button className="btn btn-success btn-sm" onClick={() => setCotizar(l)}>Cotizar</button>}
                    {l.estado_interno !== "descartada"
                      ? <button className="btn btn-ghost btn-sm" onClick={() => marcar(l, "descartada")}>Descartar</button>
                      : <button className="btn btn-ghost btn-sm" onClick={() => marcar(l, "revisada")}>Recuperar</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nuevoCliente && <ClienteDesdeLicitacion l={nuevoCliente} notify={notify} onClose={() => setNuevoCliente(null)}
        onCreado={async () => { setNuevoCliente(null); await recargarClientes?.(); }} />}
      {abierta && <DetalleLicitacion codigo={abierta.codigo} ficha={abierta.ficha} tipo={tipoDe(abierta)} notify={notify} onClose={() => { setAbierta(null); cargar(); }} onCotizar={(l) => { setAbierta(null); setCotizar(l); }} />}
      {cotizar && (
        <ImportarLista tipo="convenio" esAdmin={esAdmin} notify={notify} titulo={`// Cotizar ${tipoDe(cotizar)} ${cotizar.codigo}`}
          cargar={() => api(`/ia/licitacion/${encodeURIComponent(cotizar.codigo)}`, { method: "POST" })}
          onClose={() => setCotizar(null)}
          onAgregar={(nuevas) => { const l = cotizar; setCotizar(null); alCotizador(l, nuevas); }} />
      )}
    </>
  );
}

function DetalleLicitacion({ codigo, ficha, tipo, notify, onClose, onCotizar }) {
  const [l, setL] = useState(null);
  useEffect(() => {
    api(`/mercado-publico/licitaciones/${encodeURIComponent(codigo)}`).then(setL).catch((e) => { notify(e.message, "danger"); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo]);
  return (
    <Modal titulo={`// ${tipo} ${codigo}`} onClose={onClose} ancho={900}
      footer={<>
        <a className="btn btn-ghost" href={l?.ficha || ficha} target="_blank" rel="noreferrer">Abrir en Mercado Público ↗</a>
        {l?.items?.length > 0 && <button className="btn btn-success" onClick={() => onCotizar(l)}>Cotizar</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      {!l ? <div className="cot-empty"><span className="spinner"></span>Cargando...</div> : <>
        <div className="hist-nombre">{l.nombre}</div>
        <div className="hist-meta">
          <span>{l.organismo}</span>{l.unidad && <span>{l.unidad}</span>}{l.region && <span>{l.region}</span>}
          {l.comuna && <span>{l.fuente === "compra_agil" ? `Entrega: ${l.comuna}` : l.comuna}</span>}
          {l.fecha_cierre && <span>Cierra {new Date(l.fecha_cierre).toLocaleString("es-CL")}</span>}
          {l.monto_estimado && <span>{l.fuente === "compra_agil" ? "Presupuesto" : "Monto estimado"} {fmt(l.monto_estimado)}</span>}
        </div>
        {l.motivo_relevancia && <div className="mini">{l.relevancia != null && <span className={`estado ${colorCalce(l.relevancia)}`}>calce {l.relevancia}%</span>} {l.motivo_relevancia}</div>}
        {l.descripcion && <div className="mini" style={{ whiteSpace: "pre-wrap" }}>{l.descripcion}</div>}
        {l.items?.length ? (
          <div className="table-wrap">
            <table className="table table-compacta">
              <thead><tr><th>Producto</th><th>Detalle pedido</th><th>Cant.</th><th>Unidad</th></tr></thead>
              <tbody>{l.items.map((i, k) => (
                <tr key={k}><td>{i.producto}</td><td className="mini" style={{ whiteSpace: "normal" }}>{i.descripcion}</td><td className="mini">{i.cantidad}</td><td className="mini">{i.unidad}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="mini">Este proceso no trae el detalle de productos: revisa las bases en Mercado Público.</div>}
        <div className="mini">Actualizado: {fecha(l.updatedAt)}. Revisa siempre las bases y anexos en Mercado Público antes de ofertar.</div>
      </>}
    </Modal>
  );
}

// Crea el organismo de la licitación en Clientes (convenio), con los datos de Mercado Público
function ClienteDesdeLicitacion({ l, notify, onClose, onCreado }) {
  const [form, setForm] = useState({
    // ID del cliente = unidad de compra (lo que va antes del primer guion en el código, p.ej. 1422-20-COT26 → 1422)
    codigo: String(l.codigo || "").split("-")[0] || "",
    nombre: (l.organismo || "").trim(), rut: l.rut_unidad || "", tipo: "convenio",
    contacto: l.unidad || "", direccion: l.fuente === "compra_agil" ? (l.comuna || "") : "", comuna: l.fuente === "compra_agil" ? "" : (l.comuna || ""),
    telefono: "", email: "",
  });
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const guardar = async () => {
    setGuardando(true);
    try {
      await api("/clientes", { method: "POST", body: form });
      notify(`✓ ${form.nombre} agregado a Clientes`);
      await onCreado();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };
  return (
    <Modal titulo="// Agregar cliente" onClose={onClose} ancho={620}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={guardando || !form.nombre.trim()} onClick={guardar}>{guardando ? "Guardando..." : "Agregar a Clientes"}</button>
      </>}>
      <div className="mini">Datos tomados de Mercado Público ({l.codigo}). Revísalos y completa lo que falte.</div>
      <div className="fields-row">
        <div className="field" style={{ maxWidth: 200 }}><label>ID (unidad de compra)</label><input value={form.codigo} onChange={(e) => set("codigo", e.target.value)} /></div>
        <div className="field"><label>Nombre</label><input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} /></div>
      </div>
      <div className="fields-row">
        <div className="field"><label>RUT</label><input value={form.rut} onChange={(e) => set("rut", e.target.value)} /></div>
        <div className="field">
          <label>Tipo</label>
          <select value={form.tipo} onChange={(e) => set("tipo", e.target.value)}><option value="convenio">Convenio (institución)</option><option value="particular">Particular</option></select>
        </div>
      </div>
      <div className="field"><label>Unidad de compra / contacto</label><input value={form.contacto} onChange={(e) => set("contacto", e.target.value)} placeholder="Ej: Departamento de Adquisiciones" /></div>
      <div className="fields-row">
        <div className="field"><label>Dirección</label><input value={form.direccion} onChange={(e) => set("direccion", e.target.value)} /></div>
        <div className="field"><label>Comuna</label><input value={form.comuna} onChange={(e) => set("comuna", e.target.value)} /></div>
      </div>
      <div className="fields-row">
        <div className="field"><label>Teléfono</label><input value={form.telefono} onChange={(e) => set("telefono", e.target.value)} /></div>
        <div className="field"><label>Email</label><input value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
      </div>
    </Modal>
  );
}
