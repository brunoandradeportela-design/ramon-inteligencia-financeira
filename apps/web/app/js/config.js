/* Endereço da API (Cloudflare Worker "aurion-api": contas, CRM e pagamentos Asaas em tempo real).
   No domínio de produção o app usa a API; em qualquer outro endereço (links de demonstração,
   testes locais) roda no modo demonstração estático, com o snapshot data/demo.json. */
(function () {
  const PROD = ["aurionfinance.com.br", "www.aurionfinance.com.br"];
  if (!window.RAMON_API_BASE && PROD.includes(location.hostname))
    window.RAMON_API_BASE = "https://aurion-api.bruno-andradeportela.workers.dev";
  window.RAMON_API_BASE = window.RAMON_API_BASE || "";
})();
