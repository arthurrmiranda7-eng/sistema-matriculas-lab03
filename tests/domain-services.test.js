import test from 'node:test';
import assert from 'node:assert/strict';
import { Semestre, Oferta, validarSelecao } from '../js/models.js';
import { AuthService, CatalogoService, MatriculaService, ProfessorService, SecretariaService } from '../js/services.js';

const required = ['oferta-1', 'oferta-2', 'oferta-3', 'oferta-4'];
const semester = closed => new Semestre({
  enrollment_start: '2027-01-10T09:00:00-03:00',
  enrollment_end: '2027-01-15T18:00:00-03:00', closed,
});

test('janela aceita o início e recusa o instante final, respeitando o fuso', () => {
  const s = semester(false);
  assert.equal(s.estaAberto(new Date('2027-01-10T11:59:59.999Z')), false);
  assert.equal(s.estaAberto(new Date('2027-01-10T12:00:00.000Z')), true);
  assert.equal(s.estaAberto(new Date('2027-01-15T20:59:59.999Z')), true);
  assert.equal(s.estaAberto(new Date('2027-01-15T21:00:00.000Z')), false);
});

test('semestre encerrado impede matrícula mesmo dentro da janela', () => {
  assert.equal(semester(true).estaAberto(new Date('2027-01-12T15:00:00Z')), false);
});

test('primeiras opções exigem quatro escolhas e alternativas aceitam zero até duas', () => {
  assert.equal(validarSelecao(required, []), true);
  assert.equal(validarSelecao(required, ['oferta-5', 'oferta-6']), true);
  assert.throws(() => validarSelecao(required.slice(0, 3), []), /exatamente 4/);
  assert.throws(() => validarSelecao([...required, 'oferta-5'], []), /exatamente 4/);
  assert.throws(() => validarSelecao(required, ['oferta-5', 'oferta-6', 'oferta-7']), /no máximo 2/);
});

test('mesma disciplina não pode ocupar duas opções, inclusive no mesmo grupo', () => {
  assert.throws(() => validarSelecao(required, ['oferta-1']), /duas opções/);
  assert.throws(() => validarSelecao(['oferta-1', 'oferta-1', 'oferta-3', 'oferta-4'], []), /duas opções/);
  assert.throws(() => validarSelecao(required, ['oferta-5', 'oferta-5']), /duas opções/);
});

test('lotação usa contagem numérica do PostgreSQL e nunca exibe vagas negativas', () => {
  assert.equal(new Oferta({ capacity: 60, enrolled: '59' }).vagas(), 1);
  assert.equal(new Oferta({ capacity: 60, enrolled: '60' }).vagas(), 0);
  assert.equal(new Oferta({ capacity: 60, enrolled: '61' }).vagas(), 0);
});

test('entrada inválida é recusada antes de qualquer alteração remota', async () => {
  let requests = 0;
  const service = new MatriculaService({ rpc() { requests++; throw new Error('Não deve chamar o banco'); } });
  await assert.rejects(service.salvar('semestre', required.slice(1), []), /exatamente 4/);
  await assert.rejects(service.salvar('semestre', required, ['oferta-1']), /duas opções/);
  assert.equal(requests, 0);
});

test('confirmação transmite um único conjunto completo ao procedimento atômico', async () => {
  const requests = [];
  const service = new MatriculaService({ async rpc(name, args) {
    requests.push({ name, args });
    return { data: { changed: true }, error: null };
  } });
  assert.deepEqual(await service.salvar('semestre', required, ['oferta-5']), { changed: true });
  assert.deepEqual(requests, [{ name: 'save_enrollment', args: {
    p_semester_id: 'semestre', p_required: required, p_optional: ['oferta-5'],
  } }]);
});

test('vagas alteradas no servidor são reportadas como erro, sem falso sucesso', async () => {
  const error = { message: 'Uma das disciplinas ficou sem vagas.', code: 'P0001' };
  const service = new MatriculaService({ async rpc() { return { data: null, error }; } });
  await assert.rejects(service.salvar('semestre', required, []), e => e === error);
});

test('repetição sem alterações preserva a resposta idempotente do banco', async () => {
  const service = new MatriculaService({ async rpc() { return { data: { changed: false }, error: null }; } });
  assert.deepEqual(await service.salvar('semestre', required, []), { changed: false });
});

test('catálogo preserva o objeto de oferta e sua contagem de vagas', async () => {
  const catalog = new CatalogoService({ async rpc(name, args) {
    assert.equal(name, 'offering_catalog');
    assert.deepEqual(args, { p_semester_id: 'semestre' });
    return { data: [{ id: 'oferta', capacity: 60, enrolled: '58', status: 'aberta' }], error: null };
  } });
  const [offering] = await catalog.ofertas('semestre');
  assert.ok(offering instanceof Oferta);
  assert.equal(offering.vagas(), 2);
});

test('sessão ausente não consulta dados de perfil', async () => {
  const auth = new AuthService({
    auth: { async getSession() { return { data: { session: null }, error: null }; } },
    from() { throw new Error('Perfil não deve ser consultado sem sessão'); },
  });
  assert.equal(await auth.usuario(), null);
});

test('alteração de senha usa a sessão atual do Auth sem escrever no perfil', async () => {
  const password = 'senha-ficticia-apenas-teste';
  const updated = { user: { id: 'usuario-autenticado' } };
  let calls = 0;
  const auth = new AuthService({
    auth: { async updateUser(attributes) {
      calls++;
      assert.deepEqual(attributes, { password });
      return { data: updated, error: null };
    } },
    from() { throw new Error('Senhas devem ser alteradas exclusivamente pelo Supabase Auth'); },
  });
  assert.equal(await auth.alterarSenha(password), updated);
  assert.equal(calls, 1);
});

test('recusa do Auth ao alterar senha é preservada para impedir falso sucesso', async () => {
  const error = { message: 'Reauthentication required', code: 'reauthentication_needed' };
  const auth = new AuthService({
    auth: { async updateUser() { return { data: null, error }; } },
    from() { throw new Error('Uma falha no Auth não deve tentar alterar tabelas'); },
  });
  await assert.rejects(auth.alterarSenha('senha-ficticia-apenas-teste'), e => e === error);
});

test('falha de autenticação e perfil indisponível chegam à interface', async () => {
  const error = { message: 'Invalid login credentials' };
  const auth = new AuthService({ auth: { async signInWithPassword() { return { data: null, error }; } } });
  await assert.rejects(auth.entrar('aluno@teste.invalid', 'incorreta'), e => e === error);
  const missingProfile = { message: 'Perfil não encontrado', code: 'PGRST116' };
  const authenticated = new AuthService({
    auth: { async getSession() { return { data: { session: { user: { id: 'aluno' } } }, error: null }; } },
    from() { return { select() { return { eq() { return { async single() { return { data: null, error: missingProfile }; } }; } }; } }; },
  });
  await assert.rejects(authenticated.usuario(), e => e === missingProfile);
});

test('negativa de acesso à lista de alunos nunca vira lista vazia ou sucesso', async () => {
  const error = { message: 'Você não tem acesso à lista desta disciplina.' };
  const teacher = new ProfessorService({ async rpc() { return { data: null, error }; } });
  await assert.rejects(teacher.listarAlunos('oferta-alheia'), e => e === error);
});

test('encerramento antes do prazo propaga a recusa do banco', async () => {
  const error = { message: 'Aguarde o término do período de matrículas.' };
  const secretary = new SecretariaService({ async rpc() { return { data: null, error }; } });
  await assert.rejects(secretary.encerrar('semestre'), e => e === error);
});

test('edição administrativa atualiza registro existente sem passar pelo fluxo de criação', async () => {
  const secretary = new SecretariaService({ from(table) {
    assert.equal(table, 'offerings');
    return {
      insert() { throw new Error('Oferta existente não deve passar pelo trigger de nova oferta'); },
      update(values) {
        assert.deepEqual(values, { professor_id: 'professor' });
        return { eq(key, value) {
          assert.equal(key, 'id'); assert.equal(value, 'oferta-encerrada');
          return { async select() { return { data: [{ id: value, ...values }], error: null }; } };
        } };
      },
    };
  } });
  assert.deepEqual(await secretary.salvar('offerings', { id: 'oferta-encerrada', professor_id: 'professor' }),
    [{ id: 'oferta-encerrada', professor_id: 'professor' }]);
});
