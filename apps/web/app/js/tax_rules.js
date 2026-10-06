/* AURION Tax — registro de regras versionadas (fonte de verdade dos parâmetros do Tax Engine).
 * Gerado a partir de services/tax_engine/rules/br_irpf_2026.json + definição declarativa (Tax Rule DSL "tax-rule-1", v6.0 §14).
 * Regra histórica nunca é sobrescrita: mudança = nova versão com nova vigência e suíte de regressão. */
export const CATALOG = {
 "catalog_version": "2026.09.1",
 "jurisdiction": "BR",
 "generated_for": "AURION — Tax Engine (JS) ",
 "note": "Regras determinísticas versionadas. Status 'validated' = conferida com fonte oficial citada no Dossiê v2.0; ainda exige revisão de contador habilitado antes de produção (Gate de confiança). Status 'pending' = NÃO é usada em cálculo produtivo."
};
export const RULE_VERSIONS = [
 {
  "code": "BR-IRPF-RV-COMUM",
  "version": "2026.1",
  "title": "Renda variável — operações comuns (ações e ETFs de ações)",
  "type": "ganho_capital_bolsa",
  "jurisdiction": "BR",
  "validity": {
   "start": "2026-01-01",
   "end": null
  },
  "status": "validated",
  "validated_at": "2026-09-27",
  "sources": [
   {
    "id": "R6",
    "title": "Receita Federal — Perguntas e Respostas IRPF 2026 (operações em bolsa)",
    "url": "https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/dirpf/p-r-irpf-2026-v1-00-2026-04-23.pdf"
   },
   {
    "id": "L11033-3-I",
    "title": "Lei 11.033/2004, art. 3º, I — isenção de alienações de ações até R$ 20.000/mês",
    "url": "https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2004/lei/l11033.htm"
   },
   {
    "id": "IN1585",
    "title": "IN RFB 1.585/2015 — tributação no mercado financeiro e de capitais",
    "url": "http://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=67494"
   }
  ],
  "parameters": {
   "aliquota": "0.15",
   "limite_isencao_vendas_mes": "20000.00",
   "classes_com_isencao": [
    "acao"
   ],
   "classes": [
    "acao",
    "etf",
    "bdr"
   ],
   "irrf_aliquota_sobre_venda": "0.00005",
   "darf_codigo": "6015",
   "darf_valor_minimo": "10.00",
   "compensar_prejuizo_mes_isento": true
  },
  "formula": "base = max(0, resultado_liquido_mes - prejuizo_acumulado_comum); se classe ação e vendas_acoes_mes <= limite: ganho de ações isento; imposto = base_tributavel * aliquota - IRRF_mes; DARF se imposto >= valor_minimo, senão acumula para o mês seguinte.",
  "exceptions": [
   "Isenção de R$ 20 mil aplica-se somente a ações no mercado à vista; ETFs, BDRs e FIIs não têm isenção.",
   "Prejuízo só compensa ganhos da mesma modalidade (comum com comum).",
   "PREMISSA A CONFIRMAR: compensação de prejuízo apurado em mês de vendas isentas (parâmetro compensar_prejuizo_mes_isento)."
  ],
  "tests": [
   "worker/test/tax_regression.test.mjs › BR-IRPF-RV-COMUM"
  ],
  "rule_definition": {
   "schema_version": "tax-rule-1",
   "tax_type": "IRPF_RV_COMUM",
   "jurisdiction": "BR",
   "base": {
    "source": "TAX_EVENT.NET_RESULT",
    "group_by": "month",
    "modality": "comum"
   },
   "conditions": [
    {
     "field": "event.asset_class",
     "operator": "in",
     "value": [
      "acao",
      "etf",
      "bdr"
     ]
    }
   ],
   "steps": [
    {
     "op": "exempt_if",
     "field": "month.sales_acoes",
     "operator": "lte",
     "parameter_ref": "limite_isencao_vendas_mes",
     "applies_to": {
      "asset_class": "acao"
     }
    },
    {
     "op": "offset_losses",
     "bucket": "comum"
    },
    {
     "op": "apply_rate",
     "rate_ref": "aliquota"
    },
    {
     "op": "deduct_withholding",
     "parameter_ref": "irrf_aliquota_sobre_venda",
     "base": "month.sales_gross"
    },
    {
     "op": "carry_if_below",
     "parameter_ref": "darf_valor_minimo"
    }
   ],
   "effective": {
    "from": "2026-01-01",
    "to": null
   },
   "source_reference": {
    "title": "Receita Federal — Perguntas e Respostas IRPF 2026 (operações em bolsa)",
    "locator": "https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/dirpf/p-r-irpf-2026-v1-00-2026-04-23.pdf",
    "retrieved_at": "2026-09-27"
   }
  }
 },
 {
  "code": "BR-IRPF-RV-DAYTRADE",
  "version": "2026.1",
  "title": "Renda variável — day trade",
  "type": "ganho_capital_bolsa",
  "jurisdiction": "BR",
  "validity": {
   "start": "2026-01-01",
   "end": null
  },
  "status": "validated",
  "validated_at": "2026-09-27",
  "sources": [
   {
    "id": "R6",
    "title": "Receita Federal — Perguntas e Respostas IRPF 2026 (day trade: 20%)",
    "url": "https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/dirpf/p-r-irpf-2026-v1-00-2026-04-23.pdf"
   },
   {
    "id": "IN1585",
    "title": "IN RFB 1.585/2015",
    "url": "http://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=67494"
   }
  ],
  "parameters": {
   "aliquota": "0.20",
   "irrf_aliquota_sobre_ganho": "0.01",
   "darf_codigo": "6015",
   "darf_valor_minimo": "10.00"
  },
  "formula": "base = max(0, resultado_daytrade_mes - prejuizo_acumulado_daytrade); imposto = base * 0.20 - IRRF(1% do ganho).",
  "exceptions": [
   "Sem isenção de R$ 20 mil.",
   "Prejuízo de day trade compensa apenas ganho de day trade."
  ],
  "tests": [
   "worker/test/tax_regression.test.mjs › BR-IRPF-RV-DAYTRADE"
  ],
  "rule_definition": {
   "schema_version": "tax-rule-1",
   "tax_type": "IRPF_RV_DAYTRADE",
   "jurisdiction": "BR",
   "base": {
    "source": "TAX_EVENT.NET_RESULT",
    "group_by": "month",
    "modality": "daytrade"
   },
   "conditions": [
    {
     "field": "event.same_day_round_trip",
     "operator": "eq",
     "value": true
    }
   ],
   "steps": [
    {
     "op": "offset_losses",
     "bucket": "daytrade"
    },
    {
     "op": "apply_rate",
     "rate_ref": "aliquota"
    },
    {
     "op": "deduct_withholding",
     "parameter_ref": "irrf_aliquota_sobre_ganho",
     "base": "event.gain"
    },
    {
     "op": "carry_if_below",
     "parameter_ref": "darf_valor_minimo"
    }
   ],
   "effective": {
    "from": "2026-01-01",
    "to": null
   },
   "source_reference": {
    "title": "Receita Federal — Perguntas e Respostas IRPF 2026 (day trade: 20%)",
    "locator": "https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/dirpf/p-r-irpf-2026-v1-00-2026-04-23.pdf",
    "retrieved_at": "2026-09-27"
   }
  }
 },
 {
  "code": "BR-IRPF-FII",
  "version": "2026.1",
  "title": "Fundos imobiliários — ganho na alienação de cotas",
  "type": "ganho_capital_bolsa",
  "jurisdiction": "BR",
  "validity": {
   "start": "2026-01-01",
   "end": null
  },
  "status": "validated",
  "validated_at": "2026-09-27",
  "sources": [
   {
    "id": "L8668-18",
    "title": "Lei 8.668/1993, art. 18 — ganho de capital na alienação de cotas de FII (20%)",
    "url": "https://www.planalto.gov.br/ccivil_03/leis/l8668.htm"
   },
   {
    "id": "R6",
    "title": "Receita Federal — Perguntas e Respostas IRPF 2026",
    "url": "https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/dirpf/p-r-irpf-2026-v1-00-2026-04-23.pdf"
   }
  ],
  "parameters": {
   "aliquota": "0.20",
   "irrf_aliquota_sobre_venda": "0.00005",
   "darf_codigo": "6015",
   "darf_valor_minimo": "10.00"
  },
  "formula": "base = max(0, resultado_fii_mes - prejuizo_acumulado_fii); imposto = base * 0.20 - IRRF.",
  "exceptions": [
   "Sem isenção de R$ 20 mil.",
   "Rendimentos distribuídos (proventos) seguem regra própria — fora do escopo desta regra."
  ],
  "tests": [
   "worker/test/tax_regression.test.mjs › BR-IRPF-FII"
  ],
  "rule_definition": {
   "schema_version": "tax-rule-1",
   "tax_type": "IRPF_FII_ALIENACAO",
   "jurisdiction": "BR",
   "base": {
    "source": "TAX_EVENT.NET_RESULT",
    "group_by": "month",
    "modality": "fii"
   },
   "conditions": [
    {
     "field": "event.asset_class",
     "operator": "eq",
     "value": "fii"
    }
   ],
   "steps": [
    {
     "op": "offset_losses",
     "bucket": "fii"
    },
    {
     "op": "apply_rate",
     "rate_ref": "aliquota"
    },
    {
     "op": "deduct_withholding",
     "parameter_ref": "irrf_aliquota_sobre_venda",
     "base": "month.sales_gross"
    },
    {
     "op": "carry_if_below",
     "parameter_ref": "darf_valor_minimo"
    }
   ],
   "effective": {
    "from": "2026-01-01",
    "to": null
   },
   "source_reference": {
    "title": "Lei 8.668/1993, art. 18 — ganho de capital na alienação de cotas de FII (20%)",
    "locator": "https://www.planalto.gov.br/ccivil_03/leis/l8668.htm",
    "retrieved_at": "2026-09-27"
   }
  }
 },
 {
  "code": "BR-IRPF-PGBL-DEDUCAO",
  "version": "2026.1",
  "title": "Previdência PGBL — dedução na declaração completa",
  "type": "deducao_irpf",
  "jurisdiction": "BR",
  "validity": {
   "start": "2026-01-01",
   "end": null
  },
  "status": "validated",
  "validated_at": "2026-09-27",
  "sources": [
   {
    "id": "R5",
    "title": "Receita Federal — Como declarar PGBL e VGBL",
    "url": "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/perguntas-frequentes/imposto-de-renda/dirpf/declaracao/pgvl-vgbl"
   }
  ],
  "parameters": {
   "limite_percentual": "0.12",
   "exige_modelo_completo": true,
   "exige_contribuicao_regime_previdencia": true,
   "vgbl_dedutivel": false
  },
  "formula": "deducao = min(contribuicoes_pgbl, 12% * rendimentos_tributaveis). Efeito estimado = deducao_adicional * aliquota_marginal (PREMISSA informada pelo usuário). Valor é diferido: tributado no resgate/benefício.",
  "exceptions": [
   "VGBL não é dedutível.",
   "Declaração simplificada não aproveita a dedução.",
   "Resultado é estimativa de diferimento, não economia garantida."
  ],
  "tests": [
   "worker/test/tax_regression.test.mjs › BR-IRPF-PGBL-DEDUCAO"
  ],
  "rule_definition": {
   "schema_version": "tax-rule-1",
   "tax_type": "IRPF_DEDUCAO_PGBL",
   "jurisdiction": "BR",
   "base": {
    "source": "USER_INPUT.TAXABLE_INCOME"
   },
   "conditions": [
    {
     "field": "user.full_model",
     "operator": "eq",
     "value": true
    },
    {
     "field": "user.contributes_social_security",
     "operator": "eq",
     "value": true
    }
   ],
   "steps": [
    {
     "op": "cap",
     "parameter_ref": "limite_percentual",
     "of": "base"
    },
    {
     "op": "apply_rate",
     "rate_ref": "USER_INPUT.MARGINAL_RATE"
    }
   ],
   "effective": {
    "from": "2026-01-01",
    "to": null
   },
   "source_reference": {
    "title": "Receita Federal — Como declarar PGBL e VGBL",
    "locator": "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/perguntas-frequentes/imposto-de-renda/dirpf/declaracao/pgvl-vgbl",
    "retrieved_at": "2026-09-27"
   }
  }
 },
 {
  "code": "BR-IRPF-TABELA-ANUAL",
  "version": "2026.0-draft",
  "title": "Tabela progressiva anual IRPF (ano-calendário 2026) com redução da Lei 15.270/2025",
  "type": "tabela_progressiva",
  "jurisdiction": "BR",
  "validity": {
   "start": "2026-01-01",
   "end": null
  },
  "status": "pending",
  "validated_at": null,
  "sources": [],
  "parameters": {},
  "formula": "PENDENTE — faixas, parcelas a deduzir e mecanismo de redução devem ser transcritos da fonte oficial vigente e cobertos por golden tests antes do uso.",
  "exceptions": [
   "Não é utilizada em nenhum cálculo produtivo enquanto status = pending. Simulações usam alíquota marginal informada como premissa."
  ],
  "tests": []
 }
];

const OPS = new Set(["exempt_if", "offset_losses", "apply_rate", "deduct_withholding", "carry_if_below", "cap", "apply_deduction"]);
const OPERATORS = new Set(["eq", "in", "lte", "lt", "gte", "gt"]);
/* valida a definição declarativa: só operações conhecidas, parâmetros existentes, vigência coerente — nunca executa código arbitrário */
export function validateRuleDefinition(rule) {
  const d = rule.rule_definition, errors = [];
  if (!d) return rule.status === "validated" ? ["regra validada sem definição declarativa"] : [];
  if (d.schema_version !== "tax-rule-1") errors.push("schema_version deve ser tax-rule-1");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.effective?.from || "")) errors.push("effective.from inválido");
  if (d.effective?.to && d.effective.to < d.effective.from) errors.push("effective.to antes de effective.from");
  for (const c of d.conditions || []) if (!OPERATORS.has(c.operator)) errors.push(`operador desconhecido: ${c.operator}`);
  for (const s of d.steps || []) {
    if (!OPS.has(s.op)) errors.push(`operação desconhecida: ${s.op}`);
    for (const ref of [s.parameter_ref, s.rate_ref].filter(Boolean)) if (!ref.startsWith("USER_INPUT.") && !(ref in (rule.parameters || {}))) errors.push(`parâmetro inexistente: ${ref}`);
  }
  if (!rule.sources?.length) errors.push("regra sem fonte");
  return errors;
}
/* versão vigente de uma regra numa data */
export function ruleAt(code, date) {
  const vs = RULE_VERSIONS.filter(r => r.code === code && r.status === "validated" && r.validity.start <= date && (!r.validity.end || date <= r.validity.end));
  return vs.sort((a, b) => b.validity.start.localeCompare(a.validity.start))[0] || null;
}
export function ruleListing() {
  return { catalog: CATALOG, items: RULE_VERSIONS.map(r => ({ ...r, usable_in_calculation: r.status === "validated", definition_errors: validateRuleDefinition(r) })) };
}
