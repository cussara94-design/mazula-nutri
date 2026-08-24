let currentWork = null;
let workTypes = {};
let allRefs = [];

function todayStr() { return new Date().toISOString().slice(0, 10); }
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(window._tt); window._tt = setTimeout(() => t.classList.remove('show'), 3500); }
function showLoading() { document.getElementById('loading').style.display = 'flex'; }
function hideLoading() { document.getElementById('loading').style.display = 'none'; }
function esc(s) { if (!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>'); }
function nl2br(s) { return esc(s); }

async function api(url, opts = {}) {
  try {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (r.status === 401) { window.location.href = '/login'; return null; }
    const data = await r.json();
    if (!r.ok) { toast(data.error || 'Erro'); return null; }
    return data;
  } catch (e) { toast('Erro de conexao'); return null; }
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(name);
  if (el) el.style.display = 'block';
  const btn = document.querySelector(`.nav button[data-view="${name}"]`);
  if (btn) btn.classList.add('active');
  const labels = {
    dashboard: ['Trabalho Facil', 'Gere trabalhos academicos com IA'],
    works: ['Trabalhos', 'Gerir todos os seus trabalhos academicos'],
    references: ['Referencias Bibliograficas', 'Base de dados de citacoes APA'],
    editor: ['Editor de Trabalho', ''],
  };
  const [title, sub] = labels[name] || ['Trabalho Facil', ''];
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSubtitle').textContent = sub;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'dashboard') loadDashboard();
  else if (name === 'works') loadWorks();
  else if (name === 'references') loadReferences();
}

/* ─── Dashboard ─── */
async function loadDashboard() {
  const d = await api('/api/dashboard');
  if (!d) return;
  const el = document.getElementById('dashboard');
  el.innerHTML = `
    <div class="metrics">
      <div class="metric"><div class="metric-label">Total trabalhos</div><div class="metric-value">${d.total || 0}</div><div class="metric-note">criados</div></div>
      <div class="metric"><div class="metric-label">Em rascunho</div><div class="metric-value">${d.rascunho || 0}</div><div class="metric-note">em desenvolvimento</div></div>
      <div class="metric"><div class="metric-label">Concluidos</div><div class="metric-value">${d.concluido || 0}</div><div class="metric-note">finalizados</div></div>
      <div class="metric"><div class="metric-label">IA Groq</div><div class="metric-value">&#10003;</div><div class="metric-note">activa</div></div>
    </div>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><div><h2>Trabalhos recentes</h2><p class="sub">Ultimos trabalhos actualizados</p></div><button class="text-link" onclick="showView('works')">Ver todos</button></div>
        <div class="work-list">${(d.recent || []).length ? d.recent.map(w => `
          <div class="work-row" onclick="openEditor(${w.id})">
            <div class="work-type-badge">${workTypes[w.work_type] ? workTypes[w.work_type].label : w.work_type}</div>
            <div><strong>${esc(w.title)}</strong><p class="sub">${esc(w.theme || w.area || 'Sem tema definido')}</p></div>
            <span class="chip ${w.status === 'concluido' ? 'done' : 'rascunho'}">${w.status === 'concluido' ? 'Concluido' : 'Rascunho'}</span>
          </div>
        `).join('') : '<p class="empty">Nenhum trabalho criado. Clique em "+ Novo trabalho" para comecar.</p>'}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Como funciona</h2><p class="sub">Guia rapido</p></div></div>
        <div class="guide-steps">
          <div class="guide-step"><span class="step-num">1</span><div><strong>Crie o trabalho</strong><p>Escolha o tipo (monografia, ensaio, artigo, etc.) e defina o tema.</p></div></div>
          <div class="guide-step"><span class="step-num">2</span><div><strong>Escreva ou gere com IA</strong><p>Use a IA Groq para gerar conteudo por secção, ou escreva directamente.</p></div></div>
          <div class="guide-step"><span class="step-num">3</span><div><strong>Adicione referencias</strong><p>Cadastre autores e obras. O sistema formata em APA automaticamente.</p></div></div>
          <div class="guide-step"><span class="step-num">4</span><div><strong>Exporte</strong><p>Copie o texto formatado ou use como esqueleto para o seu trabalho final.</p></div></div>
        </div>
      </section>
    </div>`;
}

/* ─── Works List ─── */
async function loadWorks() {
  const d = await api('/api/works');
  if (!d) return;
  const works = d.works || [];
  const el = document.getElementById('works');
  el.innerHTML = `
    <div class="page-head">
      <div><h2>Trabalhos Academicos</h2><p>${works.length} trabalho${works.length !== 1 ? 's' : ''} registado${works.length !== 1 ? 's' : ''}</p></div>
      <button class="btn btn-primary" onclick="openNewWorkDialog()">+ Novo trabalho</button>
    </div>
    ${works.length ? `<div class="works-grid">${works.map(w => `
      <article class="work-card" onclick="openEditor(${w.id})">
        <div class="work-card-header">
          <span class="work-type-badge">${workTypes[w.work_type] ? workTypes[w.work_type].label : w.work_type}</span>
          <span class="chip ${w.status === 'concluido' ? 'done' : 'rascunho'}">${w.status === 'concluido' ? 'Concluido' : 'Rascunho'}</span>
        </div>
        <h3>${esc(w.title)}</h3>
        <p>${esc(w.theme || w.area || 'Sem tema definido')}</p>
        <div class="work-card-footer">
          <span class="sub">${w.updated_at || w.created_at || ''}</span>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteWork(${w.id},'${esc(w.title).replace(/'/g, "\\'")}')">&#128465;</button>
        </div>
      </article>
    `).join('')}</div>` : '<div class="empty-state"><p>Nenhum trabalho criado ainda.</p><button class="btn btn-primary" onclick="openNewWorkDialog()">Criar primeiro trabalho</button></div>'}`;
}

/* ─── References List ─── */
async function loadReferences() {
  const d = await api('/api/works');
  if (!d) return;
  const works = d.works || [];
  let allFormatted = [];
  for (const w of works) {
    const rd = await api(`/api/works/${w.id}/references`);
    if (rd && rd.references) {
      rd.references.forEach(r => { r.work_title = w.title; r.work_id = w.id; });
      allFormatted = allFormatted.concat(rd.references);
    }
  }
  allRefs = allFormatted;
  const el = document.getElementById('references');
  el.innerHTML = `
    <div class="page-head">
      <div><h2>Referencias Bibliograficas</h2><p>Todas as referencias registadas nos seus trabalhos</p></div>
      <button class="btn btn-primary" onclick="openRefDialog(null)">+ Nova referencia</button>
    </div>
    ${allFormatted.length ? `<section class="panel"><div class="ref-list">${allFormatted.map(r => `
      <div class="ref-item">
        <div class="ref-info">
          <strong>${esc(r.authors)} (${esc(r.year || 's.d.')}). ${esc(r.title)}.</strong>
          <p class="sub">${esc(r.source || '')} ${r.doi ? 'DOI: ' + esc(r.doi) : ''}</p>
          <span class="work-link sub" onclick="openEditor(${r.work_id})">${esc(r.work_title)}</span>
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteRef(${r.work_id},${r.id})">&#128465;</button>
      </div>
    `).join('')}</div></section>` : '<div class="empty-state"><p>Nenhuma referencia registada.</p><p class="sub">Adicione referencias para gerar citacoes APA automaticas.</p></div>'}`;
}

/* ─── Editor ─── */
async function openEditor(workId) {
  showLoading();
  const d = await api(`/api/works/${workId}`);
  hideLoading();
  if (!d || !d.work) return;
  currentWork = d.work;
  document.getElementById('pageSubtitle').textContent = currentWork.title;
  showView('editor');
  document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
  renderEditor();
}

function renderEditor() {
  if (!currentWork) return;
  const w = currentWork;
  const el = document.getElementById('editor');
  el.innerHTML = `
    <div class="editor-top">
      <div>
        <h2>${esc(w.title)}</h2>
        <div class="editor-meta">
          <span class="work-type-badge">${workTypes[w.work_type] ? workTypes[w.work_type].label : w.work_type}</span>
          <span class="chip ${w.status === 'concluido' ? 'done' : 'rascunho'}">${w.status === 'concluido' ? 'Concluido' : 'Rascunho'}</span>
          <span class="sub">${w.area ? 'Area: ' + esc(w.area) : ''}</span>
        </div>
        ${w.theme ? `<div class="theme-box"><strong>Tema:</strong> ${esc(w.theme)}</div>` : ''}
        ${w.keywords ? `<div class="theme-box"><strong>Palavras-chave:</strong> ${esc(w.keywords)}</div>` : ''}
        ${w.objectives ? `<div class="theme-box"><strong>Objectivos:</strong> ${esc(w.objectives)}</div>` : ''}
      </div>
      <div class="editor-actions">
        <button class="btn btn-outline" onclick="editWorkMeta()">Editar metadados</button>
        <button class="btn ${w.status === 'concluido' ? 'btn-outline' : 'btn-primary'}" onclick="toggleStatus()">${w.status === 'concluido' ? 'Marcar rascunho' : 'Marcar concluido'}</button>
        <button class="btn btn-ghost" onclick="copyFullText()">&#128203; Copiar texto</button>
      </div>
    </div>
    <div class="editor-body">
      <div class="sections-panel">
        <h3>Secções do trabalho</h3>
        ${(w.sections || []).map((s, i) => `
          <div class="section-block" id="section-${s.id}">
            <div class="section-head">
              <h4>${esc(s.title)}</h4>
              <div class="section-actions">
                <button class="btn btn-sm" onclick="openAI(${s.id}, '${esc(s.title).replace(/'/g, "\\'")}')">&#9733; Gerar com IA</button>
              </div>
            </div>
            <textarea class="section-textarea" id="textarea-${s.id}" rows="8" placeholder="Escreva o conteudo da secção '${esc(s.title)}' ou use a IA para gerar..." oninput="autoSave(${s.id})">${esc(s.content || '')}</textarea>
            <div class="section-footer">
              <span class="sub">${s.content ? s.content.split(/\s+/).length + ' palavras' : 'Vazio'}</span>
              <button class="btn btn-sm" onclick="saveSection(${s.id})">Salvar</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="refs-sidebar">
        <div class="refs-sidebar-header">
          <h3>Referencias</h3>
          <button class="btn btn-sm" onclick="openRefDialog(${w.id})">+ Adicionar</button>
        </div>
        ${(w.references || []).length ? w.references.map(r => `
          <div class="ref-card">
            <p><strong>${esc(r.authors)}</strong> (${esc(r.year || 's.d.')})</p>
            <p>${esc(r.title)}.</p>
            <p class="sub">${esc(r.source || '')}</p>
          </div>
        `).join('') : '<p class="empty">Nenhuma referencia para este trabalho.</p>'}
        ${(w.references || []).length ? `<div class="apa-preview"><h4>Formato APA:</h4><div class="apa-text">${w.references.map(r => `<p>${formatAPA(r)}</p>`).join('')}</div></div>` : ''}
      </div>
    </div>`;
}

let autoSaveTimers = {};
function autoSave(sectionId) {
  clearTimeout(autoSaveTimers[sectionId]);
  autoSaveTimers[sectionId] = setTimeout(() => saveSection(sectionId, true), 1500);
}

async function saveSection(sectionId, silent) {
  const ta = document.getElementById('textarea-' + sectionId);
  if (!ta) return;
  const content = ta.value;
  const r = await api(`/api/works/${currentWork.id}/sections/${sectionId}`, { method: 'PUT', body: JSON.stringify({ content }) });
  if (r && r.section) {
    const idx = currentWork.sections.findIndex(s => s.id === sectionId);
    if (idx >= 0) currentWork.sections[idx].content = content;
    if (!silent) toast('Secção salva.');
    const footer = ta.parentElement.querySelector('.section-footer .sub');
    if (footer) footer.textContent = content ? content.split(/\s+/).length + ' palavras' : 'Vazio';
  }
}

function formatAPA(r) {
  let apa = `${esc(r.authors)} (${esc(r.year || 's.d.')}). ${esc(r.title)}.`;
  if (r.source) apa += ` ${esc(r.source)}.`;
  if (r.doi) apa += ` https://doi.org/${esc(r.doi)}`;
  return apa;
}

/* ─── AI Dialog ─── */
let aiTargetSectionId = null;
function openAI(sectionId, sectionTitle) {
  aiTargetSectionId = sectionId;
  document.getElementById('aiPrompt').value = '';
  document.getElementById('aiSectionInfo').textContent = sectionTitle;
  document.getElementById('aiDialog').showModal();
}

/* ─── Work Meta Edit ─── */
function editWorkMeta() {
  if (!currentWork) return;
  document.getElementById('wTitle').value = currentWork.title || '';
  document.getElementById('wTheme').value = currentWork.theme || '';
  document.getElementById('wArea').value = currentWork.area || '';
  document.getElementById('wKeywords').value = currentWork.keywords || '';
  document.getElementById('wObjectives').value = currentWork.objectives || '';
  document.getElementById('newWorkForm')._editMode = true;
  document.querySelector('#newWorkDialog .modal-head h2').textContent = 'Editar metadados do trabalho';
  document.getElementById('newWorkDialog').showModal();
}

/* ─── Status Toggle ─── */
async function toggleStatus() {
  if (!currentWork) return;
  const newStatus = currentWork.status === 'concluido' ? 'rascunho' : 'concluido';
  const r = await api(`/api/works/${currentWork.id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
  if (r && r.work) {
    currentWork.status = newStatus;
    toast(newStatus === 'concluido' ? 'Trabalho marcado como concluido.' : 'Trabalho marcado como rascunho.');
    renderEditor();
  }
}

/* ─── Copy Full Text ─── */
function copyFullText() {
  if (!currentWork) return;
  let text = currentWork.title.toUpperCase() + '\n\n';
  if (currentWork.theme) text += 'Tema: ' + currentWork.theme + '\n\n';
  if (currentWork.keywords) text += 'Palavras-chave: ' + currentWork.keywords + '\n\n';
  text += '---\n\n';
  (currentWork.sections || []).forEach(s => {
    text += s.title.toUpperCase() + '\n\n';
    text += (s.content || '(Secção em elaboracao)') + '\n\n';
  });
  text += '---\n\nREFERENCIAS BIBLIOGRAFICAS\n\n';
  (currentWork.references || []).forEach(r => {
    text += formatAPA(r) + '\n\n';
  });
  navigator.clipboard.writeText(text).then(() => toast('Texto copiado!')).catch(() => toast('Erro ao copiar.'));
}

/* ─── Delete Work ─── */
async function deleteWork(id, title) {
  if (!confirm('Tem certeza que deseja excluir "' + title + '"?')) return;
  const r = await api(`/api/works/${id}`, { method: 'DELETE' });
  if (r) { toast('Trabalho excluido.'); loadWorks(); }
}

/* ─── Delete Reference ─── */
async function deleteRef(workId, refId) {
  if (!confirm('Excluir esta referencia?')) return;
  const r = await api(`/api/works/${workId}/references/${refId}`, { method: 'DELETE' });
  if (r) {
    toast('Referencia excluida.');
    if (currentWork && currentWork.id === workId) {
      currentWork.references = (currentWork.references || []).filter(ref => ref.id !== refId);
      renderEditor();
    } else loadReferences();
  }
}

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', async () => {
  const td = await api('/api/work-types');
  if (td && td.types) workTypes = td.types;

  const md = await api('/api/auth/me');
  if (md && md.user) {
    document.getElementById('userName').textContent = md.user.name || 'Academico';
    document.getElementById('userEmail').textContent = md.user.email || '';
    document.getElementById('userAvatar').textContent = (md.user.name || 'A').charAt(0).toUpperCase();
  }

  document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  const wt = document.getElementById('wType');
  for (const [k, v] of Object.entries(workTypes)) {
    wt.innerHTML += `<option value="${k}">${v.label}</option>`;
  }

  /* New Work Form */
  document.getElementById('newWorkForm').addEventListener('submit', async e => {
    e.preventDefault();
    const isEdit = e.target._editMode;
    e.target._editMode = false;
    if (isEdit) {
      const r = await api(`/api/works/${currentWork.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: document.getElementById('wTitle').value.trim(),
          theme: document.getElementById('wTheme').value.trim(),
          area: document.getElementById('wArea').value.trim(),
          keywords: document.getElementById('wKeywords').value.trim(),
          objectives: document.getElementById('wObjectives').value.trim(),
        }),
      });
      if (r && r.work) {
        currentWork = { ...currentWork, ...r.work };
        document.getElementById('newWorkDialog').close();
        document.querySelector('#newWorkDialog .modal-head h2').textContent = 'Novo trabalho academico';
        renderEditor();
        toast('Metadados actualizados.');
      }
    } else {
      const r = await api('/api/works', {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('wTitle').value.trim(),
          work_type: document.getElementById('wType').value,
          theme: document.getElementById('wTheme').value.trim(),
          area: document.getElementById('wArea').value.trim(),
          keywords: document.getElementById('wKeywords').value.trim(),
          objectives: document.getElementById('wObjectives').value.trim(),
        }),
      });
      if (r && r.work) {
        document.getElementById('newWorkDialog').close();
        toast('Trabalho criado!');
        openEditor(r.work.id);
      }
    }
  });

  /* Reference Form */
  document.getElementById('refForm').addEventListener('submit', async e => {
    e.preventDefault();
    const editId = document.getElementById('rEditId').value;
    const workId = document.getElementById('rWorkId').value;
    const payload = {
      authors: document.getElementById('rAuthors').value.trim(),
      year: document.getElementById('rYear').value.trim(),
      title: document.getElementById('rTitle').value.trim(),
      source: document.getElementById('rSource').value.trim(),
      doi: document.getElementById('rDoi').value.trim(),
      url: document.getElementById('rUrl').value.trim(),
      ref_type: document.getElementById('rType').value,
      pages: document.getElementById('rPages').value.trim(),
      publisher: document.getElementById('rPublisher').value.trim(),
      edition: document.getElementById('rEdition').value.trim(),
    };
    if (workId) {
      const r = await api(`/api/works/${workId}/references`, { method: 'POST', body: JSON.stringify(payload) });
      if (r && r.reference) {
        document.getElementById('refDialog').close();
        toast('Referencia adicionada!');
        if (currentWork && currentWork.id == workId) {
          currentWork.references = currentWork.references || [];
          currentWork.references.push(r.reference);
          renderEditor();
        } else loadReferences();
      }
    } else {
      toast('Seleccione um trabalho para adicionar a referencia.');
    }
  });

  /* AI Form */
  document.getElementById('aiForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!aiTargetSectionId) return;
    const btn = document.getElementById('aiGenerateBtn');
    btn.disabled = true;
    btn.textContent = 'A gerar...';
    showLoading();
    const prompt = document.getElementById('aiPrompt').value.trim();
    const sectionTitle = document.getElementById('aiSectionInfo').textContent;
    const r = await api('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: prompt,
        work_id: currentWork ? currentWork.id : null,
        section_title: sectionTitle,
        type: 'section',
      }),
    });
    hideLoading();
    btn.disabled = false;
    btn.textContent = 'Gerar texto';
    if (r && r.text) {
      document.getElementById('aiDialog').close();
      const ta = document.getElementById('textarea-' + aiTargetSectionId);
      if (ta) {
        const existing = ta.value.trim();
        ta.value = existing ? existing + '\n\n' + r.text : r.text;
        autoSave(aiTargetSectionId);
        toast('Texto gerado e inserido na secção!');
      }
    }
  });

  /* Dialog close on backdrop */
  ['newWorkDialog', 'refDialog', 'aiDialog'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => { if (e.target === document.getElementById(id)) document.getElementById(id).close(); });
  });

  loadDashboard();
});

function openNewWorkDialog() {
  document.getElementById('newWorkForm').reset();
  document.getElementById('newWorkForm')._editMode = false;
  document.querySelector('#newWorkDialog .modal-head h2').textContent = 'Novo trabalho academico';
  document.getElementById('newWorkDialog').showModal();
}

function openRefDialog(workId) {
  document.getElementById('refForm').reset();
  document.getElementById('rWorkId').value = workId || '';
  document.getElementById('rEditId').value = '';
  document.getElementById('refDialogTitle').textContent = workId ? 'Nova referencia' : 'Nova referencia (select um trabalho primeiro)';
  document.getElementById('refDialog').showModal();
}

async function doLogout() {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}
