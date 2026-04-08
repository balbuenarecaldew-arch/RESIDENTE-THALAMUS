(function () {
  const DEFAULT_DEADLINE_DAYS = 15;

  const Documentos = {
    getTemplateDeadline(template) {
      return Number(template.diasDesdeInicio || DEFAULT_DEADLINE_DAYS);
    },

    isOverdue(work, template, loadedDoc) {
      if (loadedDoc) return false;
      const start = new Date(work.inicio);
      if (Number.isNaN(start.getTime())) return false;
      const deadline = new Date(start);
      deadline.setDate(deadline.getDate() + this.getTemplateDeadline(template));
      return new Date() > deadline;
    },

    async renderDocumentsHome() {
      const [templates, works, docs] = await Promise.all([
        App.fetchTemplates(true),
        App.fetchWorks(),
        App.fetchDocuments('', true),
      ]);

      const templateTarget = document.getElementById('doc-template-list');
      templateTarget.parentElement.classList.toggle('hidden', !App.isAdmin());
      templateTarget.innerHTML = templates.length
        ? templates.map((template) => `
          <article class="template-card">
            <strong>${template.nombre}</strong>
            <div class="meta-line">${template.descripcion || 'Sin descripción'}</div>
            <div class="meta-line">Avisar a los ${this.getTemplateDeadline(template)} días desde el inicio</div>
            <div class="card-actions">
              <button class="soft-btn" onclick="Documentos.openTemplateForm('${template.id}')">Editar</button>
              <button class="soft-btn" onclick="Documentos.deleteTemplate('${template.id}')">Eliminar</button>
            </div>
          </article>
        `).join('')
        : `<article class="template-card"><strong>Aún no configuraste documentos requeridos.</strong><div class="meta-line">Crea la lista maestra de documentos que pedirás en cada obra.</div></article>`;

      const workTarget = document.getElementById('doc-work-list');
      workTarget.innerHTML = works.length
        ? works.map((work) => {
          const missing = templates.filter((template) => {
            const loadedDoc = docs.find((item) => item.obraId === work.id && item.templateId === template.id && item.estado === 'cargado');
            return !loadedDoc;
          }).length;
          return `
            <article class="work-card">
              <div class="card-topline">
                <span class="card-code">OBRA</span>
                <span class="pill ${missing ? 'warn' : 'ok'}">${missing ? `${missing} faltantes` : 'Completa'}</span>
              </div>
              <strong>${work.nombre}</strong>
              <div class="meta-line">Inicio: ${App.formatDate(work.inicio)}</div>
              <div class="meta-line">${work.residenteNombre || 'Residente sin configurar'}</div>
              <div class="card-actions">
                <button class="primary-btn" onclick="Documentos.openChecklist('${work.id}')">Ver checklist</button>
                <button class="whatsapp-btn" onclick="Documentos.openDocumentReminder('${work.id}')">WhatsApp</button>
              </div>
            </article>
          `;
        }).join('')
        : `<article class="work-card"><strong>No hay obras para revisar.</strong></article>`;

      if (App.state.currentDocumentWorkId && works.some((work) => work.id === App.state.currentDocumentWorkId)) {
        await this.openChecklist(App.state.currentDocumentWorkId, true);
      } else {
        document.getElementById('doc-detail-title').textContent = 'Checklist documental';
        document.getElementById('doc-detail-subtitle').textContent = 'Selecciona una obra';
        document.getElementById('doc-checklist').innerHTML = `<article class="document-card"><strong>Elige una obra.</strong><div class="meta-line">Aquí verás qué documentos ya fueron cargados y cuáles siguen faltando.</div></article>`;
      }
    },

    async openTemplateForm(templateId = '') {
      const templates = await App.fetchTemplates();
      const template = templateId ? templates.find((item) => item.id === templateId) : null;
      const nombre = prompt('Nombre del documento requerido', template?.nombre || '');
      if (!nombre) return;
      const descripcion = prompt('Descripción / observación', template?.descripcion || '') || '';
      const diasDesdeInicio = prompt('Días desde el inicio para empezar a reclamarlo', template?.diasDesdeInicio || DEFAULT_DEADLINE_DAYS);
      const payload = { nombre, descripcion, diasDesdeInicio: Number(diasDesdeInicio || DEFAULT_DEADLINE_DAYS) };
      if (template) await App.put(`/api/doc-templates/${template.id}`, payload);
      else await App.post('/api/doc-templates', payload);
      App.state.cache.templates = null;
      await this.renderDocumentsHome();
    },

    async deleteTemplate(templateId) {
      if (!confirm('¿Eliminar este requisito documental?')) return;
      await App.delete(`/api/doc-templates/${templateId}`);
      App.state.cache.templates = null;
      await this.renderDocumentsHome();
    },

    async openChecklist(workId, preserve = false) {
      App.state.currentDocumentWorkId = workId;
      const [works, templates, docs] = await Promise.all([
        App.fetchWorks(),
        App.fetchTemplates(),
        App.fetchDocuments(workId, true),
      ]);
      const work = works.find((item) => item.id === workId);
      if (!work) return;

      if (!preserve) App.openMain('documents');
      document.getElementById('doc-detail-title').textContent = work.nombre;
      document.getElementById('doc-detail-subtitle').textContent = `Inicio ${App.formatDate(work.inicio)} · ${work.residenteNombre || 'Residente no configurado'}`;

      const overdue = templates.filter((template) => this.isOverdue(work, template, docs.find((item) => item.templateId === template.id && item.estado === 'cargado')));
      const warning = document.getElementById('doc-overdue-warning');
      if (overdue.length) {
        warning.classList.remove('hidden');
        warning.classList.add('danger');
        warning.textContent = `Faltan ${overdue.length} documentos vencidos o ya reclamables para esta obra.`;
      } else {
        warning.classList.add('hidden');
        warning.classList.remove('danger');
        warning.textContent = '';
      }

      const target = document.getElementById('doc-checklist');
      if (!templates.length) {
        target.innerHTML = `<article class="document-card"><strong>No hay requisitos configurados.</strong><div class="meta-line">Primero arma la lista maestra de documentos.</div></article>`;
        return;
      }

      target.innerHTML = templates.map((template) => {
        const loadedDoc = docs.find((item) => item.templateId === template.id && item.estado === 'cargado');
        const overdueTemplate = this.isOverdue(work, template, loadedDoc);
        return `
          <article class="document-card">
            <div class="card-topline">
              <strong>${template.nombre}</strong>
              <span class="pill ${loadedDoc ? 'ok' : overdueTemplate ? 'bad' : 'warn'}">${loadedDoc ? 'Cargado' : overdueTemplate ? 'Vencido' : 'Pendiente'}</span>
            </div>
            <div class="meta-line">${template.descripcion || 'Sin descripción'}</div>
            <div class="meta-line">Empezar a reclamar a los ${this.getTemplateDeadline(template)} días del inicio</div>
            <div class="meta-line">${loadedDoc ? `Última carga: ${App.formatDateTime(loadedDoc.date)}` : 'Aún no fue cargado'}</div>
            <div class="card-actions">
              ${App.isAdmin() ? `<button class="primary-btn" onclick="Documentos.markDocumentLoaded('${template.id}')">${loadedDoc ? 'Actualizar' : 'Marcar cargado'}</button>` : `<button class="soft-btn" disabled>Solo admin</button>`}
              ${loadedDoc && App.isAdmin() ? `<button class="soft-btn" onclick="Documentos.deleteLoadedDocument('${loadedDoc.id}')">Quitar</button>` : `<button class="soft-btn" onclick="Documentos.openDocumentReminder('${work.id}')">Pedir</button>`}
            </div>
          </article>
        `;
      }).join('');
    },

    async markDocumentLoaded(templateId) {
      const templates = await App.fetchTemplates();
      const template = templates.find((item) => item.id === templateId);
      if (!template) return;
      const detalle = prompt('Referencia o comentario de la carga', '') || '';
      await App.post('/api/documentos', {
        obraId: App.state.currentDocumentWorkId,
        templateId: template.id,
        templateNombre: template.nombre,
        estado: 'cargado',
        detalle,
      });
      App.state.cache.documents = null;
      await this.renderDocumentsHome();
    },

    async deleteLoadedDocument(documentId) {
      if (!confirm('¿Quitar este documento cargado?')) return;
      await App.delete(`/api/documentos/${documentId}`);
      App.state.cache.documents = null;
      await this.renderDocumentsHome();
    },

    async openDocumentReminder(workId = App.state.currentDocumentWorkId) {
      const [works, templates, docs] = await Promise.all([
        App.fetchWorks(),
        App.fetchTemplates(),
        App.fetchDocuments(workId, true),
      ]);
      const work = works.find((item) => item.id === workId);
      if (!work?.residenteTelefono) {
        alert('Configura el WhatsApp del residente en la obra o en el usuario.');
        return;
      }
      const missing = templates.filter((template) => !docs.find((item) => item.templateId === template.id && item.estado === 'cargado'));
      if (!missing.length) {
        alert('Esta obra ya tiene todos los documentos configurados.');
        return;
      }
      const lines = missing.map((template) => `- ${template.nombre}`);
      const message = encodeURIComponent(
        `Hola ${work.residenteNombre || ''}, necesitamos que cargues los siguientes documentos de la obra "${work.nombre}":\n${lines.join('\n')}\n\nSi ya pasaron ${DEFAULT_DEADLINE_DAYS} días desde el inicio, por favor subirlos hoy.`
      );
      window.open(`https://wa.me/${work.residenteTelefono.replace(/\D/g, '')}?text=${message}`, '_blank', 'noopener');
    },
  };

  window.Documentos = Documentos;
})();
