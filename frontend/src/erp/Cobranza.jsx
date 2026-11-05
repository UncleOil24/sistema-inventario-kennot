// Finanzas y Control · Cobranza (fase 1): quién debe, cuánto y desde cuándo, por empresa y consolidado.
import { useState, useEffect, useCallback } from "react";
import { api, fmt, fecha } from "./lib";
import { Estado } from "./ui";

const COLOR_TRAMO = { por_vencer: "estado-ok", temprana: "estado-warn", critica: "estado-warn tramo-critico", incobrable: "estado-muted", sin_vencimiento: "estado-neutral" };
const TEXTO_TRAMO = { por_vencer: "Al día", temprana: "1-30 días", critica: "31-90 días", incobrable: "+90 días", sin_vencimiento: "Sin vencimiento" };
const Tramo = ({ t }) => <span className={`estado ${COLOR_TRAMO[t] || ""}`}>{TEXTO_TRAMO[t] || t}</span>;

export default function Cobranza({ notify, verVenta, irA }) {
  const [empresa, setEmpresa] = useState("");
  const [d, setD] = useState(null);
  const [vista, setVista] = useState("clientes");
  const cargar = useCallback(async () => {
    try {
      const r = await api(`/finanzas/cobranza${empresa ? `?empresa=${empresa}` : ""}`);
      setD(r);
      if (r.suspendidos_ahora) notify(`${r.suspendidos_ahora} cliente(s) quedaron con el crédito suspendido por morosidad crítica`, "danger");
    } catch (e) { notify(e.message, "danger"); }
  }, [empresa, notify]);
  useEffect(() => { cargar(); }, [cargar]);
  if (!d) return <div className="cot-empty"><span className="spinner"></span>Cargando...</div>;

  const r = d.resumen[empresa || "ambas"];
  const total = r.por_cobrar || 1;
  const barras = [["por_vencer", "var(--success)"], ["temprana", "var(--warn)"], ["critica", "var(--danger)"], ["incobrable", "var(--text3)"], ["sin_vencimiento", "var(--border2)"]];

  return (
    <>
      <div className="toolbar">
        <div className="chips">
          {[["", "Ambas empresas"], ["kenott", "Kenott"], ["tactics", "Tactics"]].map(([v, t]) => <button key={t} className={`chip ${empresa === v ? "activo" : ""}`} onClick={() => setEmpresa(v)}>{t}</button>)}
        </div>
        <span className="mini">Los días se cuentan desde el vencimiento (factura o recepción conforme + plazo del cliente).</span>
      </div>

      <div className="stats">
        <div className="stat-card"><div className="stat-label">Por cobrar</div><div className="stat-value accent">{fmt(r.por_cobrar)}</div><div className="mini">{r.documentos} venta(s)</div></div>
        <div className="stat-card"><div className="stat-label">Vencido</div><div className="stat-value" style={{ color: r.vencido > 0 ? "var(--danger)" : "var(--success)" }}>{fmt(r.vencido)}</div><div className="mini">{r.por_cobrar ? Math.round((r.vencido / r.por_cobrar) * 100) : 0}% de lo por cobrar</div></div>
        <div className="stat-card"><div className="stat-label">Días de cobro (DSO)</div>
          <div className="stat-value" style={{ color: r.dso == null ? undefined : r.dso <= 30 ? "var(--success)" : r.dso <= 45 ? "var(--warn)" : "var(--danger)" }}>{r.dso == null ? "—" : `${r.dso} d`}</div>
          <div className="mini">verde hasta 30 · amarillo hasta 45</div></div>
        <div className="stat-card"><div className="stat-label">IVA de {d.iva.periodo}</div>
          <div className="stat-value" style={{ color: d.iva.dias <= 1 ? "var(--danger)" : d.iva.dias <= 5 ? "var(--warn)" : undefined }}>{d.iva.dias === 0 ? "hoy" : `${d.iva.dias} d`}</div>
          <div className="mini">vence {fecha(d.iva.fecha)} · cada empresa por separado</div></div>
      </div>

      <div className="panel">
        <div className="panel-titulo">Antigüedad de la deuda</div>
        <div className="aging-barra">
          {barras.map(([k, c]) => r[k] > 0 && <div key={k} style={{ width: `${(r[k] / total) * 100}%`, background: c }} title={`${TEXTO_TRAMO[k]}: ${fmt(r[k])}`} />)}
        </div>
        <div className="aging-leyenda">
          {barras.map(([k, c]) => (
            <div key={k}><i style={{ background: c }} />{TEXTO_TRAMO[k]} <strong>{fmt(r[k])}</strong></div>
          ))}
        </div>
        <div className="mini">1-30: Comercial recuerda el pago al contacto de finanzas del cliente · 31-90: el crédito del cliente se suspende solo · +90: decidir cobranza externa o castigo.</div>
      </div>

      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${vista === "clientes" ? "activo" : ""}`} onClick={() => setVista("clientes")}>Por cliente</button>
        <button className={`chip ${vista === "documentos" ? "activo" : ""}`} onClick={() => setVista("documentos")}>Por venta / factura</button>
        <button className={`chip ${vista === "margen" ? "activo" : ""}`} onClick={() => setVista("margen")}>Margen bajo{d.margen_bajo.length ? <strong>{d.margen_bajo.length}</strong> : null}</button>
      </div>

      {vista === "clientes" && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Cliente</th><th>Debe</th><th>Vencido</th><th>Peor tramo</th><th>Plazo</th><th>Paga con atraso</th><th>Contacto finanzas</th><th>Crédito</th></tr></thead>
            <tbody>
              {d.clientes.length === 0 ? <tr className="empty-row"><td colSpan={8}>// nadie debe 🎉</td></tr> : d.clientes.map((c) => (
                <tr key={c.cliente_id || c.cliente}>
                  <td><span className="id-cell">{c.codigo || ""}</span> {c.cliente}{c.usa_factoring && <div className="mini">usa factoring</div>}</td>
                  <td className="price-cell">{fmt(c.deuda)}{c.sobre_limite && <div className="mini" style={{ color: "var(--danger)" }}>sobre el límite</div>}</td>
                  <td className="price-cell" style={{ color: c.vencido > 0 ? "var(--danger)" : undefined }}>{fmt(c.vencido)}</td>
                  <td><Tramo t={c.peor_tramo} />{c.max_dias > 0 && <div className="mini">{c.max_dias} días</div>}</td>
                  <td className="mini">{c.plazo == null ? "—" : c.plazo === 0 ? "contado" : `${c.plazo} d${c.base === "recepcion" ? " desde recepción" : ""}`}</td>
                  <td className="mini">{c.atraso_promedio == null ? "—" : `${c.atraso_promedio > 0 ? "+" : ""}${c.atraso_promedio} d`}</td>
                  <td className="mini">{c.contacto_finanzas || "—"}</td>
                  <td>{c.estado_credito === "suspendido" ? <span className="estado estado-warn" title={c.motivo_credito || ""}>Suspendido</span> : c.estado_credito ? <span className="mini">activo</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mini" style={{ marginTop: 6 }}>Para reactivar el crédito de un cliente: Comercial → Clientes → Editar → Crédito "Activo". <button className="link" onClick={() => irA?.("clientes")}>Ir a Clientes</button></div>
        </div>
      )}

      {vista === "documentos" && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Venta</th><th>Cliente</th><th>Factura / OC</th><th>Vence</th><th>Tramo</th><th>Saldo</th><th></th></tr></thead>
            <tbody>
              {d.documentos.length === 0 ? <tr className="empty-row"><td colSpan={7}>// sin saldos por cobrar</td></tr> : d.documentos.map((x) => (
                <tr key={x.id}>
                  <td className="id-cell">{x.numero}{x.empresa === "tactics" && <div><Estado valor="tactics" /></div>}</td>
                  <td>{x.cliente || "—"}</td>
                  <td className="mini">{x.documento ? `F ${x.documento}` : "sin factura"}{x.orden_compra_cliente && <div>OC {x.orden_compra_cliente}</div>}</td>
                  <td className="mini">{fecha(x.fecha_vencimiento)}{x.provisorio && <div title="Aún no hay factura o recepción: el vencimiento puede cambiar">provisorio</div>}</td>
                  <td><Tramo t={x.tramo} />{x.dias_vencida > 0 && <div className="mini">{x.dias_vencida} días</div>}{x.dias_vencida <= 0 && x.dias_vencida != null && <div className="mini">en {-x.dias_vencida} días</div>}</td>
                  <td className="price-cell">{fmt(x.saldo)}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => verVenta(x.id)}>Cobrar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vista === "margen" && (
        <div className="table-wrap">
          <div className="mini" style={{ marginBottom: 8 }}>Ventas de los últimos 90 días con margen bajo {String(d.margen_minimo).replace(".", ",")}% sobre el neto (equivale a compra × 1,30).</div>
          <table className="table">
            <thead><tr><th>Venta</th><th>Fecha</th><th>Cliente</th><th>Neto</th><th>Costo</th><th>Margen</th><th></th></tr></thead>
            <tbody>
              {d.margen_bajo.length === 0 ? <tr className="empty-row"><td colSpan={7}>// todas sobre el mínimo</td></tr> : d.margen_bajo.map((v) => (
                <tr key={v.id}>
                  <td className="id-cell">{v.numero}</td><td className="mini">{fecha(v.fecha)}</td><td>{v.cliente || "—"}</td>
                  <td className="price-cell">{fmt(v.neto)}</td><td className="price-cell">{fmt(v.costo)}</td>
                  <td style={{ color: "var(--danger)", fontWeight: 600 }}>{String(v.margen_pct).replace(".", ",")}%</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => verVenta(v.id)}>Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mini" style={{ marginTop: 14 }}>
        Régimen: Kenott {d.iva.regimen_kenott} · Tactics {d.iva.regimen_tactics}. Saldo mínimo de caja: Kenott {fmt(d.saldo_minimo.kenott)} · Tactics {fmt(d.saldo_minimo.tactics)} (se usará en la fase de caja). Valores editables en Configuración.
      </div>
    </>
  );
}
