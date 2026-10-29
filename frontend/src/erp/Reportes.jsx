import { useState, useEffect, useCallback } from "react";
import { Cargando } from "./ui";
import { api, fmt, hoyISO } from "./lib";

// Utilidad por cliente y por proveedor, ahorro frente a la opción 2 y precio cotizado vs. pagado
export default function Reportes({ notify }) {
  const [desde, setDesde] = useState(`${hoyISO().slice(0, 4)}-01-01`);
  const [hasta, setHasta] = useState(hoyISO());
  const [data, setData] = useState(null);

  const cargar = useCallback(async () => {
    setData(null);
    try { setData(await api(`/dashboard/reportes?desde=${desde}&hasta=${hasta}`)); }
    catch (e) { notify(e.message, "danger"); }
  }, [desde, hasta, notify]);
  useEffect(() => { cargar(); }, [cargar]);

  const t = data?.totales;
  return (
    <>
      <div className="toolbar">
        <div className="field"><label>Desde</label><input className="filter-select" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="field"><label>Hasta</label><input className="filter-select" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
      </div>
      {!data ? <Cargando /> : <>
        <div className="kpis">
          <div className="stat-card"><div className="stat-label">Ventas (neto)</div><div className="stat-value accent" style={{ fontSize: 18 }}>{fmt(t.neto)}</div><div className="mini">{t.ventas} ventas</div></div>
          <div className="stat-card"><div className="stat-label">Margen bruto</div><div className="stat-value" style={{ fontSize: 18 }}>{fmt(t.margen)}</div><div className="mini">{t.neto ? Math.round((t.margen / t.neto) * 100) : 0}% del neto</div></div>
          <div className="stat-card"><div className="stat-label">Gastos de ventas</div><div className="stat-value" style={{ fontSize: 18 }}>{fmt(t.gastos_ventas)}</div></div>
          <div className="stat-card"><div className="stat-label">Gastos generales</div><div className="stat-value" style={{ fontSize: 18 }}>{fmt(t.gastos_generales)}</div></div>
          <div className="stat-card"><div className="stat-label">Utilidad</div><div className="stat-value" style={{ fontSize: 18, color: t.margen - t.gastos_ventas - t.gastos_generales >= 0 ? "var(--success)" : "var(--danger)" }}>{fmt(t.margen - t.gastos_ventas - t.gastos_generales)}</div><div className="mini">margen − todos los gastos</div></div>
        </div>
        <div className="dash-grid">
          <div className="panel">
            <div className="panel-titulo">Utilidad por cliente</div>
            {data.por_cliente.length === 0 ? <div className="mini">Sin ventas en el período</div> : (
              <table className="table table-compacta">
                <thead><tr><th>Cliente</th><th>Ventas</th><th>Neto</th><th>Margen</th><th>Gastos</th><th>Utilidad</th></tr></thead>
                <tbody>{data.por_cliente.map((c) => (
                  <tr key={c.cliente}><td>{c.cliente}</td><td className="mini">{c.ventas}</td><td className="price-cell">{fmt(c.neto)}</td><td className="price-cell">{fmt(c.margen)}</td><td className="price-cell compra">{fmt(c.gastos)}</td><td className="price-cell">{fmt(c.utilidad)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div className="panel">
            <div className="panel-titulo">Compras por proveedor</div>
            {data.por_proveedor.length === 0 ? <div className="mini">Sin ventas en el período</div> : (
              <table className="table table-compacta">
                <thead><tr><th>Proveedor</th><th>Compra</th><th>Venta</th><th>Margen</th><th title="Lo que se ahorró por comprarle a este proveedor y no a la opción 2 de cada producto">Ahorro vs. opción 2</th></tr></thead>
                <tbody>{data.por_proveedor.map((p) => (
                  <tr key={p.proveedor}><td>{p.proveedor}</td><td className="price-cell compra">{fmt(p.compra)}</td><td className="price-cell">{fmt(p.venta)}</td><td className="price-cell">{fmt(p.margen)}</td><td className="price-cell">{fmt(p.ahorro_vs_opcion2)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-titulo">Precio cotizado vs. pagado real <span className="mini">(órdenes de compra recibidas: sirve para detectar precios desactualizados)</span></div>
          {data.diferencias.length === 0 ? <div className="mini">Sin diferencias en el período</div> : (
            <table className="table table-compacta">
              <thead><tr><th>Venta</th><th>Orden</th><th>Proveedor</th><th>Producto</th><th>Cant.</th><th>Cotizado</th><th>Pagado</th><th>Diferencia</th></tr></thead>
              <tbody>{data.diferencias.map((d, i) => (
                <tr key={i}><td className="id-cell">{d.venta}</td><td className="id-cell">{d.orden}</td><td className="mini">{d.proveedor}</td><td>{d.producto}</td><td className="mini">{d.cantidad}</td><td className="price-cell compra">{fmt(d.cotizado)}</td><td className="price-cell compra">{fmt(d.pagado)}</td><td className="price-cell" style={{ color: d.diferencia > 0 ? "var(--danger)" : "var(--success)" }}>{d.diferencia > 0 ? "+" : ""}{fmt(d.diferencia)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </>}
    </>
  );
}
