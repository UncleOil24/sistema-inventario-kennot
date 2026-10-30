import { useState, useEffect, useCallback } from "react";
import Dashboard from "./erp/Dashboard";
import Ventas from "./erp/Ventas";
import Compras from "./erp/Compras";
import Proveedores from "./erp/Proveedores";
import Catalogo from "./erp/Catalogo";
import Cotizador from "./erp/Cotizador";
import Cotizaciones from "./erp/Cotizaciones";
import Clientes from "./erp/Clientes";
import Gastos from "./erp/Gastos";
import Reportes from "./erp/Reportes";
import Config from "./erp/Config";
import Licitaciones from "./erp/Licitaciones";
import { api, getToken, setToken, invalidarProductos, lineaDesdeProducto } from "./erp/lib";
import Login from "./erp/Login";
import Usuarios from "./erp/Usuarios";
import CambiarPassword from "./erp/CambiarPassword";

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0d0e0f; --surface: #141618; --surface2: #1c1f22;
    --border: #2a2d31; --border2: #363a3f;
    --accent: #e8c547; --accent2: #c9a82e;
    --danger: #e05252; --success: #4caf7d;
    --text: #e2e4e7; --text2: #8b9099; --text3: #555c66;
    --mono: 'IBM Plex Mono', monospace; --sans: 'IBM Plex Sans', sans-serif;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--sans); min-height: 100vh; }
  /* Anula el layout de la plantilla de Vite (index.css) que centraba todo */
  #root { width: 100%; max-width: none; text-align: left; border: none; font-size: 14px; letter-spacing: normal; }
  .app { display: flex; flex-direction: column; min-height: 100vh; }
  .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 2rem; display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 56px; position: sticky; top: 0; z-index: 100; }
  .header-brand { flex-shrink: 0; display: flex; align-items: center; gap: 10px; font-family: var(--mono); font-size: 13px; font-weight: 600; letter-spacing: 0.12em; color: var(--accent); text-transform: uppercase; }
  .header-brand span { color: var(--text3); }
  .header-nav { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
  .header-nav::-webkit-scrollbar { display: none; }
  .nav-sep { width: 1px; background: var(--border); margin: 8px 6px; flex-shrink: 0; }
  .nav-btn { background: none; border: none; cursor: pointer; padding: 6px 14px; border-radius: 4px; font-family: var(--mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--text2); text-transform: uppercase; transition: all 0.15s; }
  .nav-btn:hover { color: var(--text); background: var(--surface2); }
  .nav-btn.active { color: var(--accent); background: rgba(232,197,71,0.08); }
  .badge { background: var(--accent); color: #000; border-radius: 10px; padding: 1px 7px; font-size: 10px; font-weight: 600; margin-left: 6px; }
  .main { flex: 1; padding: 2rem; max-width: 1400px; margin: 0 auto; width: 100%; }
  .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .search-wrap { position: relative; flex: 1; min-width: 220px; }
  .search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text3); font-size: 14px; pointer-events: none; }
  .search-input { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 9px 12px 9px 36px; font-family: var(--mono); font-size: 12px; color: var(--text); outline: none; transition: border-color 0.15s; }
  .search-input::placeholder { color: var(--text3); }
  .search-input:focus { border-color: var(--border2); }
  .filter-select { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 9px 12px; font-family: var(--mono); font-size: 12px; color: var(--text2); outline: none; cursor: pointer; min-width: 130px; }
  .filter-select option { background: var(--surface2); }
  .btn { border: none; border-radius: 6px; padding: 9px 16px; cursor: pointer; font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; transition: all 0.15s; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #000; }
  .btn-primary:hover:not(:disabled) { background: var(--accent2); }
  .btn-ghost { background: var(--surface); border: 1px solid var(--border); color: var(--text2); }
  .btn-ghost:hover:not(:disabled) { border-color: var(--border2); color: var(--text); }
  .btn-danger { background: rgba(224,82,82,0.12); border: 1px solid rgba(224,82,82,0.3); color: var(--danger); }
  .btn-danger:hover:not(:disabled) { background: rgba(224,82,82,0.2); }
  .btn-success { background: rgba(76,175,125,0.12); border: 1px solid rgba(76,175,125,0.3); color: var(--success); }
  .btn-success:hover:not(:disabled) { background: rgba(76,175,125,0.2); }
  .btn-sm { padding: 5px 10px; font-size: 10px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 1.5rem; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .stat-label { font-family: var(--mono); font-size: 10px; color: var(--text3); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6px; }
  .stat-value { font-family: var(--mono); font-size: 22px; font-weight: 600; color: var(--text); }
  .stat-value.accent { color: var(--accent); font-size: 16px; }
  .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow-x: auto; }
  .table { width: 100%; border-collapse: collapse; }
  .table th { background: var(--surface2); padding: 10px 14px; font-family: var(--mono); font-size: 10px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: 0.1em; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; cursor: pointer; }
  .table th:hover { color: var(--text2); }
  .table td { padding: 11px 14px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: middle; }
  .table tr:last-child td { border-bottom: none; }
  .table tr:hover td { background: rgba(255,255,255,0.02); }
  .id-cell { font-family: var(--mono); font-size: 11px; color: var(--text3); }
  .price-cell { font-family: var(--mono); font-size: 12px; color: var(--accent); }
  .price-cell.compra { color: var(--text2); }
  .stock-cell { font-family: var(--mono); font-size: 12px; }
  .stock-low { color: var(--danger); }
  .stock-ok { color: var(--success); }
  .cat-badge { background: var(--surface2); border: 1px solid var(--border2); border-radius: 4px; padding: 2px 8px; font-family: var(--mono); font-size: 10px; color: var(--text2); }
  .actions { display: flex; gap: 6px; }
  .empty-row td { text-align: center; padding: 3rem; color: var(--text3); font-family: var(--mono); font-size: 12px; }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; margin-right: 6px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 1rem; animation: fadeIn 0.15s ease; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .modal { background: var(--surface); border: 1px solid var(--border2); border-radius: 10px; width: 100%; max-width: 480px; animation: slideUp 0.2s ease; }
  @keyframes slideUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .modal-header { padding: 18px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .modal-title { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--text); letter-spacing: 0.05em; }
  .modal-close { background: none; border: none; color: var(--text3); cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 4px; }
  .modal-close:hover { color: var(--text); background: var(--surface2); }
  .modal-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .modal-footer { padding: 16px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label { font-family: var(--mono); font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.08em; }
  .field input, .field select { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 9px 12px; font-family: var(--mono); font-size: 12px; color: var(--text); outline: none; transition: border-color 0.15s; width: 100%; }
  .field input:focus, .field select:focus { border-color: var(--accent); }
  .field select option { background: var(--surface2); }
  .fields-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .cot-empty { text-align: center; padding: 3rem 2rem; color: var(--text3); font-family: var(--mono); font-size: 12px; }
  .cot-table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 1rem; }
  .cot-totals { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 1rem; }
  .total-row { display: flex; justify-content: space-between; align-items: center; }
  .total-label { font-family: var(--mono); font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.08em; }
  .total-value { font-family: var(--mono); font-size: 13px; color: var(--text); }
  .total-row.grand .total-label { color: var(--accent); font-size: 12px; }
  .total-row.grand .total-value { font-size: 20px; color: var(--accent); font-weight: 600; }
  .divider { border: none; border-top: 1px solid var(--border); margin: 4px 0; }
  .qty-input { background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; width: 60px; font-family: var(--mono); font-size: 12px; color: var(--text); outline: none; text-align: center; }
  .qty-input:focus { border-color: var(--accent); }
  .notif { position: fixed; bottom: 24px; right: 24px; background: var(--surface2); border: 1px solid var(--border2); border-radius: 8px; padding: 12px 18px; font-family: var(--mono); font-size: 12px; color: var(--text); z-index: 300; animation: slideUp 0.2s ease; display: flex; align-items: center; gap: 8px; }
  .notif.success { border-color: var(--success); color: var(--success); }
  .notif.danger { border-color: var(--danger); color: var(--danger); }
  .hist-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .hist-info { display: flex; flex-direction: column; gap: 4px; flex: 1; }
  .hist-nombre { font-size: 14px; font-weight: 500; color: var(--text); }
  .hist-meta { font-family: var(--mono); font-size: 11px; color: var(--text3); display: flex; gap: 16px; flex-wrap: wrap; }
  .hist-total { font-family: var(--mono); font-size: 14px; color: var(--accent); font-weight: 600; white-space: nowrap; }
  .hist-list { display: flex; flex-direction: column; gap: 10px; }
  .hist-detalle { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px; }
  /* ---------- Login y sesión ---------- */
  .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .login-card { width: 100%; max-width: 360px; background: var(--surface); border: 1px solid var(--border2); border-radius: 10px; padding: 28px 24px; display: flex; flex-direction: column; gap: 14px; }
  .login-error { background: rgba(224,82,82,0.1); border: 1px solid rgba(224,82,82,0.3); color: var(--danger); border-radius: 6px; padding: 9px 12px; font-family: var(--mono); font-size: 12px; }
  .user-menu { position: relative; flex-shrink: 0; }
  .user-btn { display: flex; align-items: center; gap: 8px; background: none; border: 1px solid var(--border); border-radius: 18px; padding: 3px 10px 3px 3px; cursor: pointer; color: var(--text); font-family: var(--mono); font-size: 11px; }
  .user-btn:hover { border-color: var(--border2); }
  .user-avatar { width: 26px; height: 26px; border-radius: 50%; background: var(--accent); color: #000; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px; }
  .rol-badge { font-family: var(--mono); font-size: 9px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border2); color: var(--text2); }
  .rol-admin { color: var(--accent); border-color: rgba(232,197,71,0.4); }
  .menu-fondo { position: fixed; inset: 0; z-index: 150; }
  .menu-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 151; background: var(--surface2); border: 1px solid var(--border2); border-radius: 8px; min-width: 220px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); display: flex; flex-direction: column; overflow: hidden; }
  .menu-info { padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
  .menu-pop button { background: none; border: none; text-align: left; padding: 10px 14px; color: var(--text); font-family: var(--mono); font-size: 12px; cursor: pointer; }
  .menu-pop button:hover { background: rgba(255,255,255,0.04); }
  .menu-pop button.peligro { color: var(--danger); }
  .field input:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 768px) { .user-nombre, .user-btn .rol-badge { display: none; } .user-btn { padding: 3px; } }

  /* ---------- ERP ---------- */
  :root { --serie-1: #3987e5; --serie-2: #d95926; --warn: #e8a33d; --info: #5b9bd5; }
  .mini { font-family: var(--mono); font-size: 11px; color: var(--text3); }
  .estado { display: inline-block; border-radius: 4px; padding: 2px 8px; font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid; white-space: nowrap; }
  .estado-ok { color: var(--success); border-color: rgba(76,175,125,0.35); background: rgba(76,175,125,0.08); }
  .estado-warn { color: var(--warn); border-color: rgba(232,163,61,0.35); background: rgba(232,163,61,0.08); }
  .estado-info { color: var(--info); border-color: rgba(91,155,213,0.35); background: rgba(91,155,213,0.08); }
  .estado-neutral { color: var(--text2); border-color: var(--border2); background: var(--surface2); }
  .estado-muted { color: var(--text3); border-color: var(--border); background: transparent; text-decoration: line-through; }
  .fila-anulada td { opacity: 0.45; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 10px; min-width: 0; overflow-x: auto; }
  .modal .panel { background: var(--surface2); margin-bottom: 0; }
  .panel-titulo { font-family: var(--mono); font-size: 11px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.08em; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .table-compacta td, .table-compacta th { padding: 7px 10px; font-size: 12px; }
  .table-compacta th { cursor: default; }
  .id-cell, .price-cell, .stock-cell, td.mini { white-space: nowrap; }
  .pago-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .pago-form input, .pago-form select { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-family: var(--mono); font-size: 12px; color: var(--text); outline: none; flex: 1; min-width: 110px; }
  .pago-form input:focus { border-color: var(--accent); }
  .check { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 12px; color: var(--text2); cursor: pointer; }
  .check input { accent-color: var(--accent); width: 16px; height: 16px; }
  .aviso { background: rgba(232,163,61,0.08); border: 1px solid rgba(232,163,61,0.3); color: var(--warn); border-radius: 6px; padding: 10px 14px; font-family: var(--mono); font-size: 12px; margin-bottom: 1rem; }
  .items-editor { display: flex; flex-direction: column; gap: 10px; }
  .sugerencias { position: absolute; top: 100%; left: 0; right: 0; z-index: 10; background: var(--surface2); border: 1px solid var(--border2); border-radius: 6px; margin-top: 4px; max-height: 260px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
  .sugerencia { width: 100%; display: flex; justify-content: space-between; gap: 10px; background: none; border: none; border-bottom: 1px solid var(--border); padding: 9px 12px; color: var(--text); font-family: var(--sans); font-size: 13px; text-align: left; cursor: pointer; }
  .sugerencia:hover { background: rgba(232,197,71,0.08); }
  .sug-meta { font-family: var(--mono); font-size: 11px; color: var(--text3); white-space: nowrap; }
  .modal { max-height: calc(100vh - 2rem); display: flex; flex-direction: column; }
  .modal-body { overflow-y: auto; }
  .dash-titulo { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--text); letter-spacing: 0.06em; text-transform: uppercase; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 1rem; }
  .clickable { cursor: pointer; transition: border-color 0.15s; }
  .clickable:hover { border-color: var(--border2); }
  .dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr)); gap: 0 16px; }
  .cot-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .cot-kpis .stat-value { font-size: 18px; }
  .leyenda { display: flex; gap: 16px; font-family: var(--mono); font-size: 11px; color: var(--text2); }
  .leyenda i, .tooltip i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
  .grafico-area { display: flex; gap: 8px; height: 220px; margin-top: 8px; }
  .grafico-eje { position: relative; font-family: var(--mono); font-size: 10px; color: var(--text3); min-width: 48px; }
  .grafico-eje span { position: absolute; right: 0; transform: translateY(50%); white-space: nowrap; }
  .grafico-barras { flex: 1; display: flex; position: relative; padding-bottom: 22px; }
  .grid-capa { position: absolute; inset: 0 0 22px 0; pointer-events: none; }
  .grid-line { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--border); }
  .grid-line.base { border-top-style: solid; border-color: var(--border2); }
  .grupo { flex: 1; position: relative; display: flex; flex-direction: column; justify-content: flex-end; cursor: default; min-width: 0; }
  .grupo:hover { background: rgba(255,255,255,0.025); }
  .barras-par { display: flex; align-items: flex-end; justify-content: center; gap: 2px; height: 100%; }
  .barra { width: min(22px, 32%); border-radius: 4px 4px 0 0; min-height: 0; transition: height 0.3s; }
  .grupo-label { position: absolute; bottom: -18px; left: 0; right: 0; text-align: center; font-family: var(--mono); font-size: 10px; color: var(--text3); white-space: nowrap; }
  .tooltip { position: absolute; bottom: 60%; left: 50%; z-index: 5; background: var(--surface2); border: 1px solid var(--border2); border-radius: 6px; padding: 10px 12px; font-family: var(--mono); font-size: 11px; color: var(--text); white-space: nowrap; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); pointer-events: none; }
  .tooltip.izq { left: auto; right: 50%; }
  .grafico-vacio { position: absolute; inset: 0 0 22px 0; display: flex; align-items: center; justify-content: center; font-family: var(--mono); font-size: 12px; color: var(--text3); }
  @media (max-width: 768px) {
    .dash-grid { grid-template-columns: 1fr; }
    .header-brand { font-size: 11px; }
    .stats { grid-template-columns: repeat(2, 1fr); }
    .header { padding: 0 1rem; }
    .main { padding: 1rem; }
    .fields-row { grid-template-columns: 1fr; }
  }

  /* ---------- Ventas y cotizaciones ---------- */
  .col-desc { min-width: 300px; }
  .textarea { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 9px 12px; font-family: var(--sans); font-size: 12px; color: var(--text); outline: none; width: 100%; resize: vertical; }
  .select-linea { background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px; font-family: var(--mono); font-size: 11px; color: var(--text); max-width: 340px; width: 100%; }
  .nav-btn { padding: 6px 10px; }
  .fila-alerta td { background: rgba(232,197,71,0.13); }
  .link { background: none; border: none; color: var(--info); cursor: pointer; font-family: var(--mono); font-size: 11px; padding: 2px 4px; text-align: left; }
  .link:hover:not(:disabled) { text-decoration: underline; }
  .link:disabled { color: var(--text3); cursor: not-allowed; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 5px 12px; font-family: var(--mono); font-size: 11px; color: var(--text2); cursor: pointer; }
  .chip:hover { border-color: var(--border2); color: var(--text); }
  .chip.activo { border-color: var(--accent); color: var(--accent); background: rgba(232,197,71,0.08); }
  .chip-alerta { border-color: rgba(232,163,61,0.6); color: var(--warn); }
  .antiguo { color: var(--warn); }
  .lic-nueva { border-left: 3px solid var(--accent); }
  .link-mini { text-decoration: underline; cursor: pointer; }
  .chip strong { margin-left: 4px; color: var(--text); }
  .resumen-utilidad { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .resumen-utilidad > div, .vigente > div { display: flex; flex-direction: column; gap: 2px; }
  .resumen-utilidad strong, .vigente strong { font-family: var(--mono); font-size: 16px; color: var(--text); }
  .vigente { display: grid; grid-template-columns: 2fr repeat(4, 1fr); gap: 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
  .vigente-principal strong { font-size: 20px; color: var(--accent); }
  .vigente-principal .estado { align-self: flex-start; margin-top: 4px; }
  .ok-confirm { color: var(--success); margin-left: 4px; font-size: 11px; }
  .revisar-cell { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fields-row.tres { grid-template-columns: 1fr 1fr 1fr; }
  tfoot td { border-top: 1px solid var(--border2); background: var(--surface2); }
  tr.clickable { cursor: pointer; }
  @media (max-width: 768px) { .vigente { grid-template-columns: 1fr 1fr; } .fields-row.tres { grid-template-columns: 1fr; } }
  @media print {
    body * { visibility: hidden; }
    .cuadro-imprimible, .cuadro-imprimible * { visibility: visible; color: #000 !important; background: #fff !important; }
    .cuadro-imprimible { position: absolute; left: 0; top: 0; width: 100%; }
    .cuadro-imprimible button.link, .cuadro-imprimible .btn { display: none; }
  }
`;

// Raíz: decide entre pantalla de login y el sistema
export default function Root() {
  const [usuario, setUsuario] = useState(null);
  const [verificando, setVerificando] = useState(() => !!getToken());
  const [aviso, setAviso] = useState("");

  // Al cargar, si hay token guardado, se valida contra el backend
  useEffect(() => {
    if (!getToken()) return;
    api("/auth/me")
      .then(setUsuario)
      .catch(() => setToken(null))
      .finally(() => setVerificando(false));
  }, []);

  // Cualquier 401 (token vencido, contraseña cambiada, usuario desactivado) vuelve al login
  useEffect(() => {
    const salir = (e) => { setToken(null); setUsuario(null); setAviso(e.detail || "Tu sesión expiró"); };
    window.addEventListener("sesion-expirada", salir);
    return () => window.removeEventListener("sesion-expirada", salir);
  }, []);

  const cerrarSesion = () => { setToken(null); setUsuario(null); setAviso(""); };

  return (
    <>
      <style>{styles}</style>
      {verificando ? (
        <div className="login-wrap"><span className="spinner"></span></div>
      ) : usuario ? (
        <App key={usuario.id} usuario={usuario} onLogout={cerrarSesion} />
      ) : (
        <Login aviso={aviso} onEntrar={(u) => { setAviso(""); setUsuario(u); }} />
      )}
    </>
  );
}

const BORRADOR_VACIO = { cliente_id: "", tipo_precio: "convenio", nombre_cotizacion: "", validez_dias: 30, notas: "", items: [] };

function App({ usuario, onLogout }) {
  const esAdmin = usuario.rol === "admin";
  const [menuUsuario, setMenuUsuario] = useState(false);
  const [cambiarPass, setCambiarPass] = useState(false);
  const [view, setView] = useState("dashboard");
  const [notif, setNotif] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [loadingClientes, setLoadingClientes] = useState(false);
  const [proveedores, setProveedores] = useState([]);
  const [loadingProveedores, setLoadingProveedores] = useState(false);
  const [borrador, setBorrador] = useState(BORRADOR_VACIO); // cotización en armado
  const [ventaAbrir, setVentaAbrir] = useState(null);
  const [ordenAbrir, setOrdenAbrir] = useState(null);

  const showNotif = useCallback((msg, type = "success") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), type === "danger" ? 4500 : 2800);
  }, []);

  const fetchClientes = useCallback(async () => {
    setLoadingClientes(true);
    try { setClientes(await api("/clientes")); }
    catch { showNotif("Error al cargar clientes", "danger"); }
    finally { setLoadingClientes(false); }
  }, [showNotif]);
  const fetchProveedores = useCallback(async () => {
    setLoadingProveedores(true);
    try { setProveedores(await api("/proveedores")); }
    catch { showNotif("Error al cargar proveedores", "danger"); }
    finally { setLoadingProveedores(false); }
  }, [showNotif]);
  useEffect(() => { fetchClientes(); fetchProveedores(); }, [fetchClientes, fetchProveedores]);

  // Agregar al cotizador desde el catálogo
  const enCotizacion = (id) => borrador.items.some((i) => i.producto_id === id);
  const cotizarProducto = (p) => {
    if (enCotizacion(p.id)) { showNotif("Ya está en la cotización"); return; }
    const cliente = clientes.find((c) => String(c.id) === String(borrador.cliente_id));
    const tipo = borrador.tipo_precio || cliente?.tipo || "convenio";
    setBorrador((b) => ({ ...b, items: [...b.items, lineaDesdeProducto(p, tipo)] }));
    showNotif("✓ Agregado a la cotización");
  };

  const [filtroCot, setFiltroCot] = useState("");
  const irA = (vista, id) => {
    if (vista === "ventas" && id) setVentaAbrir(id);
    if (vista === "cotizaciones-seguir") { setFiltroCot("seguir"); setView("cotizaciones"); return; }
    if (vista === "cotizaciones") setFiltroCot("");
    setView(vista);
  };
  const verVenta = (id) => { setVentaAbrir(id); setView("ventas"); };
  const verOrden = (id) => { setOrdenAbrir(id); setView("compras"); };

  const nav = (id, texto, extra) => (
    <button className={`nav-btn ${view === id ? "active" : ""}`} onClick={() => { if (id === "cotizaciones") setFiltroCot(""); setView(id); }}>{texto}{extra}</button>
  );

  return (
    <>
      <div className="app">
        <header className="header">
          <div className="header-brand"><span>▣</span> KENOTT <span>/</span> VENTAS</div>
          <nav className="header-nav">
            {nav("dashboard", "Inicio")}
            {nav("catalogo", "Catálogo")}
            <span className="nav-sep" />
            {nav("cotizar", "Cotizar", borrador.items.length > 0 && <span className="badge">{borrador.items.length}</span>)}
            {nav("cotizaciones", "Cotizaciones")}
            {nav("licitaciones", "Licitaciones")}
            {nav("ventas", "Ventas")}
            {nav("clientes", "Clientes")}
            <span className="nav-sep" />
            {nav("compras", "Compras")}
            {nav("proveedores", "Proveedores")}
            {esAdmin && nav("gastos", "Gastos")}
            {esAdmin && <>
              <span className="nav-sep" />
              {nav("reportes", "Reportes")}
              {nav("config", "Config.")}
              {nav("usuarios", "Usuarios")}
            </>}
          </nav>
          <div className="user-menu">
            <button className="user-btn" onClick={() => setMenuUsuario((m) => !m)}>
              <span className="user-avatar">{usuario.nombre.trim().charAt(0).toUpperCase()}</span>
              <span className="user-nombre">{usuario.nombre.split(" ")[0]}</span>
              <span className={`rol-badge rol-${usuario.rol}`}>{usuario.rol}</span>
            </button>
            {menuUsuario && (
              <>
                <div className="menu-fondo" onClick={() => setMenuUsuario(false)} />
                <div className="menu-pop">
                  <div className="menu-info">
                    <strong>{usuario.nombre}</strong>
                    <span className="mini">{usuario.email}</span>
                  </div>
                  <button onClick={() => { setMenuUsuario(false); setCambiarPass(true); }}>Cambiar contraseña</button>
                  <button className="peligro" onClick={onLogout}>Cerrar sesión</button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="main">
          {view === "dashboard" && <Dashboard notify={showNotif} irA={irA} esAdmin={esAdmin} />}
          {view === "catalogo" && (
            <Catalogo esAdmin={esAdmin} notify={showNotif} enCotizacion={enCotizacion} onCotizar={cotizarProducto} proveedores={proveedores} />
          )}
          {view === "cotizar" && (
            <Cotizador borrador={borrador} setBorrador={setBorrador} clientes={clientes} esAdmin={esAdmin} notify={showNotif}
              irAClientes={() => setView("clientes")} onGuardada={() => setView("cotizaciones")} />
          )}
          {view === "cotizaciones" && (
            <Cotizaciones key={filtroCot} filtroInicial={filtroCot} esAdmin={esAdmin} notify={showNotif} verVenta={verVenta}
              onEditar={(b) => { setBorrador(b); setView("cotizar"); }}
              onVenta={(v) => verVenta(v.id)} />
          )}
          {view === "licitaciones" && (
            <Licitaciones esAdmin={esAdmin} notify={showNotif} clientes={clientes}
              onCotizar={(b) => { setBorrador(b); setView("cotizar"); }} />
          )}
          {view === "ventas" && (
            <Ventas notify={showNotif} esAdmin={esAdmin} clientes={clientes} abrirVentaId={ventaAbrir} onAbierta={() => setVentaAbrir(null)} irACompra={verOrden} />
          )}
          {view === "clientes" && <Clientes esAdmin={esAdmin} clientes={clientes} loading={loadingClientes} recargar={fetchClientes} notify={showNotif} />}
          {view === "compras" && (
            <Compras notify={showNotif} esAdmin={esAdmin} proveedores={proveedores} onPreciosCambio={invalidarProductos}
              abrirOrdenId={ordenAbrir} onAbierta={() => setOrdenAbrir(null)} />
          )}
          {view === "proveedores" && (
            <Proveedores esAdmin={esAdmin} proveedores={proveedores} loading={loadingProveedores} recargar={fetchProveedores} notify={showNotif} />
          )}
          {view === "gastos" && esAdmin && <Gastos notify={showNotif} />}
          {view === "reportes" && esAdmin && <Reportes notify={showNotif} />}
          {view === "config" && esAdmin && <Config notify={showNotif} />}
          {view === "usuarios" && esAdmin && <Usuarios notify={showNotif} yo={usuario} />}
        </main>
      </div>

      {cambiarPass && <CambiarPassword notify={showNotif} onClose={() => setCambiarPass(false)} />}
      {notif && <div className={`notif ${notif.type}`}>{notif.msg}</div>}
    </>
  );
}
