(function () {
  const App = {
    state: {
      apiBase: window.APP_CONFIG?.API_BASE || '',
      token: localStorage.getItem('lo_token') || '',
      user: JSON.parse(localStorage.getItem('lo_user') || 'null'),
      currentView: 'home',
      viewStack: [],
      currentWorkId: null,
      currentDocumentWorkId: null,
      cache: {
        works: null,
        activities: null,
        documents: null,
        users: null,
        templates: null,
      },
    },

    roleLabel(role) {
      return ({ admin: 'Administrador', residente: 'Residente', viewer: 'Solo lectura' })[role] || role;
    },

    canEdit() {
      return this.state.user && ['admin', 'residente'].includes(this.state.user.rol);
    },

    isAdmin() {
      return this.state.user?.rol === 'admin';
    },

    formatDate(value) {
      return value ? new Date(value).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
    },

    formatDateTime(value) {
      return value ? new Date(value).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    },

    showScreen(name) {
      document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
      document.getElementById(`screen-${name}`).classList.add('active');
    },

    showView(name) {
      document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
      document.getElementById(`view-${name}`).classList.add('active');
      this.state.currentView = name;
    },

    setNav(name) {
      document.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.main === name);
      });
    },

    openMain(name) {
      this.state.viewStack = [];
      this.showView(name);
      this.setNav(name);
      if (name === 'home') this.renderHome();
      if (name === 'works') window.Libros.renderWorks();
      if (name === 'documents') window.Documentos.renderDocumentsHome();
      if (name === 'admin') this.renderUsers();
    },

    openSub(name) {
      this.state.viewStack.push(this.state.currentView);
      this.showView(name);
    },

    goBack() {
      const target = this.state.viewStack.pop() || 'home';
      this.showView(target);
      if (['home', 'works', 'documents', 'admin'].includes(target)) this.setNav(target);
      if (target === 'works') window.Libros.renderWorks();
      if (target === 'documents') window.Documentos.renderDocumentsHome();
      if (target === 'admin') this.renderUsers();
    },

    clearCache() {
      this.state.cache = { works: null, activities: null, documents: null, users: null, templates: null };
    },

    async api(method, path, body) {
      const headers = { 'Content-Type': 'application/json' };
      if (this.state.token) headers.Authorization = `Bearer ${this.state.token}`;
      const response = await fetch(this.state.apiBase + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Error del servidor');
      return payload;
    },

    get(path) { return this.api('GET', path); },
    post(path, body) { return this.api('POST', path, body); },
    put(path, body) { return this.api('PUT', path, body); },
    delete(path) { return this.api('DELETE', path); },

    async fetchWorks(force = false) {
      if (!force && this.state.cache.works) return this.state.cache.works;
      const works = await this.get('/api/obras');
      this.state.cache.works = works;
      return works;
    },

    async fetchActivities(workId, force = false) {
      if (!force && this.state.cache.activities && (!workId || this.state.cache.activities.every((item) => !workId || item.obraId === workId))) {
        if (workId) return this.state.cache.activities.filter((item) => item.obraId === workId);
      }
      const path = workId ? `/api/actividades?obraId=${workId}` : '/api/actividades';
      const items = await this.get(path);
      if (workId) {
        const remainder = (this.state.cache.activities || []).filter((item) => item.obraId !== workId);
        this.state.cache.activities = remainder.concat(items);
      } else {
        this.state.cache.activities = items;
      }
      return items;
    },

    async fetchDocuments(workId, force = false) {
      if (!force && this.state.cache.documents && (!workId || this.state.cache.documents.every((item) => !workId || item.obraId === workId))) {
        if (workId) return this.state.cache.documents.filter((item) => item.obraId === workId);
      }
      const path = workId ? `/api/documentos?obraId=${workId}` : '/api/documentos';
      const items = await this.get(path);
      if (workId) {
        const remainder = (this.state.cache.documents || []).filter((item) => item.obraId !== workId);
        this.state.cache.documents = remainder.concat(items);
      } else {
        this.state.cache.documents = items;
      }
      return items;
    },

    async fetchUsers(force = false) {
      if (!this.isAdmin()) return [];
      if (!force && this.state.cache.users) return this.state.cache.users;
      const users = await this.get('/api/users');
      this.state.cache.users = users;
      return users;
    },

    async fetchTemplates(force = false) {
      if (!force && this.state.cache.templates) return this.state.cache.templates;
      const templates = await this.get('/api/doc-templates');
      this.state.cache.templates = templates;
      return templates;
    },

    saveSession(token, user) {
      this.state.token = token;
      this.state.user = user;
      localStorage.setItem('lo_token', token);
      localStorage.setItem('lo_user', JSON.stringify(user));
      document.getElementById('session-user').textContent = `${user.nombre} · ${this.roleLabel(user.rol)}`;
      document.querySelectorAll('.admin-only').forEach((node) => {
        node.classList.toggle('hidden', !this.isAdmin());
      });
    },

    resetSession() {
      this.state.token = '';
      this.state.user = null;
      this.state.currentWorkId = null;
      this.state.currentDocumentWorkId = null;
      this.state.viewStack = [];
      localStorage.removeItem('lo_token');
      localStorage.removeItem('lo_user');
      this.clearCache();
    },

    async renderHome() {
      const target = document.getElementById('home-stats');
      target.innerHTML = '';
      try {
        const [works, activities, documents, users] = await Promise.all([
          this.fetchWorks(true),
          this.fetchActivities('', true),
          this.fetchDocuments('', true),
          this.fetchUsers(true),
        ]);
        const cards = [
          { value: works.length, label: 'Obras' },
          { value: activities.length, label: 'Actividades' },
          { value: documents.length, label: 'Documentos cargados' },
          { value: this.isAdmin() ? users.length : '—', label: 'Usuarios' },
        ];
        target.innerHTML = cards.map((card) => `<article class="stat-card"><strong>${card.value}</strong><span>${card.label}</span></article>`).join('');
      } catch (error) {
        target.innerHTML = `<article class="stat-card"><strong>!</strong><span>${error.message}</span></article>`;
      }
    },

    async renderUsers() {
      const warning = document.getElementById('admin-warning');
      const target = document.getElementById('users-list');
      if (!this.isAdmin()) {
        warning.style.display = 'block';
        warning.textContent = 'Solo el administrador puede gestionar usuarios.';
        target.innerHTML = '';
        return;
      }
      warning.style.display = 'none';
      const [users, works] = await Promise.all([this.fetchUsers(true), this.fetchWorks()]);
      target.innerHTML = users.map((item) => {
        const assigned = item.rol === 'admin'
          ? 'Acceso total'
          : (item.obras || []).map((workId) => works.find((work) => work.id === workId)?.nombre).filter(Boolean).join(', ') || 'Sin obras asignadas';
        return `
          <article class="user-card">
            <div class="card-topline">
              <div>
                <strong>${item.nombre}</strong>
                <small>${item.login || item.email || ''}</small>
              </div>
              <span class="pill ${item.rol === 'admin' ? 'ok' : item.rol === 'residente' ? 'warn' : 'bad'}">${this.roleLabel(item.rol)}</span>
            </div>
            <div class="meta-line">Teléfono: ${item.telefono || 'No configurado'}</div>
            <div class="meta-line">${assigned}</div>
            <div class="card-actions">
              <button class="soft-btn" onclick="App.openUserForm('${item.id}')">Editar</button>
              ${item.id !== this.state.user.id ? `<button class="soft-btn" onclick="App.deleteUser('${item.id}')">Eliminar</button>` : `<button class="soft-btn" disabled>Sesión actual</button>`}
            </div>
          </article>
        `;
      }).join('');
    },

    async openUserForm(userId = '') {
      const users = await this.fetchUsers();
      const user = userId ? users.find((item) => item.id === userId) : null;
      const nombre = prompt('Nombre completo', user?.nombre || '');
      if (!nombre) return;
      const login = prompt('Usuario para ingresar', user?.login || user?.email || '');
      if (!login) return;
      const email = prompt('Email', user?.email || login) || '';
      const telefono = prompt('Teléfono de WhatsApp del residente', user?.telefono || '') || '';
      const rol = (prompt('Rol: admin, residente o viewer', user?.rol || 'viewer') || 'viewer').toLowerCase();
      const pass = prompt(user ? 'Nueva contraseña (vacío para no cambiar)' : 'Contraseña inicial', '') || '';
      const obras = rol === 'admin'
        ? []
        : (prompt('IDs de obras asignadas, separados por coma', (user?.obras || []).join(',')) || '').split(',').map((item) => item.trim()).filter(Boolean);
      const payload = { nombre, login, email, telefono, rol, obras };
      if (pass) payload.pass = pass;
      if (!user && !payload.pass) {
        alert('La contraseña inicial es obligatoria.');
        return;
      }
      if (user) await this.put(`/api/users/${user.id}`, payload);
      else await this.post('/api/users', payload);
      this.state.cache.users = null;
      await this.renderUsers();
    },

    async deleteUser(userId) {
      if (!confirm('¿Eliminar este usuario?')) return;
      await this.delete(`/api/users/${userId}`);
      this.state.cache.users = null;
      await this.renderUsers();
    },
  };

  window.App = App;
})();
