# ADR-0001 — Modular monolith com fronteiras rígidas

**Status:** aceito · **Data:** 2026-09-27

Contexto: o Plano Técnico (§3) recomenda começar como modular monolith e extrair microsserviços apenas quando escala, segurança ou deploy independente justificarem.

Decisão: um processo FastAPI (`apps/api`) compõe serviços em `services/*`, cada um com sua responsabilidade e sem acesso ao armazenamento de outro domínio, exceto via `Store` com `owner_id` obrigatório. A IA (`ai_orchestrator`) só acessa dados por *tools* injetadas pela camada de aplicação.

Consequências: deploy único e simples no MVP; extração futura do Tax Engine ou do Connector Gateway exige apenas trocar a injeção de dependência.

# ADR-0002 — Persistência em memória no MVP, PostgreSQL como alvo

**Status:** aceito · **Data:** 2026-09-27

Decisão: o `Store` em memória implementa o mesmo contrato do schema PostgreSQL (`database/migrations/0001_init.sql`, com RLS por titular). Permite demonstração e testes sem infraestrutura. Para produção, implementar `PostgresStore` com o mesmo contrato antes do piloto (Sprint 1 do roadmap).

# ADR-0003 — Front-end estático com modo demonstração

**Status:** aceito · **Data:** 2026-09-27

Decisão: HTML/CSS/JS sem etapa de build (ES modules), publicado via GitHub Pages. Sem `RAMON_API_BASE`, o app usa `data/demo.json`, gerado por `tools/export_demo.py` **a partir dos motores Python** — o JavaScript não recalcula impostos. Simulações de venda no modo demo usam uma grade pré-calculada pelo Simulation Engine; o cálculo de PGBL (aritmética simples com parâmetros exportados da regra) é o único cálculo local.

# ADR-0004 — IA sem autoridade de cálculo

**Status:** aceito · **Data:** 2026-09-27

Decisão: o compositor padrão é determinístico (templates). Um LLM opcional só reescreve texto; qualquer número que não esteja nas evidências das tools derruba a resposta para o template (checagem de consistência). Pedidos de recomendação individual, prompt injection e pedidos de credencial são bloqueados antes de qualquer tool.
