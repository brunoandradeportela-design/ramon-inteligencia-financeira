# Domínio aurionfinance.com.br → site no GitHub Pages

Situação em 27/09/2026: `aurionfinance.com.br` consta **registrado** no Registro.br (expira 28/09/2027), usando o DNS padrão do Registro.br (`a.auto.dns.br` / `b.auto.dns.br`). Falta apenas apontar o DNS e ligar o domínio no GitHub.

> Registro, titularidade (CPF/CNPJ), pagamento e login no Registro.br são feitos **pelo titular**. Nenhum desses dados fica neste repositório.

## 1. Registro.br — editar a zona DNS

`registro.br` → entrar → **Domínios** → `aurionfinance.com.br` → **DNS** → *Editar zona* (modo "DNS do Registro.br") → **Nova entrada** para cada linha:

| Tipo | Nome | Dados |
|---|---|---|
| A | *(vazio / @)* | 185.199.108.153 |
| A | *(vazio / @)* | 185.199.109.153 |
| A | *(vazio / @)* | 185.199.110.153 |
| A | *(vazio / @)* | 185.199.111.153 |
| AAAA | *(vazio / @)* | 2606:50c0:8000::153 |
| AAAA | *(vazio / @)* | 2606:50c0:8001::153 |
| AAAA | *(vazio / @)* | 2606:50c0:8002::153 |
| AAAA | *(vazio / @)* | 2606:50c0:8003::153 |
| CNAME | www | brunoandradeportela-design.github.io. |
| TXT | _github-pages-challenge-brunoandradeportela-design | *(código que o GitHub mostrar no passo 3)* |

Depois: **Salvar alterações**. A propagação costuma levar de minutos a algumas horas.

Quando a API for hospedada (Render, Railway…), acrescentar: `CNAME api → <endereço fornecido pelo provedor>` e configurar `RAMON_CORS=https://aurionfinance.com.br,https://www.aurionfinance.com.br` na API e `window.RAMON_API_BASE="https://api.aurionfinance.com.br"` em `apps/web/app/js/config.js`.

## 2. GitHub — publicar o site com o domínio

1. Repositório → **Settings → Pages** → *Source*: **GitHub Actions** (o workflow `.github/workflows/pages.yml` publica a pasta `apps/web`).
2. *Custom domain*: `aurionfinance.com.br` → **Save** → aguardar o "DNS check successful".
3. Marcar **Enforce HTTPS** (o certificado é emitido automaticamente após o DNS propagar).

## 3. Proteção contra sequestro de domínio (recomendado)

GitHub → foto do perfil → **Settings → Pages → Add a domain** → `aurionfinance.com.br` → copiar o registro TXT exibido → criar no Registro.br (última linha da tabela) → **Verify**.

## 4. Conferência

```bash
dig +short aurionfinance.com.br A        # 4 IPs 185.199.10x.153
dig +short www.aurionfinance.com.br      # brunoandradeportela-design.github.io
curl -I https://aurionfinance.com.br     # HTTP/2 200 servido por GitHub
```

Arquivos já preparados no site: `CNAME`, `robots.txt` (a área `/app/` não é indexada), `sitemap.xml`, `canonical` e Open Graph apontando para `https://aurionfinance.com.br/`.

## Observação de marca

O domínio usa o nome **Aurion Finance**, enquanto o site exibe a marca **Fintechs** (conforme a arte aprovada). Se a marca oficial passar a ser Aurion Finance, é preciso trocar logotipo, títulos e textos — e verificar a disponibilidade da marca no INPI.

---

## 5. Migração para a HostGator (16/10/2026)

O site passou a ser servido pela hospedagem compartilhada da HostGator. A API continua no Cloudflare Workers (`config.js` não mudou).

- **Registro.br:** o domínio continua registrado lá; os servidores DNS foram trocados para `ns40.hostgator.com.br` e `ns41.hostgator.com.br`. A zona antiga do Registro.br (A/AAAA do GitHub Pages) deixou de valer.
- **HostGator (cPanel br40, usuário ramonj52, IP 192.185.212.200):** domínio adicional `aurionfinance.com.br` com pasta `/home1/ramonj52/aurionfinance.com.br`. A zona DNS (A, www, mail, SPF, DKIM) é gerenciada no Editor de Zona DNS do cPanel.
- **Publicação:** cPanel → Git Version Control clona este repositório em `/home1/ramonj52/repositories/aurion`; o `.cpanel.yml` copia `apps/web/` para a pasta do domínio (mantém `.well-known`, `cgi-bin` e ignora `CNAME`).
- **Atualização automática:** tarefa cron no cPanel, minuto 17 a cada 3 horas: `git pull --ff-only` + `rsync` de `apps/web/`. Para publicar na hora: Git Version Control → aurion → Pull or Deploy → Update from Remote e Deploy HEAD Commit.
- **HTTPS:** `apps/web/.htaccess` força HTTPS e redireciona `www` para o domínio sem www. O certificado vem do AutoSSL do cPanel depois que o DNS propagar (cPanel → SSL/TLS Status → Run AutoSSL, se não emitir sozinho).
- **Voltar ao GitHub Pages:** no Registro.br, voltar a usar o DNS do Registro.br e recriar os registros da seção 1. O GitHub Pages segue publicado como reserva.
