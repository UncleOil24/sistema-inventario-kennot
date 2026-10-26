import { useState, useEffect, useCallback } from "react";
import { Modal, Estado, ItemsEditor, Totales, PagosPanel } from "./ui";
import { api, fmt, fecha, useProductos } from "./lib";

export default function Compras({ notify, esAdmin, proveedores, onStockCambio }) {
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState(null); // null | "nueva" | orden
  const [detalle, setDetalle] = useState(null);

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

  const activas = ordenes.filter((o) => o.estado === "recibida");
  const porPagar = activas.reduce((s, o) => s + Number(o.total) - Number(o.monto_pagado), 0);

  return (
    <>
      <div className="stats">
        <div className="stat-card"><div className="stat-label">Borradores</div><div className="stat-value">{ordenes.filter((o) => o.estado === "borrador").length}</div></div>
        <div className="stat-card"><div className="stat-label">Recibidas</div><div className="stat-value">{activas.length}</div></div>
        <div className="stat-card"><div className="stat-label">Comprado (con IVA)</div><div className="stat-value accent">{fmt(activas.reduce((s, o) => s + Number(o.total), 0))}</div></div>
        <div className="stat-card"><div className="stat-label">Por pagar</div><div className="stat-value" style={{ color: porPagar > 0 ? "var(--danger)" : "var(--success)", fontSize: 16 }}>{fmt(porPagar)}</div></div>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por N°, proveedor o factura..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <select className="filter-select" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="">Todas</option>
          <option value="borrador">Borradores (por recibir)</option>
          <option value="recibida">Recibidas</option>
          <option value="porpagar">Recibidas sin pagar</option>
          <option value="anulada">Anuladas</option>
        </select>
        <button className="btn btn-primary" onClick={() => setEditando("nueva")} disabled={proveedores.length === 0}
          title={proveedores.length === 0 ? "Primero crea un proveedor" : ""}>+ Nueva orden</button>
      </div>
      {proveedores.length === 0 && <div className="aviso">Para crear órdenes de compra primero registra al menos un proveedor en la pestaña Proveedores.</div>}

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Total</th><th>Saldo</th><th>Estado</th><th>Pago</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={9}><span className="spinner"></span>Cargando...</td></tr>
              : ordenes.length === 0 ? <tr className="empty-row"><td colSpan={9}>// sin órdenes de compra</td></tr>
              : ordenes.map((o) => (
                <tr key={o.id} className={o.estado === "anulada" ? "fila-anulada" : ""}>
                  <td className="id-cell">{o.numero}</td>
                  <td className="mini">{fecha(o.fecha)}</td>
                  <td>{o.proveedor_nombre}</td>
                  <td className="mini">{o.documento || "—"}</td>
                  <td className="price-cell">{fmt(o.total)}</td>
                  <td className="price-cell">{o.estado === "recibida" ? fmt(Number(o.total) - Number(o.monto_pagado)) : "—"}</td>
                  <td><Estado valor={o.estado} /></td>
                  <td>{o.estado === "recibida" ? <Estado valor={o.estado_pago} /> : <span className="mini">—</span>}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => verDetalle(o.id)}>Ver</button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <FormOrden orden={editando === "nueva" ? null : editando} proveedores={proveedores} notify={notify}
          onClose={() => setEditando(null)}
          onGuardada={(o) => { setEditando(null); refrescar(o.id); }} />
      )}
      {detalle && (
        <DetalleOrden orden={detalle} esAdmin={esAdmin} notify={notify} onClose={() => setDetalle(null)}
          onEditar={() => { setEditando(detalle); setDetalle(null); }}
          onCambio={(stock) => { refrescar(detalle.id); if (stock) onStockCambio?.(); }}
          onEliminada={() => { setDetalle(null); cargar(); }} />
      )}
    </>
  );
}

function FormOrden({ orden, proveedores, notify, onClose, onGuardada }) {
  const productos = useProductos();
  const [items, setItems] = useState(() => (orden?.items || []).map((i) => ({ ...i, stock: undefined })));
  const [form, setForm] = useState({
    proveedor_id: orden?.proveedor_id || proveedores[0]?.id || "",
    documento: orden?.documento || "",
    fecha_vencimiento: orden?.fecha_vencimiento || "",
    notas: orden?.notas || "",
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
      <ItemsEditor items={items} setItems={setItems} productos={productos} campoPrecio="precio_compra" mostrarStock={false} />
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
      <div className="mini">La orden queda como borrador. El stock sube recién cuando la marques como <strong>recibida</strong>.</div>
    </Modal>
  );
}

function DetalleOrden({ orden, esAdmin, notify, onClose, onEditar, onCambio, onEliminada }) {
  const [actualizarCostos, setActualizarCostos] = useState(true);

  const accion = async (fn, ok, stock = false) => {
    try { await fn(); notify(ok); onCambio(stock); } catch (e) { notify(e.message, "danger"); }
  };
  const recibir = () => accion(
    () => api(`/ordenes-compra/${orden.id}/recibir`, { method: "POST", body: { actualizar_costos: actualizarCostos } }),
    "✓ Mercadería recibida — stock actualizado", true
  );
  const anular = () => {
    const extra = orden.estado === "recibida" ? " Se descontará del stock lo que ingresó." : "";
    if (confirm(`¿Anular ${orden.numero}?${extra}`)) accion(() => api(`/ordenes-compra/${orden.id}/anular`, { method: "POST" }), "Orden anulada", true);
  };
  const eliminar = async () => {
    if (!confirm(`¿Eliminar el borrador ${orden.numero}?`)) return;
    try { await api(`/ordenes-compra/${orden.id}`, { method: "DELETE" }); notify("Borrador eliminado", "danger"); onEliminada(); }
    catch (e) { notify(e.message, "danger"); }
  };

  return (
    <Modal titulo={`// Orden ${orden.numero}`} onClose={onClose} ancho={720}
      footer={<>
        {orden.estado === "borrador" && <>
          {esAdmin && <button className="btn btn-danger" onClick={eliminar}>Eliminar</button>}
          <button className="btn btn-ghost" onClick={onEditar}>Editar</button>
          <button className="btn btn-success" onClick={recibir}>✓ Marcar recibida</button>
        </>}
        {esAdmin && orden.estado === "recibida" && <button className="btn btn-danger" onClick={anular}>Anular</button>}
        {esAdmin && orden.estado === "borrador" && <button className="btn btn-danger" onClick={anular}>Anular</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="hist-meta">
        <span>{fecha(orden.fecha)}</span>
        <span>{orden.proveedor_nombre}</span>
        {orden.documento && <span>Factura {orden.documento}</span>}
        {orden.fecha_recepcion && <span>Recibida {fecha(orden.fecha_recepcion)}</span>}
        {orden.fecha_vencimiento && <span>Vence {fecha(orden.fecha_vencimiento)}</span>}
        {orden.creado_por && <span>Por {orden.creado_por}</span>}
        <Estado valor={orden.estado} />
      </div>
      {orden.notas && <div className="mini">{orden.notas}</div>}
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
      {orden.estado === "borrador" && (
        <label className="check">
          <input type="checkbox" checked={actualizarCostos} onChange={(e) => setActualizarCostos(e.target.checked)} />
          Al recibir, actualizar el precio de compra de los productos con estos costos
        </label>
      )}
      {orden.estado === "recibida" && (
        <PagosPanel
          key={orden.monto_pagado}
          doc={orden}
          tipo="pago"
          onRegistrar={(body) => accion(() => api(`/ordenes-compra/${orden.id}/pagos`, { method: "POST", body }), "✓ Pago registrado")}
          onEliminar={esAdmin ? (p) => confirm("¿Eliminar este pago?") && accion(() => api(`/pagos/${p.id}`, { method: "DELETE" }), "Pago eliminado") : null}
        />
      )}
    </Modal>
  );
}
