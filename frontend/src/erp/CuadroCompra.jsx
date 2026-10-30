import { useState, useEffect, useCallback } from "react";
import { Modal, Cargando, Estado } from "./ui";
import { api, fmt } from "./lib";

// Cuadro de compra de una venta confirmada: qué comprar, a qué proveedor, a qué precio
// y cuánto se gana por línea. Desde aquí se generan las órdenes de compra.
export default function CuadroCompra({ ventaId, notify, onClose, irACompra }) {
  const [data, setData] = useState(null);
  const [generando, setGenerando] = useState(false);

  const cargar = useCallback(async () => {
    try { setData(await api(`/ventas/${ventaId}/cuadro-compra`)); }
    catch (e) { notify(e.message, "danger"); onClose(); }
  }, [ventaId, notify, onClose]);
  useEffect(() => { cargar(); }, [cargar]);

  const usarAlternativa = async (linea, alt) => {
    if (!confirm(`¿Comprar "${linea.nombre}" a ${alt.proveedor} a ${fmt(alt.precio)}? Cambia el costo y el margen de la venta.`)) return;
    try {
      await api(`/ventas/${ventaId}/cambiar-proveedor`, { method: "POST", body: { indice: linea.indice, proveedor: alt.proveedor, costo: alt.precio } });
      notify(`✓ Línea asignada a ${alt.proveedor}`);
      cargar();
    } catch (e) { notify(e.message, "danger"); }
  };

  const generar = async (proveedores) => {
    setGenerando(true);
    try {
      const r = await api(`/ventas/${ventaId}/generar-ordenes`, { method: "POST", body: proveedores ? { proveedores } : {} });
      const msg = r.creadas.length ? `✓ ${r.creadas.length} orden(es) de compra creadas` : "No había órdenes por crear";
      notify(r.omitidos.length ? `${msg} · ${r.omitidos.join(" · ")}` : msg, r.creadas.length ? "success" : "danger");
      cargar();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGenerando(false); }
  };

  if (!data) return <Modal titulo="// Cuadro de compra" onClose={onClose} ancho={1100}><Cargando /></Modal>;
  const { venta, grupos, totales } = data;
  const pendientes = grupos.filter((g) => !g.orden && g.proveedor !== "SIN PROVEEDOR");
  const anulada = venta.estado === "anulada";

  const imprimir = () => window.print();

  return (
    <Modal titulo={`// Cuadro de compra · ${venta.numero} · ${venta.cliente_nombre || "Sin cliente"}`} onClose={onClose} ancho={1100}
      footer={<>
        <button className="btn btn-ghost" onClick={imprimir}>Imprimir</button>
        {!anulada && pendientes.length > 0 && (
          <button className="btn btn-primary" disabled={generando} onClick={() => generar()}>
            {generando ? "Generando..." : `Generar ${pendientes.length} orden(es) de compra`}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="cuadro-imprimible">
        {venta.orden_compra_cliente && <div className="mini">OC del cliente: <strong>{venta.orden_compra_cliente}</strong></div>}
        {grupos.map((g) => (
          <div key={g.proveedor} className="panel">
            <div className="panel-titulo">
              {g.proveedor}
              {g.contacto && <span className="mini" style={{ textTransform: "none", letterSpacing: 0 }}>{g.contacto}</span>}
              <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                {g.orden
                  ? <button className="btn btn-ghost btn-sm" onClick={() => irACompra?.(g.orden.id)}>{g.orden.numero} <Estado valor={g.orden.estado} /></button>
                  : g.proveedor === "SIN PROVEEDOR"
                    ? <span className="estado estado-warn">Asigna un proveedor</span>
                    : !anulada && <button className="btn btn-ghost btn-sm" disabled={generando} onClick={() => generar([g.proveedor])}>Crear orden</button>}
              </span>
            </div>
            <div className="table-wrap">
              <table className="table table-compacta">
                <thead><tr>
                  <th className="col-desc">Producto</th><th>Cant.</th><th>Compra unit.</th><th>Total compra</th><th>Venta unit.</th><th>Total venta</th>
                  <th>Margen $</th><th>Margen %</th><th>Alternativas</th>
                </tr></thead>
                <tbody>
                  {g.lineas.map((l) => {
                    const cambio = l.vigente && l.vigente.precio > 0 && Math.round(l.vigente.precio) !== Math.round(l.compra_unit);
                    const alts = [l.alternativa, l.alternativa3, l.vigente && l.vigente.proveedor !== g.proveedor && l.vigente.precio > 0 ? l.vigente : null]
                      .filter(Boolean).filter((a, i, arr) => a.proveedor !== g.proveedor && arr.findIndex((x) => x.proveedor === a.proveedor) === i);
                    return (
                      <tr key={l.indice} className={!(l.compra_unit > 0) ? "fila-alerta" : ""}>
                        <td>{l.nombre}<div className="mini">{l.codigo ? `N° ${l.codigo}` : ""}{cambio ? ` · hoy en catálogo: ${fmt(l.vigente.precio)} (${l.vigente.proveedor || "—"})` : ""}</div></td>
                        <td className="mini">{l.cantidad} {l.unidad}</td>
                        <td className="price-cell compra">{l.compra_unit > 0 ? fmt(l.compra_unit) : "sin precio"}</td>
                        <td className="price-cell compra">{fmt(l.total_compra)}</td>
                        <td className="price-cell">{fmt(l.venta_unit)}</td>
                        <td className="price-cell">{fmt(l.total_venta)}</td>
                        <td className="price-cell" style={{ color: l.margen < 0 ? "var(--danger)" : undefined }}>{fmt(l.margen)}</td>
                        <td className="mini">{l.margen_pct}%</td>
                        <td>
                          {alts.length === 0 ? <span className="mini">—</span> : alts.map((a) => (
                            <button key={a.proveedor} className="link" disabled={anulada || !!g.orden} title={g.orden ? "Ya hay orden para este proveedor" : "Comprar a este proveedor"}
                              onClick={() => usarAlternativa(l, a)}>
                              {a.proveedor} {fmt(a.precio)}
                            </button>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <td colSpan={3} className="mini">Total {g.proveedor}</td>
                  <td className="price-cell compra"><strong>{fmt(g.total_compra)}</strong></td>
                  <td></td>
                  <td className="price-cell">{fmt(g.total_venta)}</td>
                  <td className="price-cell">{fmt(g.margen)}</td>
                  <td className="mini">{g.total_venta ? Math.round((g.margen / g.total_venta) * 100) : 0}%</td>
                  <td></td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        ))}
        <div className="panel">
          <div className="resumen-utilidad">
            <div><span className="stat-label">Total a comprar</span><strong>{fmt(totales.compra)}</strong><span className="mini">neto</span></div>
            <div><span className="stat-label">Total venta</span><strong>{fmt(totales.venta)}</strong><span className="mini">neto</span></div>
            <div><span className="stat-label">Margen bruto</span><strong>{fmt(totales.margen)}</strong><span className="mini">{totales.margen_pct}%</span></div>
            <div><span className="stat-label">Gastos de la venta</span><strong>−{fmt(totales.gastos)}</strong><span className="mini">flete, combustible, comisión</span></div>
            <div><span className="stat-label">Utilidad final</span><strong style={{ color: totales.utilidad >= 0 ? "var(--success)" : "var(--danger)" }}>{fmt(totales.utilidad)}</strong><span className="mini">antes de gastos generales</span></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
