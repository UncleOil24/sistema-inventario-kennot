// Si una pantalla falla, se muestra un aviso en vez de dejar todo en blanco
import { Component } from "react";

export default class ErrorPantalla extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("Error en pantalla:", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const traductor = /removeChild|insertBefore|not a child/i.test(String(this.state.error?.message));
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ maxWidth: 480 }}>
          <div className="panel-titulo">Algo falló en esta pantalla</div>
          <div className="mini">{traductor
            ? "Parece que el traductor automático del navegador modificó la página. Desactiva la traducción para este sitio (ícono de traducir en la barra de dirección → \"Nunca traducir\") y vuelve a cargar."
            : "Vuelve a cargar la página. Si se repite, avísale al administrador con una foto de este mensaje."}</div>
          <div className="mini" style={{ fontFamily: "var(--mono)", opacity: 0.7 }}>{String(this.state.error?.message || "").slice(0, 200)}</div>
          <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={() => window.location.reload()}>Volver a cargar</button>
        </div>
      </div>
    );
  }
}
