import { useState, useEffect, useCallback } from "react";
import { Modal, Estado, ItemsEditor, Totales, PagosPanel, Etapa, EstadoFactura, confirmar } from "./ui";
import { api, fmt, fecha, useProductos, precioSegun, TIPOS_GASTO } from "./lib";
import CuadroCompra from "./CuadroCompra";
import { AccionesVenta, PanelFacturas, conConfirmacion } from "./Recorrido";

// Períodos para filtrar (fechas en hora local de Chile)
const PERIODOS = [["todo", "Todas las fechas"], ["mes", "Este mes"], ["mes_pasado", "Mes pasado"], ["anio", "Este año"]];
const iso = (d) => d.toLocaleDateString("sv-SE");
function rangoPeriodo(p) {
  const hoy = new Date();
  if (p === "mes") return [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), iso(hoy)];
  if (p === "mes_pasado") return [iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0))];
  if (p === "anio") return [iso(new Date(hoy.getFullYear(), 0, 1)), iso(hoy)];
  return [null, null];
}

// Filtros por etapa del recorrido, según el departamento
const FILTROS_ETAPA = {
  comercial: [["", "Todas"], ["registrada,aceptada", "En proceso"], ["lista,despachada,entregada", "Listas o despachadas"], ["entregada", "Entregadas"]],
  operativo: [["registrada,aceptada", "Por ejecutar"], ["registrada", "Por aceptar"], ["aceptada", "En compra"], ["lista", "Productos listos"], ["", "Todas"]],
  finanzas: [["", "Todas"]],
};

// modo: comercial (registra ventas, sin costos) | operativo (ventas por ejecutar: aceptar, comprar, confirmar) | finanzas (cobros y márgenes)
export default function Ventas({ notify, esAdmin, puedeOperar, puedeVender, modo = "comercial", clientes, abrirVentaId, onAbierta, irACompra }) {
  const verCompras = puedeOperar && modo !== "comercial";
  const verCobros = esAdmin && modo === "finanzas";
  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroPago, setFiltroPago] = useState("");
  const [etapa, setEtapa] = useState(FILTROS_ETAPA[modo]?.[0]?.[0] ?? "");
  const [busqueda, setBusqueda] = useState("");
  const [periodo, setPeriodo] = useState("todo"); // todo | mes | mes_pasado | anio
  const [nueva, setNueva] = useState(false);
  const [detalle, setDetalle] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filtroPago) p.append("estado_pago", filtroPago);
      if (etapa) { p.append("etapa", etapa); p.append("estado", "emitida"); }
      if (busqueda) p.append("busqueda", busqueda);
      const [desde, hasta] = rangoPeriodo(periodo);
      if (desde) p.append("desde", desde);
      if (hasta) p.append("hasta", hasta);
      setVentas(await api(`/ventas?${p}`));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLoading(false); }
  }, [filtroPago, etapa, busqueda, periodo, notify]);

  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  const verDetalle = useCallback(async (id) => {
    try { setDetalle(await api(`/ventas/${id}`)); } catch (e) { notify(e.message, "danger"); }
  }, [notify]);

  // Permite abrir una venta desde otra vista (tareas de Inicio, Cotizaciones...)
  useEffect(() => {
    if (abrirVentaId) { verDetalle(abrirVentaId); onAbierta?.(); }
  }, [abrirVentaId, verDetalle, onAbierta]);

  const activas = ventas.filter((v) => v.estado !== "anulada");
  const porCobrar = activas.reduce((s, v) => s + Number(v.total) - Number(v.monto_pagado), 0);
  const cuenta = (...e) => activas.filter((v) => e.includes(v.etapa)).length;
  const filtros = FILTROS_ETAPA[modo] || FILTROS_ETAPA.comercial;

  return (
    <>
      <div className="stats">
        <div className="stat-card"><div className="stat-label">Ventas listadas</div><div className="stat-value">{activas.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total (con IVA)</div><div className="stat-value accent">{fmt(activas.reduce((s, v) => s + Number(v.total), 0))}</div></div>
        {esAdmin && modo === "finanzas"
          ? <div className="stat-card"><div className="stat-label">Margen neto</div><div className="stat-value accent">{fmt(activas.reduce((s, v) => s + Number(v.subtotal) - Number(v.costo_total), 0))}</div></div>
          : <div className="stat-card"><div className="stat-label">{modo === "operativo" ? "Por aceptar" : "En proceso (compra)"}</div><div className="stat-value">{modo === "operativo" ? cuenta("registrada") : cuenta("registrada", "aceptada")}</div></div>}
        {modo === "finanzas"
          ? <div className="stat-card"><div className="stat-label">Por cobrar</div><div className="stat-value" style={{ color: porCobrar > 0 ? "var(--danger)" : "var(--success)", fontSize: 16 }}>{fmt(porCobrar)}</div></div>
          : <div className="stat-card"><div className="stat-label">{modo === "operativo" ? "En compra" : "Sin factura (listas)"}</div><div className="stat-value">{modo === "operativo" ? cuenta("aceptada") : activas.filter((v) => ["lista", "despachada", "entregada"].includes(v.etapa) && v.estado_factura !== "facturada").length}</div></div>}
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por N°, ID, OC, cliente o factura..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        {filtros.length > 1 && (
          <div className="chips">
            {filtros.map(([v, t]) => <button key={t} className={`chip ${etapa === v ? "activo" : ""}`} onClick={() => setEtapa(v)}>{t}</button>)}
          </div>
        )}
        <select className="filter-select" value={periodo} onChange={(e) => setPeriodo(e.target.value)} title="Período de las ventas listadas">
          {PERIODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        {modo === "finanzas" && (
          <select className="filter-select" value={filtroPago} onChange={(e) => setFiltroPago(e.target.value)}>
            <option value="">Todas</option>
            <option value="pendiente">Pendientes de pago</option>
            <option value="parcial">Pago parcial</option>
            <option value="pagada">Pagadas</option>
          </select>
        )}
        {puedeVender && modo === "comercial" && <button className="btn btn-primary" onClick={() => setNueva(true)}>+ Nueva venta</button>}
      </div>
      {modo === "operativo" && <div className="mini" style={{ marginTop: -8, marginBottom: 10 }}>Abre una venta para aceptarla, ver qué comprar (Cuadro de compra) y, cuando llegue todo, confirmarla para que Comercial facture.</div>}

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>OC / ID</th><th>Etapa</th>{modo !== "operativo" && <th>Factura</th>}<th>Total</th>{modo === "finanzas" && <th>Saldo</th>}{modo === "finanzas" && <th>Vence</th>}{modo === "finanzas" && <th>Pago</th>}{modo === "operativo" && <th>Compras</th>}<th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={11}><span className="spinner"></span>Cargando...</td></tr>
              : ventas.length === 0 ? <tr className="empty-row"><td colSpan={11}>// sin ventas en este filtro</td></tr>
              : ventas.map((v) => {
                const saldo = Number(v.total) - Number(v.monto_pagado);
                const vencida = v.estado !== "anulada" && saldo > 0 && v.fecha_vencimiento && v.fecha_vencimiento < new Date().toLocaleDateString("sv-SE");
                return (
                  <tr key={v.id} className={v.estado === "anulada" ? "fila-anulada" : ""}>
                    <td className="id-cell">{v.numero}{v.empresa === "tactics" && <div><Estado valor="tactics" /></div>}</td>
                    <td className="mini">{fecha(v.fecha)}</td>
                    <td>{v.cliente_nombre || <span className="mini">Sin cliente</span>}</td>
                    <td className="mini">{v.orden_compra_cliente || "—"}{v.id_solicitud && <div className="id-solicitud">ID {v.id_solicitud}</div>}</td>
                    <td>{v.estado === "anulada" ? <Estado valor="anulada" /> : <Etapa valor={v.etapa} />}</td>
                    {modo !== "operativo" && <td className="mini"><EstadoFactura valor={v.estado_factura} />{v.documento && <div>{v.documento}</div>}</td>}
                    <td className="price-cell">{fmt(v.total)}</td>
                    {modo === "finanzas" && <td className="price-cell" style={{ color: saldo > 0.5 ? "var(--text)" : "var(--text3)" }}>{fmt(saldo)}</td>}
                    {modo === "finanzas" && <td className={`mini ${vencida ? "stock-low" : ""}`}>{fecha(v.fecha_vencimiento)}{vencida ? " ⚠" : ""}</td>}
                    {modo === "finanzas" && <td><Estado valor={v.estado === "anulada" ? "anulada" : v.estado_pago} /></td>}
                    {modo === "operativo" && <td className="mini">{!v.compras?.ordenes ? <span style={{ color: "var(--warn)" }}>por comprar</span> : `${v.compras.recibidas}/${v.compras.ordenes} recibidas`}</td>}
                    <td><button className="btn btn-ghost btn-sm" onClick={() => verDetalle(v.id)}>Ver</button></td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {nueva && <NuevaVenta clientes={clientes} notify={notify} onClose={() => setNueva(false)} onCreada={(v) => { setNueva(false); cargar(); verDetalle(v.id); }} />}
      {detalle && <DetalleVenta venta={detalle} modo={modo} esAdmin={esAdmin} verCompras={verCompras} verCobros={verCobros} puedeOperar={puedeOperar} puedeVender={puedeVender} notify={notify} irACompra={irACompra} onClose={() => setDetalle(null)} onCambio={() => { cargar(); verDetalle(detalle.id); }} />}
    </>
  );
}

function NuevaVenta({ clientes, notify, onClose, onCreada }) {
  const productos = useProductos();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ empresa: "kenott", cliente_id: "", cliente_nombre: "", id_solicitud: "", orden_compra_cliente: "", dias_credito: 30, pagada_al_contado: false, medio_pago: "efectivo", notas: "" });
  const cli = clientes.find((c) => String(c.id) === String(form.cliente_id));
  const tipo = cli?.tipo || "convenio";
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      const v = await conConfirmacion("/ventas", {
        ...form,
        cliente_id: form.cliente_id ? Number(form.cliente_id) : null,
        cliente_nombre: cli?.codigo === "P-001" ? form.cliente_nombre || null : null,
        dias_credito: form.pagada_al_contado ? 0 : Number(form.dias_credito),
        items: items.map((i) => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad), precio: Number(i.precio) })),
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
      <div className="chips">
        {[["kenott", "Inversiones Kenott"], ["tactics", "Tactics Inversiones"]].map(([v, t]) => (
          <button key={v} className={`chip ${form.empresa === v ? "activo" : ""}`} onClick={() => setForm({ ...form, empresa: v })}>{form.empresa === v ? "● " : ""}{t}</button>
        ))}
      </div>
      <div className="fields-row">
        <div className="field">
          <label>Cliente</label>
          <select value={form.cliente_id} onChange={(e) => {
            // El plazo de pago viene de la ficha del cliente
            const c = clientes.find((x) => String(x.id) === e.target.value);
            setForm({ ...form, cliente_id: e.target.value, dias_credito: c ? c.plazo_pago_dias ?? 30 : 30 });
          }}>
            <option value="">— Sin cliente —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ""}{c.nombre}</option>)}
          </select>
          {cli?.codigo === "P-001" && <input style={{ marginTop: 6 }} value={form.cliente_nombre} onChange={(e) => setForm({ ...form, cliente_nombre: e.target.value })} placeholder="Nombre del cliente para esta venta" />}
        </div>
        <div className="field">
          <label>ID del cliente o de la solicitud</label>
          <input value={form.id_solicitud} onChange={(e) => setForm({ ...form, id_solicitud: e.target.value })} placeholder={cli?.codigo && cli.codigo !== "P-001" ? `${cli.codigo} (del cliente)` : "Ej: 1422-20-COT26"} />
        </div>
      </div>
      <div className="fields-row">
        <div className="field">
          <label>N° orden de compra del cliente (si no hay OC, se identifica con el ID)</label>
          <input value={form.orden_compra_cliente} onChange={(e) => setForm({ ...form, orden_compra_cliente: e.target.value })} placeholder="Ej: 2401-55-SE26" />
        </div>
      </div>
      <div className="mini">Precio sugerido: <Estado valor={tipo} /> · lo puedes corregir por línea.</div>
      <ItemsEditor key={tipo} items={items} setItems={setItems} productos={productos} precioDe={(p) => precioSegun(p, tipo)} />
      <div className="mini">La factura no se pide ahora: Operativo acepta y compra, y cuando estén los productos se factura en Facturación.</div>
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
            <label>Plazo de pago (días){cli ? ` · ficha: ${cli.plazo_pago_dias ?? 30}${cli.base_vencimiento === "recepcion" ? " desde recepción" : ""}` : ""}</label>
            <input type="number" min="0" value={form.dias_credito} onChange={(e) => setForm({ ...form, dias_credito: e.target.value })} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function DetalleVenta({ venta, modo, esAdmin, verCompras, verCobros, puedeOperar, puedeVender, notify, onClose, onCambio, irACompra }) {
  const [cuadro, setCuadro] = useState(false);
  const editaDatos = puedeVender && modo === "comercial";
  const [datos, setDatos] = useState({ plazo_pago_dias: venta.plazo_pago_dias ?? "", base_vencimiento: venta.base_vencimiento || "factura", orden_compra_cliente: venta.orden_compra_cliente || "", id_solicitud: venta.id_solicitud || "" });
  const r = venta.resumen;

  const accion = async (fn, ok) => {
    try { await fn(); notify(ok); onCambio(); } catch (e) { notify(e.message, "danger"); }
  };
  const [anulando, setAnulando] = useState(false);
  const anular = () => setAnulando(true);
  const guardarDatos = () => {
    // El plazo solo se manda si cambió (recalcula el vencimiento)
    const { plazo_pago_dias, base_vencimiento, ...resto } = datos;
    const body = { ...resto };
    if (String(plazo_pago_dias) !== String(venta.plazo_pago_dias ?? "") && plazo_pago_dias !== "") body.plazo_pago_dias = Number(plazo_pago_dias);
    if (base_vencimiento !== (venta.base_vencimiento || "factura")) body.base_vencimiento = base_vencimiento;
    accion(() => api(`/ventas/${venta.id}/datos`, { method: "PUT", body }), "✓ Datos guardados");
  };
  const cambioDatos = String(datos.plazo_pago_dias) !== String(venta.plazo_pago_dias ?? "") || datos.base_vencimiento !== (venta.base_vencimiento || "factura") || datos.orden_compra_cliente !== (venta.orden_compra_cliente || "") || datos.id_solicitud !== (venta.id_solicitud || "");

  return (
    <Modal titulo={`// Venta ${venta.numero}`} onClose={onClose} ancho={780}
      footer={<>
        {esAdmin && venta.estado !== "anulada" && <button className="btn btn-danger" onClick={anular}>Anular venta</button>}
        {anulando && <AnularVenta venta={venta} notify={notify} onClose={() => setAnulando(false)} onHecho={() => { setAnulando(false); onCambio(); }} />}
        {verCompras && venta.estado !== "anulada" && <button className="btn btn-primary" onClick={() => setCuadro(true)}>Cuadro de compra</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      {venta.estado === "anulada" && venta.motivo_anulacion && <div className="aviso">Anulada{venta.anulada_por ? ` por ${venta.anulada_por}` : ""}{venta.anulada_fecha ? ` el ${fecha(venta.anulada_fecha)}` : ""}: {venta.motivo_anulacion}</div>}
      <div className="hist-meta">
        <span>{fecha(venta.fecha)}</span>
        <span>{venta.cliente_nombre || "Sin cliente"}</span>
        {venta.id_solicitud && <span className="id-solicitud">ID {venta.id_solicitud}</span>}
        {venta.plazo_pago_dias != null && <span>Plazo {Number(venta.plazo_pago_dias) === 0 ? "contado" : `${venta.plazo_pago_dias} días desde ${venta.base_vencimiento === "recepcion" ? "la recepción" : "la factura"}`}</span>}
        {venta.fecha_vencimiento && <span>Vence {fecha(venta.fecha_vencimiento)}</span>}
        {venta.creado_por && <span>Por {venta.creado_por}</span>}
        {venta.orden_compra_cliente && <span>OC {venta.orden_compra_cliente}</span>}
        <Estado valor={venta.empresa || "kenott"} /> {venta.estado === "anulada" && <Estado valor="anulada" />} {verCobros && <Estado valor={venta.estado_pago} />}
      </div>
      {venta.notas && <div className="mini">{venta.notas}</div>}
      <AccionesVenta venta={venta} puedeOperar={puedeOperar && modo !== "comercial"} puedeVender={puedeVender && modo !== "operativo"} esAdmin={esAdmin} notify={notify} onCambio={onCambio}
        abrirCuadro={verCompras ? () => setCuadro(true) : null} />
      {venta.estado !== "anulada" && editaDatos && (
        <div className="fields-row">
          <div className="field">
            <label>N° orden de compra del cliente</label>
            <input value={datos.orden_compra_cliente} onChange={(e) => setDatos({ ...datos, orden_compra_cliente: e.target.value })} />
          </div>
          <div className="field" style={{ maxWidth: 120 }}>
            <label>Plazo (días)</label>
            <input type="number" min="0" value={datos.plazo_pago_dias} onChange={(e) => setDatos({ ...datos, plazo_pago_dias: e.target.value })} />
          </div>
          <div className="field" style={{ maxWidth: 150 }}>
            <label>Desde</label>
            <select value={datos.base_vencimiento} onChange={(e) => setDatos({ ...datos, base_vencimiento: e.target.value })}>
              <option value="factura">la factura</option><option value="recepcion">la recepción</option>
            </select>
          </div>
          <div className="field">
            <label>ID del cliente o solicitud</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={datos.id_solicitud} onChange={(e) => setDatos({ ...datos, id_solicitud: e.target.value })} />
              {cambioDatos && <button className="btn btn-success btn-sm" onClick={guardarDatos}>Guardar</button>}
            </div>
          </div>
        </div>
      )}
      {(modo !== "operativo" || venta.facturas?.length > 0) && <PanelFacturas venta={venta} puedeVender={editaDatos || (puedeVender && modo === "finanzas" && esAdmin)} notify={notify} onCambio={onCambio} />}
      <div className="table-wrap">
        <table className="table table-compacta">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th>{verCompras && <th>Costo</th>}{verCompras && <th>Proveedor</th>}<th>Total</th></tr></thead>
          <tbody>
            {venta.items.map((i, k) => (
              <tr key={k}>
                <td>{i.nombre}</td>
                <td className="mini">{i.cantidad} {i.unidad}</td>
                <td className="price-cell">{fmt(i.precio)}</td>
                {verCompras && <td className="price-cell compra">{fmt(i.costo)}</td>}
                {verCompras && <td className="mini">{i.proveedor || "—"}</td>}
                <td className="price-cell">{fmt(i.precio * i.cantidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Totales subtotal={venta.subtotal} iva={venta.iva} total={venta.total} />
      {esAdmin && verCobros && r && (
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
      {verCompras && !verCobros && venta.ordenes?.length > 0 && (
        <div className="mini">Órdenes de compra: {venta.ordenes.map((o) => (
          <button key={o.id} className="link" onClick={() => irACompra?.(o.id)}>{o.numero} {o.proveedor_nombre} ({o.estado})</button>
        ))}</div>
      )}
      {verCobros && <PagosPanel
        key={venta.monto_pagado}
        doc={venta}
        tipo="cobro"
        onRegistrar={(body) => accion(() => api(`/ventas/${venta.id}/cobros`, { method: "POST", body }), "✓ Cobro registrado")}
        onEliminar={esAdmin ? async (p) => (await confirmar("¿Eliminar este cobro?", { titulo: "Eliminar cobro", boton: "Eliminar", peligro: true })) && accion(() => api(`/pagos/${p.id}`, { method: "DELETE" }), "Cobro eliminado") : null}
      />}
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

// Anular una venta: la misma ventana en Comercial y Operativo. Muestra lo que tiene la venta, qué impide anularla
// y qué pasará; el motivo es obligatorio y queda registrado con quién la anuló.
function AnularVenta({ venta, notify, onClose, onHecho }) {
  const [r, setR] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { api(`/ventas/${venta.id}/anulacion`).then(setR).catch((e) => { notify(e.message, "danger"); onClose(); }); }, [venta.id, notify, onClose]);
  const confirmar = async () => {
    setEnviando(true);
    try {
      await api(`/ventas/${venta.id}/anular`, { method: "POST", body: { motivo } });
      notify(`Venta ${venta.numero} anulada`);
      onHecho();
    } catch (e) { notify(e.message, "danger"); }
    finally { setEnviando(false); }
  };
  return (
    <Modal titulo={`// Anular la venta ${venta.numero}`} onClose={onClose} ancho={620}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-danger" disabled={!r?.puede || !motivo.trim() || enviando} onClick={confirmar}>{enviando ? "Anulando..." : "Anular venta"}</button>
      </>}>
      {!r ? <div className="cot-empty"><span className="spinner"></span>Revisando la venta...</div> : <>
        <div className="mini" style={{ marginBottom: 8 }}>{venta.cliente_nombre || "Sin cliente"} · {fmt(venta.total)} con IVA{venta.orden_compra_cliente ? ` · OC ${venta.orden_compra_cliente}` : ""}</div>
        {r.bloqueos.length > 0 ? (
          <div className="aviso" style={{ color: "var(--danger)", borderColor: "rgba(184,56,44,.35)", background: "rgba(184,56,44,.06)" }}>
            <strong>Todavía no se puede anular:</strong>
            <ul style={{ margin: "6px 0 0 18px" }}>{r.bloqueos.map((b) => <li key={b.que} style={{ marginBottom: 4 }}>{b.que}<div className="mini">→ {b.donde}</div></li>)}</ul>
          </div>
        ) : <div className="aviso" style={{ color: "var(--success)", borderColor: "rgba(42,127,80,.35)", background: "rgba(42,127,80,.06)" }}>Se puede anular: no tiene facturas, cobros ni compras recibidas.</div>}
        <div className="panel-titulo" style={{ marginTop: 10 }}>Qué pasará</div>
        <ul style={{ margin: "0 0 10px 18px", fontSize: 13 }}>
          {r.compras_pedidas.length > 0 && <li>Se anulan {r.compras_pedidas.length} compra(s) pedida(s) sin recibir: {r.compras_pedidas.map((o) => `${o.numero} (${o.proveedor})`).join(", ")}. Avisa al proveedor.</li>}
          <li>La cotización vuelve a <strong>Enviadas</strong> como abierta.</li>
          <li>Operativo deja de verla en sus tareas.</li>
          <li>Queda registrado quién la anuló, cuándo y por qué.</li>
        </ul>
        <div className="field">
          <label>Motivo (obligatorio)</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: el cliente anuló la OC / error al registrar" disabled={!r.puede} />
        </div>
      </>}
    </Modal>
  );
}
