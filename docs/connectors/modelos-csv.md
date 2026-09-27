# Modelos de CSV para importação

Separador `;` ou `,`. Datas `dd/mm/aaaa` ou `aaaa-mm-dd`. Números `1.234,56` ou `1234.56`.
O mesmo arquivo reenviado é ignorado (idempotência por checksum) e linhas repetidas entre fontes são marcadas como duplicadas na reconciliação.

## Operações em bolsa (nota de corretagem)

| coluna | obrigatória | exemplo |
|---|---|---|
| data | sim | 10/01/2026 |
| ticker | sim | PETR4 (PETR4F é normalizado para PETR4) |
| tipo | sim | C ou V |
| quantidade | sim | 100 |
| preco | sim | 30,50 |
| custos | não | 1,20 (corretagem + emolumentos) |
| daytrade | não | sim / 1 / x |
| corretora | não | XP |
| classe | não | acao, etf, fii, bdr (inferida se ausente) |

```csv
data;ticker;tipo;quantidade;preco;custos;daytrade;corretora
10/01/2026;PETR4;C;100;30,50;1,20;;XP
15/03/2026;PETR4;V;100;34,10;1,20;;XP
```

## Extrato (transações)

| coluna | obrigatória | exemplo |
|---|---|---|
| data | sim | 05/09/2026 |
| descricao | sim | Supermercado |
| valor | sim | -250,90 (negativo = saída) |
| conta | não | Nubank |
| categoria | não | inferida por regras se ausente |
