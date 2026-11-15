import { useState, useEffect, useMemo } from "react";
import { Modal, Cargando, confirmar, BotonesSolicitud } from "./ui";
import { api, fmt, descargarPost, imprimirHTML, escaparHTML as h } from "./lib";

// Agrupar compras de varias ventas (Operativo): se configura antes de imprimir o descargar.
// - Ordenar por proveedor (juntando ventas) o por venta
// - Incluir lo que falta comprar, lo pedido sin recibir, o ambos
// - Elegir el proveedor de cada producto y crear las órdenes solo de los proveedores que se marquen
// (una orden por venta y proveedor, para que cada compra siga cargada a su venta)
const SIN = "SIN PROVEEDOR";
const TXT = { por_comprar: "Por comprar", parcial: "Parcial", pedido: "Pedido" };

export default function AgruparCompras({ notify, onClose, onCreadas }) {
  const [data, setData] = useState(null);
  const [orden, setOrden] = useState("proveedor");
  const [incluir, setIncluir] = useState("falta");
  const [ventasSel, setVentasSel] = useState(new Set());
  const [prov, setProv] = useState({}); // "ventaId:indice" -> proveedor elegido aquí
  const [crear, setCrear] = useState(null); // Set de proveedores para crear órdenes
  const [ocupado, setOcupado] = useState(false);

  const cargar = async () => {
    try {
      const d = await api("/ventas/agrupar/datos");
      setData(d); setVentasSel(new Set(d.ventas.map((v) => v.id))); setProv({});
    } catch (e) { notify(e.message, "danger"); onClose(); }
  };
  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Filas según la configuración: lo que falta (editable) y lo pedido sin recibir (solo informativo)
  const filas = useMemo(() => {
    if (!data) return [];
    const out = [];
    for (const v of data.ventas) {
      if (!ventasSel.has(v.id)) continue;
      for (const l of v.lineas) {
        const base = { venta_id: v.id, venta: v.numero, cliente: v.cliente, indice: l.indice, producto_id: l.producto_id, codigo: l.codigo, nombre: l.nombre, unidad: l.unidad, opciones: l.opciones, no_vino: l.no_vino };
        if (incluir !== "pedido" && l.falta > 0) {
          const p = prov[`${v.id}:${l.indice}`] || l.proveedor;
          const op = l.opciones.find((o) => o.proveedor === p);
          out.push({ ...base, clave: `${v.id}:${l.indice}`, editable: true, cantidad: l.falta, estado: l.estado === "parcial" ? "parcial" : "por_comprar",
            proveedor: p, precio: op ? op.precio : l.compra_unit, ordenes: [] });
        }
        if (incluir !== "falta" && l.pedido > 0) {
          out.push({ ...base, clave: `${v.id}:${l.indice}:p`, editable: false, cantidad: l.pedido, estado: "pedido", proveedor: l.proveedor, precio: l.compra_unit, ordenes: l.ordenes });
        }
      }
    }
    return out;
  }, [data, ventasSel, incluir, prov]);

  const grupos = useMemo(() => {
    const m = new Map();
    for (const f of filas) {
      const k = orden === "venta" ? `${f.venta}${f.cliente ? ` · ${f.cliente}` : ""}` : f.proveedor;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(f);
    }
    const total = (ls) => ls.reduce((s, f) => s + Number(f.precio || 0) * Number(f.cantidad), 0);
    return [...m.entries()].map(([k, ls]) => ({ k, ls, total: total(ls) }))
      .sort((a, b) => (orden === "venta" ? a.k.localeCompare(b.k) : (a.k === SIN) - (b.k === SIN) || b.total - a.total));
  }, [filas, orden]);

  if (!data) return <Modal titulo="// Agrupar compras" onClose={onClose}><Cargando /></Modal>;

  const toggleVenta = (id) => setVentasSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cambiar = (f, valor) => {
    let p = valor;
    if (valor === "__otro") { p = window.prompt("Proveedor:", "") || ""; if (!p.trim()) return; }
    setProv((x) => ({ ...x, [f.clave]: p.trim().toUpperCase() }));
  };
  const paraArchivo = () => filas.map((f) => ({ venta: f.venta, cliente: f.cliente, producto_id: f.producto_id, codigo: f.codigo, nombre: f.nombre, unidad: f.unidad,
    cantidad: f.cantidad, proveedor: f.proveedor, precio: f.precio, estado: f.estado, ordenes: f.ordenes }));

  const excel = () => {
    if (!filas.length) return notify("No hay productos con esta configuración", "danger");
    descargarPost("/ventas/agrupar/excel", { orden, lineas: paraArchivo() }).catch((e) => notify(e.message, "danger"));
  };

  const imprimir = () => {
    if (!filas.length) return notify("No hay productos con esta configuración", "danger");
    const porVenta = orden === "venta";
    const cuerpo = `<h1>Compras agrupadas por ${porVenta ? "venta" : "proveedor"}</h1>
      <div class="sub">${incluir === "falta" ? "Lo que falta comprar" : incluir === "pedido" ? "Lo pedido sin recibir" : "Lo que falta comprar y lo pedido sin recibir"} · ${ventasSel.size} venta(s) · impreso el ${new Date().toLocaleDateString("es-CL")}</div>
      ${grupos.map((g) => {
        // Por proveedor: el mismo producto de varias ventas va en una fila con la cantidad sumada
        let ls = g.ls;
        if (!porVenta) {
          const m = new Map();
          for (const f of g.ls) {
            const k = `${f.producto_id || f.nombre}|${f.estado === "pedido" ? "p" : "f"}`;
            const x = m.get(k) || { ...f, cantidad: 0, detalle: [] };
            x.cantidad += Number(f.cantidad); x.detalle.push(`${f.venta}: ${f.cantidad}`); m.set(k, x);
          }
          ls = [...m.values()].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        }
        return `<div class="grupo"><h2><span>${h(g.k === SIN ? "Sin proveedor elegido" : g.k)}</span><span>${ls.length} prod. · ${fmt(g.total)}</span></h2>
        <table><colgroup><col style="width:18px"><col><col style="width:40px"><col style="width:40px"><col style="width:62px"><col style="width:22%"><col style="width:70px"><col style="width:78px"><col style="width:80px"></colgroup><thead><tr><th class="chk"></th><th>Producto</th><th>N°</th><th class="num">Cant.</th><th>Unidad</th><th>${porVenta ? "Proveedor" : "De qué ventas"}</th><th class="num">Precio unit.</th><th class="num">Total</th><th>Estado</th></tr></thead><tbody>
        ${ls.map((f) => `<tr><td class="chk">☐</td><td>${h(f.nombre)}${f.no_vino ? `<div class="aviso">no vino en ${h(f.no_vino.orden)}</div>` : ""}</td><td>${h(f.codigo || "")}</td><td class="num">${f.cantidad}</td><td>${h(f.unidad || "")}</td>
          <td>${h(porVenta ? f.proveedor : f.detalle.join(" · "))}</td><td class="num">${f.precio > 0 ? fmt(f.precio) : "sin precio"}</td><td class="num">${fmt(Number(f.precio || 0) * f.cantidad)}</td>
          <td>${TXT[f.estado] || f.estado}${f.ordenes?.length ? `<div class="mini">${h(f.ordenes.join(", "))}</div>` : ""}</td></tr>`).join("")}
        </tbody></table></div>`;
      }).join("")}
      <div class="pie">Total: <strong>${fmt(grupos.reduce((s, g) => s + g.total, 0))}</strong> neto · ${filas.length} línea(s)</div>`;
    imprimirHTML("Compras agrupadas", cuerpo);
  };


  // Proveedores con productos por comprar (para crear sus órdenes)
  const provsFalta = [...new Set(filas.filter((f) => f.editable && f.estado === "por_comprar" && f.proveedor !== SIN).map((f) => f.proveedor))].sort();
  const crearOrdenes = async () => {
    const lineas = filas.filter((f) => f.editable && f.estado === "por_comprar" && crear.has(f.proveedor)).map((f) => ({ venta_id: f.venta_id, indice: f.indice, proveedor: f.proveedor }));
    if (!lineas.length) return notify("Marca al menos un proveedor", "danger");
    if (!(await confirmar(`Se crearán las órdenes (borrador) de ${[...crear].join(", ")}: una por venta y proveedor, con ${lineas.length} producto(s).\nEl proveedor elegido queda en el cuadro de compra de cada venta.`, { titulo: "Crear órdenes", boton: "Crear órdenes" }))) return;
    setOcupado(true);
    try {
      const r = await api("/ventas/agrupar/ordenes", { method: "POST", body: { lineas } });
      notify(`✓ ${r.creadas.length} orden(es) creada(s): ${r.creadas.map((o) => `${o.numero} ${o.proveedor}`).join(" · ")}`);
      setCrear(null); onCreadas?.(); await cargar();
    } catch (e) { notify(e.message, "danger"); }
    setOcupado(false);
  };

  return (
    <Modal titulo="// Agrupar compras de varias ventas" onClose={onClose} ancho={1250}
      footer={<>
        <button className="btn btn-ghost" onClick={imprimir}>🖨 Imprimir</button>
        <button className="btn btn-ghost" onClick={excel}>↓ Excel</button>
        <BotonesSolicitud notify={notify} sm={false} vacio="No hay productos con esta configuración" lineas={() => filas.map((f) => ({ venta_id: f.venta_id, indice: f.indice, cantidad: f.cantidad }))} />
        <button className="btn btn-primary" disabled={!provsFalta.length || ocupado} onClick={() => setCrear(new Set())}>Crear órdenes…</button>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="panel">
        <div className="fields-row tres">
          <div className="field"><label>Ordenar por</label>
            <div className="chips">{[["proveedor", "Proveedor (junta ventas)"], ["venta", "Venta"]].map(([v, t]) => <button key={v} className={`chip ${orden === v ? "activo" : ""}`} onClick={() => setOrden(v)}>{t}</button>)}</div></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>Incluir</label>
            <div className="chips">{[["falta", "Lo que falta comprar"], ["pedido", "Lo pedido sin recibir"], ["ambos", "Ambos"]].map(([v, t]) => <button key={v} className={`chip ${incluir === v ? "activo" : ""}`} onClick={() => setIncluir(v)}>{t}</button>)}</div></div>
        </div>
        <div className="field"><label>Ventas ({ventasSel.size} de {data.ventas.length}) · <button className="link mini" onClick={() => setVentasSel(new Set(data.ventas.map((v) => v.id)))}>todas</button> · <button className="link mini" onClick={() => setVentasSel(new Set())}>ninguna</button></label>
          <div className="chips">{data.ventas.map((v) => <button key={v.id} className={`chip ${ventasSel.has(v.id) ? "activo" : ""}`} onClick={() => toggleVenta(v.id)}>{v.numero} · {v.cliente || "Sin cliente"} · {v.lineas.length}</button>)}</div>
          {!data.ventas.length && <div className="mini">// no hay ventas con productos por comprar o pedidos sin recibir</div>}
        </div>
      </div>

      {crear && (
        <div className="panel barra-seleccion" style={{ flexWrap: "wrap" }}>
          <strong>Crear órdenes de:</strong>
          {provsFalta.map((p) => (
            <label key={p} className="chip" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={crear.has(p)} onChange={() => setCrear((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; })} /> {p}
              <span className="mini"> · {filas.filter((f) => f.editable && f.estado === "por_comprar" && f.proveedor === p).length} prod.</span>
            </label>
          ))}
          <button className="btn btn-primary btn-sm" disabled={ocupado || !crear.size} onClick={crearOrdenes}>{ocupado ? "Creando..." : "Crear"}</button>
          <button className="link mini" onClick={() => setCrear(null)}>Cancelar</button>
          <div className="mini" style={{ width: "100%" }}>Solo lo que falta comprar. Lo que el proveedor no tenga, cámbialo antes a otro proveedor o créale la orden después.</div>
        </div>
      )}

      {!filas.length ? <div className="cot-empty">// nada con esta configuración</div> : grupos.map((g) => (
        <div key={g.k} className="panel" style={{ marginBottom: 10 }}>
          <div className="panel-titulo" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{g.k === SIN ? "Sin proveedor elegido" : g.k}</span><span className="mini">{g.ls.length} línea(s) · {fmt(g.total)}</span>
          </div>
          <table className="table table-compacta">
            <thead><tr><th>Venta</th><th className="col-desc">Producto</th><th>Cant.</th><th>Comprar con</th><th>Precio unit.</th><th>Total</th><th>Estado</th></tr></thead>
            <tbody>
              {g.ls.map((f) => (
                <tr key={f.clave}>
                  <td className="mini">{f.venta}<div>{f.cliente}</div></td>
                  <td>{f.nombre}<div className="mini">{f.codigo ? `N° ${f.codigo}` : ""}{f.no_vino ? <span style={{ color: "var(--danger)" }}> · no vino en {f.no_vino.orden} ({f.no_vino.proveedor})</span> : ""}</div></td>
                  <td className="mini">{f.cantidad} {f.unidad}</td>
                  <td>{f.editable ? (
                    <select className="select-linea" style={{ minWidth: 170 }} value={f.proveedor} onChange={(e) => cambiar(f, e.target.value)}>
                      {!f.opciones.some((o) => o.proveedor === f.proveedor) && <option value={f.proveedor}>{f.proveedor === SIN ? "— Elegir —" : f.proveedor}</option>}
                      {f.opciones.map((o, k) => <option key={o.proveedor} value={o.proveedor}>{o.proveedor} · {fmt(o.precio)}{k === 0 ? " ★" : ""}</option>)}
                      <option value="__otro">Otro proveedor…</option>
                    </select>) : <span className="mini">{f.proveedor}</span>}
                  </td>
                  <td className="price-cell compra">{f.precio > 0 ? fmt(f.precio) : "sin precio"}</td>
                  <td className="price-cell compra">{fmt(Number(f.precio || 0) * f.cantidad)}</td>
                  <td><span className={`estado estado-${f.estado === "pedido" ? "info" : "warn"}`}>{TXT[f.estado]}</span>{f.ordenes.length > 0 && <div className="mini">{f.ordenes.join(", ")}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="mini">El proveedor que elijas aquí se usa para imprimir, el Excel y las órdenes. Queda guardado en la venta solo cuando creas su orden. ★ = más barato.</div>
    </Modal>
  );
}
