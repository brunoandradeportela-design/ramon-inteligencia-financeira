# Integra Contador (SERPRO) — DARF com código de barras direto no AURION

Hoje o AURION gera o DARF completo **sem código de barras**. O cliente pode pagar de duas formas:
- no internet banking, pela opção "DARF sem código de barras";
- no Sicalc da Receita, que gera o código de barras com os mesmos dados.

O código já está pronto para pedir o **DARF oficial com código de barras** ao serviço SICALC do Integra Contador, do SERPRO (`CONSOLIDARGERARDARF51`, versão 2.9). Ele fica desligado até o contrato e os segredos abaixo existirem.

## 1. Decisões e contratação (Bruno)

1. **CNPJ contratante.** Escolher qual empresa contrata o serviço, por exemplo a KABÔ ou outra.
2. **Contratar na Loja SERPRO.** Contratar o produto *Integra Contador*. A cobrança é por consumo; confirmar os valores e a franquia na proposta do SERPRO.
3. **Certificado e-CNPJ do contratante.** O certificado precisa ser do tipo A1, em arquivo `.pfx`. O SERPRO exige autenticação com o certificado (mTLS).
4. **Chaves de acesso.** Na área do cliente do SERPRO, gerar o *Consumer Key* e o *Consumer Secret*.

## 2. Autorização de cada contribuinte

O SERPRO só emite o DARF em nome de quem autorizou o CNPJ contratante, ou o escritório que fizer o pedido:
- **Procuração eletrônica no e-CAC:** o contribuinte, pessoa física ou jurídica, dá procuração ao CNPJ contratante, ou ao contador que fará o pedido.
- **Pedido feito por outro CNPJ:** se o autor do pedido for diferente do contratante, ele também precisa de um termo de autorização assinado (serviço *autenticar procurador* do Integra Contador). Confirmar esse fluxo com o SERPRO.

Sem procuração, o Sicalc recusa o pedido. O AURION mostra essa mensagem ao cliente e mantém a guia sem código de barras.

## 3. Ligar no Cloudflare (Bruno, no painel ou no terminal)

Os segredos são cadastrados só pelo Bruno; nada disso vai para o repositório.

1. **Converter o certificado.** O `.pfx` vira `cert.pem` e `key.pem`, por exemplo com `openssl pkcs12`, no computador do Bruno.
2. **Enviar o certificado ao Cloudflare.** Rodar `npx wrangler mtls-certificate upload --cert cert.pem --key key.pem --name serpro-ecnpj`. O comando devolve o `certificate_id`.
3. **Ligar o certificado ao Worker.** No `worker/wrangler.toml`, acrescentar:
   ```toml
   [[mtls_certificates]]
   binding = "SERPRO_CERT"
   certificate_id = "<id devolvido no passo 2>"
   ```
4. **Cadastrar os segredos.** Usar `npx wrangler secret put` para:
   - `SERPRO_CONSUMER_KEY` e `SERPRO_CONSUMER_SECRET`;
   - `SERPRO_CONTRATANTE_CNPJ`;
   - opcionais: `SERPRO_AUTOR` (CPF ou CNPJ de quem faz o pedido, se não for o contratante), `SERPRO_UF_PADRAO` e `SERPRO_MUNICIPIO_PADRAO` (código do município na tabela da Receita).
5. **Testar no ambiente de demonstração.** Antes de produção, testar com `SERPRO_BASE_URL=https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1`.

## 4. O que muda para o cliente

- **Botão de emissão:** em Tributação → Guias aparece **"Emitir DARF oficial com código de barras"**. O PDF vem do Sicalc com número de documento e código de barras.
- **Auditoria:** cada emissão é registrada (`guia.darf_oficial_emitido`).
- **Sem contrato:** a rota responde 501 e indica o Sicalc com os mesmos dados (testado em `guias_e2e`).

## Referências

- [Integra Contador — Consolidar e emitir um DARF](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sicalc/sicalc/servicos/consolidar_emitir_um_darf/)
- [Sicalc — Receita Federal](https://sicalc.receita.fazenda.gov.br/sicalc/principal)
- [Cloudflare Workers — mTLS](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/)
