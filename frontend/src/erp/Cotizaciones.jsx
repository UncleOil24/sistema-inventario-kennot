import { useState, useEffect, useCallback } from "react";
import { Modal, Estado, Totales } from "./ui";
import { api, fmt, fecha, descargar, cargarProductos } from "./lib";

const FILTROS = [
  ["", "Todas"], ["cotizacion", "Abiertas"], ["borrador", "Borradores"],
  ["aceptada", "Aceptadas"], ["rechazada", "Rechazadas"], ["vencida", "Vencidas"],
];

export default function Cotizaciones({ esAdmin, notify, onEditar, onVenta, verVenta }) {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [abierta, setAbierta] = useState(null);
  const [aceptar, setAceptar] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (estado) p.append("estado", estado);
      if (busqueda) p.append("busqueda", busqueda);
      setLista(await api(`/cotizaciones?${p}`));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLoading(false); }
  }, [estado, busqueda, notify]);
  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  const accion = async (fn, ok) => { try { await fn(); notify(ok); cargar(); } catch (e) { notify(e.message, "danger"); } };
  const excel = (c) => descargar(`/cotizaciones/${c.id}/excel`, `COT-${c.numero}-${c.cliente || "cliente"}.xlsx`).catch((e) => notify(e.message, "danger"));
  const pdf = (c) => descargar(`/cotizaciones/${c.id}/pdf`, `COT-${c.numero}-${c.cliente || "cliente"}.pdf`).catch((e) => notify(e.message, "danger"));
  const rechazar = (c) => {
    const motivo = prompt(`¿Por qué se rechazó la N° ${c.numero}? (precio, plazo, se compró a otro...)`, "");
    if (motivo !== null) accion(() => api(`/cotizaciones/${c.id}/estado`, { method: "POST", body: { estado: "rechazada", motivo } }), "Cotización marcada como rechazada");
  };
  const reabrir = (c) => accion(() => api(`/cotizaciones/${c.id}/estado`, { method: "POST", body: { estado: "cotizacion" } }), "Cotización reabierta");
  const emitir = (c) => accion(() => api(`/cotizaciones/${c.id}/estado`, { method: "POST", body: { estado: "cotizacion" } }), "Cotización emitida");
  const vencer = (c) => accion(() => api(`/cotizaciones/${c.id}/estado`, { method: "POST", body: { estado: "vencida" } }), "Cotización marcada como vencida");
  const eliminar = (c) => confirm(`¿Eliminar la cotización N° ${c.numero}? Es mejor marcarla rechazada o vencida para no perder el historial.`)
    && accion(() => api(`/cotizaciones/${c.id}`, { method: "DELETE" }), "Cotización eliminada");

  // Carga la cotización en el cotizador (conserva precios cotizados)
  const editar = async (c) => {
    try {
      const productos = await cargarProductos();
      const mapa = new Map(productos.map((p) => [p.id, p]));
      const items = c.items.map((i) => {
        const p = mapa.get(i.producto_id) || {};
        return {
          producto_id: i.producto_id, codigo: i.codigo ?? p.codigo, nombre: i.nombre, unidad: i.unidad,
          cantidad: i.cantidad, precio: i.precio, auto: false,
          convenio: Number(p.precio_convenio) || 0, particular: Number(p.precio_particular) || 0,
          costo: i.costo, proveedor: i.proveedor, descripcion_cliente: i.descripcion_cliente,
        };
      });
      onEditar({
        id: c.id, numero: c.numero, cliente_id: c.cliente_id || "", tipo_precio: c.tipo_precio,
        nombre_cotizacion: c.nombre_cotizacion || "", validez_dias: c.validez_dias || 30, notas: c.notas || "", archivo_cliente: c.archivo_cliente || "", items,
      });
    } catch (e) { notify(e.message, "danger"); }
  };

  const abiertas = lista.filter((c) => c.estado === "cotizacion");

  return (
    <>
      <div className="stats">
        <div className="stat-card"><div className="stat-label">Listadas</div><div className="stat-value">{lista.length}</div></div>
        <div className="stat-card"><div className="stat-label">Abiertas</div><div className="stat-value">{abiertas.length}</div></div>
        <div className="stat-card"><div className="stat-label">Monto abierto (neto)</div><div className="stat-value accent">{fmt(abiertas.reduce((s, c) => s + Number(c.subtotal), 0))}</div></div>
        <div className="stat-card"><div className="stat-label">Aceptadas (neto)</div><div className="stat-value accent">{fmt(lista.filter((c) => c.estado === "aceptada").reduce((s, c) => s + Number(c.subtotal), 0))}</div></div>
      </div>
      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por N°, cliente o nombre..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="chips">
          {FILTROS.map(([v, t]) => <button key={v} className={`chip ${estado === v ? "activo" : ""}`} onClick={() => setEstado(v)}>{t}</button>)}
        </div>
      </div>

      {loading ? <div className="cot-empty"><span className="spinner"></span>Cargando...</div>
        : lista.length === 0 ? <div className="cot-empty">// sin cotizaciones</div>
        : (
          <div className="hist-list">
            {lista.map((c) => (
              <div key={c.id} className="hist-card">
                <div className="hist-info">
                  <div className="hist-nombre">N° {c.numero} · {c.nombre_cotizacion || "Sin nombre"}</div>
                  <div className="hist-meta">
                    <span>{c.cliente || "Sin cliente"}</span>
                    <span>{fecha(c.fecha || c.createdAt)}</span>
                    {c.estado === "cotizacion" && c.fecha_validez && <span>válida hasta {fecha(c.fecha_validez)}</span>}
                    <span>{c.items?.length || 0} productos</span>
                    <Estado valor={c.tipo_precio} />
                    <Estado valor={c.estado} />
                    {c.motivo_estado && c.estado !== "cotizacion" && <span>{c.motivo_estado}</span>}
                    {esAdmin && c.margen !== undefined && <span>margen {fmt(c.margen)} ({c.margen_pct}%)</span>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                  <div className="hist-total">{fmt(c.total)}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setAbierta(c)}>Ver</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => pdf(c)}>↓ PDF</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => excel(c)}>↓ Excel</button>
                    {["borrador", "cotizacion"].includes(c.estado) && <button className="btn btn-ghost btn-sm" onClick={() => editar(c)}>Editar</button>}
                    {c.estado === "borrador" && <button className="btn btn-ghost btn-sm" onClick={() => emitir(c)}>Emitir</button>}
                    {c.estado === "cotizacion" && <>
                      <button className="btn btn-success btn-sm" onClick={() => setAceptar(c)}>✓ Aceptada → Venta</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => rechazar(c)}>Rechazada</button>
                    </>}
                    {["rechazada", "vencida"].includes(c.estado) && <button className="btn btn-ghost btn-sm" onClick={() => reabrir(c)}>Reabrir</button>}
                    {c.estado === "aceptada" && c.venta_id && <button className="btn btn-ghost btn-sm" onClick={() => verVenta(c.venta_id)}>Ver venta</button>}
                    {esAdmin && c.estado !== "aceptada" && <button className="btn btn-danger btn-sm" onClick={() => eliminar(c)}>✕</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      {abierta && <DetalleCotizacion cot={abierta} esAdmin={esAdmin} onClose={() => setAbierta(null)} onVencer={() => { vencer(abierta); setAbierta(null); }} />}
      {aceptar && <AceptarCotizacion cot={aceptar} notify={notify} onClose={() => setAceptar(null)}
        onHecho={(venta) => { setAceptar(null); cargar(); onVenta(venta); }} />}
    </>
  );
}

function DetalleCotizacion({ cot, esAdmin, onClose, onVencer }) {
  return (
    <Modal titulo={`// Cotización N° ${cot.numero}`} onClose={onClose} ancho={820}
      footer={<>
        {cot.estado === "cotizacion" && <button className="btn btn-ghost" onClick={onVencer}>Marcar vencida</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="hist-meta">
        <span>{cot.cliente || "Sin cliente"}</span><span>{fecha(cot.fecha || cot.createdAt)}</span>
        <span>Validez {cot.validez_dias} días{cot.fecha_validez ? ` (hasta ${fecha(cot.fecha_validez)})` : ""}</span>
        {cot.creado_por && <span>Por {cot.creado_por}</span>}
        {cot.archivo_cliente && <span>Lista del cliente: {cot.archivo_cliente}</span>}
        <Estado valor={cot.tipo_precio} /><Estado valor={cot.estado} />
      </div>
      <div className="table-wrap">
        <table className="table table-compacta">
          <thead><tr><th>N°</th><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th>{esAdmin && <th>Costo</th>}{esAdmin && <th>Proveedor</th>}{esAdmin && <th>Margen</th>}</tr></thead>
          <tbody>
            {cot.items.map((i, k) => {
              const m = (Number(i.precio) - Number(i.costo || 0)) * Number(i.cantidad);
              return (
                <tr key={k} className={!(Number(i.precio) > 0) ? "fila-alerta" : ""}>
                  <td className="id-cell">{i.codigo ?? ""}</td>
                  <td>{i.nombre}{i.descripcion_cliente && <div className="mini">Cliente: {i.descripcion_cliente}</div>}</td>
                  <td className="mini">{i.cantidad} {i.unidad}</td>
                  <td className="price-cell">{fmt(i.precio)}</td>
                  <td className="price-cell">{fmt(i.precio * i.cantidad)}</td>
                  {esAdmin && <td className="price-cell compra">{i.costo !== undefined ? fmt(i.costo) : "—"}</td>}
                  {esAdmin && <td className="mini">{i.proveedor || "—"}</td>}
                  {esAdmin && <td className="mini">{i.costo !== undefined ? fmt(m) : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Totales subtotal={cot.subtotal} iva={cot.iva} total={cot.total} />
      {esAdmin && <div className="mini">Margen interno (no se imprime): <strong style={{ color: "var(--text)" }}>{fmt(cot.margen)}</strong> ({cot.margen_pct}% sobre el neto)</div>}
    </Modal>
  );
}

function AceptarCotizacion({ cot, notify, onClose, onHecho }) {
  const [form, setForm] = useState({ orden_compra_cliente: "", dias_credito: 30, pagada_al_contado: false, medio_pago: "transferencia" });
  const [enviando, setEnviando] = useState(false);
  const confirmar = async () => {
    setEnviando(true);
    try {
      const venta = await api(`/ventas/desde-cotizacion/${cot.id}`, {
        method: "POST",
        body: {
          orden_compra_cliente: form.orden_compra_cliente || null,
          ...(form.pagada_al_contado ? { pagada_al_contado: true, medio_pago: form.medio_pago } : { dias_credito: Number(form.dias_credito) || 0 }),
        },
      });
      notify(`✓ Venta ${venta.numero} creada — revisa el cuadro de compra`);
      onHecho(venta);
    } catch (e) { notify(e.message, "danger"); }
    finally { setEnviando(false); }
  };
  return (
    <Modal titulo={`// Cliente aceptó la N° ${cot.numero}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-success" disabled={enviando} onClick={confirmar}>{enviando ? "Creando..." : "Confirmar venta"}</button>
      </>}>
      <div className="mini">{cot.cliente || "Sin cliente"} · {fmt(cot.total)} con IVA. La venta copia los mismos precios y costos de la cotización.</div>
      <div className="field">
        <label>N° orden de compra del cliente</label>
        <input value={form.orden_compra_cliente} onChange={(e) => setForm({ ...form, orden_compra_cliente: e.target.value })} placeholder="Ej: 2401-55-SE26 (Mercado Público)" />
      </div>
      <label className="check">
        <input type="checkbox" checked={form.pagada_al_contado} onChange={(e) => setForm({ ...form, pagada_al_contado: e.target.checked })} />
        Pagada al contado
      </label>
      {form.pagada_al_contado ? (
        <div className="field"><label>Medio de pago</label>
          <select value={form.medio_pago} onChange={(e) => setForm({ ...form, medio_pago: e.target.value })}>
            {["transferencia", "efectivo", "tarjeta", "cheque"].map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
      ) : (
        <div className="field"><label>Días de crédito (plazo de pago)</label>
          <input type="number" min="0" value={form.dias_credito} onChange={(e) => setForm({ ...form, dias_credito: e.target.value })} />
        </div>
      )}
    </Modal>
  );
}
