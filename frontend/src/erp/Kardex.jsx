import { useState, useEffect } from "react";
import { Modal, Cargando } from "./ui";
import { api, fmt } from "./lib";

const ORIGEN = {
  compra: "Compra", venta: "Venta", anulacion_venta: "Anulación venta", anulacion_compra: "Anulación compra",
  ajuste: "Ajuste", inicial: "Stock inicial",
};

// Historial de movimientos de un producto + ajuste por conteo físico
export default function Kardex({ producto, notify, onClose, onAjustado }) {
  const [movs, setMovs] = useState(null);
  const [stockReal, setStockReal] = useState(producto.stock);
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = () => api(`/productos/${producto.id}/movimientos`).then(setMovs).catch((e) => notify(e.message, "danger"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [producto.id]);

  const ajustar = async () => {
    setGuardando(true);
    try {
      await api(`/productos/${producto.id}/ajuste`, { method: "POST", body: { stock_real: Number(stockReal), nota } });
      notify("✓ Stock ajustado");
      setNota("");
      cargar();
      onAjustado();
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  const diferencia = Number(stockReal) - Number(producto.stock);

  return (
    <Modal titulo={`// Kardex · ${producto.nombre}`} onClose={onClose} ancho={720}>
      <div className="panel">
        <div className="panel-titulo">Ajustar por conteo físico <span className="mini">(stock en sistema: {producto.stock})</span></div>
        <div className="pago-form">
          <input type="number" min="0" value={stockReal} onChange={(e) => setStockReal(e.target.value)} title="Stock real contado" />
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo (merma, conteo, rotura...)" style={{ flex: 2 }} />
          <button className="btn btn-success btn-sm" disabled={guardando || diferencia === 0 || stockReal === ""} onClick={ajustar}>
            Ajustar {diferencia !== 0 && !Number.isNaN(diferencia) ? `(${diferencia > 0 ? "+" : ""}${diferencia})` : ""}
          </button>
        </div>
      </div>
      {!movs ? <Cargando /> : movs.length === 0 ? (
        <div className="mini">Sin movimientos registrados todavía. Los productos creados antes del ERP empiezan su historial desde ahora.</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
          <table className="table table-compacta">
            <thead><tr><th>Fecha</th><th>Origen</th><th>Mov.</th><th>Saldo</th><th>Costo</th><th>Nota</th></tr></thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id}>
                  <td className="mini">{new Date(m.createdAt).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td>{ORIGEN[m.referencia_tipo] || m.tipo} {m.referencia_numero && <span className="id-cell">{m.referencia_numero}</span>}</td>
                  <td className={`stock-cell ${m.cantidad < 0 ? "stock-low" : "stock-ok"}`}>{m.cantidad > 0 ? "+" : ""}{m.cantidad}</td>
                  <td className="stock-cell">{m.stock_resultante}</td>
                  <td className="price-cell compra">{m.costo_unitario != null ? fmt(m.costo_unitario) : "—"}</td>
                  <td className="mini">{m.nota || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
