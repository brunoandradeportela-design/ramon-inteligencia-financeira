# Backup e restauração — AURION

Há duas camadas de proteção, que se complementam.

## 1. D1 Time Travel, na Cloudflare
O D1 guarda o histórico do banco e permite voltar a um ponto no tempo: até 7 dias no plano gratuito e 30 dias no pago.

Para restaurar, no terminal de quem administra a conta Cloudflare:
```
npx wrangler d1 time-travel info aurion-db
npx wrangler d1 time-travel restore aurion-db --timestamp=2026-10-06T12:00:00Z
```
Use isso para desfazer um erro recente. O comando sobrescreve o banco de produção, por isso confirme o horário antes.

## 2. Backup lógico criptografado, fora da Cloudflare
É um arquivo independente da Cloudflare, para desastre, migração ou retenção maior que a do Time Travel.

- **Exportação:** o Worker exporta tabela a tabela por `/v1/admin/backup/*`. O acesso exige o token `BACKUP_TOKEN` (32 caracteres ou mais) ou a sessão do administrador.
- **Rotina semanal:** a rotina `.github/workflows/backup.yml` roda todo domingo, gera o arquivo, criptografa com AES-256 e guarda como artefato por 14 dias.
- **Restauração:** só funciona num ambiente com `RESTORE_ENABLED=1`. Em produção isso fica desligado, para nunca sobrescrever por engano.
- **Ensaio automático:** a suíte `worker/test/backup_e2e.mjs` roda a cada envio de código no CI. Ela faz backup criptografado, sobe um ambiente vazio e restaura. Depois confere que o login funciona com a mesma senha, que o cálculo tributário dá o mesmo valor e o mesmo hash, que o documento binário volta idêntico e que a trilha de auditoria continua íntegra.

### Para ligar (uma vez)
1. Gere dois valores longos e aleatórios: um token e uma frase-senha.
2. No Cloudflare, abra **Workers → aurion-api → Settings → Variables and Secrets** e crie o segredo `BACKUP_TOKEN` com o token.
3. No GitHub, abra **Settings → Secrets and variables → Actions** e crie `AURION_BACKUP_TOKEN` (o mesmo token) e `AURION_BACKUP_PASSPHRASE` (a frase-senha).
4. Guarde a frase-senha fora do GitHub, num cofre de senhas. Sem ela, o backup não abre.

### Para restaurar um arquivo
1. Crie um banco D1 novo, publique o Worker apontando para ele com `RESTORE_ENABLED=1` e o mesmo `BACKUP_TOKEN`.
2. Baixe o artefato e rode:
   `BACKUP_TOKEN=… BACKUP_PASSPHRASE=… python3 scripts/backup/aurion_backup.py restore --api https://<worker-de-destino> --in arquivo.enc`
3. Confira o resultado, desligue `RESTORE_ENABLED` e só então aponte o domínio para o novo ambiente.
