import { useState } from "react";
import { Modal, Estado, SelectorProducto } from "./ui";
import { fmt, subirArchivo, useProductos, precioSegun, lineaDesdeProducto } from "./lib";

// Sube la lista del cliente (Excel, PDF, Word o foto), Claude calza cada línea con el catálogo
// y aquí se revisa antes de agregarla a la cotización. Los precios los pone el sistema.
export default function ImportarLista({ tipo, notify, onClose, onAgregar }) {
  const productos = useProductos();
  const [archivo, setArchivo] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [res, setRes] = useState(null);
  const [lineas, setLineas] = useState([]);

  const leer = async () => {
    if (!archivo) return;
    setLeyendo(true);
    try {
      const r = await subirArchivo("/ia/lista-cliente", archivo);
      setRes(r);
      setLineas(r.lineas.map((l, i) => ({ ...l, i, incluir: !!l.producto })));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLeyendo(false); }
  };

  const set = (i, cambios) => setLineas((ls) => ls.map((l) => (l.i === i ? { ...l, ...cambios } : l)));
  const elegidas = lineas.filter((l) => l.incluir && l.producto);
  const revisar = lineas.filter((l) => l.calce === "parecido" || l.calce === "sin_producto" || (l.producto && !(precioSegun(l.producto, tipo) > 0))).length;

  const agregar = () => {
    // Si el cliente pidió el mismo producto en dos líneas, se suman las cantidades
    const porProducto = new Map();
    for (const l of elegidas) {
      const previa = porProducto.get(l.producto.id);
      if (previa) { previa.cantidad += Number(l.cantidad) || 0; previa.descripcion_cliente += ` / ${l.descripcion}`; continue; }
      porProducto.set(l.producto.id, { ...lineaDesdeProducto(l.producto, tipo), cantidad: Number(l.cantidad) || 1, descripcion_cliente: l.descripcion });
    }
    onAgregar([...porProducto.values()], res);
  };

  return (
    <Modal titulo="// Cotizar lista del cliente" onClose={onClose} ancho={1150}
      footer={res ? <>
        <span className="mini" style={{ marginRight: "auto" }}>{elegidas.length} de {lineas.length} líneas se agregarán{revisar ? ` · ${revisar} para revisar (en amarillo)` : ""}</span>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!elegidas.length} onClick={agregar}>Agregar a la cotización</button>
      </> : <>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!archivo || leyendo} onClick={leer}>{leyendo ? <><span className="spinner"></span>Leyendo con Claude...</> : "Leer lista"}</button>
      </>}>
      {!res ? (
        <>
          <div className="mini">Sube la lista tal como la mandó el cliente: Excel, PDF, Word o una foto. Claude lee cada línea y propone el producto de nuestro catálogo; tú revisas antes de agregar. Puede tardar unos segundos por cada 30 líneas.</div>
          <input type="file" accept=".xlsx,.xlsm,.pdf,.docx,.csv,.txt,.jpg,.jpeg,.png,.webp" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
          {leyendo && <div className="aviso" style={{ marginBottom: 0 }}>Leyendo el archivo y buscando cada producto en el catálogo...</div>}
        </>
      ) : (
        <>
          <div className="hist-meta">
            <span>{res.archivo}</span>
            {res.cliente && <span>Cliente en el documento: <strong>{res.cliente}</strong></span>}
            {res.observaciones && <span>{res.observaciones}</span>}
            <Estado valor={tipo} />
          </div>
          {res.truncado && <div className="aviso">El documento es muy largo y la lectura pudo quedar incompleta: revisa que estén todas las líneas.</div>}
          <div className="table-wrap">
            <table className="table table-compacta">
              <thead><tr><th></th><th>Lo que pidió el cliente</th><th>Cant.</th><th>Calce</th><th className="col-desc">Producto nuestro</th><th>Precio</th><th>Total</th></tr></thead>
              <tbody>
                {lineas.map((l) => {
                  const precio = l.producto ? precioSegun(l.producto, tipo) : 0;
                  const alerta = l.calce === "parecido" || l.calce === "sin_producto" || (l.producto && !(precio > 0));
                  return (
                    <tr key={l.i} className={alerta ? "fila-alerta" : ""}>
                      <td><input type="checkbox" checked={l.incluir} disabled={!l.producto} onChange={(e) => set(l.i, { incluir: e.target.checked })} /></td>
                      <td>{l.descripcion}{l.unidad && <div className="mini">{l.unidad}</div>}</td>
                      <td><input className="qty-input" type="number" min="0" step="any" value={l.cantidad} onChange={(e) => set(l.i, { cantidad: e.target.value })} /></td>
                      <td><Estado valor={l.calce} />{l.nota && <div className="mini" style={{ maxWidth: 200 }}>{l.nota}</div>}</td>
                      <td>
                        <SelectorProducto valor={l.producto} candidatos={l.candidatos} productos={productos} precioDe={(p) => precioSegun(p, tipo)}
                          onChange={(p) => set(l.i, { producto: p, incluir: !!p, calce: p ? (p.id === l.producto?.id ? l.calce : "exacto") : "sin_producto", nota: p && p.id !== l.producto?.id ? "Elegido a mano" : l.nota })} />
                        {l.producto && <div className="mini">{l.producto.unidad}</div>}
                      </td>
                      <td className="price-cell">{l.producto ? (precio > 0 ? fmt(precio) : "sin precio") : "—"}</td>
                      <td className="price-cell">{precio > 0 ? fmt(precio * Number(l.cantidad || 0)) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mini">Las líneas sin producto no se agregan: créalas en el Catálogo (como producto aparte) o cotízalas a mano.</div>
        </>
      )}
    </Modal>
  );
}
