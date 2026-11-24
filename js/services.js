export class AuthService {
  constructor(client) { this.client = client; }
  async entrar(email, password) { throw new Error('A implementar'); }
  async sair() { throw new Error('A implementar'); }
}
export class MatriculaService {
  constructor(client) { this.client = client; }
  async salvar(semesterId, required, optional) { throw new Error('A implementar'); }
  async cancelar(id) { throw new Error('A implementar'); }
}
export class ProfessorService {
  constructor(client) { this.client = client; }
  async listarAlunos(offeringId) { throw new Error('A implementar'); }
}
export class SecretariaService {
  constructor(client) { this.client = client; }
  async salvar(table, data) { throw new Error('A implementar'); }
  async encerrar(semesterId) { throw new Error('A implementar'); }
}
