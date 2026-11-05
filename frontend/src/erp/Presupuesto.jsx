// Control de presupuesto de una licitación (M27) y ajuste de margen para entrar (M28).
// Montos del presupuesto con IVA; lo cotizado se compara con IVA (neto × 1,19).
import { useState } from "react";
import { fmt } from "./lib";

const IVA = 1.19;
const conIva = (lineas) => Math.round(lineas.reduce((s, i) => s + Number(i.precio || 0) * Number(i.cantidad || 0), 0) * IVA);
const costoDe = (lineas) => lineas.reduce((s, i) => s + Number(i.costo || 0) * Number(i.cantidad || 0), 0);

// Margen máximo sobre la compra que permite entrar al monto (con IVA). Ej: 0,18 = compra × 1,18
function margenParaEntrar(lineas, monto) {
  const costo = costoDe(lineas);
  if (!(costo > 0) || !(monto > 0)) return null;
  const pct = Math.floor(((monto / IVA) / costo - 1) * 1000) / 1000; // hacia abajo, para no pasarse por redondeo
  return pct;
}

function Fila({ nombre, monto, lineas, verCostos, onAplicar }) {
  const cotizado = conIva(lineas);
  const pasa = monto > 0 && cotizado > monto;
  const pct = pasa && verCostos ? margenParaEntrar(lineas, monto) : null;
  const usoPct = monto > 0 ? Math.min(100, Math.round((cotizado / monto) * 100)) : 0;
  return (
    <div className={`presu-fila ${pasa ? "presu-pasa" : ""}`}>
      <div className="presu-cab">
        <strong>{nombre}</strong>
        <span className="mini">{lineas.length} línea(s)</span>
        <span style={{ marginLeft: "auto" }}>{fmt(cotizado)} de {monto > 0 ? fmt(monto) : "—"}</span>
        {monto > 0 && <span className={`estado ${pasa ? "estado-warn" : "estado-ok"}`}>{pasa ? `se pasa ${fmt(cotizado - monto)}` : `sobran ${fmt(monto - cotizado)}`}</span>}
      </div>
      {monto > 0 && <div className="progreso"><div style={{ width: `${usoPct}%`, background: pasa ? "var(--danger)" : undefined }} /></div>}
      {pasa && verCostos && (pct === null
        ? <div className="mini">Faltan costos de compra en este grupo para calcular el margen que permite entrar.</div>
        : pct < 0
          ? <div className="mini" style={{ color: "var(--danger)" }}>Ni a precio de compra entra: el costo con IVA ya supera el monto.</div>
          : <div className="mini">Con <strong>{(pct * 100).toFixed(1).replace(".", ",")}%</strong> sobre la compra en {nombre === "Total" ? "toda la cotización" : "este grupo"} entras con {fmt(Math.floor(costoDe(lineas) * (1 + pct)) * IVA)}.
            {" "}<button className="link" onClick={() => onAplicar(lineas, pct)}>Aplicar solo a esta cotización</button></div>)}
    </div>
  );
}

export default function ControlPresupuesto({ presupuesto, setPresupuesto, items, setItems, verCostos }) {
  const [abierto, setAbierto] = useState(!!presupuesto);
  const p = presupuesto || { total: "", grupos: [] };
  const set = (cambios) => setPresupuesto({ ...p, ...cambios });
  const grupos = p.grupos || [];
  // Aplica el margen a las líneas (sin tocar el catálogo): precio = compra × (1 + margen), hacia abajo
  const aplicar = (lineas, pct) => {
    const ids = new Set(lineas.map((i) => i.producto_id ?? i.clave));
    setItems((l) => l.map((i) => (ids.has(i.producto_id ?? i.clave) && Number(i.costo) > 0 ? { ...i, precio: Math.floor(Number(i.costo) * (1 + pct)), auto: false } : i)));
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
        <Fila key={g.nombre} nombre={g.nombre} monto={Number(g.monto) || 0} lineas={items.filter((i) => i.grupo === g.nombre)} verCostos={verCostos} onAplicar={aplicar} />
      ))}
      {grupos.length > 0 && items.some((i) => !i.grupo) && <div className="mini">{items.filter((i) => !i.grupo).length} línea(s) sin grupo: asígnalas en la columna "Grupo".</div>}
      <Fila nombre="Total" monto={Number(p.total) || 0} lineas={items} verCostos={verCostos} onAplicar={aplicar} />
    </div>
  );
}
