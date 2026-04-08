# RESIDENTE-THALAMUS

Este proyecto ya esta preparado para publicarse como frontend estatico desde GitHub o Cloudflare Pages.

## Que ya quedo conectado

- Frontend: `index.html`, `styles.css`, `app.js`, `auth.js`, `libros.js`, `documentos.js`
- Backend activo: `https://residente.sewyllconstrucciones.workers.dev`
- KV configurado en `wrangler.toml`

## Como publicar sin PowerShell complicado

1. Entra a tu repositorio en GitHub.
2. Sube estos archivos del proyecto:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `auth.js`
   - `libros.js`
   - `documentos.js`
3. Confirma los cambios en la rama principal.
4. Espera a que Cloudflare Pages detecte el cambio y publique solo.
5. Abre tu dominio publicado y prueba entrar con:
   - usuario: `admin`
   - contrasena: `admin`

## Importante

- Para publicar el frontend no necesitas correr `npx wrangler deploy`.
- El archivo `worker.js` queda en el repo solo como referencia tecnica del backend.
- Si algun dia cambias el backend de Cloudflare Worker, debes volver a desplegarlo por separado.
