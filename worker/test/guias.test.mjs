/* Motor de guias: DARF (código, CPF/CNPJ, vencimento, multa e juros de mora, mínimo) e DARE (tabela RO). */
import test from "node:test";
import assert from "node:assert/strict";
import { cpfValido, cnpjValido, feriados, diaUtil, receita, periodoApuracao, vencimentoLegal, acrescimos, montarDarf, montarDare } from "../../apps/web/app/js/guia_engine.js";

const CPF = "52998224725", CNPJ = "11222333000181";
const SELIC = [{ date: "2026-01-01", value: 1.16 }, { date: "2026-02-01", value: 1.0 }, { date: "2026-03-01", value: 1.12 }, { date: "2026-04-01", value: 1.05 }];

test("CPF e CNPJ: dígitos verificadores", () => {
  assert.ok(cpfValido("529.982.247-25")); assert.ok(!cpfValido("529.982.247-24")); assert.ok(!cpfValido("111.111.111-11"));
  assert.ok(cnpjValido("11.222.333/0001-81")); assert.ok(!cnpjValido("11.222.333/0001-80")); assert.ok(!cnpjValido("00000000000000"));
});

test("calendário bancário: feriados móveis e fixos", () => {
  const f = feriados(2026);
  for (const d of ["2026-02-16", "2026-02-17", "2026-04-03", "2026-06-04", "2026-11-20", "2026-04-21"]) assert.ok(f.has(d), d);
  assert.ok(!diaUtil("2026-11-20")); assert.ok(diaUtil("2026-11-19")); assert.ok(!diaUtil("2026-10-10"));
});

test("vencimentos legais por código", () => {
  const v = (c, p) => vencimentoLegal(receita(c), periodoApuracao(receita(c), p));
  assert.equal(v("6015", "2026-08"), "2026-09-30");
  assert.equal(v("6015", "2025-12"), "2026-01-30");
  assert.equal(v("0190", "2026-01"), "2026-02-27");                 // 28/02/2026 é sábado
  assert.equal(v("0561", "2026-10"), "2026-11-19");                 // 20/11 feriado → antecipa
  assert.equal(v("8109", "2026-03"), "2026-04-24");                 // 25/04/2026 é sábado → antecipa
  assert.equal(v("2089", "2026-T1"), "2026-04-30");
  assert.equal(periodoApuracao(receita("2089"), "2026-T3").fim, "2026-09-30");
});

test("acréscimos: multa 0,33%/dia (teto 20%) e juros Selic + 1%", () => {
  const a = acrescimos({ principal: 1000, vencimento: "2026-08-31", pagamento: "2026-09-10", selic: SELIC });
  assert.deepEqual([a.atraso_dias, a.multa_pct, a.multa, a.juros_pct, a.juros, a.total], [10, 3.3, 33, 1, 10, 1043]);
  const b = acrescimos({ principal: 500, vencimento: "2026-01-30", pagamento: "2026-04-15", selic: SELIC });
  assert.equal(b.multa_pct, 20); assert.equal(b.juros_pct, 3.12);   // fev 1,00 + mar 1,12 + 1% no mês do pagamento
  assert.equal(b.total, 500 + 100 + 15.6);
  const c = acrescimos({ principal: 100, vencimento: "2026-09-30", pagamento: "2026-09-30", selic: SELIC });
  assert.equal(c.total, 100); assert.equal(c.multa, 0);
  const d = acrescimos({ principal: 100, vencimento: "2026-03-31", pagamento: "2026-07-01", selic: SELIC });
  assert.deepEqual(d.selic_faltando, ["2026-05", "2026-06"]);
});

test("DARF 6015 no prazo: campos do DARF comum e pedido do Integra Contador", () => {
  const g = montarDarf({ codigo: "6015", documento: CPF, nome: "Bruno Teste", periodo: "2026-08", principal: 396.2, pagamento: "2026-09-28", hoje: "2026-09-27", selic: SELIC });
  assert.ok(g.ok, JSON.stringify(g.erros));
  assert.equal(g.campos["02"].valor, "31/08/2026"); assert.equal(g.campos["03"].valor, "529.982.247-25"); assert.equal(g.campos["04"].valor, "6015");
  assert.equal(g.campos["06"].valor, "30/09/2026"); assert.equal(g.campos["10"].valor, "396,20"); assert.equal(g.situacao, "no_prazo");
  assert.equal(g.integra_contador.dados.dataPA, "08/2026"); assert.equal(g.integra_contador.idServico, "CONSOLIDARGERARDARF51");
  assert.equal(g.codigo_barras, null);
  const again = montarDarf({ codigo: "6015", documento: CPF, nome: "Bruno Teste", periodo: "2026-08", principal: 396.2, pagamento: "2026-09-28", hoje: "2026-09-27", selic: SELIC });
  assert.equal(g.id, again.id);
});

test("DARF em atraso calcula multa e juros; pagamento em fim de semana vai ao próximo dia útil", () => {
  const g = montarDarf({ codigo: "6015", documento: CPF, nome: "Bruno Teste", periodo: "2026-07", principal: 1000, pagamento: "2026-09-12", hoje: "2026-09-10", selic: SELIC });
  assert.ok(g.ok); assert.equal(g.pagamento, "2026-09-14"); assert.equal(g.situacao, "em_atraso");
  assert.equal(g.valores.atraso_dias, 14); assert.equal(g.valores.multa, "46.20"); assert.equal(g.valores.juros, "10.00"); assert.equal(g.valores.total, "1056.20");
  assert.equal(g.valido_ate, "2026-09-14");
});

test("Selic do mês corrente (parcial) não entra nos juros", () => {
  const sel = [...SELIC, { date: "2026-09-01", value: 0.2 }];
  const g = montarDarf({ codigo: "6015", documento: CPF, nome: "Bruno Teste", periodo: "2026-07", principal: 1000, pagamento: "2026-10-15", hoje: "2026-09-10", selic: sel });
  assert.ok(g.ok); assert.ok(g.avisos.some(a => /2026-09/.test(a))); assert.equal(g.valores.juros_pct, 1);
});

test("DARF: validações (mínimo R$ 10, PF x PJ, CPF inválido, pagamento no passado)", () => {
  const base = { codigo: "6015", documento: CPF, nome: "Bruno Teste", periodo: "2026-08", hoje: "2026-09-27" };
  const min = montarDarf({ ...base, principal: 9.99 }); assert.ok(!min.ok && min.abaixo_minimo);
  const acum = montarDarf({ ...base, principal: 6, acumulado_anterior: 5 }); assert.ok(acum.ok); assert.equal(acum.valores.principal, "11.00");
  assert.match(montarDarf({ ...base, documento: CNPJ, principal: 50 }).erros[0].msg, /pessoa física/);
  assert.match(montarDarf({ ...base, codigo: "2089", periodo: "2026-T2", principal: 50 }).erros[0].msg, /pessoa jurídica/);
  assert.match(montarDarf({ ...base, documento: "52998224724", principal: 50 }).erros[0].msg, /inválido/);
  assert.equal(montarDarf({ ...base, principal: 50, pagamento: "2026-09-01" }).erros[0].campo, "pagamento");
  const pj = montarDarf({ ...base, codigo: "2089", documento: CNPJ, nome: "Empresa Teste Ltda", periodo: "2026-T2", principal: 1520.4 });
  assert.ok(pj.ok); assert.equal(pj.vencimento, "2026-07-31"); assert.equal(pj.integra_contador.dados.tipoPA, "TR");
  assert.equal(montarDarf({ ...base, codigo: "0211", periodo: "2025", principal: 300 }).erros[0].campo, "vencimento");
});

test("DARE Rondônia: tabela, CNPJ e IE para ICMS; outras UFs aceitam código informado", () => {
  const itcd = montarDare({ uf: "RO", codigo: "3112", documento: CPF, nome: "Bruno Teste", vencimento: "2026-10-30", principal: 2400, hoje: "2026-10-07" });
  assert.ok(itcd.ok); assert.equal(itcd.receita.descricao, "ITCD — transmissão causa mortis e doação"); assert.equal(itcd.codigo_barras, null);
  assert.ok(!montarDare({ uf: "RO", codigo: "1212", documento: CPF, nome: "Bruno Teste", vencimento: "2026-10-30", principal: 10, hoje: "2026-10-07" }).ok);
  assert.ok(!montarDare({ uf: "RO", codigo: "9999", documento: CPF, nome: "Bruno Teste", vencimento: "2026-10-30", principal: 10 }).ok);
  const sp = montarDare({ uf: "SP", codigo: "123", documento: CNPJ, nome: "Empresa Teste", vencimento: "2026-10-30", principal: 10, hoje: "2026-10-07" });
  assert.ok(sp.ok); assert.ok(sp.avisos.some(a => /ainda não está/.test(a)));
});
