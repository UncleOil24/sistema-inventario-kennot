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
// Cliente de la licitación: primero por unidad de compra (cifras antes del primer guion del código), luego por RUT o nombre
const clienteDe = (l, clientes) => {
  const unidad = String(l.codigo || "").split("-")[0];
  const porUnidad = unidad && clientes.find((c) => c.codigo && c.codigo === unidad);
  if (porUnidad) return porUnidad;
  const org = sinTildes(l.organismo || "");
  return clientes.find((c) => (l.rut_unidad && c.rut && rutLimpio(c.rut) === rutLimpio(l.rut_unidad)) || (org && sinTildes(c.nombre) === org));
};

export default function Licitaciones({ esAdmin, notify, clientes, onCotizar, recargarClientes, abrirCodigo, onAbierta }) {
  const [nuevoCliente, setNuevoCliente] = useState(null);
  const [data, setData] = useState(null);
  const [vista, setVista] = useState("abiertas");
  const [fuente, setFuente] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [todasRegiones, setTodasRegiones] = useState(false);
  const [avance, setAvance] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [cotizar, setCotizar] = useState(null);
  const [fichaL, setFichaL] = useState(null);
  const [codigoTraer, setCodigoTraer] = useState("");
  const [trayendo, setTrayendo] = useState(false);
  const [traido, setTraido] = useState(null); // { licitacion, existia, motivos }
  // Traer un proceso por su ID (lo envía el cliente): aunque no cumpla los filtros, y se explica por qué no aparecía
  const traer = async () => {
    const codigo = codigoTraer.trim().toUpperCase();
    if (!codigo) return;
    setTrayendo(true);
    try {
      const r = await api("/mercado-publico/traer", { method: "POST", body: { codigo } });
      setTraido(r);
      setCodigoTraer("");
      setVista("todas"); setFuente(""); setBusqueda(codigo);
    } catch (e) { notify(e.message, "danger"); }
    finally { setTrayendo(false); }
  };
  // Desde Inicio: se abre directo el proceso pedido (aunque ya esté cerrado) y la lista se filtra a él
  useEffect(() => {
    if (!abrirCodigo) return;
    setVista("todas"); setFuente(""); setBusqueda(abrirCodigo);
    setAbierta({ codigo: abrirCodigo, ficha: null, fuente: /-COT/i.test(abrirCodigo) ? "compra_agil" : "licitacion" });
    onAbierta?.();
  }, [abrirCodigo, onAbierta]);

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
      const r0 = await api("/mercado-publico/sincronizar", { method: "POST" });
      if (r0.reciente) { notify(`Ya se revisó hace ${r0.hace_min} minuto(s): para cuidar las consultas a Mercado Público se puede volver a revisar a los 30 minutos`); return; }
      const { id } = r0;
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
      nombre_cotizacion: String(l.nombre || "").slice(0, 250), // el ID ya va en su recuadro de la cotización
      id_solicitud: l.codigo,
      lugar_entrega: l.lugar_entrega || "",
      // Presupuesto y grupos de la ficha (M27): el cotizador compara en vivo
      presupuesto: (l.presupuesto || l.monto_estimado || l.grupos?.length) ? { total: Number(l.presupuesto || l.monto_estimado) || null, grupos: l.grupos || [] } : null,
      empresa: l.empresa_postula && l.empresa_postula !== "ambas" ? l.empresa_postula : undefined,
      validez_dias: l.fuente === "compra_agil" ? 10 : 30, notas: `Mercado Público ${l.codigo}`, archivo_cliente: `${tipoDe(l)} ${l.codigo}`, items: nuevas,
    });
    // Queda "cotizada" recién cuando se guarda la cotización con el ID del proceso
    if (l.estado_interno === "nueva") marcar(l, "revisada");
    if (!cliente && l.organismo) notify(`"${l.organismo}" no está en Clientes: usa "+ Agregar cliente" en la licitación y elígelo en la cotización`);
  };

  if (!data) return <div className="cot-empty"><span className="spinner"></span>Cargando...</div>;
  const lista = data.licitaciones;

  return (
    <>
      {!data.ticket && (
        <div className="aviso">
          Falta conectar Mercado Público. Pide el ticket gratuito en chilecompra.cl/api con tu Clave Única y agrégalo en Render como
          <strong> MERCADOPUBLICO_TICKET</strong>. Después se revisan solas a las 11:00 y a las 16:00.
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
        {esAdmin && (
          <div style={{ display: "flex", gap: 6 }}>
            <input className="search-input" style={{ width: 180, paddingLeft: 12 }} placeholder="Traer por código" title="ID del proceso que envió el cliente. Ej: 2436-1811-COT26" value={codigoTraer}
              onChange={(e) => setCodigoTraer(e.target.value)} onKeyDown={(e) => e.key === "Enter" && traer()} />
            <button className="btn btn-ghost" disabled={!codigoTraer.trim() || trayendo} onClick={traer}>{trayendo ? <span className="spinner"></span> : "Traer"}</button>
          </div>
        )}
        {esAdmin && <button className="btn btn-primary" disabled={!data.ticket || avance?.estado === "corriendo"} onClick={sincronizar}>{avance?.estado === "corriendo" ? <><span className="spinner"></span>Buscando...</> : "↻ Buscar nuevas"}</button>}
      </div>
      {traido && (
        <div className="aviso" style={{ color: "var(--text)" }}>
          <strong>{traido.licitacion.codigo}</strong> · {traido.licitacion.nombre} {traido.existia ? "(ya estaba en el sistema)" : "(traído desde Mercado Público)"}
          {traido.motivos.length ? <><div style={{ marginTop: 4 }}>Por qué no aparecía:</div><ul style={{ margin: "4px 0 4px 18px" }}>{traido.motivos.map((m) => <li key={m}>{m}</li>)}</ul></> : <div>Cumple todos los filtros: debería aparecer en la lista.</div>}
          <div className="mini">Desde ahora se muestra en la lista aunque no cumpla los filtros. Si los motivos se repiten, ajusta Configuración → Mercado Público.</div>
          <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => { setAbierta(traido.licitacion); setTraido(null); }}>Ver proceso</button>
            <button className="link" onClick={() => setTraido(null)}>Cerrar</button>
          </div>
        </div>
      )}
      <div className="mini" style={{ marginBottom: 10 }}>
        {lista.length} procesos{!todasRegiones && data.regiones ? ` · región: ${data.regiones}` : ""}{data.monto_minimo ? ` · desde ${fmt(data.monto_minimo)}` : ""}{data.relevancia_minima ? ` · calce desde ${data.relevancia_minima}%` : ""}
        {data.ultima_sincronizacion ? ` · revisado ${new Date(data.ultima_sincronizacion).toLocaleString("es-CL")}` : " · aún no se ha revisado"}
        {data.consultas ? ` · consultas a Mercado Público hoy: ${(data.consultas.licitaciones || 0) + (data.consultas.compra_agil || 0)}` : ""}
        {" · se buscan solas a las 11:00 y 16:00 · ★ = organismo prioritario · criterios en Config."}
      </div>
      {data.consultas?.bloqueo && new Date(data.consultas.bloqueo.hora) > new Date(Date.now() - 3 * 3600e3) && (
        <div className="aviso">⚠ {data.consultas.bloqueo.texto} ({new Date(data.consultas.bloqueo.hora).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}). Mientras tanto puedes cotizar subiendo el anexo o las bases.</div>
      )}
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
                  <div className="hist-nombre">{l.prioridad && <span title="Organismo prioritario" style={{ color: "var(--warn)" }}>★ </span>}{l.nombre}</div>
                  <div className="hist-meta">
                    <span className={`estado ${l.fuente === "compra_agil" ? "estado-ok" : "estado-neutral"}`}>{tipoDe(l)}</span>
                    <a className="link" href={l.ficha} target="_blank" rel="noreferrer">{l.codigo} ↗</a>
                    <span>{l.organismo || "Organismo sin detalle"}</span>
                    {l.region && <span>{l.region}</span>}
                    {l.items?.length > 0 && <span>{l.items.length} productos</span>}
                    {l.organismo && (clienteDe(l, clientes)
                      ? <span className="estado estado-ok" title="Ya está en Clientes">✓ cliente</span>
                      : <button className="link" onClick={() => setNuevoCliente(l)}>+ Agregar cliente</button>)}
                    {l.empresa_postula && <span className="estado estado-info" title="Empresa que postula">{l.empresa_postula === "ambas" ? "postulan Kenott y Tactics" : `postula ${l.empresa_postula === "tactics" ? "Tactics" : "Kenott"}`}</span>}
                    {l.checklist?.length > 0 && <span className={l.checklist.every((x) => x.listo) ? "estado estado-ok" : ""}>docs {l.checklist.filter((x) => x.listo).length}/{l.checklist.length}</span>}
                    {l.cotizaciones?.length > 0 && <span className="id-solicitud">Cotizada: {l.cotizaciones.map((c) => `${c.empresa === "tactics" ? "Tactics" : "Kenott"} N${c.numero}${c.creado_por ? ` por ${c.creado_por}` : ""}`).join(" · ")}</span>}
                    {l.estado_interno !== "nueva" && !(l.estado_interno === "cotizada" && l.cotizaciones?.length) && <span className={`estado estado-${l.estado_interno === "descartada" ? "muted" : "neutral"}`}>{l.estado_interno === "cotizada" ? "en cotización" : l.estado_interno}{l.descarte_auto ? " (auto)" : ""}</span>}
                    {l.fecha_cierre && new Date(l.fecha_cierre) < new Date() && <span className="estado estado-muted" style={{ textDecoration: "none" }}>cerrada</span>}
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
                    <button className="btn btn-ghost btn-sm" onClick={() => setFichaL(l)}>Ficha para postular</button>
                    <button className="btn btn-success btn-sm" title={l.items?.length ? "" : "Sin productos en Mercado Público: podrás subir las bases o el anexo"} onClick={() => setCotizar(l)}>Cotizar</button>
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
      {fichaL && <FichaPostular l={fichaL} notify={notify} onClose={() => setFichaL(null)} onGuardada={() => { setFichaL(null); cargar(); }} />}
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

// Documentos que suelen exigir las bases (M22, M29); se pueden agregar o quitar
const CHECKLIST_BASE = ["Patente comercial", "Ficha técnica de los productos", "Datos bancarios (banco y N° de cuenta)", "Declaración jurada / anexos de las bases", "Cotización firmada con plazo de entrega"];
const EMPRESAS_POSTULA = [["", "Sin definir"], ["kenott", "Kenott"], ["tactics", "Tactics"], ["ambas", "Ambas"]];

// Ficha para postular (M29) y empresa que postula (M32)
function FichaPostular({ l, notify, onClose, onGuardada }) {
  const [f, setF] = useState({
    empresa_postula: l.empresa_postula || "",
    presupuesto: l.presupuesto ?? (l.monto_estimado ? Math.round(l.monto_estimado) : ""),
    lugar_entrega: l.lugar_entrega || (l.fuente === "compra_agil" ? l.comuna || "" : ""),
    criterios: l.criterios || "",
    grupos: l.grupos?.length ? l.grupos : [],
    checklist: l.checklist?.length ? l.checklist : CHECKLIST_BASE.map((doc) => ({ doc, listo: false })),
    nota: l.nota || "",
  });
  const [nuevoDoc, setNuevoDoc] = useState("");
  const [guardando, setGuardando] = useState(false);
  const faltan = f.checklist.filter((x) => !x.listo);
  const sumaGrupos = f.grupos.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const elegirEmpresa = (v) => {
    setF({ ...f, empresa_postula: v });
  };
  const guardar = async () => {
    setGuardando(true);
    try {
      await api(`/mercado-publico/licitaciones/${encodeURIComponent(l.codigo)}`, { method: "PUT", body: { ...f, presupuesto: f.presupuesto === "" ? null : Number(f.presupuesto) } });
      notify("✓ Ficha guardada");
      onGuardada();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };
  return (
    <Modal titulo={`// Ficha ${l.codigo}`} onClose={onClose} ancho={760}
      footer={<>
        <a className="btn btn-ghost" href={l.ficha} target="_blank" rel="noreferrer">Bases en Mercado Público ↗</a>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Guardar ficha"}</button>
      </>}>
      <div className="hist-nombre">{l.nombre}</div>
      <div className="hist-meta">
        <span>{l.organismo}</span>
        {l.fecha_cierre && <span>Cierra {new Date(l.fecha_cierre).toLocaleString("es-CL")}</span>}
        {l.monto_estimado && <span>Monto informado {fmt(l.monto_estimado)}</span>}
        {l.cotizaciones?.map((c) => <span key={c.id} className="id-solicitud">{c.empresa === "tactics" ? "Tactics" : "Kenott"} N{c.numero} · {fmt(c.total)}</span>)}
      </div>
      <div className="field">
        <label>Empresa que postula</label>
        <div className="chips">
          {EMPRESAS_POSTULA.map(([v, t]) => <button key={t} className={`chip ${f.empresa_postula === v ? "activo" : ""}`} onClick={() => elegirEmpresa(v)}>{t}</button>)}
        </div>
        {f.empresa_postula === "ambas" && <div className="mini">Postulan las dos empresas (son empresas distintas, con representantes distintos).</div>}
        <span className="mini">Se marca sola al cotizar con el ID {l.codigo}.</span>
      </div>
      <div className="fields-row">
        <div className="field"><label>Presupuesto disponible (con IVA)</label><input type="number" value={f.presupuesto} onChange={(e) => setF({ ...f, presupuesto: e.target.value })} /></div>
        <div className="field"><label>Lugar de entrega</label><input value={f.lugar_entrega} onChange={(e) => setF({ ...f, lugar_entrega: e.target.value })} placeholder="Ej: Bodega municipal, Linares" /></div>
      </div>
      <div className="field"><label>Criterios de evaluación</label><input value={f.criterios} onChange={(e) => setF({ ...f, criterios: e.target.value })} placeholder="Ej: precio 50%, plazo de entrega 30%, localidad 20%" /></div>
      <div className="field">
        <label>Montos por grupo de ítems (con IVA, si las bases los separan)</label>
        {f.grupos.map((g, k) => (
          <div key={k} className="pago-form" style={{ marginBottom: 6 }}>
            <input value={g.nombre} placeholder="Grupo (ej. Pinturas)" onChange={(e) => setF({ ...f, grupos: f.grupos.map((x, j) => (j === k ? { ...x, nombre: e.target.value } : x)) })} />
            <input type="number" value={g.monto} placeholder="Monto con IVA" onChange={(e) => setF({ ...f, grupos: f.grupos.map((x, j) => (j === k ? { ...x, monto: e.target.value } : x)) })} />
            <button className="btn btn-danger btn-sm" onClick={() => setF({ ...f, grupos: f.grupos.filter((_, j) => j !== k) })}>✕</button>
          </div>
        ))}
        <button className="link" onClick={() => setF({ ...f, grupos: [...f.grupos, { nombre: "", monto: "" }] })}>+ Agregar grupo</button>
        {f.grupos.length > 0 && <span className="mini"> Suma de grupos: {fmt(sumaGrupos)}</span>}
      </div>
      <div className="field">
        <label>Lista de chequeo antes de postular {faltan.length ? `· faltan ${faltan.length}` : "· ✓ completa"}</label>
        {f.checklist.map((x, k) => (
          <label key={k} className="check" style={{ display: "flex", gap: 8 }}>
            <input type="checkbox" checked={x.listo} onChange={(e) => setF({ ...f, checklist: f.checklist.map((y, j) => (j === k ? { ...y, listo: e.target.checked } : y)) })} />
            <span style={{ textDecoration: x.listo ? "line-through" : "none" }}>{x.doc}</span>
            <button className="link" style={{ marginLeft: "auto" }} onClick={(e) => { e.preventDefault(); setF({ ...f, checklist: f.checklist.filter((_, j) => j !== k) }); }}>quitar</button>
          </label>
        ))}
        <div className="pago-form">
          <input value={nuevoDoc} placeholder="Otro documento que piden las bases" onChange={(e) => setNuevoDoc(e.target.value)} />
          <button className="btn btn-ghost btn-sm" disabled={!nuevoDoc.trim()} onClick={() => { setF({ ...f, checklist: [...f.checklist, { doc: nuevoDoc.trim(), listo: false }] }); setNuevoDoc(""); }}>+ Agregar</button>
        </div>
      </div>
      <div className="field"><label>Notas</label><textarea className="textarea" rows={2} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></div>
    </Modal>
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
        {l && <button className="btn btn-success" onClick={() => onCotizar(l)}>Cotizar</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      {!l ? <div className="cot-empty"><span className="spinner"></span>Cargando...</div> : <>
        <div className="hist-nombre">{l.nombre}</div>
        {l.aviso_mp && <div className="aviso">⚠ {l.aviso_mp}</div>}
        {l.fecha_cierre && new Date(l.fecha_cierre) < new Date() && <div className="aviso">Este proceso ya cerró el {new Date(l.fecha_cierre).toLocaleString("es-CL")}: no se puede postular.</div>}
        {l.cotizaciones?.length > 0 && <div className="mini id-solicitud">Cotizada: {l.cotizaciones.map((c) => `${c.empresa === "tactics" ? "Tactics" : "Kenott"} N${c.numero} (${fmt(c.total)})${c.creado_por ? ` por ${c.creado_por}` : ""}`).join(" · ")}</div>}
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
    nombre: (l.organismo || "").trim(), organismo: (l.organismo || "").trim(), rut: l.rut_unidad || "", tipo: "convenio",
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
