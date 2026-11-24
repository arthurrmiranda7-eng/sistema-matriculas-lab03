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
  estaAberto() { throw new Error('A implementar'); }
}
export class Oferta {
  constructor(data) { Object.assign(this, data); }
  vagas() { throw new Error('A implementar'); }
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
