import { useState, useEffect, useCallback } from "react";
import { Modal, Estado } from "./ui";
import { api, fmt, fecha } from "./lib";

// Proyectos: una licitación ganada con todas sus órdenes de compra del organismo (ventas)
// y todas las compras a proveedores, en un solo lugar.
const esCodigoMP = (c) => /^\d{2,7}-\d{1,5}-[A-Z]{1,3}\d{2}$/i.test(c || "");
const fichaMP = (c) => (/COT/i.test(c)
  ? `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(c)}`
  : `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(c)}`);

export function ListaProyectos({ notify, esAdmin, onAbrir, recargar }) {
  const [lista, setLista] = useState(null);
  const [estado, setEstado] = useState("abierto");
  const cargar = useCallback(async () => {
    try { setLista(await api(`/proyectos${estado ? `?estado=${estado}` : ""}`)); } catch (e) { notify(e.message, "danger"); }
  }, [estado, notify]);
  useEffect(() => { cargar(); }, [cargar, recargar]);

  if (!lista) return <div className="cot-empty"><span className="spinner"></span>Cargando...</div>;
  return (
    <>
      <div className="toolbar">
        <div className="chips">
          {[["abierto", "Abiertos"], ["cerrado", "Cerrados"], ["", "Todos"]].map(([v, t]) => <button key={v} className={`chip ${estado === v ? "activo" : ""}`} onClick={() => setEstado(v)}>{t}</button>)}
        </div>
        <span className="mini">Para crear uno: en la lista de ventas marca las órdenes de compra de la misma licitación y pulsa "Unir en proyecto".</span>
      </div>
      {lista.length === 0 ? <div className="cot-empty">// sin proyectos {estado === "abierto" ? "abiertos" : ""}</div> : (
        <div className="hist-list">
          {lista.map((p) => (
            <div key={p.id} className="hist-card clickable" onClick={() => onAbrir(p.id)} style={{ cursor: "pointer" }}>
              <div className="hist-info">
                <div className="hist-nombre">{p.nombre}</div>
                <div className="hist-meta">
                  <span className="id-cell">{p.numero}</span>
                  <span>{p.cliente_nombre || "Sin cliente"}</span>
                  {p.licitacion_codigo && <span>Licitación {p.licitacion_codigo}</span>}
                  <span>{p.resumen.ventas} OC del organismo{p.ordenes_cliente.length ? `: ${p.ordenes_cliente.join(", ")}` : ""}</span>
                  {esAdmin && <span>{p.ordenes_proveedor} OC a proveedores</span>}
                  {p.estado === "cerrado" && <Estado valor="cerrado" />}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <div className="hist-total">{fmt(p.resumen.total)}</div>
                <div className="mini">{p.resumen.por_cobrar > 0.5 ? `por cobrar ${fmt(p.resumen.por_cobrar)}` : "cobrado"}</div>
                {esAdmin && <div className="mini">utilidad {fmt(p.resumen.utilidad_real ?? p.resumen.utilidad)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Unir ventas seleccionadas en un proyecto nuevo o en uno existente
export function UnirEnProyecto({ ventas, notify, onClose, onListo }) {
  const [proyectos, setProyectos] = useState([]);
  const [destino, setDestino] = useState("nuevo");
  const cliente = ventas.find((v) => v.cliente_nombre)?.cliente_nombre || "";
  const [form, setForm] = useState({ nombre: cliente ? `Licitación ${cliente}` : "", licitacion_codigo: "" });
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { api("/proyectos?estado=abierto").then(setProyectos).catch(() => {}); }, []);
  const clientes = [...new Set(ventas.map((v) => v.cliente_nombre || "Sin cliente"))];

  const guardar = async () => {
    setGuardando(true);
    try {
      const venta_ids = ventas.map((v) => v.id);
      let id = destino;
      if (destino === "nuevo") id = (await api("/proyectos", { method: "POST", body: { ...form, venta_ids } })).id;
      else await api(`/proyectos/${destino}/ventas`, { method: "POST", body: { venta_ids } });
      notify(`✓ ${ventas.length} venta(s) unidas en el proyecto`);
      onListo(Number(id));
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  return (
    <Modal titulo={`// Unir ${ventas.length} venta(s) en un proyecto`} onClose={onClose} ancho={620}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={guardando || (destino === "nuevo" && !form.nombre.trim())} onClick={guardar}>{guardando ? "Guardando..." : "Unir"}</button>
      </>}>
      <div className="mini">
        {ventas.map((v) => `${v.numero}${v.orden_compra_cliente ? ` (OC ${v.orden_compra_cliente})` : ""}`).join(" · ")}
      </div>
      {clientes.length > 1 && <div className="aviso" style={{ marginBottom: 0 }}>Ojo: son de clientes distintos ({clientes.join(", ")}).</div>}
      <div className="field">
        <label>Proyecto</label>
        <select value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="nuevo">+ Proyecto nuevo</option>
          {proyectos.map((p) => <option key={p.id} value={p.id}>{p.numero} · {p.nombre}</option>)}
        </select>
      </div>
      {destino === "nuevo" && <>
        <div className="field">
          <label>Nombre</label>
          <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Regimiento Linares – materiales de mantención" />
        </div>
        <div className="field">
          <label>Código de la licitación (opcional)</label>
          <input value={form.licitacion_codigo} onChange={(e) => setForm({ ...form, licitacion_codigo: e.target.value })} placeholder="Ej: 3385-107-LE26 (si la cotización vino de Licitaciones se completa solo)" />
        </div>
      </>}
    </Modal>
  );
}

export function DetalleProyecto({ id, notify, esAdmin, onClose, verVenta, irACompra, onCambio }) {
  const [p, setP] = useState(null);
  const [cuadro, setCuadro] = useState(false);
  const [agregar, setAgregar] = useState(false);
  const [editar, setEditar] = useState(false);
  const [sel, setSel] = useState(new Set());

  const cargar = useCallback(async () => {
    try { setP(await api(`/proyectos/${id}`)); } catch (e) { notify(e.message, "danger"); onClose(); }
  }, [id, notify, onClose]);
  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (fn, ok) => {
    try { await fn(); if (ok) notify(ok); setSel(new Set()); cargar(); onCambio?.(); } catch (e) { notify(e.message, "danger"); }
  };

  if (!p) return <Modal titulo="// Proyecto" onClose={onClose}><div className="cot-empty"><span className="spinner"></span>Cargando...</div></Modal>;
  const r = p.resumen;
  const ventas = p.ventas;
  const borradores = p.ordenes.filter((o) => o.estado === "borrador");
  // Proveedores con 2 o más órdenes en borrador: se pueden unir
  const porProv = new Map();
  borradores.forEach((o) => porProv.set(o.proveedor_nombre, [...(porProv.get(o.proveedor_nombre) || []), o]));
  const unibles = [...porProv.entries()].filter(([, os]) => os.length > 1);
  const origen = (o) => (o.proyecto_id ? "Proyecto" : ventas.find((v) => v.id === o.venta_id)?.numero || "—");
  const toggle = (oid) => setSel((s) => { const x = new Set(s); x.has(oid) ? x.delete(oid) : x.add(oid); return x; });

  return (
    <Modal titulo={`// Proyecto ${p.numero}`} onClose={onClose} ancho={1080}
      footer={<>
        {esAdmin && <button className="btn btn-danger" onClick={() => confirm("¿Deshacer este proyecto? Las ventas y órdenes de compra NO se borran, solo quedan sueltas.") && accion(() => api(`/proyectos/${p.id}`, { method: "DELETE" }), "Proyecto deshecho").then(onClose)}>Deshacer proyecto</button>}
        <button className="btn btn-ghost" onClick={() => accion(() => api(`/proyectos/${p.id}`, { method: "PUT", body: { estado: p.estado === "abierto" ? "cerrado" : "abierto" } }), p.estado === "abierto" ? "Proyecto cerrado" : "Proyecto reabierto")}>
          {p.estado === "abierto" ? "Marcar terminado" : "Reabrir"}
        </button>
        {esAdmin && <button className="btn btn-primary" onClick={() => setCuadro(true)}>Compra consolidada</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="hist-nombre" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {p.nombre}
        <button className="link" onClick={() => setEditar(true)}>editar</button>
      </div>
      <div className="hist-meta">
        <span>{p.cliente_nombre || "Sin cliente"}</span>
        {p.licitacion_codigo && (esCodigoMP(p.licitacion_codigo)
          ? <a className="link" href={fichaMP(p.licitacion_codigo)} target="_blank" rel="noreferrer">Licitación {p.licitacion_codigo} ↗</a>
          : <span>Licitación {p.licitacion_codigo}</span>)}
        <span>Creado {fecha(p.createdAt)}{p.creado_por ? ` por ${p.creado_por}` : ""}</span>
        <Estado valor={p.estado === "abierto" ? "abierto" : "cerrado"} />
      </div>
      {p.notas && <div className="mini" style={{ whiteSpace: "pre-wrap" }}>{p.notas}</div>}

      <div className="kpis">
        <div className="stat-card"><div className="stat-label">OC del organismo</div><div className="stat-value">{r.ventas}</div></div>
        <div className="stat-card"><div className="stat-label">Venta neta</div><div className="stat-value accent">{fmt(r.neto)}</div><div className="mini">{fmt(r.total)} con IVA</div></div>
        <div className="stat-card"><div className="stat-label">Por cobrar</div><div className="stat-value" style={{ fontSize: 18, color: r.por_cobrar > 0.5 ? "var(--danger)" : "var(--success)" }}>{fmt(r.por_cobrar)}</div><div className="mini">cobrado {fmt(r.cobrado)}</div></div>
        {esAdmin && <div className="stat-card"><div className="stat-label">Compras a proveedores</div><div className="stat-value" style={{ fontSize: 18 }}>{fmt(r.compras)}</div><div className="mini">recibido {fmt(r.compras_recibidas)} · por pagar {fmt(r.por_pagar)}</div></div>}
        {esAdmin && <div className="stat-card"><div className="stat-label">Utilidad</div><div className="stat-value" style={{ fontSize: 18, color: (r.utilidad_real ?? r.utilidad) >= 0 ? "var(--success)" : "var(--danger)" }}>{fmt(r.utilidad_real ?? r.utilidad)}</div><div className="mini">{r.utilidad_real !== null ? "con lo comprado" : `cotizada · margen ${r.margen_pct}%`}{r.gastos ? ` · gastos ${fmt(r.gastos)}` : ""}</div></div>}
      </div>

      <div className="panel">
        <div className="panel-titulo">
          Órdenes de compra del organismo (ventas)
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setAgregar(true)}>+ Agregar ventas</button>
        </div>
        <div className="table-wrap">
          <table className="table table-compacta">
            <thead><tr><th>Venta</th><th>OC cliente</th><th>Fecha</th><th>Factura</th><th>Neto</th><th>Total</th><th>Saldo</th><th>Pago</th><th></th></tr></thead>
            <tbody>
              {ventas.length === 0 ? <tr className="empty-row"><td colSpan={9}>// sin ventas</td></tr> : ventas.map((v) => (
                <tr key={v.id} className={v.estado === "anulada" ? "fila-anulada" : ""}>
                  <td className="id-cell">{v.numero}</td>
                  <td>{v.orden_compra_cliente || <span className="mini">—</span>}</td>
                  <td className="mini">{fecha(v.fecha)}</td>
                  <td className="mini">{v.documento || "—"}</td>
                  <td className="price-cell">{fmt(v.subtotal)}</td>
                  <td className="price-cell">{fmt(v.total)}</td>
                  <td className="price-cell">{fmt(Number(v.total) - Number(v.monto_pagado))}</td>
                  <td><Estado valor={v.estado === "anulada" ? "anulada" : v.estado_pago} /></td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => verVenta(v.id)}>Ver</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => confirm(`¿Sacar ${v.numero} del proyecto? La venta no se borra.`) && accion(() => api(`/proyectos/${p.id}/ventas/${v.id}`, { method: "DELETE" }), "Venta quitada del proyecto")}>Quitar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {esAdmin && (
        <div className="panel">
          <div className="panel-titulo">Compras a proveedores ({p.ordenes.length})</div>
          {unibles.length > 0 && (
            <div className="aviso" style={{ marginBottom: 0, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              Hay órdenes en borrador del mismo proveedor que se pueden juntar en una sola:
              {unibles.map(([prov, os]) => (
                <button key={prov} className="btn btn-primary btn-sm" onClick={() => confirm(`¿Unir ${os.map((o) => o.numero).join(", ")} de ${prov} en una sola orden?`) && accion(() => api(`/proyectos/${p.id}/unir-ordenes`, { method: "POST", body: { orden_ids: os.map((o) => o.id) } }), `✓ Órdenes de ${prov} unidas`)}>
                  Unir las {os.length} de {prov}
                </button>
              ))}
            </div>
          )}
          {p.ordenes.length === 0 ? <div className="mini">Aún no hay compras. Usa "Compra consolidada" para generar una orden por proveedor con todo el proyecto.</div> : (
            <div className="table-wrap">
              <table className="table table-compacta">
                <thead><tr><th></th><th>N°</th><th>Proveedor</th><th>Para</th><th>Productos</th><th>Neto</th><th>Estado</th><th>Pago</th><th></th></tr></thead>
                <tbody>{p.ordenes.map((o) => (
                  <tr key={o.id}>
                    <td>{o.estado === "borrador" && <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} title="Marcar para unir" />}</td>
                    <td className="id-cell">{o.numero}</td>
                    <td>{o.proveedor_nombre}</td>
                    <td className="mini">{origen(o)}</td>
                    <td className="mini">{o.items}</td>
                    <td className="price-cell">{fmt(o.subtotal)}</td>
                    <td><Estado valor={o.estado} /></td>
                    <td><Estado valor={o.estado_pago} /></td>
                    <td><div className="actions"><button className="btn btn-ghost btn-sm" onClick={() => irACompra?.(o.id)}>Ver</button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {sel.size > 1 && (
            <div><button className="btn btn-primary btn-sm" onClick={() => accion(() => api(`/proyectos/${p.id}/unir-ordenes`, { method: "POST", body: { orden_ids: [...sel] } }), "✓ Órdenes unidas")}>Unir las {sel.size} marcadas</button>
              <span className="mini"> · solo órdenes en borrador del mismo proveedor</span></div>
          )}
        </div>
      )}

      {cuadro && <CuadroProyecto id={p.id} notify={notify} irACompra={irACompra} onClose={() => { setCuadro(false); cargar(); onCambio?.(); }} />}
      {agregar && <AgregarVentas proyecto={p} notify={notify} onClose={() => setAgregar(false)} onListo={() => { setAgregar(false); cargar(); onCambio?.(); }} />}
      {editar && <EditarProyecto proyecto={p} notify={notify} onClose={() => setEditar(false)} onListo={() => { setEditar(false); cargar(); onCambio?.(); }} />}
    </Modal>
  );
}

function EditarProyecto({ proyecto, notify, onClose, onListo }) {
  const [form, setForm] = useState({ nombre: proyecto.nombre, licitacion_codigo: proyecto.licitacion_codigo || "", notas: proyecto.notas || "" });
  const guardar = async () => {
    try { await api(`/proyectos/${proyecto.id}`, { method: "PUT", body: form }); notify("✓ Proyecto actualizado"); onListo(); }
    catch (e) { notify(e.message, "danger"); }
  };
  return (
    <Modal titulo={`// Editar ${proyecto.numero}`} onClose={onClose} ancho={560}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={guardar}>Guardar</button></>}>
      <div className="field"><label>Nombre</label><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
      <div className="field"><label>Código de la licitación</label><input value={form.licitacion_codigo} onChange={(e) => setForm({ ...form, licitacion_codigo: e.target.value })} /></div>
      <div className="field"><label>Notas</label><textarea className="textarea" rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></div>
    </Modal>
  );
}

function AgregarVentas({ proyecto, notify, onClose, onListo }) {
  const [ventas, setVentas] = useState(null);
  const [sel, setSel] = useState(new Set());
  useEffect(() => {
    api("/ventas?proyecto_id=ninguno").then((vs) => {
      const activas = vs.filter((v) => v.estado !== "anulada");
      // Primero las del mismo cliente
      activas.sort((a, b) => (b.cliente_nombre === proyecto.cliente_nombre) - (a.cliente_nombre === proyecto.cliente_nombre) || b.id - a.id);
      setVentas(activas);
    }).catch((e) => notify(e.message, "danger"));
  }, [proyecto.cliente_nombre, notify]);
  const guardar = async () => {
    try { await api(`/proyectos/${proyecto.id}/ventas`, { method: "POST", body: { venta_ids: [...sel] } }); notify(`✓ ${sel.size} venta(s) agregadas`); onListo(); }
    catch (e) { notify(e.message, "danger"); }
  };
  return (
    <Modal titulo={`// Agregar ventas a ${proyecto.numero}`} onClose={onClose} ancho={760}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!sel.size} onClick={guardar}>Agregar {sel.size || ""}</button></>}>
      {!ventas ? <div className="cot-empty"><span className="spinner"></span>Cargando...</div> : ventas.length === 0 ? <div className="mini">No hay ventas sueltas (sin proyecto).</div> : (
        <div className="table-wrap">
          <table className="table table-compacta">
            <thead><tr><th></th><th>Venta</th><th>Fecha</th><th>Cliente</th><th>OC cliente</th><th>Total</th></tr></thead>
            <tbody>{ventas.map((v) => (
              <tr key={v.id} className="clickable" onClick={() => setSel((s) => { const x = new Set(s); x.has(v.id) ? x.delete(v.id) : x.add(v.id); return x; })}>
                <td><input type="checkbox" readOnly checked={sel.has(v.id)} /></td>
                <td className="id-cell">{v.numero}</td><td className="mini">{fecha(v.fecha)}</td><td>{v.cliente_nombre || "—"}</td>
                <td className="mini">{v.orden_compra_cliente || "—"}</td><td className="price-cell">{fmt(v.total)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// Lo que hay que comprar para todo el proyecto, sumado por proveedor y producto
function CuadroProyecto({ id, notify, irACompra, onClose }) {
  const [c, setC] = useState(null);
  const [generando, setGenerando] = useState(false);
  const cargar = useCallback(async () => {
    try { setC(await api(`/proyectos/${id}/cuadro-compra`)); } catch (e) { notify(e.message, "danger"); onClose(); }
  }, [id, notify, onClose]);
  useEffect(() => { cargar(); }, [cargar]);

  const generar = async (proveedores) => {
    setGenerando(true);
    try {
      const r = await api(`/proyectos/${id}/generar-ordenes`, { method: "POST", body: proveedores ? { proveedores } : {} });
      notify(r.creadas.length ? `✓ ${r.creadas.length} orden(es) creadas: ${r.creadas.map((o) => `${o.numero} ${o.proveedor_nombre}`).join(", ")}` : "No había órdenes nuevas que crear");
      if (r.omitidos.length) notify(`Omitido: ${r.omitidos.join(" · ")}`, "danger");
      cargar();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGenerando(false); }
  };

  if (!c) return <Modal titulo="// Compra consolidada" onClose={onClose}><div className="cot-empty"><span className="spinner"></span>Cargando...</div></Modal>;
  const faltan = c.grupos.filter((g) => !g.ordenes.length && g.proveedor !== "SIN PROVEEDOR");
  return (
    <Modal titulo={`// Compra consolidada · ${c.proyecto.numero}`} onClose={onClose} ancho={1000}
      footer={<>
        {faltan.length > 0 && <button className="btn btn-primary" disabled={generando} onClick={() => generar()}>{generando ? "Generando..." : `Generar ${faltan.length} orden(es) consolidadas`}</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="mini">Suma lo de todas las órdenes del organismo del proyecto: una sola orden por proveedor. Los proveedores que ya tienen orden (del proyecto o de una venta) no se repiten.</div>
      {c.grupos.map((g) => (
        <div key={g.proveedor} className="panel">
          <div className="panel-titulo">
            {g.proveedor}
            <span className="mini">compra {fmt(g.total_compra)} · venta {fmt(g.total_venta)} · margen {fmt(g.margen)}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {g.ordenes.map((o) => <button key={o.id} className="link" onClick={() => irACompra?.(o.id)}>{o.numero} ({o.estado})</button>)}
              {!g.ordenes.length && g.proveedor !== "SIN PROVEEDOR" && <button className="btn btn-success btn-sm" disabled={generando} onClick={() => generar([g.proveedor])}>Generar orden</button>}
              {g.proveedor === "SIN PROVEEDOR" && <span className="estado estado-warn">elige proveedor en cada venta</span>}
            </span>
          </div>
          <div className="table-wrap">
            <table className="table table-compacta">
              <thead><tr><th className="col-desc">Producto</th><th>Cantidad</th><th>Costo unit.</th><th>Total compra</th><th>De las ventas</th></tr></thead>
              <tbody>{g.lineas.map((l, k) => (
                <tr key={k}><td>{l.nombre}</td><td className="mini">{l.cantidad} {l.unidad}</td><td className="price-cell compra">{fmt(l.costo)}</td><td className="price-cell">{fmt(l.total_compra)}</td><td className="mini">{l.ventas.join(", ")}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ))}
    </Modal>
  );
}
