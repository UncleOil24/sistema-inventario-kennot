import { useState } from "react";
import { Modal, Estado, confirmar } from "./ui";
import { api } from "./lib";

// Si el teléfono o el correo están escritos dentro del contacto, se muestran en su columna (solo en pantalla)
const fonoDe = (t) => { const m = String(t || "").match(/\+?56[\s.-]?\d(?:[\s.-]?\d){8}|\b[29](?:[\s.-]?\d){8}\b/); return m ? m[0].trim() : ""; };
const correoDe = (t) => (String(t || "").match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [""])[0];
const VACIO = { nombre: "", razon_social: "", rut: "", contacto: "", telefono: "", email: "", direccion: "", comuna: "", rubro: "", tipo: "proveedor", notas: "", excluido: false, motivo_exclusion: "" };

export default function Proveedores({ esAdmin, proveedores, loading, recargar, notify }) {
  const [form, setForm] = useState(null); // null | objeto en edición
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const lista = proveedores.filter((p) => {
    const q = busqueda.toLowerCase();
    return !q || [p.nombre, p.razon_social, p.rut, p.rubro, p.contacto, p.comuna].some((v) => (v || "").toLowerCase().includes(q));
  });

  const guardar = async () => {
    if (!form.nombre) return notify("El nombre es obligatorio", "danger");
    setGuardando(true);
    try {
      if (form.id) await api(`/proveedores/${form.id}`, { method: "PUT", body: form });
      else await api("/proveedores", { method: "POST", body: form });
      notify(form.id ? "✓ Proveedor actualizado" : "✓ Proveedor agregado");
      setForm(null);
      recargar();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  const eliminar = async (p) => {
    if (!(await confirmar(`¿Eliminar a ${p.nombre}?\nSus órdenes de compra se conservan.`, { titulo: "Eliminar proveedor", boton: "Eliminar", peligro: true }))) return;
    try { await api(`/proveedores/${p.id}`, { method: "DELETE" }); notify("Proveedor eliminado", "danger"); recargar(); }
    catch (e) { notify(e.message, "danger"); }
  };

  const campo = (k, label, ph) => (
    <div className="field">
      <label>{label}</label>
      <input value={form[k] || ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={ph} />
    </div>
  );

  return (
    <>
      <div className="toolbar">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input className="search-input" placeholder="Buscar por nombre, RUT, rubro o comuna (ej. eléctrico, pinturas, EPP)..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="mini">{proveedores.length} proveedores</div>
        <button className="btn btn-primary" onClick={() => setForm({ ...VACIO })}>+ Nuevo proveedor</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Nombre corto</th><th>Razón social / RUT</th><th>Tipo</th><th>Contacto</th><th>Teléfono</th><th>Email</th><th>Acciones</th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={7}><span className="spinner"></span>Cargando...</td></tr>
              : lista.length === 0 ? <tr className="empty-row"><td colSpan={7}>// sin proveedores</td></tr>
              : lista.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.nombre}{p.rubro && <div className="mini">{p.rubro}</div>}{p.plazo_pago_dias > 0 && <div className="mini">paga a {p.plazo_pago_dias} días{Number(p.descuento_pronto_pago) > 0 ? ` · ${Number(p.descuento_pronto_pago)}% pronto pago` : ""}</div>}
                    {p.excluido && <div><span className="estado estado-warn" title={p.motivo_exclusion || ""}>Excluido del precio vigente</span></div>}</td>
                  <td className="mini">{p.razon_social || "—"}{p.rut ? ` · ${p.rut}` : ""}</td>
                  <td><Estado valor={p.tipo || "proveedor"} /></td>
                  <td className="mini" style={{ maxWidth: 300, minWidth: 180, whiteSpace: "normal", wordBreak: "break-word" }}>{p.contacto || "—"}</td>
                  <td className="mini" style={{ whiteSpace: "nowrap" }}>{p.telefono || fonoDe(p.contacto) || "—"}</td>
                  <td className="mini" style={{ whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: 260 }}>{p.email || correoDe(p.contacto) || "—"}{p.comuna && <div>{p.comuna}</div>}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...p })}>Editar</button>
                      {esAdmin && <button className="btn btn-danger btn-sm" onClick={() => eliminar(p)}>✕</button>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal titulo={form.id ? "// Editar proveedor" : "// Nuevo proveedor"} onClose={() => setForm(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</button>
          </>}>
          <div className="fields-row">{campo("nombre", "Nombre corto", "Ej: MADESUR")}{campo("razon_social", "Razón social", "Ferretería Madesur SpA")}</div>
          <div className="fields-row">{campo("rut", "RUT", "76.000.000-0")}{campo("rubro", "Rubros (separados por coma)", "Eléctrico, gasfitería, pinturas, EPP...")}</div>
          <div className="field">
            <label>Tipo</label>
            <select value={form.tipo || "proveedor"} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              <option value="proveedor">Proveedor (cotización / factura)</option>
              <option value="web">Tienda web (precio con IVA, se divide por 1,19)</option>
            </select>
          </div>
          {campo("contacto", "Contacto / vendedor", "Nombre, teléfono, correo")}
          <div className="fields-row">{campo("telefono", "Teléfono", "+569...")}{campo("email", "Email", "ventas@...")}</div>
          <div className="fields-row">{campo("direccion", "Dirección", "Ej: 14 Oriente 1186")}{campo("comuna", "Comuna", "Talca")}</div>
          <div className="fields-row tres">
            <div className="field"><label>Plazo de pago (días)</label>
              <input type="number" min="0" value={form.plazo_pago_dias ?? ""} onChange={(e) => setForm({ ...form, plazo_pago_dias: e.target.value === "" ? null : Number(e.target.value) })} placeholder="0 = contado" /></div>
            <div className="field"><label>Dcto. pronto pago (%)</label>
              <input type="number" min="0" step="0.5" value={form.descuento_pronto_pago ?? ""} onChange={(e) => setForm({ ...form, descuento_pronto_pago: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Ej: 2" /></div>
            <div className="field"><label>Si se paga dentro de (días)</label>
              <input type="number" min="0" value={form.dias_pronto_pago ?? ""} onChange={(e) => setForm({ ...form, dias_pronto_pago: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Ej: 10" /></div>
          </div>
          {esAdmin && (
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={!!form.excluido} onChange={(e) => setForm({ ...form, excluido: e.target.checked })} />
                Excluir del precio vigente (sus cotizaciones quedan como historial, pero no compiten)
              </label>
              {form.excluido && <input value={form.motivo_exclusion || ""} onChange={(e) => setForm({ ...form, motivo_exclusion: e.target.value })} placeholder="Motivo (ej. es de Santiago, el flete sale más caro)" />}
            </div>
          )}
          {campo("notas", "Notas", "Condiciones de pago, vendedor, etc.")}
        </Modal>
      )}
    </>
  );
}
