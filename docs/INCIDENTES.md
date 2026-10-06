# Plano de resposta a incidentes — AURION

Referência: Engenharia v6.0 §24. O fluxo é detectar → classificar → conter → preservar evidências → investigar → corrigir → comunicar.

## 1. Detectar
- **Painel Operações** (administrador): disponibilidade e p95 fora da meta, picos de 5xx, falhas de login, limites de requisição atingidos (`seguranca.limite_*`), jobs parados (cotações, índices, e-mails).
- **Logs do Worker:** Cloudflare → Workers → aurion-api → Logs (observabilidade ligada). Toda resposta tem `X-Correlation-ID`, que liga o relato do cliente ao log.
- **Trilha de auditoria encadeada:** `/v1/admin/audit` e `/v1/audit`, com `chain_valid`. Uma quebra na cadeia indica alteração indevida.
- **Avisos ao cliente:** acesso de aparelho novo gera aviso no sino e por e-mail (`login.novo_dispositivo`).

## 2. Classificar
| Nível | Exemplos | Resposta |
|---|---|---|
| Crítico | Vazamento ou acesso indevido a dados pessoais; chave de pagamento ou Open Finance exposta; cálculo tributário errado publicado | Imediata, com comunicação obrigatória avaliada |
| Alto | API fora do ar; webhook de pagamento parado; regressão na apuração | Mesmo dia |
| Médio | Fonte pública desatualizada; job de e-mail falhando | Próximo dia útil |

## 3. Conter
- **Segredo exposto:** gere um novo no provedor (Asaas, Pluggy, Resend, TTS, Power BI) e troque o segredo no Cloudflare (Workers → aurion-api → Settings → Variables and Secrets). Depois revogue o antigo no provedor.
- **Conta comprometida:** o titular encerra as sessões em Configurações → Segurança. O administrador gera um link de redefinição no CRM (`/v1/admin/users/:id/reset-link`, válido por 24 h).
- **Código com defeito:** reverta o commit no `main`. O Workers Builds publica a versão anterior. O Cloudflare também permite voltar a uma implantação anterior em Deployments.
- **Dados corrompidos:** use o D1 Time Travel para voltar a um ponto no tempo (ver `docs/BACKUP-RESTAURACAO.md`).

## 4. Preservar evidências
Antes de corrigir, guarde:
- os logs do período;
- a exportação da auditoria;
- um backup lógico criptografado (`scripts/backup/aurion_backup.py backup`).

Registre o horário de detecção e cada ação tomada.

## 5. Investigar e corrigir
- Use o `X-Correlation-ID` e a auditoria para reconstruir a linha do tempo.
- Corrija com um teste que reproduz o problema. O CI precisa passar, incluindo a regressão tributária.
- Se o incidente afetou cálculos, reprocesse com `/v1/tax/calculations/:id/verify` e avise os titulares afetados.

## 6. Comunicar
- **Incidente com dados pessoais e risco ou dano relevante (LGPD art. 48):** comunicar a ANPD e os titulares afetados. A norma de comunicação da ANPD (Resolução CD/ANPD nº 15/2024) fixa prazo em dias úteis; confira a versão vigente no momento do incidente.
- **Conteúdo da comunicação:** o que ocorreu, dados afetados, riscos, medidas tomadas e o que o titular deve fazer.
- **Registro:** guarde o relatório do incidente, mesmo quando a comunicação não for obrigatória.

## 7. Depois
- Escreva um pós-incidente sem culpados: causa, impacto, linha do tempo e ações.
- Se a decisão mudar a arquitetura, atualize o ADR correspondente e este documento.
