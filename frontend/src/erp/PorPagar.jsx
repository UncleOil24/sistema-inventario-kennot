// Finanzas y Control · Por pagar (fase 2): lo que debemos a proveedores, cuándo vence y cuánto sale cada semana.
import { useState, useEffect, useCallback } from "react";
import { api, fmt, fecha } from "./lib";
import { DetalleOrden } from "./Compras";

const COLOR = { por_vencer: "estado-ok", v1_30: "estado-warn", v31_60: "estado-warn tramo-critico", v60: "estado-muted" };
const TEXTO = { por_vencer: "Al día", v1_30: "1-30 días", v31_60: "31-60 días", v60: "+60 días" };
const EMP = { kenott: "Kenott", tactics: "Tactics" };

export default function PorPagar({ notify }) {
  const [empresa, setEmpresa] = useState("");
  const [d, setD] = useState(null);
  const [vista, setVista] = useState("documentos");
  const [orden, setOrden] = useState(null);
  const cargar = useCallback(async () => {
    try { setD(await api(`/finanzas/por-pagar${empresa ? `?empresa=${empresa}` : ""}`)); } catch (e) { notify(e.message, "danger"); }
  }, [empresa, notify]);
  useEffect(() => { cargar(); }, [cargar]);
  const abrir = async (id) => { try { setOrden(await api(`/ordenes-compra/${id}`)); } catch (e) { notify(e.message, "danger"); } };
  if (!d) return <div className="cot-empty"><span className="spinner"></span>Cargando...</div>;

  const r = d.resumen[empresa || "ambas"];
  const total = r.por_pagar || 1;
  const barras = [["por_vencer", "var(--success)"], ["v1_30", "var(--warn)"], ["v31_60", "var(--danger)"], ["v60", "var(--text3)"]];
  const lista = d.documentos.filter((x) => !empresa || x.empresa === empresa || !x.empresa);

  return (
    <>
      <div className="toolbar">
        <div className="chips">
          {[["", "Ambas empresas"], ["kenott", "Kenott"], ["tactics", "Tactics"]].map(([v, t]) => <button key={t} className={`chip ${empresa === v ? "activo" : ""}`} onClick={() => setEmpresa(v)}>{t}</button>)}
        </div>
        <span className="mini">Vence: fecha anotada, o fecha de la factura + plazo del proveedor (vacío = contado).</span>
      </div>

      <div className="stats">
        <div className="stat-card"><div className="stat-label">Por pagar</div><div className="stat-value accent">{fmt(r.por_pagar)}</div><div className="mini">{r.documentos} compra(s)</div></div>
        <div className="stat-card"><div className="stat-label">Vencido</div><div className="stat-value" style={{ color: r.vencido > 0 ? "var(--danger)" : "var(--success)" }}>{fmt(r.vencido)}</div><div className="mini">pagar cuanto antes</div></div>
        <div className="stat-card"><div className="stat-label">Vence en 7 días</div><div className="stat-value" style={{ color: r.proximos_7 > 0 ? "var(--warn)" : undefined }}>{fmt(r.proximos_7)}</div>
          <div className="mini">saldo mínimo de caja {empresa ? fmt(d.saldo_minimo[empresa]) : `${fmt(d.saldo_minimo.kenott)} c/u`}</div></div>
        <div className="stat-card"><div className="stat-label">Ahorro por pronto pago</div><div className="stat-value" style={{ color: r.ahorro_pronto_pago > 0 ? "var(--success)" : undefined }}>{fmt(r.ahorro_pronto_pago)}</div><div className="mini">si se paga dentro del plazo de descuento</div></div>
      </div>

      {d.sin_empresa > 0 && <div className="aviso">{d.sin_empresa} compra(s) sin empresa: ábrelas y elige Kenott o Tactics, para que su IVA y su deuda queden en la empresa correcta.</div>}

      <div className="panel">
        <div className="panel-titulo">Pagos de las próximas semanas</div>
        <div className="stats" style={{ marginBottom: 6 }}>
          {d.semanas.map((s, i) => (
            <div key={i} className="stat-card">
              <div className="stat-label">{i === 0 ? "Esta semana (y lo vencido)" : `${fecha(s.desde)} al ${fecha(s.hasta)}`}</div>
              <div className="stat-value" style={{ fontSize: 20 }}>{fmt(s.monto)}</div><div className="mini">{s.documentos} pago(s)</div>
            </div>
          ))}
        </div>
        <div className="aging-barra">
          {barras.map(([k, c]) => r[k] > 0 && <div key={k} style={{ width: `${(r[k] / total) * 100}%`, background: c }} title={`${TEXTO[k]}: ${fmt(r[k])}`} />)}
        </div>
        <div className="aging-leyenda">{barras.map(([k, c]) => <div key={k}><i style={{ background: c }} />{TEXTO[k]} <strong>{fmt(r[k])}</strong></div>)}</div>
      </div>

      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${vista === "documentos" ? "activo" : ""}`} onClick={() => setVista("documentos")}>Por factura</button>
        <button className={`chip ${vista === "proveedores" ? "activo" : ""}`} onClick={() => setVista("proveedores")}>Por proveedor</button>
      </div>

      {vista === "documentos" && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Vence</th><th>Proveedor</th><th>Factura</th><th>Empresa</th><th>Para la venta</th><th>Saldo</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {lista.length === 0 ? <tr className="empty-row"><td colSpan={8}>// no hay pagos pendientes a proveedores</td></tr> : lista.map((x) => (
                <tr key={x.id}>
                  <td className="mini">{fecha(x.fecha_vencimiento)}{x.vence_estimado && <div>calculado{x.plazo ? ` (${x.plazo} d)` : " (contado)"}</div>}</td>
                  <td>{x.proveedor}{x.contacto && <div className="mini" style={{ maxWidth: 220, whiteSpace: "normal" }}>{x.contacto}</div>}</td>
                  <td className="mini">{x.factura ? <>N° {x.factura}{x.fecha_factura && <div>{fecha(x.fecha_factura)}</div>}</> : <span style={{ color: "var(--warn)" }}>sin factura · {x.numero}</span>}</td>
                  <td className="mini">{EMP[x.empresa] || <span style={{ color: "var(--warn)" }}>sin empresa</span>}</td>
                  <td className="mini">{x.venta_numero ? `${x.venta_numero} · ${x.cliente || ""}` : "—"}</td>
                  <td className="price-cell">{fmt(x.saldo)}{x.saldo < x.total && <div className="mini">de {fmt(x.total)}</div>}
                    {x.pronto_pago && <div className="mini" style={{ color: "var(--success)", whiteSpace: "normal" }}>−{x.pronto_pago.pct}% hasta {fecha(x.pronto_pago.hasta)}<br />ahorras {fmt(x.pronto_pago.ahorro)}</div>}</td>
                  <td><span className={`estado ${COLOR[x.tramo]}`}>{x.dias_vencida > 0 ? `${x.dias_vencida} d vencida` : x.dias_vencida === 0 ? "vence hoy" : `en ${-x.dias_vencida} d`}</span></td>
                  <td><div className="actions"><button className="btn btn-ghost btn-sm" onClick={() => abrir(x.id)}>Pagar / ver</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vista === "proveedores" && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Proveedor</th><th>Debemos</th><th>Vencido</th><th>Próximo vencimiento</th><th>Plazo</th><th>Contacto</th></tr></thead>
            <tbody>
              {d.proveedores.length === 0 ? <tr className="empty-row"><td colSpan={6}>// no le debemos a nadie</td></tr> : d.proveedores.map((p) => (
                <tr key={p.proveedor_id || p.proveedor}>
                  <td>{p.proveedor}<div className="mini">{p.documentos} factura(s)</div></td>
                  <td className="price-cell">{fmt(p.deuda)}</td>
                  <td className="price-cell" style={{ color: p.vencido > 0 ? "var(--danger)" : undefined }}>{fmt(p.vencido)}{p.max_dias > 0 && <div className="mini">hasta {p.max_dias} días</div>}</td>
                  <td className="mini">{fecha(p.proximo)}</td>
                  <td className="mini">{p.plazo ? `${p.plazo} días` : "contado"}</td>
                  <td className="mini">{p.contacto || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mini" style={{ marginTop: 8 }}>El plazo de pago y el descuento por pronto pago se anotan en la ficha de cada proveedor (Operativo → Proveedores).</div>

      {orden && (
        <DetalleOrden orden={orden} esAdmin puedeOperar notify={notify} onClose={() => setOrden(null)}
          onEditar={() => notify("Para editar los productos ve a Operativo → Compras", "danger")}
          onCambio={async () => { await abrir(orden.id); cargar(); }}
          onEliminada={() => { setOrden(null); cargar(); }} />
      )}
    </>
  );
}
