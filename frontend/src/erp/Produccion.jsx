// Finanzas y Control · Producción: qué hizo cada persona en Comercial y Operativo (gerencia incluida cuando cubre).
import { useState, useEffect, useCallback } from "react";
import { api, fmt, hoyISO } from "./lib";

const PERIODOS = [["mes", "Este mes"], ["semana", "Esta semana"], ["mes_pasado", "Mes pasado"]];
function rango(p) {
  const h = new Date(`${hoyISO()}T12:00:00`);
  const iso = (d) => d.toLocaleDateString("sv-SE");
  if (p === "semana") { const l = new Date(h); l.setDate(h.getDate() - ((h.getDay() + 6) % 7)); return [iso(l), iso(h)]; }
  if (p === "mes_pasado") return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))];
  return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)];
}
const Empresa = ({ e }) => <span className={`estado ${e === "tactics" ? "estado-info" : "estado-ok"}`}>{e === "tactics" ? "Tactics" : "Kenott"}</span>;

function TablaPersonas({ titulo, filas, conMonto = true, conEmpresa = false }) {
  return (
    <div className="panel">
      <div className="panel-titulo">{titulo}</div>
      {!filas.length ? <div className="mini">Sin registros en el período.</div> : (
        <table className="table table-compacta">
          <thead><tr><th>Quién</th>{conEmpresa && <th>Empresa</th>}<th>Cantidad</th>{conMonto && <th>Monto</th>}</tr></thead>
          <tbody>{filas.map((f, k) => (
            <tr key={k}><td>{f.persona}</td>{conEmpresa && <td><Empresa e={f.empresa} /></td>}<td>{f.cantidad}</td>{conMonto && <td className="price-cell">{fmt(f.monto)}</td>}</tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

export default function Produccion({ notify, irA }) {
  const [periodo, setPeriodo] = useState("mes");
  const [d, setD] = useState(null);
  const cargar = useCallback(async () => {
    const [desde, hasta] = rango(periodo);
    try { setD(await api(`/finanzas/produccion?desde=${desde}&hasta=${hasta}`)); } catch (e) { notify(e.message, "danger"); }
  }, [periodo, notify]);
  useEffect(() => { cargar(); }, [cargar]);
  if (!d) return <div className="cot-empty"><span className="spinner"></span>Cargando...</div>;
  const mp = d.mercado_publico;
  const pct = mp.cerrados ? Math.round((mp.cotizados / mp.cerrados) * 100) : 0;

  return (
    <>
      <div className="toolbar">
        <div className="chips">{PERIODOS.map(([v, t]) => <button key={v} className={`chip ${periodo === v ? "activo" : ""}`} onClick={() => setPeriodo(v)}>{t}</button>)}</div>
        <span className="mini">Del {d.desde.split("-").reverse().join("-")} al {d.hasta.split("-").reverse().join("-")} · cada acción queda con el nombre y el área de quien la hizo</span>
      </div>

      <div className="stats">
        <div className="stat-card"><div className="stat-label">Procesos de Merc. Público que cerraron</div><div className="stat-value">{mp.cerrados}</div><div className="mini">{mp.compra_agil} Compra Ágil · {mp.licitaciones} licitaciones</div></div>
        <div className="stat-card"><div className="stat-label">Postulados (cotizados)</div><div className="stat-value" style={{ color: "var(--success)" }}>{mp.cotizados}</div><div className="mini">{pct}% de los que cerraron</div></div>
        <div className="stat-card"><div className="stat-label">Cerraron sin postular</div><div className="stat-value" style={{ color: mp.sin_postular ? "var(--danger)" : undefined }}>{mp.sin_postular}</div><div className="mini">no descartados a propósito</div></div>
        <div className="stat-card"><div className="stat-label">Descartados</div><div className="stat-value">{mp.descartados}</div><div className="mini">no eran del rubro o no convenía</div></div>
      </div>

      <div className="dash-grid">
        <TablaPersonas titulo="Comercial · Cotizaciones emitidas" filas={d.cotizaciones} conEmpresa />
        <TablaPersonas titulo="Comercial · Ventas registradas" filas={d.ventas} conEmpresa />
      </div>
      {d.cotizaciones.length > 0 && (
        <div className="mini" style={{ margin: "-6px 0 12px" }}>
          Ganadas: {d.cotizaciones.filter((c) => c.ganadas).map((c) => `${c.persona} (${c.empresa === "tactics" ? "Tactics" : "Kenott"}) ${c.ganadas} de ${c.cantidad}`).join(" · ") || "ninguna aún"} ·
          De Mercado Público: {d.cotizaciones.reduce((s, c) => s + c.mercado_publico, 0)}
        </div>
      )}
      <div className="dash-grid">
        <TablaPersonas titulo="Comercial · Facturas emitidas" filas={d.facturas} />
        <TablaPersonas titulo="Operativo · Órdenes de compra a proveedores" filas={d.operativo.ordenes_compra} />
      </div>
      <div className="dash-grid">
        <TablaPersonas titulo="Operativo · Ventas aceptadas" filas={d.operativo.aceptadas} conMonto={false} />
        <TablaPersonas titulo="Operativo · Ventas confirmadas (productos listos)" filas={d.operativo.confirmadas} conMonto={false} />
      </div>
      <TablaPersonas titulo="Operativo · Despachos" filas={d.operativo.despachadas} conMonto={false} />

      <div className="panel">
        <div className="panel-titulo">Procesos que cerraron sin postular</div>
        {!d.sin_postular.length ? <div className="mini">Ninguno 🎉</div> : (
          <table className="table table-compacta">
            <tbody>{d.sin_postular.map((l) => (
              <tr key={l.codigo} className="clickable" onClick={() => irA?.("licitaciones", l.codigo)}>
                <td className="id-cell">{l.codigo}</td><td>{l.nombre}<div className="mini">{l.organismo}</div></td>
                <td className="mini">{l.fuente === "compra_agil" ? "Compra Ágil" : "Licitación"}</td>
                <td className="mini">cerró {new Date(l.fecha_cierre).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="price-cell">{l.monto ? fmt(l.monto) : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
