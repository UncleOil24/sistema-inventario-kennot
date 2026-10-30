import { useState, useMemo } from "react";
import { Totales, Estado } from "./ui";
import ImportarLista from "./ImportarLista";
import { api, fmt, useProductos, precioSegun, sinTildes, descargar, lineaDesdeProducto, haceMeses } from "./lib";

// Cotizador: arma la cotización con nuestros precios según el tipo de cliente.
// borrador: { id?, numero?, cliente_id, tipo_precio, nombre_cotizacion, validez_dias, notas, items }
export default function Cotizador({ borrador, setBorrador, clientes, esAdmin, notify, onGuardada, irAClientes }) {
  const productos = useProductos();
  const [q, setQ] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [importar, setImportar] = useState(false);
  const { items } = borrador;
  const cliente = clientes.find((c) => String(c.id) === String(borrador.cliente_id));
  const tipo = borrador.tipo_precio || cliente?.tipo || "convenio";

  const set = (cambios) => setBorrador((b) => ({ ...b, ...cambios }));
  const setItems = (fn) => setBorrador((b) => ({ ...b, items: typeof fn === "function" ? fn(b.items) : fn }));

  // Cambiar el tipo de precio recalcula las líneas que no se corrigieron a mano
  const cambiarTipo = (nuevo) => {
    setBorrador((b) => ({
      ...b, tipo_precio: nuevo,
      items: b.items.map((i) => (i.auto ? { ...i, precio: nuevo === "particular" ? i.particular : i.convenio } : i)),
    }));
  };
  const elegirCliente = (id) => {
    const c = clientes.find((x) => String(x.id) === String(id));
    const nuevoTipo = c?.tipo || "convenio";
    setBorrador((b) => ({
      ...b, cliente_id: id, tipo_precio: nuevoTipo,
      items: b.items.map((i) => (i.auto ? { ...i, precio: nuevoTipo === "particular" ? i.particular : i.convenio } : i)),
    }));
  };

  const sugerencias = useMemo(() => {
    const palabras = sinTildes(q).trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    return productos
      .filter((p) => { const t = sinTildes(`${p.codigo ?? ""} ${p.nombre}`); return palabras.every((w) => t.includes(w)); })
      .slice(0, 12);
  }, [q, productos]);

  const agregar = (p) => {
    if (items.some((i) => i.producto_id === p.id)) { notify("Ya está en la cotización"); return; }
    setItems((l) => [...l, lineaDesdeProducto(p, tipo)]);
    setQ("");
  };
  const setLinea = (id, campo, val) => setItems((l) => l.map((i) => (i.producto_id === id ? { ...i, [campo]: val, ...(campo === "precio" ? { auto: false } : {}) } : i)));
  const restaurarPrecio = (id) => setItems((l) => l.map((i) => (i.producto_id === id ? { ...i, precio: tipo === "particular" ? i.particular : i.convenio, auto: true } : i)));

  const subtotal = items.reduce((s, i) => s + Number(i.precio || 0) * Number(i.cantidad || 0), 0);
  const costo = items.reduce((s, i) => s + Number(i.costo || 0) * Number(i.cantidad || 0), 0);
  const margen = subtotal - costo;
  const sinPrecio = items.filter((i) => !(Number(i.precio) > 0)).length;
  const antiguos = items.filter((i) => i.precio_antiguo).length;

  const limpiar = () => setBorrador({ cliente_id: "", tipo_precio: "convenio", nombre_cotizacion: "", validez_dias: 30, notas: "", items: [] });

  // Líneas que vienen de la lista del cliente (leída por Claude y revisada)
  const agregarLista = (nuevas, res) => {
    setBorrador((b) => {
      const lista = [...b.items];
      for (const n of nuevas) {
        const previa = lista.find((i) => i.producto_id === n.producto_id);
        if (previa) Object.assign(previa, { cantidad: Number(previa.cantidad) + Number(n.cantidad) });
        else lista.push(n);
      }
      return { ...b, items: lista, archivo_cliente: res.archivo, nombre_cotizacion: b.nombre_cotizacion || (res.cliente ? `Lista ${res.cliente}` : "") };
    });
    setImportar(false);
    notify(`✓ ${nuevas.length} líneas agregadas desde la lista del cliente`);
  };

  const guardar = async (estado, salida = null) => {
    if (!items.length) return;
    if (sinPrecio && estado !== "borrador" && !confirm(`${sinPrecio} línea(s) sin precio. ¿Guardar igual?`)) return;
    setGuardando(true);
    try {
      const body = {
        cliente_id: borrador.cliente_id ? Number(borrador.cliente_id) : null,
        tipo_precio: tipo,
        nombre_cotizacion: borrador.nombre_cotizacion || undefined,
        validez_dias: Number(borrador.validez_dias) || 30,
        notas: borrador.notas || null,
        archivo_cliente: borrador.archivo_cliente || null,
        estado,
        items: items.map((i) => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad), precio: Number(i.precio), descripcion_cliente: i.descripcion_cliente || null })),
      };
      const cot = borrador.id
        ? await api(`/cotizaciones/${borrador.id}`, { method: "PUT", body })
        : await api("/cotizaciones", { method: "POST", body });
      if (salida) await descargar(`/cotizaciones/${cot.id}/${salida}`, `COT-${cot.numero}-${cot.cliente || "cliente"}.${salida === "excel" ? "xlsx" : "pdf"}`);
      notify(`✓ Cotización N° ${cot.numero} ${estado === "borrador" ? "guardada como borrador" : "guardada"}${salida ? ` · ${salida === "excel" ? "Excel" : "PDF"} descargado` : ""}`);
      limpiar();
      onGuardada?.(cot);
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };

  return (
    <>
      {borrador.id && <div className="aviso">Editando la cotización N° {borrador.numero}. <button className="link" onClick={limpiar}>Cancelar edición</button></div>}
      <div className="panel">
        <div className="fields-row tres">
          <div className="field">
            <label>Cliente</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={borrador.cliente_id || ""} onChange={(e) => elegirCliente(e.target.value)}>
                <option value="">— Seleccionar cliente —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <button className="btn btn-ghost btn-sm" title="Nuevo cliente" onClick={irAClientes}>+</button>
            </div>
          </div>
          <div className="field">
            <label>Tipo de precio</label>
            <select value={tipo} onChange={(e) => cambiarTipo(e.target.value)}>
              <option value="convenio">Convenio (instituciones)</option>
              <option value="particular">Particular</option>
            </select>
          </div>
          <div className="field">
            <label>Validez (días)</label>
            <input type="number" min="1" value={borrador.validez_dias} onChange={(e) => set({ validez_dias: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Nombre de la cotización</label>
          <input value={borrador.nombre_cotizacion} onChange={(e) => set({ nombre_cotizacion: e.target.value })} placeholder="Ej: Materiales mantención Liceo Laura Urrutia" />
        </div>
        {!cliente && <div className="mini">Sin cliente se usa precio convenio. Si es institución, usa convenio; en duda, convenio.</div>}
      </div>

      <div className="toolbar" style={{ marginBottom: 8 }}>
        <button className="btn btn-ghost" onClick={() => setImportar(true)}>⇪ Subir lista del cliente (Excel, PDF, Word o foto)</button>
        {borrador.archivo_cliente && <span className="mini">Lista: {borrador.archivo_cliente}</span>}
      </div>
      <div className="field" style={{ position: "relative", marginBottom: "1rem" }}>
        <label>Agregar producto</label>
        <input className="search-input" style={{ paddingLeft: 12 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder='Palabras en cualquier orden o N°. Ej: "cemento 25", "1416"' />
        {sugerencias.length > 0 && (
          <div className="sugerencias">
            {sugerencias.map((p) => {
              const precio = precioSegun(p, tipo);
              return (
                <button key={p.id} className="sugerencia" onClick={() => agregar(p)}>
                  <span><span className="mini">{p.codigo}</span> {p.nombre}</span>
                  <span className="sug-meta">{p.unidad} · {precio ? fmt(precio) : "sin precio"}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="cot-empty">// cotización vacía — busca productos arriba o agrégalos desde el Catálogo</div>
      ) : (
        <>
          {sinPrecio > 0 && <div className="aviso">{sinPrecio} línea(s) sin precio (en amarillo): ingresa el precio a mano o pide cotización al proveedor.</div>}
          {antiguos > 0 && <div className="aviso">⏱ {antiguos} línea(s) con precio de compra antiguo: conviene confirmar el precio con el proveedor antes de enviar.</div>}
          <div className="table-wrap" style={{ marginBottom: "1rem" }}>
            <table className="table table-compacta">
              <thead><tr>
                <th>N°</th><th>Producto</th><th>Cant.</th><th>Precio venta</th><th>Total</th>
                {esAdmin && <th>Costo</th>}{esAdmin && <th>Margen</th>}<th></th>
              </tr></thead>
              <tbody>
                {items.map((i) => {
                  const m = (Number(i.precio) - Number(i.costo || 0)) * Number(i.cantidad);
                  const mp = Number(i.precio) ? Math.round(((Number(i.precio) - Number(i.costo || 0)) / Number(i.precio)) * 100) : 0;
                  return (
                    <tr key={i.producto_id} className={!(Number(i.precio) > 0) ? "fila-alerta" : ""}>
                      <td className="id-cell">{i.codigo ?? ""}</td>
                      <td>{i.nombre}<div className="mini">{i.unidad}{esAdmin && i.proveedor ? ` · ${i.proveedor}` : ""}{i.descripcion_cliente ? ` · cliente: "${i.descripcion_cliente}"` : ""}{i.precio_antiguo && <span className="antiguo"> · ⏱ precio {haceMeses(i.fecha_precio)}</span>}</div></td>
                      <td><input className="qty-input" type="number" min="0" step="any" value={i.cantidad} onChange={(e) => setLinea(i.producto_id, "cantidad", e.target.value)} /></td>
                      <td>
                        <input className="qty-input" style={{ width: 96 }} type="number" min="0" value={i.precio} onChange={(e) => setLinea(i.producto_id, "precio", e.target.value)} />
                        {!i.auto && <button className="link" title="Volver al precio calculado" onClick={() => restaurarPrecio(i.producto_id)}>↺</button>}
                      </td>
                      <td className="price-cell">{fmt(Number(i.precio) * Number(i.cantidad))}</td>
                      {esAdmin && <td className="price-cell compra">{i.costo ? fmt(i.costo) : "—"}</td>}
                      {esAdmin && <td className="mini" style={{ color: m < 0 ? "var(--danger)" : undefined }}>{fmt(m)} · {mp}%</td>}
                      <td><button className="btn btn-danger btn-sm" onClick={() => setItems((l) => l.filter((x) => x.producto_id !== i.producto_id))}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="dash-grid">
            <Totales subtotal={subtotal} />
            {esAdmin && (
              <div className="cot-totals" style={{ marginBottom: 0 }}>
                <div className="total-row"><span className="total-label">Costo (compra)</span><span className="total-value">{fmt(costo)}</span></div>
                <div className="total-row"><span className="total-label">Margen bruto</span><span className="total-value">{fmt(margen)}</span></div>
                <hr className="divider" />
                <div className="total-row grand"><span className="total-label">Margen %</span><span className="total-value">{subtotal ? Math.round((margen / subtotal) * 100) : 0}%</span></div>
                <div className="mini">Interno: no se imprime en la cotización. <Estado valor={tipo} /></div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="toolbar" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={limpiar} disabled={guardando}>Limpiar</button>
        <button className="btn btn-ghost" onClick={() => guardar("borrador")} disabled={!items.length || guardando}>Guardar borrador</button>
        <button className="btn btn-ghost" onClick={() => guardar("cotizacion")} disabled={!items.length || guardando}>Guardar cotización</button>
        <button className="btn btn-ghost" onClick={() => guardar("cotizacion", "excel")} disabled={!items.length || guardando}>Guardar + Excel</button>
        <button className="btn btn-primary" onClick={() => guardar("cotizacion", "pdf")} disabled={!items.length || guardando}>
          {guardando ? <><span className="spinner"></span>Guardando...</> : "Guardar y descargar PDF"}
        </button>
      </div>
      {importar && <ImportarLista tipo={tipo} notify={notify} onClose={() => setImportar(false)} onAgregar={agregarLista} />}
    </>
  );
}
