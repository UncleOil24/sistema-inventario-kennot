// Control de presupuesto de una licitación (M27) y ajuste de margen para entrar (M28).
// Montos del presupuesto con IVA; lo cotizado se compara con IVA (neto × 1,19).
import { useState } from "react";
import { fmt } from "./lib";

const IVA = 1.19;
const conIva = (lineas) => Math.round(lineas.reduce((s, i) => s + Number(i.precio || 0) * Number(i.cantidad || 0), 0) * IVA);
const costoDe = (lineas) => lineas.reduce((s, i) => s + Number(i.costo || 0) * Number(i.cantidad || 0), 0);

// Margen máximo sobre la compra que permite entrar al monto (con IVA). Ej: 0,18 = compra × 1,18
// Solo sirve si TODAS las líneas tienen costo (si hay líneas con precio a mano, se usa "Cuadrar al presupuesto").
function margenParaEntrar(lineas, monto) {
  if (lineas.some((i) => !(Number(i.costo) > 0))) return null;
  const costo = costoDe(lineas);
  if (!(costo > 0) || !(monto > 0)) return null;
  return Math.floor(((monto / IVA) / costo - 1) * 1000) / 1000; // hacia abajo, para no pasarse por redondeo
}

// "Cuadrar al presupuesto": baja todos los precios en el mismo % (sin bajar de la compra cuando se conoce)
// hasta que el total con IVA quede igual o bajo el monto. Devuelve { precios: Map(clave -> precio), pct } o null si no se puede.
const claveDe = (i) => (i.producto_id ? `p${i.producto_id}` : `c${i.clave}`);
function cuadrar(lineas, monto) {
  const meta = Math.floor(monto / IVA); // neto máximo
  const neto = (ps) => lineas.reduce((s, i) => s + ps.get(claveDe(i)) * Number(i.cantidad || 0), 0);
  const piso = (i) => (Number(i.costo) > 0 ? Math.ceil(Number(i.costo)) : 0);
  const precios = new Map(lineas.map((i) => [claveDe(i), Number(i.precio || 0)]));
  const original = neto(precios);
  if (original <= meta) return null;
  if (lineas.reduce((s, i) => s + piso(i) * Number(i.cantidad || 0), 0) > meta) return { imposible: true };
  // Se reparte la rebaja solo entre las líneas que aún pueden bajar; las que llegan a su costo quedan fijas
  let libres = lineas.filter((i) => precios.get(claveDe(i)) > piso(i));
  for (let vuelta = 0; vuelta < 20 && neto(precios) > meta && libres.length; vuelta++) {
    const fijo = neto(precios) - libres.reduce((s, i) => s + precios.get(claveDe(i)) * Number(i.cantidad || 0), 0);
    const variable = neto(precios) - fijo;
    const f = Math.max(0, (meta - fijo) / variable);
    for (const i of libres) precios.set(claveDe(i), Math.max(piso(i), Math.floor(precios.get(claveDe(i)) * f)));
    libres = libres.filter((i) => precios.get(claveDe(i)) > piso(i));
  }
  // Ajuste fino por redondeo: se baja $1 a las líneas de mayor monto hasta entrar
  const orden = [...lineas].sort((a, b) => Number(b.precio) * Number(b.cantidad) - Number(a.precio) * Number(a.cantidad));
  for (let k = 0; neto(precios) > meta && k < 1000; k++) {
    const i = orden[k % orden.length];
    if (precios.get(claveDe(i)) - 1 >= piso(i)) precios.set(claveDe(i), precios.get(claveDe(i)) - 1);
  }
  if (neto(precios) > meta) return { imposible: true };
  return { precios, pct: (1 - neto(precios) / original) * 100, total: Math.round(neto(precios) * IVA) };
}

function Fila({ nombre, monto, lineas, verCostos, onAplicar, onCuadrar }) {
  const cotizado = conIva(lineas);
  const pasa = monto > 0 && cotizado > monto;
  const pct = pasa && verCostos ? margenParaEntrar(lineas, monto) : null;
  const cuadre = pasa ? cuadrar(lineas, monto) : null;
  const usoPct = monto > 0 ? Math.min(100, Math.round((cotizado / monto) * 100)) : 0;
  const sinCosto = lineas.filter((i) => !(Number(i.costo) > 0)).length;
  return (
    <div className={`presu-fila ${pasa ? "presu-pasa" : ""}`}>
      <div className="presu-cab">
        <strong>{nombre}</strong>
        <span className="mini">{lineas.length} línea(s)</span>
        <span style={{ marginLeft: "auto" }}>{fmt(cotizado)} de {monto > 0 ? fmt(monto) : "—"}</span>
        {monto > 0 && <span className={`estado ${pasa ? "estado-warn" : "estado-ok"}`}>{pasa ? `se pasa ${fmt(cotizado - monto)}` : `dentro · sobran ${fmt(monto - cotizado)}`}</span>}
      </div>
      {monto > 0 && <div className="progreso"><div style={{ width: `${usoPct}%`, background: pasa ? "var(--danger)" : "var(--success)" }} /></div>}
      {pasa && cuadre && (cuadre.imposible
        ? <div className="mini" style={{ color: "var(--danger)" }}>No entra ni bajando todo a precio de compra: el costo con IVA ya supera el monto.</div>
        : <div className="mini">
            Bajando los precios <strong>{cuadre.pct.toFixed(1).replace(".", ",")}%</strong> {nombre === "Total" ? "en toda la cotización" : "en este grupo"} quedas en {fmt(cuadre.total)}
            {verCostos ? " (ninguna línea baja de su precio de compra)" : ""}.{" "}
            <button className="link" onClick={() => onCuadrar(cuadre.precios, cuadre.pct)}>Cuadrar al presupuesto</button>
          </div>)}
      {pasa && verCostos && pct !== null && pct >= 0 && (
        <div className="mini">O con <strong>{(pct * 100).toFixed(1).replace(".", ",")}%</strong> sobre la compra en cada línea entras con {fmt(Math.round(Math.floor(costoDe(lineas) * (1 + pct)) * IVA))}.
          {" "}<button className="link" onClick={() => onAplicar(lineas, pct)}>Usar ese margen</button></div>
      )}
      {pasa && verCostos && sinCosto > 0 && <div className="mini">{sinCosto} línea(s) con precio a mano (sin costo): también se bajan al cuadrar.</div>}
    </div>
  );
}

export default function ControlPresupuesto({ presupuesto, setPresupuesto, items, setItems, verCostos }) {
  const [abierto, setAbierto] = useState(!!presupuesto);
  const p = presupuesto || { total: "", grupos: [] };
  const set = (cambios) => setPresupuesto({ ...p, ...cambios });
  const grupos = p.grupos || [];
  // Aplica el margen a las líneas (sin tocar el catálogo): precio = compra × (1 + margen), hacia abajo
  // Precios antes del último ajuste, para poder deshacerlo
  const [antes, setAntes] = useState(null);
  const guardarAntes = (texto) => setAntes({ texto, precios: new Map(items.map((i) => [claveDe(i), i.precio])) });
  const aplicar = (lineas, pct) => {
    guardarAntes(`margen ${(pct * 100).toFixed(1).replace(".", ",")}%`);
    const ids = new Set(lineas.map(claveDe));
    setItems((l) => l.map((i) => (ids.has(claveDe(i)) && Number(i.costo) > 0 ? { ...i, precio: Math.floor(Number(i.costo) * (1 + pct)), auto: false } : i)));
  };
  // Cuadrar: nuevos precios (solo en esta cotización; el catálogo no cambia). Queda anotado el descuento interno.
  const cuadrarA = (precios, pct) => {
    guardarAntes(`descuento ${pct.toFixed(1).replace(".", ",")}%`);
    setItems((l) => l.map((i) => (precios.has(claveDe(i)) ? { ...i, precio: precios.get(claveDe(i)), auto: false } : i)));
    set({ ajuste: { tipo: "cuadrar", pct: Math.round(pct * 10) / 10, fecha: new Date().toISOString().slice(0, 10) } });
  };
  const deshacer = () => {
    if (!antes) return;
    setItems((l) => l.map((i) => (antes.precios.has(claveDe(i)) ? { ...i, precio: antes.precios.get(claveDe(i)) } : i)));
    set({ ajuste: null }); setAntes(null);
  };

  if (!abierto) return <button className="link" onClick={() => setAbierto(true)}>+ Controlar contra el presupuesto de la licitación</button>;
  return (
    <div className="panel">
      <div className="panel-titulo" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Presupuesto de la licitación <span className="mini">(montos con IVA; las bases rechazan ofertas sobre el monto)</span>
        <button className="link" style={{ marginLeft: "auto" }} onClick={() => { setPresupuesto(null); setAbierto(false); }}>quitar</button>
      </div>
      <div className="fields-row">
        <div className="field" style={{ maxWidth: 220 }}><label>Presupuesto total</label>
          <input type="number" value={p.total ?? ""} onChange={(e) => set({ total: e.target.value })} placeholder="Ej: 4000000" /></div>
        <div className="field"><label>Grupos de ítems (si las bases los separan)</label>
          {grupos.map((g, k) => (
            <div key={k} className="pago-form" style={{ marginBottom: 6 }}>
              <input value={g.nombre} placeholder="Grupo (ej. Pinturas)" onChange={(e) => set({ grupos: grupos.map((x, j) => (j === k ? { ...x, nombre: e.target.value } : x)) })} />
              <input type="number" value={g.monto} placeholder="Monto con IVA" onChange={(e) => set({ grupos: grupos.map((x, j) => (j === k ? { ...x, monto: e.target.value } : x)) })} />
              <button className="btn btn-danger btn-sm" onClick={() => set({ grupos: grupos.filter((_, j) => j !== k) })}>✕</button>
            </div>
          ))}
          <button className="link" onClick={() => set({ grupos: [...grupos, { nombre: "", monto: "" }] })}>+ Agregar grupo</button>
        </div>
      </div>
      {grupos.filter((g) => g.nombre).map((g) => (
        <Fila key={g.nombre} nombre={g.nombre} monto={Number(g.monto) || 0} lineas={items.filter((i) => i.grupo === g.nombre)} verCostos={verCostos} onAplicar={aplicar} onCuadrar={cuadrarA} />
      ))}
      {grupos.length > 0 && items.some((i) => !i.grupo) && <div className="mini">{items.filter((i) => !i.grupo).length} línea(s) sin grupo: asígnalas en la columna "Grupo".</div>}
      <Fila nombre="Total" monto={Number(p.total) || 0} lineas={items} verCostos={verCostos} onAplicar={aplicar} onCuadrar={cuadrarA} />
      {antes && <div className="mini">Se aplicó {antes.texto} a los precios de esta cotización (el catálogo no cambia). <button className="link" onClick={deshacer}>Deshacer</button></div>}
      {!antes && p.ajuste?.pct > 0 && <div className="mini">Esta cotización tiene un descuento interno de {String(p.ajuste.pct).replace(".", ",")}% para cuadrar al presupuesto.</div>}
    </div>
  );
}
