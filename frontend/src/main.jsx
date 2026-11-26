import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorPantalla from './erp/ErrorPantalla.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorPantalla>
      <App />
    </ErrorPantalla>
  </StrictMode>,
)

// Instalable en el celular y receptor de archivos compartidos (WhatsApp, Archivos…)
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
