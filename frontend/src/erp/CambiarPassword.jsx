import { useState } from "react";
import { Modal } from "./ui";
import { api, setToken } from "./lib";

export default function CambiarPassword({ notify, onClose }) {
  const [f, setF] = useState({ actual: "", nueva: "", repetir: "" });
  const [guardando, setGuardando] = useState(false);
  const noCoinciden = f.repetir && f.nueva !== f.repetir;

  const guardar = async () => {
    setGuardando(true);
    try {
      const { token } = await api("/auth/cambiar-password", { method: "POST", body: { actual: f.actual, nueva: f.nueva } });
      setToken(token);
      notify("✓ Contraseña cambiada. Se cerraron tus otras sesiones.");
      onClose();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  return (
    <Modal titulo="// Cambiar contraseña" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar}
          disabled={guardando || !f.actual || f.nueva.length < 8 || f.nueva !== f.repetir}>
          {guardando ? "Guardando..." : "Cambiar"}
        </button>
      </>}>
      <div className="field">
        <label>Contraseña actual</label>
        <input type="password" autoComplete="current-password" value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} />
      </div>
      <div className="field">
        <label>Nueva contraseña (mínimo 8 caracteres)</label>
        <input type="password" autoComplete="new-password" value={f.nueva} onChange={(e) => setF({ ...f, nueva: e.target.value })} />
      </div>
      <div className="field">
        <label>Repetir nueva contraseña</label>
        <input type="password" autoComplete="new-password" value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })} />
      </div>
      {noCoinciden && <div className="mini stock-low">Las contraseñas no coinciden</div>}
    </Modal>
  );
}
