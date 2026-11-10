import { useState, useEffect, useCallback } from "react";
import { Modal, Estado, ItemsEditor, Totales, PagosPanel, confirmar } from "./ui";
import { api, fmt, fecha, useProductos } from "./lib";
import DocumentoProveedor from "./DocumentoProveedor";

// Compras: las gestiona Operativo; Comercial solo consulta el avance. Los pagos a proveedores son de Finanzas (gerencia).
export default function Compras({ notify, esAdmin, puedeOperar, proveedores, onPreciosCambio, abrirOrdenId, onAbierta }) {
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState(null); // null | "nueva" | orden
  const [detalle, setDetalle] = useState(null);
  const [documento, setDocumento] = useState(false);
  // Una sola vista: por período (semana, mes o todo) y dentro, por venta. Lo antiguo queda cerrado.
  const [periodo, setPeriodo] = useState(() => { try { return localStorage.getItem("compras_periodo") || "mes"; } catch { return "mes"; } });
  const cambiarPeriodo = (v) => { setPeriodo(v); setAbiertos(new Set()); try { localStorage.setItem("compras_periodo", v); } catch { /* */ } };
  const [abiertos, setAbiertos] = useState(new Set()); // períodos abiertos a mano (además del más reciente)
  const [ventasAbiertas, setVentasAbiertas] = useState(new Set());
  const alternar = (set, fn, k) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); fn(n); };

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filtro === "porpagar") { p.append("estado", "recibida"); }
      else if (filtro) p.append("estado", filtro);
      if (busqueda) p.append("busqueda", busqueda);
      let data = await api(`/ordenes-compra?${p}`);
      if (filtro === "porpagar") data = data.filter((o) => o.estado_pago !== "pagada");
      setOrdenes(data);
    } catch (e) { notify(e.message, "danger"); }
    finally { setLoading(false); }
  }, [filtro, busqueda, notify]);

  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  const verDetalle = async (id) => {
    try { setDetalle(await api(`/ordenes-compra/${id}`)); } catch (e) { notify(e.message, "danger"); }
  };
  const refrescar = (id) => { cargar(); if (id) verDetalle(id); };

  // Permite abrir una orden desde otra vista (p.ej. el cuadro de compra de una venta)
  useEffect(() => {
    if (abrirOrdenId) { verDetalle(abrirOrdenId); onAbierta?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirOrdenId]);

  const activas = ordenes.filter((o) => o.estado === "recibida");
  const porPagar = activas.reduce((s, o) => s + Number(o.total) - Number(o.monto_pagado), 0);

  return (
    <>
      <div className="stats">
        <div className="stat-card"><div className="stat-label">Borradores</div><div className="stat-value">{ordenes.filter((o) => o.estado === "borrador").length}</div></div>
        <div className="stat-card"><div className="stat-label">Recibidas</div><div className="stat-value">{activas.length}</div></div>
        <div className="stat-card"><div className="stat-label">Comprado (con IVA)</div><div className="stat-value accent">{fmt(activas.reduce((s, o) => s + Number(o.total), 0))}</div></div>
        {esAdmin && <div className="stat-card"><div className="stat-label">Por pagar</div><div className="stat-value" style={{ color: porPagar > 0 ? "var(--danger)" : "var(--success)", fontSize: 16 }}>{fmt(porPagar)}</div></div>}
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por N° de orden, proveedor, factura o N° de venta..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <select className="filter-select" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="">Todas</option>
          <option value="borrador">Borradores (por recibir)</option>
          <option value="recibida">Recibidas</option>
          {esAdmin && <option value="porpagar">Recibidas sin pagar</option>}
          <option value="anulada">Anuladas</option>
        </select>
        {puedeOperar && <button className="btn btn-ghost" onClick={() => setDocumento(true)} title="Cotización o factura del proveedor: actualiza el historial de precios">⇪ Documento proveedor</button>}
        {puedeOperar && <button className="btn btn-primary" onClick={() => setEditando("nueva")} disabled={proveedores.length === 0}
          title={proveedores.length === 0 ? "Primero crea un proveedor" : ""}>+ Nueva orden</button>}
      </div>
      {!puedeOperar && <div className="mini" style={{ marginBottom: 10 }}>Vista de consulta: las compras las gestiona el departamento Operativo.</div>}
      {puedeOperar && proveedores.length === 0 && <div className="aviso">Para crear órdenes de compra primero registra al menos un proveedor en la pestaña Proveedores.</div>}

      <div className="chips" style={{ marginBottom: 10 }}>
        {[["semana", "Por semana"], ["mes", "Por mes"], ["todo", "Todo junto"]].map(([v, t]) => (
          <button key={v} className={`chip ${periodo === v ? "activo" : ""}`} onClick={() => cambiarPeriodo(v)}>{t}</button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={7}><span className="spinner"></span>Cargando...</td></tr>
              : ordenes.length === 0 ? <tr className="empty-row"><td colSpan={7}>// sin órdenes de compra</td></tr>
              : periodos(ordenes, periodo).map((p, i) => {
                const buscando = !!busqueda.trim();
                const abierto = buscando || periodo === "todo" || (i === 0) !== abiertos.has(p.clave);
                const total = p.grupos.reduce((s, g) => s + g.ordenes.filter((o) => o.estado !== "anulada").reduce((a, o) => a + Number(o.total), 0), 0);
                return (
                  <PeriodoCompras key={p.clave} p={p} total={total} abierto={abierto} conTitulo={periodo !== "todo"}
                    onToggle={() => alternar(abiertos, setAbiertos, p.clave)}>
                    {abierto && p.grupos.map((g) => (
                      <GrupoCompras key={g.clave} g={g} verDetalle={verDetalle} esAdmin={esAdmin} abierto={buscando || ventasAbiertas.has(`${p.clave}|${g.clave}`)}
                        onToggle={() => alternar(ventasAbiertas, setVentasAbiertas, `${p.clave}|${g.clave}`)} />
                    ))}
                  </PeriodoCompras>
                );
              })}
          </tbody>
        </table>
      </div>

      {documento && <DocumentoProveedor notify={notify} proveedores={proveedores} onClose={() => { setDocumento(false); onPreciosCambio?.(); }} />}
      {editando && (
        <FormOrden orden={editando === "nueva" ? null : editando} proveedores={proveedores} notify={notify}
          onClose={() => setEditando(null)}
          onGuardada={(o) => { setEditando(null); refrescar(o.id); }} />
      )}
      {detalle && (
        <DetalleOrden orden={detalle} esAdmin={esAdmin} puedeOperar={puedeOperar} notify={notify} onClose={() => setDetalle(null)}
          onEditar={() => { setEditando(detalle); setDetalle(null); }}
          onCambio={(precios) => { refrescar(detalle.id); if (precios) onPreciosCambio?.(); }}
          onEliminada={() => { setDetalle(null); cargar(); }} />
      )}
    </>
  );
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const dia = (f) => { const d = new Date(String(f || "").slice(0, 10) + "T12:00:00"); return isNaN(d) ? new Date() : d; };
function clavePeriodo(f, modo) {
  const d = dia(f);
  if (modo === "todo") return { clave: "todo", titulo: "Todas" };
  if (modo === "mes") return { clave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, titulo: `${MESES[d.getMonth()]} ${d.getFullYear()}` };
  const lunes = new Date(d); lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
  const corto = (x) => `${x.getDate()} ${MESES[x.getMonth()].slice(0, 3).toLowerCase()}`;
  return { clave: lunes.toISOString().slice(0, 10), titulo: `Semana del ${corto(lunes)} al ${corto(domingo)} ${domingo.getFullYear()}` };
}

// Cada venta va en el período de su compra más reciente (así no se repite); las compras sueltas, por su propia fecha
function periodos(ordenes, modo) {
  const mapa = new Map();
  const poner = (per, g) => { if (!mapa.has(per.clave)) mapa.set(per.clave, { ...per, grupos: [] }); mapa.get(per.clave).grupos.push(g); };
  for (const g of grupos(ordenes)) {
    if (g.venta) {
      const ultima = g.ordenes.reduce((m, o) => (String(o.fecha) > String(m) ? o.fecha : m), "");
      poner(clavePeriodo(ultima, modo), g);
    } else {
      const porPer = new Map();
      for (const o of g.ordenes) { const per = clavePeriodo(o.fecha, modo); if (!porPer.has(per.clave)) porPer.set(per.clave, { per, ordenes: [] }); porPer.get(per.clave).ordenes.push(o); }
      for (const { per, ordenes: os } of porPer.values()) poner(per, { clave: "sueltas", venta: null, ordenes: os });
    }
  }
  const lista = [...mapa.values()].sort((a, b) => (a.clave < b.clave ? 1 : -1));
  for (const p of lista) p.grupos.sort((a, b) => (a.clave === "sueltas") - (b.clave === "sueltas"));
  return lista;
}

function PeriodoCompras({ p, total, abierto, conTitulo, onToggle, children }) {
  if (!conTitulo) return <>{children}</>;
  const ventas = p.grupos.filter((g) => g.venta).length;
  const sueltas = p.grupos.find((g) => !g.venta)?.ordenes.length || 0;
  return (
    <>
      <tr className="fila-periodo" onClick={onToggle} style={{ cursor: "pointer" }}>
        <td colSpan={4}><strong>{abierto ? "▾" : "▸"} {p.titulo}</strong> <span className="mini">· {ventas} venta(s){sueltas ? ` · ${sueltas} compra(s) suelta(s)` : ""}</span></td>
        <td className="price-cell"><strong>{fmt(total)}</strong></td>
        <td colSpan={2}></td>
      </tr>
      {children}
    </>
  );
}

// Agrupa las órdenes por la venta para la que se compró (una OC del cliente = una venta); las demás van en "Compras sueltas"
function grupos(ordenes) {
  const mapa = new Map();
  for (const o of ordenes) {
    const clave = o.venta ? `v${o.venta.id}` : "sueltas";
    if (!mapa.has(clave)) mapa.set(clave, { clave, venta: o.venta, ordenes: [] });
    mapa.get(clave).ordenes.push(o);
  }
  const lista = [...mapa.values()];
  // La venta con la orden más nueva primero; las sueltas al final
  lista.sort((a, b) => (a.clave === "sueltas") - (b.clave === "sueltas") || Math.max(...b.ordenes.map((o) => o.id)) - Math.max(...a.ordenes.map((o) => o.id)));
  return lista;
}

function GrupoCompras({ g, verDetalle, esAdmin, abierto, onToggle }) {
  const vivas = g.ordenes.filter((o) => o.estado !== "anulada");
  const total = vivas.reduce((s, o) => s + Number(o.total), 0);
  const recibidas = vivas.filter((o) => o.estado === "recibida").length;
  const saldo = vivas.filter((o) => o.estado === "recibida").reduce((s, o) => s + Number(o.total) - Number(o.monto_pagado), 0);
  const titulo = g.venta
    ? <>Venta <strong>{g.venta.numero}</strong> · {g.venta.cliente_nombre || "Sin cliente"}{g.venta.orden_compra_cliente ? ` · OC cliente ${g.venta.orden_compra_cliente}` : ""}{g.venta.id_solicitud ? ` · ID ${g.venta.id_solicitud}` : ""}{g.venta.empresa === "tactics" ? " · Tactics" : ""}</>
    : <>Compras sueltas (sin venta)</>;
  return (
    <>
      <tr className="fila-grupo" onClick={onToggle} style={{ cursor: "pointer" }}>
        <td colSpan={3}>{abierto ? "▾" : "▸"} {titulo}</td>
        <td className="mini">{vivas.length} orden(es) · {recibidas} recibida(s)</td>
        <td className="price-cell">{fmt(total)}</td>
        <td colSpan={2} className="mini">{recibidas === vivas.length && vivas.length ? "Todo recibido" : `${vivas.length - recibidas} por recibir`}{esAdmin && saldo > 0 ? ` · por pagar ${fmt(saldo)}` : ""}</td>
      </tr>
      {abierto && g.ordenes.map((o) => <FilaOrden key={o.id} o={o} verDetalle={verDetalle} sangria />)}
    </>
  );
}

function FilaOrden({ o, verDetalle, sangria }) {
  return (
    <tr className={o.estado === "anulada" ? "fila-anulada" : ""}>
      <td className="id-cell" style={sangria ? { paddingLeft: 28 } : undefined}>{sangria ? "└ " : ""}{o.numero}</td>
      <td className="mini">{fecha(o.fecha)}</td>
      <td>{o.proveedor_nombre}</td>
      <td className="mini">{o.documento || "—"}</td>
      <td className="price-cell">{fmt(o.total)}</td>
      <td><Estado valor={o.estado} /></td>
      <td><div className="actions"><button className="btn btn-ghost btn-sm" onClick={() => verDetalle(o.id)}>Ver</button></div></td>
    </tr>
  );
}

// Elegir la venta para la que se compra (ventas no anuladas, las más nuevas primero)
function SelectorVenta({ valor, onChange, disabled }) {
  const [ventas, setVentas] = useState([]);
  useEffect(() => { api("/ventas").then((vs) => setVentas(vs.filter((v) => v.estado !== "anulada"))).catch(() => {}); }, []);
  return (
    <select value={valor || ""} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">— Sin venta (compra suelta) —</option>
      {ventas.map((v) => <option key={v.id} value={v.id}>{v.numero} · {v.cliente_nombre || "Sin cliente"}{v.orden_compra_cliente ? ` · OC ${v.orden_compra_cliente}` : ""}{v.id_solicitud ? ` · ID ${v.id_solicitud}` : ""}</option>)}
    </select>
  );
}

function FormOrden({ orden, proveedores, notify, onClose, onGuardada }) {
  const productos = useProductos();
  const [items, setItems] = useState(() => orden?.items || []);
  const [form, setForm] = useState({
    proveedor_id: orden?.proveedor_id || proveedores[0]?.id || "",
    documento: orden?.documento || "",
    fecha_vencimiento: orden?.fecha_vencimiento || "",
    notas: orden?.notas || "",
    venta_id: orden?.venta_id || null,
    empresa: orden?.empresa || "",
  });
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      const body = {
        ...form,
        proveedor_id: Number(form.proveedor_id),
        items: items.map((i) => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad), precio: Number(i.precio) })),
      };
      const o = orden
        ? await api(`/ordenes-compra/${orden.id}`, { method: "PUT", body })
        : await api("/ordenes-compra", { method: "POST", body });
      notify(`✓ Orden ${o.numero} guardada`);
      onGuardada(o);
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  return (
    <Modal titulo={orden ? `// Editar ${orden.numero}` : "// Nueva orden de compra"} onClose={onClose} ancho={720}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={guardando || items.length === 0 || !form.proveedor_id} onClick={guardar}>
          {guardando ? "Guardando..." : "Guardar borrador"}
        </button>
      </>}>
      <div className="fields-row">
        <div className="field">
          <label>Proveedor</label>
          <select value={form.proveedor_id} onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div className="field">
          <label>N° factura proveedor (opcional)</label>
          <input value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} placeholder="Ej: 88123" />
        </div>
      </div>
      <div className="fields-row">
        {!orden && (
          <div className="field">
            <label>Para la venta (opcional)</label>
            <SelectorVenta valor={form.venta_id} onChange={(venta_id) => setForm({ ...form, venta_id })} />
          </div>
        )}
        <div className="field">
          <label>Empresa que compra</label>
          <select value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })}>
            <option value="">{form.venta_id ? "La de la venta" : "— Elegir —"}</option>
            <option value="kenott">Kenott</option>
            <option value="tactics">Tactics</option>
          </select>
        </div>
      </div>
      <ItemsEditor items={items} setItems={setItems} productos={productos} precioDe={(p) => p.precio_compra} etiquetaPrecio="Costo neto" />
      <div className="fields-row">
        <div className="field">
          <label>Vencimiento del pago</label>
          <input type="date" value={form.fecha_vencimiento} onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })} />
        </div>
        <div className="field">
          <label>Notas</label>
          <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
        </div>
      </div>
      <div className="mini">La orden queda como borrador hasta que la marques como <strong>recibida</strong>.</div>
    </Modal>
  );
}

export function DetalleOrden({ orden, esAdmin, puedeOperar, notify, onClose, onEditar, onCambio, onEliminada }) {
  const [registrarPrecios, setRegistrarPrecios] = useState(true);
  const [factura, setFactura] = useState(orden.documento || "");
  const [fact, setFact] = useState({ fecha_factura: orden.fecha_factura || "", fecha_vencimiento: orden.fecha_vencimiento || "", empresa: orden.empresa || "" });
  const guardarFactura = () => accion(
    () => api(`/ordenes-compra/${orden.id}/factura`, { method: "PUT", body: { documento: factura, fecha_factura: fact.fecha_factura || undefined, fecha_vencimiento: fact.fecha_vencimiento || undefined, empresa: fact.empresa || null } }),
    factura ? "✓ Factura del proveedor guardada" : "✓ Guardado"
  );

  const accion = async (fn, ok, precios = false) => {
    try { await fn(); notify(ok); onCambio(precios); } catch (e) { notify(e.message, "danger"); }
  };
  const recibir = () => accion(
    () => api(`/ordenes-compra/${orden.id}/recibir`, { method: "POST", body: { registrar_precios: registrarPrecios, documento: factura || undefined } }),
    registrarPrecios ? "✓ Compra recibida — precios registrados" : "✓ Compra recibida", registrarPrecios
  );
  const anular = async () => {
    if (await confirmar(`¿Anular la orden ${orden.numero}?`, { titulo: "Anular orden de compra", boton: "Anular", peligro: true })) accion(() => api(`/ordenes-compra/${orden.id}/anular`, { method: "POST" }), "Orden anulada");
  };
  const eliminar = async () => {
    if (!(await confirmar(`¿Eliminar el borrador ${orden.numero}?`, { titulo: "Eliminar orden", boton: "Eliminar", peligro: true }))) return;
    try { await api(`/ordenes-compra/${orden.id}`, { method: "DELETE" }); notify("Borrador eliminado", "danger"); onEliminada(); }
    catch (e) { notify(e.message, "danger"); }
  };

  return (
    <Modal titulo={`// Orden ${orden.numero}`} onClose={onClose} ancho={720}
      footer={<>
        {orden.estado === "borrador" && puedeOperar && <>
          {esAdmin && <button className="btn btn-danger" onClick={eliminar}>Eliminar</button>}
          <button className="btn btn-ghost" onClick={onEditar}>Editar</button>
          <button className="btn btn-success" onClick={recibir}>✓ Marcar recibida</button>
        </>}
        {puedeOperar && orden.estado !== "anulada" && <button className="btn btn-danger" onClick={anular}>Anular</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="hist-meta">
        <span>{fecha(orden.fecha)}</span>
        <span>{orden.proveedor_nombre}</span>
        {orden.notas && orden.venta_id && <span>{orden.notas}</span>}
        {orden.documento && <span>Factura {orden.documento}{orden.fecha_factura ? ` del ${fecha(orden.fecha_factura)}` : ""}</span>}
        {orden.empresa && <span>{orden.empresa === "kenott" ? "Kenott" : "Tactics"}</span>}
        {orden.fecha_recepcion && <span>Recibida {fecha(orden.fecha_recepcion)}</span>}
        {orden.fecha_vencimiento && <span>Vence {fecha(orden.fecha_vencimiento)}</span>}
        {orden.creado_por && <span>Por {orden.creado_por}</span>}
        <Estado valor={orden.estado} />
      </div>
      <div className="field">
        <label>Para la venta</label>
        <SelectorVenta valor={orden.venta_id}
          onChange={(venta_id) => accion(() => api(`/ordenes-compra/${orden.id}/venta`, { method: "PUT", body: { venta_id } }), venta_id ? "✓ Orden asignada a la venta" : "Orden quitada de la venta")} />
      </div>
      {orden.notas && !orden.venta_id && <div className="mini">{orden.notas}</div>}
      <div className="table-wrap">
        <table className="table table-compacta">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Costo unit.</th><th>Total</th></tr></thead>
          <tbody>
            {orden.items.map((i, k) => (
              <tr key={k}>
                <td>{i.nombre}</td>
                <td className="mini">{i.cantidad} {i.unidad}</td>
                <td className="price-cell compra">{fmt(i.precio)}</td>
                <td className="price-cell">{fmt(i.precio * i.cantidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Totales subtotal={orden.subtotal} iva={orden.iva} total={orden.total} />
      {orden.estado !== "anulada" && puedeOperar && (
        <div className="panel" style={{ marginTop: 10 }}>
          <div className="panel-titulo">Factura del proveedor</div>
          <div className="fields-row">
            <div className="field"><label>N° factura</label><input value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="Ej: 88123" /></div>
            <div className="field"><label>Fecha factura</label><input type="date" value={fact.fecha_factura} onChange={(e) => setFact({ ...fact, fecha_factura: e.target.value })} /></div>
          </div>
          <div className="fields-row">
            <div className="field"><label>Empresa que compra</label>
              <select value={fact.empresa} onChange={(e) => setFact({ ...fact, empresa: e.target.value })}>
                <option value="">— Elegir —</option><option value="kenott">Kenott</option><option value="tactics">Tactics</option>
              </select></div>
            <div className="field"><label>Vence el pago</label><input type="date" value={fact.fecha_vencimiento} onChange={(e) => setFact({ ...fact, fecha_vencimiento: e.target.value })} /></div>
          </div>
          <div className="mini">Si dejas el vencimiento vacío se calcula con el plazo de pago del proveedor. El IVA de la factura se descuenta en el mes de la factura, en la empresa que compra.</div>
          <div style={{ textAlign: "right", marginTop: 6 }}><button className="btn btn-ghost btn-sm" onClick={guardarFactura}>Guardar factura</button></div>
        </div>
      )}
      {orden.estado === "borrador" && (
        <>
          <label className="check">
            <input type="checkbox" checked={registrarPrecios} onChange={(e) => setRegistrarPrecios(e.target.checked)} />
            Al recibir, guardar lo pagado en el historial de precios del proveedor (recalcula el precio vigente)
          </label>
        </>
      )}
      {esAdmin && (orden.estado === "recibida" || (orden.documento && orden.estado !== "anulada")) && (
        <PagosPanel
          key={orden.monto_pagado}
          doc={orden}
          tipo="pago"
          onRegistrar={(body) => accion(() => api(`/ordenes-compra/${orden.id}/pagos`, { method: "POST", body }), "✓ Pago registrado")}
          onEliminar={esAdmin ? async (p) => (await confirmar("¿Eliminar este pago?", { titulo: "Eliminar pago", boton: "Eliminar", peligro: true })) && accion(() => api(`/pagos/${p.id}`, { method: "DELETE" }), "Pago eliminado") : null}
        />
      )}
    </Modal>
  );
}
