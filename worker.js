/**
 * LIBRO DE OBRAS — Cloudflare Worker API
 * KV Namespace binding: LIBRO_OBRAS
 *
 * wrangler.toml:
 *   [[kv_namespaces]]
 *   binding = "LIBRO_OBRAS"
 *   id = "TU_KV_NAMESPACE_ID"
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

function genToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a).map(x => x.toString(16).padStart(2, '0')).join('');
}

// ─── CRYPTO ───────────────────────────────────────────────────────────────────
async function hashPass(pass, salt, it = 120000) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: it },
    key, 256
  );
  return Array.from(new Uint8Array(bits)).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function makeHash(pass) {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  const salt = Array.from(a).map(x => x.toString(16).padStart(2, '0')).join('');
  return { salt, it: 120000, hash: await hashPass(pass, salt) };
}

// ─── KV HELPERS ───────────────────────────────────────────────────────────────
const kv = {
  async get(env, key) {
    const raw = await env.LIBRO_OBRAS.get(key);
    return raw ? JSON.parse(raw) : null;
  },
  async set(env, key, val) {
    await env.LIBRO_OBRAS.put(key, JSON.stringify(val));
  },
  async del(env, key) {
    await env.LIBRO_OBRAS.delete(key);
  },
  async session(env, key, userId) {
    // 24h session
    await env.LIBRO_OBRAS.put('session:' + key, userId, { expirationTtl: 86400 });
  },
  async getSession(env, key) {
    return env.LIBRO_OBRAS.get('session:' + key);
  },
};

// ─── SEED DEFAULT ADMIN ───────────────────────────────────────────────────────
async function ensureAdmin(env) {
  let users = await kv.get(env, 'users') || [];
  if (!users.length) {
    const hashed = await makeHash('admin');
    users = [{
      id: 'u1',
      nombre: 'Administrador',
      login: 'admin',
      email: 'admin@local.app',
      rol: 'admin',
      obras: [],
      ...hashed,
    }];
    await kv.set(env, 'users', users);
  }
  return users;
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
async function getSessionUser(env, req) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const userId = await kv.getSession(env, token);
  if (!userId) return null;
  const users = await kv.get(env, 'users') || [];
  return users.find(u => u.id === userId) || null;
}

function canEdit(u) { return u && (u.rol === 'admin' || u.rol === 'residente'); }
function isAdmin(u) { return u && u.rol === 'admin'; }

function safeUser(u) {
  const { hash, salt, it, pass, ...safe } = u;
  return safe;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url  = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    await ensureAdmin(env);

    // ── LOGIN ────────────────────────────────────────────────────────────────
    if (path === '/api/login' && method === 'POST') {
      const { login: l, pass: p } = await req.json().catch(() => ({}));
      if (!l || !p) return err('Ingrese usuario y contraseña.');

      const ll = l.toLowerCase().trim();
      const users = await kv.get(env, 'users') || [];
      const u = users.find(x =>
        (x.login || '').toLowerCase() === ll ||
        (x.email  || '').toLowerCase() === ll
      );
      if (!u) return err('Usuario no encontrado.', 401);

      let ok = false;
      if (u.hash && u.salt) {
        try { ok = (await hashPass(p, u.salt, u.it || 120000)) === u.hash; } catch (_) {}
      }
      if (!ok && u.pass) ok = u.pass === p;

      if (!ok) return err('Contraseña incorrecta.', 401);

      // Migrate plaintext → hash if needed
      if (ok && (!u.hash || u.pass)) {
        const idx = users.findIndex(x => x.id === u.id);
        Object.assign(users[idx], await makeHash(p));
        delete users[idx].pass;
        await kv.set(env, 'users', users);
      }

      const token = genToken();
      await kv.session(env, token, u.id);
      return json({ token, user: safeUser(u) });
    }

    // ── LOGOUT ───────────────────────────────────────────────────────────────
    if (path === '/api/logout' && method === 'POST') {
      const auth = req.headers.get('Authorization') || '';
      const token = auth.replace('Bearer ', '').trim();
      if (token) await kv.del(env, 'session:' + token);
      return json({ ok: true });
    }

    // All routes below require a valid session
    const me = await getSessionUser(env, req);
    if (!me) return err('No autorizado.', 401);

    // ── USERS ────────────────────────────────────────────────────────────────
    if (path === '/api/users') {
      if (!isAdmin(me)) return err('Sin permiso.', 403);

      if (method === 'GET') {
        const users = await kv.get(env, 'users') || [];
        return json(users.map(safeUser));
      }

      if (method === 'POST') {
        const { nombre, login, email, rol, pass: pw, obras } = await req.json().catch(() => ({}));
        if (!nombre || !login) return err('Nombre y usuario son obligatorios.');
        const users = await kv.get(env, 'users') || [];
        const dup = users.find(u =>
          (u.login || '').toLowerCase() === login.toLowerCase() ||
          (email && (u.email || '').toLowerCase() === email.toLowerCase())
        );
        if (dup) return err('Ese usuario o email ya existe.');
        if (!pw) return err('Contraseña obligatoria.');
        const hashed = await makeHash(pw);
        const nu = {
          id: uid(), nombre, login,
          email: email || '',
          rol: rol || 'viewer',
          obras: (rol === 'admin') ? [] : (obras || []),
          ...hashed,
        };
        users.push(nu);
        await kv.set(env, 'users', users);
        return json(safeUser(nu), 201);
      }
    }

    if (path.match(/^\/api\/users\/[^/]+$/)) {
      if (!isAdmin(me)) return err('Sin permiso.', 403);
      const id = path.split('/')[3];
      const users = await kv.get(env, 'users') || [];
      const idx = users.findIndex(u => u.id === id);
      if (idx < 0) return err('Usuario no encontrado.', 404);

      if (method === 'PUT') {
        const { nombre, login, email, rol, pass: pw, obras } = await req.json().catch(() => ({}));
        const dup = users.find(u => u.id !== id && (u.login || '').toLowerCase() === (login || '').toLowerCase());
        if (dup) return err('Ese usuario ya existe.');
        Object.assign(users[idx], {
          nombre, login,
          email: email || '',
          rol,
          obras: (rol === 'admin') ? [] : (obras || []),
        });
        if (pw) Object.assign(users[idx], await makeHash(pw));
        await kv.set(env, 'users', users);
        return json(safeUser(users[idx]));
      }

      if (method === 'DELETE') {
        if (users[idx].id === me.id) return err('No puedes eliminar tu propia cuenta.');
        users.splice(idx, 1);
        await kv.set(env, 'users', users);
        return json({ ok: true });
      }
    }

    // ── OBRAS ────────────────────────────────────────────────────────────────
    if (path === '/api/obras') {
      if (method === 'GET') {
        let obras = await kv.get(env, 'obras') || [];
        if (!isAdmin(me)) obras = obras.filter(o => (me.obras || []).includes(o.id));
        return json(obras);
      }

      if (method === 'POST') {
        if (!canEdit(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        const id = uid();
        const obra = { id, ...body, creadoPor: me.id, creadoEn: new Date().toISOString() };
        const obras = await kv.get(env, 'obras') || [];
        obras.push(obra);
        await kv.set(env, 'obras', obras);
        // Auto-assign to residente
        if (me.rol === 'residente') {
          const users = await kv.get(env, 'users') || [];
          const ui = users.findIndex(u => u.id === me.id);
          if (ui >= 0) {
            users[ui].obras = [...new Set([...(users[ui].obras || []), id])];
            await kv.set(env, 'users', users);
          }
        }
        return json(obra, 201);
      }
    }

    if (path.match(/^\/api\/obras\/[^/]+$/)) {
      const id = path.split('/')[3];
      const obras = await kv.get(env, 'obras') || [];
      const idx = obras.findIndex(o => o.id === id);
      if (idx < 0) return err('Obra no encontrada.', 404);

      if (method === 'PUT') {
        if (!canEdit(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        Object.assign(obras[idx], body);
        await kv.set(env, 'obras', obras);
        return json(obras[idx]);
      }

      if (method === 'DELETE') {
        if (!isAdmin(me)) return err('Sin permiso.', 403);
        obras.splice(idx, 1);
        await kv.set(env, 'obras', obras);
        return json({ ok: true });
      }
    }

    // ── ACTIVIDADES ──────────────────────────────────────────────────────────
    if (path === '/api/actividades') {
      if (method === 'GET') {
        const obraId = url.searchParams.get('obraId');
        let acts = await kv.get(env, 'actividades') || [];
        if (obraId) acts = acts.filter(a => a.obraId === obraId);
        return json(acts);
      }

      if (method === 'POST') {
        if (!canEdit(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        const now = new Date().toISOString();
        const act = { id: uid(), ...body, date: now, edit: now, user: me.nombre, userId: me.id };
        const acts = await kv.get(env, 'actividades') || [];
        acts.push(act);
        await kv.set(env, 'actividades', acts);
        return json(act, 201);
      }
    }

    if (path.match(/^\/api\/actividades\/[^/]+$/)) {
      const id = path.split('/')[3];
      const acts = await kv.get(env, 'actividades') || [];
      const idx = acts.findIndex(a => a.id === id);
      if (idx < 0) return err('Actividad no encontrada.', 404);

      if (method === 'PUT') {
        if (!canEdit(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        Object.assign(acts[idx], body, { edit: new Date().toISOString(), editUser: me.nombre });
        await kv.set(env, 'actividades', acts);
        return json(acts[idx]);
      }

      if (method === 'DELETE') {
        if (!canEdit(me)) return err('Sin permiso.', 403);
        acts.splice(idx, 1);
        await kv.set(env, 'actividades', acts);
        return json({ ok: true });
      }
    }

    // ── DOCUMENTOS ───────────────────────────────────────────────────────────
    if (path === '/api/documentos') {
      if (method === 'GET') {
        const obraId = url.searchParams.get('obraId');
        let docs = await kv.get(env, 'documentos') || [];
        if (obraId) docs = docs.filter(d => d.obraId === obraId);
        if (!isAdmin(me)) docs = docs.filter(d => (me.obras || []).includes(d.obraId));
        return json(docs);
      }

      if (method === 'POST') {
        if (!isAdmin(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        const doc = { id: uid(), ...body, date: new Date().toISOString(), creadoPor: me.nombre };
        const docs = await kv.get(env, 'documentos') || [];
        docs.push(doc);
        await kv.set(env, 'documentos', docs);
        return json(doc, 201);
      }
    }

    if (path.match(/^\/api\/documentos\/[^/]+$/) && method === 'DELETE') {
      if (!isAdmin(me)) return err('Sin permiso.', 403);
      const id = path.split('/')[3];
      const docs = await kv.get(env, 'documentos') || [];
      await kv.set(env, 'documentos', docs.filter(d => d.id !== id));
      return json({ ok: true });
    }

    return err('Ruta no encontrada.', 404);
  },
};
