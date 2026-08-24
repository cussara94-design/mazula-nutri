let chartWeight=null,chartBmi=null;
let allPatients=[];
let selectedDate=todayStr();
let focusId=null;
let charts={};
let sintomasData={};
let diagnosticoResult=null;

function todayStr(){return new Date().toISOString().slice(0,10)}
function initials(n){return n.split(' ').slice(0,2).map(x=>x[0]||'').join('').toUpperCase()}
function age(b){if(!b)return '';const n=new Date(),d=new Date(b+'T12:00:00');let a=n.getFullYear()-d.getFullYear();if(n<new Date(n.getFullYear(),d.getMonth(),d.getDate()))a--;return a+' anos'}
function fmtDate(d){if(!d)return '';return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(new Date(d+'T12:00:00')).replace('.','')}
function fmtDateFull(d){if(!d)return '';return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long',year:'numeric'}).format(new Date(d+'T12:00:00')).replace('.','')}
function statusLabel(s){return{confirmed:'Confirmada',scheduled:'A confirmar',done:'Concluida',cancelled:'Cancelada',active:'Ativa',inactive:'Inativa'}[s]||s}
function bmiCat(bmi){if(!Number.isFinite(bmi))return '';if(bmi<18.5)return 'Baixo peso';if(bmi<25)return 'Eutrofia';if(bmi<30)return 'Sobrepeso';if(bmi<35)return 'Obesidade grau I';if(bmi<40)return 'Obesidade grau II';return 'Obesidade grau III'}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(window._tt);window._tt=setTimeout(()=>t.classList.remove('show'),3000)}
function showLoading(){document.getElementById('loading').style.display='flex'}
function hideLoading(){document.getElementById('loading').style.display='none'}

async function api(url,opts={}){
  try{
    const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});
    if(r.status===401){window.location.href='/login';return null}
    const data=await r.json();
    if(!r.ok){toast(data.error||'Erro');return null}
    return data;
  }catch(e){toast('Erro de conexao');return null}
}

function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.style.display='none');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
  const el=document.getElementById(name);
  if(el)el.style.display='block';
  const btn=document.querySelector(`.nav button[data-view="${name}"]`);
  if(btn)btn.classList.add('active');
  const labels={dashboard:'Ola, nutricionista',patients:'Pacientes',schedule:'Agenda',plans:'Planos alimentares',evolution:'Evolucao clinica',assessment:'Avaliacao nutricional',diagnostico:'Diagnostico Nutricional'};
  document.getElementById('pageTitle').textContent=labels[name]||'';
  window.scrollTo({top:0,behavior:'smooth'});
  if(name==='dashboard')loadDashboard();
  else if(name==='patients')loadPatients();
  else if(name==='schedule')loadSchedule();
  else if(name==='plans')loadPlans();
  else if(name==='evolution')loadEvolution();
  else if(name==='assessment')loadAssessmentView();
  else if(name==='diagnostico')loadDiagnostico();
}

async function loadDashboard(){
  const d=await api('/api/dashboard');
  if(!d)return;
  const appts=d.today_appointments||[];
  const recent=d.recent_assessments||[];
  document.getElementById('dashboard').innerHTML=`
    <div class="metrics">
      <div class="metric"><div class="metric-label">Consultas hoje</div><div class="metric-value">${appts.length}</div><div class="metric-note">${appts.filter(a=>a.status==='confirmed').length} confirmadas</div></div>
      <div class="metric"><div class="metric-label">Pacientes ativos</div><div class="metric-value">${d.active_patients||0}</div><div class="metric-note">em acompanhamento</div></div>
      <div class="metric"><div class="metric-label">Total pacientes</div><div class="metric-value">${d.total_patients||0}</div><div class="metric-note warn">cadastrados</div></div>
      <div class="metric"><div class="metric-label">Consultas concluidas</div><div class="metric-value">${d.completed_appointments||0}</div><div class="metric-note">registradas</div></div>
    </div>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><div><h2>Agenda de hoje</h2><p class="sub">Consultas e retornos programados</p></div><button class="text-link" onclick="showView('schedule')">Ver agenda</button></div>
        <div class="consult-list">${appts.length?appts.map(a=>`<div class="consult-row"><span class="time">${a.time||'--:--'}</span><div><div class="patient-line">${a.patient_name||'Paciente'}</div><div class="patient-meta">${a.type||'Consulta'}</div></div><span class="chip ${a.status}">${statusLabel(a.status)}</span></div>`).join(''):'<p class="empty">Nenhuma consulta prevista para hoje.</p>'}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Avaliacoes recentes</h2><p class="sub">Ultimos registros nutricionais</p></div></div>
        ${recent.length?recent.map(r=>`<div class="consult-row"><div><div class="patient-line">${r.patient_name||'Paciente'}</div><div class="patient-meta">${fmtDate(r.date)} - IMC: ${r.bmi?Number(r.bmi).toFixed(1):'--'}</div></div></div>`).join(''):'<p class="empty">Nenhuma avaliacao registrada.</p>'}
      </section>
    </div>`;
}

async function loadPatients(search=''){
  const data=await api('/api/patients'+(search?'?search='+encodeURIComponent(search):''));
  if(!data)return;
  allPatients=data.patients||[];
  const el=document.getElementById('patients');
  el.innerHTML=`
    <div class="page-head"><div><h2>Pacientes</h2><p>Prontuarios e dados de acompanhamento.</p></div><div class="actions"><input class="search" id="patientSearch" placeholder="Buscar paciente..." oninput="loadPatients(this.value)" value="${search}"><button class="btn btn-primary" onclick="openPatientDialog()">+ Novo paciente</button></div></div>
    <section class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Paciente</th><th>Objetivo</th><th>Ultima consulta</th><th>Proximo</th><th>Status</th><th></th></tr></thead><tbody>
    ${allPatients.length?allPatients.map(p=>`<tr>
      <td><div class="person"><span class="person-avatar">${initials(p.name)}</span><span><strong>${p.name}</strong><small>${age(p.birth)} . ${p.phone||'sem telefone'}</small></span></div></td>
      <td>${p.goal||'--'}</td><td>${p.last?fmtDate(p.last):'--'}</td><td>${p.next?fmtDate(p.next):'Sem agendamento'}</td>
      <td><span class="chip ${p.status||'active'}">${statusLabel(p.status||'active')}</span></td>
      <td><button class="mini-btn" onclick="openDetail(${p.id})">Prontuario</button></td>
    </tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum paciente encontrado.</td></tr>'}
    </tbody></table></div></section>`;
}

async function loadSchedule(){
  const days=[];for(let i=-1;i<6;i++){const d=new Date();d.setDate(d.getDate()+i);days.push(d.toISOString().slice(0,10))}
  const data=await api('/api/appointments?date='+selectedDate);
  const appts=data?data.appointments:[];
  const el=document.getElementById('schedule');
  el.innerHTML=`
    <div class="page-head"><div><h2>Agenda</h2><p>Planeje atendimentos, retornos e avaliacoes.</p></div><button class="btn btn-primary" onclick="openAppointmentDialog()">+ Nova consulta</button></div>
    <div class="schedule-layout">
      <section class="panel date-card">${days.map(d=>{const x=new Date(d+'T12:00:00');return `<button class="date-row ${d===selectedDate?'active':''}" onclick="selectDate('${d}')"><span>${new Intl.DateTimeFormat('pt-BR',{weekday:'short'}).format(x).replace('.','')}</span><b>${x.getDate()} ${new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(x).replace('.','')}</b></button>`}).join('')}</section>
      <section class="panel">
        <div class="schedule-day"><div><strong>${selectedDate===todayStr()?'Hoje':fmtDateFull(selectedDate)}</strong><p class="sub">${appts.length} atendimento${appts.length!==1?'s':''}</p></div><button class="text-link" onclick="selectDate('${todayStr()}')">Hoje</button></div>
        <div class="agenda">${appts.length?appts.map(a=>`<div class="agenda-item"><strong class="time">${a.time||'--:--'}</strong><div><div class="agenda-name">${a.patient_name||'Paciente'} <span class="chip ${a.status}">${statusLabel(a.status)}</span></div><div class="agenda-type">${a.type||'Consulta'}</div></div><div class="agenda-actions"><button class="icon-btn" title="Prontuario" onclick="openDetail(${a.patient_id})">&#8599;</button>${a.status!=='done'?`<button class="icon-btn" title="Concluir" onclick="doneAppointment(${a.id})">&#10003;</button>`:''}</div></div>`).join(''):'<p class="empty">Nenhum atendimento neste dia.</p>'}</div>
      </section>
    </div>`;
}

async function loadPlans(){
  const data=await api('/api/patients');
  if(!data)return;
  const patients=data.patients||[];
  const el=document.getElementById('plans');
  el.innerHTML=`<div class="page-head"><div><h2>Planos alimentares</h2><p>Planos ativos e proximos de revisao.</p></div></div>
    <div class="plans">${patients.map(p=>`<article class="plan-card">
      <div class="person"><span class="person-avatar">${initials(p.name)}</span><span><strong>${p.name}</strong><small>${p.goal||'--'}</small></span></div>
      <h3>${p.plan||'Plano alimentar em elaboracao'}</h3>
      <p>${p.notes||'Sem observacoes.'}</p>
      <div class="progress-label"><span>Ultimo registro</span><span>${p.last?fmtDate(p.last):'--'}</span></div>
      <div class="plan-footer"><span>Revisao: ${p.review||'a definir'}</span><button class="mini-btn" onclick="openDetail(${p.id})">Ver prontuario</button></div>
    </article>`).join('')||'<p class="empty">Cadastre um paciente para comecar.</p>'}</div>`;
}

async function loadEvolution(){
  const data=await api('/api/evolution');
  if(!data)return;
  const evo=data.evolution||[];
  const el=document.getElementById('evolution');
  el.innerHTML=`<div class="page-head"><div><h2>Evolucao clinica</h2><p>Registre resultados e acompanhe os objetivos.</p></div><button class="btn btn-primary" onclick="openEvolutionDialog()">+ Registrar evolucao</button></div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><div><h2>Registros</h2><p class="sub">Historico de evolucao</p></div></div>
        <div class="evolution-list">${evo.length?evo.map(e=>`<div class="evolution-item"><div><strong>${e.patient_name||'Paciente'}</strong><span>${fmtDate(e.date)} - ${e.text||''}</span></div><span class="${(e.change_val||0)<0?'weight-down':'weight-up'}">${e.change_val!=null?(Number(e.change_val)>=0?'+':'')+Number(e.change_val).toFixed(1).replace('.',',')+' kg':''}</span></div>`).join(''):'<p class="empty">Nenhuma evolucao registrada.</p>'}</div>
      </section>
      <section class="panel"><div class="panel-head"><div><h2>Resumo</h2><p class="sub">Ultimos registros</p></div></div>
        <div class="measure-grid"><div class="measure"><span>Total registros</span><strong>${evo.length}</strong></div><div class="measure"><span>Pacientes acompanhados</span><strong>${new Set(evo.map(e=>e.patient_id)).size}</strong></div></div>
      </section>
    </div>`;
}

async function loadAssessmentView(){
  const pData=await api('/api/patients');
  if(!pData)return;
  const patients=pData.patients||[];
  if(!patients.length){document.getElementById('assessment').innerHTML='<p class="empty">Cadastre um paciente primeiro.</p>';return}
  if(!focusId)focusId=patients[0].id;
  const aData=await api('/api/assessments?patient_id='+focusId);
  const assessments=aData?aData.assessments:[];
  const p=patients.find(x=>x.id===focusId)||patients[0];
  const latest=assessments[0]||null;
  const el=document.getElementById('assessment');
  el.innerHTML=`<div class="page-head"><div><h2>Avaliacao nutricional</h2><p>Registre dados clinicos e consolide sua impressao nutricional.</p></div><button class="btn btn-primary" onclick="openAssessmentDialog()">+ Nova avaliacao</button></div>
    <section class="panel" style="margin-bottom:18px">
      <div class="panel-head"><div><h2>Resultados do paciente</h2><p class="sub">Indicadores calculados a partir da ultima avaliacao.</p></div><select class="search" id="assessmentPatientFilter" onchange="focusId=Number(this.value);loadAssessmentView()">${patients.map(p=>`<option value="${p.id}" ${p.id===focusId?'selected':''}>${p.name}</option>`).join('')}</select></div>
      ${latest?`<div class="focus-patient"><div class="focus-avatar">${initials(p.name)}</div><div><strong>${p.name}</strong><span>${p.goal||''}</span></div></div>
      <div class="metrics" style="margin:0 0 18px">
        <div class="metric"><div class="metric-label">Peso atual</div><div class="metric-value">${latest.weight?String(latest.weight).replace('.',',')+' kg':'--'}</div><div class="metric-note">${latest.date?fmtDate(latest.date):''}</div></div>
        <div class="metric"><div class="metric-label">IMC</div><div class="metric-value">${latest.bmi?Number(latest.bmi).toFixed(1).replace('.',','):'--'}</div><div class="metric-note">${latest.bmi?bmiCat(latest.bmi):''}</div></div>
        <div class="metric"><div class="metric-label">Cintura</div><div class="metric-value">${latest.waist?String(latest.waist).replace('.',',')+' cm':'--'}</div><div class="metric-note">ultima medida</div></div>
        <div class="metric"><div class="metric-label">Gordura corporal</div><div class="metric-value">${latest.body_fat?String(latest.body_fat).replace('.',',')+'%':'--'}</div><div class="metric-note">ultima medida</div></div>
      </div>
      <div class="grid-2"><div>
        <div class="detail-section"><h4>Diagnostico nutricional</h4><p>${latest.diagnosis||'Nao registrado.'}</p></div>
        <div class="detail-section"><h4>Conduta e orientacoes</h4><p>${latest.conduct||'Nao registrada.'}</p></div>
        <div class="detail-section"><h4>Observacoes</h4><p>${latest.notes||'Nao registradas.'}</p></div>
      </div><div>
        <div class="detail-section"><h4>Historico de avaliacoes</h4>
        ${assessments.slice(0,10).map(h=>`<div class="evolution-item"><div><strong>${fmtDate(h.date)}</strong><span>IMC ${h.bmi?Number(h.bmi).toFixed(1).replace('.',','):'--'} - ${h.bmi?bmiCat(h.bmi):''}</span></div><span class="weight-down">${h.weight?String(h.weight).replace('.',',')+' kg':''}</span></div>`).join('')}
        </div>
      </div></div>`:'<p class="empty">Nenhuma avaliacao registrada para este paciente.</p>'}
    </section>`;
}

function openPatientDialog(){
  document.getElementById('patientForm').reset();
  document.getElementById('patientDialog').showModal();
}
function openAppointmentDialog(){
  if(!allPatients.length){toast('Cadastre um paciente primeiro.');return}
  const sel=document.getElementById('aPatient');
  sel.innerHTML=allPatients.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  document.getElementById('appointmentForm').reset();
  document.getElementById('aDate').value=selectedDate;
  document.getElementById('aTime').value='09:00';
  document.getElementById('appointmentDialog').showModal();
}
function openAssessmentDialog(){
  if(!allPatients.length){toast('Cadastre um paciente primeiro.');return}
  const sel=document.getElementById('asPatient');
  sel.innerHTML=allPatients.map(p=>`<option value="${p.id}" ${p.id===focusId?'selected':''}>${p.name}</option>`).join('');
  document.getElementById('assessmentForm').reset();
  document.getElementById('asDate').value=todayStr();
  document.getElementById('bmiPreview').textContent='Informe peso e altura para calcular o IMC.';
  document.getElementById('assessmentDialog').showModal();
}
function openEvolutionDialog(){
  if(!allPatients.length){toast('Cadastre um paciente primeiro.');return}
  const sel=document.getElementById('ePatient');
  sel.innerHTML=allPatients.map(p=>`<option value="${p.id}" ${p.id===focusId?'selected':''}>${p.name}</option>`).join('');
  document.getElementById('evolutionForm').reset();
  document.getElementById('eDate').value=todayStr();
  document.getElementById('evolutionDialog').showModal();
}
function selectDate(d){selectedDate=d;loadSchedule()}
function updateBmiPreview(){
  const w=Number(document.getElementById('asWeight').value);
  const h=Number(document.getElementById('asHeight').value);
  const el=document.getElementById('bmiPreview');
  if(!w||!h){el.textContent='Informe peso e altura para calcular o IMC.';return}
  const bmi=w/((h/100)**2);
  el.innerHTML='IMC calculado: <b>'+bmi.toFixed(1).replace('.',',')+'</b> - '+bmiCat(bmi)+' <span style="color:var(--muted)">(referencia para adultos)</span>';
}

async function doneAppointment(id){
  const r=await api('/api/appointments/'+id,{method:'PUT',body:JSON.stringify({status:'done'})});
  if(r){toast('Consulta concluida.');loadSchedule();loadDashboard();}
}
async function openDetail(id){
  const data=await api('/api/patients/'+id);
  if(!data||!data.patient)return;
  const p=data.patient;
  const assessments=p.assessments||[];
  const appointments=p.appointments||[];
  const latest=assessments[0]||null;
  const variation=p.initial_weight&&p.current_weight?(p.current_weight-p.initial_weight).toFixed(1):'--';
  document.getElementById('patientDetail').innerHTML=`
    <div class="detail-summary"><div class="detail-avatar">${initials(p.name)}</div><div><h3>${p.name}</h3><p>${age(p.birth)} . ${p.phone||'Telefone nao informado'}</p></div></div>
    <div class="detail-columns">
      <div class="detail-stat"><span>Objetivo</span><b>${p.goal||'--'}</b></div>
      <div class="detail-stat"><span>Peso inicial</span><b>${p.initial_weight?String(p.initial_weight).replace('.',',')+' kg':'--'}</b></div>
      <div class="detail-stat"><span>Peso atual</span><b>${p.current_weight?String(p.current_weight).replace('.',',')+' kg':'--'}</b></div>
    </div>
    <div class="detail-section"><h4>Evolucao</h4><p><b>${variation!=='--'?(Number(variation)>=0?'+':'')+variation+' kg':''}</b> desde o inicio. Ultima consulta: ${p.last?fmtDateFull(p.last):'--'}.</p></div>
    <div class="detail-section"><h4>Ultima avaliacao nutricional</h4><p>${latest?'IMC <b>'+Number(latest.bmi).toFixed(1).replace('.',',')+'</b> - '+bmiCat(latest.bmi)+'<br>'+(latest.diagnosis||''):'Nenhuma avaliacao registrada.'}</p></div>
    <div class="detail-section"><h4>Plano alimentar</h4><p>${p.plan||'Ainda nao ha plano alimentar cadastrado.'}</p></div>
    <div class="detail-section"><h4>Anotacoes clinicas</h4><p>${p.notes||'Sem anotacoes.'}</p></div>
    <div class="detail-section"><h4>Historico de consultas</h4><p>${appointments.length?appointments.map(a=>fmtDateFull(a.date)+' - '+(a.type||'Consulta')+' - '+statusLabel(a.status)).join('<br>'):'Nenhuma consulta registrada.'}</p></div>`;
  document.getElementById('detailDialog').showModal();
}

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('todayText').textContent=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date()).replace(/^./,c=>c.toUpperCase());
  api('/api/auth/me').then(d=>{if(d&&d.user){document.getElementById('userName').textContent=d.user.name;document.getElementById('userCrn').textContent='CRN '+(d.user.crn||'---');document.getElementById('userAvatar').textContent=initials(d.user.name)}});
  document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  document.getElementById('patientForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const name=document.getElementById('pName').value.trim();
    if(!name)return;
    const r=await api('/api/patients',{method:'POST',body:JSON.stringify({name,birth:document.getElementById('pBirth').value,phone:document.getElementById('pPhone').value.trim(),goal:document.getElementById('pGoal').value,initial_weight:Number(document.getElementById('pWeight').value)||0,current_weight:Number(document.getElementById('pWeight').value)||0,notes:document.getElementById('pNotes').value.trim()})});
    if(r){document.getElementById('patientDialog').close();toast(name+' cadastrado(a) com sucesso.');loadPatients();loadDashboard()}
  });
  document.getElementById('appointmentForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const r=await api('/api/appointments',{method:'POST',body:JSON.stringify({patient_id:Number(document.getElementById('aPatient').value),date:document.getElementById('aDate').value,time:document.getElementById('aTime').value,type:document.getElementById('aType').value,status:document.getElementById('aStatus').value})});
    if(r){selectedDate=document.getElementById('aDate').value;document.getElementById('appointmentDialog').close();toast('Consulta agendada.');loadSchedule()}
  });
  document.getElementById('assessmentForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const r=await api('/api/assessments',{method:'POST',body:JSON.stringify({patient_id:Number(document.getElementById('asPatient').value),date:document.getElementById('asDate').value,weight:Number(document.getElementById('asWeight').value),height:Number(document.getElementById('asHeight').value),waist:Number(document.getElementById('asWaist').value)||null,body_fat:Number(document.getElementById('asBodyFat').value)||null,diagnosis:document.getElementById('asDiagnosis').value.trim(),conduct:document.getElementById('asConduct').value.trim(),notes:document.getElementById('asNotes').value.trim()})});
    if(r){focusId=Number(document.getElementById('asPatient').value);document.getElementById('assessmentDialog').close();toast('Avaliacao salva.');loadAssessmentView()}
  });
  document.getElementById('evolutionForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const r=await api('/api/evolution',{method:'POST',body:JSON.stringify({patient_id:Number(document.getElementById('ePatient').value),date:document.getElementById('eDate').value,text:document.getElementById('eText').value.trim(),change_val:Number(document.getElementById('eChange').value)||null})});
    if(r){document.getElementById('evolutionDialog').close();toast('Evolucao registrada.');loadEvolution()}
  });
  document.getElementById('asWeight').addEventListener('input',updateBmiPreview);
  document.getElementById('asHeight').addEventListener('input',updateBmiPreview);
  document.getElementById('closeDetail').addEventListener('click',()=>document.getElementById('detailDialog').close());
  document.getElementById('diagnosticoForm').addEventListener('submit',submitDiagnostico);
  document.getElementById('dPeso').addEventListener('input',updateDiagBmiPreview);
  document.getElementById('dAltura').addEventListener('input',updateDiagBmiPreview);
  ['patientDialog','appointmentDialog','assessmentDialog','evolutionDialog','diagnosticoDialog'].forEach(id=>{
    document.getElementById(id).addEventListener('click',e=>{if(e.target===document.getElementById(id))document.getElementById(id).close()});
  });
  loadDashboard();
});

async function doLogout(){
  await api('/api/auth/logout',{method:'POST'});
  window.location.href='/login';
}

async function loadDiagnostico(){
  if(!Object.keys(sintomasData).length){
    const sData=await api('/api/sintomas');
    if(sData&&sData.sintomas)sintomasData=sData.sintomas;
  }
  const el=document.getElementById('diagnostico');
  const grid=Object.entries(sintomasData).map(([k,v])=>`<label class="sintoma-chip" data-key="${k}"><input type="checkbox" value="${k}"> ${v}</label>`).join('');
  el.innerHTML=`
    <div class="page-head"><div class="diag-header"><h2>Diagnostico Nutricional Inteligente</h2><p>Análise automatizada com base em dados antropometricos e sintomas do paciente.</p></div>
    <button class="btn btn-primary" onclick="openDiagnosticoDialog()"><i class="fas fa-brain"></i> Nova Analise</button></div>
    <div id="diagResults">${diagnosticoResult?renderDiagResults(diagnosticoResult):'<div class="diag-empty"><i class="fas fa-brain"></i><p>Nenhuma analise realizada.<br>Clique em "Nova Analise" para comecar.</p></div>'}</div>`;
}

function renderDiagResults(result){
  if(!result||!result.diagnosticos||!result.diagnosticos.length)return'<div class="diag-empty"><i class="fas fa-info-circle"></i><p>Dados insuficientes para diagnostico.</p></div>';
  const inp=result.input||{};
  let html=`<section class="panel" style="margin-bottom:18px"><div class="panel-head"><div><h2>Dados da Analise</h2><p class="sub">Parametros utilizados no calculo</p></div></div>
    <div class="metrics" style="margin:0">
      <div class="metric"><div class="metric-label">Peso</div><div class="metric-value">${inp.peso?inp.peso+' kg':'--'}</div></div>
      <div class="metric"><div class="metric-label">Altura</div><div class="metric-value">${inp.altura?inp.altura+' cm':'--'}</div></div>
      <div class="metric"><div class="metric-label">IMC</div><div class="metric-value">${inp.imc?inp.imc.toFixed(1):'--'}</div><div class="metric-note">${inp.imc?bmiCat(inp.imc):''}</div></div>
      <div class="metric"><div class="metric-label">Sintomas</div><div class="metric-value">${(inp.sintomas||[]).length}</div><div class="metric-note">seleccionados</div></div>
    </div></section>`;
  result.diagnosticos.forEach(d=>{
    html+=`<div class="diag-result" style="--diag-color:${d.cor}">
      <div class="diag-result-head">
        <h3><span class="diag-badge ${d.gravidade}">${d.gravidade.replace('_',' ')}</span> ${d.nome}</h3>
        <span class="diag-conf">${d.confianca}% confianca</span>
      </div>
      <p class="diag-desc">${d.descricao}</p>
      <div style="margin-top:10px"><strong style="font-size:12px;color:var(--ink)">Recomendacoes:</strong>
        <ul class="diag-recomendacoes">${d.recomendacoes.map(r=>`<li>${r}</li>`).join('')}</ul>
      </div>
    </div>`;
  });
  return html;
}

function openDiagnosticoDialog(){
  const grid=document.getElementById('sintomasGrid');
  if(!grid.children.length){
    let html='';
    for(const[k,v]of Object.entries(sintomasData)){
      html+=`<label class="sintoma-chip"><input type="checkbox" value="${k}"> ${v}</label>`;
    }
    grid.innerHTML=html;
    grid.querySelectorAll('.sintoma-chip').forEach(ch=>{
      ch.querySelector('input').addEventListener('change',()=>ch.classList.toggle('selected',ch.querySelector('input').checked));
    });
  }
  document.getElementById('dPeso').value='';
  document.getElementById('dAltura').value='';
  document.getElementById('dCintura').value='';
  document.getElementById('dGordura').value='';
  document.getElementById('dIdade').value='';
  document.getElementById('dSexo').value='M';
  document.getElementById('dImcPreview').textContent='Informe peso e altura.';
  document.getElementById('diagnosticoDialog').showModal();
}

function updateDiagBmiPreview(){
  const w=Number(document.getElementById('dPeso').value);
  const h=Number(document.getElementById('dAltura').value);
  const el=document.getElementById('dImcPreview');
  if(!w||!h){el.textContent='Informe peso e altura.';return}
  const bmi=w/((h/100)**2);
  el.innerHTML='IMC calculado: <b>'+bmi.toFixed(1)+'</b> - '+bmiCat(bmi);
}

async function submitDiagnostico(e){
  e.preventDefault();
  const sintomas=[];
  document.querySelectorAll('#sintomasGrid input:checked').forEach(cb=>sintomas.push(cb.value));
  const payload={
    peso:Number(document.getElementById('dPeso').value)||null,
    altura:Number(document.getElementById('dAltura').value)||null,
    cintura:Number(document.getElementById('dCintura').value)||null,
    gordura:Number(document.getElementById('dGordura').value)||null,
    idade:Number(document.getElementById('dIdade').value)||null,
    sexo:document.getElementById('dSexo').value,
    sintomas:sintomas,
  };
  showLoading();
  const result=await api('/api/diagnose',{method:'POST',body:JSON.stringify(payload)});
  hideLoading();
  if(result){
    diagnosticoResult=result;
    document.getElementById('diagnosticoDialog').close();
    document.getElementById('diagResults').innerHTML=renderDiagResults(result);
    toast('Diagnostico realizado com sucesso!');
  }
}
