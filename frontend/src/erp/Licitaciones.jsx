import { useState, useEffect, useCallback } from "react";
import { Modal } from "./ui";
import ImportarLista from "./ImportarLista";
import { api, fmt, fecha, sinTildes } from "./lib";

const VISTAS = [["nuevas", "Nuevas"], ["abiertas", "Abiertas"], ["cotizadas", "Cotizadas"], ["descartadas", "Descartadas"], ["todas", "Todas"]];
const FUENTES = [["", "Todo"], ["compra_agil", "Compra Ágil"], ["licitacion", "Licitaciones"]];
const tipoDe = (l) => (l.fuente === "compra_agil" ? "Compra Ágil" : "Licitación");
const colorCalce = (r) => (r >= 70 ? "estado-ok" : r >= 40 ? "estado-neutral" : "estado-muted");
const diasPara = (d) => (d ? Math.ceil((new Date(d) - new Date()) / 864e5) : null);

// Licitaciones de Mercado Público que calzan con nuestras palabras clave y región.
export default function Licitaciones({ esAdmin, notify, clientes, onCotizar }) {
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
    const organismo = sinTildes(l.organismo || "");
    const cliente = clientes.find((c) => organismo && (sinTildes(c.nombre) === organismo || (c.rut && l.rut_unidad && c.rut.replace(/\W/g, "") === l.rut_unidad.replace(/\W/g, ""))));
    onCotizar({
      cliente_id: cliente?.id || "", tipo_precio: cliente?.tipo || "convenio",
      nombre_cotizacion: `${tipoDe(l)} ${l.codigo} – ${l.nombre}`.slice(0, 250),
      validez_dias: l.fuente === "compra_agil" ? 10 : 30, notas: `Mercado Público ${l.codigo}`, archivo_cliente: `${tipoDe(l)} ${l.codigo}`, items: nuevas,
    });
    marcar(l, "cotizada");
    if (!cliente && l.organismo) notify(`Recuerda crear el cliente "${l.organismo}" (convenio) y elegirlo en la cotización`);
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
        {lista.length} procesos{!todasRegiones && data.regiones ? ` · región: ${data.regiones}` : ""}{data.monto_minimo ? ` · desde ${fmt(data.monto_minimo)}` : ""}
        {data.ultima_sincronizacion ? ` · revisado ${new Date(data.ultima_sincronizacion).toLocaleString("es-CL")}` : " · aún no se ha revisado"}
        {" · se buscan solas cada tarde a las 18:00 (nuevas listas en la mañana) · ★ = organismo prioritario · criterios en Config."}
      </div>
      {avance && avance.estado === "corriendo" && <div className="aviso"><span className="spinner"></span>{avance.paso} ({avance.segundos || 0} s)</div>}

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

      {abierta && <DetalleLicitacion codigo={abierta.codigo} ficha={abierta.ficha} tipo={tipoDe(abierta)} notify={notify} onClose={() => { setAbierta(null); cargar(); }} onCotizar={(l) => { setAbierta(null); setCotizar(l); }} />}
      {cotizar && (
        <ImportarLista tipo="convenio" notify={notify} titulo={`// Cotizar ${tipoDe(cotizar)} ${cotizar.codigo}`}
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
