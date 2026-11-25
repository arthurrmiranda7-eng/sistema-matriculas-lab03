import { Usuario, Curso, Disciplina, Semestre, Oferta, Matricula, EventoCobranca, validarSelecao } from './models.js';
export async function resultado(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}
export class AuthService {
  constructor(client) { this.client = client; }
  async entrar(email, password) { return resultado(this.client.auth.signInWithPassword({ email, password })); }
  async sair() { return resultado(this.client.auth.signOut()); }
  async alterarSenha(password) { return resultado(this.client.auth.updateUser({ password })); }
  async usuario() {
    const { session } = await resultado(this.client.auth.getSession());
    if (!session) return null;
    return new Usuario(await resultado(this.client.from('profiles').select('*').eq('id', session.user.id).single()));
  }
}
export class CatalogoService {
  constructor(client) { this.client = client; }
  async semestres() { return (await resultado(this.client.from('semesters').select('*').order('enrollment_start', { ascending: false }))).map(d => new Semestre(d)); }
  async ofertas(id) { return (await resultado(this.client.rpc('offering_catalog', { p_semester_id: id }))).map(d => new Oferta(d)); }
  async cursos() { return (await resultado(this.client.from('courses').select('*').order('name'))).map(d => new Curso(d)); }
}
export class MatriculaService {
  constructor(client) { this.client = client; }
  async listar(studentId) { return (await resultado(this.client.from('enrollments').select('*').eq('student_id', studentId))).map(d => new Matricula(d)); }
  async salvar(id, required, optional) {
    validarSelecao(required, optional);
    return resultado(this.client.rpc('save_enrollment', { p_semester_id: id, p_required: required, p_optional: optional }));
  }
  async cancelar(id) { return resultado(this.client.rpc('cancel_enrollment', { p_enrollment_id: id })); }
}
export class ProfessorService {
  constructor(client) { this.client = client; }
  async listarAlunos(id) { return resultado(this.client.rpc('get_roster', { p_offering_id: id })); }
}
export class SecretariaService {
  constructor(client) { this.client = client; }
  async listar(table) {
    const data = await resultado(this.client.from(table).select('*'));
    const model = { subjects: Disciplina, profiles: Usuario, billing_events: EventoCobranca }[table];
    return model ? data.map(d => new model(d)) : data;
  }
  async salvar(table, data) {
    const { id, ...values } = data;
    return resultado(id
      ? this.client.from(table).update(values).eq('id', id).select()
      : this.client.from(table).insert(values).select());
  }
  async atualizarPerfil(id, data) { return resultado(this.client.from('profiles').update(data).eq('id', id).select()); }
  async encerrar(id) { return resultado(this.client.rpc('close_semester', { p_semester_id: id })); }
  async confirmarCobranca(id) { return resultado(this.client.rpc('mark_billing_sent', { p_event_id: id })); }
}
