import { useState } from "react";
import { Modal, Estado } from "./ui";
import { api } from "./lib";

const VACIO = { nombre: "", rut: "", tipo: "convenio", contacto: "", telefono: "", email: "", comuna: "", direccion: "" };

export default function Clientes({ esAdmin, clientes, loading, recargar, notify }) {
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const lista = clientes.filter((c) => {
    const q = busqueda.toLowerCase();
    return !q || [c.nombre, c.rut, c.comuna, c.contacto].some((v) => (v || "").toLowerCase().includes(q));
  });

  const guardar = async () => {
    if (!form.nombre) return notify("El nombre es obligatorio", "danger");
    setGuardando(true);
    try {
      if (form.id) await api(`/clientes/${form.id}`, { method: "PUT", body: form });
      else await api("/clientes", { method: "POST", body: form });
      notify(form.id ? "✓ Cliente actualizado" : "✓ Cliente agregado");
      setForm(null);
      recargar();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };
  const eliminar = async (c) => {
    if (!confirm(`¿Eliminar a ${c.nombre}? Sus cotizaciones y ventas se conservan.`)) return;
    try { await api(`/clientes/${c.id}`, { method: "DELETE" }); notify("Cliente eliminado", "danger"); recargar(); }
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
          <input className="search-input" placeholder="Buscar por nombre, RUT, comuna o contacto..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="mini">{clientes.length} clientes</div>
        <button className="btn btn-primary" onClick={() => setForm({ ...VACIO })}>+ Nuevo cliente</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Nombre</th><th>RUT</th><th>Tipo de precio</th><th>Contacto</th><th>Teléfono</th><th>Email</th><th>Comuna</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={8}><span className="spinner"></span>Cargando...</td></tr>
              : lista.length === 0 ? <tr className="empty-row"><td colSpan={8}>// sin clientes</td></tr>
              : lista.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500 }}>{c.nombre}</td>
                  <td className="mini">{c.rut || "—"}</td>
                  <td><Estado valor={c.tipo || "convenio"} /></td>
                  <td className="mini">{c.contacto || "—"}</td>
                  <td className="mini">{c.telefono || "—"}</td>
                  <td className="mini">{c.email || "—"}</td>
                  <td className="mini">{c.comuna || "—"}</td>
                  <td><div className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...VACIO, ...c })}>Editar</button>
                    {esAdmin && <button className="btn btn-danger btn-sm" onClick={() => eliminar(c)}>✕</button>}
                  </div></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal titulo={form.id ? "// Editar cliente" : "// Nuevo cliente"} onClose={() => setForm(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</button>
          </>}>
          {campo("nombre", "Nombre o razón social", "Ej: I. Municipalidad de Curicó")}
          <div className="fields-row">
            {campo("rut", "RUT", "69.000.000-0")}
            <div className="field">
              <label>Tipo de precio</label>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                <option value="convenio">Convenio (instituciones)</option>
                <option value="particular">Particular</option>
              </select>
            </div>
          </div>
          <div className="fields-row">{campo("contacto", "Contacto", "Nombre de quien compra")}{campo("telefono", "Teléfono", "+569...")}</div>
          <div className="fields-row">{campo("email", "Email", "correo@...")}{campo("comuna", "Comuna", "Talca")}</div>
          {campo("direccion", "Dirección", "Calle, ciudad")}
        </Modal>
      )}
    </>
  );
}
