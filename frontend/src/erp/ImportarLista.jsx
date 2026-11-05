import { useState, useEffect } from "react";
import { Modal, Estado, SelectorProducto } from "./ui";
import { api, fmt, subirArchivo, useProductos, precioSegun, lineaDesdeProducto, haceMeses, invalidarProductos, sinTildes } from "./lib";

// Unidades de Mercado Público y listas de clientes -> las del catálogo
const UNIDADES = { EA: "UNIDAD", UN: "UNIDAD", UND: "UNIDAD", UNIDAD: "UNIDAD", U: "UNIDAD", JGO: "UNIDAD", SET: "UNIDAD", KIT: "UNIDAD",
  GL: "GALÓN", GAL: "GALÓN", GALON: "GALÓN", KG: "KILO", KGM: "KILO", KILO: "KILO", MT: "METRO", MTR: "METRO", M: "METRO", METRO: "METRO", ML: "METRO",
  M3: "M3", MTQ: "M3", CJ: "CAJA", CAJA: "CAJA", BX: "CAJA", RO: "ROLLO", ROLLO: "ROLLO", SAC: "SACO", SACO: "SACO", BG: "SACO", BOLSA: "SACO",
  PAR: "PAR", PR: "PAR", TIN: "TINETA", TINETA: "TINETA", PLIEGO: "PLIEGO", PLANCHA: "PLIEGO", TIRA: "TIRA", BARRA: "TIRA" };
const unidadCatalogo = (u) => UNIDADES[sinTildes(u || "").replace(/[^A-Z0-9]/g, "")] || "UNIDAD";
// "Pinturas al esmalte - Pintura piscina ... similar o equivalente a Sipa" -> "PINTURA PISCINA ..."
const nombreSugerido = (desc) => {
  let t = String(desc || "").trim();
  const partes = t.split(/\s+-\s+/);
  if (partes.length > 1 && partes[0].length < 60) t = partes.slice(1).join(" - ");
  t = t.replace(/[,;.]?\s*(similar|o similar|similar\s+o|o\s+equivalente|equivalente)\b.*$/i, "").replace(/\s+/g, " ").trim().replace(/[.,;:]$/, "");
  return t.toUpperCase().slice(0, 250);
};
const categoriaSugerida = (l) => l.candidatos?.find((c) => c.categoria)?.categoria || "General";

// Sube la lista del cliente (Excel, PDF, Word o foto), Claude calza cada línea con el catálogo
// y aquí se revisa antes de agregarla a la cotización. Los precios los pone el sistema.
// cargar (opcional): función que devuelve el resultado ya calzado (p.ej. una licitación), en vez de subir archivo
export default function ImportarLista({ tipo, notify, onClose, onAgregar, cargar, esAdmin, titulo = "// Cotizar lista del cliente" }) {
  const productos = useProductos();
  const [alCatalogo, setAlCatalogo] = useState(null); // línea que se está creando en el catálogo
  const [creandoTodas, setCreandoTodas] = useState(false);
  const [archivo, setArchivo] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [res, setRes] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [extraArchivo, setExtraArchivo] = useState(null);
  const [extraUrl, setExtraUrl] = useState("");
  // Agrega líneas leídas de un documento (bases, anexo, lista) subido desde el computador o desde un enlace
  const leerExtra = async () => {
    setLeyendo(true);
    try {
      const r = extraArchivo ? await subirArchivo("/ia/lista-cliente", extraArchivo) : await api("/ia/lista-cliente", { method: "POST", body: { url: extraUrl.trim() } });
      setLineas((ls) => {
        const base = ls.length ? Math.max(...ls.map((l) => l.i)) + 1 : 0;
        return [...ls, ...r.lineas.map((l, k) => ({ ...l, i: base + k, incluir: true }))];
      });
      setRes((x) => ({ ...(x || {}), sin_detalle: false, archivo: [x?.archivo, r.archivo].filter(Boolean).join(" + ") }));
      notify(`✓ ${r.lineas.length} línea(s) leídas de ${r.archivo}`);
      setExtraArchivo(null); setExtraUrl("");
    } catch (e) { notify(e.message, "danger"); }
    finally { setLeyendo(false); }
  };

  const leer = async () => {
    if (!archivo) return;
    setLeyendo(true);
    try {
      const r = await subirArchivo("/ia/lista-cliente", archivo);
      setRes(r);
      setLineas(r.lineas.map((l, i) => ({ ...l, i, incluir: true })));
    } catch (e) { notify(e.message, "danger"); }
    finally { setLeyendo(false); }
  };

  useEffect(() => {
    if (!cargar) return;
    let vivo = true;
    setLeyendo(true);
    cargar()
      .then((r) => { if (vivo) { setRes(r); setLineas(r.lineas.map((l, i) => ({ ...l, i, incluir: true }))); } })
      .catch((e) => { notify(e.message, "danger"); onClose(); })
      .finally(() => vivo && setLeyendo(false));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (i, cambios) => setLineas((ls) => ls.map((l) => (l.i === i ? { ...l, ...cambios } : l)));
  const sinProducto = lineas.filter((l) => !l.producto);
  const usarNuevo = (l, p) => set(l.i, { producto: p, incluir: true, calce: "nuevo", nota: "Agregado al catálogo" });

  // Crea en el catálogo todas las líneas sin producto (sin precio: se cotizan después en Catálogo → Precios)
  const crearTodas = async () => {
    if (!confirm(`¿Agregar al catálogo los ${sinProducto.length} productos que no existen? Quedan sin precio de compra hasta que los cotices (Catálogo → Precios).`)) return;
    setCreandoTodas(true);
    let n = 0;
    try {
      for (const l of sinProducto) {
        const nombre = nombreSugerido(l.descripcion);
        const existente = (productos || []).find((p) => sinTildes(p.nombre) === sinTildes(nombre));
        const p = existente || await api("/productos", { method: "POST", body: { nombre, unidad: unidadCatalogo(l.unidad), categoria: categoriaSugerida(l), forzar: true } });
        usarNuevo(l, p);
        n++;
      }
      notify(`✓ ${n} producto(s) agregados al catálogo`);
    } catch (e) { notify(`${n} agregados; error en el siguiente: ${e.message}`, "danger"); }
    finally { invalidarProductos(); setCreandoTodas(false); }
  };
  const elegidas = lineas.filter((l) => l.incluir);
  const revisar = lineas.filter((l) => l.calce === "parecido" || l.calce === "sin_producto" || (l.producto && !(precioSegun(l.producto, tipo) > 0))).length;

  const agregar = () => {
    // Si el cliente pidió el mismo producto en dos líneas, se suman las cantidades
    // Cada línea queda en su caso (M20): mismo producto, similar (amarillo) o no está en catálogo (rojo)
    const porProducto = new Map();
    const sinProd = [];
    for (const l of elegidas) {
      if (!l.producto) {
        sinProd.push({ producto_id: null, clave: `n${Date.now()}${l.i}`, nombre: l.descripcion, descripcion_cliente: l.descripcion, unidad: (l.unidad || "UNIDAD").toUpperCase(), cantidad: Number(l.cantidad) || 1, precio: "", costo: 0, caso: "nuevo", auto: false });
        continue;
      }
      const previa = porProducto.get(l.producto.id);
      if (previa) { previa.cantidad += Number(l.cantidad) || 0; previa.descripcion_cliente += ` / ${l.descripcion}`; continue; }
      const similar = l.calce === "parecido";
      porProducto.set(l.producto.id, {
        ...lineaDesdeProducto(l.producto, tipo), cantidad: Number(l.cantidad) || 1, descripcion_cliente: l.descripcion,
        caso: similar ? "similar" : "mismo", nota_interna: similar ? `Cotizado con similar: ${l.producto.nombre}${l.nota ? ` (${l.nota})` : ""}` : null,
      });
    }
    onAgregar([...porProducto.values(), ...sinProd], res);
  };

  return (
    <Modal titulo={titulo} onClose={onClose} ancho={1150}
      footer={res ? <>
        <span className="mini" style={{ marginRight: "auto" }}>{elegidas.length} de {lineas.length} líneas se agregarán{revisar ? ` · ${revisar} para revisar (en amarillo)` : ""}</span>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!elegidas.length} onClick={agregar}>Agregar a la cotización</button>
      </> : <>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        {!cargar && <button className="btn btn-primary" disabled={!archivo || leyendo} onClick={leer}>{leyendo ? <><span className="spinner"></span>Leyendo con Claude...</> : "Leer lista"}</button>}
      </>}>
      {!res && cargar ? (
        <div className="cot-empty"><span className="spinner"></span>Buscando cada producto en el catálogo con Claude...</div>
      ) : !res ? (
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
            {res.presupuesto && <span className="id-solicitud">Presupuesto de la propuesta: {fmt(res.presupuesto)}</span>}
            {res.cierre && <span>Cierra {new Date(res.cierre).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
          </div>
          {res.sin_detalle && <div className="aviso">Mercado Público no trae el detalle de productos de este proceso. Sube las bases o el anexo con la lista (desde el computador o con el enlace) y Claude la lee.</div>}
          {cargar && (
            <div className="panel" style={{ marginBottom: 10 }}>
              <div className="panel-titulo">¿Faltan productos? Agregar desde un documento</div>
              <div className="pago-form">
                <input type="file" accept=".xlsx,.xlsm,.xls,.pdf,.docx,.csv,.txt,.jpg,.jpeg,.png,.webp" onChange={(e) => { setExtraArchivo(e.target.files?.[0] || null); setExtraUrl(""); }} />
                <span className="mini">o</span>
                <input placeholder="Pega el enlace del documento (PDF, Excel...)" value={extraUrl} onChange={(e) => { setExtraUrl(e.target.value); setExtraArchivo(null); }} />
                <button className="btn btn-primary btn-sm" disabled={leyendo || (!extraArchivo && !/^https?:\/\//.test(extraUrl.trim()))} onClick={leerExtra}>{leyendo ? <><span className="spinner"></span>Leyendo...</> : "Leer y agregar"}</button>
              </div>
            </div>
          )}
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
                      <td><input type="checkbox" checked={l.incluir} title={l.producto ? "" : "Se agrega como línea que no está en catálogo (rojo), con precio a mano"} onChange={(e) => set(l.i, { incluir: e.target.checked })} /></td>
                      <td>{l.descripcion}{l.unidad && <div className="mini">{l.unidad}</div>}</td>
                      <td><input className="qty-input" type="number" min="0" step="any" value={l.cantidad} onChange={(e) => set(l.i, { cantidad: e.target.value })} /></td>
                      <td><Estado valor={l.calce} />{l.nota && !/^placeholder$/i.test(l.nota) && <div className="mini" style={{ maxWidth: 200 }}>{l.nota}</div>}</td>
                      <td>
                        <SelectorProducto valor={l.producto} candidatos={l.candidatos} productos={productos} precioDe={(p) => precioSegun(p, tipo)}
                          onChange={(p) => set(l.i, { producto: p, incluir: true, calce: p ? (p.id === l.producto?.id ? l.calce : "exacto") : "sin_producto", nota: p && p.id !== l.producto?.id ? "Elegido a mano" : l.nota })} />
                        {l.producto && <div className="mini">{l.producto.unidad}{l.producto.precio_antiguo && <span className="antiguo"> · ⏱ precio {haceMeses(l.producto.fecha_precio)}</span>}</div>}
                        {(!l.producto || l.calce === "parecido") && <button className="link" onClick={() => setAlCatalogo(l)}>+ Agregar al catálogo como producto nuevo</button>}
                      </td>
                      <td className="price-cell">{l.producto ? (precio > 0 ? fmt(precio) : "sin precio") : "—"}</td>
                      <td className="price-cell">{precio > 0 ? fmt(precio * Number(l.cantidad || 0)) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {sinProducto.length > 0 && <button className="btn btn-ghost btn-sm" disabled={creandoTodas} onClick={crearTodas}>{creandoTodas ? <><span className="spinner"></span>Agregando...</> : `+ Agregar al catálogo las ${sinProducto.length} sin producto`}</button>}
            <span className="mini">Los productos nuevos quedan en el catálogo sin precio: cárgalo aquí al crearlos o después en Catálogo → Precios.</span>
          </div>
        </>
      )}
      {alCatalogo && <NuevoDesdeLinea linea={alCatalogo} esAdmin={esAdmin} notify={notify} productos={productos}
        onClose={() => setAlCatalogo(null)} onCreado={(p) => { usarNuevo(alCatalogo, p); setAlCatalogo(null); }} />}
    </Modal>
  );
}

// Crear en el catálogo el producto que pidió el cliente (con precio de compra opcional)
function NuevoDesdeLinea({ linea, esAdmin, notify, productos, onClose, onCreado }) {
  const [categorias, setCategorias] = useState([]);
  const [form, setForm] = useState({ nombre: nombreSugerido(linea.descripcion), unidad: unidadCatalogo(linea.unidad), categoria: categoriaSugerida(linea), precio_compra: "", proveedor: "", documento: "" });
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { api("/productos/categorias").then(setCategorias).catch(() => {}); }, []);
  const parecidos = (productos || []).filter((p) => {
    const a = new Set(sinTildes(form.nombre).split(/\s+/).filter((w) => w.length > 3));
    const b = sinTildes(p.nombre).split(/\s+/).filter((w) => a.has(w));
    return a.size && b.length >= Math.min(3, a.size);
  }).slice(0, 5);
  const guardar = async () => {
    setGuardando(true);
    try {
      const body = { nombre: form.nombre, unidad: form.unidad, categoria: form.categoria || "General", forzar: true }; // los parecidos ya se muestran arriba
      if (esAdmin && Number(form.precio_compra) > 0 && form.proveedor.trim()) Object.assign(body, { precio_compra: Number(form.precio_compra), proveedor: form.proveedor, documento: form.documento || null });
      const p = await api("/productos", { method: "POST", body });
      invalidarProductos();
      notify(`✓ ${p.nombre} agregado al catálogo (N° ${p.codigo})`);
      onCreado(p);
    } catch (e) { notify(e.message, "danger"); }
    finally { setGuardando(false); }
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal titulo="// Agregar al catálogo" onClose={onClose} ancho={640}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={guardando || !form.nombre.trim()} onClick={guardar}>{guardando ? "Guardando..." : "Agregar y usar en esta línea"}</button>
      </>}>
      <div className="mini">El cliente pidió: <strong>{linea.descripcion}</strong>{linea.unidad ? ` (${linea.unidad})` : ""}</div>
      <div className="field"><label>Descripción en nuestro catálogo</label><input value={form.nombre} onChange={(e) => set("nombre", e.target.value.toUpperCase())} /></div>
      {parecidos.length > 0 && (
        <div className="aviso" style={{ marginBottom: 0 }}>
          ¿Ya existe? Parecidos en el catálogo:{" "}
          {parecidos.map((p) => <button key={p.id} className="link" onClick={() => onCreado(p)}>N° {p.codigo} {p.nombre}</button>)}
        </div>
      )}
      <div className="fields-row">
        <div className="field"><label>Unidad</label><select value={form.unidad} onChange={(e) => set("unidad", e.target.value)}>{["UNIDAD", "METRO", "KILO", "SACO", "TINETA", "GALÓN", "ROLLO", "CAJA", "PAR", "PLIEGO", "TIRA", "M3"].map((u) => <option key={u}>{u}</option>)}</select></div>
        <div className="field">
          <label>Categoría</label>
          <input list="cats-nuevo" value={form.categoria} onChange={(e) => set("categoria", e.target.value)} />
          <datalist id="cats-nuevo">{categorias.map((c) => <option key={c.categoria} value={c.categoria} />)}</datalist>
        </div>
      </div>
      {esAdmin && <>
        <div className="mini">Precio de compra (opcional, neto sin IVA): si ya lo cotizaste, el sistema calcula el precio de venta altiro.</div>
        <div className="fields-row tres">
          <div className="field"><label>Precio compra neto</label><input type="number" min="0" value={form.precio_compra} onChange={(e) => set("precio_compra", e.target.value)} /></div>
          <div className="field"><label>Proveedor</label><input value={form.proveedor} onChange={(e) => set("proveedor", e.target.value.toUpperCase())} placeholder="MADESUR, SODIMAC..." /></div>
          <div className="field"><label>N° cotización / factura</label><input value={form.documento} onChange={(e) => set("documento", e.target.value)} /></div>
        </div>
      </>}
    </Modal>
  );
}
