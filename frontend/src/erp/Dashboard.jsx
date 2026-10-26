import { useState, useEffect, useCallback } from "react";
import { Estado, Cargando } from "./ui";
import { api, fmt, fecha } from "./lib";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (m) => { const [y, mm] = m.split("-"); return `${MESES[Number(mm) - 1]} ${y.slice(2)}`; };
const compacto = (n) => {
  const v = Math.abs(n);
  if (v >= 1e6) return `$${(n / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
};

export default function Dashboard({ notify, irA }) {
  const [data, setData] = useState(null);
  const [meses, setMeses] = useState(6);

  const cargar = useCallback(async () => {
    try { setData(await api(`/dashboard?meses=${meses}`)); }
    catch (e) { notify(e.message, "danger"); }
  }, [meses, notify]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!data) return <Cargando />;
  const { mes_actual: m, cuentas_por_cobrar: cxc, cuentas_por_pagar: cxp, caja, inventario, cotizaciones } = data;

  return (
    <>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="dash-titulo">Resumen · {nombreMes(m.mes)}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <select className="filter-select" value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
            {[3, 6, 12].map((n) => <option key={n} value={n}>Últimos {n} meses</option>)}
          </select>
          <button className="btn btn-ghost" onClick={cargar}>↻</button>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Ventas del mes (neto)" valor={fmt(m.ventas)} sub={`${m.cantidad} ventas · ticket ${fmt(m.ticket_promedio)}`} acento />
        <Kpi label="Margen del mes" valor={fmt(m.margen)} sub={`${m.margen_pct}% sobre ventas`} />
        <Kpi label="Por cobrar" valor={fmt(cxc.total)} sub={cxc.vencido > 0 ? `⚠ ${fmt(cxc.vencido)} vencido` : `${cxc.documentos} ventas pendientes`} alerta={cxc.vencido > 0} onClick={() => irA("ventas")} />
        <Kpi label="Por pagar" valor={fmt(cxp.total)} sub={cxp.vencido > 0 ? `⚠ ${fmt(cxp.vencido)} vencido` : `${cxp.documentos} órdenes`} alerta={cxp.vencido > 0} onClick={() => irA("compras")} />
        <Kpi label="Caja del mes" valor={fmt(caja.neto)} sub={`+${fmt(caja.cobros)} / −${fmt(caja.pagos)}`} />
        <Kpi label="Inventario (a costo)" valor={fmt(inventario.valor_costo)} sub={`${inventario.productos} productos · a venta ${fmt(inventario.valor_venta)}`} />
      </div>

      <div className="panel">
        <div className="panel-titulo">Ventas vs. compras por mes (neto, sin IVA)</div>
        <GraficoMeses serie={data.serie} />
      </div>

      <div className="dash-grid">
        <div className="panel">
          <div className="panel-titulo">
            Stock crítico <span className="mini">({inventario.criticos} bajo el mínimo)</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => irA("compras")}>Crear orden de compra →</button>
          </div>
          {data.stock_critico.length === 0 ? <div className="mini">✓ Todo el stock sobre el mínimo</div> : (
            <table className="table table-compacta">
              <thead><tr><th>Producto</th><th>Stock</th><th>Mín.</th><th>Proveedor</th></tr></thead>
              <tbody>
                {data.stock_critico.map((p) => (
                  <tr key={p.id}>
                    <td>{p.nombre}</td>
                    <td className="stock-cell stock-low">{p.stock}</td>
                    <td className="mini">{p.stock_minimo}</td>
                    <td className="mini">{p.proveedor || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <div className="panel-titulo">Cuentas por cobrar</div>
          {cxc.detalle.length === 0 ? <div className="mini">✓ Nada pendiente de cobro</div> : (
            <table className="table table-compacta">
              <thead><tr><th>Venta</th><th>Cliente</th><th>Vence</th><th>Saldo</th></tr></thead>
              <tbody>
                {cxc.detalle.map((v) => (
                  <tr key={v.id}>
                    <td className="id-cell">{v.numero}</td>
                    <td>{v.nombre || "—"}</td>
                    <td className={`mini ${v.vencida ? "stock-low" : ""}`}>{fecha(v.vence)}{v.vencida ? " ⚠" : ""}</td>
                    <td className="price-cell">{fmt(v.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <div className="panel-titulo">Productos más vendidos <span className="mini">(período)</span></div>
          {data.top_productos.length === 0 ? <div className="mini">Aún no hay ventas en el período</div> : (
            <table className="table table-compacta">
              <thead><tr><th>Producto</th><th>Cant.</th><th>Venta</th><th>Margen</th></tr></thead>
              <tbody>
                {data.top_productos.map((p) => (
                  <tr key={p.producto_id}>
                    <td>{p.nombre}</td>
                    <td className="mini">{p.cantidad}</td>
                    <td className="price-cell">{fmt(p.venta)}</td>
                    <td className="price-cell compra">{fmt(p.margen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <div className="panel-titulo">Cotizaciones <span className="mini">(período)</span></div>
          <div className="cot-kpis">
            <div><div className="stat-label">Emitidas</div><div className="stat-value">{cotizaciones.total}</div></div>
            <div><div className="stat-label">Convertidas</div><div className="stat-value">{cotizaciones.conversion}%</div></div>
            <div><div className="stat-label">Pendientes</div><div className="stat-value accent">{fmt(cotizaciones.monto_pendiente)}</div></div>
          </div>
          <div className="panel-titulo" style={{ marginTop: 14 }}>Últimas ventas</div>
          {data.ultimas_ventas.length === 0 ? <div className="mini">Sin ventas</div> : (
            <table className="table table-compacta">
              <tbody>
                {data.ultimas_ventas.map((v) => (
                  <tr key={v.id}>
                    <td className="id-cell">{v.numero}</td>
                    <td>{v.cliente || "—"}</td>
                    <td className="price-cell">{fmt(v.total)}</td>
                    <td><Estado valor={v.estado_pago} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, valor, sub, acento, alerta, onClick }) {
  return (
    <div className={`stat-card ${onClick ? "clickable" : ""}`} onClick={onClick}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${acento ? "accent" : ""}`} style={{ fontSize: 18 }}>{valor}</div>
      {sub && <div className={`mini ${alerta ? "stock-low" : ""}`} style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Barras agrupadas: ventas (azul) y compras (naranja), un solo eje en CLP.
function GraficoMeses({ serie }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...serie.flatMap((s) => [s.ventas, s.compras]));
  const sinDatos = serie.every((s) => !s.ventas && !s.compras);

  return (
    <div className="grafico">
      <div className="leyenda">
        <span><i style={{ background: "var(--serie-1)" }} />Ventas</span>
        <span><i style={{ background: "var(--serie-2)" }} />Compras recibidas</span>
      </div>
      <div className="grafico-area">
        <div className="grafico-eje">
          {[[1, max], [0.5, max / 2], [0, 0]].map(([f, v]) => (
            <span key={f} style={{ bottom: `calc(22px + (100% - 22px) * ${f})` }}>{compacto(v)}</span>
          ))}
        </div>
        <div className="grafico-barras">
          <div className="grid-capa">
            {[0, 50, 100].map((p) => <div key={p} className={`grid-line ${p === 0 ? "base" : ""}`} style={{ bottom: `${p}%` }} />)}
          </div>
          {serie.map((s, i) => (
            <div key={s.mes} className="grupo" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)}>
              <div className="barras-par">
                <div className="barra" style={{ height: `${(s.ventas / max) * 100}%`, background: "var(--serie-1)" }} />
                <div className="barra" style={{ height: `${(s.compras / max) * 100}%`, background: "var(--serie-2)" }} />
              </div>
              <div className="grupo-label">{nombreMes(s.mes)}</div>
              {hover === i && (
                <div className={`tooltip ${i > serie.length / 2 ? "izq" : ""}`}>
                  <strong>{nombreMes(s.mes)}</strong>
                  <div><i style={{ background: "var(--serie-1)" }} />Ventas {fmt(s.ventas)}</div>
                  <div><i style={{ background: "var(--serie-2)" }} />Compras {fmt(s.compras)}</div>
                  <div className="mini">Margen {fmt(s.margen)} · {s.cantidad} ventas</div>
                </div>
              )}
            </div>
          ))}
          {sinDatos && <div className="grafico-vacio">Sin movimientos en el período</div>}
        </div>
      </div>
    </div>
  );
}
