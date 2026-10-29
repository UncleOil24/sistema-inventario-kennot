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
  if (!res.ok || !data.ok) throw new Error(data.error || `Error ${res.status}`);
  return data.data ?? data;
}

export const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
export const pct = (n) => `${Math.round(Number(n) || 0)}%`;
export const TIPOS_GASTO = { flete: "Flete", combustible: "Combustible", comision: "Comisión", general: "General" };

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
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

// Parámetros (márgenes) para calcular precios de venta en pantalla
export const precioSegun = (p, tipo) => Number(tipo === "particular" ? p.precio_particular : p.precio_convenio) || 0;


// Línea de cotización a partir de un producto del catálogo
export const lineaDesdeProducto = (p, tipo) => ({
  producto_id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: 1,
  precio: precioSegun(p, tipo), auto: true, // auto: el precio sigue al tipo de cliente
  convenio: Number(p.precio_convenio) || 0, particular: Number(p.precio_particular) || 0,
  costo: p.precio_compra !== undefined ? Number(p.precio_compra) || 0 : undefined, proveedor: p.proveedor,
});

