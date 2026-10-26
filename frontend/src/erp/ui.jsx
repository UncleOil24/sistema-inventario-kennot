// Piezas compartidas por las vistas del ERP
import { useState, useMemo } from "react";
import { fmt, fecha, hoyISO } from "./lib";

export function Modal({ titulo, onClose, children, footer, ancho = 480 }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: ancho }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{titulo}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

const ESTADOS = {
  borrador: ["Borrador", "neutral"],
  recibida: ["Recibida", "ok"],
  emitida: ["Emitida", "ok"],
  anulada: ["Anulada", "muted"],
  pendiente: ["Pendiente", "warn"],
  parcial: ["Pago parcial", "info"],
  pagada: ["Pagada", "ok"],
  vendida: ["Vendida", "ok"],
};
export function Estado({ valor }) {
  const [txt, tono] = ESTADOS[valor] || [valor, "neutral"];
  return <span className={`estado estado-${tono}`}>{txt}</span>;
}

// Editor de líneas: buscar producto, agregar, editar cantidad y precio.
// campoPrecio: "precio_venta" (ventas) o "precio_compra" (compras)
export function ItemsEditor({ items, setItems, productos, campoPrecio, mostrarStock = true }) {
  const [q, setQ] = useState("");
  const sugerencias = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return productos
      .filter((p) => p.nombre.toLowerCase().includes(t) || String(p.id) === t)
      .filter((p) => !items.some((i) => i.producto_id === p.id))
      .slice(0, 8);
  }, [q, productos, items]);

  const agregar = (p) => {
    setItems([...items, {
      producto_id: p.id, nombre: p.nombre, unidad: p.unidad, stock: p.stock,
      cantidad: 1, precio: Number(p[campoPrecio]) || 0,
    }]);
    setQ("");
  };
  const set = (id, campo, val) => setItems(items.map((i) => (i.producto_id === id ? { ...i, [campo]: val } : i)));
  const subtotal = items.reduce((s, i) => s + Number(i.precio || 0) * Number(i.cantidad || 0), 0);

  return (
    <div className="items-editor">
      <div className="field" style={{ position: "relative" }}>
        <label>Agregar producto</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe nombre o ID..." />
        {sugerencias.length > 0 && (
          <div className="sugerencias">
            {sugerencias.map((p) => (
              <button key={p.id} className="sugerencia" onClick={() => agregar(p)}>
                <span>{p.nombre}</span>
                <span className="sug-meta">stock {p.stock} · {fmt(p[campoPrecio])}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table table-compacta">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Precio neto</th><th>Total</th><th></th></tr></thead>
            <tbody>
              {items.map((i) => {
                const sinStock = mostrarStock && Number(i.cantidad) > Number(i.stock);
                return (
                  <tr key={i.producto_id}>
                    <td>
                      {i.nombre}
                      {mostrarStock && <div className={`mini ${sinStock ? "stock-low" : ""}`}>stock: {i.stock}{sinStock ? " — insuficiente" : ""}</div>}
                    </td>
                    <td><input className="qty-input" type="number" min="1" value={i.cantidad} onChange={(e) => set(i.producto_id, "cantidad", e.target.value)} /></td>
                    <td><input className="qty-input" style={{ width: 90 }} type="number" min="0" value={i.precio} onChange={(e) => set(i.producto_id, "precio", e.target.value)} /></td>
                    <td className="price-cell">{fmt(Number(i.precio) * Number(i.cantidad))}</td>
                    <td><button className="btn btn-danger btn-sm" onClick={() => setItems(items.filter((x) => x.producto_id !== i.producto_id))}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Totales subtotal={subtotal} />
    </div>
  );
}

export function Totales({ subtotal, iva, total }) {
  const s = Number(subtotal) || 0;
  const i = iva ?? Math.round(s * 0.19);
  const t = total ?? s + i;
  return (
    <div className="cot-totals" style={{ marginBottom: 0 }}>
      <div className="total-row"><span className="total-label">Neto</span><span className="total-value">{fmt(s)}</span></div>
      <div className="total-row"><span className="total-label">IVA (19%)</span><span className="total-value">{fmt(i)}</span></div>
      <hr className="divider" />
      <div className="total-row grand"><span className="total-label">Total</span><span className="total-value">{fmt(t)}</span></div>
    </div>
  );
}

// Lista de pagos/cobros + formulario para registrar uno nuevo
export function PagosPanel({ doc, tipo, onRegistrar, onEliminar }) {
  const saldo = Number(doc.total) - Number(doc.monto_pagado);
  const [form, setForm] = useState({ monto: Math.round(saldo), fecha: hoyISO(), medio: "transferencia", nota: "" });
  const [enviando, setEnviando] = useState(false);
  const verbo = tipo === "cobro" ? "cobro" : "pago";

  const registrar = async () => {
    setEnviando(true);
    try { await onRegistrar({ ...form, monto: Number(form.monto) }); }
    finally { setEnviando(false); }
  };

  return (
    <div className="panel">
      <div className="panel-titulo">
        {tipo === "cobro" ? "Cobros" : "Pagos"} · saldo <strong style={{ color: saldo > 0 ? "var(--accent)" : "var(--success)" }}>{fmt(saldo)}</strong>
      </div>
      {(doc.pagos || []).length === 0 ? (
        <div className="mini">Sin {verbo}s registrados</div>
      ) : (
        <table className="table table-compacta">
          <tbody>
            {doc.pagos.map((p) => (
              <tr key={p.id}>
                <td className="mini">{fecha(p.fecha)}</td>
                <td className="mini">{p.medio}{p.nota ? ` · ${p.nota}` : ""}</td>
                <td className="price-cell">{fmt(p.monto)}</td>
                <td><button className="btn btn-danger btn-sm" title={`Eliminar ${verbo}`} onClick={() => onEliminar(p)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {doc.estado !== "anulada" && saldo > 0.5 && (
        <div className="pago-form">
          <input type="number" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} title="Monto" />
          <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
          <select value={form.medio} onChange={(e) => setForm({ ...form, medio: e.target.value })}>
            {["transferencia", "efectivo", "cheque", "tarjeta", "otro"].map((m) => <option key={m}>{m}</option>)}
          </select>
          <button className="btn btn-success btn-sm" disabled={enviando || !(Number(form.monto) > 0)} onClick={registrar}>
            + Registrar {verbo}
          </button>
        </div>
      )}
    </div>
  );
}

export function Cargando() {
  return <div className="cot-empty"><span className="spinner"></span>Cargando...</div>;
}
