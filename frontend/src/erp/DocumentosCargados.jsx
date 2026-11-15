import { useState, useEffect } from "react";
import { Modal, Cargando } from "./ui";
import { api, fmt, fecha } from "./lib";

// Últimos documentos de proveedores cargados al catálogo: para no volver a subir uno que ya está.
// Incluye los anteriores a este registro, armados desde el historial de precios (proveedor, N° y fecha).
export default function DocumentosCargados({ notify, onClose }) {
  const [lista, setLista] = useState(null);
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api(`/ia/documentos-cargados${q ? `?q=${encodeURIComponent(q)}` : ""}`).then(setLista).catch((e) => notify(e.message, "danger"));
    }, 250);
    return () => clearTimeout(t);
  }, [q, notify]);

  const ver = async (d) => {
    try {
      const r = d.tipo === "registrado"
        ? await api(`/ia/documentos-cargados/detalle?id=${d.id}`)
        : await api(`/ia/documentos-cargados/detalle?proveedor=${encodeURIComponent(d.proveedor)}&documento=${encodeURIComponent(d.documento)}&fecha=${String(d.fecha).slice(0, 10)}`);
      setAbierto({ ...d, lineas: r.lineas || [] });
    } catch (e) { notify(e.message, "danger"); }
  };

  return (
    <Modal titulo="// Documentos de proveedores cargados" onClose={onClose} ancho={1000}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <input className="search-input" placeholder="Buscar por proveedor, N° de documento o archivo..." value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
      {!lista ? <Cargando /> : !lista.length ? <div className="cot-empty">// sin documentos cargados</div> : (
        <table className="table table-compacta">
          <thead><tr><th>Subido</th><th>Proveedor</th><th>N° documento</th><th>Fecha doc.</th><th>Productos</th><th>Cambió</th><th>Por</th><th></th></tr></thead>
          <tbody>
            {lista.map((d, k) => (
              <tr key={`${d.tipo}${d.id || k}`}>
                <td className="mini">{d.subido ? new Date(d.subido).toLocaleDateString("es-CL") : "—"}</td>
                <td>{d.proveedor}{d.archivo && <div className="mini">{d.archivo}</div>}</td>
                <td className="mini">{d.documento || "—"}</td>
                <td className="mini">{d.fecha ? fecha(d.fecha) : "—"}</td>
                <td className="mini">{d.productos}</td>
                <td className="mini">{d.cambios == null ? "—" : `${d.cambios} precio(s)`}</td>
                <td className="mini">{d.usuario || "—"}{d.tipo === "historial" && <div title="Cargado antes de este registro: armado desde el historial de precios">(historial)</div>}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => ver(d)}>Ver</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {abierto && (
        <Modal titulo={`// ${abierto.proveedor} · ${abierto.documento || "sin N°"}`} onClose={() => setAbierto(null)} ancho={760}
          footer={<button className="btn btn-ghost" onClick={() => setAbierto(null)}>Cerrar</button>}>
          <table className="table table-compacta">
            <thead><tr><th>N°</th><th>Producto</th><th>Precio</th><th>Antes</th></tr></thead>
            <tbody>
              {abierto.lineas.map((l, k) => (
                <tr key={k}><td className="mini">{l.codigo}</td><td>{l.nombre}{l.descripcion_proveedor && <div className="mini">{l.descripcion_proveedor}</div>}</td>
                  <td className="price-cell compra">{fmt(l.precio)}</td><td className="mini">{l.antes != null ? fmt(l.antes) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </Modal>
  );
}
