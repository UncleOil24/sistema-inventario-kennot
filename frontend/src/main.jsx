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
