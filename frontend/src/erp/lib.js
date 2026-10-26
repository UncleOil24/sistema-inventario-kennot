import { useState, useEffect } from "react";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export const fmt = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
export const fecha = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("es-CL") : "—");
export const hoyISO = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD en hora local

// fetch que devuelve data o lanza Error con el mensaje del backend
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { throw new Error(`Error ${res.status} del servidor`); }
  if (!res.ok || !data.ok) throw new Error(data.error || `Error ${res.status}`);
  return data.data ?? data;
}

// Carga productos una vez para los selectores de items
export function useProductos(deps = []) {
  const [productos, setProductos] = useState([]);
  useEffect(() => {
    api("/productos?sort=nombre&dir=ASC").then(setProductos).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return productos;
}

