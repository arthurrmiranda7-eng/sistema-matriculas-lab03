import { AuthService, CatalogoService, MatriculaService, ProfessorService, SecretariaService } from './services.js';
import { config as defaultConfig } from './config.js';

const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const modal = $('#modal');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const roles = { aluno: 'Aluno', professor: 'Professor', secretaria: 'Secretaria' };
const fmt = value => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  book: '<path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4z"/><path d="M12 6v15"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  check: '<path d="m8 12 3 3 6-7"/><rect x="3" y="3" width="18" height="18" rx="4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h3"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1"/>',
  bill: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM9 7h6m-6 5h6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3" fill="white"/><circle cx="16" cy="17" r="3" fill="white"/>',
}[name] || ''}</svg>`;
let client, auth, catalog, registration, professor, secretary;
let state = { user: null, semesters: [], courses: [], offerings: [], enrollments: [], profiles: [], subjects: [], billing: [], semesterId: '', page: 'catalogo', selections: new Map(), search: '', filter: '', busy: false };
let connection;
let refreshVersion = 0;
function toast(message, error = false) {
  const area = $('#notifications');
  area.innerHTML = `<div class="notification ${error ? 'error' : ''}"><span>${esc(message)}</span><button aria-label="Fechar aviso">×</button></div>`;
  $('button', area).onclick = () => area.replaceChildren();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => area.replaceChildren(), 9000);
}
function errorMessage(e) {
  if (e?.message === 'Invalid login credentials') return 'E-mail ou senha incorretos.';
  if (e?.message?.includes('Failed to fetch')) return 'Não foi possível conectar ao Supabase. Verifique a conexão e a configuração do projeto.';
  return e?.message || 'Não foi possível concluir a operação. Tente novamente.';
}
async function action(fn) {
  if (state.busy) return;
  state.busy = true;
  document.body.setAttribute('aria-busy', 'true');
  const active = document.activeElement;
  if (active instanceof HTMLButtonElement) active.disabled = true;
  try { await fn(); } catch (e) { toast(errorMessage(e), true); }
  finally { state.busy = false; document.body.removeAttribute('aria-busy'); if (active?.isConnected && active instanceof HTMLButtonElement) active.disabled = false; }
}
function dialog(title, body, setup) {
  $('#modal-content').innerHTML = `<div class="dialog-header"><h2 id="modal-title">${esc(title)}</h2><button class="close-modal" aria-label="Fechar janela">×</button></div>${body}`;
  $('.close-modal', modal).onclick = () => modal.close();
  if (!modal.open) modal.showModal();
  setup?.();
}
function confirmDialog(title, text, fn, label = 'Confirmar') {
  dialog(title, `<p>${esc(text)}</p><div class="dialog-actions"><button class="btn btn-outline-secondary" data-dismiss>Voltar</button><button class="btn btn-primary" data-confirm>${esc(label)}</button></div>`, () => {
    $('[data-dismiss]', modal).onclick = () => modal.close();
    $('[data-confirm]', modal).onclick = () => action(async () => { await fn(); modal.close(); });
  });
}
const brand = () => '<div class="brand"><img src="assets/logo.svg" width="40" height="40" alt=""><div>Campus<small>Sistema acadêmico</small></div></div>';
function renderLogin() {
  app.innerHTML = `<div class="login-page"><aside class="login-story">${brand()}<div class="story-content"><div class="eyebrow mb-4">Seu próximo semestre começa aqui</div><h1>Conhecimento abre<br><span>novos caminhos.</span></h1><p class="mt-4">Organize suas disciplinas e prepare o próximo capítulo da sua jornada acadêmica.</p><div class="story-art" aria-hidden="true"><span style="height:60%"></span><span style="height:85%"></span><span style="height:100%"></span><span style="height:72%"></span><span style="height:45%"></span></div></div><div class="story-foot">Portal universitário · Sistema de Matrículas</div></aside>
  <main id="main" class="login-panel"><div class="login-box"><div class="connection-state ${client ? 'ready' : ''}">${client ? 'Conexão configurada' : 'Configuração inicial necessária'}</div><h2>Bem-vindo ao Campus</h2><p class="text-muted">Entre com sua conta institucional para continuar.</p>
  <form id="login-form"><div class="mb-3"><label class="form-label" for="email">E-mail institucional</label><input class="form-control" id="email" name="email" type="email" autocomplete="username" placeholder="seu.nome@universidade.edu.br" required maxlength="254"></div><div class="mb-4"><label class="form-label" for="password">Senha</label><input class="form-control" id="password" name="password" type="password" autocomplete="current-password" placeholder="Sua senha de acesso" required maxlength="128"></div><button class="btn btn-primary w-100" ${!client ? 'disabled' : ''}>Entrar no portal</button></form>
  ${!client ? '<div class="setup-note">Para começar, conecte o projeto Supabase e execute os scripts do banco indicados no README.</div>' : ''}<div class="login-note"><p class="small text-muted">Precisa de uma conta ou esqueceu sua senha? Procure a secretaria da universidade.</p><button class="btn btn-sm btn-outline-secondary" id="configure">Configurar conexão</button></div><p class="footnote">Acesso para alunos, professores e secretaria.<br>As permissões são definidas pela universidade.</p></div></main></div>`;
  $('#configure').onclick = configureDialog;
  $('#login-form').onsubmit = e => { e.preventDefault(); const data = new FormData(e.currentTarget); action(async () => {
    await auth.entrar(data.get('email').trim(), data.get('password'));
    state.user = await auth.usuario();
    if (!state.user) throw new Error('Seu perfil não foi encontrado. Procure a secretaria.');
    state.page = state.user.role === 'aluno' ? 'catalogo' : state.user.role === 'professor' ? 'turmas' : 'curriculo';
    await refresh();
  }); };
}
function configureDialog() {
  dialog('Conectar ao Supabase', `<p class="text-muted small">Use a URL e a chave pública disponíveis nas configurações do seu projeto. Execute primeiro <code>supabase/schema.sql</code> e <code>supabase/seed.sql</code>.</p><form id="config-form"><div class="mb-3"><label for="supabase-url" class="form-label">URL do projeto</label><input id="supabase-url" name="url" type="url" class="form-control" placeholder="https://seu-projeto.supabase.co" value="${esc(connection?.supabaseUrl || '')}" required></div><div class="mb-3"><label for="supabase-key" class="form-label">Chave pública anon ou publishable</label><input id="supabase-key" name="key" class="form-control" value="${esc(connection?.supabaseKey || '')}" required autocomplete="off"></div><p class="small text-muted">A configuração pública será salva somente neste navegador. Nunca informe a chave <code>service_role</code> ou uma chave secreta.</p><p id="config-error" class="error-inline" role="alert"></p><div class="dialog-actions"><button type="submit" class="btn btn-primary">Salvar e conectar</button></div></form>`, () => {
    $('#config-form').onsubmit = e => { e.preventDefault(); const data = new FormData(e.currentTarget); action(async () => {
      try {
        const next = { supabaseUrl: data.get('url').trim().replace(/\/$/, ''), supabaseKey: data.get('key').trim() };
        validateConfig(next);
        const candidate = await makeClient(next);
        const { error } = await candidate.auth.getSession();
        if (error) throw error;
        localStorage.setItem('campus.connection', JSON.stringify(next));
        connection = next; bindClient(candidate); modal.close(); renderLogin(); toast('Conexão salva. Entre com uma conta cadastrada.');
      } catch (err) { $('#config-error').textContent = errorMessage(err); }
    }); };
  });
}
function changePasswordDialog() {
  if (!state.user) return;
  dialog('Alterar senha', `<p class="small text-muted">Use uma senha exclusiva para este sistema, com pelo menos 12 caracteres.</p><form id="password-form"><div class="mb-3"><label class="form-label" for="new-password">Nova senha</label><input class="form-control" id="new-password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div><div class="mb-3"><label class="form-label" for="repeat-password">Confirmar nova senha</label><input class="form-control" id="repeat-password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div><p id="password-error" class="error-inline" role="alert"></p><div class="dialog-actions"><button type="button" class="btn btn-outline-secondary" data-dismiss>Cancelar</button><button type="submit" class="btn btn-primary">Salvar nova senha</button></div></form>`, () => {
    const form = $('#password-form');
    modal.addEventListener('close', () => form.reset(), { once: true });
    $('[data-dismiss]', form).onclick = () => modal.close();
    form.onsubmit = event => {
      event.preventDefault();
      const password = $('#new-password', form).value;
      const confirmation = $('#repeat-password', form).value;
      const feedback = $('#password-error', form);
      feedback.textContent = '';
      if (password.length < 12) { feedback.textContent = 'A nova senha deve ter pelo menos 12 caracteres.'; return; }
      if (password !== confirmation) { feedback.textContent = 'As duas senhas precisam ser iguais.'; return; }
      action(async () => {
        try {
          await auth.alterarSenha(password);
          form.reset();
          modal.close();
          toast('Senha alterada com sucesso. Use a nova senha no próximo acesso.');
        } catch (error) { feedback.textContent = errorMessage(error); }
      });
    };
  });
}
function validateConfig(c) {
  const url = new URL(c.supabaseUrl);
  if (url.protocol !== 'https:' && !(['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:')) throw new Error('Utilize uma URL HTTPS do projeto Supabase.');
  if (!c.supabaseKey || c.supabaseKey.includes('SUA_') || c.supabaseKey.startsWith('sb_secret_')) throw new Error('Informe apenas a chave pública do projeto.');
  if (c.supabaseKey.startsWith('eyJ')) {
    try { if (JSON.parse(atob(c.supabaseKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role !== 'anon') throw new Error('Use a chave pública anon.'); }
    catch { throw new Error('A chave JWT deve ser pública, com papel anon.'); }
  } else if (!c.supabaseKey.startsWith('sb_publishable_')) throw new Error('A chave deve ser anon JWT ou sb_publishable_.');
}
async function makeClient(c) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm');
  return createClient(c.supabaseUrl, c.supabaseKey);
}
function bindClient(c) {
  client = c; auth = new AuthService(c); catalog = new CatalogoService(c);
  registration = new MatriculaService(c); professor = new ProfessorService(c); secretary = new SecretariaService(c);
  c.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' && state.user) { state.user = null; renderLogin(); }
  });
}
const semester = () => state.semesters.find(s => s.id === state.semesterId);
const currentEnrollments = () => state.enrollments.filter(e => state.offerings.some(o => o.id === e.offering_id));
const activeEnrollments = () => currentEnrollments().filter(e => e.status === 'matriculada');
const courseOfferings = () => state.offerings.filter(o => o.course_id === state.user.course_id);
function resetSelections() { state.selections = new Map(activeEnrollments().map(e => [e.offering_id, e.kind])); }
async function refresh() {
  const version = ++refreshVersion;
  const [semesters, courses] = await Promise.all([catalog.semestres(), catalog.cursos()]);
  if (version !== refreshVersion) return;
  state.semesters = semesters; state.courses = courses;
  if (!semesters.some(s => s.id === state.semesterId)) state.semesterId = semesters.find(s => s.estaAberto())?.id || semesters[0]?.id || '';
  state.offerings = state.semesterId ? await catalog.ofertas(state.semesterId) : [];
  if (state.user.role === 'aluno') state.enrollments = await registration.listar(state.user.id);
  if (state.user.role === 'secretaria') [state.profiles, state.subjects, state.billing] = await Promise.all(['profiles', 'subjects', 'billing_events'].map(t => secretary.listar(t)));
  resetSelections(); renderShell();
}
function navItems() {
  if (state.user.role === 'aluno') return [['catalogo', 'Disciplinas', 'grid'], ['matriculas', 'Minhas matrículas', 'check'], ['ajuda', 'Orientações', 'help']];
  if (state.user.role === 'professor') return [['turmas', 'Minhas turmas', 'users'], ['ajuda', 'Orientações', 'help']];
  return [['curriculo', 'Currículo semestral', 'grid'], ['cadastros', 'Cadastros acadêmicos', 'book'], ['pessoas', 'Alunos e professores', 'users'], ['cobrancas', 'Notificações de cobrança', 'bill'], ['ajuda', 'Orientações', 'help']];
}
function renderShell() {
  const u = state.user;
  app.innerHTML = `<div class="layout"><aside class="sidebar">${brand()}<div class="nav-label">Portal ${u.role === 'aluno' ? 'do aluno' : u.role === 'professor' ? 'do professor' : 'da secretaria'}</div><nav aria-label="Menu principal">${navItems().map(([id, text, glyph]) => `<button class="nav-item-button ${id === state.page ? 'active' : ''}" data-page="${id}" ${id === state.page ? 'aria-current="page"' : ''}>${icon(glyph)}${text}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="profile"><span class="avatar" aria-hidden="true">${esc(u.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</span><div><div class="profile-name" title="${esc(u.name)}">${esc(u.name)}</div><div class="profile-role">${roles[u.role]}</div></div></div><div class="account-actions"><button id="change-password" class="logout" type="button">Alterar senha</button><button id="logout" class="logout">Sair da conta</button></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb-text">Portal acadêmico <span>/ ${esc(navItems().find(n => n[0] === state.page)?.[1] || 'Campus')}</span></div><div class="semester-select"><label for="semester">Semestre</label><select id="semester" class="form-select" ${!state.semesters.length ? 'disabled' : ''}>${state.semesters.length ? state.semesters.map(s => `<option value="${esc(s.id)}" ${s.id === state.semesterId ? 'selected' : ''}>${esc(s.name)}</option>`).join('') : '<option>Nenhum cadastrado</option>'}</select></div></header><main id="main" class="content" tabindex="-1"></main></div></div>`;
  $$('[data-page]').forEach(el => el.onclick = () => { if (state.busy) return; state.page = el.dataset.page; state.search = ''; state.filter = ''; renderShell(); $('#main').focus(); });
  $('#change-password').onclick = () => { if (!state.busy) changePasswordDialog(); };
  $('#logout').onclick = () => action(async () => { await auth.sair(); state.user = null; state.semesterId = ''; renderLogin(); toast('Você saiu da conta.'); });
  $('#semester').onchange = e => action(async () => { state.semesterId = e.target.value; await refresh(); });
  renderPage();
}
function $$(s, root = document) { return [...root.querySelectorAll(s)]; }
function heading(title, subtitle, extra = '') { return `<div class="page-heading"><div><div class="eyebrow mb-2">${esc(state.courses.find(c => c.id === state.user.course_id)?.name || 'Portal acadêmico')}</div><h1>${title}</h1><p>${subtitle}</p></div>${extra}</div>`; }
function empty(title, text, glyph = 'book') { return `<div class="empty-state">${icon(glyph)}<h2>${title}</h2><p>${text}</p></div>`; }
function periodBanner() {
  const s = semester();
  if (!s) return '';
  return `<div class="period-banner">${icon('calendar')}<div><strong>${s.estaAberto() ? 'Período de matrículas aberto' : s.closed ? 'Semestre encerrado' : 'Fora do período de matrículas'}</strong><p>De ${fmt(s.enrollment_start)} até ${fmt(s.enrollment_end)} · Horário local do navegador</p></div></div>`;
}
function stat(label, value, foot, glyph) { return `<div class="stat-card"><div class="stat-icon">${icon(glyph)}</div><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`; }
function renderPage() {
  const views = { catalogo: renderCatalog, matriculas: renderRegistrations, turmas: renderProfessor, curriculo: renderCurriculum, cadastros: renderRecords, pessoas: renderPeople, cobrancas: renderBilling, ajuda: renderHelp };
  (views[state.page] || renderHelp)();
}
function renderCatalog() {
  const required = [...state.selections.values()].filter(v => v === 'obrigatoria').length;
  const optional = state.selections.size - required;
  const credits = courseOfferings().filter(o => state.selections.has(o.id)).reduce((n, o) => n + Number(o.credits), 0);
  $('#main').innerHTML = heading('Planeje seu próximo semestre', 'Escolha suas disciplinas e construa a sua jornada acadêmica.', semester() ? `<span class="status-tag ${semester().estaAberto() ? '' : 'closed'}">${esc(semester().name)}</span>` : '') + periodBanner() + `<div class="stats-grid">${stat('Disciplinas obrigatórias', `${required}<small>/ 4</small>`, 'Primeiras opções', 'book')}${stat('Disciplinas optativas', `${optional}<small>/ 2</small>`, 'Alternativas opcionais', 'grid')}${stat('Créditos selecionados', credits, 'Total do seu planejamento', 'check')}</div><section aria-labelledby="catalog-title"><div class="section-heading"><div><h2 id="catalog-title">Disciplinas disponíveis</h2><p>As turmas são confirmadas ao final das matrículas, com pelo menos 3 alunos.</p></div><button id="reload" class="btn btn-sm btn-outline-secondary">Atualizar vagas</button></div><div class="filters"><input id="search" class="form-control" type="search" aria-label="Buscar disciplina" placeholder="Buscar por nome ou código" value="${esc(state.search)}"><select id="availability" class="form-select" aria-label="Filtrar disponibilidade"><option value="">Todas as disciplinas</option value="vagas" ${state.filter === 'vagas' ? 'selected' : ''}>Com vagas disponíveis</option><option value="selecionadas" ${state.filter === 'selecionadas' ? 'selected' : ''}>Selecionadas</option></select></div><div id="catalog-list"></div></section><div class="selection-bar"><div><strong>Seu semestre, suas escolhas.</strong><p id="selection-summary">${required} obrigatórias e ${optional} optativas · Revise antes de confirmar.</p></div><button class="btn" id="save-enrollment" ${!semester()?.estaAberto() || required !== 4 || optional > 2 ? 'disabled' : ''}>Confirmar matrícula</button></div><p class="footnote">A confirmação salva o conjunto completo de escolhas. Retirar uma disciplina da seleção só altera sua matrícula ao confirmar. Cancelamentos individuais estão em “Minhas matrículas”.</p>`;
  renderCatalogList();
  $('#search').oninput = e => { state.search = e.target.value; renderCatalogList(); };
  $('#availability').onchange = e => { state.filter = e.target.value; renderCatalogList(); };
  $('#reload').onclick = () => confirmDialog('Atualizar disciplinas', 'A atualização descarta alterações ainda não confirmadas e recarrega suas matrículas e as vagas.', async () => { await refresh(); toast('Vagas atualizadas.'); }, 'Atualizar');
  $('#save-enrollment').onclick = () => confirmDialog('Confirmar matrícula', `Você está confirmando ${required} disciplinas obrigatórias e ${optional} optativas, totalizando ${credits} créditos. Este conjunto substituirá suas escolhas anteriores neste semestre.`, async () => {
    const ids = kind => [...state.selections].filter(([, k]) => k === kind).map(([id]) => id);
    const result = await registration.salvar(state.semesterId, ids('obrigatoria'), ids('optativa'));
    await refresh(); toast(result?.changed === false ? 'Suas matrículas já estavam atualizadas.' : 'Matrícula confirmada. Notificação de cobrança registrada.');
  }, 'Confirmar matrícula');
}
function renderCatalogList() {
  const list = $('#catalog-list');
  if (!state.user.course_id) { list.innerHTML = empty('Seu curso ainda não foi vinculado', 'Procure a secretaria para associar seu cadastro ao curso.'); return; }
  const offers = courseOfferings().filter(o => `${o.subject_name} ${o.code}`.toLowerCase().includes(state.search.toLowerCase()) && (state.filter !== 'vagas' || o.vagas() > 0) && (state.filter !== 'selecionadas' || state.selections.has(o.id)));
  list.innerHTML = offers.length ? `<div class="catalog-grid">${offers.map(o => {
    const selection = state.selections.get(o.id) || '';
    const registered = activeEnrollments().some(e => e.offering_id === o.id);
    const disabled = !semester()?.estaAberto() || o.status !== 'aberta' || (!registered && o.vagas() === 0);
    return `<article class="subject-card ${selection ? 'selected' : ''}"><div class="subject-main"><div class="subject-top"><span class="subject-code">${esc(o.code)}</span><span class="status-tag ${o.status === 'cancelada' ? 'cancelled' : !o.vagas() ? 'closed' : ''}">${o.status === 'cancelada' ? 'Cancelada' : o.status === 'ativa' ? 'Confirmada' : !o.vagas() ? 'Turma lotada' : 'Inscrições abertas'}</span></div><h3>${esc(o.subject_name)}</h3><p class="subject-professor">${esc(o.professor_name || 'Professor a definir')}</p><div class="subject-meta"><span>${Number(o.credits)} créditos</span><span>${Number(o.enrolled)} de ${Number(o.capacity)} vagas preenchidas</span></div><div class="capacity-track" aria-hidden="true"><span style="width:${Math.min(100, Number(o.enrolled) / Number(o.capacity) * 100)}%"></span></div></div><div class="subject-footer"><label class="selection-label" for="select-${esc(o.id)}">Sua opção</label><select class="form-select" id="select-${esc(o.id)}" data-select="${esc(o.id)}" ${disabled ? 'disabled' : ''}><option value="">Não selecionar</option><option value="obrigatoria" ${selection === 'obrigatoria' ? 'selected' : ''}>Obrigatória · 1ª opção</option><option value="optativa" ${selection === 'optativa' ? 'selected' : ''}>Optativa · alternativa</option></select></div></article>`;
  }).join('')}</div>` : empty('Nenhuma disciplina encontrada', state.search || state.filter ? 'Ajuste a busca ou o filtro para ver outras disciplinas.' : 'A secretaria ainda não publicou disciplinas do seu curso neste semestre.');
  $$('[data-select]').forEach(el => el.onchange = () => {
    const kind = el.value;
    const count = [...state.selections].filter(([id, value]) => id !== el.dataset.select && value === kind).length;
    if (kind && count >= (kind === 'obrigatoria' ? 4 : 2)) { el.value = state.selections.get(el.dataset.select) || ''; toast(kind === 'obrigatoria' ? 'Você já selecionou 4 obrigatórias.' : 'Você já selecionou 2 optativas.', true); return; }
    if (kind) state.selections.set(el.dataset.select, kind); else state.selections.delete(el.dataset.select);
    const focusId = el.id;
    renderCatalog();
    document.getElementById(focusId)?.focus({ preventScroll: true });
  });
}
function renderRegistrations() {
  const entries = currentEnrollments();
  $('#main').innerHTML = heading('Minhas matrículas', 'Acompanhe suas inscrições e o resultado das turmas no semestre.') + periodBanner() + (entries.length ? table(['Disciplina', 'Opção', 'Situação', ''], entries.map(e => {
    const o = state.offerings.find(o => o.id === e.offering_id);
    return [`<strong>${esc(o.subject_name)}</strong><span class="secondary">${esc(o.code)} · ${o.credits} créditos</span>`, e.kind === 'obrigatoria' ? 'Obrigatória' : 'Optativa', tag(e.status === 'matriculada' ? (o.status === 'ativa' ? 'Turma confirmada' : 'Matriculada') : 'Cancelada', e.status === 'cancelada'), e.status === 'matriculada' && semester()?.estaAberto() ? `<button class="btn btn-sm btn-outline-secondary" data-cancel="${esc(e.id)}">Cancelar matrícula</button>` : '—'];
  })) : empty('Seu semestre ainda está em branco', 'Selecione suas disciplinas na página Disciplinas e confirme a matrícula.')) + '<p class="footnote">O cancelamento individual libera a vaga e registra uma atualização para o sistema de cobranças. O histórico é preservado.</p>';
  $$('[data-cancel]').forEach(el => el.onclick = () => confirmDialog('Cancelar matrícula', 'Você deseja cancelar esta disciplina? A vaga será liberada. É possível se matricular novamente durante o período, se houver vagas.', async () => { await registration.cancelar(el.dataset.cancel); await refresh(); toast('Matrícula cancelada. Atualização de cobrança registrada.'); }, 'Cancelar matrícula'));
}
function tag(text, cancelled = false) { return `<span class="status-tag ${cancelled ? 'cancelled' : ''}">${esc(text)}</span>`; }
function table(headers, rows) { return `<div class="table-responsive"><table class="table"><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(cols => `<tr>${cols.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function renderProfessor() {
  const offers = state.offerings.filter(o => o.professor_id === state.user.id);
  $('#main').innerHTML = heading('Minhas turmas', 'Consulte os alunos matriculados nas disciplinas sob sua responsabilidade.') + (offers.length ? table(['Disciplina', 'Matriculados', 'Situação', ''], offers.map(o => [`<strong>${esc(o.subject_name)}</strong><span class="secondary">${esc(o.code)} · ${o.credits} créditos</span>`, `${o.enrolled} / ${o.capacity}`, tag(o.status, o.status === 'cancelada'), `<button class="btn btn-sm btn-outline-secondary" data-roster="${esc(o.id)}">Ver alunos</button>`])) : empty('Nenhuma turma atribuída', 'A secretaria ainda não atribuiu disciplinas a você neste semestre.', 'users'));
  $$('[data-roster]').forEach(el => el.onclick = () => action(async () => {
    const o = offers.find(o => o.id === el.dataset.roster);
    const students = await professor.listarAlunos(o.id);
    dialog(`Alunos · ${o.code}`, `<p class="text-muted">${esc(o.subject_name)} · ${students.length} ${students.length === 1 ? 'aluno matriculado' : 'alunos matriculados'}</p>${students.length ? table(['Aluno', 'E-mail', 'Opção'], students.map(s => [esc(s.name), esc(s.email), s.kind === 'obrigatoria' ? 'Obrigatória' : 'Optativa'])) : '<p>Nenhum aluno matriculado nesta turma.</p>'}`);
  }));
}
function renderCurriculum() {
  const offers = state.offerings;
  $('#main').innerHTML = heading('Currículo semestral', 'Organize as ofertas, os professores e o período de matrículas.', '<button class="btn btn-primary" id="new-offering">Nova oferta</button>') + periodBanner() + `<div class="stats-grid">${stat('Disciplinas ofertadas', offers.length, 'No semestre selecionado', 'book')}${stat('Inscrições registradas', offers.reduce((n, o) => n + Number(o.enrolled), 0), 'Obrigatórias e optativas', 'users')}${stat('Turmas abaixo do mínimo', offers.filter(o => o.enrolled < 3 && o.status === 'aberta').length, 'Mínimo de 3 alunos para ativação', 'check')}</div><div class="section-heading"><h2>Ofertas do semestre</h2><div class="admin-actions"><button class="btn btn-sm btn-outline-secondary" id="new-semester">Novo semestre</button>${semester() ? '<button class="btn btn-sm btn-outline-secondary" id="edit-semester">Editar período</button><button class="btn btn-sm btn-outline-secondary" id="close-semester">Encerrar semestre</button>' : ''}</div></div>${offers.length ? table(['Disciplina', 'Professor', 'Alunos', 'Situação', ''], offers.map(o => [`<strong>${esc(o.subject_name)}</strong><span class="secondary">${esc(o.code)} · ${o.credits} créditos</span>`, esc(o.professor_name || 'A definir'), `${o.enrolled} / ${o.capacity}`, tag(o.status, o.status === 'cancelada'), `<button class="btn btn-sm btn-outline-secondary" data-edit-offer="${esc(o.id)}">Editar</button>`])) : empty('Publique o currículo', 'Cadastre um semestre e adicione as disciplinas que serão ofertadas.')}`;
  $('#new-offering').onclick = () => editRecord('offerings');
  $('#new-semester').onclick = () => editRecord('semesters');
  if ($('#edit-semester')) $('#edit-semester').onclick = () => editRecord('semesters', semester());
  if ($('#close-semester')) {
    $('#close-semester').disabled = semester().closed || new Date() < new Date(semester().enrollment_end);
    $('#close-semester').onclick = () => confirmDialog('Encerrar semestre', 'Turmas com pelo menos 3 alunos serão ativadas. As demais serão canceladas e suas matrículas atualizadas, gerando notificações de cobrança. Esta ação não pode ser desfeita.', async () => { const result = await secretary.encerrar(state.semesterId); await refresh(); toast(`Semestre encerrado. ${result.ativas} turma(s) ativa(s), ${result.canceladas} cancelada(s).`); }, 'Encerrar semestre');
  }
  $$('[data-edit-offer]').forEach(el => el.onclick = () => editRecord('offerings', offers.find(o => o.id === el.dataset.editOffer)));
}
function renderRecords() {
  $('#main').innerHTML = heading('Cadastros acadêmicos', 'Mantenha os cursos, seus créditos e as disciplinas do currículo.') + `<div class="section-heading"><h2>Cursos</h2><button class="btn btn-sm btn-primary" id="new-course">Novo curso</button></div>${state.courses.length ? table(['Curso', 'Créditos totais', ''], state.courses.map(c => [esc(c.name), c.credits, `<button class="btn btn-sm btn-outline-secondary" data-edit-course="${esc(c.id)}">Editar</button>`])) : empty('Nenhum curso cadastrado', 'Cadastre o primeiro curso para organizar as disciplinas.')}<div class="section-heading mt-5"><h2>Disciplinas</h2><button class="btn btn-sm btn-primary" id="new-subject">Nova disciplina</button></div>${state.subjects.length ? table(['Código', 'Disciplina', 'Curso', 'Créditos', ''], state.subjects.map(s => [esc(s.code), esc(s.name), esc(state.courses.find(c => c.id === s.course_id)?.name), s.credits, `<button class="btn btn-sm btn-outline-secondary" data-edit-subject="${esc(s.id)}">Editar</button>`])) : empty('Nenhuma disciplina cadastrada', 'Adicione disciplinas ao curso antes de publicar o currículo semestral.')}`;
  $('#new-course').onclick = () => editRecord('courses'); $('#new-subject').onclick = () => editRecord('subjects');
  $$('[data-edit-course]').forEach(el => el.onclick = () => editRecord('courses', state.courses.find(c => c.id === el.dataset.editCourse)));
  $$('[data-edit-subject]').forEach(el => el.onclick = () => editRecord('subjects', state.subjects.find(s => s.id === el.dataset.editSubject)));
}
function renderPeople() {
  $('#main').innerHTML = heading('Alunos e professores', 'Mantenha os dados, os cursos e os perfis dos usuários da universidade.') + '<div class="panel"><h2>Cadastro com autenticação</h2><p class="small text-muted mb-0">Crie usuários com e-mail e senha pelo painel Supabase em <strong>Authentication → Users → Add user → Create new user</strong>. Cada conta recebe um perfil de aluno automaticamente. Depois, ajuste nome, curso ou função aqui. Senhas são administradas pelo Supabase Auth.</p></div>' + (state.profiles.length ? table(['Nome', 'E-mail', 'Perfil', 'Curso', ''], [...state.profiles].sort((a,b) => a.name.localeCompare(b.name)).map(p => [esc(p.name), esc(p.email), roles[p.role], esc(state.courses.find(c => c.id === p.course_id)?.name || 'Não vinculado'), `<button class="btn btn-sm btn-outline-secondary" data-edit-profile="${esc(p.id)}">Editar</button>`])) : empty('Nenhum usuário encontrado', 'Crie as contas no painel de autenticação.'));
  $$('[data-edit-profile]').forEach(el => el.onclick = () => editRecord('profiles', state.profiles.find(p => p.id === el.dataset.editProfile)));
}
function renderBilling() {
  const events = state.billing.filter(e => e.semester_id === state.semesterId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  $('#main').innerHTML = heading('Notificações de cobrança', 'Acompanhe os eventos registrados a cada confirmação ou alteração de matrícula.') + '<div class="panel"><h2>Comunicação com o sistema de cobranças</h2><p class="small text-muted mb-0">Cada alteração grava uma notificação transacional com o conjunto atualizado de disciplinas e créditos. O sistema financeiro externo deve consumir esses eventos pelo identificador único. Marque como enviado somente após confirmar o recebimento no financeiro.</p></div>' + (events.length ? table(['Aluno', 'Registrado em', 'Situação', ''], events.map(e => [esc(state.profiles.find(p => p.id === e.student_id)?.name || e.student_id), fmt(e.created_at), tag(e.status), `<button class="btn btn-sm btn-outline-secondary" data-event="${esc(e.id)}">Ver notificação</button>`])) : empty('Nenhuma notificação neste semestre', 'As notificações aparecerão após a primeira confirmação de matrícula.', 'bill'));
  $$('[data-event]').forEach(el => el.onclick = () => {
    const e = events.find(e => e.id === el.dataset.event);
    dialog('Notificação de cobrança', `<p class="small text-muted">ID de idempotência: ${esc(e.id)}</p><pre class="payload">${esc(JSON.stringify(e.payload, null, 2))}</pre>${e.status === 'pendente' ? '<div class="dialog-actions"><button class="btn btn-primary" id="mark-event">Confirmar recebimento externo</button></div>' : '<p class="small">Recebimento externo confirmado pela secretaria.</p>'}`, () => {
      if ($('#mark-event')) $('#mark-event').onclick = () => confirmDialog('Confirmar envio', 'Você confirma que o sistema de cobranças externo recebeu esta notificação? O portal não realiza uma chamada HTTP para o financeiro.', async () => { await secretary.confirmarCobranca(e.id); await refresh(); toast('Recebimento da notificação confirmado.'); }, 'Confirmar recebimento');
    });
  });
}
function field(name, label, value = '', type = 'text', extra = '') { return `<div class="${type === 'datetime-local' ? 'wide' : ''}"><label class="form-label" for="field-${name}">${label}</label><input class="form-control" id="field-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`; }
function selectField(name, label, options, value = '', required = true) { return `<div><label class="form-label" for="field-${name}">${label}</label><select class="form-select" id="field-${name}" name="${name}" ${required ? 'required' : ''}><option value="">${required ? 'Selecione' : 'Não definido'}</option>${options.map(([v, label]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>`; }
function localDate(d) { if (!d) return ''; const date = new Date(d); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function editRecord(type, record = {}) {
  const titles = { courses: 'curso', subjects: 'disciplina', offerings: 'oferta', semesters: 'semestre', profiles: 'usuário' };
  let fields = '';
  const courses = state.courses.map(c => [c.id, c.name]);
  if (['courses', 'subjects', 'semesters', 'profiles'].includes(type)) fields += field('name', 'Nome', record.name, 'text', `required minlength="2" maxlength="${type === 'semesters' ? '40' : '120'}"`);
  if (['courses', 'subjects'].includes(type)) fields += field('credits', 'Créditos', record.credits || '', 'number', 'required min="1" max="10000" step="1"');
  if (type === 'subjects') fields += field('code', 'Código', record.code, 'text', 'required minlength="2" maxlength="20"') + selectField('course_id', 'Curso', courses, record.course_id);
  if (type === 'semesters') fields += field('enrollment_start', 'Início das matrículas (horário local)', localDate(record.enrollment_start), 'datetime-local', 'required') + field('enrollment_end', 'Fim das matrículas (horário local)', localDate(record.enrollment_end), 'datetime-local', 'required');
  if (type === 'offerings') fields += selectField('subject_id', 'Disciplina', state.subjects.map(s => [s.id, `${s.code} · ${s.name}`]), record.subject_id) + selectField('semester_id', 'Semestre', state.semesters.map(s => [s.id, s.name]), record.semester_id || state.semesterId) + selectField('professor_id', 'Professor', state.profiles.filter(p => p.role === 'professor').map(p => [p.id, p.name]), record.professor_id, false) + field('capacity', 'Capacidade da turma', record.capacity || 60, 'number', 'required min="3" max="60" step="1"');
  if (type === 'profiles') fields += selectField('role', 'Perfil de acesso', Object.entries(roles), record.role) + selectField('course_id', 'Curso do aluno', courses, record.course_id, false);
  dialog(`${record.id ? 'Editar' : 'Novo cadastro de'} ${titles[type]}`, `<form id="record-form"><div class="form-grid">${fields}</div><p class="error-inline" id="record-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn btn-outline-secondary" data-dismiss>Voltar</button><button class="btn btn-primary" type="submit">Salvar cadastro</button></div></form>`, () => {
    $('[data-dismiss]', modal).onclick = () => modal.close();
    $('#record-form').onsubmit = e => { e.preventDefault(); const form = Object.fromEntries(new FormData(e.currentTarget)); action(async () => {
      try {
        const payload = { ...form };
        if (record.id) payload.id = record.id;
        if ('credits' in payload) payload.credits = Number(payload.credits);
        if ('capacity' in payload) payload.capacity = Number(payload.capacity);
        for (const key of ['course_id', 'professor_id']) if (key in payload && !payload[key]) payload[key] = null;
        for (const key of ['enrollment_start', 'enrollment_end']) if (key in payload) payload[key] = new Date(payload[key]).toISOString();
        if (type === 'semesters' && new Date(payload.enrollment_end) <= new Date(payload.enrollment_start)) throw new Error('O fim do período deve ser posterior ao início.');
        if (type === 'profiles') {
          delete payload.id;
          if (record.id === state.user.id && payload.role !== 'secretaria') throw new Error('Mantenha seu próprio acesso de secretaria. Outra secretaria pode alterar seu perfil.');
          if (payload.role === 'aluno' && !payload.course_id) throw new Error('Vincule o aluno a um curso.');
          await secretary.atualizarPerfil(record.id, payload);
        } else await secretary.salvar(type, payload);
        await refresh(); modal.close(); toast('Cadastro salvo.');
      } catch (err) { $('#record-error').textContent = errorMessage(err); }
    }); };
  });
}
function renderHelp() {
  $('#main').innerHTML = heading('Orientações acadêmicas', 'Tudo o que você precisa saber para organizar as matrículas.') + `<div class="help-grid"><section class="help-step"><h3>Escolha as disciplinas</h3><p>O aluno confirma exatamente 4 primeiras opções obrigatórias e pode adicionar até 2 alternativas optativas. Ambas contam como inscrições e ocupam vagas; não há promoção automática de alternativas.</p></section><section class="help-step"><h3>Respeite o período</h3><p>Matrículas e cancelamentos são permitidos somente entre as datas publicadas. A inscrição na 60ª vaga encerra as vagas da disciplina. Um cancelamento libera a vaga durante o período.</p></section><section class="help-step"><h3>Acompanhe a confirmação</h3><p>Depois do prazo, a secretaria encerra o semestre. Turmas com 3 ou mais alunos ficam ativas. Turmas com menos de 3 são canceladas, assim como suas matrículas.</p></section></div><div class="panel mt-4"><h2>Informações e acesso</h2><p class="text-muted small">Professores consultam somente os alunos de suas turmas. A secretaria mantém cursos, disciplinas, usuários e currículo semestral. Cada alteração de matrícula gera uma notificação para cobrança.</p><p class="text-muted small mb-0">Para cadastro de conta, recuperação de senha ou correção do curso, procure a secretaria. Suas credenciais são validadas pelo Supabase Auth.</p></div>`;
}
async function init() {
  renderLogin();
  try {
    try { connection = JSON.parse(localStorage.getItem('campus.connection') || 'null'); } catch { localStorage.removeItem('campus.connection'); }
    if (!connection) {
      // O arquivo local é opcional e nunca deve conter credenciais administrativas.
      try {
        const url = new URL('./config.local.js', import.meta.url);
        const response = await fetch(url, { method: 'HEAD' });
        if (response.ok) connection = (await import(url.href)).config;
      } catch { /* A configuração pode ser informada pela interface. */ }
    }
    if (!connection) connection = defaultConfig;
    validateConfig(connection); bindClient(await makeClient(connection));
    state.user = await auth.usuario();
    if (state.user) { state.page = state.user.role === 'aluno' ? 'catalogo' : state.user.role === 'professor' ? 'turmas' : 'curriculo'; await refresh(); }
    else renderLogin();
  } catch (e) { renderLogin(); toast(errorMessage(e), true); }
}
init();
