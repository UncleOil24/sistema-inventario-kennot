import { useState } from "react";
import { api, setToken } from "./lib";

export default function Login({ onEntrar, aviso }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(aviso || "");
  const [cargando, setCargando] = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    setError("");
    setCargando(true);
    try {
      const { token, usuario } = await api("/auth/login", { method: "POST", body: { email, password } });
      setToken(token);
      onEntrar(usuario);
    } catch (err) {
      setError(err.message === "Failed to fetch" ? "No se pudo conectar con el servidor. Intenta de nuevo en unos segundos." : err.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={entrar}>
        <div className="header-brand" style={{ justifyContent: "center", marginBottom: 6 }}>
          <span>▣</span> INVENTARIO <span>/</span> KENNOT
        </div>
        <div className="mini" style={{ textAlign: "center", marginBottom: 18 }}>Inicia sesión para continuar</div>
        <div className="field">
          <label>Email</label>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.cl" required autoFocus />
        </div>
        <div className="field">
          <label>Contraseña</label>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={cargando} style={{ justifyContent: "center", marginTop: 6 }}>
          {cargando ? <><span className="spinner"></span>Entrando...</> : "Entrar"}
        </button>
        <div className="mini" style={{ textAlign: "center", marginTop: 8 }}>¿Olvidaste tu contraseña? Pídele al administrador que la restablezca.</div>
      </form>
    </div>
  );
}
