import { useState, useEffect } from "react";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export const fmt = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
export const fecha = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("es-CL") : "—");
export const hoyISO = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD en hora local

// --- Sesión ---------------------------------------------------------------
// El token se guarda en localStorage para no tener que iniciar sesión en cada recarga.
const CLAVE_TOKEN = "kennot_token";
export const getToken = () => { try { return localStorage.getItem(CLAVE_TOKEN); } catch { return null; } };
export const setToken = (t) => {
  try { if (t) localStorage.setItem(CLAVE_TOKEN, t); else localStorage.removeItem(CLAVE_TOKEN); } catch { /* sin storage */ }
};

// fetch con el token de sesión. Si el backend responde 401, avisa a la app para volver al login.
export async function authFetch(url, opciones = {}) {
  const token = getToken();
  const headers = { ...(opciones.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(url, { ...opciones, headers });
  if (res.status === 401 && !url.includes("/api/auth/login")) {
    let msg = "Tu sesión expiró";
    try { msg = (await res.clone().json()).error || msg; } catch { /* sin cuerpo */ }
    window.dispatchEvent(new CustomEvent("sesion-expirada", { detail: msg }));
  }
  return res;
}

// fetch que devuelve data o lanza Error con el mensaje del backend
export async function api(path, { method = "GET", body } = {}) {
  const res = await authFetch(`${API_URL}/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { throw new Error(`Error ${res.status} del servidor`); }
  if (!res.ok || !data.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data.data ?? data;
}

export const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
export const pct = (n) => `${Math.round(Number(n) || 0)}%`;
export const TIPOS_GASTO = { flete: "Flete", combustible: "Combustible", comision: "Comisión", financiero: "Financiero (factoring, intereses)", general: "General" };

// Catálogo completo en memoria (≈2.200 productos) para buscar al cotizar o comprar.
// Se comparte entre vistas y se recarga cuando cambian los precios.
let cacheProductos = null;
let promesaProductos = null;
export const invalidarProductos = () => { cacheProductos = null; promesaProductos = null; };
export function cargarProductos() {
  if (cacheProductos) return Promise.resolve(cacheProductos);
  if (!promesaProductos) {
    promesaProductos = api("/productos?sort=nombre&dir=ASC")
      .then((d) => { cacheProductos = d; return d; })
      .catch((e) => { promesaProductos = null; throw e; });
  }
  return promesaProductos;
}
export function useProductos() {
  const [productos, setProductos] = useState(cacheProductos || []);
  useEffect(() => { cargarProductos().then(setProductos).catch(() => {}); }, []);
  return productos;
}

// Descarga un archivo (Excel) desde la API con el token de sesión
export async function descargar(path, nombre) {
  const res = await authFetch(`${API_URL}/api${path}`);
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* binario */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Sin nombre: el que manda el servidor (ej. LISTADO_CONSOLIDADO_FERRETERIA_v72.xlsx)
  a.download = nombre || (res.headers.get("Content-Disposition") || "").match(/filename="?([^";]+)"?/)?.[1] || "archivo.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

// Tipo de pago de una compra
export const TIPOS_PAGO = [["contado", "Contado"], ["credito_empresa", "Crédito empresa (tarjeta o línea)"], ["credito_proveedor", "Crédito proveedor (plazo)"]];
export const nombreTipoPago = (t) => (TIPOS_PAGO.find(([v]) => v === t)?.[1] || "Crédito proveedor (plazo)");

// Ficha del proceso en Mercado Público (Compra Ágil: código terminado en COT; si no, licitación)
export const fichaMP = (codigo) => {
  const c = String(codigo || "").trim();
  if (!/^\d+-\d+-[A-Z0-9]+$/i.test(c)) return null;
  return /-COT\d*$/i.test(c) ? `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(c)}` : `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(c)}`;
};

// Descarga un archivo pidiéndolo con POST (cuando lo que va en el archivo se arma en pantalla)
export async function descargarPost(path, body, nombre) {
  const res = await authFetch(`${API_URL}/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { let msg = `Error ${res.status}`; try { msg = (await res.json()).error || msg; } catch { /* binario */ } throw new Error(msg); }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = nombre || (res.headers.get("Content-Disposition") || "").match(/filename="?([^";]+)"?/)?.[1] || "archivo.xlsx";
  a.click(); URL.revokeObjectURL(url);
}

// Imprime directo un PDF del sistema (sin descargarlo): se abre la ventana de impresión con el tamaño de hoja del PDF
export async function imprimirPDF(path, body) {
  const res = await authFetch(`${API_URL}/api${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  if (!res.ok) { let msg = `Error ${res.status}`; try { msg = (await res.json()).error || msg; } catch { /* binario */ } throw new Error(msg); }
  const url = URL.createObjectURL(new Blob([await res.blob()], { type: "application/pdf" }));
  const viejo = document.getElementById("marco-impresion"); if (viejo) viejo.remove();
  const f = document.createElement("iframe");
  f.id = "marco-impresion"; f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  f.src = url;
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url, "_blank"); } };
  document.body.appendChild(f);
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
}

// Imprime una hoja armada para papel (Carta, vertical u horizontal), sin los botones de la pantalla
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export { esc as escaparHTML };
// Sin orientación forzada: sale vertical y en la ventana de impresión se puede elegir Diseño (vertical u horizontal)
export function imprimirHTML(titulo, cuerpo, { horizontal = null } = {}) {
  const viejo = document.getElementById("marco-impresion"); if (viejo) viejo.remove();
  const f = document.createElement("iframe");
  f.id = "marco-impresion"; f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(f);
  const d = f.contentWindow.document;
  d.open();
  d.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
    @page { ${horizontal === true ? "size: letter landscape; " : horizontal === false ? "size: letter portrait; " : ""}margin: 8mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #111; margin: 0; }
    h1 { font-size: 15px; margin: 0 0 2px; } .sub { color: #444; margin-bottom: 8px; }
    h2 { font-size: 12px; margin: 12px 0 4px; padding: 4px 6px; background: #e6eeee; border-left: 4px solid #2b6f6f; display: flex; justify-content: space-between; }
    table { width: 100%; border-collapse: collapse; page-break-inside: auto; table-layout: fixed; } td, th { overflow-wrap: break-word; }
    tr { page-break-inside: avoid; } thead { display: table-header-group; }
    th { text-align: left; font-size: 9px; text-transform: uppercase; border-bottom: 1.5px solid #333; padding: 3px 4px; white-space: nowrap; } th.cen, td.cen { text-align: center; white-space: nowrap; } td.num, tbody td:first-child { white-space: nowrap; } th.obs { text-align: center; padding-left: 10px; } td.obs { padding-left: 10px; }
    td { border-bottom: 1px solid #ccc; padding: 3px 4px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; } .chk { width: 18px; font-size: 13px; } .mini { color: #555; font-size: 9px; }
    .tot td { font-weight: bold; border-top: 1.5px solid #333; } .aviso { color: #a33; }
    .pie { margin-top: 10px; font-size: 11px; }
    /* Un proveedor con pocas líneas no se corta entre hojas; uno largo sí (si no, la hoja anterior quedaba en blanco) */
    .grupo.corto { page-break-inside: avoid; } h2 { page-break-after: avoid; break-after: avoid; }
  </style></head><body>${cuerpo}</body></html>`);
  d.close();
  // Hoja Carta ~ 1000 px de alto útil: solo se mantienen juntos los grupos que caben en media hoja
  d.querySelectorAll(".grupo").forEach((g) => { if (g.offsetHeight < 480) g.classList.add("corto"); });
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, 300);
}

// Parámetros (márgenes) para calcular precios de venta en pantalla
export const precioSegun = (p, tipo) => Number(tipo === "particular" ? p.precio_particular : p.precio_convenio) || 0;


// Línea de cotización a partir de un producto del catálogo
// Contenido por envase escrito en el nombre: "CAJA 1000", "X 100 UN", "BOLSA DE 50", "PACK 10", "1000 UNIDADES"
export function contenidoDeNombre(nombre) {
  const t = String(nombre || "").toUpperCase().replace(/\./g, "");
  const m = t.match(/\b(?:CAJA|BOLSA|PACK|PAQUETE|PAQ|ROLLO|SET|DISPLAY|BLISTER)\s*(?:DE|X|C\/)?\s*(\d{2,5})\b/)
    || t.match(/\bX\s*(\d{2,5})\s*(?:UN|UNID|UNIDADES|U|PCS|PZS|PIEZAS|PARES)\b/)
    || t.match(/\bX\s*(\d{3,5})\b(?!\s*(?:M|MM|CM|MT|MTS|METROS|GR|G|KG|ML|LT|L|CC)\b)/)
    || t.match(/\b(\d{2,5})\s*(?:UN|UNID|UNIDADES|PCS|PZS|PIEZAS)\b/);
  const n = m ? Number(m[1]) : 0;
  return n > 1 ? n : null;
}
// Contenido del producto: el confirmado en el catálogo o, si no hay, el que dice el nombre
export const contenidoDe = (p) => (Number(p?.contenido) > 1 ? Number(p.contenido) : contenidoDeNombre(p?.nombre));

// Factura de proveedor que cobra por unidad un producto que nosotros compramos en envase (caja de 1.000):
// propone pasar la línea a envases (cantidad ÷ contenido, precio × contenido) para no ensuciar el catálogo.
export function envaseEnFactura(l, prod) {
  const c = contenidoDe(prod);
  if (!c || l.envase_ok) return null;
  const cant = Number(l.cantidad) || 0; const precio = Number(l.precio_neto) || 0;
  const porUnidad = /^(UN|UND|UNI|UNID|UNIDAD|UNIDADES|U|C\/U|PZA|PZS|PCS)?$/i.test(String(l.unidad || "").trim());
  const ref = Number(prod?.precio_compra) || 0;
  const calzaPrecio = ref > 0 ? precio * c > ref * 0.4 && precio * c < ref * 2.5 : true;
  if (!porUnidad || cant < c || !calzaPrecio || !(precio > 0)) return null;
  return { contenido: c, cantidad: Math.round((cant / c) * 1000) / 1000, precio: Math.round(precio * c) };
}

export const lineaDesdeProducto = (p, tipo) => ({
  producto_id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: 1, contenido: contenidoDe(p),
  precio: precioSegun(p, tipo), auto: true, // auto: el precio sigue al tipo de cliente
  convenio: Number(p.precio_convenio) || 0, particular: Number(p.precio_particular) || 0,
  costo: p.precio_compra !== undefined ? Number(p.precio_compra) || 0 : undefined, proveedor: p.proveedor,
  fecha_precio: p.fecha_precio, precio_antiguo: !!p.precio_antiguo,
});


// Sube un archivo (multipart) y devuelve data o lanza Error con el mensaje del backend
export async function subirArchivo(path, archivo, extra = {}) {
  const fd = new FormData();
  fd.append("archivo", archivo);
  Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  const res = await authFetch(`${API_URL}/api${path}`, { method: "POST", body: fd });
  let data;
  try { data = await res.json(); } catch { throw new Error(`Error ${res.status} del servidor`); }
  if (!res.ok || !data.ok) throw new Error(data.error || `Error ${res.status}`);
  return data.data;
}

export const ETIQUETA_CALCE = { exacto: "Exacto", equivalente: "Equivalente", parecido: "Parecido", sin_producto: "Sin producto" };

// "hace 8 meses" a partir de una fecha AAAA-MM-DD
export const haceMeses = (iso) => {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`), h = new Date();
  const m = (h.getFullYear() - d.getFullYear()) * 12 + h.getMonth() - d.getMonth();
  return m <= 0 ? "este mes" : m === 1 ? "hace 1 mes" : `hace ${m} meses`;
};

// ID de la cotización: Cotizacion_KENOTT_N100 (las de antes de partir en N°100: "Kenott N276 (anterior)")
export const idCot = (c) => `Cotizacion_${String(c?.empresa || "kenott").toUpperCase()}_N${c?.numero}`;
export const nombreCot = (c) => c?.id_cotizacion || (c?.anterior ? `${c.empresa === "tactics" ? "Tactics" : "Kenott"} N${c.numero} (anterior)` : idCot(c));

// Columna "Compra" de las hojas: en vez de repetir el estado, la orden a la que pertenece cada línea.
// Por comprar = vacío (la casilla ☐ ya lo dice); pedido = C-00xx; comprado = ✓ C-00xx; stock = stock.
export function textoCompra(estado, ordenes = []) {
  const n = (ordenes || []).filter(Boolean).join(", ");
  if (estado === "stock") return "stock";
  if (estado === "comprado") return `✓ ${n}`.trim();
  if (estado === "parcial") return `parcial${n ? ` · ${n}` : ""}`;
  if (estado === "pedido") return n || "pedido";
  return "";
}
// Etiqueta corta de la empresa (para marcar cuando se juntan ventas de Kenott y Tactics)
export const EMP_CORTA = { kenott: "Kenott", tactics: "Tactics" };
