import { useState, useEffect, useCallback } from "react";
import { Modal, Estado, ItemsEditor, Totales, PagosPanel } from "./ui";
import { api, fmt, fecha, useProductos, precioSegun, TIPOS_GASTO } from "./lib";
import CuadroCompra from "./CuadroCompra";
import { ListaProyectos, DetalleProyecto, UnirEnProyecto } from "./Proyectos";

export default function Ventas({ notify, esAdmin, clientes, abrirVentaId, onAbierta, irACompra }) {
  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroPago, setFiltroPago] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [nueva, setNueva] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [modo, setModo] = useState("ventas"); // ventas | proyectos
  const [sel, setSel] = useState(new Set());
  const [unir, setUnir] = useState(false);
  const [proyecto, setProyecto] = useState(null); // id del proyecto abierto
  const [recargarProy, setRecargarProy] = useState(0);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filtroPago && filtroPago !== "porcomprar") p.append("estado_pago", filtroPago);
      if (busqueda) p.append("busqueda", busqueda);
      let data = await api(`/ventas?${p}`);
      if (filtroPago === "porcomprar") data = data.filter((v) => v.estado !== "anulada" && !v.tiene_compras);
      setVentas(data);
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
  const seleccionadas = ventas.filter((v) => sel.has(v.id));
  const marcar = (id) => setSel((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const refrescar = () => { cargar(); setRecargarProy((n) => n + 1); };
  const porCobrar = activas.reduce((s, v) => s + Number(v.total) - Number(v.monto_pagado), 0);

  const chipsModo = (
    <div className="chips" style={{ marginBottom: 12 }}>
      <button className={`chip ${modo === "ventas" ? "activo" : ""}`} onClick={() => setModo("ventas")}>Ventas</button>
      <button className={`chip ${modo === "proyectos" ? "activo" : ""}`} onClick={() => setModo("proyectos")}>Proyectos / licitaciones</button>
    </div>
  );
  const modales = (
    <>
      {unir && <UnirEnProyecto ventas={seleccionadas} notify={notify} onClose={() => setUnir(false)} onListo={(id) => { setUnir(false); setSel(new Set()); refrescar(); setProyecto(id); }} />}
      {proyecto && <DetalleProyecto id={proyecto} notify={notify} esAdmin={esAdmin} onClose={() => setProyecto(null)} verVenta={verDetalle} irACompra={irACompra} onCambio={refrescar} />}
    </>
  );
  if (modo === "proyectos") return (
    <>
      {chipsModo}
      <ListaProyectos notify={notify} esAdmin={esAdmin} onAbrir={setProyecto} recargar={recargarProy} />
      {modales}
      {detalle && <DetalleVenta venta={detalle} esAdmin={esAdmin} notify={notify} irACompra={irACompra} verProyecto={setProyecto} onClose={() => setDetalle(null)} onCambio={() => { refrescar(); verDetalle(detalle.id); }} />}
    </>
  );

  return (
    <>
      {chipsModo}
      <div className="stats">
        <div className="stat-card"><div className="stat-label">Ventas listadas</div><div className="stat-value">{activas.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total (con IVA)</div><div className="stat-value accent">{fmt(activas.reduce((s, v) => s + Number(v.total), 0))}</div></div>
        {esAdmin
          ? <div className="stat-card"><div className="stat-label">Margen neto</div><div className="stat-value accent">{fmt(activas.reduce((s, v) => s + Number(v.subtotal) - Number(v.costo_total), 0))}</div></div>
          : <div className="stat-card"><div className="stat-label">Neto (sin IVA)</div><div className="stat-value accent">{fmt(activas.reduce((s, v) => s + Number(v.subtotal), 0))}</div></div>}
        <div className="stat-card"><div className="stat-label">Por cobrar</div><div className="stat-value" style={{ color: porCobrar > 0 ? "var(--danger)" : "var(--success)", fontSize: 16 }}>{fmt(porCobrar)}</div></div>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por N°, cliente o documento..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <select className="filter-select" value={filtroPago} onChange={(e) => setFiltroPago(e.target.value)}>
          <option value="">Todas</option>
          {esAdmin && <option value="porcomprar">Por comprar (sin órdenes)</option>}
          <option value="pendiente">Pendientes de pago</option>
          <option value="parcial">Pago parcial</option>
          <option value="pagada">Pagadas</option>
        </select>
        {sel.size > 0 && <button className="btn btn-success" onClick={() => setUnir(true)}>Unir en proyecto ({sel.size})</button>}
        <button className="btn btn-primary" onClick={() => setNueva(true)}>+ Nueva venta</button>
      </div>
      {sel.size === 0 && <div className="mini" style={{ marginTop: -8, marginBottom: 10 }}>¿Varias órdenes de compra de una misma licitación? Márcalas con la casilla y pulsa "Unir en proyecto".</div>}

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th></th><th>N°</th><th>Fecha</th><th>Cliente</th><th>OC cliente</th><th>Proyecto</th><th>Factura</th><th>Total</th><th>Saldo</th><th>Vence</th><th>Estado</th>{esAdmin && <th>Compra</th>}<th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={13}><span className="spinner"></span>Cargando...</td></tr>
              : ventas.length === 0 ? <tr className="empty-row"><td colSpan={13}>// sin ventas — conviértelas desde Cotizaciones o crea una nueva</td></tr>
              : ventas.map((v) => {
                const saldo = Number(v.total) - Number(v.monto_pagado);
                const vencida = v.estado !== "anulada" && saldo > 0 && v.fecha_vencimiento && v.fecha_vencimiento < new Date().toLocaleDateString("sv-SE");
                return (
                  <tr key={v.id} className={v.estado === "anulada" ? "fila-anulada" : sel.has(v.id) ? "fila-alerta" : ""}>
                    <td>{v.estado !== "anulada" && !v.proyecto && <input type="checkbox" checked={sel.has(v.id)} onChange={() => marcar(v.id)} title="Marcar para unir en un proyecto" />}</td>
                    <td className="id-cell">{v.numero}</td>
                    <td className="mini">{fecha(v.fecha)}</td>
                    <td>{v.cliente_nombre || <span className="mini">Sin cliente</span>}</td>
                    <td className="mini">{v.orden_compra_cliente || "—"}</td>
                    <td>{v.proyecto ? <button className="link" title={v.proyecto.nombre} onClick={() => setProyecto(v.proyecto.id)}>{v.proyecto.numero}</button> : <span className="mini">—</span>}</td>
                    <td className="mini">{v.documento || "—"}</td>
                    <td className="price-cell">{fmt(v.total)}</td>
                    <td className="price-cell" style={{ color: saldo > 0.5 ? "var(--text)" : "var(--text3)" }}>{fmt(saldo)}</td>
                    <td className={`mini ${vencida ? "stock-low" : ""}`}>{fecha(v.fecha_vencimiento)}{vencida ? " ⚠" : ""}</td>
                    <td><Estado valor={v.estado === "anulada" ? "anulada" : v.estado_pago} /></td>
                    {esAdmin && <td className="mini">{v.estado === "anulada" ? "—" : v.tiene_compras ? "✓ con órdenes" : <span style={{ color: "var(--warn)" }}>por comprar</span>}</td>}
                    <td><button className="btn btn-ghost btn-sm" onClick={() => verDetalle(v.id)}>Ver</button></td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {nueva && <NuevaVenta clientes={clientes} notify={notify} onClose={() => setNueva(false)} onCreada={(v) => { setNueva(false); cargar(); verDetalle(v.id); }} />}
      {modales}
      {detalle && <DetalleVenta venta={detalle} esAdmin={esAdmin} notify={notify} irACompra={irACompra} verProyecto={setProyecto} onClose={() => setDetalle(null)} onCambio={() => { refrescar(); verDetalle(detalle.id); }} />}
    </>
  );
}

function NuevaVenta({ clientes, notify, onClose, onCreada }) {
  const productos = useProductos();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ cliente_id: "", documento: "", orden_compra_cliente: "", dias_credito: 30, pagada_al_contado: false, medio_pago: "efectivo", notas: "" });
  const tipo = clientes.find((c) => String(c.id) === String(form.cliente_id))?.tipo || "convenio";
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
      notify(`✓ Venta ${v.numero} registrada`);
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
          <label>N° orden de compra del cliente</label>
          <input value={form.orden_compra_cliente} onChange={(e) => setForm({ ...form, orden_compra_cliente: e.target.value })} placeholder="Ej: 2401-55-SE26" />
        </div>
      </div>
      <div className="mini">Precio sugerido: <Estado valor={tipo} /> · lo puedes corregir por línea.</div>
      <ItemsEditor key={tipo} items={items} setItems={setItems} productos={productos} precioDe={(p) => precioSegun(p, tipo)} />
      <div className="field">
        <label>N° factura / boleta (opcional)</label>
        <input value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} placeholder="Ej: F-1234" />
      </div>
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

function DetalleVenta({ venta, esAdmin, notify, onClose, onCambio, irACompra, verProyecto }) {
  const [cuadro, setCuadro] = useState(false);
  const [datos, setDatos] = useState({ documento: venta.documento || "", orden_compra_cliente: venta.orden_compra_cliente || "" });
  const r = venta.resumen;

  const accion = async (fn, ok) => {
    try { await fn(); notify(ok); onCambio(); } catch (e) { notify(e.message, "danger"); }
  };
  const anular = () => {
    if (!confirm(`¿Anular la venta ${venta.numero}? La cotización vuelve a quedar abierta.`)) return;
    accion(() => api(`/ventas/${venta.id}/anular`, { method: "POST" }), "Venta anulada");
  };
  const guardarDatos = () => accion(() => api(`/ventas/${venta.id}/datos`, { method: "PUT", body: datos }), "✓ Datos guardados");
  const cambioDatos = datos.documento !== (venta.documento || "") || datos.orden_compra_cliente !== (venta.orden_compra_cliente || "");

  return (
    <Modal titulo={`// Venta ${venta.numero}`} onClose={onClose} ancho={780}
      footer={<>
        {esAdmin && venta.estado !== "anulada" && <button className="btn btn-danger" onClick={anular}>Anular venta</button>}
        {esAdmin && venta.estado !== "anulada" && <button className="btn btn-primary" onClick={() => setCuadro(true)}>Cuadro de compra</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="hist-meta">
        <span>{fecha(venta.fecha)}</span>
        <span>{venta.cliente_nombre || "Sin cliente"}</span>
        {venta.fecha_vencimiento && <span>Vence {fecha(venta.fecha_vencimiento)}</span>}
        {venta.creado_por && <span>Por {venta.creado_por}</span>}
        <Estado valor={venta.estado} /> <Estado valor={venta.estado_pago} />
        {venta.proyecto && <button className="link" onClick={() => { onClose(); verProyecto?.(venta.proyecto.id); }}>Proyecto {venta.proyecto.numero} · {venta.proyecto.nombre} →</button>}
      </div>
      {venta.notas && <div className="mini">{venta.notas}</div>}
      {venta.estado !== "anulada" && (
        <div className="fields-row">
          <div className="field">
            <label>N° orden de compra del cliente</label>
            <input value={datos.orden_compra_cliente} onChange={(e) => setDatos({ ...datos, orden_compra_cliente: e.target.value })} />
          </div>
          <div className="field">
            <label>N° factura emitida</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={datos.documento} onChange={(e) => setDatos({ ...datos, documento: e.target.value })} />
              {cambioDatos && <button className="btn btn-success btn-sm" onClick={guardarDatos}>Guardar</button>}
            </div>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="table table-compacta">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th>{esAdmin && <th>Costo</th>}{esAdmin && <th>Proveedor</th>}<th>Total</th></tr></thead>
          <tbody>
            {venta.items.map((i, k) => (
              <tr key={k}>
                <td>{i.nombre}</td>
                <td className="mini">{i.cantidad} {i.unidad}</td>
                <td className="price-cell">{fmt(i.precio)}</td>
                {esAdmin && <td className="price-cell compra">{fmt(i.costo)}</td>}
                {esAdmin && <td className="mini">{i.proveedor || "—"}</td>}
                <td className="price-cell">{fmt(i.precio * i.cantidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Totales subtotal={venta.subtotal} iva={venta.iva} total={venta.total} />
      {esAdmin && r && (
        <div className="panel">
          <div className="panel-titulo">Utilidad de la venta</div>
          <div className="resumen-utilidad">
            <div><span className="stat-label">Margen bruto</span><strong>{fmt(r.margen)}</strong><span className="mini">{r.margen_pct}% del neto</span></div>
            <div><span className="stat-label">Gastos</span><strong>−{fmt(r.gastos)}</strong><span className="mini">{venta.gastos.length} registrados</span></div>
            <div><span className="stat-label">Utilidad</span><strong style={{ color: r.utilidad >= 0 ? "var(--success)" : "var(--danger)" }}>{fmt(r.utilidad)}</strong><span className="mini">con costo cotizado</span></div>
            {r.utilidad_real !== null && <div><span className="stat-label">Utilidad real</span><strong>{fmt(r.utilidad_real)}</strong><span className="mini">con lo comprado ({fmt(r.compras_real)})</span></div>}
          </div>
          {venta.gastos.length > 0 && (
            <table className="table table-compacta">
              <tbody>{venta.gastos.map((g) => (
                <tr key={g.id}><td className="mini">{fecha(g.fecha)}</td><td>{TIPOS_GASTO[g.tipo] || g.tipo}</td><td className="mini">{g.descripcion || ""}</td><td className="price-cell">{fmt(g.monto)}</td></tr>
              ))}</tbody>
            </table>
          )}
          <GastoRapido ventaId={venta.id} notify={notify} onCreado={onCambio} />
          {venta.ordenes.length > 0 && (
            <div className="mini">Órdenes de compra: {venta.ordenes.map((o) => (
              <button key={o.id} className="link" onClick={() => irACompra?.(o.id)}>{o.numero} {o.proveedor_nombre} ({o.estado})</button>
            ))}</div>
          )}
        </div>
      )}
      <PagosPanel
        key={venta.monto_pagado}
        doc={venta}
        tipo="cobro"
        onRegistrar={(body) => accion(() => api(`/ventas/${venta.id}/cobros`, { method: "POST", body }), "✓ Cobro registrado")}
        onEliminar={esAdmin ? (p) => confirm("¿Eliminar este cobro?") && accion(() => api(`/pagos/${p.id}`, { method: "DELETE" }), "Cobro eliminado") : null}
      />
      {cuadro && <CuadroCompra ventaId={venta.id} notify={notify} irACompra={irACompra} onClose={() => { setCuadro(false); onCambio(); }} />}
    </Modal>
  );
}

// Agregar un gasto (flete, combustible, comisión) asociado a la venta
function GastoRapido({ ventaId, notify, onCreado }) {
  const [form, setForm] = useState({ tipo: "flete", monto: "", descripcion: "" });
  const [enviando, setEnviando] = useState(false);
  const guardar = async () => {
    setEnviando(true);
    try {
      await api("/gastos", { method: "POST", body: { ...form, monto: Number(form.monto), venta_id: ventaId } });
      notify("✓ Gasto agregado");
      setForm({ tipo: "flete", monto: "", descripcion: "" });
      onCreado();
    } catch (e) { notify(e.message, "danger"); }
    finally { setEnviando(false); }
  };
  return (
    <div className="pago-form">
      <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
        {Object.entries(TIPOS_GASTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input type="number" placeholder="Monto" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
      <input placeholder="Detalle (opcional)" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
      <button className="btn btn-ghost btn-sm" disabled={enviando || !(Number(form.monto) > 0)} onClick={guardar}>+ Gasto</button>
    </div>
  );
}
