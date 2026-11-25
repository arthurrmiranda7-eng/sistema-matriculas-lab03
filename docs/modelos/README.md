# Modelos UML: evolução e rastreabilidade

As fontes PlantUML e as imagens SVG estão juntas para permitir revisão e edição sem depender de uma ferramenta proprietária. O README principal incorpora a versão final; a versão inicial permanece preservada.

| Modelo | Análise/projeto inicial | Implementação refinada |
| --- | --- | --- |
| Casos de uso | [SVG v1](v1/casos-de-uso.svg) · [fonte](v1/casos-de-uso.puml) | [SVG v2](v2/casos-de-uso.svg) · [fonte](v2/casos-de-uso.puml) |
| Classes | [SVG v1](v1/classes.svg) · [fonte](v1/classes.puml) | [SVG v2](v2/classes.svg) · [fonte](v2/classes.puml) |
| Arquitetura | [SVG v1](v1/arquitetura.svg) · [fonte](v1/arquitetura.puml) | [SVG v2](v2/arquitetura.svg) · [fonte](v2/arquitetura.puml) |

## O que mudou e por quê

| Aspecto | v1 | v2 e motivo |
| --- | --- | --- |
| Nomenclatura | Atributos conceituais em português. | Atributos em inglês correspondem aos objetos retornados pelo Supabase e aos construtores JavaScript. Os nomes das classes continuam em português. |
| Curso e oferta | Curso agrega disciplinas; semestre reúne ofertas. | Mantida a separação para a mesma disciplina existir em semestres diferentes, cada oferta com professor, situação e ocupação próprios. |
| Situações | Estados descritos genericamente. | Estados explícitos de oferta, matrícula e evento; histórico cancelado permanece armazenado sem ocupar vaga. |
| Autenticação | Serviço de login e usuário. | Supabase Auth cuida da senha; `profiles` guarda nome, papel e curso. Papéis vêm do banco, sem confiar em metadados enviados pelo usuário. |
| Seleção do aluno | Matricular e cancelar. | Envio completo de quatro obrigatórias e até duas alternativas; cancelamento individual pode deixar seleção incompleta. Cada comando valida o prazo no servidor. |
| Concorrência | Limite de 60 declarado como regra. | Comandos SQL transacionais bloqueiam registros e validam a ocupação antes de gravar, impedindo ultrapassar o limite por requisições simultâneas. |
| Encerramento | Ativar ou cancelar disciplinas no final. | Operação explícita da secretaria, após a data final, classifica ofertas pelo mínimo de três e cancela inscrições afetadas. O semestre fica fechado. |
| Cobrança | Notificação representada como integração abstrata. | `EventoCobranca` / `billing_events` concretiza uma caixa de saída transacional com snapshot de disciplinas e créditos. Não há endpoint de cobrança especificado; o consumidor externo é uma extensão identificada, sem simular um envio. |
| Manutenção de cadastros | Vínculos acadêmicos tratados como associações do modelo. | Gatilhos preservam o curso de disciplina com histórico, o papel de professor ainda atribuído e o curso de aluno com matrícula vigente em semestre não encerrado. |
| Acesso aos dados | Cliente consulta persistência no Supabase. | Diagrama final explicita JWT, RLS, permissões, funções SQL e separação entre interface e validações críticas. |

As revisões acompanham a implementação e as regras definidas para o projeto.

## Alinhamento entre classes e persistência

| Classe em `js/models.js` | Tabela ou origem no Supabase | Observação |
| --- | --- | --- |
| `Usuario` | `profiles` e identidade em `auth.users` | Nome, e-mail, papel e curso; senha somente no Auth. |
| `Curso` | `courses` | Nome e créditos totais. |
| `Disciplina` | `subjects` | Código, nome, créditos e curso. |
| `Semestre` | `semesters` | Período e estado de encerramento; `estaAberto()` auxilia a interface. |
| `Oferta` | `offerings` / `offering_catalog` | Turma do semestre; o catálogo agrega nome da disciplina/professor e calcula `enrolled`; `vagas()` é derivado. |
| `Matricula` | `enrollments` | Vínculo do aluno à oferta, tipo e situação. |
| `EventoCobranca` | `billing_events` | Snapshot de notificação, situação e data. |

Os modelos JavaScript são representações dos dados; não são uma segunda camada de persistência. A palavra `Disciplina` no enunciado corresponde à disciplina do catálogo (`subjects`) e à sua ocorrência semestral (`offerings`) quando se fala em vagas e ativação.

## Rastreabilidade dos requisitos

| Requisito / história | Caso de uso | Código principal | Regra persistente |
| --- | --- | --- | --- |
| Login com senha — HU01 | Entrar / sair | `AuthService`, tela de acesso em `app.js` | Supabase Auth, `profiles`, `app_role()` |
| Cursos e disciplinas — HU02 | Manter cursos e disciplinas | `SecretariaService`, formulários administrativos | `courses`, `subjects`, `guard_subject`, RLS e chaves estrangeiras |
| Alunos e professores — HU03 | Manter perfis acadêmicos | Administração de perfis | Trigger de Auth, `profiles`, `guard_profile`, políticas da secretaria |
| Currículo e período — HU04 | Configurar período e currículo | Administração de semestres e ofertas | `semesters`, `offerings`, `guard_semester`, `guard_offering` |
| Catálogo e vagas — HU05 | Consultar currículo e vagas | Área do aluno, `Oferta` | `offering_catalog` |
| 4 + até 2, capacidade — HU06 | Enviar matrícula / validar | `MatriculaService.salvar()` | `save_enrollment` |
| Cancelamento no período — HU07 | Cancelar própria inscrição | `MatriculaService.cancelar()` | `cancel_enrollment` |
| Mínimo 3 e fechamento — HU08 | Encerrar / ativar ou cancelar | `SecretariaService.encerrar()` | `close_semester` |
| Lista do professor — HU09 | Consultar alunos das ofertas | `ProfessorService.listarAlunos()` | `get_roster`, validação do professor |
| Notificação de cobrança — HU10 | Registrar / consultar eventos | Área de cobranças da secretaria | `enqueue_billing`, `billing_events`, `mark_billing_sent` |

## Regenerar as imagens

Com Java e PlantUML instalados, na raiz do projeto:

```bash
java -jar /caminho/plantuml.jar -charset UTF-8 -tsvg docs/modelos/v1/*.puml docs/modelos/v2/*.puml
```

O PlantUML e seu JAR são ferramentas de edição e não fazem parte dos arquivos necessários para executar a aplicação. Os SVG já estão incluídos para visualização no GitHub.
