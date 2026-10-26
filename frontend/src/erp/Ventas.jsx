import { useState, useEffect, useCallback } from "react";
import { Modal, Estado, ItemsEditor, Totales, PagosPanel } from "./ui";
import { api, fmt, fecha, useProductos } from "./lib";

export default function Ventas({ notify, clientes, abrirVentaId, onAbierta }) {
  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroPago, setFiltroPago] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [nueva, setNueva] = useState(false);
  const [detalle, setDetalle] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filtroPago) p.append("estado_pago", filtroPago);
      if (busqueda) p.append("busqueda", busqueda);
      setVentas(await api(`/ventas?${p}`));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLoading(false); }
  }, [filtroPago, busqueda, notify]);

  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  const verDetalle = useCallback(async (id) => {
    try { setDetalle(await api(`/ventas/${id}`)); } catch (e) { notify(e.message, "danger"); }
  }, [notify]);

  // Permite abrir una venta recién creada desde otra vista (p.ej. Historial)
  useEffect(() => {
    if (abrirVentaId) { verDetalle(abrirVentaId); onAbierta?.(); }
  }, [abrirVentaId, verDetalle, onAbierta]);

  const activas = ventas.filter((v) => v.estado !== "anulada");
  const porCobrar = activas.reduce((s, v) => s + Number(v.total) - Number(v.monto_pagado), 0);

  return (
    <>
      <div className="stats">
        <div className="stat-card"><div className="stat-label">Ventas listadas</div><div className="stat-value">{activas.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total (con IVA)</div><div className="stat-value accent">{fmt(activas.reduce((s, v) => s + Number(v.total), 0))}</div></div>
        <div className="stat-card"><div className="stat-label">Margen neto</div><div className="stat-value accent">{fmt(activas.reduce((s, v) => s + Number(v.subtotal) - Number(v.costo_total), 0))}</div></div>
        <div className="stat-card"><div className="stat-label">Por cobrar</div><div className="stat-value" style={{ color: porCobrar > 0 ? "var(--danger)" : "var(--success)", fontSize: 16 }}>{fmt(porCobrar)}</div></div>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por N°, cliente o documento..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <select className="filter-select" value={filtroPago} onChange={(e) => setFiltroPago(e.target.value)}>
          <option value="">Todas</option>
          <option value="pendiente">Pendientes de pago</option>
          <option value="parcial">Pago parcial</option>
          <option value="pagada">Pagadas</option>
        </select>
        <button className="btn btn-primary" onClick={() => setNueva(true)}>+ Nueva venta</button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Doc.</th><th>Total</th><th>Saldo</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={9}><span className="spinner"></span>Cargando...</td></tr>
              : ventas.length === 0 ? <tr className="empty-row"><td colSpan={9}>// sin ventas — conviértelas desde Historial o crea una nueva</td></tr>
              : ventas.map((v) => {
                const saldo = Number(v.total) - Number(v.monto_pagado);
                const vencida = v.estado !== "anulada" && saldo > 0 && v.fecha_vencimiento && v.fecha_vencimiento < new Date().toLocaleDateString("sv-SE");
                return (
                  <tr key={v.id} className={v.estado === "anulada" ? "fila-anulada" : ""}>
                    <td className="id-cell">{v.numero}</td>
                    <td className="mini">{fecha(v.fecha)}</td>
                    <td>{v.cliente_nombre || <span className="mini">Sin cliente</span>}</td>
                    <td className="mini">{v.documento || "—"}</td>
                    <td className="price-cell">{fmt(v.total)}</td>
                    <td className="price-cell" style={{ color: saldo > 0.5 ? "var(--text)" : "var(--text3)" }}>{fmt(saldo)}</td>
                    <td className={`mini ${vencida ? "stock-low" : ""}`}>{fecha(v.fecha_vencimiento)}{vencida ? " ⚠" : ""}</td>
                    <td><Estado valor={v.estado === "anulada" ? "anulada" : v.estado_pago} /></td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => verDetalle(v.id)}>Ver</button></td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {nueva && <NuevaVenta clientes={clientes} notify={notify} onClose={() => setNueva(false)} onCreada={(v) => { setNueva(false); cargar(); verDetalle(v.id); }} />}
      {detalle && <DetalleVenta venta={detalle} notify={notify} onClose={() => setDetalle(null)} onCambio={() => { cargar(); verDetalle(detalle.id); }} />}
    </>
  );
}

function NuevaVenta({ clientes, notify, onClose, onCreada }) {
  const productos = useProductos();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ cliente_id: "", documento: "", dias_credito: 30, pagada_al_contado: false, medio_pago: "efectivo", notas: "" });
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      const v = await api("/ventas", {
        method: "POST",
        body: {
          ...form,
          cliente_id: form.cliente_id ? Number(form.cliente_id) : null,
          dias_credito: form.pagada_al_contado ? 0 : Number(form.dias_credito),
          items: items.map((i) => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad), precio: Number(i.precio) })),
        },
      });
      notify(`✓ Venta ${v.numero} registrada — stock descontado`);
      onCreada(v);
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  return (
    <Modal titulo="// Nueva venta" onClose={onClose} ancho={720}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={guardando || items.length === 0} onClick={guardar}>{guardando ? "Guardando..." : "Registrar venta"}</button>
      </>}>
      <div className="fields-row">
        <div className="field">
          <label>Cliente</label>
          <select value={form.cliente_id} onChange={(e) => setForm({ ...form, cliente_id: e.target.value })}>
            <option value="">— Sin cliente —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="field">
          <label>N° factura / boleta (opcional)</label>
          <input value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} placeholder="Ej: F-1234" />
        </div>
      </div>
      <ItemsEditor items={items} setItems={setItems} productos={productos} campoPrecio="precio_venta" />
      <div className="fields-row">
        <label className="check">
          <input type="checkbox" checked={form.pagada_al_contado} onChange={(e) => setForm({ ...form, pagada_al_contado: e.target.checked })} />
          Pagada al contado
        </label>
        {form.pagada_al_contado ? (
          <div className="field">
            <label>Medio de pago</label>
            <select value={form.medio_pago} onChange={(e) => setForm({ ...form, medio_pago: e.target.value })}>
              {["efectivo", "transferencia", "tarjeta", "cheque"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
        ) : (
          <div className="field">
            <label>Días de crédito</label>
            <input type="number" min="0" value={form.dias_credito} onChange={(e) => setForm({ ...form, dias_credito: e.target.value })} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function DetalleVenta({ venta, notify, onClose, onCambio }) {
  const margen = Number(venta.subtotal) - Number(venta.costo_total);
  const pct = Number(venta.subtotal) ? Math.round((margen / Number(venta.subtotal)) * 100) : 0;

  const accion = async (fn, ok) => {
    try { await fn(); notify(ok); onCambio(); } catch (e) { notify(e.message, "danger"); }
  };
  const anular = () => {
    if (!confirm(`¿Anular la venta ${venta.numero}? El stock vuelve al inventario.`)) return;
    accion(() => api(`/ventas/${venta.id}/anular`, { method: "POST" }), "Venta anulada — stock devuelto");
  };

  return (
    <Modal titulo={`// Venta ${venta.numero}`} onClose={onClose} ancho={720}
      footer={<>
        {venta.estado !== "anulada" && <button className="btn btn-danger" onClick={anular}>Anular venta</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="hist-meta">
        <span>{fecha(venta.fecha)}</span>
        <span>{venta.cliente_nombre || "Sin cliente"}</span>
        {venta.documento && <span>Doc. {venta.documento}</span>}
        {venta.fecha_vencimiento && <span>Vence {fecha(venta.fecha_vencimiento)}</span>}
        <Estado valor={venta.estado} /> <Estado valor={venta.estado_pago} />
      </div>
      {venta.notas && <div className="mini">{venta.notas}</div>}
      <div className="table-wrap">
        <table className="table table-compacta">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Costo</th><th>Total</th></tr></thead>
          <tbody>
            {venta.items.map((i, k) => (
              <tr key={k}>
                <td>{i.nombre}</td>
                <td className="mini">{i.cantidad} {i.unidad}</td>
                <td className="price-cell">{fmt(i.precio)}</td>
                <td className="price-cell compra">{fmt(i.costo)}</td>
                <td className="price-cell">{fmt(i.precio * i.cantidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Totales subtotal={venta.subtotal} iva={venta.iva} total={venta.total} />
      <div className="mini">Margen bruto: <strong style={{ color: "var(--text)" }}>{fmt(margen)}</strong> ({pct}% sobre el neto)</div>
      <PagosPanel
        key={venta.monto_pagado}
        doc={venta}
        tipo="cobro"
        onRegistrar={(body) => accion(() => api(`/ventas/${venta.id}/cobros`, { method: "POST", body }), "✓ Cobro registrado")}
        onEliminar={(p) => confirm("¿Eliminar este cobro?") && accion(() => api(`/pagos/${p.id}`, { method: "DELETE" }), "Cobro eliminado")}
      />
    </Modal>
  );
}
