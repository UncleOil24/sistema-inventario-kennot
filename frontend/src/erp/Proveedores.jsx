import { useState } from "react";
import { Modal } from "./ui";
import { api } from "./lib";

const VACIO = { nombre: "", rut: "", telefono: "", email: "", direccion: "", rubro: "", notas: "" };

export default function Proveedores({ proveedores, loading, recargar, notify }) {
  const [form, setForm] = useState(null); // null | objeto en edición
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const lista = proveedores.filter((p) => {
    const q = busqueda.toLowerCase();
    return !q || [p.nombre, p.rut, p.rubro].some((v) => (v || "").toLowerCase().includes(q));
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
    if (!confirm(`¿Eliminar a ${p.nombre}? Sus órdenes de compra se conservan.`)) return;
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
          <input className="search-input" placeholder="Buscar por nombre, RUT o rubro..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="mini">{proveedores.length} proveedores</div>
        <button className="btn btn-primary" onClick={() => setForm({ ...VACIO })}>+ Nuevo proveedor</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>ID</th><th>Nombre</th><th>RUT</th><th>Rubro</th><th>Teléfono</th><th>Email</th><th>Acciones</th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={7}><span className="spinner"></span>Cargando...</td></tr>
              : lista.length === 0 ? <tr className="empty-row"><td colSpan={7}>// sin proveedores</td></tr>
              : lista.map((p) => (
                <tr key={p.id}>
                  <td className="id-cell">#{String(p.id).padStart(4, "0")}</td>
                  <td style={{ fontWeight: 500 }}>{p.nombre}</td>
                  <td className="mini">{p.rut || "—"}</td>
                  <td>{p.rubro ? <span className="cat-badge">{p.rubro}</span> : <span className="mini">—</span>}</td>
                  <td className="mini">{p.telefono || "No disponible"}</td>
                  <td className="mini">{p.email || "—"}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...p })}>Editar</button>
                      <button className="btn btn-danger btn-sm" onClick={() => eliminar(p)}>✕</button>
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
          {campo("nombre", "Nombre / razón social", "Ej: Chilemat")}
          <div className="fields-row">{campo("rut", "RUT", "76.000.000-0")}{campo("rubro", "Rubro", "Ferretería, Eléctrico...")}</div>
          <div className="fields-row">{campo("telefono", "Teléfono", "+569...")}{campo("email", "Email", "ventas@...")}</div>
          {campo("direccion", "Dirección", "Calle, ciudad")}
          {campo("notas", "Notas", "Condiciones de pago, vendedor, etc.")}
        </Modal>
      )}
    </>
  );
}
