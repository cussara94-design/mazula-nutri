/* ── State ── */
const S={works:[],refs:[],chat:[],currentWork:null,dirty:false};
const API=p=>fetch(p).then(r=>r.json());
let _aiAbort=null;

/* ── Init ── */
window.addEventListener('DOMContentLoaded',async()=>{
  initDarkMode();
  const path=window.location.pathname;
  if(path.startsWith('/shared/')){
    await loadSharedWork(path.split('/shared/')[1]);
    return;
  }
  try{
    const d=await API('/api/all');
    S.works=d.works||[];S.refs=d.references||[];
    updateAll();
  }catch(e){console.error('Load failed:',e)}
  bindEvents();
  setupToolbar();
  loadProviders();
});

async function loadSharedWork(token){
  showView('sharedView');
  try{
    const r=await fetch('/api/shared/'+token).then(r=>r.json());
    if(r.error){document.getElementById('sharedSections').innerHTML='<div class="empty-state"><p>'+esc(r.error)+'</p></div>';return}
    const w=r.work;
    document.getElementById('sharedTitle').textContent=w.title||'Trabalho Academico';
    document.getElementById('sharedMeta').textContent=(w.work_type||'Monografia')+' | '+(w.area||'')+' | '+(w.theme||'');
    let secHtml='';
    (w.sections||[]).forEach((s,i)=>{
      const content=(s.content||'').replace(/<[^>]+>/g,'');
      if(!content.trim())return;
      secHtml+='<div style="margin-bottom:28px"><h2 style="font-size:18px;margin:0 0 10px">'+(i+1)+'. '+esc(s.title)+'</h2><div style="font-size:14px;line-height:1.85;font-family:Merriweather,Georgia,serif;white-space:pre-wrap">'+esc(content)+'</div></div>';
    });
    document.getElementById('sharedSections').innerHTML=secHtml||'<div class="empty-state"><p>Secções vazias.</p></div>';
    let refHtml='';
    (w.references||[]).forEach(r=>{
      refHtml+='<div style="font-size:12px;padding:8px 0;border-bottom:1px solid var(--line);font-style:italic">'+esc(r.authors||'')+' ('+(r.year||'s.d.')+'). '+esc(r.title||'')+'. '+esc(r.source||'')+'</div>';
    });
    if(refHtml)document.getElementById('sharedRefs').innerHTML='<h3 style="font-size:16px;margin:0 0 12px">Referências</h3>'+refHtml;
  }catch(e){document.getElementById('sharedSections').innerHTML='<div class="empty-state"><p>Erro ao carregar trabalho.</p></div>'}
}

/* ── Dark Mode ── */
function initDarkMode(){
  const saved=localStorage.getItem('theme');
  if(saved==='dark'){document.documentElement.setAttribute('data-theme','dark');updateDarkUI(true)}
  else if(!saved&&window.matchMedia('(prefers-color-scheme:dark)').matches){document.documentElement.setAttribute('data-theme','dark');updateDarkUI(true)}
}
function toggleDark(){
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  if(isDark){document.documentElement.removeAttribute('data-theme');localStorage.setItem('theme','light');updateDarkUI(false)}
  else{document.documentElement.setAttribute('data-theme','dark');localStorage.setItem('theme','dark');updateDarkUI(true)}
}
function updateDarkUI(isDark){
  const icon=document.getElementById('darkIcon');const label=document.getElementById('darkLabel');
  if(icon)icon.textContent=isDark?'☀️':'🌙';
  if(label)label.textContent=isDark?'Modo Claro':'Modo Escuro';
}

async function loadProviders(){
  try{
    const d=await API('/api/ai/providers');
    if(d.providers){
      const sel=document.getElementById('aiProvider');if(!sel)return;
      sel.innerHTML='';
      Object.entries(d.providers).forEach(([key,p])=>{
        const opt=document.createElement('option');
        opt.value=key;opt.textContent=p.name+(p.free?' (Grátis)':'');
        if(!p.available)opt.disabled=true;
        sel.appendChild(opt);
      });
      if(d.default)sel.value=d.default;
    }
  }catch(e){}
}

function bindEvents(){
  document.querySelectorAll('#sidebarNav button').forEach(b=>{
    b.addEventListener('click',()=>switchContent(b.dataset.view));
  });
  document.getElementById('newWorkForm')?.addEventListener('submit',e=>{e.preventDefault();createWork()});
  document.getElementById('loginForm')?.addEventListener('submit',e=>{e.preventDefault();doLogin()});
  document.getElementById('registerForm')?.addEventListener('submit',e=>{e.preventDefault();doRegister()});
  document.getElementById('logoutBtn')?.addEventListener('click',doLogout);
  document.querySelectorAll('dialog').forEach(d=>{
    d.addEventListener('click',e=>{if(e.target===d)closeDialog(d.id)});
  });
}

/* ── Views ── */
function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const el=document.getElementById(id);
  if(el)el.classList.add('active');
  window.scrollTo(0,0);
}

function switchContent(view){
  showView('app');
  document.querySelectorAll('#app .content .view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('#sidebarNav button').forEach(b=>b.classList.remove('active'));
  const btn=document.querySelector(`[data-view="${view}"]`);
  if(btn)btn.classList.add('active');
  if(view==='editor'&&S.currentWork){renderEditor();document.getElementById('editorView').classList.add('active')}
  else if(view==='editor'&&S.works.length){openWork(S.works[0].id)}
  else if(view==='dashboard'){renderDashboard();document.getElementById('dashboardView').classList.add('active')}
  else if(view==='works'){renderWorksList();document.getElementById('worksView').classList.add('active')}
  else if(view==='refs'){renderRefsFull();document.getElementById('refsView').classList.add('active')}
  else if(view==='ai'){renderAiModes();document.getElementById('aiView').classList.add('active')}
  else if(view==='tools'){document.getElementById('toolsView').classList.add('active');renderToolsArticles()}
  else{document.getElementById('dashboardView').classList.add('active');renderDashboard()}
}

/* ── Dashboard ── */
function renderDashboard(){
  const tw=S.works.length;
  const wp=S.works.reduce((s,w)=>s+(w.word_count||0),0);
  const tr=S.refs.length;
  const tc=S.chat.length||0;
  document.getElementById('totalWorks').textContent=tw;
  document.getElementById('totalWords').textContent=fmtNum(wp);
  document.getElementById('totalRefs').textContent=tr;
  document.getElementById('dashWorks').textContent=tw;
  document.getElementById('dashWords').textContent=fmtNum(wp);
  document.getElementById('dashRefs').textContent=tr;
  document.getElementById('dashChats').textContent=tc;
  const recent=S.works.slice(0,5);
  const el=document.getElementById('dashRecentWorks');
  if(!recent.length){el.innerHTML='<div class="empty">Nenhum trabalho ainda. Clique em "Novo Trabalho" para começar.</div>';return}
  el.innerHTML='<div class="work-list">'+recent.map(w=>`
    <div class="work-row" onclick="openWork('${w.id}')">
      <span class="work-type-badge">${esc(w.work_type||w.type||'Monografia')}</span>
      <div><strong>${esc(w.title||'Sem título')}</strong><br><span style="color:var(--muted);font-size:11px">${esc(w.level||w.area||'Licenciatura')} · ${fmtDate(w.updated_at)}</span></div>
      <span class="chip ${(w.status||'')==='concluido'?'done':'rascunho'}">${esc((w.status||'rascunho')==='concluido'?'Concluído':'Rascunho')}</span>
    </div>`).join('')+'</div>';
}

/* ── Works List ── */
function renderWorksList(){renderWorksListFiltered()}

function filterWorks(){renderWorksListFiltered()}

function renderWorksListFiltered(){
  const el=document.getElementById('worksList');
  if(!S.works.length){el.innerHTML='<div class="empty-state"><p>Nenhum trabalho criado ainda.</p><button class="btn btn-primary" onclick="showDialog(\'newWorkDialog\')">＋ Criar Primeiro Trabalho</button></div>';return}
  const q=(document.getElementById('worksSearch')?.value||'').toLowerCase();
  const tf=document.getElementById('worksTypeFilter')?.value||'';
  const sf=document.getElementById('worksStatusFilter')?.value||'';
  let filtered=S.works.filter(w=>{
    if(q&&!((w.title||'').toLowerCase().includes(q)||(w.theme||'').toLowerCase().includes(q)||(w.area||'').toLowerCase().includes(q)))return false;
    if(tf&&(w.work_type||w.type||'')!==tf)return false;
    if(sf&&(w.status||'rascunho')!==sf)return false;
    return true;
  });
  if(!filtered.length){el.innerHTML='<div class="empty-state"><p>Nenhum trabalho encontrado com esses filtros.</p></div>';return}
  el.innerHTML='<div class="works-grid">'+filtered.map(w=>`
    <div class="work-card" onclick="openWork('${w.id}')">
      <div class="work-card-header">
        <span class="work-type-badge">${esc(w.work_type||w.type||'Monografia')}</span>
        <span class="chip ${(w.status||'')==='concluido'?'done':'rascunho'}">${esc((w.status||'rascunho')==='concluido'?'Concluído':'Rascunho')}</span>
      </div>
      <h3>${esc(w.title||'Sem título')}</h3>
      <p>${esc(w.objectives||w.discipline||'Sem descrição')}</p>
      <div class="work-card-footer">
        <span style="font-size:12px;color:var(--muted)">📖 ${fmtNum(w.word_count||0)} palavras</span>
        <span style="font-size:11px;color:var(--muted)">${fmtDate(w.updated_at)}</span>
      </div>
    </div>`).join('')+'</div>';
}

/* ── Create Work ── */
async function createWork(){
  const payload={
    title:gv('newTitle'),work_type:gv('newType'),level:gv('newLevel'),
    discipline:gv('newDiscipline'),objectives:gv('newObjective'),
    norm:gv('newNorm'),target_words:parseInt(gv('newTargetWords'))||15000,
    theme:gv('newTitle'),area:gv('newDiscipline')
  };
  showLoading('A criar trabalho...');
  try{
    const r=await fetch('/api/works',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const d=await r.json();
    if(d.limit_reached){hideLoading();handleLimitError(d);return}
    const w=d.work||d;
    if(w&&w.id){
      S.works.unshift(w);
      document.getElementById('newWorkForm').reset();
      closeDialog('newWorkDialog');
      toast('Trabalho criado! Comece a escrever.');
      openWork(w.id);loadUsage();
    }else{toast('Erro ao criar: '+JSON.stringify(d))}
  }catch(e){toast('Erro: '+e.message)}
  hideLoading();
}

/* ── Open Work ── */
async function openWork(id){
  showLoading('A abrir trabalho...');
  try{
    const raw=await API('/api/works/'+id);
    const d=raw.work||raw;
    S.currentWork=d;
    S.refs=d.references||[];
    S.chat=d.chat_history||[];
    S.currentWork.word_count=d.total_words||0;
  }catch(e){toast('Erro ao abrir trabalho')}
  hideLoading();
  switchContent('editor');
}

/* ── Editor ── */
function renderEditor(){
  const w=S.currentWork;if(!w)return;
  document.getElementById('editorTitle').textContent=w.title||'Sem título';
  document.getElementById('editorType').textContent=w.work_type||w.type||'Monografia';
  document.getElementById('editorStatus').textContent=(w.status||'rascunho')==='concluido'?'Concluído':'Rascunho';
  document.getElementById('editorStatus').className='chip '+((w.status||'rascunho')==='concluido'?'done':'rascunho');
  const wc=(w.word_count||w.total_words||0);const tw=(w.target_words||15000);
  document.getElementById('editorWordCount').textContent=fmtNum(wc)+' / '+fmtNum(tw);
  document.getElementById('editorSectionCount').textContent=(w.sections||[]).length;
  document.getElementById('editorRefCount').textContent=S.refs.length;
  document.getElementById('editorArticleCount').textContent=w.article_count||0;
  document.getElementById('editorTarget').textContent=w.level||w.area||'Licenciatura';
  const pct=Math.min(100,Math.round(wc/tw*100));
  document.getElementById('editorProgress').style.width=pct+'%';
  document.getElementById('editorProgressText').textContent=pct+'% — '+fmtNum(wc)+' de '+fmtNum(tw)+' palavras';
  renderSections();renderEditorRefs();renderApaPreview();
}

function renderSections(){
  const w=S.currentWork;if(!w)return;
  const secs=w.sections||[];
  const c=document.getElementById('sectionsContainer');
  const e=document.getElementById('sectionsEmpty');
  if(!secs.length){c.innerHTML='';e.style.display='block';return}
  e.style.display='none';
  c.innerHTML=secs.map((s,i)=>{
    const wc=(s.word_count||s.content?.split(/\s+/).filter(Boolean).length)||0;
    return`<div class="section-block">
      <div class="section-head">
        <h4>📌 ${esc(s.title||'Secção '+(i+1))}</h4>
        <div class="section-actions">
          <span class="word-count-badge">${fmtNum(wc)} palavras</span>
          <button class="btn btn-sm btn-primary" onclick="generateSection(${i})" title="Gerar com IA" style="font-size:11px">✨ Gerar</button>
          <button class="btn btn-sm btn-ghost" onclick="deleteSection(${i})" title="Apagar">🗑</button>
        </div>
      </div>
      <div class="editor-toolbar" id="tb${i}">
        <button onclick="execCmd('bold',${i})"><b>B</b></button>
        <button onclick="execCmd('italic',${i})"><i>I</i></button>
        <button onclick="execCmd('underline',${i})"><u>U</u></button>
        <div class="toolbar-sep"></div>
        <button onclick="execBlock('h3',${i})">H3</button>
        <button onclick="execBlock('h4',${i})">H4</button>
        <div class="toolbar-sep"></div>
        <button onclick="execCmd('insertUnorderedList',${i})">• ≡</button>
        <button onclick="execCmd('insertOrderedList',${i})">1. ≡</button>
        <div class="toolbar-sep"></div>
        <button onclick="execCmd('formatBlock',${i},'blockquote')" title="Citação">❝</button>
      </div>
      <div class="rich-editor" id="ed${i}" contenteditable="true" spellcheck="true" data-section="${i}" placeholder="Escreva ou gere conteúdo para esta secção...">${sanitizeContent(s.content||'')}</div>
      <div class="section-footer"><span class="word-count-badge" id="wc${i}">${fmtNum(wc)} palavras</span></div>
    </div>`;
  }).join('');
  secs.forEach((s,i)=>{
    const ed=document.getElementById('ed'+i);if(!ed)return;
    ed.addEventListener('input',()=>{
      s.content=ed.innerHTML;
      const wc=ed.textContent.split(/\s+/).filter(Boolean).length;s.word_count=wc;s._dirty=true;
      const wb=document.getElementById('wc'+i);if(wb)wb.textContent=fmtNum(wc)+' palavras';
      updateProgress();S.dirty=true;
      clearTimeout(ed._debounce);ed._debounce=setTimeout(()=>{if(S.dirty)doAutoSave()},2000);
    });
  });
}

function setupToolbar(){}

function execCmd(cmd,si,arg){
  const ed=document.getElementById('ed'+si);if(!ed)return;ed.focus();
  document.execCommand(cmd,false,arg||null);
}
function execBlock(tag,si){
  const ed=document.getElementById('ed'+si);if(!ed)return;ed.focus();
  document.execCommand('formatBlock',false,'<'+tag+'>');
}

function updateProgress(){
  const w=S.currentWork;if(!w)return;
  const wc=(w.sections||[]).reduce((s,sec)=>s+(sec.word_count||0),0);
  const tw=w.target_words||15000;
  w.word_count=wc;
  document.getElementById('editorWordCount').textContent=fmtNum(wc)+' / '+fmtNum(tw);
  document.getElementById('editorSectionCount').textContent=(w.sections||[]).length;
  document.getElementById('editorRefCount').textContent=S.refs.length;
  document.getElementById('editorTarget').textContent=w.level||w.area||'Licenciatura';
  const pct=Math.min(100,Math.round(wc/tw*100));
  document.getElementById('editorProgress').style.width=pct+'%';
  document.getElementById('editorProgressText').textContent=pct+'% — '+fmtNum(wc)+' de '+fmtNum(tw)+' palavras';
}

/* ── Section CRUD ── */
async function addSection(){
  const w=S.currentWork;if(!w){toast('Abra um trabalho primeiro');return}
  showLoading('A adicionar secção...');
  try{
    const r=await fetch('/api/works/'+w.id+'/sections',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({title:'Nova Secção '+((w.sections||[]).length+1),content:''})
    });
    const d=await r.json();
    if(d.section){
      w.sections=w.sections||[];w.sections.push(d.section);
      renderSections();updateProgress();
      toast('Secção adicionada!');
    }else{toast('Erro: '+JSON.stringify(d))}
  }catch(e){toast('Erro: '+e.message)}
  hideLoading();
}

async function deleteSection(i){
  const w=S.currentWork;if(!w)return;
  const sec=(w.sections||[])[i];if(!sec)return;
  if(!confirm('Apagar esta secção?'))return;
  showLoading('A apagar secção...');
  try{
    await fetch('/api/works/'+w.id+'/sections/'+sec.id,{method:'DELETE'});
    (w.sections||[]).splice(i,1);renderSections();updateProgress();
    toast('Secção apagada.');
  }catch(e){toast('Erro: '+e.message)}
  hideLoading();
}

async function generateSection(i){
  const w=S.currentWork;if(!w)return;
  const sec=(w.sections||[])[i];if(!sec)return;
  const hasArticles=(w.article_count||0)>0;
  let useRag=hasArticles;
  if(hasArticles){
    useRag=confirm('Tem artigos importados!\n\nOK = Usar artigos como fonte (citações reais)\nCancelar = Gerar sem artigos');
  }
  const prompt=sec.content?
    `Expande e melhora este texto académico mantendo o contexto:\n\n${sec.content.replace(/<[^>]+>/g,'')}\n\nTema: ${w.title}. Norma: ${w.norm||'APA 7ª'}. Tom académico. Use citações reais APA.`:
    `Escreve o conteúdo da secção "${sec.title}" do trabalho "${w.title}" (${w.work_type||w.type||'Monografia'}, ${w.level||w.area||'Licenciatura'}). Norma ${w.norm||'APA 7ª'}. Use citações reais em APA 7ª. Tom académico. Mínimo 500 palavras.`;
  toast('A gerar com IA...');
  try{
    let d;
    if(useRag&&hasArticles){
      d=await fetch('/api/works/'+w.id+'/generate-from-articles',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({prompt:prompt,section_title:sec.title,provider:getProvider()})
      }).then(r=>r.json());
    }else{
      d=await aiRequest('generate',prompt,'Português','Académico');
    }
    if(!d)return;
    if(d.result){
      const clean=d.result.replace(/<[^>]+>/g,'');
      sec.content=clean.replace(/\n/g,'<br>');
      sec.word_count=clean.split(/\s+/).filter(Boolean).length;
      renderSections();updateProgress();
      toast('Secção gerada com sucesso!');
      await doAutoSave();
    }else{toast('Erro: '+JSON.stringify(d))}
  }catch(e){toast('Erro: '+e.message)}
}

/* ── Auto Save ── */
async function doAutoSave(){
  const w=S.currentWork;if(!w)return;
  const statusEl=document.getElementById('saveStatus');
  if(statusEl){statusEl.textContent='A guardar...';statusEl.className='save-status saving'}
  try{
    const dirtySections=(w.sections||[]).filter(s=>s.id&&s._dirty);
    if(dirtySections.length>0){
      await fetch('/api/works/'+w.id+'/sections/bulk',{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sections:dirtySections.map(s=>({id:s.id,content:s.content,title:s.title})),word_count:w.word_count})
      });
      dirtySections.forEach(s=>s._dirty=false);
    }else{
      await fetch('/api/works/'+w.id,{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({word_count:w.word_count,status:w.status})
      });
    }
    S.dirty=false;
    if(statusEl){statusEl.textContent='Guardado ✓';statusEl.className='save-status'}
  }catch(e){
    console.error('Save failed:',e);
    if(statusEl){statusEl.textContent='Erro ao guardar';statusEl.className='save-status error'}
  }
}

/* ── Works List (sidebar navigate) ── */
function goToWorks(){switchContent('works')}

/* ── Delete Work ── */
async function deleteCurrentWork(){
  const w=S.currentWork;if(!w)return;
  if(!confirm('Apagar este trabalho e todas as secções?'))return;
  try{
    await fetch('/api/works/'+w.id,{method:'DELETE'});
    S.works=S.works.filter(x=>x.id!==w.id);S.currentWork=null;
    toast('Trabalho apagado.');switchContent('works');
  }catch(e){toast('Erro ao apagar')}
}

/* ── References ── */
function renderEditorRefs(){
  const el=document.getElementById('editorRefsList');if(!el)return;
  if(!S.refs.length){el.innerHTML='<div class="empty">Nenhuma referência ainda.</div>';return}
  el.innerHTML=S.refs.slice(0,15).map((r,i)=>`<div class="ref-card"><p style="font-weight:650">${esc(r.authors||'')}</p><p style="color:var(--muted);font-size:11px">${esc(r.title||'')} ${r.year?'('+r.year+')':''}</p><p style="color:var(--primary);font-size:11px">${esc(r.doi||r.isbn||'')}</p></div>`).join('');
}

function renderApaPreview(){
  const c=document.getElementById('apaPreview');const t=document.getElementById('apaPreviewText');
  if(!c||!t)return;
  if(!S.refs.length){c.style.display='none';return}
  c.style.display='block';
  t.innerHTML=S.refs.slice(0,5).map(r=>`<p>${esc(r.citation_apa||r.authors||'')} (${r.year||'s.f.'}). ${esc(r.title||'')}.</p>`).join('');
}

function renderRefsFull(){
  const el=document.getElementById('refsFullList');if(!el)return;
  if(!S.refs.length){el.innerHTML='<div class="empty-state"><p>Nenhuma referência ainda.</p><button class="btn btn-outline" onclick="openDoiDialog()">📥 Importar DOI / ISBN</button></div>';return}
  el.innerHTML=S.refs.map((r,i)=>`<div class="ref-item">
    <div class="ref-info"><strong>${esc(r.authors||'Autor desconhecido')}</strong><p style="font-size:12px">${esc(r.title||'')} ${r.year?'('+r.year+')':''}</p><p style="font-size:11px;color:var(--primary)">${esc(r.doi||r.isbn||'')}</p><p style="font-size:11px;color:var(--muted);margin-top:4px;font-style:italic">${esc(r.citation_apa||'')}</p></div>
    <button class="btn btn-sm btn-ghost" onclick="deleteRef(${i})" title="Remover">🗑</button>
  </div>`).join('');
}

async function deleteRef(i){
  const r=S.refs[i];if(!r||!r.id)return;
  if(!confirm('Remover esta referência?'))return;
  try{await fetch('/api/references/'+r.id,{method:'DELETE'});S.refs.splice(i,1);renderEditorRefs();renderRefsFull();renderApaPreview();toast('Referência removida.')}catch(e){toast('Erro ao remover')}
}

/* ── DOI Dialog ── */
function openDoiDialog(){showDialog('doiDialog');document.getElementById('doiError').style.display='none';document.getElementById('doiResult').style.display='none';document.getElementById('doiInput').value=''}
let _doiData=null;

async function importDoiIsbn(){
  const v=document.getElementById('doiInput').value.trim();if(!v)return;
  const e=document.getElementById('doiError');e.style.display='none';
  showLoading('A importar referência...');
  try{
    const d=await fetch('/api/import_ref',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:v})}).then(r=>r.json());
    hideLoading();
    if(d.error){e.textContent=d.error;e.style.display='block';return}
    _doiData=d;
    document.getElementById('doiResultContent').innerHTML=`<p style="font-weight:650">${esc(d.authors||'')}</p><p style="font-size:12px">${esc(d.title||'')} ${d.year?'('+d.year+')':''}</p><p style="font-size:11px;color:var(--muted)">${esc(d.doi||d.isbn||'')}</p><p style="font-size:11px;color:var(--primary);margin-top:8px;font-style:italic">${esc(d.citation_apa||'')}</p>`;
    document.getElementById('doiResult').style.display='block';
  }catch(e2){hideLoading();e.textContent='Erro ao importar: '+e2.message;e.style.display='block'}
}

async function confirmDoiImport(){
  if(!_doiData)return;
  try{
    const d=await fetch('/api/references',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(_doiData)}).then(r=>r.json());
    if(d.id){S.refs.push(d);closeDialog('doiDialog');renderEditorRefs();renderRefsFull();renderApaPreview();toast('Referência importada!');_doiData=null}
    else{toast('Erro: '+JSON.stringify(d))}
  }catch(e){toast('Erro: '+e.message)}
}

/* ── Chat ── */
function openChatDialog(){
  showDialog('chatDialog');renderChat();
}
function renderChat(){
  const c=document.getElementById('chatMessages');
  if(!S.chat.length){c.innerHTML='<div class="chat-empty">Pergunta ao assistente sobre o teu trabalho...</div>';return}
  c.innerHTML=S.chat.map(m=>`<div class="chat-msg ${m.role}"><div class="chat-role">${m.role==='user'?'Tu':'Assistente IA'}</div><div class="chat-text">${esc(m.content||'')}</div></div>`).join('');
  c.scrollTop=c.scrollHeight;
}
async function sendChat(){
  const ta=document.getElementById('chatInput');const msg=ta.value.trim();if(!msg)return;
  ta.value='';S.chat.push({role:'user',content:msg});renderChat();
  const c=document.getElementById('chatMessages');
  c.innerHTML+='<div class="chat-msg assistant loading"><div class="typing"><span></span></div></div>';c.scrollTop=c.scrollHeight;
  try{
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({work_id:S.currentWork?.id,message:msg,provider:getProvider(),context:S.currentWork?`Título: ${S.currentWork.title}. Tipo: ${S.currentWork.work_type||S.currentWork.type}. Norma: ${S.currentWork.norm||'APA 7ª'}. Secções: ${(S.currentWork.sections||[]).map(s=>s.title).join(', ')}.`:''})
    }).then(r=>r.json());
    S.chat.push({role:'assistant',content:r.result||r.error||'Sem resposta'});renderChat();
  }catch(e){S.chat.push({role:'assistant',content:'Erro de conexão: '+e.message});renderChat()}
}

/* ── AI Modes ── */
const AI_MODES=['generate','summarize','expand','rewrite','translate','correct'];
function renderAiModes(){
  const el=document.getElementById('aiModes');if(!el)return;
  el.innerHTML=AI_MODES.map(m=>`<div class="ai-mode ${m==='generate'?'active':''}" onclick="selectAiMode(this,'${m}')">${esc(m)}</div>`).join('');
}
function selectAiMode(el,mode){
  document.querySelectorAll('.ai-mode').forEach(e=>e.classList.remove('active'));el.classList.add('active');
}

async function doAiRequest(){
  const mode=document.querySelector('.ai-mode.active')?.textContent||'generate';
  const prompt=gv('aiPrompt');if(!prompt){toast('Escreva um pedido.');return}
  const lang=gv('aiLang');const tone=gv('aiTone');
  showLoading('A processar com IA...');
  try{
    const d=await aiRequest(mode,prompt,lang,tone);
    if(!d){hideLoading();return}
    if(d.result){
      document.getElementById('aiResult').style.display='block';
      document.getElementById('aiResultText').textContent=d.result;
    }else{toast('Erro: '+JSON.stringify(d))}
  }catch(e){toast('Erro: '+e.message)}
  hideLoading();
}

function copyAiResult(){
  const t=document.getElementById('aiResultText')?.textContent||'';
  navigator.clipboard.writeText(t).then(()=>toast('Copiado!'));
}

/* ── AI Request ── */
function getProvider(){const s=document.getElementById('aiProvider');return s?s.value:''}
async function aiRequest(mode,prompt,lang,tone){
  const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({mode,prompt,language:lang||'Português',tone:tone||'Académico',work_id:S.currentWork?.id,provider:getProvider()})
  });
  const d=await r.json();
  if(d.limit_reached){handleLimitError(d);return null}
  return d;
}

/* ── Export ── */
function toggleExportMenu(){
  const m=document.getElementById('exportMenu');if(!m)return;
  m.style.display=m.style.display==='none'?'block':'none';
  if(m.style.display==='block'){
    const close=(e)=>{if(!e.target.closest('.export-dropdown')){m.style.display='none';document.removeEventListener('click',close)}};
    setTimeout(()=>document.addEventListener('click',close),0);
  }
}
async function exportWork(fmt){
  const w=S.currentWork;if(!w){toast('Abra um trabalho primeiro');return}
  const url=fmt==='pdf'?'/api/export/'+w.id+'/pdf':'/api/export/'+w.id;
  showLoading('A exportar...');
  try{
    const r=await fetch(url);
    if(!r.ok){
      const d=await r.json().catch(()=>({error:'Erro ao exportar'}));
      hideLoading();
      if(d.limit_reached){handleLimitError(d);return}
      toast(d.error||'Erro ao exportar');return;
    }
    const blob=await r.blob();
    const ext=fmt==='pdf'?'.pdf':'.docx';
    const ct=r.headers.get('content-type')||'';
    const name=(w.title||'trabalho')+(fmt==='pdf'?'.pdf':ct.includes('pdf')?'.pdf':'.docx');
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href);
    toast('Exportado com sucesso!');
  }catch(e){toast('Erro: '+e.message)}
  hideLoading();
  const m=document.getElementById('exportMenu');if(m)m.style.display='none';
}

/* ── Auth ── */
async function doLogin(){
  const email=gv('loginEmail'),pass=gv('loginPass');
  if(!email||!pass){toast('Preencha todos os campos');return}
  showLoading('A entrar...');
  try{
    const d=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})}).then(r=>r.json());
    hideLoading();
    if(d.error){toast(d.error);return}
    document.getElementById('userName').textContent=d.name||'Académico';
    document.getElementById('userEmail').textContent=d.email||email;
    toast('Bem-vindo!');switchContent('dashboard');
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

async function doRegister(){
  const name=gv('regName'),email=gv('regEmail'),pass=gv('regPass');
  if(!name||!email||!pass){toast('Preencha todos os campos');return}
  showLoading('A criar conta...');
  try{
    const d=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password:pass})}).then(r=>r.json());
    hideLoading();
    if(d.error){toast(d.error);return}
    document.getElementById('userName').textContent=name;
    document.getElementById('userEmail').textContent=email;
    toast('Conta criada! Bem-vindo.');switchContent('dashboard');
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

function doLogout(){
  S.works=[];S.refs=[];S.chat=[];S.currentWork=null;
  showView('landing');toast('Sessão terminada.');
}

/* ── Helpers ── */
function showDialog(id){const d=document.getElementById(id);if(d&&d.showModal){if(id==='uploadArticleDialog'||id==='questionnaireDialog'){if(!S.works.length){toast('Crie um trabalho primeiro.');return}populateWorkSelect(id==='uploadArticleDialog'?'articleWorkSelect':'questionnaireWorkSelect')}d.showModal()}}
function closeDialog(id){const d=document.getElementById(id);if(d&&d.close)d.close()}
function gv(id){return(document.getElementById(id)?.value||'').trim()}
function esc(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML}

function sanitizeContent(html){
  if(!html)return'';
  const tmp=document.createElement('div');tmp.innerHTML=html;
  tmp.querySelectorAll('script,iframe,object,embed,form,input,button,select,textarea,style,link').forEach(el=>el.remove());
  tmp.querySelectorAll('*').forEach(el=>{
    [...el.attributes].forEach(attr=>{
      if(attr.name.startsWith('on')||attr.value.includes('javascript:'))el.removeAttribute(attr.name);
    });
  });
  return tmp.innerHTML;
}
function fmtNum(n){return(n||0).toLocaleString('pt-MZ')}
function fmtDate(s){if(!s)return'';try{return new Date(s).toLocaleDateString('pt-MZ',{day:'2-digit',month:'short',year:'numeric'})}catch(e){return s}}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),3000)}
function showLoading(m){const o=document.getElementById('loadingOverlay');o.querySelector('p').textContent=m||'A processar...';o.style.display='flex'}
function hideLoading(){document.getElementById('loadingOverlay').style.display='none'}

function updateAll(){renderDashboard();renderWorksList();renderEditorRefs();renderRefsFull();renderApaPreview();renderToolsArticles()}

/* ── Tools: Render imported articles ── */
async function renderToolsArticles(){
  const el=document.getElementById('toolsArticlesList');if(!el)return;
  if(S.works.length===0){el.innerHTML='';return}
  let html='<div class="panel"><h3 style="margin:0 0 12px">📰 Artigos Importados</h3>';
  let totalArticles=0;
  for(const w of S.works){
    try{
      const r=await fetch('/api/works/'+w.id+'/articles').then(r=>r.json());
      if(r.articles&&r.articles.length){
        html+='<h4 style="margin:14px 0 8px;font-size:13px;color:var(--muted)">'+esc(w.title)+'</h4>';
        html+='<div style="display:flex;flex-direction:column;gap:6px">';
        r.articles.forEach(a=>{
          html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:13px">';
          html+='<div><strong>'+esc(a.title||'Sem título')+'</strong> <span style="color:var(--muted);font-size:11px">('+a.chunks+' trechos)</span></div>';
          html+='<button class="btn btn-sm btn-ghost" onclick="deleteArticle('+w.id+','+a.id+')" title="Remover">🗑</button>';
          html+='</div>';
        });
        html+='</div>';
        totalArticles+=r.articles.length;
      }
    }catch(e){}
  }
  if(!totalArticles)html+='<p style="color:var(--muted);font-size:13px;margin:0">Nenhum artigo importado ainda.</p>';
  html+='</div>';el.innerHTML=html;
}
async function deleteArticle(workId,refId){
  if(!confirm('Remover este artigo?'))return;
  await fetch('/api/works/'+workId+'/articles/'+refId,{method:'DELETE'}).then(r=>r.json());
  toast('Artigo removido.');
  renderToolsArticles();renderRefsFull();
}

/* ── Upload Article ── */
function populateWorkSelect(selectId){
  const sel=document.getElementById(selectId);if(!sel)return;
  sel.innerHTML='';
  S.works.forEach(w=>{
    const opt=document.createElement('option');opt.value=w.id;opt.textContent=w.title||'Sem título';
    if(S.currentWork&&w.id===S.currentWork.id)opt.selected=true;
    sel.appendChild(opt);
  });
  if(!sel.value&&S.works.length)sel.value=S.works[0].id;
}
async function doUploadArticle(){
  const file=document.getElementById('articleFile')?.files[0];
  if(!file){toast('Selecione um ficheiro.');return}
  const sel=document.getElementById('articleWorkSelect');
  const workId=sel?sel.value:(S.currentWork?.id);
  if(!workId){toast('Selecione um trabalho.');return}
  const fd=new FormData();fd.append('file',file);fd.append('work_id',workId);
  const res=document.getElementById('uploadResult');
  showLoading('A importar artigo...');
  try{
    const r=await fetch('/api/upload-article',{method:'POST',body:fd}).then(r=>r.json());
    hideLoading();
    if(r.error){res.innerHTML='<span style="color:var(--red)">❌ '+esc(r.error)+'</span>';res.style.display='block';return}
    res.innerHTML='<span style="color:var(--green)">✅ <strong>'+esc(r.filename)+'</strong> importado! '+r.chunks+' trechos, '+r.chars+' caracteres. Ref #'+r.ref_id+'</span>';
    res.style.display='block';
    S.refs.push({id:r.ref_id,title:r.filename||'Artigo',authors:'Importado'});
    renderEditorRefs();renderRefsFull();
    toast('Artigo importado com sucesso!');
  }catch(e){hideLoading();res.innerHTML='<span style="color:var(--red)">❌ Erro: '+esc(e.message)+'</span>';res.style.display='block'}
}

/* ── Upload Data ── */
let _uploadedData=null;
async function doUploadData(){
  const file=document.getElementById('dataFile')?.files[0];
  if(!file){toast('Selecione um ficheiro.');return}
  const fd=new FormData();fd.append('file',file);
  showLoading('A carregar dados...');
  try{
    const r=await fetch('/api/upload-data',{method:'POST',body:fd}).then(r=>r.json());
    hideLoading();
    if(r.error){toast(r.error);return}
    _uploadedData=r;
    const prev=document.getElementById('dataPreview');
    let html='<h4 style="margin:0 0 8px;font-size:13px">'+esc(r.filename)+' — '+r.total_rows+' linhas, '+r.headers.length+' colunas</h4>';
    html+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>';
    r.headers.forEach(h=>{html+='<th style="padding:6px 8px;border:1px solid var(--line);background:var(--primary-bg);text-align:left;font-weight:650">'+esc(h)+'</th>'});
    html+='</tr></thead><tbody>';
    r.rows.slice(0,10).forEach(row=>{
      html+='<tr>';row.forEach(c=>{html+='<td style="padding:5px 8px;border:1px solid var(--line)">'+esc(c)+'</td>'});html+='</tr>'
    });
    if(r.total_rows>10)html+='<tr><td colspan="'+r.headers.length+'" style="padding:6px;text-align:center;color:var(--muted);font-size:11px">... mais '+(r.total_rows-10)+' linhas</td></tr>';
    html+='</tbody></table></div>';
    html+='<div style="margin-top:12px"><button class="btn btn-primary btn-sm" onclick="doAnalyzeData()">📊 Analisar Dados (APA/ABNT)</button></div>';
    prev.innerHTML=html;prev.style.display='block';
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

async function doAnalyzeData(){
  if(!_uploadedData){toast('Carregue dados primeiro.');return}
  showLoading('A analisar dados...');
  try{
    const r=await fetch('/api/analyze-data',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({headers:_uploadedData.headers,rows:_uploadedData.rows,norm:'APA',provider:getProvider()})
    }).then(r=>r.json());
    hideLoading();
    if(r.error){toast(r.error);return}
    const prev=document.getElementById('dataPreview');
    prev.innerHTML+='<div style="margin-top:16px;padding:14px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:13px;line-height:1.7;white-space:pre-wrap;font-family:Merriweather,Georgia,serif">'+esc(r.result)+'</div>';
    toast('Análise concluída!');
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

/* ── Questionnaire ── */
async function doGenerateQuestionnaire(){
  const prompt=document.getElementById('questionnairePrompt')?.value||'';
  const sel=document.getElementById('questionnaireWorkSelect');
  const workId=sel?sel.value:(S.currentWork?.id);
  showLoading('A gerar questionário...');
  try{
    const r=await fetch('/api/generate-questionnaire',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({work_id:workId?parseInt(workId):null,prompt:prompt,provider:getProvider()})
    }).then(r=>r.json());
    hideLoading();
    if(r.error){toast(r.error);return}
    closeDialog('questionnaireDialog');
    const aiResult=document.getElementById('aiResult');
    const aiText=document.getElementById('aiResultText');
    if(aiResult&&aiText){
      aiResult.style.display='block';
      aiText.textContent=r.result;
      switchContent('ai');
    }
    toast('Questionário gerado!');
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

/* ── AI: Suggest Titles ── */
function applyTitle(el){
  const title=el.textContent.trim();
  if(S.currentWork){S.currentWork.title=title;const et=document.getElementById('editorTitle');if(et)et.textContent=title}
  toast('Titulo aplicado!');
}
async function doSuggestTitle(){
  const w=S.currentWork;
  const theme=w?.theme||prompt('Digite o tema do trabalho:');
  if(!theme){toast('Tema obrigatorio.');return}
  showLoading('A sugerir titulos...');
  try{
    const r=await fetch('/api/ai/suggest-title',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({theme:theme,area:w?.area||'',work_type:w?.work_type||'monografia',provider:getProvider()})
    }).then(r=>r.json());
    hideLoading();
    if(r.limit_reached){handleLimitError(r);return}
    if(r.error){toast(r.error);return}
    const aiResult=document.getElementById('aiResult');const aiText=document.getElementById('aiResultText');
    if(aiResult&&aiText){
      aiResult.style.display='block';
      aiText.innerHTML='<strong>Titulos sugeridos:</strong><br><br>'+r.suggestions.map((t,i)=>'<div style="padding:8px 12px;margin:4px 0;background:var(--primary-bg);border-radius:var(--radius-xs);cursor:pointer" onclick="applyTitle(this)">'+esc(t)+'</div>').join('');
      switchContent('ai');
    }
    toast('Titulos sugeridos!');
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

/* ── AI: Generate Abstract ── */
async function doGenerateAbstract(){
  showLoading('A gerar resumo...');
  try{
    const r=await fetch('/api/ai/generate-abstract',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({work_id:S.currentWork?.id,provider:getProvider()})
    }).then(r=>r.json());
    hideLoading();
    if(r.limit_reached){handleLimitError(r);return}
    if(r.error){toast(r.error);return}
    const aiResult=document.getElementById('aiResult');const aiText=document.getElementById('aiResultText');
    if(aiResult&&aiText){
      aiResult.style.display='block';
      aiText.textContent=r.result;
      switchContent('ai');
    }
    toast('Resumo gerado!');
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

/* ── AI: Generate Keywords ── */
async function doGenerateKeywords(){
  const w=S.currentWork;
  const theme=w?.theme||prompt('Digite o tema do trabalho:');
  if(!theme){return}
  showLoading('A gerar palavras-chave...');
  try{
    const r=await fetch('/api/ai/generate-keywords',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({theme:theme,area:w?.area||'',provider:getProvider()})
    }).then(r=>r.json());
    hideLoading();
    if(r.limit_reached){handleLimitError(r);return}
    if(r.error){toast(r.error);return}
    const aiResult=document.getElementById('aiResult');const aiText=document.getElementById('aiResultText');
    if(aiResult&&aiText){
      aiResult.style.display='block';
      aiText.textContent='Palavras-chave sugeridas:\n\n'+r.keywords;
      switchContent('ai');
    }
    toast('Palavras-chave geradas!');
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

/* ── AI: Image Analysis ── */
async function doImageAnalysis(){
  const file=document.getElementById('analysisImageFile')?.files[0];
  if(!file){toast('Selecione uma imagem.');return}
  const prompt=document.getElementById('imageAnalysisPrompt')?.value||'';
  const fd=new FormData();fd.append('image',file);fd.append('prompt',prompt);
  const res=document.getElementById('imageAnalysisResult');
  showLoading('A analisar imagem...');
  try{
    const r=await fetch('/api/ai/image-analysis',{method:'POST',body:fd}).then(r=>r.json());
    hideLoading();
    if(r.limit_reached){handleLimitError(r);return}
    if(r.error){res.innerHTML='<span style="color:var(--red)">❌ '+esc(r.error)+'</span>';res.style.display='block';return}
    res.textContent=r.result;res.style.display='block';
    toast('Imagem analisada!');
  }catch(e){hideLoading();res.innerHTML='<span style="color:var(--red)">❌ Erro: '+esc(e.message)+'</span>';res.style.display='block'}
}

/* ── AI: Similarity Check ── */
async function doSimilarityCheck(){
  const a=document.getElementById('similarityTextA')?.value||'';
  const b=document.getElementById('similarityTextB')?.value||'';
  if(!a||!b){toast('Preencha ambos os textos.');return}
  const res=document.getElementById('similarityResult');
  showLoading('A comparar textos...');
  try{
    const r=await fetch('/api/ai/similarity',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text_a:a,text_b:b,provider:getProvider()})
    }).then(r=>r.json());
    hideLoading();
    if(r.limit_reached){handleLimitError(r);return}
    if(r.error){res.innerHTML='<span style="color:var(--red)">❌ '+esc(r.error)+'</span>';res.style.display='block';return}
    let html='<div style="text-align:center;margin-bottom:12px"><strong style="font-size:28px;color:var(--primary)">'+(r.score||0)+'%</strong><br><span style="font-size:12px;color:var(--muted)">Similaridade</span></div>';
    if(r.matches&&r.matches.length){
      html+='<strong style="font-size:12px;color:var(--red)">Trechos similares:</strong><ul style="margin:6px 0;padding-left:18px;font-size:12px">';
      r.matches.forEach(m=>{html+='<li style="margin:4px 0">'+esc(m)+'</li>'});
      html+='</ul>';
    }
    if(r.suggestion){html+='<div style="margin-top:8px;padding:10px;background:var(--primary-bg);border-radius:var(--radius-xs);font-size:12px"><strong>Sugestão:</strong> '+esc(r.suggestion)+'</div>'}
    res.innerHTML=html;res.style.display='block';
    toast('Comparação concluída!');
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

/* ── Share Work ── */
async function doShareWork(){
  const w=S.currentWork;if(!w){toast('Abra um trabalho primeiro.');return}
  showLoading('A gerar link...');
  try{
    const r=await fetch('/api/works/'+w.id+'/share',{method:'POST'}).then(r=>r.json());
    hideLoading();
    if(r.error){toast(r.error);return}
    if(navigator.clipboard){navigator.clipboard.writeText(r.url)}
    toast('Link copiado: '+r.url);
    prompt('Link de partilha:',r.url);
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

/* ── Plans & Usage ── */
const PLAN_COLORS={free:'#666',pro:'var(--primary)',premium:'#FFD60A'};
async function loadUsage(){
  try{
    const r=await fetch('/api/usage').then(r=>r.json());
    if(r.error)return;
    const sec=document.getElementById('usageBarSection');
    if(sec)sec.style.display='block';
    const lbl=document.getElementById('usagePlanLabel');
    if(lbl){lbl.textContent=r.plan_label;lbl.style.color=PLAN_COLORS[r.plan]||'var(--primary)'}
    updateUsageBar('usageWorks','usageWorksBar',r.works);
    updateUsageBar('usageExports','usageExportsBar',r.exports);
    updateUsageBar('usageAI','usageAIBar',r.ai_requests);
    S.usage=r;
  }catch(e){}
}
function updateUsageBar(textId,barId,data){
  const el=document.getElementById(textId);
  const bar=document.getElementById(barId);
  if(!el||!bar)return;
  const limit=data.limit;
  if(limit<0){el.textContent=data.used+'/∞';bar.style.width='100%';bar.style.background='var(--primary)';return}
  el.textContent=data.used+'/'+limit;
  const pct=limit>0?Math.min((data.used/limit)*100,100):0;
  bar.style.width=pct+'%';
  bar.style.background=pct>=90?'#ef4444':pct>=70?'#f59e0b':'var(--primary)';
}
async function showUpgradeDialog(){
  const r=await fetch('/api/plans').then(r=>r.json());
  if(r.error){toast(r.error);return}
  const grid=document.getElementById('upgradePlansGrid');
  const currentPlan=S.usage?.plan||'free';
  const plans=r.plans;
  let html='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:8px">';
  for(const[key,plan]of Object.entries(plans)){
    const isCurrent=key===currentPlan;
    const isUpgrade=(currentPlan==='free'&&key==='pro')||(currentPlan==='free'&&key==='premium')||(currentPlan==='pro'&&key==='premium');
    html+=`<div class="plan-card ${isCurrent?'current':''}" style="border:2px solid ${isCurrent?'var(--primary)':'var(--line)'};border-radius:var(--radius-md);padding:20px;text-align:center;${isCurrent?'background:var(--primary);color:#fff;opacity:.9;':''}${isUpgrade&&!isCurrent?'cursor:pointer;':''}" data-plan="${key}" ${isUpgrade&&!isCurrent?'onclick="doUpgrade(this.dataset.plan)"':''}>`;
    if(isCurrent)html+=`<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Plano Atual</div>`;
    html+=`<div style="font-size:18px;font-weight:700;margin-bottom:4px">${plan.label}</div>`;
    html+=`<div style="font-size:24px;font-weight:800;margin:8px 0">${plan.price===0?'Gratis':'MZN '+plan.price.toLocaleString('pt-BR')}</div>`;
    html+=`<div style="font-size:12px;opacity:.7;margin-bottom:12px">${plan.price===0?'para sempre':'por mes'}</div>`;
    html+='<ul style="list-style:none;padding:0;margin:0;text-align:left">';
    plan.features.forEach(f=>{html+=`<li style="padding:4px 0;font-size:13px;border-bottom:1px solid rgba(255,255,255,.1)">✓ ${f}</li>`});
    html+='</ul>';
    if(isUpgrade&&!isCurrent)html+=`<button class="btn btn-primary" style="width:100%;margin-top:12px;justify-content:center">Escolher ${plan.label}</button>`;
    else if(!isCurrent&&key!=='free')html+=`<div style="margin-top:12px;font-size:12px;opacity:.5">Apenas para novos clientes</div>`;
    html+='</div>';
  }
  html+='</div>';
  grid.innerHTML=html;
  showDialog('upgradeDialog');
}
let _pendingUpgrade=null;
function selectPaymentMethod(el){
  document.querySelectorAll('.payment-method').forEach(m=>{m.style.borderColor='var(--line)';m.classList.remove('active')});
  el.style.borderColor='var(--primary)';el.classList.add('active');
  const method=el.dataset.method;
  const details=document.getElementById('paymentDetails');
  const instr=document.getElementById('paymentInstructions');
  if(method==='mpesa'){
    instr.innerHTML='Envie o valor para <strong>M-Pesa: +258 84 908 1440</strong> (Cussara Academic).<br>Use o teu numero como referencia.';
    details.style.display='block';
  }else if(method==='emola'){
    instr.innerHTML='Envie o valor para <strong>eMola: +258 84 908 1440</strong> (Cussara Academic).<br>Use o teu numero como referencia.';
    details.style.display='block';
  }else{
    instr.innerHTML='<strong>IBAN:</strong> MZ59 0040 0000 1234 5678 9012 3<br><strong>Titular:</strong> Cussara Academic<br><strong>Banco:</strong> BCI<br>Use o teu nome como referencia.';
    details.style.display='block';
  }
}
function showPaymentDialog(plan){
  _pendingUpgrade=plan;
  const info=document.getElementById('paymentPlanInfo');
  const plans={pro:{label:'Pro',price:4497},premium:{label:'Premium',price:9497}};
  const p=plans[plan]||plans.pro;
  info.innerHTML=`<div style="padding:16px;background:var(--bg-alt);border:1px solid var(--line);border-radius:var(--radius-sm);text-align:center"><div style="font-size:18px;font-weight:700">Plano ${p.label}</div><div style="font-size:28px;font-weight:800;margin:4px 0">MZN ${p.price.toLocaleString('pt-BR')}</div><div style="font-size:12px;opacity:.7">por mes</div></div>`;
  selectPaymentMethod(document.querySelector('.payment-method[data-method="mpesa"]'));
  showDialog('paymentDialog');
}
async function doUpgrade(plan){showPaymentDialog(plan)}
async function confirmPayment(){
  if(!_pendingUpgrade)return;
  const phone=(document.getElementById('paymentPhone').value||'').trim();
  if(!phone){toast('Insira o telefone usado no pagamento.');return}
  showLoading('A processar...');
  try{
    const r=await fetch('/api/upgrade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:_pendingUpgrade})}).then(r=>r.json());
    hideLoading();closeDialog('paymentDialog');closeDialog('upgradeDialog');
    if(r.error){toast(r.error);return}
    toast(r.message||'Plano atualizado!');
    _pendingUpgrade=null;
    loadUsage();
  }catch(e){hideLoading();toast('Erro: '+e.message)}
}

function handleLimitError(data){
  if(data.limit_reached){
    toast(data.error);
    showUpgradeDialog();
    return true;
  }
  toast(data.error||'Erro desconhecido.');
  return true;
}

/* ── Init Plans on Login ── */
const _origShowApp=showApp;
showApp=function(){
  _origShowApp.apply(this,arguments);
  loadUsage();
};
