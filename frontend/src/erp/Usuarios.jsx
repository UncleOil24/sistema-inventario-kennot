import { useState, useEffect, useCallback } from "react";
import { Modal, Estado } from "./ui";
import { api } from "./lib";

const VACIO = { nombre: "", email: "", password: "", rol: "usuario", activo: true };

export default function Usuarios({ notify, yo }) {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try { setUsuarios(await api("/usuarios")); }
    catch (e) { notify(e.message, "danger"); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    setGuardando(true);
    try {
      const body = { nombre: form.nombre, email: form.email, rol: form.rol, activo: form.activo };
      if (form.password) body.password = form.password;
      if (form.id) await api(`/usuarios/${form.id}`, { method: "PUT", body });
      else await api("/usuarios", { method: "POST", body: { ...body, password: form.password } });
      notify(form.id ? "✓ Usuario actualizado" : "✓ Usuario creado");
      setForm(null);
      cargar();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  const esYo = form?.id === yo.id;

  return (
    <>
      <div className="toolbar">
        <div className="mini">{usuarios.filter((u) => u.activo).length} usuarios activos</div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setForm({ ...VACIO })}>+ Nuevo usuario</button>
      </div>
      <div className="aviso" style={{ color: "var(--text2)", borderColor: "var(--border2)", background: "var(--surface)" }}>
        <strong style={{ color: "var(--accent)" }}>Admin</strong>: todo, incluidos costos, márgenes, anular, borrar, ajustes de stock y usuarios.{" "}
        <strong style={{ color: "var(--text)" }}>Usuario</strong>: cotiza, vende, cobra, compra y recibe mercadería; no ve costos ni márgenes y no puede anular ni borrar.
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr className="empty-row"><td colSpan={6}><span className="spinner"></span>Cargando...</td></tr>
              : usuarios.map((u) => (
                <tr key={u.id} className={u.activo ? "" : "fila-anulada"}>
                  <td style={{ fontWeight: 500 }}>{u.nombre}{u.id === yo.id && <span className="mini"> (tú)</span>}</td>
                  <td className="mini">{u.email}</td>
                  <td><span className={`rol-badge rol-${u.rol}`}>{u.rol}</span></td>
                  <td><Estado valor={u.activo ? "activo" : "inactivo"} /></td>
                  <td className="mini">{u.ultimo_acceso ? new Date(u.ultimo_acceso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "Nunca"}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...u, password: "" })}>Editar</button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal titulo={form.id ? "// Editar usuario" : "// Nuevo usuario"} onClose={() => setForm(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar}
              disabled={guardando || !form.nombre || !form.email || (!form.id && form.password.length < 8)}>
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </>}>
          <div className="field">
            <label>Nombre</label>
            <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre y apellido" />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="correo@ejemplo.cl" />
          </div>
          <div className="field">
            <label>{form.id ? "Nueva contraseña (dejar vacío para no cambiarla)" : "Contraseña (mínimo 8 caracteres)"}</label>
            <input type="text" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="fields-row">
            <div className="field">
              <label>Rol</label>
              <select value={form.rol} disabled={esYo} onChange={(e) => setForm({ ...form, rol: e.target.value })}>
                <option value="usuario">Usuario</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {form.id && (
              <label className="check" style={{ alignSelf: "end", paddingBottom: 10 }}>
                <input type="checkbox" checked={form.activo} disabled={esYo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                Activo (puede iniciar sesión)
              </label>
            )}
          </div>
          {esYo && <div className="mini">No puedes cambiar tu propio rol ni desactivarte. Para tu contraseña usa el menú de tu nombre → "Cambiar contraseña".</div>}
          {form.id && !esYo && <div className="mini">Si cambias la contraseña, el rol o lo desactivas, se cerrarán sus sesiones abiertas.</div>}
        </Modal>
      )}
    </>
  );
}
