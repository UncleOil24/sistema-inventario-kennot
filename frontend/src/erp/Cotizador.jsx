import { useState, useMemo } from "react";
import { Totales, Estado } from "./ui";
import ImportarLista from "./ImportarLista";
import ControlPresupuesto from "./Presupuesto";
import { conConfirmacion } from "./Recorrido";
import { fmt, useProductos, precioSegun, sinTildes, descargar, lineaDesdeProducto, haceMeses, idCot, nombreCot } from "./lib";

// Identificador de la línea: el producto, o una clave para las que no están en catálogo
const idL = (i) => (i.producto_id ? `p${i.producto_id}` : `c${i.clave}`);
const CASOS = { mismo: ["Mismo producto", ""], similar: ["Similar", "fila-similar"], nuevo: ["No está en catálogo", "fila-nuevo"] };
const PLAZO_DEFECTO = "02 días hábiles una vez aceptada la propuesta y emitida la orden de compra";

// Cotizador: arma la cotización con nuestros precios según el tipo de cliente.
// borrador: { id?, numero?, cliente_id, tipo_precio, nombre_cotizacion, validez_dias, notas, items }
export default function Cotizador({ borrador, setBorrador, clientes, esAdmin, notify, onGuardada, irAClientes }) {
  const productos = useProductos();
  const [q, setQ] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [importar, setImportar] = useState(false);
  const [asociando, setAsociando] = useState(null); // línea "no está en catálogo" a la que se le busca producto
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
  const esGeneral = cliente?.codigo === "P-001";
  const elegirCliente = (id) => {
    const c = clientes.find((x) => String(x.id) === String(id));
    const nuevoTipo = c?.tipo || "convenio";
    setBorrador((b) => {
      // El ID impreso sigue al cliente, salvo que se haya escrito otro (p.ej. el de la solicitud de Mercado Público)
      const anterior = clientes.find((x) => String(x.id) === String(b.cliente_id));
      const idAuto = !b.id_solicitud || b.id_solicitud === anterior?.codigo;
      return {
      ...b, cliente_id: id, tipo_precio: nuevoTipo,
      id_solicitud: idAuto ? (c && c.codigo !== "P-001" ? c.codigo || "" : "") : b.id_solicitud,
      items: b.items.map((i) => (i.auto ? { ...i, precio: nuevoTipo === "particular" ? i.particular : i.convenio } : i)),
      };
    });
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
    if (asociando) {
      // La línea roja pasa a cotizarse con este producto (similar): se mantiene lo que pidió el cliente
      setItems((l) => l.map((i) => (idL(i) === asociando ? {
        ...lineaDesdeProducto(p, tipo), cantidad: i.cantidad, grupo: i.grupo, descripcion_cliente: i.descripcion_cliente, caso: "similar",
        nota_interna: `Cotizado con similar: ${p.nombre}`,
      } : i)));
      setAsociando(null);
      setQ("");
      return;
    }
    setItems((l) => [...l, { ...lineaDesdeProducto(p, tipo), caso: "mismo" }]);
    setQ("");
  };
  // Línea que no está en catálogo (rojo): la descripción del cliente y el precio a mano
  const agregarNoEsta = () => {
    const desc = q.trim();
    if (!desc) { notify("Escribe arriba lo que pidió el cliente", "danger"); return; }
    setItems((l) => [...l, { producto_id: null, clave: `n${Date.now()}`, nombre: desc, descripcion_cliente: desc, unidad: "UNIDAD", cantidad: 1, precio: "", costo: 0, caso: "nuevo", auto: false }]);
    setQ("");
  };
  const setLinea = (id, campo, val) => setItems((l) => l.map((i) => (idL(i) === id ? { ...i, [campo]: val, ...(campo === "precio" ? { auto: false } : {}) } : i)));
  const restaurarPrecio = (id) => setItems((l) => l.map((i) => (idL(i) === id ? { ...i, precio: tipo === "particular" ? i.particular : i.convenio, auto: true } : i)));

  const subtotal = items.reduce((s, i) => s + Number(i.precio || 0) * Number(i.cantidad || 0), 0);
  const costo = items.reduce((s, i) => s + Number(i.costo || 0) * Number(i.cantidad || 0), 0);
  // Margen solo de las líneas con costo (las que no están en catálogo aún no tienen compra)
  const ventaConCosto = items.filter((i) => Number(i.costo) > 0).reduce((s, i) => s + Number(i.precio || 0) * Number(i.cantidad || 0), 0);
  const sinCosto = items.filter((i) => !(Number(i.costo) > 0)).length;
  const margen = ventaConCosto - costo;
  const sinPrecio = items.filter((i) => !(Number(i.precio) > 0)).length;
  const antiguos = items.filter((i) => i.precio_antiguo).length;

  const limpiar = () => setBorrador((b) => ({ empresa: b.empresa || "kenott", cliente_id: "", tipo_precio: "convenio", nombre_cotizacion: "", validez_dias: 30, notas: "", id_solicitud: "", plazo_entrega: "", cliente_nombre_doc: "", presupuesto: null, lugar_entrega: "", items: [] }));
  const empresa = borrador.empresa || "kenott";

  // Líneas que vienen de la lista del cliente (leída por Claude y revisada)
  const agregarLista = (nuevas, res) => {
    setBorrador((b) => {
      const lista = [...b.items];
      for (const n of nuevas) {
        const previa = n.producto_id && lista.find((i) => i.producto_id === n.producto_id);
        if (previa) Object.assign(previa, { cantidad: Number(previa.cantidad) + Number(n.cantidad) });
        else lista.push(n);
      }
      return { ...b, items: lista, archivo_cliente: res.archivo, nombre_cotizacion: b.nombre_cotizacion || (res.cliente ? `Lista ${res.cliente}` : "") };
    });
    setImportar(false);
    notify(`✓ ${nuevas.length} líneas agregadas desde la lista del cliente`);
  };

  const guardar = async (estadoPedido, salida = null) => {
    if (!items.length) return;
    // Una cotización ya enviada que se corrige sigue enviada al "Guardar"
    const estado = estadoPedido === "borrador" && borrador.estado === "cotizacion" ? "cotizacion" : estadoPedido;
    if (sinPrecio && estado === "cotizacion" && !confirm(`${sinPrecio} línea(s) sin precio. ¿Guardar igual?`)) return;
    if (estado === "cotizacion" && !String(borrador.id_solicitud || "").trim() && !confirm("La cotización va sin ID (del cliente o de la solicitud). ¿Guardar igual?")) return;
    if (esGeneral && !String(borrador.cliente_nombre_doc || "").trim()) { notify("Cliente general: escribe el nombre que va en esta cotización", "danger"); return; }
    setGuardando(true);
    try {
      const body = {
        cliente_id: borrador.cliente_id ? Number(borrador.cliente_id) : null,
        ...(esGeneral ? { cliente: borrador.cliente_nombre_doc.trim() } : {}),
        id_solicitud: String(borrador.id_solicitud || "").trim() || null,
        plazo_entrega: String(borrador.plazo_entrega || "").trim() || null,
        tipo_precio: tipo,
        empresa,
        nombre_cotizacion: borrador.nombre_cotizacion || undefined,
        validez_dias: Number(borrador.validez_dias) || 30,
        notas: borrador.notas || null,
        archivo_cliente: borrador.archivo_cliente || null,
        estado,
        presupuesto: borrador.presupuesto || null,
        lugar_entrega: borrador.lugar_entrega || null,
        items: items.map((i) => ({
          producto_id: i.producto_id || null, clave: i.clave || null, caso: i.caso || "mismo", cantidad: Number(i.cantidad),
          precio: i.precio === "" ? null : Number(i.precio), descripcion_cliente: i.descripcion_cliente || null, grupo: i.grupo || null,
          nota_interna: i.nota_interna || null, unidad: i.unidad,
        })),
      };
      // Si la otra empresa ya cotizó este proceso, el servidor avisa (art. 60) y se pide confirmación
      const cot = borrador.id
        ? await conConfirmacion(`/cotizaciones/${borrador.id}`, body, "PUT")
        : await conConfirmacion("/cotizaciones", body);
      if (salida === "pedido-proveedor") await descargar(`/cotizaciones/${cot.id}/pedido-proveedor`, `Pedido_cotizacion_${idCot(cot)}.xlsx`);
      else if (salida) await descargar(`/cotizaciones/${cot.id}/${salida}`, `${idCot(cot)}${cot.anterior ? "_anterior" : ""}-${cot.cliente || "cliente"}.${salida === "excel" ? "xlsx" : "pdf"}`);
      const que = { borrador: "guardada (En ejecución)", espera_proveedor: "guardada en Esperando proveedor · Excel del pedido descargado", cotizacion: "finalizada (Enviadas)" }[estado];
      notify(`✓ ${nombreCot(cot)} ${que}${salida && salida !== "pedido-proveedor" ? ` · ${salida === "excel" ? "Excel" : "PDF"} descargado` : ""}`);
      limpiar();
      onGuardada?.(cot);
    } catch (e) { if (!e.cancelado) notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };
  const grupos = (borrador.presupuesto?.grupos || []).filter((g) => g.nombre);
  const sinCostoTodas = items.filter((i) => !(Number(i.costo) > 0)).length;

  return (
    <>
      {(borrador.id || items.length > 0) && (
        <div className="franja-edicion">
          <span>✎ {borrador.id ? `Editando ${nombreCot({ ...borrador, empresa: borrador.empresa_original || empresa })}` : "Cotización nueva en preparación (el número se asigna al guardar)"}</span>
          {((esGeneral ? borrador.cliente_nombre_doc : cliente?.nombre) || borrador.cliente_nombre_doc) && <span>· {(esGeneral ? borrador.cliente_nombre_doc : cliente?.nombre) || borrador.cliente_nombre_doc}</span>}
          {borrador.id_solicitud && <span>· ID {borrador.id_solicitud}</span>}
          {borrador.creado_por && <span>· por {borrador.creado_por}</span>}
          <span>· {items.length} línea(s)</span>
          <button className="link" onClick={() => { if (confirm(borrador.id ? "¿Salir sin guardar los cambios? La cotización guardada no se pierde." : "¿Descartar esta cotización nueva? Se pierden las líneas.")) limpiar(); }}>{borrador.id ? "Salir sin guardar" : "Descartar"}</button>
        </div>
      )}
      <div className={`panel ${borrador.id || items.length ? "panel-cotizando" : ""}`}>
        <div className="field">
          <label>Cotiza la empresa</label>
          <div className="chips">
            {[["kenott", "Inversiones Kenott"], ["tactics", "Tactics Inversiones"]].map(([v, t]) => (
              <button key={v} className={`chip ${empresa === v ? "activo" : ""}`} disabled={borrador.anterior && v !== borrador.empresa_original} onClick={() => set({ empresa: v })}>{empresa === v ? "● " : ""}{t}</button>
            ))}
            <span className="mini" style={{ alignSelf: "center" }}>El PDF y el Excel salen con los datos, el formato y la numeración de esa empresa.{borrador.id && borrador.empresa_original && borrador.empresa_original !== empresa ? " Al guardar recibe un número nuevo de esa empresa." : ""}</span>
          </div>
        </div>
        <div className="fields-row tres">
          <div className="field">
            <label>Cliente</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={borrador.cliente_id || ""} onChange={(e) => elegirCliente(e.target.value)}>
                <option value="">— Seleccionar cliente —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ""}{c.nombre}</option>)}
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
        {esGeneral && (
          <div className="field">
            <label>Nombre del cliente en esta cotización</label>
            <input value={borrador.cliente_nombre_doc || ""} onChange={(e) => set({ cliente_nombre_doc: e.target.value })} placeholder="Ej: Juan Pérez (solo para este documento, no se crea un cliente)" />
          </div>
        )}
        <div className="fields-row">
          <div className="field">
            <label>ID del cliente o de la solicitud</label>
            <input value={borrador.id_solicitud || ""} onChange={(e) => set({ id_solicitud: e.target.value })} placeholder={cliente?.codigo && !esGeneral ? cliente.codigo : "Ej: 1422-20-COT26"} />
            <div className="mini">Se imprime en la cotización y queda en la venta y sus compras.</div>
          </div>
          <div className="field">
            <label>Plazo de entrega</label>
            <input value={borrador.plazo_entrega || ""} onChange={(e) => set({ plazo_entrega: e.target.value })} placeholder={PLAZO_DEFECTO} />
            <div className="mini">Vacío = el de Configuración. Va en las condiciones comerciales.</div>
          </div>
        </div>
        <div className="field">
          <label>Lugar de entrega (opcional, se imprime)</label>
          <input value={borrador.lugar_entrega || ""} onChange={(e) => set({ lugar_entrega: e.target.value })} placeholder="Ej: Bodega municipal, Linares" />
        </div>
        <div className="field">
          <label>{empresa === "tactics" ? "Proyecto" : "Descripción"} (se imprime)</label>
          <input value={borrador.nombre_cotizacion} onChange={(e) => set({ nombre_cotizacion: e.target.value })} placeholder="Ej: Materiales mantención Liceo Laura Urrutia" />
        </div>
        {cliente?.estado_credito === "suspendido" && <div className="aviso">⚠ {cliente.nombre} tiene el crédito suspendido (deuda vencida). Se puede cotizar, pero al registrar la venta el sistema pedirá confirmación.</div>}
        {!cliente && <div className="mini">Sin cliente se usa precio convenio. Si es institución, usa convenio; en duda, convenio.</div>}
      </div>

      {/* El documento del cliente se sube solo al comenzar: después no se reemplaza lo ya armado */}
      {items.length === 0 ? (
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <button className="btn btn-ghost" onClick={() => setImportar(true)}>⇪ Subir lista del cliente (Excel, PDF, Word o foto)</button>
        </div>
      ) : borrador.archivo_cliente && <div className="mini" style={{ marginBottom: 8 }}>Lista del cliente: {borrador.archivo_cliente}</div>}
      <div className="field" style={{ position: "relative", marginBottom: "1rem" }}>
        <label>Agregar producto</label>
        {asociando && <div className="aviso">Buscando el producto nuestro para "{items.find((i) => idL(i) === asociando)?.descripcion_cliente}": elige uno de la lista. <button className="link" onClick={() => setAsociando(null)}>Cancelar</button></div>}
        <div style={{ display: "flex", gap: 6 }}>
          <input className="search-input" style={{ paddingLeft: 12 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder='Palabras en cualquier orden o N°. Ej: "cemento 25", "1416"' />
          {!asociando && q.trim() && <button className="btn btn-ghost btn-sm" title="Agrega lo escrito como línea que no está en el catálogo (en rojo), con precio a mano" onClick={agregarNoEsta}>+ No está en catálogo</button>}
        </div>
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
                <th>N°</th><th>Producto</th>{grupos.length > 0 && <th>Grupo</th>}<th>Cant.</th><th>Precio venta</th><th>Total</th>
                {esAdmin && <th>Costo</th>}{esAdmin && <th>Margen</th>}<th></th>
              </tr></thead>
              <tbody>
                {items.map((i) => {
                  const k = idL(i);
                  const m = (Number(i.precio) - Number(i.costo || 0)) * Number(i.cantidad);
                  const mp = Number(i.precio) ? Math.round(((Number(i.precio) - Number(i.costo || 0)) / Number(i.precio)) * 100) : 0;
                  const caso = i.caso || "mismo";
                  return (
                    <tr key={k} className={CASOS[caso]?.[1] || (!(Number(i.precio) > 0) ? "fila-alerta" : "")}>
                      <td className="id-cell">{i.codigo ?? ""}</td>
                      <td>
                        <input className="desc-cliente" value={i.descripcion_cliente || ""} placeholder={i.nombre} title="Se imprime en la cotización (lo que pidió el cliente)"
                          onChange={(e) => setLinea(k, "descripcion_cliente", e.target.value)} />
                        <div className="mini">
                          {caso === "nuevo"
                            ? <><strong style={{ color: "var(--danger)" }}>No está en catálogo</strong> · precio a mano · <button className="link" onClick={() => { setAsociando(k); setQ(i.descripcion_cliente || ""); }}>buscar producto similar</button></>
                            : <>
                              <select className="caso-select" value={caso} onChange={(e) => setLinea(k, "caso", e.target.value)}>
                                <option value="mismo">Mismo</option><option value="similar">Similar</option>
                              </select>
                              {" "}nuestro: {i.nombre} · {i.unidad}{esAdmin && i.proveedor ? ` · ${i.proveedor}` : ""}
                              {i.precio_antiguo && <span className="antiguo"> · ⏱ precio {haceMeses(i.fecha_precio)}</span>}
                            </>}
                        </div>
                        {caso !== "mismo" && <input className="desc-cliente nota" value={i.nota_interna || ""} placeholder="Nota interna (no se imprime)" onChange={(e) => setLinea(k, "nota_interna", e.target.value)} />}
                      </td>
                      {grupos.length > 0 && <td>
                        <select className="filter-select" style={{ minWidth: 110 }} value={i.grupo || ""} onChange={(e) => setLinea(k, "grupo", e.target.value)}>
                          <option value="">—</option>{grupos.map((g) => <option key={g.nombre}>{g.nombre}</option>)}
                        </select>
                      </td>}
                      <td><input className="qty-input" type="number" min="0" step="any" value={i.cantidad} onChange={(e) => setLinea(k, "cantidad", e.target.value)} /></td>
                      <td>
                        <input className="qty-input" style={{ width: 96 }} type="number" min="0" value={i.precio} placeholder="a mano" onChange={(e) => setLinea(k, "precio", e.target.value)} />
                        {!i.auto && i.producto_id && <button className="link" title="Volver al precio calculado" onClick={() => restaurarPrecio(k)}>↺</button>}
                      </td>
                      <td className="price-cell">{fmt(Number(i.precio || 0) * Number(i.cantidad))}</td>
                      {esAdmin && <td className="price-cell compra">{i.costo ? fmt(i.costo) : "—"}</td>}
                      {esAdmin && <td className="mini" style={{ color: m < 0 ? "var(--danger)" : undefined }}>{i.costo ? `${fmt(m)} · ${mp}%` : "—"}</td>}
                      <td><button className="btn btn-danger btn-sm" onClick={() => setItems((l) => l.filter((x) => idL(x) !== k))}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ControlPresupuesto presupuesto={borrador.presupuesto} setPresupuesto={(p) => set({ presupuesto: p })} items={items} setItems={setItems} verCostos={esAdmin} />
          <div className="dash-grid" style={{ marginTop: 12 }}>
            <Totales subtotal={subtotal} />
            {esAdmin && (
              <div className="cot-totals" style={{ marginBottom: 0 }}>
                <div className="total-row"><span className="total-label">Costo (compra)</span><span className="total-value">{fmt(costo)}</span></div>
                <div className="total-row"><span className="total-label">Margen bruto</span><span className="total-value">{fmt(margen)}</span></div>
                <hr className="divider" />
                <div className="total-row grand"><span className="total-label">Margen %</span><span className="total-value">{ventaConCosto ? Math.round((margen / ventaConCosto) * 100) : 0}%</span></div>
                {sinCosto > 0 && <div className="mini">{sinCosto} línea(s) sin costo no cuentan en el margen.</div>}
                <div className="mini">Interno: no se imprime en la cotización. <Estado valor={tipo} /></div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="toolbar" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
        {guardando && <span className="mini"><span className="spinner"></span>Guardando...</span>}
        <button className="btn btn-ghost" title="Queda en Cotizaciones → En ejecución para seguir después" onClick={() => guardar("borrador")} disabled={!items.length || guardando}>Guardar</button>
        <button className="btn btn-ghost" title={`Descarga un Excel con las ${sinCostoTodas} línea(s) sin precio para enviar al proveedor. Queda en Esperando proveedor.`} onClick={() => guardar("espera_proveedor", "pedido-proveedor")} disabled={!items.length || guardando}>Pedir cotización a proveedor{sinCostoTodas ? ` (${sinCostoTodas})` : ""}</button>
        <button className="btn btn-ghost" title="Queda en Enviadas" onClick={() => guardar("cotizacion", "excel")} disabled={!items.length || guardando}>Finalizar + Excel</button>
        <button className="btn btn-primary" title="Queda en Enviadas" onClick={() => guardar("cotizacion", "pdf")} disabled={!items.length || guardando}>Finalizar + PDF</button>
      </div>
      {importar && <ImportarLista tipo={tipo} esAdmin={esAdmin} notify={notify} onClose={() => setImportar(false)} onAgregar={agregarLista} />}
    </>
  );
}
