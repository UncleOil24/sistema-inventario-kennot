import { useState, useEffect, useCallback } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const CATEGORIAS = ["Todas", "Ferretería", "Plomería", "Construcción", "Eléctrico", "Pintura", "Jardín"];

const fmt = (n) => `$${Number(n).toLocaleString("es-CL")}`;

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0d0e0f;
    --surface: #141618;
    --surface2: #1c1f22;
    --border: #2a2d31;
    --border2: #363a3f;
    --accent: #e8c547;
    --accent2: #c9a82e;
    --danger: #e05252;
    --success: #4caf7d;
    --text: #e2e4e7;
    --text2: #8b9099;
    --text3: #555c66;
    --mono: 'IBM Plex Mono', monospace;
    --sans: 'IBM Plex Sans', sans-serif;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--sans); min-height: 100vh; }

  .app { display: flex; flex-direction: column; min-height: 100vh; }

  /* HEADER */
  .header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 0 2rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 56px;
    position: sticky; top: 0; z-index: 100;
  }
  .header-brand {
    display: flex; align-items: center; gap: 10px;
    font-family: var(--mono); font-size: 13px; font-weight: 600;
    letter-spacing: 0.12em; color: var(--accent); text-transform: uppercase;
  }
  .header-brand span { color: var(--text3); }
  .header-nav { display: flex; gap: 2px; }
  .nav-btn {
    background: none; border: none; cursor: pointer;
    padding: 6px 14px; border-radius: 4px;
    font-family: var(--mono); font-size: 11px; font-weight: 500;
    letter-spacing: 0.08em; color: var(--text2); text-transform: uppercase;
    transition: all 0.15s;
  }
  .nav-btn:hover { color: var(--text); background: var(--surface2); }
  .nav-btn.active { color: var(--accent); background: rgba(232,197,71,0.08); }
  .badge {
    background: var(--accent); color: #000; border-radius: 10px;
    padding: 1px 7px; font-size: 10px; font-weight: 600; margin-left: 6px;
  }

  /* MAIN */
  .main { flex: 1; padding: 2rem; max-width: 1400px; margin: 0 auto; width: 100%; }

  /* TOOLBAR */
  .toolbar {
    display: flex; gap: 12px; align-items: center; margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }
  .search-wrap { position: relative; flex: 1; min-width: 220px; }
  .search-icon {
    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
    color: var(--text3); font-size: 14px; pointer-events: none;
  }
  .search-input {
    width: 100%; background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 9px 12px 9px 36px;
    font-family: var(--mono); font-size: 12px; color: var(--text);
    outline: none; transition: border-color 0.15s;
  }
  .search-input::placeholder { color: var(--text3); }
  .search-input:focus { border-color: var(--border2); }

  .filter-select {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 9px 12px;
    font-family: var(--mono); font-size: 12px; color: var(--text2);
    outline: none; cursor: pointer; min-width: 130px;
  }
  .filter-select option { background: var(--surface2); }

  .btn {
    border: none; border-radius: 6px; padding: 9px 16px; cursor: pointer;
    font-family: var(--mono); font-size: 11px; font-weight: 600;
    letter-spacing: 0.06em; text-transform: uppercase; transition: all 0.15s;
    display: flex; align-items: center; gap: 6px; white-space: nowrap;
  }
  .btn-primary { background: var(--accent); color: #000; }
  .btn-primary:hover { background: var(--accent2); }
  .btn-ghost { background: var(--surface); border: 1px solid var(--border); color: var(--text2); }
  .btn-ghost:hover { border-color: var(--border2); color: var(--text); }
  .btn-danger { background: rgba(224,82,82,0.12); border: 1px solid rgba(224,82,82,0.3); color: var(--danger); }
  .btn-danger:hover { background: rgba(224,82,82,0.2); }
  .btn-success { background: rgba(76,175,125,0.12); border: 1px solid rgba(76,175,125,0.3); color: var(--success); }
  .btn-success:hover { background: rgba(76,175,125,0.2); }
  .btn-sm { padding: 5px 10px; font-size: 10px; }

  /* STATS */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 1.5rem; }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px;
  }
  .stat-label { font-family: var(--mono); font-size: 10px; color: var(--text3); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6px; }
  .stat-value { font-family: var(--mono); font-size: 22px; font-weight: 600; color: var(--text); }
  .stat-value.accent { color: var(--accent); }
  .stat-value.success { color: var(--success); }

  /* TABLE */
  .table-wrap {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; overflow: hidden;
  }
  .table { width: 100%; border-collapse: collapse; }
  .table th {
    background: var(--surface2); padding: 10px 14px;
    font-family: var(--mono); font-size: 10px; font-weight: 600;
    color: var(--text3); text-transform: uppercase; letter-spacing: 0.1em;
    text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap;
  }
  .table th.sortable { cursor: pointer; user-select: none; }
  .table th.sortable:hover { color: var(--text2); }
  .table td {
    padding: 11px 14px; border-bottom: 1px solid var(--border);
    font-size: 13px; vertical-align: middle;
  }
  .table tr:last-child td { border-bottom: none; }
  .table tr:hover td { background: rgba(255,255,255,0.02); }
  .id-cell { font-family: var(--mono); font-size: 11px; color: var(--text3); }
  .price-cell { font-family: var(--mono); font-size: 12px; color: var(--accent); }
  .stock-cell { font-family: var(--mono); font-size: 12px; }
  .stock-low { color: var(--danger); }
  .stock-ok { color: var(--success); }
  .cat-badge {
    background: var(--surface2); border: 1px solid var(--border2);
    border-radius: 4px; padding: 2px 8px;
    font-family: var(--mono); font-size: 10px; color: var(--text2);
  }
  .actions { display: flex; gap: 6px; }
  .empty-row td { text-align: center; padding: 3rem; color: var(--text3); font-family: var(--mono); font-size: 12px; }

  /* MODAL */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 200; padding: 1rem;
    animation: fadeIn 0.15s ease;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .modal {
    background: var(--surface); border: 1px solid var(--border2);
    border-radius: 10px; width: 100%; max-width: 480px;
    animation: slideUp 0.2s ease;
  }
  @keyframes slideUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .modal-header {
    padding: 18px 20px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .modal-title { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--text); letter-spacing: 0.05em; }
  .modal-close { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 4px; }
  .modal-close:hover { color: var(--text); background: var(--surface2); }
  .modal-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .modal-footer { padding: 16px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }

  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label { font-family: var(--mono); font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; }
  .field input, .field select {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 6px; padding: 9px 12px;
    font-family: var(--mono); font-size: 12px; color: var(--text);
    outline: none; transition: border-color 0.15s; width: 100%;
  }
  .field input:focus, .field select:focus { border-color: var(--accent); }
  .field select option { background: var(--surface2); }
  .fields-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  /* COTIZACIÓN */
  .cot-empty {
    text-align: center; padding: 3rem 2rem;
    color: var(--text3); font-family: var(--mono); font-size: 12px;
  }
  .cot-table-wrap {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; overflow: hidden; margin-bottom: 1rem;
  }
  .cot-totals {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px 20px;
    display: flex; flex-direction: column; gap: 8px; margin-bottom: 1rem;
  }
  .total-row { display: flex; justify-content: space-between; align-items: center; }
  .total-label { font-family: var(--mono); font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.08em; }
  .total-value { font-family: var(--mono); font-size: 13px; color: var(--text); }
  .total-row.grand .total-label { color: var(--accent); font-size: 12px; }
  .total-row.grand .total-value { font-size: 20px; color: var(--accent); font-weight: 600; }
  .divider { border: none; border-top: 1px solid var(--border); margin: 4px 0; }
  .qty-input {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 4px; padding: 4px 8px; width: 60px;
    font-family: var(--mono); font-size: 12px; color: var(--text);
    outline: none; text-align: center;
  }
  .qty-input:focus { border-color: var(--accent); }

  /* NOTIF */
  .notif {
    position: fixed; bottom: 24px; right: 24px;
    background: var(--surface2); border: 1px solid var(--border2);
    border-radius: 8px; padding: 12px 18px;
    font-family: var(--mono); font-size: 12px; color: var(--text);
    z-index: 300; animation: slideUp 0.2s ease;
    display: flex; align-items: center; gap: 8px;
  }
  .notif.success { border-color: var(--success); color: var(--success); }
  .notif.danger { border-color: var(--danger); color: var(--danger); }

  @media (max-width: 768px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
    .header { padding: 0 1rem; }
    .main { padding: 1rem; }
    .fields-row { grid-template-columns: 1fr; }
  }
`;



export default function App() {
  const [view, setView] = useState("inventario");
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("Todas");
  const [sortField, setSortField] = useState("id");
  const [sortDir, setSortDir] = useState("asc");
  const [modal, setModal] = useState(null); // null | "nuevo" | "editar" | "eliminar"
  const [productoActual, setProductoActual] = useState(null);
  const [form, setForm] = useState({});
  const [cotizacion, setCotizacion] = useState([]);
  const [notif, setNotif] = useState(null);
  const [clienteNombre, setClienteNombre] = useState("");
  const [cotNum, setCotNum] = useState(1);

  const showNotif = (msg, type = "success") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 2500);
  };
  const fetchProductos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (busqueda) params.append("busqueda", busqueda);
      if (categoriaFiltro !== "Todas") params.append("categoria", categoriaFiltro);
      params.append("sort", sortField);
      params.append("dir", sortDir);
      const res = await fetch(`${API_URL}/api/productos?${params}`);
      const data = await res.json();
      if (data.ok) setProductos(data.data);
    } catch { showNotif("Error al cargar productos", "danger"); }
    finally { setLoading(false); }
  }, [busqueda, categoriaFiltro, sortField, sortDir]);
  
  useEffect(() => {
    const delay = setTimeout(fetchProductos, 300);
    return () => clearTimeout(delay);
  }, [fetchProductos]);


  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const sortIcon = (field) => sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  // Stats
  const totalProductos = productos.length;
  const totalStock = productos.reduce((s, p) => s + p.stock, 0);
  const valorInventario = productos.reduce((s, p) => s + p.precio * p.stock, 0);
  const stockBajo = productos.filter(p => p.stock < 30).length;

  // CRUD
  const abrirNuevo = () => {
    setForm({ nombre: "", categoria: "Ferretería", precio: "", stock: "", unidad: "unidad", proveedor: "", contacto: "" });
    setModal("nuevo");
  };
  const abrirEditar = (p) => {
    setProductoActual(p);
    setForm({ ...p });
    setModal("editar");
  };
  const abrirEliminar = (p) => {
    setProductoActual(p);
    setModal("eliminar");
  };
  const cerrarModal = () => { setModal(null); setProductoActual(null); };

  const guardarNuevo = async () => {
    if (!form.nombre || !form.precio || !form.stock) return;
    setGuardando(true);
    try {
      const res = await fetch(`${API_URL}/api/productos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, precio: Number(form.precio), stock: Number(form.stock) }),
      });
      const data = await res.json();
      if (data.ok) { cerrarModal(); fetchProductos(); showNotif("✓ Producto agregado"); }
    } catch { showNotif("Error al agregar producto", "danger"); }
    finally { setGuardando(false); }
  };
  const guardarEditar = async () => {
    setGuardando(true);
    try {
      const res = await fetch(`${API_URL}/api/productos/${productoActual.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, precio: Number(form.precio), stock: Number(form.stock) }),
      });
      const data = await res.json();
      if (data.ok) { cerrarModal(); fetchProductos(); showNotif("✓ Producto actualizado"); }
    } catch { showNotif("Error al actualizar", "danger"); }
    finally { setGuardando(false); }
  };
  const confirmarEliminar = async () => {
    setGuardando(true);
    try {
      const res = await fetch(`${API_URL}/api/productos/${productoActual.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setCotizacion(prev => prev.filter(c => c.id !== productoActual.id));
        cerrarModal(); fetchProductos(); showNotif("Producto eliminado", "danger");
      }
    } catch { showNotif("Error al eliminar", "danger"); }
    finally { setGuardando(false); }
  };
  // Cotización
  const agregarCotizacion = (p) => {
    setCotizacion(prev => {
      if (prev.find(c => c.id === p.id)) {
        showNotif("Ya está en la cotización");
        return prev;
      }
      showNotif("✓ Agregado a cotización");
      return [...prev, { ...p, cantidad: 1 }];
    });
  };
  const setCantidad = (id, val) => {
    const n = Math.max(1, Number(val) || 1);
    setCotizacion(prev => prev.map(c => c.id === id ? { ...c, cantidad: n } : c));
  };
  const quitarCotizacion = (id) => setCotizacion(prev => prev.filter(c => c.id !== id));
  const limpiarCotizacion = () => { setCotizacion([]); setClienteNombre(""); };

  const subtotal = cotizacion.reduce((s, c) => s + c.precio * c.cantidad, 0);
  const iva = Math.round(subtotal * 0.19);
  const total = subtotal + iva;

  // Export Excel (simulado — en producción va al backend)
  const exportarExcel = async () => {
    if (cotizacion.length === 0) return;
    setExportando(true);
    try {
      const res = await fetch(`${API_URL}/api/cotizaciones/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente: clienteNombre,
          items: cotizacion.map(c => ({ id: c.id, nombre: c.nombre, precio: Number(c.precio), cantidad: c.cantidad })),
          guardar: true,
        }),
      });
      if (!res.ok) throw new Error("Error en el servidor");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cotizacion-${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      showNotif("✓ Excel descargado");
    } catch { showNotif("Error al exportar Excel", "danger"); }
    finally { setExportando(false); }
  };

  const inCot = (id) => cotizacion.some(c => c.id === id);

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        {/* HEADER */}
        <header className="header">
          <div className="header-brand">
            <span>▣</span> INVENTARIO <span>/</span> SYS
          </div>
          <nav className="header-nav">
            <button className={`nav-btn ${view === "inventario" ? "active" : ""}`} onClick={() => setView("inventario")}>
              Inventario
            </button>
            <button className={`nav-btn ${view === "cotizacion" ? "active" : ""}`} onClick={() => setView("cotizacion")}>
              Cotización {cotizacion.length > 0 && <span className="badge">{cotizacion.length}</span>}
            </button>
          </nav>
        </header>

        <main className="main">
          {view === "inventario" && (
            <>
              {/* STATS */}
              <div className="stats">
                <div className="stat-card">
                  <div className="stat-label">Productos</div>
                  <div className="stat-value">{totalProductos}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Unidades totales</div>
                  <div className="stat-value">{totalStock.toLocaleString("es-CL")}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Valor inventario</div>
                  <div className="stat-value accent" style={{fontSize:"16px"}}>{fmt(valorInventario)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Stock bajo (&lt;30)</div>
                  <div className="stat-value" style={{color: stockBajo > 0 ? "var(--danger)" : "var(--success)"}}>{stockBajo}</div>
                </div>
              </div>

              {/* TOOLBAR */}
              <div className="toolbar">
                <div className="search-wrap">
                  <span className="search-icon">⌕</span>
                  <input
                    className="search-input"
                    placeholder="Buscar por nombre, ID o categoría..."
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                  />
                </div>
                <select className="filter-select" value={categoriaFiltro} onChange={e => setCategoriaFiltro(e.target.value)}>
                  {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
                </select>
                <button className="btn btn-primary" onClick={abrirNuevo}>+ Nuevo producto</button>
              </div>

              {/* TABLA */}
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => toggleSort("id")}>ID{sortIcon("id")}</th>
                      <th className="sortable" onClick={() => toggleSort("nombre")}>Nombre{sortIcon("nombre")}</th>
                      <th className="sortable" onClick={() => toggleSort("categoria")}>Categoría{sortIcon("categoria")}</th>
                      <th className="sortable" onClick={() => toggleSort("precio")}>Precio unit.{sortIcon("precio")}</th>
                      <th className="sortable" onClick={() => toggleSort("stock")}>Stock{sortIcon("stock")}</th>
                      <th>Unidad</th>
                      <th className="sortable" onClick={() => toggleSort("proveedor")}>Proveedor{sortIcon("proveedor")}</th>
                      <th>Contacto</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productos.length === 0 ? (
                      <tr className="empty-row"><td colSpan={7}>// sin resultados</td></tr>
                    ) : productos.map(p => (
                      <tr key={p.id}>
                        <td className="id-cell">#{String(p.id).padStart(4, "0")}</td>
                        <td>{p.nombre}</td>
                        <td><span className="cat-badge">{p.categoria}</span></td>
                        <td className="price-cell">{fmt(p.precio)}</td>
                        <td className={`stock-cell ${p.stock < 30 ? "stock-low" : "stock-ok"}`}>{p.stock}</td>
                        <td style={{color:"var(--text3)", fontFamily:"var(--mono)", fontSize:"11px"}}>{p.unidad}</td>
                            <td style={{fontSize:"12px"}}>{p.proveedor || <span style={{color:"var(--text3)"}}>—</span>}</td>
                            <td style={{fontFamily:"var(--mono)", fontSize:"11px", color:"var(--text2)"}}>{p.contacto || <span style={{color:"var(--text3)"}}>—</span>}</td>
                        <td>
                          <div className="actions">
                            <button className="btn btn-ghost btn-sm" onClick={() => abrirEditar(p)}>Editar</button>
                            <button
                              className={`btn btn-sm ${inCot(p.id) ? "btn-success" : "btn-ghost"}`}
                              onClick={() => agregarCotizacion(p)}
                            >
                              {inCot(p.id) ? "✓ En cot." : "+ Cotizar"}
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => abrirEliminar(p)}>✕</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{marginTop:"10px", fontFamily:"var(--mono)", fontSize:"11px", color:"var(--text3)"}}>
                {productos.length} de {productos.length} productos
              </div>
            </>
          )}

          {view === "cotizacion" && (
            <>
              <div className="toolbar">
                <div className="search-wrap">
                  <span className="search-icon">👤</span>
                  <input
                    className="search-input"
                    placeholder="Nombre del cliente..."
                    value={clienteNombre}
                    onChange={e => setClienteNombre(e.target.value)}
                  />
                </div>
                <div style={{fontFamily:"var(--mono)", fontSize:"11px", color:"var(--text3)", whiteSpace:"nowrap"}}>
                  COT-{String(cotNum).padStart(4,"0")}
                </div>
                <button className="btn btn-ghost" onClick={limpiarCotizacion}>Limpiar</button>
                <button className="btn btn-primary" onClick={exportarExcel} disabled={cotizacion.length === 0}>
                  ↓ Exportar Excel
                </button>
              </div>

              {cotizacion.length === 0 ? (
                <div className="cot-empty">
                  // cotización vacía — agrega productos desde Inventario
                </div>
              ) : (
                <>
                  <div className="cot-table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Producto</th>
                          <th>Precio unit.</th>
                          <th>Cantidad</th>
                          <th>Subtotal</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cotizacion.map(c => (
                          <tr key={c.id}>
                            <td className="id-cell">#{String(c.id).padStart(4,"0")}</td>
                            <td>{c.nombre}</td>
                            <td className="price-cell">{fmt(c.precio)}</td>
                            <td>
                              <input
                                className="qty-input"
                                type="number"
                                min="1"
                                value={c.cantidad}
                                onChange={e => setCantidad(c.id, e.target.value)}
                              />
                            </td>
                            <td className="price-cell">{fmt(c.precio * c.cantidad)}</td>
                            <td>
                              <button className="btn btn-danger btn-sm" onClick={() => quitarCotizacion(c.id)}>✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="cot-totals">
                    <div className="total-row">
                      <span className="total-label">Subtotal</span>
                      <span className="total-value">{fmt(subtotal)}</span>
                    </div>
                    <div className="total-row">
                      <span className="total-label">IVA (19%)</span>
                      <span className="total-value">{fmt(iva)}</span>
                    </div>
                    <hr className="divider" />
                    <div className="total-row grand">
                      <span className="total-label">Total</span>
                      <span className="total-value">{fmt(total)}</span>
                    </div>
                  </div>

                  <div style={{display:"flex", justifyContent:"flex-end"}}>
                    <button className="btn btn-primary" onClick={exportarExcel}>
                      ↓ Exportar cotización en Excel
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>

      {/* MODAL NUEVO/EDITAR */}
      {(modal === "nuevo" || modal === "editar") && (
        <div className="modal-overlay" onClick={cerrarModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{modal === "nuevo" ? "// Nuevo producto" : "// Editar producto"}</span>
              <button className="modal-close" onClick={cerrarModal}>×</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Nombre del producto</label>
                <input value={form.nombre || ""} onChange={e => setForm(f => ({...f, nombre: e.target.value}))} placeholder="Ej: Tornillo hexagonal 1/2&quot;" />
              </div>
              <div className="field">
                <label>Categoría</label>
                <select value={form.categoria || "Ferretería"} onChange={e => setForm(f => ({...f, categoria: e.target.value}))}>
                  {CATEGORIAS.filter(c => c !== "Todas").map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="fields-row">
                <div className="field">
                  <label>Precio unitario (CLP)</label>
                  <input type="number" value={form.precio || ""} onChange={e => setForm(f => ({...f, precio: e.target.value}))} placeholder="0" />
                </div>
                <div className="field">
                  <label>Stock</label>
                  <input type="number" value={form.stock || ""} onChange={e => setForm(f => ({...f, stock: e.target.value}))} placeholder="0" />
                </div>
              </div>
              <div className="fields-row">
                <div className="field">
                  <label>Proveedor</label>
                  <input value={form.proveedor || ""} onChange={e => setForm(f => ({...f, proveedor: e.target.value}))} placeholder="Nombre del proveedor" />
                </div>
                <div className="field">
                  <label>N° de contacto</label>
                  <input value={form.contacto || ""} onChange={e => setForm(f => ({...f, contacto: e.target.value}))} placeholder="+569..." />
                </div>
              </div>
              <div className="field">
                <label>Unidad de medida</label>
                <select value={form.unidad || "unidad"} onChange={e => setForm(f => ({...f, unidad: e.target.value}))}>
                  {["unidad","metro","kilo","saco","litro","galón","caja","rollo"].map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={cerrarModal}>Cancelar</button>
              <button className="btn btn-primary" onClick={modal === "nuevo" ? guardarNuevo : guardarEditar}>
                {modal === "nuevo" ? "Agregar" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ELIMINAR */}
      {modal === "eliminar" && (
        <div className="modal-overlay" onClick={cerrarModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">// Confirmar eliminación</span>
              <button className="modal-close" onClick={cerrarModal}>×</button>
            </div>
            <div className="modal-body">
              <p style={{fontFamily:"var(--mono)", fontSize:"12px", color:"var(--text2)", lineHeight:"1.6"}}>
                ¿Eliminar <strong style={{color:"var(--text)"}}>{productoActual?.nombre}</strong>?<br/>
                Esta acción no se puede deshacer.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={cerrarModal}>Cancelar</button>
              <button className="btn btn-danger" onClick={confirmarEliminar}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICACIÓN */}
      {notif && <div className={`notif ${notif.type}`}>{notif.msg}</div>}
    </>
  );
}