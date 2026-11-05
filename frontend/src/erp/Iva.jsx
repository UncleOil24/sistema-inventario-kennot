// Finanzas y Control · IVA mensual (fase 2), cada empresa por separado: débito − crédito − remanente.
// Es el cálculo del sistema para anticipar el pago; el F29 lo confirma el contador.
import { useState, useEffect, useCallback } from "react";
import { api, fmt, fecha, hoyISO } from "./lib";
import { Modal } from "./ui";

const EMP = { kenott: "Kenott", tactics: "Tactics" };

export default function Iva({ notify }) {
  const [mes, setMes] = useState("");
  const [d, setD] = useState(null);
  const [pago, setPago] = useState(null); // { empresa, mes, monto, fecha, folio }
  const [ver, setVer] = useState("emitidas");
  const cargar = useCallback(async () => {
    try { setD(await api(`/finanzas/iva${mes ? `?mes=${mes}` : ""}`)); } catch (e) { notify(e.message, "danger"); }
  }, [mes, notify]);
  useEffect(() => { cargar(); }, [cargar]);
  if (!d) return <div className="cot-empty"><span className="spinner"></span>Cargando...</div>;

  const meses = d.empresas.kenott?.meses.map((m) => [m.mes, m.nombre]) || [];
  const guardarPago = async (deshacer) => {
    try {
      await api("/finanzas/iva/pago", { method: "POST", body: deshacer ? { empresa: pago.empresa, mes: pago.mes, monto: null } : pago });
      notify(deshacer ? "Pago quitado" : `✓ IVA de ${EMP[pago.empresa]} marcado como pagado`);
      setPago(null); cargar();
    } catch (e) { notify(e.message, "danger"); }
  };
  const det = d.detalle;

  return (
    <>
      <div className="toolbar">
        <div className="chips">
          {meses.map(([m, n]) => <button key={m} className={`chip ${d.mes === m ? "activo" : ""}`} onClick={() => setMes(m)}>{n}</button>)}
        </div>
        <span className="mini">Se paga a más tardar el día {d.dia_pago} del mes siguiente. Nunca se compensa entre empresas.</span>
      </div>

      <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 14 }}>
        {["kenott", "tactics"].map((e) => {
          const m = d.empresas[e]?.actual;
          if (!m) return null;
          return (
            <div key={e} className="panel" style={{ margin: 0 }}>
              <div className="panel-titulo">{EMP[e]} · IVA de {m.nombre}</div>
              <table className="table table-compacta">
                <tbody>
                  <tr><td>Débito fiscal (19% de {m.facturas} factura(s) emitidas por {fmt(m.facturado)})</td><td className="price-cell">{fmt(m.debito)}</td></tr>
                  <tr><td>− Crédito por compras ({m.compras} factura(s) de proveedores)</td><td className="price-cell">{fmt(m.credito_compras)}</td></tr>
                  <tr><td>− Crédito por gastos con factura ({m.gastos})</td><td className="price-cell">{fmt(m.credito_gastos)}</td></tr>
                  <tr><td>− Remanente del mes anterior</td><td className="price-cell">{fmt(m.remanente_anterior)}</td></tr>
                  <tr style={{ fontWeight: 700 }}><td>{m.a_pagar > 0 ? "IVA a pagar" : "Sin pago: queda remanente"}</td>
                    <td className="price-cell" style={{ color: m.a_pagar > 0 ? "var(--danger)" : "var(--success)" }}>{fmt(m.a_pagar > 0 ? m.a_pagar : m.remanente_siguiente)}</td></tr>
                </tbody>
              </table>
              <div className="mini" style={{ marginTop: 6 }}>
                Vence el {fecha(m.vence)}{m.dias >= 0 ? ` (${m.dias === 0 ? "hoy" : `en ${m.dias} días`})` : ""}{m.en_curso ? " · el mes aún no termina: el monto puede cambiar" : ""}
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {m.pagado
                  ? <><span className="estado estado-ok">Pagado el {fecha(m.pagado.fecha)}{m.pagado.monto ? ` · ${fmt(m.pagado.monto)}` : ""}{m.pagado.folio ? ` · F29 ${m.pagado.folio}` : ""}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPago({ empresa: e, mes: m.mes, monto: m.pagado.monto, fecha: m.pagado.fecha, folio: m.pagado.folio || "", ya: true })}>Cambiar</button></>
                  : !m.en_curso && <button className="btn btn-primary btn-sm" onClick={() => setPago({ empresa: e, mes: m.mes, monto: m.a_pagar, fecha: hoyISO(), folio: "" })}>{m.a_pagar > 0 ? "Marcar pagado" : "Marcar declarado (F29)"}</button>}
              </div>
            </div>
          );
        })}
      </div>

      {det.faltan.length > 0 && (
        <div className="aviso">
          {det.faltan.length} compra(s) recibidas este mes no suman crédito porque les falta el N° de factura o la empresa:{" "}
          {det.faltan.map((o) => `${o.numero} ${o.proveedor}`).join(" · ")}. Complétalas en Por pagar o en Operativo → Compras.
        </div>
      )}

      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${ver === "emitidas" ? "activo" : ""}`} onClick={() => setVer("emitidas")}>Facturas emitidas <strong>{det.emitidas.length}</strong></button>
        <button className={`chip ${ver === "recibidas" ? "activo" : ""}`} onClick={() => setVer("recibidas")}>Facturas de proveedores <strong>{det.recibidas.length}</strong></button>
        <button className={`chip ${ver === "gastos" ? "activo" : ""}`} onClick={() => setVer("gastos")}>Gastos con IVA <strong>{det.gastos.length}</strong></button>
        <button className={`chip ${ver === "historial" ? "activo" : ""}`} onClick={() => setVer("historial")}>Meses anteriores</button>
      </div>

      <div className="table-wrap">
        {ver === "emitidas" && (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Empresa</th><th>Factura</th><th>Venta</th><th>Total</th><th>IVA</th></tr></thead>
            <tbody>{det.emitidas.length === 0 ? <tr className="empty-row"><td colSpan={6}>// sin facturas emitidas este mes</td></tr> : det.emitidas.map((f) => (
              <tr key={f.id}><td className="mini">{fecha(f.fecha)}</td><td className="mini">{EMP[f.empresa]}</td><td>N° {f.numero}</td><td className="mini">{f.venta} · {f.cliente || ""}</td>
                <td className="price-cell">{fmt(f.total)}</td><td className="price-cell">{fmt(Math.round(f.total * 19 / 119))}</td></tr>
            ))}</tbody>
          </table>
        )}
        {ver === "recibidas" && (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Empresa</th><th>Proveedor</th><th>Factura</th><th>Neto</th><th>IVA</th><th>Total</th></tr></thead>
            <tbody>{det.recibidas.length === 0 ? <tr className="empty-row"><td colSpan={7}>// sin facturas de proveedores este mes</td></tr> : det.recibidas.map((o) => (
              <tr key={o.id}><td className="mini">{fecha(o.fecha)}</td><td className="mini">{EMP[o.empresa]}</td><td>{o.proveedor}</td><td className="mini">N° {o.factura} · {o.numero}</td>
                <td className="price-cell">{fmt(o.neto)}</td><td className="price-cell">{fmt(o.iva)}</td><td className="price-cell">{fmt(o.total)}</td></tr>
            ))}</tbody>
          </table>
        )}
        {ver === "gastos" && (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Empresa</th><th>Detalle</th><th>Comprobante</th><th>Total</th><th>IVA</th></tr></thead>
            <tbody>{det.gastos.length === 0 ? <tr className="empty-row"><td colSpan={6}>// sin gastos con factura este mes (se anotan en Finanzas → Gastos)</td></tr> : det.gastos.map((g) => (
              <tr key={g.id}><td className="mini">{fecha(g.fecha)}</td><td className="mini">{EMP[g.empresa]}</td><td>{g.descripcion || g.tipo}</td><td className="mini">{g.comprobante || "—"}</td>
                <td className="price-cell">{fmt(g.total)}</td><td className="price-cell">{fmt(g.iva)}</td></tr>
            ))}</tbody>
          </table>
        )}
        {ver === "historial" && (
          <table className="table">
            <thead><tr><th>Mes</th><th>Empresa</th><th>Débito</th><th>Crédito</th><th>Remanente anterior</th><th>A pagar</th><th>Vence</th><th>Pago</th></tr></thead>
            <tbody>{["kenott", "tactics"].flatMap((e) => (d.empresas[e]?.meses || []).map((m) => (
              <tr key={`${e}${m.mes}`}><td>{m.nombre}</td><td className="mini">{EMP[e]}</td><td className="price-cell">{fmt(m.debito)}</td><td className="price-cell">{fmt(m.credito)}</td>
                <td className="price-cell">{fmt(m.remanente_anterior)}</td><td className="price-cell">{m.a_pagar > 0 ? fmt(m.a_pagar) : <span className="mini">remanente {fmt(m.remanente_siguiente)}</span>}</td>
                <td className="mini">{fecha(m.vence)}</td><td className="mini">{m.pagado ? `pagado ${fecha(m.pagado.fecha)}` : m.en_curso ? "en curso" : "—"}</td></tr>
            )))}</tbody>
          </table>
        )}
      </div>
      <div className="mini" style={{ marginTop: 8 }}>
        Cálculo del sistema para anticipar el pago; el F29 lo confirma el contador. El crédito sale de las facturas de proveedores (Compras) y de los gastos con IVA anotado.
        El remanente de partida y el mes desde el que se calcula se ajustan en Configuración → Finanzas y Control.
      </div>

      {pago && (
        <Modal titulo={`// IVA ${EMP[pago.empresa]} · ${meses.find(([m]) => m === pago.mes)?.[1] || pago.mes}`} onClose={() => setPago(null)}
          footer={<>
            {pago.ya && <button className="btn btn-danger" onClick={() => guardarPago(true)}>Quitar pago</button>}
            <button className="btn btn-ghost" onClick={() => setPago(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => guardarPago(false)}>Guardar</button>
          </>}>
          <div className="fields-row">
            <div className="field"><label>Fecha de pago</label><input type="date" value={pago.fecha || ""} onChange={(e) => setPago({ ...pago, fecha: e.target.value })} /></div>
            <div className="field"><label>Monto pagado</label><input type="number" min="0" value={pago.monto ?? ""} onChange={(e) => setPago({ ...pago, monto: e.target.value })} /></div>
          </div>
          <div className="field"><label>Folio del F29 (opcional)</label><input value={pago.folio || ""} onChange={(e) => setPago({ ...pago, folio: e.target.value })} /></div>
          <div className="mini">Si el contador declaró otro monto (por ejemplo, con PPM), anota lo que realmente se pagó.</div>
        </Modal>
      )}
    </>
  );
}
