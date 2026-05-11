# InventarioSys — Backend

API REST para el sistema de inventario. Node.js + Express + PostgreSQL + ExcelJS.

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/productos | Listar productos (filtros: busqueda, categoria, sort, dir) |
| GET | /api/productos/:id | Obtener producto |
| POST | /api/productos | Crear producto |
| PUT | /api/productos/:id | Actualizar producto |
| DELETE | /api/productos/:id | Eliminar producto |
| GET | /api/cotizaciones | Listar cotizaciones |
| GET | /api/cotizaciones/:id | Obtener cotización |
| POST | /api/cotizaciones/export | Generar y descargar Excel |

## Instalar y correr localmente

```bash
npm install
cp .env.example .env
# Editar .env con tus datos de Supabase
npm run dev
```

## Deploy en Render (gratis)

1. Crea cuenta en https://render.com
2. New → Web Service → conecta tu repositorio GitHub
3. Configurar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. En "Environment Variables" agrega:
   - `DATABASE_URL` → connection string de Supabase
   - `FRONTEND_URL` → URL de tu app en Vercel
   - `NODE_ENV` → production

## Base de datos en Supabase (gratis)

1. Crea cuenta en https://supabase.com
2. New project → anota el password
3. Ve a Settings → Database → Connection string (URI)
4. Pega ese string en `DATABASE_URL` del .env

## Estructura del proyecto

```
inventario-backend/
├── index.js                    # Servidor principal
├── config/
│   └── database.js             # Conexión Sequelize
└── src/
    ├── controllers/
    │   ├── productosController.js
    │   └── cotizacionesController.js
    ├── models/
    │   ├── Producto.js
    │   └── Cotizacion.js
    ├── routes/
    │   ├── productos.js
    │   └── cotizaciones.js
    └── middlewares/
        └── errorHandler.js
```

## Ejemplo: exportar cotización desde el frontend

```js
const exportarExcel = async () => {
  const res = await fetch(`${API_URL}/api/cotizaciones/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cliente: "Juan Pérez",
      items: cotizacion, // [{ id, nombre, precio, cantidad }]
      guardar: true,
    }),
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cotizacion.xlsx";
  a.click();
};
```
