import { useState, useEffect, useCallback } from "react";
import { Modal, Estado, confirmar } from "./ui";
import { api } from "./lib";

const VACIO = { nombre: "", email: "", password: "", rol: "comercial", activo: true };
const ROLES = [["gerencia", "Gerencia (ve y hace todo)"], ["comercial", "Comercial (Dpto. 1)"], ["operativo", "Operativo (Dpto. 2)"], ["admin", "Administrador (ve y hace todo)"], ["usuario", "Usuario antiguo (como Comercial, sin costos)"]];

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
  const [claves, setClaves] = useState(null);
  const crearEquipo = async () => {
    try { setClaves(await api("/usuarios/equipo", { method: "POST" })); cargar(); }
    catch (e) { notify(e.message, "danger"); }
  };

  return (
    <>
      <div className="toolbar">
        <div className="mini">{usuarios.filter((u) => u.activo).length} usuarios activos</div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={crearEquipo} title="Crea a Jorge (Gerencia), Nicol (Comercial) y Marcela (Operativo) si aún no existen">Crear usuarios del equipo</button>
        <button className="btn btn-primary" onClick={() => setForm({ ...VACIO })}>+ Nuevo usuario</button>
      </div>
      <div className="aviso" style={{ color: "var(--text2)", borderColor: "var(--border2)", background: "var(--surface)" }}>
        <strong style={{ color: "var(--accent)" }}>Gerencia y Administrador</strong>: ven y hacen todo (los 3 departamentos, configuración y usuarios).{" "}
        <strong style={{ color: "var(--text)" }}>Comercial</strong>: Dpto. 1 (licitaciones, cotizaciones, ventas, facturación, clientes y catálogo).{" "}
        <strong style={{ color: "var(--text)" }}>Operativo</strong>: Dpto. 2 (ventas por ejecutar, compras, despachos, proveedores y catálogo).{" "}
        Los usuarios nuevos entran con una clave temporal y el sistema les pide crear la suya.
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
                  <td><div className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...u, password: "" })}>Editar</button>
                    {u.id !== yo.id && <button className="btn btn-ghost btn-sm" title="Genera una clave temporal nueva (y quita el bloqueo por intentos fallidos)"
                      onClick={async () => {
                        if (!(await confirmar(`¿Dar una clave temporal nueva a ${u.nombre}?\nLa anterior deja de servir.`, { titulo: "Nueva clave temporal", boton: "Generar clave" }))) return;
                        try { const r = await api(`/usuarios/${u.id}/clave-temporal`, { method: "POST" }); setClaves([{ ...r, estado: "nueva clave" }]); cargar(); }
                        catch (e) { notify(e.message, "danger"); }
                      }}>Nueva clave temporal</button>}
                  </div></td>
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
                {ROLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
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
      {claves && (
        <Modal titulo="// Usuarios del equipo" onClose={() => setClaves(null)} ancho={680}
          footer={<button className="btn btn-primary" onClick={() => setClaves(null)}>Listo, ya las anoté</button>}>
          <div className="aviso" style={{ marginBottom: 0 }}>Anota las claves temporales: se muestran solo esta vez. Al entrar, cada persona debe crear su propia contraseña.</div>
          <table className="table table-compacta">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Clave temporal</th></tr></thead>
            <tbody>{claves.map((c) => (
              <tr key={c.email}><td>{c.nombre}</td><td className="mini">{c.email}</td><td><span className={`rol-badge rol-${c.rol}`}>{c.rol}</span></td>
                <td>{c.clave ? <strong style={{ fontFamily: "var(--mono)", fontSize: 15 }}>{c.clave}</strong> : <span className="mini">{c.estado}</span>}</td></tr>
            ))}</tbody>
          </table>
        </Modal>
      )}
    </>
  );
}
