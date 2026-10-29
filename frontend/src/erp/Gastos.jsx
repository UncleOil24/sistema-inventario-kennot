import { useState, useEffect, useCallback } from "react";
import { Modal } from "./ui";
import { api, fmt, fecha, hoyISO, TIPOS_GASTO } from "./lib";

const mesActual = () => hoyISO().slice(0, 7);

export default function Gastos({ notify }) {
  const [mes, setMes] = useState(mesActual());
  const [gastos, setGastos] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try { setGastos(await api(`/gastos?mes=${mes}`)); } catch (e) { notify(e.message, "danger"); }
    finally { setLoading(false); }
  }, [mes, notify]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { api("/ventas?estado=emitida").then(setVentas).catch(() => {}); }, []);

  const guardar = async () => {
    try {
      const body = { ...form, monto: Number(form.monto), venta_id: form.venta_id || null };
      if (form.id) await api(`/gastos/${form.id}`, { method: "PUT", body });
      else await api("/gastos", { method: "POST", body });
      notify("✓ Gasto guardado");
      setForm(null);
      cargar();
    } catch (e) { notify(e.message, "danger"); }
  };
  const eliminar = async (g) => {
    if (!confirm("¿Eliminar este gasto?")) return;
    try { await api(`/gastos/${g.id}`, { method: "DELETE" }); notify("Gasto eliminado", "danger"); cargar(); }
    catch (e) { notify(e.message, "danger"); }
  };

  const total = gastos.reduce((s, g) => s + Number(g.monto), 0);
  const porTipo = Object.keys(TIPOS_GASTO).map((t) => [t, gastos.filter((g) => g.tipo === t).reduce((s, g) => s + Number(g.monto), 0)]);
  const asociados = gastos.filter((g) => g.venta_id).reduce((s, g) => s + Number(g.monto), 0);

  return (
    <>
      <div className="stats">
        <div className="stat-card"><div className="stat-label">Gastos del mes</div><div className="stat-value accent">{fmt(total)}</div><div className="mini">{gastos.length} registros</div></div>
        <div className="stat-card"><div className="stat-label">Asociados a ventas</div><div className="stat-value" style={{ fontSize: 18 }}>{fmt(asociados)}</div></div>
        <div className="stat-card"><div className="stat-label">Generales del mes</div><div className="stat-value" style={{ fontSize: 18 }}>{fmt(total - asociados)}</div></div>
        <div className="stat-card"><div className="stat-label">Por tipo</div><div className="mini">{porTipo.filter(([, v]) => v).map(([t, v]) => `${TIPOS_GASTO[t]} ${fmt(v)}`).join(" · ") || "—"}</div></div>
      </div>
      <div className="toolbar">
        <div className="field" style={{ minWidth: 160 }}>
          <label>Mes</label>
          <input type="month" className="filter-select" value={mes} onChange={(e) => setMes(e.target.value || mesActual())} />
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setForm({ fecha: hoyISO(), tipo: "flete", monto: "", descripcion: "", venta_id: "", comprobante: "" })}>+ Nuevo gasto</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Venta</th><th>Comprobante</th><th>Monto</th><th>Por</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={8}><span className="spinner"></span>Cargando...</td></tr>
              : gastos.length === 0 ? <tr className="empty-row"><td colSpan={8}>// sin gastos este mes</td></tr>
              : gastos.map((g) => (
                <tr key={g.id}>
                  <td className="mini">{fecha(g.fecha)}</td>
                  <td><span className="cat-badge">{TIPOS_GASTO[g.tipo] || g.tipo}</span></td>
                  <td>{g.descripcion || "—"}</td>
                  <td className="mini">{g.venta_numero ? `${g.venta_numero} · ${g.venta_cliente || ""}` : "General"}</td>
                  <td className="mini">{g.comprobante || "—"}</td>
                  <td className="price-cell">{fmt(g.monto)}</td>
                  <td className="mini">{g.creado_por || ""}</td>
                  <td><div className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...g, venta_id: g.venta_id || "" })}>Editar</button>
                    <button className="btn btn-danger btn-sm" onClick={() => eliminar(g)}>✕</button>
                  </div></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal titulo={form.id ? "// Editar gasto" : "// Nuevo gasto"} onClose={() => setForm(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={!(Number(form.monto) > 0)}>Guardar</button>
          </>}>
          <div className="fields-row">
            <div className="field"><label>Fecha</label><input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></div>
            <div className="field"><label>Tipo</label>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                {Object.entries(TIPOS_GASTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="fields-row">
            <div className="field"><label>Monto</label><input type="number" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} /></div>
            <div className="field"><label>Comprobante</label><input value={form.comprobante || ""} onChange={(e) => setForm({ ...form, comprobante: e.target.value })} placeholder="N° boleta / factura" /></div>
          </div>
          <div className="field"><label>Detalle</label><input value={form.descripcion || ""} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Ej: Flete a Curicó" /></div>
          <div className="field"><label>Asociar a una venta (opcional)</label>
            <select value={form.venta_id} onChange={(e) => setForm({ ...form, venta_id: e.target.value })}>
              <option value="">— Gasto general del mes —</option>
              {ventas.map((v) => <option key={v.id} value={v.id}>{v.numero} · {v.cliente_nombre || "Sin cliente"} · {fmt(v.subtotal)}</option>)}
            </select>
          </div>
        </Modal>
      )}
    </>
  );
}
