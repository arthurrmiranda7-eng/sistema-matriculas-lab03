export class Usuario {
  constructor({ id, name, email, role, course_id }) {
    Object.assign(this, { id, name, email, role, course_id });
  }
}
export class Curso {
  constructor({ id, name, credits }) { Object.assign(this, { id, name, credits }); }
}
export class Disciplina {
  constructor({ id, course_id, code, name, credits }) {
    Object.assign(this, { id, course_id, code, name, credits });
  }
}
export class Semestre {
  constructor({ id, name, enrollment_start, enrollment_end, closed }) {
    Object.assign(this, { id, name, enrollment_start, enrollment_end, closed });
  }
  estaAberto(now = new Date()) {
    return !this.closed && now >= new Date(this.enrollment_start) && now < new Date(this.enrollment_end);
  }
}
export class Oferta {
  constructor(data) { Object.assign(this, data); }
  vagas() { return Math.max(0, Number(this.capacity) - Number(this.enrolled)); }
}
export class Matricula {
  constructor({ id, student_id, offering_id, kind, status }) {
    Object.assign(this, { id, student_id, offering_id, kind, status });
  }
}
export class EventoCobranca {
  constructor({ id, student_id, semester_id, payload, status, created_at }) {
    Object.assign(this, { id, student_id, semester_id, payload, status, created_at });
  }
}

export function validarSelecao(required, optional) {
  if (required.length !== 4) throw new Error('Selecione exatamente 4 disciplinas obrigatórias.');
  if (optional.length > 2) throw new Error('Selecione no máximo 2 disciplinas optativas.');
  if (new Set([...required, ...optional]).size !== required.length + optional.length)
    throw new Error('Uma disciplina não pode ocupar duas opções.');
  return true;
}
