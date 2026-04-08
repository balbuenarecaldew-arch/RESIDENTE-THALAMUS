(function () {
  const Libros = {
    getCurrentWork(works) {
      return works.find((item) => item.id === App.state.currentWorkId);
    },

    async renderWorks(query = '') {
      document.getElementById('new-work-btn').classList.toggle('hidden', !App.canEdit());
      const target = document.getElementById('works-list');
      const works = await App.fetchWorks(true);
      const activities = await App.fetchActivities('', true);
      const filtered = works.filter((work) => (work.nombre || '').toLowerCase().includes((query || '').toLowerCase()));
      if (!filtered.length) {
        target.innerHTML = `<article class="work-card"><strong>No hay obras visibles.</strong><div class="meta-line">Crea la primera obra con nombre y fecha de inicio.</div></article>`;
        return;
      }

      target.innerHTML = filtered.map((work) => {
        const total = activities.filter((item) => item.obraId === work.id).length;
        const loadedToday = activities.some((item) => item.obraId === work.id && new Date(item.date || item.edit).toDateString() === new Date().toDateString());
        return `
          <article class="work-card">
            <div class="card-topline">
              <span class="card-code">OBRA</span>
              <span class="pill ${loadedToday ? 'ok' : 'warn'}">${loadedToday ? 'Con actividad hoy' : 'Sin actividad hoy'}</span>
            </div>
            <strong>${work.nombre}</strong>
            <div class="meta-line">Inicio: ${App.formatDate(work.inicio)}</div>
            <div class="meta-line">Título actual: ${work.notebookTitle || 'Hoja diaria de obra'}</div>
            <div class="meta-line">Actividades registradas: ${total}</div>
            <div class="card-actions">
              <button class="primary-btn" onclick="Libros.openWorkbook('${work.id}')">Abrir libro</button>
              ${App.canEdit() ? `<button class="soft-btn" onclick="Libros.configureResident('${work.id}')">Residente</button>` : `<button class="soft-btn" disabled>Solo lectura</button>`}
            </div>
          </article>
        `;
      }).join('');
    },

    async openCreateWork() {
      const nombre = prompt('Nombre de la obra');
      if (!nombre) return;
      const inicio = prompt('Fecha de inicio (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
      if (!inicio) return;
      await App.post('/api/obras', {
        nombre,
        inicio,
        notebookTitle: `Hoja diaria de ${nombre}`,
      });
      App.state.cache.works = null;
      await this.renderWorks(document.getElementById('work-search').value || '');
      await Documentos.renderDocumentsHome();
    },

    async openWorkbook(workId) {
      App.state.currentWorkId = workId;
      App.openSub('workbook');
      await this.renderWorkbook();
    },

    async renderWorkbook() {
      const works = await App.fetchWorks();
      const work = this.getCurrentWork(works);
      if (!work) return;
      const activities = await App.fetchActivities(work.id, true);
      document.getElementById('workbook-work-name').textContent = work.nombre;
      document.getElementById('workbook-work-subtitle').textContent = `Inicio ${App.formatDate(work.inicio)} · ${work.residenteNombre || 'Residente no configurado'}`;
      document.getElementById('workbook-title').value = work.notebookTitle || `Hoja diaria de ${work.nombre}`;

      const noActivityToday = !activities.some((item) => new Date(item.date || item.edit).toDateString() === new Date().toDateString());
      const warning = document.getElementById('daily-warning');
      if (noActivityToday) {
        warning.classList.remove('hidden');
        warning.textContent = work.residenteTelefono
          ? 'Hoy todavía no se cargaron actividades. Puedes avisar al residente por WhatsApp.'
          : 'Hoy todavía no se cargaron actividades. Configura el teléfono del residente para enviar aviso.';
      } else {
        warning.classList.add('hidden');
        warning.textContent = '';
      }

      const target = document.getElementById('workbook-list');
      if (!activities.length) {
        target.innerHTML = `<article class="activity-card"><strong>Esta obra aún no tiene actividades.</strong><div class="meta-line">La primera que cargues aparecerá como ítem 1 del libro.</div></article>`;
        return;
      }

      const ordered = activities.sort((a, b) => (a.numero || 0) - (b.numero || 0));
      target.innerHTML = ordered.map((activity, index) => `
        <article class="activity-card">
          <div class="card-topline">
            <span class="enumeration">Ítem ${activity.numero || index + 1}</span>
            <span class="pill ok">${App.formatDateTime(activity.edit || activity.date)}</span>
          </div>
          <strong>${activity.title}</strong>
          <ol class="numbered-list">
            ${(activity.items || []).map((item) => `<li>${item}</li>`).join('')}
          </ol>
          <div class="meta-line">Registrado por ${activity.user || '-'}</div>
          <div class="card-actions">
            ${App.canEdit() ? `<button class="soft-btn" onclick="Libros.openActivityForm('${activity.id}')">Editar</button><button class="soft-btn" onclick="Libros.deleteActivity('${activity.id}')">Eliminar</button>` : `<button class="soft-btn" disabled>Solo lectura</button>`}
          </div>
        </article>
      `).join('');
    },

    async saveWorkbookTitle() {
      const title = document.getElementById('workbook-title').value.trim();
      if (!title) return;
      await App.put(`/api/obras/${App.state.currentWorkId}`, { notebookTitle: title });
      App.state.cache.works = null;
      await this.renderWorkbook();
      await this.renderWorks(document.getElementById('work-search').value || '');
    },

    async configureResident(workId = App.state.currentWorkId) {
      const works = await App.fetchWorks();
      const work = works.find((item) => item.id === workId);
      if (!work) return;
      const residenteNombre = prompt('Nombre del residente', work.residenteNombre || '');
      if (residenteNombre === null) return;
      const residenteTelefono = prompt('WhatsApp del residente en formato internacional', work.residenteTelefono || '');
      if (residenteTelefono === null) return;
      await App.put(`/api/obras/${work.id}`, { residenteNombre, residenteTelefono });
      App.state.cache.works = null;
      if (App.state.currentWorkId === work.id) await this.renderWorkbook();
      await this.renderWorks(document.getElementById('work-search').value || '');
      await Documentos.renderDocumentsHome();
    },

    async openActivityForm(activityId = '') {
      const activities = await App.fetchActivities(App.state.currentWorkId);
      const activity = activityId ? activities.find((item) => item.id === activityId) : null;
      const title = prompt('Título de la hoja / actividad', activity?.title || '');
      if (!title) return;
      const rawItems = prompt(
        'Lista de actividades, una por línea',
        activity ? (activity.items || []).join('\n') : ''
      );
      if (rawItems === null) return;
      const items = rawItems.split('\n').map((item) => item.trim()).filter(Boolean);
      if (!items.length) {
        alert('Agrega al menos un punto en la lista.');
        return;
      }

      if (activity) {
        await App.put(`/api/actividades/${activity.id}`, { title, items });
      } else {
        await App.post('/api/actividades', { obraId: App.state.currentWorkId, title, items });
      }
      App.state.cache.activities = null;
      await this.renderWorkbook();
      await this.renderWorks(document.getElementById('work-search').value || '');
    },

    async deleteActivity(activityId) {
      if (!confirm('¿Eliminar esta actividad?')) return;
      await App.delete(`/api/actividades/${activityId}`);
      App.state.cache.activities = null;
      await this.renderWorkbook();
      await this.renderWorks(document.getElementById('work-search').value || '');
    },

    async openDailyReminder() {
      const works = await App.fetchWorks();
      const work = this.getCurrentWork(works);
      if (!work?.residenteTelefono) {
        alert('Primero configura el WhatsApp del residente.');
        return;
      }
      const message = encodeURIComponent(`Hola ${work.residenteNombre || ''}, hoy aún no se cargaron actividades en la obra "${work.nombre}". Por favor registra el libro diario del día.`);
      window.open(`https://wa.me/${work.residenteTelefono.replace(/\D/g, '')}?text=${message}`, '_blank', 'noopener');
    },
  };

  window.Libros = Libros;
})();
