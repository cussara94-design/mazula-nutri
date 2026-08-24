let currentWork=null,workTypes={},allRefs=[],aiTargetSectionId=null,aiMode='generate',currentWorkId=null;

function todayStr(){return new Date().toISOString().slice(0,10)}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(window._tt);window._tt=setTimeout(()=>t.classList.remove('show'),3500)}
function showLoading(){document.getElementById('loading').style.display='flex'}
function hideLoading(){document.getElementById('loading').style.display='none'}
function esc(s){if(!s)return'';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>')}

async function api(url,opts={}){
  try{const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});
  if(r.status===401){window.location.href='/login';return null}
  const ct=r.headers.get('content-type')||'';
  if(ct.includes('text/html'))return{html:await r.text()};
  const data=await r.json();if(!r.ok){toast(data.error||'Erro');return null}return data
  }catch(e){toast('Erro de conexao');return null}
}

function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.style.display='none');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
  const el=document.getElementById(name);if(el)el.style.display='block';
  const btn=document.querySelector(`.nav button[data-view="${name}"]`);if(btn)btn.classList.add('active');
  const labels={dashboard:['Cussara Academic','Gere trabalhos academicos com IA'],works:['Trabalhos','Todos os seus trabalhos'],references:['Referencias','Citacoes APA'],editor:['Editor','']};
  const[t,s]=labels[name]||['Cussara',''];
  document.getElementById('pageTitle').textContent=t;document.getElementById('pageSubtitle').textContent=s;
  window.scrollTo({top:0,behavior:'smooth'});
  if(name==='dashboard')loadDashboard();else if(name==='works')loadWorks();else if(name==='references')loadReferences();
}

function wordCount(text){if(!text||!text.trim())return 0;return text.trim().split(/\s+/).length}
function progressColor(pct){if(pct>=100)return'var(--green)';if(pct>=60)return'var(--blue)';if(pct>=30)return'var(--amber)';return'var(--red)'}

// ─── Dashboard ───
async function loadDashboard(){
  const d=await api('/api/dashboard');if(!d)return;
  const el=document.getElementById('dashboard');
  el.innerHTML=`
    <div class="metrics">
      <div class="metric"><div class="metric-label">Total trabalhos</div><div class="metric-value">${d.total||0}</div><div class="metric-note">criados</div></div>
      <div class="metric"><div class="metric-label">Em rascunho</div><div class="metric-value">${d.rascunho||0}</div></div>
      <div class="metric"><div class="metric-label">Concluidos</div><div class="metric-value">${d.concluido||0}</div><div class="metric-note">finalizados</div></div>
      <div class="metric"><div class="metric-label">IA Disponivel</div><div class="metric-value">&#10003;</div><div class="metric-note">Groq + Qwen</div></div>
    </div>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><div><h2>Trabalhos recentes</h2><p class="sub">Ultimos trabalhos</p></div><button class="text-link" onclick="showView('works')">Ver todos</button></div>
        <div class="work-list">${(d.recent||[]).length?d.recent.map(w=>`<div class="work-row" onclick="openEditor(${w.id})"><div class="work-type-badge">${(workTypes[w.work_type]||{}).label||w.work_type}</div><div><strong>${esc(w.title)}</strong><p class="sub">${esc(w.theme||w.area||'Sem tema')}</p></div><span class="chip ${w.status==='concluido'?'done':'rascunho'}">${w.status==='concluido'?'Concluido':'Rascunho'}</span></div>`).join(''):'<p class="empty">Nenhum trabalho. Comece agora!</p>'}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Ferramentas IA</h2></div></div>
        <div class="guide-steps">
          <div class="guide-step"><span class="step-num">&#9998;</span><div><strong>Gerar texto</strong><p>Crie conteudo academico automatico</p></div></div>
          <div class="guide-step"><span class="step-num">&#9776;</span><div><strong>Resumir</strong><p>Condense textos longos</p></div></div>
          <div class="guide-step"><span class="step-num">&#8594;</span><div><strong>Expandir</strong><p>Adicione detalhes e profundidade</p></div></div>
          <div class="guide-step"><span class="step-num">&#8634;</span><div><strong>Reescrever</strong><p>Melhore a fluencia e clareza</p></div></div>
          <div class="guide-step"><span class="step-num">&#9999;</span><div><strong>Traduzir</strong><p>Traduza para ingles ou portugues</p></div></div>
          <div class="guide-step"><span class="step-num">&#10003;</span><div><strong>Corrigir</strong><p>Corrija erros ortograficos</p></div></div>
        </div>
      </section>
    </div>`;
}

// ─── Works List ───
async function loadWorks(){
  const d=await api('/api/works');if(!d)return;
  const works=d.works||[];
  const el=document.getElementById('works');
  el.innerHTML=`<div class="page-head"><div><h2>Trabalhos Academicos</h2><p>${works.length} trabalho(s)</p></div><button class="btn btn-primary" onclick="openNewWorkDialog()">+ Novo</button></div>
    ${works.length?`<div class="works-grid">${works.map(w=>`<article class="work-card" onclick="openEditor(${w.id})"><div class="work-card-header"><span class="work-type-badge">${(workTypes[w.work_type]||{}).label||w.work_type}</span><span class="chip ${w.status==='concluido'?'done':'rascunho'}">${w.status==='concluido'?'Concluido':'Rascunho'}</span></div><h3>${esc(w.title)}</h3><p>${esc(w.theme||w.area||'Sem tema')}</p><div class="work-card-footer"><span class="sub">${w.updated_at||''}</span><button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteWork(${w.id})">&#128465;</button></div></article>`).join('')}</div>`:'<div class="empty-state"><p>Nenhum trabalho ainda.</p><button class="btn btn-primary" onclick="openNewWorkDialog()">Criar primeiro trabalho</button></div>'}`;
}

// ─── References ───
async function loadReferences(){
  const d=await api('/api/works');if(!d)return;
  const works=d.works||[];let all=[];
  for(const w of works){const rd=await api(`/api/works/${w.id}/references`);if(rd&&rd.references){rd.references.forEach(r=>{r.work_title=w.title;r.work_id=w.id});all=all.concat(rd.references)}}
  allRefs=all;
  const el=document.getElementById('references');
  el.innerHTML=`<div class="page-head"><div><h2>Referencias</h2><p>${all.length} referencia(s)</p></div><button class="btn btn-primary" onclick="openRefDialog(null)">+ Nova</button></div>
    ${all.length?`<section class="panel"><div class="ref-list">${all.map(r=>`<div class="ref-item"><div class="ref-info"><strong>${esc(r.authors)} (${esc(r.year||'s.d.')}). ${esc(r.title)}.</strong><p class="sub">${esc(r.source||'')} ${r.doi?'DOI: '+esc(r.doi):''}</p><span class="work-link sub" onclick="openEditor(${r.work_id})">${esc(r.work_title)}</span></div><button class="btn btn-danger btn-sm" onclick="deleteRef(${r.work_id},${r.id})">&#128465;</button></div>`).join('')}</div></section>`:'<div class="empty-state"><p>Nenhuma referencia.</p></div>'}`;
}

// ─── Editor ───
async function openEditor(workId){
  showLoading();const d=await api(`/api/works/${workId}`);hideLoading();
  if(!d||!d.work)return;currentWork=d.work;currentWorkId=workId;
  document.getElementById('pageSubtitle').textContent=currentWork.title;
  showView('editor');document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
  renderEditor();
}

function renderEditor(){
  if(!currentWork)return;const w=currentWork;
  const el=document.getElementById('editor');
  const totalWords=w.total_words||0;const target=w.target_words||10000;
  const pct=Math.min(100,Math.round((totalWords/target)*100));
  el.innerHTML=`
    <div class="editor-top">
      <div class="editor-top-left">
        <h2>${esc(w.title)}</h2>
        <div class="editor-meta">
          <span class="work-type-badge">${(workTypes[w.work_type]||{}).label||w.work_type}</span>
          <span class="chip ${w.status==='concluido'?'done':'rascunho'}">${w.status==='concluido'?'Concluido':'Rascunho'}</span>
          <span class="sub">${w.area?'Area: '+esc(w.area):''}</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${progressColor(pct)}"></div></div>
          <span class="progress-text">${totalWords.toLocaleString()} / ${target.toLocaleString()} palavras (${pct}%)</span>
        </div>
      </div>
      <div class="editor-actions">
        <button class="btn btn-outline" onclick="editWorkMeta()">&#9998; Meta</button>
        <button class="btn btn-outline" onclick="openChatDialog()">&#128172; Chat IA</button>
        <button class="btn btn-outline" onclick="exportWork()">&#128229; Exportar</button>
        <button class="btn ${w.status==='concluido'?'btn-outline':'btn-primary'}" onclick="toggleStatus()">${w.status==='concluido'?'&#9998; Rascunho':'&#10003; Concluir'}</button>
      </div>
    </div>
    ${w.theme||w.keywords||w.objectives?`<div class="meta-cards">${w.theme?`<div class="meta-card"><strong>Tema</strong><p>${esc(w.theme)}</p></div>`:''}${w.keywords?`<div class="meta-card"><strong>Palavras-chave</strong><p>${esc(w.keywords)}</p></div>`:''}${w.objectives?`<div class="meta-card"><strong>Objectivos</strong><p>${esc(w.objectives)}</p></div>`:''}</div>`:''}
    <div class="editor-body">
      <div class="sections-panel">
        <h3>Secções</h3>
        ${(w.sections||[]).map(s=>`
          <div class="section-block" id="section-${s.id}">
            <div class="section-head">
              <h4>${esc(s.title)}</h4>
              <div class="section-actions">
                <span class="word-count-badge">${s.word_count||0} palavras</span>
                <button class="btn btn-sm" onclick="openAI(${s.id},'${esc(s.title).replace(/'/g,"\\'")}','generate')">&#9998; Gerar</button>
                <button class="btn btn-sm btn-outline" onclick="aiForSection(${s.id},'expand')">&#8594; Expandir</button>
                <button class="btn btn-sm btn-outline" onclick="aiForSection(${s.id},'rewrite')">&#8634; Reescrever</button>
              </div>
            </div>
            <div class="editor-toolbar" id="toolbar-${s.id}">
              <button type="button" title="Negrito" onclick="execCmd(${s.id},'bold')"><b>B</b></button>
              <button type="button" title="Italico" onclick="execCmd(${s.id},'italic')"><i>I</i></button>
              <button type="button" title="Sublinhado" onclick="execCmd(${s.id},'underline')"><u>U</u></button>
              <span class="toolbar-sep"></span>
              <button type="button" title="Titulo 1" onclick="execCmd(${s.id},'formatBlock','h3')">H1</button>
              <button type="button" title="Titulo 2" onclick="execCmd(${s.id},'formatBlock','h4')">H2</button>
              <span class="toolbar-sep"></span>
              <button type="button" title="Lista" onclick="execCmd(${s.id},'insertUnorderedList')">&#8226;</button>
              <button type="button" title="Lista numerada" onclick="execCmd(${s.id},'insertOrderedList')">1.</button>
              <button type="button" title="Citar" onclick="execCmd(${s.id},'formatBlock','blockquote')">"</button>
              <span class="toolbar-sep"></span>
              <button type="button" title="Colar texto" onclick="pasteToSection(${s.id})">&#128203;</button>
            </div>
            <div class="rich-editor" contenteditable="true" id="editor-${s.id}" oninput="onEditorInput(${s.id})" onblur="saveSection(${s.id})" onfocus="currentEditorSection=${s.id}">${s.content||''}</div>
            <div class="section-footer"><button class="btn btn-sm btn-primary" onclick="saveSection(${s.id})">Salvar</button></div>
          </div>
        `).join('')}
      </div>
      <div class="refs-sidebar">
        <div class="refs-sidebar-header"><h3>Referencias</h3><button class="btn btn-sm" onclick="openRefDialog(${w.id})">+ Add</button></div>
        ${(w.references||[]).length?w.references.map(r=>`<div class="ref-card"><p><strong>${esc(r.authors)}</strong> (${esc(r.year||'s.d.')})</p><p>${esc(r.title)}.</p><p class="sub">${esc(r.source||'')}</p></div>`).join(''):'<p class="empty">Sem referencias.</p>'}
        ${(w.references||[]).length?`<div class="apa-preview"><h4>APA:</h4><div class="apa-text">${w.references.map(r=>`<p>${formatAPA(r)}</p>`).join('')}</div></div>`:''}
      </div>
    </div>`;
}

let currentEditorSection=null;

function execCmd(secId,cmd,val){
  const el=document.getElementById('editor-'+secId);if(!el)return;el.focus();
  document.execCommand(cmd,false,val||null);
}

function pasteToSection(secId){
  navigator.clipboard.readText().then(text=>{
    const el=document.getElementById('editor-'+secId);if(!el)return;
    el.focus();document.execCommand('insertText',false,text);
    toast('Texto colado.');
  }).catch(()=>toast('Nao foi possivel ler a area de transferencia.'));
}

function onEditorInput(secId){
  clearTimeout(window._saveTimers&&window._saveTimers[secId]);
  if(!window._saveTimers)window._saveTimers={};
  window._saveTimers[secId]=setTimeout(()=>saveSection(secId,true),2000);
  updateWordCount(secId);
}

function updateWordCount(secId){
  const el=document.getElementById('editor-'+secId);if(!el)return;
  const wc=el.textContent.trim()?el.textContent.trim().split(/\s+/).length:0;
  const badge=document.querySelector(`#section-${secId} .word-count-badge`);
  if(badge)badge.textContent=wc+' palavras';
  recalcTotal();
}

function recalcTotal(){
  if(!currentWork)return;let total=0;
  (currentWork.sections||[]).forEach(s=>{
    const el=document.getElementById('editor-'+s.id);
    if(el){const wc=el.textContent.trim()?el.textContent.trim().split(/\s+/).length:0;s.word_count=wc;total+=wc}
  });
  currentWork.total_words=total;
  const target=currentWork.target_words||10000;
  const pct=Math.min(100,Math.round((total/target)*100));
  const fill=document.querySelector('.progress-fill');if(fill){fill.style.width=pct+'%';fill.style.background=progressColor(pct)}
  const txt=document.querySelector('.progress-text');if(txt)txt.textContent=total.toLocaleString()+' / '+target.toLocaleString()+' palavras ('+pct+'%)';
}

async function saveSection(secId,silent){
  const el=document.getElementById('editor-'+secId);if(!el)return;
  const content=el.innerHTML;
  const r=await api(`/api/works/${currentWork.id}/sections/${secId}`,{method:'PUT',body:JSON.stringify({content})});
  if(r&&r.section){const idx=currentWork.sections.findIndex(s=>s.id===secId);if(idx>=0)currentWork.sections[idx].content=content;if(!silent)toast('Salvo.');}
}

function formatAPA(r){return`${esc(r.authors)} (${esc(r.year||'s.d.')}). ${esc(r.title)}. ${esc(r.source||'')}${r.doi?' DOI: '+esc(r.doi):''}`}

// ─── AI ───
function openAI(secId,secTitle,mode){
  aiTargetSectionId=secId;aiMode=mode||'generate';
  document.getElementById('aiPrompt').value='';document.getElementById('aiSelected').value='';
  document.getElementById('aiDialogTitle').textContent=modeTitle(aiMode)+' - '+secTitle;
  setAIMode(aiMode);document.getElementById('aiDialog').showModal();
}
function aiForSection(secId,mode){
  const sec=currentWork.sections.find(s=>s.id===secId);
  const title=sec?sec.title:'Secao';aiTargetSectionId=secId;aiMode=mode;
  document.getElementById('aiPrompt').value='';document.getElementById('aiSelected').value='';
  const el=document.getElementById('editor-'+secId);
  if(el&&el.textContent.trim()){document.getElementById('aiSelected').value=el.textContent.trim()}
  document.getElementById('aiDialogTitle').textContent=modeTitle(mode)+' - '+title;
  setAIMode(mode);document.getElementById('aiDialog').showModal();
}
function modeTitle(m){return{generate:'Gerar texto',summarize:'Resumir',expand:'Expandir',rewrite:'Reescrever',translate:'Traduzir',correct:'Corrigir',outline:'Outline',abstract:'Resumo',keywords:'Palavras-chave',chat:'Chat'}[m]||'IA'}
function setAIMode(mode){
  document.querySelectorAll('.ai-mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  const needs=['summarize','expand','rewrite','translate','correct'].includes(mode);
  document.getElementById('aiTargetField').style.display=needs?'grid':'none';
}

document.addEventListener('click',e=>{if(e.target.classList.contains('ai-mode')){aiMode=e.target.dataset.mode;setAIMode(aiMode)}});

async function openAIForNew(mode){
  aiTargetSectionId=null;aiMode=mode;
  document.getElementById('aiPrompt').value='';document.getElementById('aiSelected').value='';
  document.getElementById('aiDialogTitle').textContent=modeTitle(mode);
  setAIMode(mode);document.getElementById('aiDialog').showModal();
}

// ─── Chat ───
async function openChatDialog(){
  if(!currentWorkId)return;
  document.getElementById('chatMessages').innerHTML='<div class="chat-empty">A carregar...</div>';
  document.getElementById('chatDialog').showModal();
  const d=await api(`/api/works/${currentWorkId}/chat`);
  renderChat(d&&d.messages?d.messages:[]);
}
function renderChat(msgs){
  const el=document.getElementById('chatMessages');
  if(!msgs.length){el.innerHTML='<div class="chat-empty">Pergunte qualquer coisa sobre o seu trabalho...</div>';return}
  el.innerHTML=msgs.map(m=>`<div class="chat-msg ${m.role}"><div class="chat-role">${m.role==='user'?'Voce':'IA'}</div><div class="chat-text">${esc(m.content)}</div></div>`).join('');
  el.scrollTop=el.scrollHeight;
}
async function sendChat(){
  const input=document.getElementById('chatInput');const msg=input.value.trim();if(!msg)return;
  input.value='';
  const el=document.getElementById('chatMessages');
  el.innerHTML+=`<div class="chat-msg user"><div class="chat-role">Voce</div><div class="chat-text">${esc(msg)}</div></div>`;
  el.innerHTML+=`<div class="chat-msg assistant loading"><div class="chat-role">IA</div><div class="chat-text"><div class="typing"></div></div></div>`;
  el.scrollTop=el.scrollHeight;
  const r=await api('/api/generate',{method:'POST',body:JSON.stringify({prompt:msg,work_id:currentWorkId,mode:'chat'})});
  const loading=el.querySelector('.chat-msg.loading');if(loading)loading.remove();
  if(r&&r.text){el.innerHTML+=`<div class="chat-msg assistant"><div class="chat-role">IA</div><div class="chat-text">${esc(r.text)}</div></div>`;el.scrollTop=el.scrollHeight}
}
async function clearChat(){
  if(!currentWorkId)return;await api(`/api/works/${currentWorkId}/chat`,{method:'DELETE'});
  document.getElementById('chatMessages').innerHTML='<div class="chat-empty">Pergunte qualquer coisa...</div>';
}

// ─── Export ───
function exportWork(){
  if(!currentWorkId)return;window.open(`/api/works/${currentWorkId}/export`,'_blank');
}

// ─── DOI Import ───
async function importDOI(){
  const id=document.getElementById('doiInput').value.trim();if(!id){toast('Insira um DOI ou ISBN.');return}
  showLoading();const r=await api('/api/import-doi',{method:'POST',body:JSON.stringify({identifier:id,work_id:currentWorkId})});hideLoading();
  if(r){
    if(r.imported&&r.reference){toast('Referencia importada!');if(currentWork){currentWork.references=currentWork.references||[];currentWork.references.push(r.reference);renderEditor()}}
    else if(r.reference){fillRefForm(r.reference);toast('Dados encontrados. Confirme e salve.')}
  }
}
function fillRefForm(ref){
  document.getElementById('rAuthors').value=ref.authors||'';document.getElementById('rYear').value=ref.year||'';
  document.getElementById('rTitle').value=ref.title||'';document.getElementById('rSource').value=ref.source||'';
  document.getElementById('rDoi').value=ref.doi||'';document.getElementById('rUrl').value=ref.url||'';
  document.getElementById('rPublisher').value=ref.publisher||'';
}

// ─── Dialogs ───
function openNewWorkDialog(){document.getElementById('newWorkForm').reset();document.getElementById('newWorkDialog').showModal()}
function openRefDialog(wid){document.getElementById('refForm').reset();document.getElementById('rWorkId').value=wid||'';document.getElementById('refDialog').showModal()}
function editWorkMeta(){
  if(!currentWork)return;
  document.getElementById('wTitle').value=currentWork.title||'';document.getElementById('wTheme').value=currentWork.theme||'';
  document.getElementById('wArea').value=currentWork.area||'';document.getElementById('wKeywords').value=currentWork.keywords||'';
  document.getElementById('wObjectives').value=currentWork.objectives||'';document.getElementById('wTarget').value=currentWork.target_words||10000;
  document.getElementById('newWorkForm')._editMode=true;
  document.querySelector('#newWorkDialog .modal-head h2').textContent='Editar metadados';
  document.getElementById('newWorkDialog').showModal();
}
async function toggleStatus(){
  if(!currentWork)return;const ns=currentWork.status==='concluido'?'rascunho':'concluido';
  const r=await api(`/api/works/${currentWork.id}`,{method:'PUT',body:JSON.stringify({status:ns})});
  if(r&&r.work){currentWork.status=ns;toast(ns==='concluido'?'Concluido!':'Rascunho.');renderEditor()}
}
async function deleteWork(id){if(!confirm('Excluir este trabalho?'))return;const r=await api(`/api/works/${id}`,{method:'DELETE'});if(r){toast('Excluido.');loadWorks()}}
async function deleteRef(wid,rid){if(!confirm('Excluir referencia?'))return;const r=await api(`/api/works/${wid}/references/${rid}`,{method:'DELETE'});if(r){toast('Excluida.');if(currentWork&&currentWork.id===wid){currentWork.references=(currentWork.references||[]).filter(x=>x.id!==rid);renderEditor()}else loadReferences()}}

// ─── Init ───
document.addEventListener('DOMContentLoaded',async()=>{
  const td=await api('/api/work-types');if(td&&td.types)workTypes=td.types;
  const md=await api('/api/auth/me');if(md&&md.user){document.getElementById('userName').textContent=md.user.name;document.getElementById('userEmail').textContent=md.user.email;document.getElementById('userAvatar').textContent=(md.user.name||'A').charAt(0).toUpperCase()}
  document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  const wt=document.getElementById('wType');for(const[k,v]of Object.entries(workTypes))wt.innerHTML+=`<option value="${k}">${v.label}</option>`;

  document.getElementById('newWorkForm').addEventListener('submit',async e=>{
    e.preventDefault();const isEdit=e.target._editMode;e.target._editMode=false;
    if(isEdit){
      const r=await api(`/api/works/${currentWork.id}`,{method:'PUT',body:JSON.stringify({title:document.getElementById('wTitle').value.trim(),theme:document.getElementById('wTheme').value.trim(),area:document.getElementById('wArea').value.trim(),keywords:document.getElementById('wKeywords').value.trim(),objectives:document.getElementById('wObjectives').value.trim(),target_words:Number(document.getElementById('wTarget').value)||10000})});
      if(r&&r.work){currentWork={...currentWork,...r.work};document.getElementById('newWorkDialog').close();document.querySelector('#newWorkDialog .modal-head h2').textContent='Novo trabalho academico';renderEditor();toast('Actualizado.')}
    }else{
      const r=await api('/api/works',{method:'POST',body:JSON.stringify({title:document.getElementById('wTitle').value.trim(),work_type:document.getElementById('wType').value,theme:document.getElementById('wTheme').value.trim(),area:document.getElementById('wArea').value.trim(),keywords:document.getElementById('wKeywords').value.trim(),objectives:document.getElementById('wObjectives').value.trim(),target_words:Number(document.getElementById('wTarget').value)||10000})});
      if(r&&r.work){document.getElementById('newWorkDialog').close();toast('Criado!');openEditor(r.work.id)}
    }
  });

  document.getElementById('refForm').addEventListener('submit',async e=>{
    e.preventDefault();const workId=document.getElementById('rWorkId').value;
    const payload={authors:document.getElementById('rAuthors').value.trim(),year:document.getElementById('rYear').value.trim(),title:document.getElementById('rTitle').value.trim(),source:document.getElementById('rSource').value.trim(),doi:document.getElementById('rDoi').value.trim(),url:document.getElementById('rUrl').value.trim(),ref_type:document.getElementById('rType').value,pages:document.getElementById('rPages').value.trim(),publisher:document.getElementById('rPublisher').value.trim(),edition:document.getElementById('rEdition').value.trim()};
    if(workId){const r=await api(`/api/works/${workId}/references`,{method:'POST',body:JSON.stringify(payload)});if(r&&r.reference){document.getElementById('refDialog').close();toast('Referencia adicionada!');if(currentWork&&currentWork.id==workId){currentWork.references=currentWork.references||[];currentWork.references.push(r.reference);renderEditor()}else loadReferences()}}
  });

  document.getElementById('aiForm').addEventListener('submit',async e=>{
    e.preventDefault();const btn=document.getElementById('aiGenerateBtn');btn.disabled=true;btn.textContent='A processar...';showLoading();
    const prompt=document.getElementById('aiPrompt').value.trim();
    const selected=document.getElementById('aiSelected').value.trim();
    const r=await api('/api/generate',{method:'POST',body:JSON.stringify({prompt:selected||prompt,work_id:currentWorkId,mode:aiMode,selected_text:selected,section_title:aiTargetSectionId?currentWork.sections.find(s=>s.id===aiTargetSectionId)?.title:''})});
    hideLoading();btn.disabled=false;btn.textContent='Processar';
    if(r&&r.text){
      document.getElementById('aiDialog').close();
      if(aiTargetSectionId&&['generate','expand','rewrite'].includes(aiMode)){
        const el=document.getElementById('editor-'+aiTargetSectionId);
        if(el){el.innerHTML=aiMode==='generate'?r.text:el.innerHTML+'\n\n'+r.text;saveSection(aiTargetSectionId,true);toast('Texto inserido!')}
      }else{navigator.clipboard.writeText(r.text).then(()=>toast('Resultado copiado!')).catch(()=>toast('Resultado: '+r.text.substring(0,200)))}
    }
  });

  document.getElementById('chatForm').addEventListener('submit',e=>{e.preventDefault();sendChat()});

  ['newWorkDialog','refDialog','aiDialog'].forEach(id=>{document.getElementById(id).addEventListener('click',e=>{if(e.target===document.getElementById(id))document.getElementById(id).close()})});
  loadDashboard();
});

async function doLogout(){await api('/api/auth/logout',{method:'POST'});window.location.href='/login'}
