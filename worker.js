const ALLOWED_ORIGINS = new Set([
  'https://balbuenarecaldew-arch.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://balbuenarecaldew-arch.github.io';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function json(reqOrData, dataOrStatus = 200, status = 200) {
  const hasRequest = reqOrData && typeof reqOrData === 'object' && 'headers' in reqOrData && typeof reqOrData.headers?.get === 'function';
  const req = hasRequest ? reqOrData : { headers: new Headers({ Origin: 'https://balbuenarecaldew-arch.github.io' }) };
  const data = hasRequest ? dataOrStatus : reqOrData;
  const finalStatus = hasRequest ? status : dataOrStatus;
  return new Response(JSON.stringify(data), {
    status: finalStatus,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function err(reqOrMessage, messageOrStatus = 400, status = 400) {
  const hasRequest = reqOrMessage && typeof reqOrMessage === 'object' && 'headers' in reqOrMessage && typeof reqOrMessage.headers?.get === 'function';
  if (hasRequest) {
    return json(reqOrMessage, { error: messageOrStatus }, status);
  }
  return json({ error: reqOrMessage }, messageOrStatus);
}

function genToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function hashPass(pass, salt, iterations = 120000) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations },
    key,
    256
  );
  return Array.from(new Uint8Array(bits)).map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function makeHash(pass) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const salt = Array.from(bytes).map((item) => item.toString(16).padStart(2, '0')).join('');
  return { salt, it: 120000, hash: await hashPass(pass, salt) };
}

const kv = {
  async get(env, key) {
    const raw = await env.LIBRO_OBRAS.get(key);
    return raw ? JSON.parse(raw) : null;
  },
  async set(env, key, value) {
    await env.LIBRO_OBRAS.put(key, JSON.stringify(value));
  },
  async del(env, key) {
    await env.LIBRO_OBRAS.delete(key);
  },
  async setSession(env, token, userId) {
    await env.LIBRO_OBRAS.put(`session:${token}`, userId, { expirationTtl: 86400 });
  },
  async getSession(env, token) {
    return env.LIBRO_OBRAS.get(`session:${token}`);
  },
};

async function ensureAdmin(env) {
  const users = await kv.get(env, 'users') || [];
  if (!users.length) {
    const hashed = await makeHash('admin');
    const admin = {
      id: 'u1',
      nombre: 'Administrador',
      login: 'admin',
      email: 'admin@local.app',
      telefono: '',
      rol: 'admin',
      obras: [],
      ...hashed,
    };
    await kv.set(env, 'users', [admin]);
    return [admin];
  }
  return users;
}

function safeUser(user) {
  const { hash, salt, it, pass, ...safe } = user;
  return safe;
}

function canEdit(user) {
  return user && ['admin', 'residente'].includes(user.rol);
}

function isAdmin(user) {
  return user?.rol === 'admin';
}

async function getSessionUser(env, req) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const userId = await kv.getSession(env, token);
  if (!userId) return null;
  const users = await kv.get(env, 'users') || [];
  return users.find((user) => user.id === userId) || null;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    await ensureAdmin(env);
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (path === '/api/login' && method === 'POST') {
      const { login, pass } = await req.json().catch(() => ({}));
      if (!login || !pass) return err('Ingresa usuario y contraseña.');
      const users = await kv.get(env, 'users') || [];
      const lookup = login.toLowerCase().trim();
      const user = users.find((item) => (item.login || '').toLowerCase() === lookup || (item.email || '').toLowerCase() === lookup);
      if (!user) return err('Usuario no encontrado.', 401);
      const valid = user.hash
        ? (await hashPass(pass, user.salt, user.it || 120000)) === user.hash
        : user.pass === pass;
      if (!valid) return err('Contraseña incorrecta.', 401);
      if (!user.hash) {
        Object.assign(user, await makeHash(pass));
        delete user.pass;
        await kv.set(env, 'users', users);
      }
      const token = genToken();
      await kv.setSession(env, token, user.id);
      return json({ token, user: safeUser(user) });
    }

    if (path === '/api/logout' && method === 'POST') {
      const auth = req.headers.get('Authorization') || '';
      const token = auth.replace('Bearer ', '').trim();
      if (token) await kv.del(env, `session:${token}`);
      return json({ ok: true });
    }

    const me = await getSessionUser(env, req);
    if (!me) return err('No autorizado.', 401);

    if (path === '/api/users') {
      if (!isAdmin(me)) return err('Sin permiso.', 403);
      const users = await kv.get(env, 'users') || [];

      if (method === 'GET') {
        return json(users.map(safeUser));
      }

      if (method === 'POST') {
        const { nombre, login, email, telefono, rol, pass, obras } = await req.json().catch(() => ({}));
        if (!nombre || !login) return err('Nombre y usuario son obligatorios.');
        if (!pass) return err('La contraseña inicial es obligatoria.');
        const duplicate = users.find((item) =>
          (item.login || '').toLowerCase() === login.toLowerCase() ||
          (email && (item.email || '').toLowerCase() === email.toLowerCase())
        );
        if (duplicate) return err('Ese usuario o email ya existe.');
        const created = {
          id: uid(),
          nombre,
          login,
          email: email || '',
          telefono: telefono || '',
          rol: rol || 'viewer',
          obras: rol === 'admin' ? [] : (obras || []),
          ...(await makeHash(pass)),
        };
        users.push(created);
        await kv.set(env, 'users', users);
        return json(safeUser(created), 201);
      }
    }

    if (path.match(/^\/api\/users\/[^/]+$/)) {
      if (!isAdmin(me)) return err('Sin permiso.', 403);
      const users = await kv.get(env, 'users') || [];
      const id = path.split('/')[3];
      const index = users.findIndex((item) => item.id === id);
      if (index < 0) return err('Usuario no encontrado.', 404);

      if (method === 'PUT') {
        const { nombre, login, email, telefono, rol, pass, obras } = await req.json().catch(() => ({}));
        Object.assign(users[index], {
          nombre,
          login,
          email: email || '',
          telefono: telefono || '',
          rol,
          obras: rol === 'admin' ? [] : (obras || []),
        });
        if (pass) Object.assign(users[index], await makeHash(pass));
        await kv.set(env, 'users', users);
        return json(safeUser(users[index]));
      }

      if (method === 'DELETE') {
        if (users[index].id === me.id) return err('No puedes eliminar tu propia cuenta.');
        users.splice(index, 1);
        await kv.set(env, 'users', users);
        return json({ ok: true });
      }
    }

    if (path === '/api/obras') {
      let works = await kv.get(env, 'obras') || [];

      if (method === 'GET') {
        if (!isAdmin(me)) works = works.filter((work) => (me.obras || []).includes(work.id));
        return json(works);
      }

      if (method === 'POST') {
        if (!canEdit(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        if (!body.nombre || !body.inicio) return err('Nombre e inicio son obligatorios.');
        const work = {
          id: uid(),
          nombre: body.nombre,
          inicio: body.inicio,
          notebookTitle: body.notebookTitle || `Hoja diaria de ${body.nombre}`,
          residenteNombre: body.residenteNombre || '',
          residenteTelefono: body.residenteTelefono || '',
          creadoPor: me.id,
          creadoEn: new Date().toISOString(),
        };
        works.push(work);
        await kv.set(env, 'obras', works);
        if (me.rol === 'residente') {
          const users = await kv.get(env, 'users') || [];
          const userIndex = users.findIndex((item) => item.id === me.id);
          if (userIndex >= 0) {
            users[userIndex].obras = [...new Set([...(users[userIndex].obras || []), work.id])];
            await kv.set(env, 'users', users);
          }
        }
        return json(work, 201);
      }
    }

    if (path.match(/^\/api\/obras\/[^/]+$/)) {
      const works = await kv.get(env, 'obras') || [];
      const id = path.split('/')[3];
      const index = works.findIndex((item) => item.id === id);
      if (index < 0) return err('Obra no encontrada.', 404);

      if (method === 'PUT') {
        if (!canEdit(me)) return err('Sin permiso.', 403);
        Object.assign(works[index], await req.json().catch(() => ({})));
        await kv.set(env, 'obras', works);
        return json(works[index]);
      }

      if (method === 'DELETE') {
        if (!isAdmin(me)) return err('Sin permiso.', 403);
        works.splice(index, 1);
        await kv.set(env, 'obras', works);
        return json({ ok: true });
      }
    }

    if (path === '/api/actividades') {
      const activities = await kv.get(env, 'actividades') || [];

      if (method === 'GET') {
        const workId = url.searchParams.get('obraId');
        return json(workId ? activities.filter((item) => item.obraId === workId) : activities);
      }

      if (method === 'POST') {
        if (!canEdit(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        if (!body.obraId || !body.title) return err('Obra y título son obligatorios.');
        const numero = activities.filter((item) => item.obraId === body.obraId).length + 1;
        const activity = {
          id: uid(),
          obraId: body.obraId,
          title: body.title,
          items: Array.isArray(body.items) ? body.items : [],
          numero,
          date: new Date().toISOString(),
          edit: new Date().toISOString(),
          user: me.nombre,
          userId: me.id,
        };
        activities.push(activity);
        await kv.set(env, 'actividades', activities);
        return json(activity, 201);
      }
    }

    if (path.match(/^\/api\/actividades\/[^/]+$/)) {
      const activities = await kv.get(env, 'actividades') || [];
      const id = path.split('/')[3];
      const index = activities.findIndex((item) => item.id === id);
      if (index < 0) return err('Actividad no encontrada.', 404);

      if (method === 'PUT') {
        if (!canEdit(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        Object.assign(activities[index], body, { edit: new Date().toISOString(), editUser: me.nombre });
        await kv.set(env, 'actividades', activities);
        return json(activities[index]);
      }

      if (method === 'DELETE') {
        if (!canEdit(me)) return err('Sin permiso.', 403);
        const removed = activities[index];
        const remaining = activities.filter((item) => item.id !== id).map((item) => item.obraId === removed.obraId ? item : item);
        const reordered = [];
        const perWork = {};
        for (const item of remaining) {
          perWork[item.obraId] = (perWork[item.obraId] || 0) + 1;
          reordered.push({ ...item, numero: perWork[item.obraId] });
        }
        await kv.set(env, 'actividades', reordered);
        return json({ ok: true });
      }
    }

    if (path === '/api/doc-templates') {
      let templates = await kv.get(env, 'doc_templates') || [];

      if (method === 'GET') return json(templates);

      if (method === 'POST') {
        if (!isAdmin(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        if (!body.nombre) return err('Nombre obligatorio.');
        const template = {
          id: uid(),
          nombre: body.nombre,
          descripcion: body.descripcion || '',
          diasDesdeInicio: Number(body.diasDesdeInicio || 15),
        };
        templates.push(template);
        await kv.set(env, 'doc_templates', templates);
        return json(template, 201);
      }
    }

    if (path.match(/^\/api\/doc-templates\/[^/]+$/)) {
      const templates = await kv.get(env, 'doc_templates') || [];
      const id = path.split('/')[3];
      const index = templates.findIndex((item) => item.id === id);
      if (index < 0) return err('Plantilla no encontrada.', 404);

      if (method === 'PUT') {
        if (!isAdmin(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        Object.assign(templates[index], {
          nombre: body.nombre || templates[index].nombre,
          descripcion: body.descripcion ?? templates[index].descripcion,
          diasDesdeInicio: Number(body.diasDesdeInicio || templates[index].diasDesdeInicio || 15),
        });
        await kv.set(env, 'doc_templates', templates);
        return json(templates[index]);
      }

      if (method === 'DELETE') {
        if (!isAdmin(me)) return err('Sin permiso.', 403);
        templates.splice(index, 1);
        await kv.set(env, 'doc_templates', templates);
        return json({ ok: true });
      }
    }

    if (path === '/api/documentos') {
      let documents = await kv.get(env, 'documentos') || [];

      if (method === 'GET') {
        const workId = url.searchParams.get('obraId');
        if (workId) documents = documents.filter((item) => item.obraId === workId);
        if (!isAdmin(me)) documents = documents.filter((item) => (me.obras || []).includes(item.obraId));
        return json(documents);
      }

      if (method === 'POST') {
        if (!isAdmin(me)) return err('Sin permiso.', 403);
        const body = await req.json().catch(() => ({}));
        if (!body.obraId || !body.templateId) return err('Obra y plantilla obligatorias.');
        documents = documents.filter((item) => !(item.obraId === body.obraId && item.templateId === body.templateId));
        const document = {
          id: uid(),
          obraId: body.obraId,
          templateId: body.templateId,
          templateNombre: body.templateNombre || '',
          estado: body.estado || 'cargado',
          detalle: body.detalle || '',
          date: new Date().toISOString(),
          creadoPor: me.nombre,
        };
        documents.push(document);
        await kv.set(env, 'documentos', documents);
        return json(document, 201);
      }
    }

    if (path.match(/^\/api\/documentos\/[^/]+$/) && method === 'DELETE') {
      if (!isAdmin(me)) return err('Sin permiso.', 403);
      const id = path.split('/')[3];
      const documents = await kv.get(env, 'documentos') || [];
      await kv.set(env, 'documentos', documents.filter((item) => item.id !== id));
      return json({ ok: true });
    }

    return err('Ruta no encontrada.', 404);
  },
};
