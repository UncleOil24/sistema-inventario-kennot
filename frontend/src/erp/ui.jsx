// Piezas compartidas por las vistas del ERP
import { useState, useMemo, useEffect } from "react";
import { fmt, fecha, hoyISO, sinTildes, imprimirPDF, descargarPost } from "./lib";

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
  cotizacion: ["Cotización", "info"],
  aceptada: ["Aceptada · venta", "ok"],
  rechazada: ["Rechazada", "muted"],
  vencida: ["Vencida", "warn"],
  convenio: ["Convenio", "info"],
  particular: ["Particular", "neutral"],
  web: ["Tienda web", "neutral"],
  proveedor: ["Proveedor", "info"],
  exacto: ["Exacto", "ok"],
  equivalente: ["Equivalente", "info"],
  parecido: ["Parecido", "warn"],
  sin_producto: ["Sin producto", "warn"],
  nuevo: ["Nuevo en catálogo", "info"],
  activo: ["Activo", "ok"],
  inactivo: ["Inactivo", "muted"],
  abierto: ["En curso", "info"],
  kenott: ["Kenott", "ok"],
  tactics: ["Tactics", "info"],
  cerrado: ["Terminado", "neutral"],
};
export function Estado({ valor }) {
  const [txt, tono] = ESTADOS[valor] || [valor, "neutral"];
  return <span className={`estado estado-${tono}`}>{txt}</span>;
}

// Editor de líneas: buscar producto, agregar, editar cantidad y precio.
// precioDe(producto) -> precio sugerido para la línea (venta según tipo de cliente, o compra)
export function ItemsEditor({ items, setItems, productos, precioDe, etiquetaPrecio = "Precio neto" }) {
  const [q, setQ] = useState("");
  const sugerencias = useMemo(() => {
    const palabras = sinTildes(q).trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    return productos
      .filter((p) => { const t = sinTildes(`${p.codigo ?? ""} ${p.nombre}`); return palabras.every((w) => t.includes(w)); })
      .filter((p) => !items.some((i) => i.producto_id === p.id))
      .slice(0, 10);
  }, [q, productos, items]);

  const agregar = (p) => {
    setItems([...items, { producto_id: p.id, nombre: p.nombre, unidad: p.unidad, cantidad: 1, precio: Number(precioDe(p)) || 0 }]);
    setQ("");
  };
  const set = (id, campo, val) => setItems(items.map((i) => (i.producto_id === id ? { ...i, [campo]: val } : i)));
  const subtotal = items.reduce((s, i) => s + Number(i.precio || 0) * Number(i.cantidad || 0), 0);

  return (
    <div className="items-editor">
      <div className="field" style={{ position: "relative" }}>
        <label>Agregar producto</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Palabras en cualquier orden o N°..." />
        {sugerencias.length > 0 && (
          <div className="sugerencias">
            {sugerencias.map((p) => (
              <button key={p.id} className="sugerencia" onClick={() => agregar(p)}>
                <span>{p.nombre}</span>
                <span className="sug-meta">{p.unidad} · {fmt(precioDe(p))}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table table-compacta">
            <thead><tr><th>Producto</th><th>Cant.</th><th>{etiquetaPrecio}</th><th>Total</th><th></th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.producto_id} className={!(Number(i.precio) > 0) ? "fila-alerta" : ""}>
                  <td>{i.nombre}<div className="mini">{i.unidad}{!(Number(i.precio) > 0) ? " — sin precio" : ""}</div></td>
                  <td><input className="qty-input" type="number" min="0" step="any" value={i.cantidad} onChange={(e) => set(i.producto_id, "cantidad", e.target.value)} /></td>
                  <td><input className="qty-input" style={{ width: 90 }} type="number" min="0" value={i.precio} onChange={(e) => set(i.producto_id, "precio", e.target.value)} /></td>
                  <td className="price-cell">{fmt(Number(i.precio) * Number(i.cantidad))}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => setItems(items.filter((x) => x.producto_id !== i.producto_id))}>✕</button></td>
                </tr>
              ))}
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
  const [form, setForm] = useState({ monto: Math.round(saldo), fecha: hoyISO(), medio: "transferencia", nota: "", factoring_entidad: "", factoring_comision: "" });
  const [enviando, setEnviando] = useState(false);
  const verbo = tipo === "cobro" ? "cobro" : "pago";

  const registrar = async () => {
    setEnviando(true);
    try { await onRegistrar({ ...form, monto: Number(form.monto), factoring_comision: Number(form.factoring_comision) || 0 }); }
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
                <td className="mini">{p.medio}{p.factoring_entidad ? ` ${p.factoring_entidad}` : ""}{Number(p.factoring_comision) > 0 ? ` · comisión ${fmt(p.factoring_comision)}` : ""}{p.nota ? ` · ${p.nota}` : ""}</td>
                <td className="price-cell">{fmt(p.monto)}</td>
                <td className="mini">{p.creado_por || ""}</td>
                <td>{onEliminar && <button className="btn btn-danger btn-sm" title={`Eliminar ${verbo}`} onClick={() => onEliminar(p)}>✕</button>}</td>
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
            {["transferencia", "efectivo", "cheque", "tarjeta", "vale vista", ...(tipo === "cobro" ? ["factoring"] : []), "otro"].map((m) => <option key={m}>{m}</option>)}
          </select>
          {form.medio === "factoring" && <>
            <input placeholder="Entidad de factoring" value={form.factoring_entidad} onChange={(e) => setForm({ ...form, factoring_entidad: e.target.value })} />
            <input type="number" placeholder="Comisión ($)" value={form.factoring_comision} onChange={(e) => setForm({ ...form, factoring_comision: e.target.value })} title="Queda como gasto financiero de la venta" />
          </>}
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

// Selector de producto para revisar un calce: candidatos propuestos + búsqueda en todo el catálogo
export function SelectorProducto({ valor, candidatos = [], productos, onChange, precioDe, permitirNinguno = true }) {
  const [buscando, setBuscando] = useState(false);
  const [q, setQ] = useState("");
  const sugerencias = useMemo(() => {
    const palabras = sinTildes(q).trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    return productos.filter((p) => { const t = sinTildes(`${p.codigo ?? ""} ${p.nombre}`); return palabras.every((w) => t.includes(w)); }).slice(0, 10);
  }, [q, productos]);
  const opciones = [...candidatos];
  if (valor && !opciones.some((c) => c.id === valor.id)) opciones.unshift(valor);

  if (buscando) {
    return (
      <div style={{ position: "relative", minWidth: 260 }}>
        <input autoFocus className="qty-input" style={{ width: "100%", textAlign: "left" }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar en el catálogo..." onBlur={() => setTimeout(() => setBuscando(false), 200)} />
        {sugerencias.length > 0 && (
          <div className="sugerencias">
            {sugerencias.map((p) => (
              <button key={p.id} className="sugerencia" onMouseDown={() => { onChange(p); setBuscando(false); setQ(""); }}>
                <span><span className="mini">{p.codigo}</span> {p.nombre}</span>
                {precioDe && <span className="sug-meta">{fmt(precioDe(p))}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 260 }}>
      <select className="select-linea" value={valor?.id || ""} onChange={(e) => {
        if (e.target.value === "__buscar") { setBuscando(true); return; }
        onChange(opciones.find((c) => String(c.id) === e.target.value) || null);
      }}>
        {permitirNinguno && <option value="">— Ninguno —</option>}
        {opciones.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ""}{c.nombre}</option>)}
        <option value="__buscar">🔍 Buscar otro...</option>
      </select>
    </div>
  );
}

// Recorrido de una venta (una OC = una venta)
export const ETAPAS_VENTA = [
  ["registrada", "Registrada", "Comercial la ingresó; falta que Operativo la acepte"],
  ["aceptada", "En compra", "Operativo la aceptó y está comprando"],
  ["lista", "Productos listos", "Llegó todo: lista para facturar y despachar"],
  ["despachada", "Despachada", "Salió hacia el cliente"],
  ["entregada", "Entregada", "El cliente la recibió"],
];
const TONO_ETAPA = { registrada: "warn", aceptada: "info", lista: "ok", despachada: "info", entregada: "neutral" };
const FACTURA = { sin_factura: ["Sin factura", "muted"], parcial: ["Factura parcial", "warn"], facturada: ["Facturada", "ok"] };
export function Etapa({ valor }) {
  const e = ETAPAS_VENTA.find(([k]) => k === valor);
  return <span className={`estado estado-${TONO_ETAPA[valor] || "neutral"}`} title={e?.[2]}>{e?.[1] || valor}</span>;
}
export function EstadoFactura({ valor }) {
  const [txt, tono] = FACTURA[valor] || [valor, "neutral"];
  return <span className={`estado estado-${tono}`}>{txt}</span>;
}
// Línea de pasos: registrada → en compra → listos → despachada → entregada
export function Recorrido({ etapa }) {
  const i = ETAPAS_VENTA.findIndex(([k]) => k === etapa);
  return (
    <div className="recorrido">
      {ETAPAS_VENTA.map(([k, t], n) => (
        <div key={k} className={`paso ${n < i ? "hecho" : n === i ? "actual" : ""}`} title={ETAPAS_VENTA[n][2]}>
          <span className="paso-num">{n < i ? "✓" : n + 1}</span>{t}
        </div>
      ))}
    </div>
  );
}

// Categoría del catálogo: lista desplegable con las existentes y opción de crear una nueva.
// (Antes era un campo con sugerencias que solo mostraba las que calzaban con lo escrito.)
export function SelectorCategoria({ value, onChange, categorias }) {
  const lista = (categorias || []).map((c) => c.categoria).filter(Boolean);
  const [nueva, setNueva] = useState(false);
  const enLista = lista.includes(value);
  if (nueva || (value && !enLista && lista.length)) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <input autoFocus style={{ flex: 1, minWidth: 0 }} value={value || ""} placeholder="Nueva categoría" onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNueva(false); onChange(""); }} title="Volver a la lista">Lista</button>
      </div>
    );
  }
  return (
    <select value={enLista ? value : ""} onChange={(e) => (e.target.value === "__nueva" ? (setNueva(true), onChange("")) : onChange(e.target.value))}>
      <option value="">— Elegir categoría —</option>
      {lista.map((c) => <option key={c} value={c}>{c}</option>)}
      <option value="__nueva">+ Nueva categoría…</option>
    </select>
  );
}

// --- Avisos del sistema (reemplazan confirm() y prompt() del navegador) -----------------------------
// Uso: if (!(await confirmar("¿Eliminar X?", { peligro: true, boton: "Eliminar" }))) return;
//      const motivo = await pedirTexto("¿Por qué se rechazó?", { placeholder: "precio, plazo..." }); // null = canceló
// Una sola ventana para todo el sistema; <Avisos /> se monta una vez en App.
let abrirAviso = null;
const mostrarAviso = (op) => new Promise((resolve) => {
  if (!abrirAviso) { resolve(op.texto ? window.prompt(op.mensaje, op.valor || "") : window.confirm(op.mensaje)); return; }
  abrirAviso({ ...op, resolve });
});
export const confirmar = (mensaje, opciones = {}) => mostrarAviso({ mensaje, ...opciones });
export const pedirTexto = (mensaje, opciones = {}) => mostrarAviso({ mensaje, texto: true, ...opciones });
// Elegir entre varias opciones: [{ valor, texto }] -> el valor elegido o null
export const elegir = (mensaje, eleccion, opciones = {}) => mostrarAviso({ mensaje, eleccion, ...opciones });

export function Avisos() {
  const [op, setOp] = useState(null);
  const [valor, setValor] = useState("");
  useEffect(() => { abrirAviso = (o) => { setValor(o.valor || ""); setOp(o); }; return () => { abrirAviso = null; }; }, []);
  if (!op) return null;
  const cerrar = (resultado) => { op.resolve(resultado); setOp(null); };
  if (op.eleccion) {
    return (
      <Modal titulo={`// ${op.titulo || "Elegir"}`} onClose={() => cerrar(null)} ancho={520}
        footer={<>
          <button className="btn btn-ghost" onClick={() => cerrar(null)}>Cancelar</button>
          {op.eleccion.map((o, k) => <button key={o.valor} className={`btn ${k === op.eleccion.length - 1 ? "btn-primary" : "btn-ghost"}`} onClick={() => cerrar(o.valor)}>{o.texto}</button>)}
        </>}>
        <div style={{ whiteSpace: "pre-line", fontSize: 14, lineHeight: 1.5 }}>{op.mensaje}</div>
      </Modal>
    );
  }
  const aceptar = () => {
    if (op.texto && op.obligatorio && !valor.trim()) return;
    cerrar(op.texto ? valor.trim() : true);
  };
  return (
    <Modal titulo={`// ${op.titulo || (op.texto ? "Indica el detalle" : "Confirmar")}`} onClose={() => cerrar(op.texto ? null : false)} ancho={520}
      footer={<>
        <button className="btn btn-ghost" onClick={() => cerrar(op.texto ? null : false)}>Cancelar</button>
        <button className={`btn ${op.peligro ? "btn-danger" : "btn-primary"}`} autoFocus={!op.texto} disabled={op.texto && op.obligatorio && !valor.trim()} onClick={aceptar}>{op.boton || "Aceptar"}</button>
      </>}>
      <div style={{ whiteSpace: "pre-line", fontSize: 14, lineHeight: 1.5 }}>{op.mensaje}</div>
      {op.texto && op.sugerencias && (
        <div className="chips" style={{ marginTop: 12 }}>
          {op.sugerencias.map((s) => <button key={s} type="button" className={`chip ${valor === s ? "activo" : ""}`} onClick={() => setValor(s)}>{s}</button>)}
          <button type="button" className={`chip ${valor && !op.sugerencias.includes(valor) ? "activo" : ""}`} onClick={() => { setValor(""); setTimeout(() => document.getElementById("aviso-texto")?.focus(), 0); }}>Otro…</button>
        </div>
      )}
      {op.texto && (
        <div className="field" style={{ marginTop: 12 }}>
          <input id="aviso-texto" autoFocus={!op.sugerencias} value={valor} placeholder={op.placeholder || ""} onChange={(e) => setValor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aceptar()} />
        </div>
      )}
    </Modal>
  );
}

// Motivo de rechazo de una cotización: opciones rápidas u "Otro" con texto
export const MOTIVOS_RECHAZO = ["Fuera de plazo", "Adj. a otro proveedor", "Eliminada"];
export const motivoRechazo = (nombre) => pedirTexto(`¿Por qué se rechazó la ${nombre}?`, {
  titulo: "Cotización rechazada", sugerencias: MOTIVOS_RECHAZO, placeholder: "Elige una opción o escribe otro motivo", boton: "Marcar rechazada", obligatorio: true,
});

// Pedido a proveedor: qué líneas incluir (si todas tienen precio, o ninguna, no se pregunta)
export const modoPedido = async (items) => {
  const tot = (items || []).length;
  const sin = (items || []).filter((i) => !(Number(i.costo) > 0)).length;
  if (!sin || sin === tot) return "todas";
  return elegir("¿Qué líneas van en el pedido?\nEl Excel sale sin nuestros valores, con una hoja General y una hoja por especialidad (pinturas, eléctrico, gasfitería...).",
    [{ valor: "todas", texto: `Todas las líneas (${tot})` }, { valor: "sin_precio", texto: `Solo sin precio (${sin})` }], { titulo: "Pedido a proveedor" });
};

// Reparto de una línea de factura entre ventas (la misma factura puede cubrir productos de varias ventas).
// l.ventas_pendientes: [{ venta_id, numero, cliente, falta }]; l.reparto: [{ venta_id | null, cantidad }]
export function RepartoLinea({ l, onChange }) {
  if (!l.producto || l.producto.id !== l.reparto_de) return null;
  const cands = [...(l.ventas_pendientes || [])];
  for (const r of l.reparto || []) if (r.venta_id && !cands.some((c) => c.venta_id === r.venta_id)) cands.push({ venta_id: r.venta_id, numero: `venta ${r.venta_id}`, falta: 0 });
  if (!cands.length) return <div className="mini" style={{ color: "var(--warn)" }}>Ninguna venta en curso lo necesita: queda como compra sin venta</div>;
  const cant = Number(l.cantidad) || 0;
  const de = (vid) => Number((l.reparto || []).find((r) => r.venta_id === vid)?.cantidad || 0);
  const suma = cands.reduce((s, c) => s + de(c.venta_id), 0);
  const sin = cant - suma;
  const cambiar = (vid, v) => {
    const otros = (l.reparto || []).filter((r) => r.venta_id !== vid && r.venta_id);
    onChange([...otros, { venta_id: vid, cantidad: Math.max(0, Number(v) || 0) }].filter((r) => r.cantidad > 0));
  };
  const sencillo = cands.length === 1 && de(cands[0].venta_id) === cant;
  return (
    <div className="mini reparto-linea">
      {sencillo ? <>→ {cands[0].numero}{cands[0].cliente ? ` · ${cands[0].cliente}` : ""}</> : <>
        <span>Para:</span>
        {cands.map((c) => (
          <label key={c.venta_id} title={c.cliente || ""}>{c.numero}{c.falta ? ` (falta ${c.falta})` : ""}
            <input type="number" min="0" className="qty-input" style={{ width: 56 }} value={de(c.venta_id)} onChange={(e) => cambiar(c.venta_id, e.target.value)} /></label>
        ))}
        {sin > 0 && <span>· sin venta: {sin}</span>}
        {sin < 0 && <span style={{ color: "var(--danger)" }}>· reparte {suma} y la línea trae {cant}</span>}
      </>}
    </div>
  );
}
// Reparto que se manda al registrar (lo que no se asignó queda sin venta)
export const repartoParaEnviar = (l) => {
  if (!l.producto || l.producto.id !== l.reparto_de || !(l.reparto || []).length) return undefined;
  const cant = Number(l.cantidad) || 0;
  const r = (l.reparto || []).filter((x) => Number(x.cantidad) > 0).map((x) => ({ venta_id: x.venta_id, cantidad: Number(x.cantidad) }));
  const suma = r.reduce((s, x) => s + x.cantidad, 0);
  if (suma > cant) return undefined;
  if (suma < cant) r.push({ venta_id: null, cantidad: cant - suma });
  return r;
};

// Solicitud de cotización a proveedores: imprimir directo, PDF o Excel (lineas: [{ venta_id, indice, cantidad? }])
export function BotonesSolicitud({ lineas, notify, sm = true, vacio = "Selecciona los productos para la solicitud de cotización" }) {
  const [abierto, setAbierto] = useState(false);
  const pedir = async (accion) => {
    const ls = typeof lineas === "function" ? lineas() : lineas;
    if (!ls.length) return notify(vacio, "danger");
    const p = accion === "imprimir" ? imprimirPDF("/ventas/solicitud-cotizacion", { lineas: ls })
      : descargarPost("/ventas/solicitud-cotizacion", { lineas: ls, formato: accion });
    p.catch((e) => notify(e.message, "danger"));
  };
  const c = `btn btn-ghost${sm ? " btn-sm" : ""}`;
  return !abierto
    ? <button className={c} title="Materiales, unidad y cantidad con el encabezado de la empresa, para pedir precio a proveedores" onClick={() => setAbierto(true)}>Solicitud de cotización ▸</button>
    : <span className="grupo-botones">
        <span className="mini">Solicitud de cotización:</span>
        <button className={c} onClick={() => pedir("imprimir")}>🖨 Imprimir</button>
        <button className={c} onClick={() => pedir("pdf")}>↓ PDF</button>
        <button className={c} onClick={() => pedir("excel")}>↓ Excel</button>
        <button className="link mini" onClick={() => setAbierto(false)}>✕</button>
      </span>;
}
