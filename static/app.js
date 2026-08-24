/* ── State ── */
const S={works:[],refs:[],chat:[],currentWork:null,dirty:false};
const API=p=>fetch(p).then(r=>r.json());
let _aiAbort=null;

/* ── Init ── */
window.addEventListener('DOMContentLoaded',async()=>{
  try{
    const d=await API('/api/all');
    S.works=d.works||[];S.refs=d.references||[];
    updateAll();
  }catch(e){console.error('Load failed:',e)}
  bindEvents();
  setupToolbar();
});

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
function renderWorksList(){
  const el=document.getElementById('worksList');
  if(!S.works.length){el.innerHTML='<div class="empty-state"><p>Nenhum trabalho criado ainda.</p><button class="btn btn-primary" onclick="showDialog(\'newWorkDialog\')">＋ Criar Primeiro Trabalho</button></div>';return}
  el.innerHTML='<div class="works-grid">'+S.works.map(w=>`
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
    const w=d.work||d;
    if(w&&w.id){
      S.works.unshift(w);
      document.getElementById('newWorkForm').reset();
      closeDialog('newWorkDialog');
      toast('Trabalho criado! Comece a escrever.');
      openWork(w.id);
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
          <button class="btn btn-sm btn-ghost" onclick="generateSection(${i})" title="Gerar com IA">✨</button>
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
  const prompt=sec.content?
    `Expande e melhora este texto académico mantendo o contexto:\n\n${sec.content.replace(/<[^>]+>/g,'')}\n\nTema: ${w.title}. Norma: ${w.norm||'APA 7ª'}. Tom académico. Use citações reais APA.`:
    `Escreve o conteúdo da secção "${sec.title}" do trabalho "${w.title}" (${w.work_type||w.type||'Monografia'}, ${w.level||w.area||'Licenciatura'}). Norma ${w.norm||'APA 7ª'}. Use citações reais em APA 7ª. Tom académico. Mínimo 500 palavras. Inclua referências reais no final da secção.`;
  toast('A gerar com IA...');
  try{
    const d=await aiRequest('generate',prompt,'Português','Académico');
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
    await fetch('/api/works/'+w.id,{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({word_count:w.word_count,status:w.status})
    });
    for(const s of(w.sections||[])){
      if(s.id&&s._dirty){
        await fetch('/api/works/'+w.id+'/sections/'+s.id,{method:'PUT',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({content:s.content,title:s.title})
        });
        s._dirty=false;
      }
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
      body:JSON.stringify({work_id:S.currentWork?.id,message:msg,context:S.currentWork?`Título: ${S.currentWork.title}. Tipo: ${S.currentWork.work_type||S.currentWork.type}. Norma: ${S.currentWork.norm||'APA 7ª'}. Secções: ${(S.currentWork.sections||[]).map(s=>s.title).join(', ')}.`:''})
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
async function aiRequest(mode,prompt,lang,tone){
  const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({mode,prompt,language:lang||'Português',tone:tone||'Académico',work_id:S.currentWork?.id})
  });return await r.json();
}

/* ── Export ── */
function exportWork(){
  const w=S.currentWork;if(!w){toast('Abra um trabalho primeiro');return}
  window.open('/api/export/'+w.id,'_blank');
  toast('Export iniciado...');
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
function showDialog(id){const d=document.getElementById(id);if(d&&d.showModal)d.showModal()}
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

function updateAll(){renderDashboard();renderWorksList();renderEditorRefs();renderRefsFull();renderApaPreview()}
