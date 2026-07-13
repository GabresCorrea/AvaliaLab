import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

/* ═══════════════════════════════════════════════════════════════
   AVALIALAB
   Anamnese digital e composição corporal para profissionais
   de educação física, nutrição e fisioterapia.
   ═══════════════════════════════════════════════════════════════ */

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const LIMITE_FREE = 3;
const RASCUNHO = 'al:rascunho:';

/* ───────────────────────────────────────────────────────────────
   MOTOR DE CÁLCULO
   ─────────────────────────────────────────────────────────────── */

// Siri (1961) — densidade corporal para percentual de gordura
const siri = (d) => (495 / d) - 450;

const LABELS_DOBRAS = {
  tricipital:   'Tricipital',
  subescapular: 'Subescapular',
  peitoral:     'Peitoral',
  axilarMedia:  'Axilar média',
  suprailiaca:  'Suprailíaca',
  abdominal:    'Abdominal',
  coxa:         'Coxa',
};

// Faixas plausíveis por dobra (mm) — usadas para validação e para a régua
const FAIXA_DOBRA = { min: 3, max: 60 };

const PROTOCOLOS = {
  pollock7: {
    nome: 'Pollock, 7 dobras',
    resumo: 'Maior precisão. Exige as sete medidas.',
    dobras: ['tricipital', 'subescapular', 'peitoral', 'axilarMedia',
             'suprailiaca', 'abdominal', 'coxa'],
    calc: (d, idade, sexo) => {
      const s = d.tricipital + d.subescapular + d.peitoral + d.axilarMedia +
                d.suprailiaca + d.abdominal + d.coxa;
      const dens = sexo === 'M'
        ? 1.112 - (0.00043499 * s) + (0.00000055 * s * s) - (0.00028826 * idade)
        : 1.097 - (0.00046971 * s) + (0.00000056 * s * s) - (0.00012828 * idade);
      return { somatorio: s, densidade: dens, percentual: siri(dens) };
    },
  },
  pollock3: {
    nome: 'Pollock, 3 dobras',
    resumo: 'O mais usado na prática. Rápido e confiável.',
    porSexo: {
      M: ['peitoral', 'abdominal', 'coxa'],
      F: ['tricipital', 'suprailiaca', 'coxa'],
    },
    calc: (d, idade, sexo) => {
      let s, dens;
      if (sexo === 'M') {
        s = d.peitoral + d.abdominal + d.coxa;
        dens = 1.10938 - (0.0008267 * s) + (0.0000016 * s * s) - (0.0002574 * idade);
      } else {
        s = d.tricipital + d.suprailiaca + d.coxa;
        dens = 1.0994921 - (0.0009929 * s) + (0.0000023 * s * s) - (0.0001392 * idade);
      }
      return { somatorio: s, densidade: dens, percentual: siri(dens) };
    },
  },
  faulkner: {
    nome: 'Faulkner, 4 dobras',
    resumo: 'Rápido. Não considera a idade.',
    dobras: ['tricipital', 'subescapular', 'suprailiaca', 'abdominal'],
    calc: (d) => {
      const s = d.tricipital + d.subescapular + d.suprailiaca + d.abdominal;
      return { somatorio: s, densidade: null, percentual: (s * 0.153) + 5.783 };
    },
  },
  guedes: {
    nome: 'Guedes, 3 dobras',
    resumo: 'Validado para a população brasileira.',
    porSexo: {
      M: ['tricipital', 'suprailiaca', 'abdominal'],
      F: ['subescapular', 'suprailiaca', 'coxa'],
    },
    calc: (d, idade, sexo) => {
      let s, dens;
      if (sexo === 'M') {
        s = d.tricipital + d.suprailiaca + d.abdominal;
        dens = 1.17136 - (0.06706 * Math.log10(s));
      } else {
        s = d.subescapular + d.suprailiaca + d.coxa;
        dens = 1.16650 - (0.07063 * Math.log10(s));
      }
      return { somatorio: s, densidade: dens, percentual: siri(dens) };
    },
  },
};

const dobrasDoProtocolo = (protocolo, sexo) => {
  const P = PROTOCOLOS[protocolo];
  return P.porSexo ? P.porSexo[sexo] : P.dobras;
};

/* ── Perimetria ── */

const PERIMETROS = [
  { k: 'ombro',           l: 'Ombro',              g: 'tronco',  faixa: [70, 160] },
  { k: 'torax',           l: 'Tórax',              g: 'tronco',  faixa: [60, 160] },
  { k: 'cintura',         l: 'Cintura',            g: 'central', faixa: [50, 180] },
  { k: 'abdomen',         l: 'Abdômen',            g: 'central', faixa: [50, 190] },
  { k: 'quadril',         l: 'Quadril',            g: 'central', faixa: [60, 180] },
  { k: 'bracoD',          l: 'Braço D. relaxado',  g: 'membro',  faixa: [18, 60] },
  { k: 'bracoE',          l: 'Braço E. relaxado',  g: 'membro',  faixa: [18, 60] },
  { k: 'bracoContraidoD', l: 'Braço D. contraído', g: 'membro',  faixa: [18, 65] },
  { k: 'bracoContraidoE', l: 'Braço E. contraído', g: 'membro',  faixa: [18, 65] },
  { k: 'antebracoD',      l: 'Antebraço D.',       g: 'membro',  faixa: [15, 45] },
  { k: 'antebracoE',      l: 'Antebraço E.',       g: 'membro',  faixa: [15, 45] },
  { k: 'coxaD',           l: 'Coxa D.',            g: 'membro',  faixa: [30, 90] },
  { k: 'coxaE',           l: 'Coxa E.',            g: 'membro',  faixa: [30, 90] },
  { k: 'panturrilhaD',    l: 'Panturrilha D.',     g: 'membro',  faixa: [22, 55] },
  { k: 'panturrilhaE',    l: 'Panturrilha E.',     g: 'membro',  faixa: [22, 55] },
];

const GRUPOS_PERIM = [
  { id: 'tronco',  l: 'Tronco' },
  { id: 'central', l: 'Região central' },
  { id: 'membro',  l: 'Membros' },
];

/* ── Classificação (ACSM) ── */

const CLASSIFICACAO = {
  M: [
    { max: 5,  label: 'Essencial',  tom: 'info' },
    { max: 13, label: 'Atlético',   tom: 'otimo' },
    { max: 17, label: 'Bom',        tom: 'bom' },
    { max: 24, label: 'Aceitável',  tom: 'medio' },
    { max: 99, label: 'Elevado',    tom: 'alto' },
  ],
  F: [
    { max: 13, label: 'Essencial',  tom: 'info' },
    { max: 20, label: 'Atlético',   tom: 'otimo' },
    { max: 24, label: 'Bom',        tom: 'bom' },
    { max: 31, label: 'Aceitável',  tom: 'medio' },
    { max: 99, label: 'Elevado',    tom: 'alto' },
  ],
};

const TOM_COR = {
  info:  '#5B8AA6',
  otimo: '#2F7A63',
  bom:   '#4F9A6E',
  medio: '#B58A3C',
  alto:  '#B5654A',
};

const classificar = (pct, sexo) =>
  CLASSIFICACAO[sexo].find((c) => pct <= c.max) || CLASSIFICACAO[sexo][4];

const TETO_ESCALA = { M: 35, F: 42 };

/* ── Gasto energético ── */

const NIVEIS_ATIVIDADE = [
  { k: 1.2,   l: 'Sedentário',      d: 'Pouco ou nenhum exercício' },
  { k: 1.375, l: 'Levemente ativo', d: 'Exercício leve, 1 a 3 dias por semana' },
  { k: 1.55,  l: 'Moderadamente ativo', d: 'Exercício moderado, 3 a 5 dias' },
  { k: 1.725, l: 'Muito ativo',     d: 'Exercício intenso, 6 a 7 dias' },
  { k: 1.9,   l: 'Extremamente ativo', d: 'Exercício intenso diário ou trabalho físico' },
];

// Cunningham (1980) — usa massa magra, mais preciso que Harris-Benedict
// quando a composição corporal é conhecida.
const tmbCunningham = (massaMagra) => 500 + (22 * massaMagra);

// Mifflin-St Jeor (1990) — fallback, usa apenas peso, altura, idade e sexo.
const tmbMifflin = (peso, altura, idade, sexo) =>
  (10 * peso) + (6.25 * altura) - (5 * idade) + (sexo === 'M' ? 5 : -161);

const idadeDe = (nascimento) => {
  if (!nascimento) return 30;
  const n = new Date(nascimento), h = new Date();
  let i = h.getFullYear() - n.getFullYear();
  const m = h.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && h.getDate() < n.getDate())) i--;
  return i;
};

const classificarIMC = (imc) => {
  if (imc < 18.5) return { label: 'Abaixo do peso', tom: 'info' };
  if (imc < 25)   return { label: 'Peso adequado',  tom: 'bom' };
  if (imc < 30)   return { label: 'Sobrepeso',      tom: 'medio' };
  return { label: 'Obesidade', tom: 'alto' };
};

// RCQ — risco cardiovascular (OMS)
const classificarRCQ = (rcq, sexo) => {
  const limite = sexo === 'M' ? 0.90 : 0.85;
  if (rcq < limite) return { label: 'Risco baixo', tom: 'bom' };
  if (rcq < limite + 0.10) return { label: 'Risco moderado', tom: 'medio' };
  return { label: 'Risco elevado', tom: 'alto' };
};

function calcular({ protocolo, dobras, peso, altura, perimetros, idade, sexo, nivelAtiv }) {
  const necessarias = dobrasDoProtocolo(protocolo, sexo);
  const completo = necessarias.every((k) => Number(dobras[k]) > 0);
  if (!completo || !peso || !altura) return null;

  const d = {};
  necessarias.forEach((k) => { d[k] = Number(dobras[k]); });

  const { somatorio, densidade, percentual } = PROTOCOLOS[protocolo].calc(d, idade, sexo);
  const pct = Math.max(2, Math.min(60, percentual));

  const massaGorda = (peso * pct) / 100;
  const massaMagra = peso - massaGorda;
  const alturaM    = altura / 100;
  const imc        = peso / (alturaM * alturaM);

  const cintura = Number(perimetros?.cintura);
  const quadril = Number(perimetros?.quadril);
  const rcq = cintura > 0 && quadril > 0 ? cintura / quadril : null;

  const tmb = tmbCunningham(massaMagra);
  const fator = Number(nivelAtiv) || 1.55;
  const get = tmb * fator;

  return {
    somatorio:  Number(somatorio.toFixed(1)),
    densidade:  densidade ? Number(densidade.toFixed(5)) : null,
    percentual: Number(pct.toFixed(1)),
    massaGorda: Number(massaGorda.toFixed(1)),
    massaMagra: Number(massaMagra.toFixed(1)),
    imc:        Number(imc.toFixed(1)),
    rcq:        rcq ? Number(rcq.toFixed(2)) : null,
    tmb:        Math.round(tmb),
    get:        Math.round(get),
    fatorAtiv:  fator,
    classificacao: classificar(pct, sexo).label,
  };
}

/* ───────────────────────────────────────────────────────────────
   ANAMNESE — questionário fixo
   ─────────────────────────────────────────────────────────────── */

const ANAMNESE = [
  {
    secao: 'Prontidão para atividade física',
    nota: 'Questionário PAR-Q. Responda com atenção — ele existe para sua segurança.',
    itens: [
      { k: 'parq1', t: 'sn', q: 'Algum médico já disse que você possui algum problema de coração e que só deveria praticar atividade física sob supervisão de profissionais de saúde?' },
      { k: 'parq2', t: 'sn', q: 'Você sente dor no peito quando pratica atividade física?' },
      { k: 'parq3', t: 'sn', q: 'No último mês, você sentiu dor no peito ao praticar atividade física?' },
      { k: 'parq4', t: 'sn', q: 'Você apresenta desequilíbrio devido a tontura ou perda de consciência?' },
      { k: 'parq5', t: 'sn', q: 'Você tem algum problema ósseo ou articular que poderia piorar com a atividade física?' },
      { k: 'parq6', t: 'sn', q: 'Você toma algum medicamento para pressão arterial ou problema cardíaco?' },
      { k: 'parq7', t: 'sn', q: 'Sabe de alguma outra razão pela qual não deveria praticar atividade física?' },
    ],
  },
  {
    secao: 'Histórico de saúde',
    itens: [
      { k: 'condicoes', t: 'multi', q: 'Você possui alguma destas condições?',
        opcoes: ['Hipertensão', 'Diabetes', 'Colesterol alto', 'Asma',
                 'Hipotireoidismo', 'Hérnia de disco', 'Artrose', 'Nenhuma'] },
      { k: 'medicamentos', t: 'texto', q: 'Faz uso de medicamento contínuo? Quais?' },
      { k: 'cirurgias',    t: 'texto', q: 'Já passou por alguma cirurgia? Qual e quando?' },
      { k: 'lesoes',       t: 'texto', q: 'Tem alguma lesão atual ou dor recorrente? Descreva.' },
      { k: 'gestante',     t: 'sn',    q: 'Está gestante ou no pós-parto, até seis meses?' },
    ],
  },
  {
    secao: 'Rotina e hábitos',
    itens: [
      { k: 'experiencia', t: 'unica', q: 'Qual sua experiência com treino de força?',
        opcoes: ['Nunca treinei', 'Menos de 6 meses', 'De 6 meses a 2 anos', 'Mais de 2 anos'] },
      { k: 'frequencia', t: 'unica', q: 'Quantos dias por semana você pode treinar?',
        opcoes: ['2 dias', '3 dias', '4 dias', '5 dias', '6 dias'] },
      { k: 'sono', t: 'unica', q: 'Quantas horas você dorme por noite, em média?',
        opcoes: ['Menos de 5h', 'De 5 a 6h', 'De 6 a 7h', 'De 7 a 8h', 'Mais de 8h'] },
      { k: 'alimentacao', t: 'unica', q: 'Como você avalia sua alimentação hoje?',
        opcoes: ['Ruim', 'Regular', 'Boa', 'Ótima'] },
      { k: 'agua', t: 'unica', q: 'Quanta água você bebe por dia?',
        opcoes: ['Menos de 1L', 'De 1 a 2L', 'De 2 a 3L', 'Mais de 3L'] },
      { k: 'trabalho', t: 'unica', q: 'Como é sua rotina de trabalho?',
        opcoes: ['Sentado a maior parte do dia', 'Em pé a maior parte do dia', 'Fisicamente ativa'] },
    ],
  },
  {
    secao: 'Objetivos',
    itens: [
      { k: 'objetivo', t: 'unica', q: 'Qual seu principal objetivo?',
        opcoes: ['Emagrecimento', 'Ganho de massa muscular', 'Recomposição corporal',
                 'Saúde e qualidade de vida', 'Performance esportiva'] },
      { k: 'prazo', t: 'unica', q: 'Em quanto tempo espera ver resultados?',
        opcoes: ['De 1 a 3 meses', 'De 3 a 6 meses', 'De 6 a 12 meses', 'Sem prazo definido'] },
      { k: 'motivacao', t: 'texto', q: 'O que levou você a procurar acompanhamento agora?' },
      { k: 'obstaculo', t: 'texto', q: 'O que já impediu você de manter uma rotina de treino antes?' },
    ],
  },
];

/* ───────────────────────────────────────────────────────────────
   DESIGN SYSTEM

   Direção: instrumento de medição, não app de academia.
   O profissional segura um adipômetro — objeto calibrado, de metal,
   com escala gravada. A interface pertence ao mesmo kit.

   Claro, não escuro. Três razões:
   1. A academia é iluminada. Tela escura sob luz forte vira espelho.
   2. O relatório é branco. App claro é a prévia do documento.
   3. Escuro com verde-ácido é o clichê do gênero.
   ─────────────────────────────────────────────────────────────── */

const CSS = `
:root{
  /* Superfícies */
  --papel:      #FAFAF8;
  --superficie: #FFFFFF;
  --recuo:      #F2F3F1;

  /* Tinta */
  --tinta:      #16181A;
  --grafite:    #55595E;
  --sombra-txt: #878C92;
  --tenue:      #AEB3B7;

  /* Traços */
  --regua:      #E2E5E3;
  --regua-forte:#CBD0CD;

  /* Acento: aço. Cor de instrumento, não de app fitness. */
  --aco:        #2F5D62;
  --aco-claro:  #EAF1F1;
  --aco-borda:  #B9CFD1;

  /* Semânticos */
  --cobre:      #B5654A;
  --cobre-claro:#FBF0EC;
  --verde:      #2F7A63;
  --verde-claro:#EAF4F0;
  --ambar:      #B58A3C;
  --ambar-claro:#FBF4E7;

  /* Escala 4/8 */
  --e1: 4px;  --e2: 8px;  --e3: 12px; --e4: 16px;
  --e5: 24px; --e6: 32px; --e7: 48px; --e8: 64px;

  /* Raio */
  --r1: 6px;  --r2: 10px; --r3: 14px; --r4: 20px;

  /* Sombra */
  --s1: 0 1px 2px rgba(22,24,26,.05);
  --s2: 0 2px 8px rgba(22,24,26,.07), 0 1px 2px rgba(22,24,26,.04);
  --s3: 0 8px 28px rgba(22,24,26,.10), 0 2px 6px rgba(22,24,26,.05);
  --s4: 0 20px 60px rgba(22,24,26,.16), 0 4px 12px rgba(22,24,26,.06);

  --t: 160ms cubic-bezier(.4,0,.2,1);
}

*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-text-size-adjust:100%}

body{
  background:var(--papel);color:var(--tinta);
  font-family:'Inter',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  font-size:15px;line-height:1.55;
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
}

.disp{
  font-family:'Instrument Sans','Inter',sans-serif;
  font-weight:600;letter-spacing:-.018em;
}
.mono{
  font-family:'JetBrains Mono','SF Mono',ui-monospace,monospace;
  font-variant-numeric:tabular-nums;
  font-feature-settings:'zero' 1;
}

/* ── Marca ── */
.marca{
  font-family:'Instrument Sans',sans-serif;
  font-weight:600;letter-spacing:.10em;text-transform:uppercase;
}
.marca em{font-style:normal;color:var(--aco)}

/* ── Campos ── */
.campo{display:flex;flex-direction:column;gap:var(--e2)}
.rot{
  font-size:11px;font-weight:600;color:var(--sombra-txt);
  text-transform:uppercase;letter-spacing:.07em;
}
.dica{font-size:12.5px;color:var(--sombra-txt);line-height:1.45}

input,select,textarea{
  width:100%;font-family:inherit;font-size:15px;
  background:var(--superficie);color:var(--tinta);
  border:1px solid var(--regua);border-radius:var(--r1);
  padding:11px 13px;outline:none;
  transition:border-color var(--t),box-shadow var(--t);
}
input:hover:not(:disabled),select:hover,textarea:hover{border-color:var(--regua-forte)}
input:focus,select:focus,textarea:focus{
  border-color:var(--aco);
  box-shadow:0 0 0 3px rgba(47,93,98,.10);
}
input:disabled{background:var(--recuo);color:var(--tenue);cursor:not-allowed}
input::placeholder,textarea::placeholder{color:var(--tenue)}
textarea{resize:vertical;min-height:76px;line-height:1.55}

input.num{
  font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;
  text-align:right;font-size:16px;font-weight:500;
}
input.alerta{border-color:var(--ambar)}
input.alerta:focus{box-shadow:0 0 0 3px rgba(181,138,60,.13)}

select{
  appearance:none;cursor:pointer;padding-right:38px;
  background-image:url("data:image/svg+xml,%3Csvg width='11' height='7' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L5.5 6L10 1.5' stroke='%2355595E' stroke-width='1.4' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 13px center;
}

/* ── Botões ── */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:var(--e2);
  font-family:inherit;font-size:14.5px;font-weight:600;
  padding:11px 20px;border-radius:var(--r1);border:1px solid transparent;
  cursor:pointer;transition:all var(--t);white-space:nowrap;
  min-height:44px;
}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn:focus-visible{outline:2px solid var(--aco);outline-offset:2px}

.btn-1{background:var(--aco);color:#fff;box-shadow:var(--s1)}
.btn-1:hover:not(:disabled){background:#25494D;box-shadow:var(--s2)}
.btn-1:active:not(:disabled){transform:translateY(.5px);box-shadow:none}

.btn-2{background:var(--superficie);color:var(--tinta);border-color:var(--regua-forte)}
.btn-2:hover:not(:disabled){border-color:var(--aco);color:var(--aco);background:var(--aco-claro)}

.btn-3{background:transparent;color:var(--grafite);padding:9px 12px;min-height:38px}
.btn-3:hover:not(:disabled){background:var(--recuo);color:var(--tinta)}

.btn-x{background:transparent;color:var(--cobre);border-color:var(--regua)}
.btn-x:hover:not(:disabled){background:var(--cobre-claro);border-color:var(--cobre)}

.btn-p{padding:8px 14px;font-size:13.5px;min-height:38px}
.btn-g{padding:14px 26px;font-size:15.5px;min-height:52px}
.btn-full{width:100%}

/* ── Cartão ── */
.cart{
  background:var(--superficie);border:1px solid var(--regua);
  border-radius:var(--r3);padding:var(--e5);box-shadow:var(--s1);
}
.cart-p{padding:var(--e4)}
.cart-0{padding:0;overflow:hidden}

.tit{
  font-family:'Instrument Sans',sans-serif;font-weight:600;
  letter-spacing:-.02em;line-height:1.25;
}
.t1{font-size:27px}
.t2{font-size:20px}
.t3{font-size:16px}

.olho{
  font-size:11px;font-weight:600;color:var(--sombra-txt);
  text-transform:uppercase;letter-spacing:.09em;
}

/* ── Abas ── */
.abas{
  display:flex;gap:2px;padding:3px;background:var(--recuo);
  border-radius:var(--r2);border:1px solid var(--regua);
}
.aba{
  flex:1;padding:9px 14px;background:transparent;border:none;
  font-family:inherit;font-size:13.5px;font-weight:600;color:var(--grafite);
  border-radius:7px;cursor:pointer;transition:all var(--t);
  display:flex;align-items:center;justify-content:center;gap:6px;
  min-height:40px;
}
.aba:hover{color:var(--tinta)}
.aba[aria-selected="true"]{
  background:var(--superficie);color:var(--tinta);box-shadow:var(--s1);
}
.aba:focus-visible{outline:2px solid var(--aco);outline-offset:-2px}

/* ── Selo ── */
.selo{
  display:inline-flex;align-items:center;gap:5px;
  padding:3px 9px;border-radius:20px;
  font-size:11.5px;font-weight:600;letter-spacing:.01em;
  border:1px solid var(--regua);background:var(--recuo);color:var(--grafite);
  white-space:nowrap;
}
.selo-otimo{background:var(--verde-claro);color:var(--verde);border-color:#BFDDD1}
.selo-bom  {background:var(--verde-claro);color:#3E8460;border-color:#CBE3D8}
.selo-medio{background:var(--ambar-claro);color:#8E6B27;border-color:#E8D5AA}
.selo-alto {background:var(--cobre-claro);color:#94513A;border-color:#EBC9BC}
.selo-info {background:var(--aco-claro); color:var(--aco);border-color:var(--aco-borda)}
.selo-aco  {background:var(--aco-claro); color:var(--aco);border-color:var(--aco-borda)}

/* ── Escala de dobras (elemento de assinatura) ──
   Cada dobra é uma linha da escala de um instrumento.
   O traço se posiciona ao longo da faixa plausível (3–60mm),
   e você vê o valor fora da curva antes de sair do campo. */
.escala{
  border:1px solid var(--regua);border-radius:var(--r3);
  overflow:hidden;background:var(--superficie);box-shadow:var(--s1);
}
.esc-lin{
  display:grid;grid-template-columns:1fr 108px;
  gap:var(--e4);align-items:center;
  padding:var(--e3) var(--e4);
  border-bottom:1px solid var(--regua);
  position:relative;transition:background var(--t);
}
.esc-lin:last-child{border-bottom:0}
.esc-lin:hover:not(.off){background:#FCFCFB}
.esc-lin.off{opacity:.34;pointer-events:none}
.esc-lin::before{
  content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
  background:var(--regua-forte);transition:background var(--t);
}
.esc-lin.on::before{background:var(--aco)}
.esc-lin.susp::before{background:var(--ambar)}

.esc-nome{font-size:14px;font-weight:500}
.esc-sub{font-size:11px;color:var(--tenue);margin-top:1px}

/* A régua propriamente dita */
.esc-regua{
  position:relative;height:5px;margin-top:7px;
  background:var(--recuo);border-radius:3px;overflow:visible;
}
.esc-tick{
  position:absolute;top:-2px;width:2px;height:9px;
  background:var(--aco);border-radius:1px;
  transform:translateX(-50%);
  transition:left 220ms cubic-bezier(.4,0,.2,1);
}
.esc-tick.susp{background:var(--ambar)}

.esc-campo{display:flex;align-items:center;gap:7px}
.esc-un{font-size:11.5px;color:var(--tenue);font-family:'JetBrains Mono',monospace}

/* ── Painel de resultado ── */
.res{
  background:linear-gradient(180deg,var(--aco-claro) 0%,var(--superficie) 62%);
  border:1px solid var(--aco-borda);border-radius:var(--r3);
  padding:var(--e5);box-shadow:var(--s2);
}
.res-pct{
  font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;
  font-size:52px;font-weight:600;line-height:1;letter-spacing:-.03em;
  color:var(--aco);
}
.res-pct small{font-size:24px;font-weight:500}

.res-grade{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));
  gap:var(--e4);margin-top:var(--e5);
  padding-top:var(--e4);border-top:1px solid var(--aco-borda);
}
.res-k{
  font-size:10.5px;color:var(--sombra-txt);text-transform:uppercase;
  letter-spacing:.07em;font-weight:600;
}
.res-v{
  font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;
  font-size:19px;font-weight:600;margin-top:2px;
}

/* Barra de faixa */
.faixa{margin-top:var(--e4)}
.faixa-t{display:flex;height:8px;border-radius:4px;overflow:hidden}
.faixa-t > div{height:100%}
.faixa-m{position:relative;height:15px;margin-top:-1px}
.faixa-p{
  position:absolute;top:0;transform:translateX(-50%);
  width:3px;height:15px;background:var(--tinta);border-radius:2px;
  box-shadow:0 0 0 2px rgba(255,255,255,.9);
  transition:left 300ms cubic-bezier(.4,0,.2,1);
}
.faixa-l{
  display:flex;justify-content:space-between;
  font-size:10px;color:var(--tenue);margin-top:5px;font-weight:600;
}

/* ── Delta ── */
.delta{
  display:inline-flex;align-items:center;gap:3px;
  font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;
  font-size:12px;font-weight:600;padding:2px 8px;border-radius:11px;
  white-space:nowrap;
}
.delta-bom{background:var(--verde-claro);color:var(--verde)}
.delta-aten{background:var(--ambar-claro);color:#8E6B27}
.delta-neutro{background:var(--recuo);color:var(--sombra-txt)}
.delta-info{background:var(--aco-claro);color:var(--aco)}

/* ── Progresso ── */
.prog{
  position:sticky;top:0;z-index:5;
  background:rgba(250,250,248,.94);backdrop-filter:blur(10px);
  border-bottom:1px solid var(--regua);
  padding:var(--e3) 0;margin:0 0 var(--e5);
}
.prog-t{height:3px;background:var(--recuo);border-radius:2px;overflow:hidden}
.prog-b{
  height:100%;background:var(--aco);border-radius:2px;
  transition:width 340ms cubic-bezier(.4,0,.2,1);
}
.prog-l{
  display:flex;justify-content:space-between;align-items:center;
  margin-top:var(--e2);font-size:12px;color:var(--sombra-txt);
}

/* ── Aviso ── */
.aviso{
  border-radius:var(--r2);padding:var(--e3) var(--e4);
  font-size:13.5px;line-height:1.5;
  border:1px solid;border-left-width:3px;
}
.aviso-alerta{background:var(--ambar-claro);border-color:#E8D5AA;
  border-left-color:var(--ambar);color:#7A5C21}
.aviso-ok{background:var(--verde-claro);border-color:#BFDDD1;
  border-left-color:var(--verde);color:#1F5A48}
.aviso-info{background:var(--aco-claro);border-color:var(--aco-borda);
  border-left-color:var(--aco);color:#23494D}

/* ── Toast ── */
.toast{
  position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
  display:flex;align-items:center;gap:var(--e2);
  background:var(--tinta);color:#fff;
  padding:12px 18px;border-radius:var(--r2);
  font-size:14px;font-weight:500;box-shadow:var(--s4);
  z-index:200;animation:sobe 240ms cubic-bezier(.4,0,.2,1);
  max-width:calc(100vw - 32px);
}
.toast-erro{background:#8E4634}
.toast-ok{background:#23494D}
@keyframes sobe{from{opacity:0;transform:translate(-50%,12px)}}

/* ── Modal ── */
.veu{
  position:fixed;inset:0;background:rgba(22,24,26,.42);
  backdrop-filter:blur(3px);z-index:100;
  display:flex;align-items:center;justify-content:center;padding:var(--e4);
  animation:surge 160ms ease;
}
@keyframes surge{from{opacity:0}}
.modal{
  background:var(--superficie);border-radius:var(--r4);
  box-shadow:var(--s4);width:100%;max-width:460px;
  max-height:88vh;overflow-y:auto;
  animation:entra 200ms cubic-bezier(.4,0,.2,1);
}
@keyframes entra{from{opacity:0;transform:translateY(14px) scale(.98)}}

/* ── Esqueleto ── */
.esq{
  background:linear-gradient(90deg,var(--recuo) 25%,#E9EBE9 50%,var(--recuo) 75%);
  background-size:200% 100%;animation:brilha 1.5s infinite;
  border-radius:var(--r1);
}
@keyframes brilha{to{background-position:-200% 0}}

/* ── Giro ── */
.giro{
  width:15px;height:15px;border:2px solid rgba(255,255,255,.35);
  border-top-color:#fff;border-radius:50%;
  animation:roda .7s linear infinite;display:inline-block;
}
.giro-aco{border-color:var(--regua-forte);border-top-color:var(--aco)}
@keyframes roda{to{transform:rotate(360deg)}}

/* ── Vazio ── */
.vazio{
  text-align:center;padding:var(--e8) var(--e5);
  display:flex;flex-direction:column;align-items:center;gap:var(--e3);
}
.vazio-ico{color:var(--tenue)}
.vazio-t{font-size:16px;font-weight:600}
.vazio-d{font-size:14px;color:var(--sombra-txt);max-width:290px;line-height:1.55}

/* ── Item de lista ── */
.item{
  display:flex;align-items:center;justify-content:space-between;gap:var(--e3);
  padding:var(--e4);background:var(--superficie);
  border:1px solid var(--regua);border-radius:var(--r2);
  cursor:pointer;transition:all var(--t);text-align:left;width:100%;
  font-family:inherit;
}
.item:hover{border-color:var(--regua-forte);box-shadow:var(--s2);transform:translateY(-1px)}
.item:focus-visible{outline:2px solid var(--aco);outline-offset:2px}

/* ── Utilidades ── */
.linha{height:1px;background:var(--regua);border:0}
.pilha{display:flex;flex-direction:column}
.g1{gap:var(--e1)} .g2{gap:var(--e2)} .g3{gap:var(--e3)}
.g4{gap:var(--e4)} .g5{gap:var(--e5)} .g6{gap:var(--e6)}
.fila{display:flex;align-items:center}
.entre{display:flex;align-items:center;justify-content:space-between;gap:var(--e3)}
.grade2{display:grid;grid-template-columns:1fr 1fr;gap:var(--e3)}
.grade3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--e3)}

.sr{
  position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;
}

/* ── Responsivo ── */
@media (max-width:640px){
  .t1{font-size:23px}
  .t2{font-size:18px}
  .res-pct{font-size:44px}
  .cart{padding:var(--e4)}
  .grade3{grid-template-columns:1fr 1fr}
  .esc-lin{grid-template-columns:1fr 96px;gap:var(--e3);padding:var(--e3)}
  .btn{min-height:46px}
  input,select{padding:12px 13px;font-size:16px} /* 16px evita zoom no iOS */
}

@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{
    animation-duration:.01ms!important;animation-iteration-count:1!important;
    transition-duration:.01ms!important;
  }
}
`;

/* ───────────────────────────────────────────────────────────────
   ÍCONES — SVG inline, traço de 1.6px, sem preenchimento.
   Nenhum emoji em nenhum lugar do app ou do relatório.
   ─────────────────────────────────────────────────────────────── */

const Ico = ({ d, size = 18, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true" {...p}>
    {d}
  </svg>
);

const IcoPessoas = (p) => <Ico {...p} d={<><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/></>} />;
const IcoMais    = (p) => <Ico {...p} d={<><path d="M12 5v14M5 12h14"/></>} />;
const IcoBusca   = (p) => <Ico {...p} d={<><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>} />;
const IcoSeta    = (p) => <Ico {...p} d={<path d="m9 6 6 6-6 6"/>} />;
const IcoVolta   = (p) => <Ico {...p} d={<path d="M15 6 9 12l6 6"/>} />;
const IcoBaixo   = (p) => <Ico {...p} d={<path d="m6 9 6 6 6-6"/>} />;
const IcoCheck   = (p) => <Ico {...p} d={<path d="m5 12.5 4.5 4.5L19 7"/>} />;
const IcoRegua   = (p) => <Ico {...p} d={<><rect x="2" y="8" width="20" height="8" rx="1.5"/><path d="M6 8v3M10 8v4M14 8v3M18 8v4"/></>} />;
const IcoGrafico = (p) => <Ico {...p} d={<><path d="M3 20h18"/><path d="m5 15 4-5 4 3 6-8"/></>} />;
const IcoDoc     = (p) => <Ico {...p} d={<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></>} />;
const IcoLink    = (p) => <Ico {...p} d={<><path d="M10 13a4 4 0 0 0 5.7.4l3-3A4 4 0 0 0 13 4.7l-1.7 1.7"/><path d="M14 11a4 4 0 0 0-5.7-.4l-3 3A4 4 0 0 0 11 19.3l1.7-1.7"/></>} />;
const IcoCopia   = (p) => <Ico {...p} d={<><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>} />;
const IcoUsuario = (p) => <Ico {...p} d={<><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></>} />;
const IcoSair    = (p) => <Ico {...p} d={<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></>} />;
const IcoLixo    = (p) => <Ico {...p} d={<><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></>} />;
const IcoAviso   = (p) => <Ico {...p} d={<><path d="M12 3 2 20h20L12 3z"/><path d="M12 9v5M12 17.5v.5"/></>} />;
const IcoImagem  = (p) => <Ico {...p} d={<><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m3 17 5-5 4 4 3-3 6 6"/></>} />;
const IcoFogo    = (p) => <Ico {...p} d={<><path d="M12 22a6 6 0 0 0 6-6c0-4-3-5-3-9 0 0-3 1-3 4 0-2-2-3-2-3s-1 2-1 4c-1-1-2-2-2-2s-1 2-1 6a6 6 0 0 0 6 6z"/></>} />;
const IcoRelogio = (p) => <Ico {...p} d={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>} />;
const IcoX       = (p) => <Ico {...p} d={<path d="M18 6 6 18M6 6l12 12"/>} />;
const IcoFiltro  = (p) => <Ico {...p} d={<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>} />;
const IcoNota    = (p) => <Ico {...p} d={<><path d="M11 4H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>} />;

/* ───────────────────────────────────────────────────────────────
   COMPONENTES
   ─────────────────────────────────────────────────────────────── */

const Btn = ({ variante = '1', tam, cheio, carregando, filho, children, ...p }) => (
  <button
    className={`btn btn-${variante} ${tam ? `btn-${tam}` : ''} ${cheio ? 'btn-full' : ''}`}
    disabled={p.disabled || carregando} {...p}>
    {carregando
      ? <span className={`giro ${variante !== '1' ? 'giro-aco' : ''}`} />
      : children}
  </button>
);

const Campo = ({ rot, dica, erro, children, id }) => (
  <div className="campo">
    {rot && <label className="rot" htmlFor={id}>{rot}</label>}
    {children}
    {erro
      ? <span className="dica" style={{ color: 'var(--ambar)' }}>{erro}</span>
      : dica ? <span className="dica">{dica}</span> : null}
  </div>
);

const Cart = ({ pad, children, style, ...p }) => (
  <div className={`cart ${pad ? `cart-${pad}` : ''}`} style={style} {...p}>
    {children}
  </div>
);

const Selo = ({ tom, children, style }) => (
  <span className={`selo ${tom ? `selo-${tom}` : ''}`} style={style}>{children}</span>
);

const Abas = ({ opcoes, valor, aoTrocar }) => (
  <div className="abas" role="tablist">
    {opcoes.map((o) => (
      <button key={o.v} role="tab" aria-selected={valor === o.v}
        className="aba" onClick={() => aoTrocar(o.v)} type="button">
        {o.l}
        {o.selo != null && (
          <span className="mono" style={{
            fontSize: 11, color: 'var(--tenue)', fontWeight: 500,
          }}>{o.selo}</span>
        )}
        {o.ponto && (
          <span aria-label="preenchida" style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--verde)', display: 'inline-block',
          }} />
        )}
      </button>
    ))}
  </div>
);

const Toast = ({ msg, tipo }) =>
  msg ? (
    <div className={`toast ${tipo ? `toast-${tipo}` : ''}`} role="status" aria-live="polite">
      {tipo === 'ok' && <IcoCheck size={16} />}
      {tipo === 'erro' && <IcoAviso size={16} />}
      {msg}
    </div>
  ) : null;

const Vazio = ({ ico, titulo, desc, acao }) => (
  <div className="vazio">
    {ico && <div className="vazio-ico">{ico}</div>}
    <div className="vazio-t">{titulo}</div>
    {desc && <div className="vazio-d">{desc}</div>}
    {acao}
  </div>
);

const Esqueleto = ({ h = 16, w = '100%', style }) => (
  <div className="esq" style={{ height: h, width: w, ...style }} />
);

const Modal = ({ aberto, aoFechar, titulo, children, rodape }) => {
  useEffect(() => {
    if (!aberto) return;
    const esc = (e) => e.key === 'Escape' && aoFechar();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <div className="veu" onClick={aoFechar} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="entre" style={{
          padding: 'var(--e5) var(--e5) var(--e4)',
          borderBottom: '1px solid var(--regua)',
        }}>
          <span className="tit t2">{titulo}</span>
          <button className="btn btn-3" onClick={aoFechar} aria-label="Fechar"
            style={{ padding: 6, minHeight: 32 }} type="button">
            <IcoX size={18} />
          </button>
        </div>
        <div style={{ padding: 'var(--e5)' }}>{children}</div>
        {rodape && (
          <div style={{
            padding: 'var(--e4) var(--e5)',
            borderTop: '1px solid var(--regua)',
            display: 'flex', gap: 'var(--e2)', justifyContent: 'flex-end',
          }}>{rodape}</div>
        )}
      </div>
    </div>
  );
};

/* Delta com seta e cor — usado no app e no relatório */
const Delta = ({ atual, anterior, un = '', menorMelhor = null, mostrarZero = true }) => {
  if (anterior == null || atual == null) return null;
  const d = Number(atual) - Number(anterior);
  if (Math.abs(d) < 0.05) {
    return mostrarZero
      ? <span className="delta delta-neutro">manteve</span>
      : null;
  }
  const bom = menorMelhor === null ? null : (menorMelhor ? d < 0 : d > 0);
  const classe = bom === null ? 'info' : bom ? 'bom' : 'aten';
  return (
    <span className={`delta delta-${classe}`}>
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"
        style={{ flexShrink: 0 }}>
        <path d={d > 0 ? 'M5 1 L9 8 L1 8 Z' : 'M5 9 L1 2 L9 2 Z'}
          fill="currentColor" />
      </svg>
      {Math.abs(d).toFixed(1)}{un}
    </span>
  );
};

/* Barra de faixa de classificação */
const BarraFaixa = ({ percentual, sexo }) => {
  const faixas = CLASSIFICACAO[sexo];
  const teto = TETO_ESCALA[sexo];
  const pos = Math.min(100, Math.max(0, (percentual / teto) * 100));

  return (
    <div className="faixa">
      <div className="faixa-t">
        {faixas.map((f, i) => {
          const ini = i === 0 ? 0 : faixas[i - 1].max;
          const fim = Math.min(f.max, teto);
          const larg = ((fim - ini) / teto) * 100;
          return larg > 0 ? (
            <div key={f.label} style={{ width: `${larg}%`, background: TOM_COR[f.tom] }}
              title={f.label} />
          ) : null;
        })}
      </div>
      <div className="faixa-m">
        <div className="faixa-p" style={{ left: `${pos}%` }} />
      </div>
      <div className="faixa-l">
        <span>0%</span>
        {faixas.slice(0, -1).map((f) => (
          <span key={f.label}>{f.max}%</span>
        ))}
      </div>
    </div>
  );
};

/* Gráfico de linha em SVG — sem biblioteca */
const GraficoLinha = ({ series, altura = 150 }) => {
  const validas = series.filter((s) => s.pontos.length >= 2);
  if (!validas.length) return null;

  const n = validas[0].pontos.length;
  const W = 100, H = 40, P = 3;

  const caminho = (pontos) => {
    const vals = pontos.map((p) => p.v);
    const min = Math.min(...vals), max = Math.max(...vals);
    const amp = max - min || 1;
    return pontos.map((p, i) => {
      const x = P + (i / (n - 1)) * (W - P * 2);
      const y = H - P - ((p.v - min) / amp) * (H - P * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  };

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: altura }}
        preserveAspectRatio="none" role="img" aria-label="Evolução ao longo do tempo">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={H * f} x2={W} y2={H * f}
            stroke="var(--regua)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        ))}
        {validas.map((s) => (
          <path key={s.nome} d={caminho(s.pontos)} fill="none" stroke={s.cor}
            strokeWidth={s.forte ? 1.1 : 0.8}
            strokeLinecap="round" strokeLinejoin="round"
            opacity={s.forte ? 1 : 0.72}
            vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="fila g4" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {validas.map((s) => (
          <span key={s.nome} className="fila g1" style={{ fontSize: 11.5, color: 'var(--grafite)' }}>
            <span style={{
              width: 9, height: 2, background: s.cor, borderRadius: 1, display: 'inline-block',
            }} />
            {s.nome}
          </span>
        ))}
      </div>
    </div>
  );
};

/* Rosca massa magra vs. gordura */
const Rosca = ({ magra, gorda, tam = 116 }) => {
  const total = magra + gorda;
  if (!total) return null;
  const pctG = (gorda / total) * 100;
  const R = 42, C = 2 * Math.PI * R;
  const arcoG = (pctG / 100) * C;

  return (
    <svg width={tam} height={tam} viewBox="0 0 100 100" role="img"
      aria-label={`Massa magra ${magra} kg, massa gorda ${gorda} kg`}>
      <circle cx="50" cy="50" r={R} fill="none" stroke="var(--aco)" strokeWidth="11" />
      <circle cx="50" cy="50" r={R} fill="none" stroke="var(--cobre)" strokeWidth="11"
        strokeDasharray={`${arcoG} ${C - arcoG}`}
        strokeDashoffset={C * 0.25} strokeLinecap="butt" />
      <text x="50" y="47" textAnchor="middle"
        style={{ fontSize: 15, fontWeight: 600, fill: 'var(--tinta)',
                 fontFamily: 'JetBrains Mono, monospace' }}>
        {pctG.toFixed(1)}%
      </text>
      <text x="50" y="59" textAnchor="middle"
        style={{ fontSize: 7, fill: 'var(--sombra-txt)', fontWeight: 600,
                 letterSpacing: '.06em' }}>
        GORDURA
      </text>
    </svg>
  );
};

/* ───────────────────────────────────────────────────────────────
   AVALIAÇÃO

   Tela única com seções ancoradas, não wizard.

   Motivo: a avaliação acontece de pé, na academia, com o adipômetro
   numa mão e o celular na outra. Um wizard obrigaria a navegar entre
   etapas para corrigir uma dobra medida errado. Aqui o profissional
   rola, corrige em qualquer ordem, e vê o percentual atualizar ao vivo.
   A barra de progresso dá a orientação sem tirar a liberdade.
   ─────────────────────────────────────────────────────────────── */

const suspeita = (valor, [min, max]) => {
  const v = Number(valor);
  return v > 0 && (v < min || v > max);
};

function Avaliacao({ aluno, ultima, perfil, aoSalvar, aoCancelar, toast }) {
  const chave = RASCUNHO + aluno.id;

  const inicial = () => {
    try {
      const salvo = sessionStorage.getItem(chave);
      if (salvo) return JSON.parse(salvo);
    } catch { /* rascunho corrompido: ignora */ }
    return {
      protocolo: 'pollock7',
      data: new Date().toISOString().slice(0, 10),
      peso: ultima?.peso ?? '',
      altura: ultima?.altura ?? '',
      nivelAtiv: 1.55,
      dobras: {},
      perim: {},
      obsAntro: '',
      obsPerim: '',
      obsGeral: '',
    };
  };

  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [rascunhoOk, setRascunhoOk] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);

  const idade = idadeDe(aluno.nascimento);
  const ativas = dobrasDoProtocolo(f.protocolo, aluno.sexo);

  // Auto-save do rascunho
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(chave, JSON.stringify(f));
        setRascunhoOk(true);
        setTimeout(() => setRascunhoOk(false), 1600);
      } catch { /* storage cheio: segue sem rascunho */ }
    }, 700);
    return () => clearTimeout(t);
  }, [f, chave]);

  const set = (campo, valor) => setF((x) => ({ ...x, [campo]: valor }));
  const setDobra = (k, v) => setF((x) => ({ ...x, dobras: { ...x.dobras, [k]: v } }));
  const setPerim = (k, v) => setF((x) => ({ ...x, perim: { ...x.perim, [k]: v } }));

  const resultado = useMemo(() => calcular({
    protocolo: f.protocolo, dobras: f.dobras,
    peso: Number(f.peso), altura: Number(f.altura),
    perimetros: f.perim, idade, sexo: aluno.sexo, nivelAtiv: f.nivelAtiv,
  }), [f, idade, aluno.sexo]);

  const preenchidas = ativas.filter((k) => Number(f.dobras[k]) > 0).length;
  const temBasico = Number(f.peso) > 0 && Number(f.altura) > 0;
  const progresso = Math.round(
    ((temBasico ? 1 : 0) + (preenchidas / ativas.length)) / 2 * 100
  );

  const suspeitas = [
    ...ativas.filter((k) => suspeita(f.dobras[k], [FAIXA_DOBRA.min, FAIXA_DOBRA.max])),
    ...PERIMETROS.filter((p) => suspeita(f.perim[p.k], p.faixa)).map((p) => p.k),
  ];

  const salvar = async () => {
    if (!resultado) {
      toast('Preencha peso, altura e todas as dobras do protocolo', 'erro');
      return;
    }
    setSalvando(true);
    const obs = [
      f.obsAntro && `Antropometria: ${f.obsAntro}`,
      f.obsPerim && `Perimetria: ${f.obsPerim}`,
      f.obsGeral,
    ].filter(Boolean).join('\n');

    const { error } = await supabase.from('al_avaliacoes').insert({
      aluno_id: aluno.id,
      data: f.data,
      peso: Number(f.peso),
      altura: Number(f.altura),
      protocolo: f.protocolo,
      dobras: f.dobras,
      perimetros: f.perim,
      resultados: resultado,
      observacoes: obs,
    });
    setSalvando(false);

    if (error) { toast('Não foi possível salvar. Tente de novo.', 'erro'); return; }
    sessionStorage.removeItem(chave);
    toast('Avaliação registrada', 'ok');
    aoSalvar();
  };

  const sair = () => {
    const temDados = preenchidas > 0 || f.obsGeral || f.obsAntro;
    if (temDados) { setConfirmarSaida(true); return; }
    sessionStorage.removeItem(chave);
    aoCancelar();
  };

  const descartar = () => {
    sessionStorage.removeItem(chave);
    aoCancelar();
  };

  const cls = resultado ? classificar(resultado.percentual, aluno.sexo) : null;
  const clsImc = resultado ? classificarIMC(resultado.imc) : null;
  const clsRcq = resultado?.rcq ? classificarRCQ(resultado.rcq, aluno.sexo) : null;

  return (
    <div className="pilha g5">

      <div className="prog">
        <div className="prog-t">
          <div className="prog-b" style={{ width: `${progresso}%` }} />
        </div>
        <div className="prog-l">
          <span className="fila g2">
            <button className="btn btn-3" onClick={sair} type="button"
              style={{ padding: '4px 8px', minHeight: 30, marginLeft: -8 }}>
              <IcoVolta size={16} /> Sair
            </button>
            <strong style={{ color: 'var(--tinta)', fontWeight: 600 }}>
              {aluno.nome}
            </strong>
          </span>
          <span className="fila g2">
            {rascunhoOk && (
              <span className="fila g1" style={{ color: 'var(--verde)', fontSize: 11.5 }}>
                <IcoCheck size={13} /> Rascunho salvo
              </span>
            )}
            <span className="mono">{progresso}%</span>
          </span>
        </div>
      </div>

      {/* ── Protocolo e dados básicos ── */}
      <section className="pilha g3">
        <span className="olho">Protocolo e dados básicos</span>
        <Cart>
          <div className="pilha g4">
            <Campo rot="Protocolo" dica={PROTOCOLOS[f.protocolo].resumo} id="proto">
              <select id="proto" value={f.protocolo}
                onChange={(e) => set('protocolo', e.target.value)}>
                {Object.entries(PROTOCOLOS).map(([k, v]) => (
                  <option key={k} value={k}>{v.nome}</option>
                ))}
              </select>
            </Campo>

            <div className="grade3">
              <Campo rot="Data" id="dt">
                <input id="dt" type="date" value={f.data}
                  onChange={(e) => set('data', e.target.value)} />
              </Campo>
              <Campo rot="Peso" id="pe">
                <input id="pe" className="num" type="number" step="0.1"
                  inputMode="decimal" value={f.peso} placeholder="kg"
                  onChange={(e) => set('peso', e.target.value)} />
              </Campo>
              <Campo rot="Altura" id="al">
                <input id="al" className="num" type="number" step="0.5"
                  inputMode="decimal" value={f.altura} placeholder="cm"
                  onChange={(e) => set('altura', e.target.value)} />
              </Campo>
            </div>

            <Campo rot="Nível de atividade"
              dica="Define o gasto energético total a partir da taxa metabólica basal."
              id="na">
              <select id="na" value={f.nivelAtiv}
                onChange={(e) => set('nivelAtiv', Number(e.target.value))}>
                {NIVEIS_ATIVIDADE.map((n) => (
                  <option key={n.k} value={n.k}>{n.l} — {n.d}</option>
                ))}
              </select>
            </Campo>
          </div>
        </Cart>
      </section>

      {/* ── Escala de dobras — elemento de assinatura ── */}
      <section className="pilha g3">
        <div className="entre">
          <span className="olho">Dobras cutâneas</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--sombra-txt)' }}>
            {preenchidas} de {ativas.length}
          </span>
        </div>

        <div className="escala">
          {Object.keys(LABELS_DOBRAS).map((k) => {
            const ativa = ativas.includes(k);
            const val = Number(f.dobras[k]);
            const temValor = val > 0;
            const susp = suspeita(f.dobras[k], [FAIXA_DOBRA.min, FAIXA_DOBRA.max]);
            const pos = temValor
              ? Math.min(100, Math.max(0,
                  ((val - FAIXA_DOBRA.min) / (FAIXA_DOBRA.max - FAIXA_DOBRA.min)) * 100))
              : null;

            return (
              <div key={k}
                className={`esc-lin ${!ativa ? 'off' : ''} ${ativa && temValor && !susp ? 'on' : ''} ${susp ? 'susp' : ''}`}>
                <div>
                  <div className="esc-nome">{LABELS_DOBRAS[k]}</div>
                  {ativa && (
                    <>
                      <div className="esc-regua">
                        {pos !== null && (
                          <div className={`esc-tick ${susp ? 'susp' : ''}`}
                            style={{ left: `${pos}%` }} />
                        )}
                      </div>
                      <div className="esc-sub">
                        {susp
                          ? `Fora da faixa usual de ${FAIXA_DOBRA.min} a ${FAIXA_DOBRA.max} mm. Confira.`
                          : `${FAIXA_DOBRA.min} a ${FAIXA_DOBRA.max} mm`}
                      </div>
                    </>
                  )}
                  {!ativa && <div className="esc-sub">Não usada neste protocolo</div>}
                </div>

                <div className="esc-campo">
                  <input
                    className={`num ${susp ? 'alerta' : ''}`}
                    type="number" step="0.5" inputMode="decimal"
                    disabled={!ativa}
                    value={f.dobras[k] || ''}
                    placeholder={ativa ? '0,0' : '—'}
                    aria-label={LABELS_DOBRAS[k]}
                    onChange={(e) => setDobra(k, e.target.value)} />
                  <span className="esc-un">mm</span>
                </div>
              </div>
            );
          })}
        </div>

        <Campo rot="Observações da antropometria" id="oa">
          <textarea id="oa" rows={2} value={f.obsAntro}
            placeholder="Condições da medição, aderência do aluno, o que chamou atenção"
            onChange={(e) => set('obsAntro', e.target.value)} />
        </Campo>
      </section>

      {/* ── Resultado ao vivo ── */}
      {resultado ? (
        <section className="pilha g3">
          <span className="olho">Resultado</span>
          <div className="res">
            <div className="entre" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="res-k">Gordura corporal</div>
                <div className="res-pct">
                  {resultado.percentual}<small>%</small>
                </div>
              </div>
              <div className="pilha g2" style={{ alignItems: 'flex-end' }}>
                <Selo tom={cls.tom}>{cls.label}</Selo>
                {ultima?.resultados?.percentual != null && (
                  <Delta atual={resultado.percentual}
                    anterior={ultima.resultados.percentual}
                    un="%" menorMelhor />
                )}
              </div>
            </div>

            <BarraFaixa percentual={resultado.percentual} sexo={aluno.sexo} />

            <div className="res-grade">
              <div>
                <div className="res-k">Massa magra</div>
                <div className="res-v">{resultado.massaMagra} kg</div>
              </div>
              <div>
                <div className="res-k">Massa gorda</div>
                <div className="res-v">{resultado.massaGorda} kg</div>
              </div>
              <div>
                <div className="res-k">IMC</div>
                <div className="res-v">{resultado.imc}</div>
                <div style={{ fontSize: 11, color: 'var(--sombra-txt)', marginTop: 2 }}>
                  {clsImc.label}
                </div>
              </div>
              <div>
                <div className="res-k">Somatório</div>
                <div className="res-v">{resultado.somatorio} mm</div>
              </div>
              {resultado.rcq && (
                <div>
                  <div className="res-k">Cintura / quadril</div>
                  <div className="res-v">{resultado.rcq}</div>
                  <div style={{ fontSize: 11, color: 'var(--sombra-txt)', marginTop: 2 }}>
                    {clsRcq.label}
                  </div>
                </div>
              )}
            </div>

            <div className="grade2" style={{
              marginTop: 'var(--e4)', paddingTop: 'var(--e4)',
              borderTop: '1px solid var(--aco-borda)',
            }}>
              <div className="fila g3">
                <span style={{ color: 'var(--aco)' }}><IcoRelogio size={19} /></span>
                <div>
                  <div className="res-k">Taxa basal</div>
                  <div className="res-v">{resultado.tmb} <small style={{
                    fontSize: 12, fontWeight: 500, color: 'var(--sombra-txt)',
                  }}>kcal</small></div>
                </div>
              </div>
              <div className="fila g3">
                <span style={{ color: 'var(--aco)' }}><IcoFogo size={19} /></span>
                <div>
                  <div className="res-k">Gasto total</div>
                  <div className="res-v">{resultado.get} <small style={{
                    fontSize: 12, fontWeight: 500, color: 'var(--sombra-txt)',
                  }}>kcal</small></div>
                </div>
              </div>
            </div>
            <div className="dica" style={{ marginTop: 'var(--e2)' }}>
              Taxa basal por Cunningham, a partir da massa magra. Gasto total
              aplica o fator de {resultado.fatorAtiv} do nível de atividade.
            </div>
          </div>
        </section>
      ) : (
        <Cart>
          <div className="fila g3" style={{ color: 'var(--sombra-txt)' }}>
            <IcoRegua size={20} />
            <span style={{ fontSize: 14 }}>
              O resultado aparece assim que peso, altura e as
              {' '}{ativas.length} dobras do protocolo estiverem preenchidos.
            </span>
          </div>
        </Cart>
      )}

      {/* ── Perimetria ── */}
      <section className="pilha g3">
        <span className="olho">Perimetria</span>
        <Cart>
          <div className="pilha g5">
            {GRUPOS_PERIM.map((g) => (
              <div key={g.id} className="pilha g3">
                <span style={{
                  fontSize: 12.5, fontWeight: 600, color: 'var(--grafite)',
                }}>{g.l}</span>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill,minmax(126px,1fr))',
                  gap: 'var(--e3)',
                }}>
                  {PERIMETROS.filter((p) => p.g === g.id).map((p) => {
                    const susp = suspeita(f.perim[p.k], p.faixa);
                    const ant = ultima?.perimetros?.[p.k];
                    return (
                      <div key={p.k} className="pilha g1">
                        <label className="dica" htmlFor={`pm-${p.k}`}
                          style={{ fontWeight: 500, color: 'var(--grafite)' }}>
                          {p.l}
                        </label>
                        <div className="fila g2">
                          <input
                            id={`pm-${p.k}`}
                            className={`num ${susp ? 'alerta' : ''}`}
                            type="number" step="0.5" inputMode="decimal"
                            value={f.perim[p.k] || ''} placeholder="—"
                            onChange={(e) => setPerim(p.k, e.target.value)}
                            style={{ padding: '9px 10px' }} />
                        </div>
                        {Number(f.perim[p.k]) > 0 && ant > 0 && (
                          <Delta atual={f.perim[p.k]} anterior={ant} un=""
                            menorMelhor={p.g === 'central'} mostrarZero={false} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <Campo rot="Observações da perimetria" id="op">
              <textarea id="op" rows={2} value={f.obsPerim}
                placeholder="Assimetrias, pontos de referência, o que observar na próxima"
                onChange={(e) => set('obsPerim', e.target.value)} />
            </Campo>
          </div>
        </Cart>
      </section>

      {/* ── Recomendações ── */}
      <section className="pilha g3">
        <span className="olho">Recomendações ao aluno</span>
        <Cart>
          <Campo dica="Este texto vai no relatório que o aluno recebe." id="og">
            <textarea id="og" rows={4} value={f.obsGeral}
              placeholder="O que ele deve priorizar até a próxima avaliação"
              onChange={(e) => set('obsGeral', e.target.value)} />
          </Campo>
        </Cart>
      </section>

      {suspeitas.length > 0 && (
        <div className="aviso aviso-alerta fila g3">
          <IcoAviso size={18} />
          <span>
            {suspeitas.length === 1
              ? 'Uma medida está fora da faixa usual.'
              : `${suspeitas.length} medidas estão fora da faixa usual.`}
            {' '}Confira antes de salvar. Você pode salvar mesmo assim.
          </span>
        </div>
      )}

      <div className="fila g3" style={{ paddingBottom: 'var(--e6)' }}>
        <Btn variante="2" onClick={sair} type="button">Cancelar</Btn>
        <Btn variante="1" tam="g" cheio onClick={salvar}
          disabled={!resultado} carregando={salvando} type="button">
          Salvar avaliação
        </Btn>
      </div>

      <Modal aberto={confirmarSaida} aoFechar={() => setConfirmarSaida(false)}
        titulo="Sair sem salvar?"
        rodape={<>
          <Btn variante="2" onClick={() => setConfirmarSaida(false)}>Continuar aqui</Btn>
          <Btn variante="x" onClick={descartar}>Descartar</Btn>
        </>}>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--grafite)' }}>
          O rascunho fica guardado enquanto esta aba estiver aberta.
          Se descartar, as medidas desta avaliação se perdem.
        </p>
      </Modal>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   RELATÓRIO

   A4, impresso via navegador. Sem biblioteca de PDF: mantém o
   arquivo leve o bastante para mandar no WhatsApp, e o profissional
   escolhe "Salvar como PDF" na própria janela de impressão.

   Tipografia e cores herdadas do app — é o mesmo objeto, não um
   documento gerado por script à parte.
   ─────────────────────────────────────────────────────────────── */

function gerarRelatorio({ aluno, perfil, avaliacoes, anamnese }) {
  const ultima   = avaliacoes[0];
  const anterior = avaliacoes[1] || null;
  const primeira = avaliacoes[avaliacoes.length - 1];
  const r        = ultima.resultados || {};
  const cls      = classificar(r.percentual, aluno.sexo);
  const idade    = idadeDe(aluno.nascimento);
  const temHist  = avaliacoes.length > 1;

  const data = (d) => new Date(d + 'T12:00').toLocaleDateString('pt-BR');
  const num  = (v, casas = 1) => Number(v).toFixed(casas).replace('.', ',');

  /* ── Sumário executivo: os destaques que o profissional
        diria em voz alta ao entregar o relatório. ── */
  const destaques = [];

  if (anterior?.resultados) {
    const a = anterior.resultados;
    const dPct = r.percentual - a.percentual;
    const dMag = r.massaMagra - a.massaMagra;
    const dGor = r.massaGorda - a.massaGorda;
    const dPeso = ultima.peso - anterior.peso;

    if (Math.abs(dPct) >= 0.3) {
      destaques.push({
        v: `${dPct > 0 ? '+' : '−'}${num(Math.abs(dPct))} pt`,
        t: 'Gordura corporal',
        d: dPct < 0 ? 'Redução desde a última avaliação' : 'Aumento desde a última avaliação',
        bom: dPct < 0,
      });
    }
    if (Math.abs(dMag) >= 0.2) {
      destaques.push({
        v: `${dMag > 0 ? '+' : '−'}${num(Math.abs(dMag))} kg`,
        t: 'Massa magra',
        d: dMag > 0 ? 'Ganho de massa livre de gordura' : 'Perda de massa livre de gordura',
        bom: dMag > 0,
      });
    }
    if (Math.abs(dGor) >= 0.2) {
      destaques.push({
        v: `${dGor > 0 ? '+' : '−'}${num(Math.abs(dGor))} kg`,
        t: 'Massa gorda',
        d: dGor < 0 ? 'Redução de gordura absoluta' : 'Aumento de gordura absoluta',
        bom: dGor < 0,
      });
    }
    // Recomposição: perdeu gordura e ganhou músculo ao mesmo tempo
    if (dGor < -0.3 && dMag > 0.2) {
      destaques.push({
        v: 'Recomposição',
        t: 'Perdeu gordura e ganhou músculo',
        d: 'Aconteceu ao mesmo tempo. É o cenário mais difícil e o mais valioso.',
        bom: true, largo: true,
      });
    }
    if (Math.abs(dPeso) >= 0.5 && destaques.length < 4) {
      destaques.push({
        v: `${dPeso > 0 ? '+' : '−'}${num(Math.abs(dPeso))} kg`,
        t: 'Peso',
        d: 'Variação na balança',
        bom: null,
      });
    }
  }

  if (!destaques.length) {
    destaques.push({
      v: `${num(r.percentual)}%`, t: 'Gordura corporal',
      d: `Classificação: ${cls.label.toLowerCase()} para ${idade} anos`, bom: null,
    });
    destaques.push({
      v: `${num(r.massaMagra)} kg`, t: 'Massa magra',
      d: 'Ponto de partida para as próximas avaliações', bom: null,
    });
    destaques.push({
      v: `${r.get}`, t: 'Gasto energético diário',
      d: 'Estimativa em quilocalorias, incluindo o nível de atividade', bom: null,
    });
  }

  /* ── Rosca ── */
  const pctG = (r.massaGorda / (r.massaGorda + r.massaMagra)) * 100;
  const C = 2 * Math.PI * 42;
  const arcoG = (pctG / 100) * C;

  const rosca = `
    <svg width="132" height="132" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="42" fill="none" stroke="#2F5D62" stroke-width="12"/>
      <circle cx="50" cy="50" r="42" fill="none" stroke="#B5654A" stroke-width="12"
        stroke-dasharray="${arcoG.toFixed(2)} ${(C - arcoG).toFixed(2)}"
        stroke-dashoffset="${(C * 0.25).toFixed(2)}"/>
      <text x="50" y="47" text-anchor="middle"
        style="font:600 15px 'JetBrains Mono',monospace;fill:#16181A">
        ${num(pctG)}%
      </text>
      <text x="50" y="59" text-anchor="middle"
        style="font:600 6.5px Inter,sans-serif;fill:#878C92;letter-spacing:.5px">
        GORDURA
      </text>
    </svg>`;

  /* ── Barra de classificação ── */
  const faixas = CLASSIFICACAO[aluno.sexo];
  const teto = TETO_ESCALA[aluno.sexo];
  const pos = Math.min(100, (r.percentual / teto) * 100);

  const barraFaixa = `
    <div class="fx">
      <div class="fx-t">
        ${faixas.map((fa, i) => {
          const ini = i === 0 ? 0 : faixas[i - 1].max;
          const larg = ((Math.min(fa.max, teto) - ini) / teto) * 100;
          return larg > 0
            ? `<div style="width:${larg}%;background:${TOM_COR[fa.tom]}"></div>` : '';
        }).join('')}
      </div>
      <div class="fx-m"><div class="fx-p" style="left:${pos}%"></div></div>
      <div class="fx-l">
        <span>0%</span>
        ${faixas.slice(0, -1).map((fa) => `<span>${fa.max}%</span>`).join('')}
      </div>
      <div class="fx-n">
        ${faixas.map((fa) => `
          <span class="fx-i">
            <i style="background:${TOM_COR[fa.tom]}"></i>${fa.label}
          </span>`).join('')}
      </div>
    </div>`;

  /* ── Silhueta com os pontos medidos ──
        Não é decoração: cada ponto marcado é uma medida que existe
        neste relatório. O aluno vê onde foi medido. ── */
  const PONTOS_SILHUETA = {
    ombro:           { x: 50, y: 22, lado: 'e' },
    torax:           { x: 50, y: 31, lado: 'd' },
    bracoD:          { x: 30, y: 34, lado: 'e' },
    bracoE:          { x: 70, y: 34, lado: 'd' },
    bracoContraidoD: { x: 27, y: 40, lado: 'e' },
    bracoContraidoE: { x: 73, y: 40, lado: 'd' },
    antebracoD:      { x: 25, y: 48, lado: 'e' },
    antebracoE:      { x: 75, y: 48, lado: 'd' },
    cintura:         { x: 50, y: 42, lado: 'e' },
    abdomen:         { x: 50, y: 48, lado: 'd' },
    quadril:         { x: 50, y: 55, lado: 'e' },
    coxaD:           { x: 41, y: 68, lado: 'e' },
    coxaE:           { x: 59, y: 68, lado: 'd' },
    panturrilhaD:    { x: 41, y: 85, lado: 'e' },
    panturrilhaE:    { x: 59, y: 85, lado: 'd' },
  };

  const medidos = PERIMETROS.filter((p) => Number(ultima.perimetros?.[p.k]) > 0);

  const silhueta = medidos.length ? `
    <svg viewBox="0 0 100 105" class="silh" role="img"
      aria-label="Pontos medidos no corpo">
      <!-- corpo -->
      <g fill="none" stroke="#CBD0CD" stroke-width="1.1"
         stroke-linecap="round" stroke-linejoin="round">
        <circle cx="50" cy="10" r="6"/>
        <path d="M50 16v6"/>
        <path d="M35 24 Q50 20 65 24 L67 44 Q50 48 33 44 Z"/>
        <path d="M35 24 L28 34 L25 52 M65 24 L72 34 L75 52"/>
        <path d="M33 44 Q50 46 67 44 L64 58 Q50 61 36 58 Z"/>
        <path d="M40 60 L38 82 L37 98 M60 60 L62 82 L63 98"/>
      </g>
      <!-- pontos medidos -->
      ${medidos.map((p) => {
        const pt = PONTOS_SILHUETA[p.k];
        if (!pt) return '';
        return `
        <g>
          <circle cx="${pt.x}" cy="${pt.y}" r="2.4" fill="#2F5D62"/>
          <circle cx="${pt.x}" cy="${pt.y}" r="4.4" fill="none"
            stroke="#2F5D62" stroke-width=".6" opacity=".35"/>
        </g>`;
      }).join('')}
    </svg>` : '';

  /* ── Gráfico de evolução ── */
  const graficoEvolucao = temHist ? (() => {
    const pts = [...avaliacoes].reverse()
      .filter((a) => a.resultados?.percentual != null);
    if (pts.length < 2) return '';

    const W = 300, H = 88, P = 10;
    const linha = (getter, cor, forte) => {
      const vals = pts.map(getter);
      const min = Math.min(...vals), max = Math.max(...vals);
      const amp = max - min || 1;
      const d = pts.map((p, i) => {
        const x = P + (i / (pts.length - 1)) * (W - P * 2);
        const y = H - P - ((getter(p) - min) / amp) * (H - P * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const pontos = pts.map((p, i) => {
        const x = P + (i / (pts.length - 1)) * (W - P * 2);
        const y = H - P - ((getter(p) - min) / amp) * (H - P * 2);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2"
          fill="#fff" stroke="${cor}" stroke-width="1.4"/>`;
      }).join('');
      return `<path d="${d}" fill="none" stroke="${cor}"
        stroke-width="${forte ? 1.8 : 1.3}" stroke-linecap="round"
        stroke-linejoin="round" opacity="${forte ? 1 : .7}"/>${pontos}`;
    };

    return `
    <section class="bloco">
      <h2>Evolução</h2>
      <svg viewBox="0 0 ${W} ${H}" class="graf">
        ${[0.25, 0.5, 0.75].map((fr) =>
          `<line x1="${P}" y1="${H * fr}" x2="${W - P}" y2="${H * fr}"
            stroke="#E2E5E3" stroke-width=".5"/>`).join('')}
        ${linha((p) => p.resultados.massaMagra, '#2F5D62', false)}
        ${linha((p) => p.resultados.percentual, '#B5654A', true)}
      </svg>
      <div class="leg">
        <span class="leg-i"><i style="background:#B5654A"></i>Gordura corporal (%)</span>
        <span class="leg-i"><i style="background:#2F5D62"></i>Massa magra (kg)</span>
      </div>
      <div class="graf-d">
        <span>${data(primeira.data)}</span>
        <span>${data(ultima.data)}</span>
      </div>
    </section>`;
  })() : '';

  /* ── Comparativo ── */
  const tabelaEvolucao = temHist ? `
    <section class="bloco">
      <h2>Comparativo com a primeira avaliação</h2>
      <table class="tb">
        <thead>
          <tr>
            <th>Indicador</th>
            <th class="dir">${data(primeira.data)}</th>
            <th class="dir">Hoje</th>
            <th class="dir">Variação</th>
          </tr>
        </thead>
        <tbody>
          ${[
            ['Gordura corporal', primeira.resultados.percentual, r.percentual, '%', true],
            ['Massa magra', primeira.resultados.massaMagra, r.massaMagra, ' kg', false],
            ['Massa gorda', primeira.resultados.massaGorda, r.massaGorda, ' kg', true],
            ['Peso', primeira.peso, ultima.peso, ' kg', null],
            ['IMC', primeira.resultados.imc, r.imc, '', null],
          ].map(([nome, ini, fim, un, menorMelhor]) => {
            const d = Number(fim) - Number(ini);
            const bom = menorMelhor === null ? null : (menorMelhor ? d < 0 : d > 0);
            const cor = bom === null ? '' : bom ? 'ok' : 'at';
            const sinal = d > 0 ? '+' : '−';
            return `
            <tr>
              <td>${nome}</td>
              <td class="dir mn tenue">${num(ini)}${un}</td>
              <td class="dir mn forte">${num(fim)}${un}</td>
              <td class="dir"><span class="dl ${cor}">${sinal}${num(Math.abs(d))}${un}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>` : '';

  /* ── Perimetria ── */
  const CENTRAIS = ['cintura', 'abdomen', 'quadril'];

  const tabelaPerimetria = medidos.length ? `
    <section class="bloco quebra">
      <h2>Perimetria</h2>
      <div class="perim">
        <div class="perim-svg">
          ${silhueta}
          <div class="perim-cap">${medidos.length} pontos medidos</div>
        </div>
        <table class="tb">
          <thead>
            <tr>
              <th>Ponto</th>
              ${anterior ? `<th class="dir">Anterior</th>` : ''}
              <th class="dir">Atual</th>
              ${anterior ? `<th class="dir">Variação</th>` : ''}
            </tr>
          </thead>
          <tbody>
            ${medidos.map((p) => {
              const v = Number(ultima.perimetros[p.k]);
              const va = Number(anterior?.perimetros?.[p.k]);
              let cel = '';
              if (anterior) {
                if (va > 0) {
                  const d = v - va;
                  if (Math.abs(d) < 0.05) {
                    cel = `<td class="dir"><span class="dl">=</span></td>`;
                  } else {
                    const central = CENTRAIS.includes(p.k);
                    const bom = central ? d < 0 : d > 0;
                    cel = `<td class="dir"><span class="dl ${bom ? 'ok' : 'nt'}">
                      ${d > 0 ? '+' : '−'}${num(Math.abs(d))}</span></td>`;
                  }
                } else {
                  cel = `<td class="dir tenue">—</td>`;
                }
              }
              return `
              <tr>
                <td>${p.l}</td>
                ${anterior ? `<td class="dir mn tenue">${va > 0 ? num(va) : '—'}</td>` : ''}
                <td class="dir mn forte">${num(v)}</td>
                ${cel}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${r.rcq ? `
      <div class="rcq">
        <div>
          <div class="rcq-k">Relação cintura / quadril</div>
          <div class="rcq-d">${classificarRCQ(r.rcq, aluno.sexo).label} conforme referência da OMS</div>
        </div>
        <div class="rcq-v">${num(r.rcq, 2)}</div>
      </div>` : ''}
    </section>` : '';

  /* ── Dobras ── */
  const dobras = Object.entries(ultima.dobras || {}).filter(([, v]) => Number(v) > 0);

  const tabelaDobras = `
    <section class="bloco">
      <h2>Dobras cutâneas</h2>
      <p class="nota">Protocolo ${PROTOCOLOS[ultima.protocolo]?.nome}.
        Densidade convertida em percentual pela equação de Siri.</p>
      <table class="tb">
        <tbody>
          ${dobras.map(([k, v]) => `
            <tr>
              <td>${LABELS_DOBRAS[k]}</td>
              <td class="dir mn forte">${num(v)} <em>mm</em></td>
            </tr>`).join('')}
          <tr class="soma">
            <td>Somatório</td>
            <td class="dir mn forte">${num(r.somatorio)} <em>mm</em></td>
          </tr>
        </tbody>
      </table>
    </section>`;

  /* ── Anamnese ── */
  const parqPositivos = anamnese
    ? ANAMNESE[0].itens.filter((i) => anamnese.respostas[i.k] === 'Sim')
    : [];

  const fichaSaude = anamnese ? `
    <section class="bloco quebra">
      <h2>Ficha de saúde</h2>
      ${parqPositivos.length ? `
        <div class="marca-alerta">
          <div class="ma-t">Atenção — ${parqPositivos.length}
            ${parqPositivos.length === 1 ? 'ponto' : 'pontos'} a observar</div>
          <ul>${parqPositivos.map((i) => `<li>${i.q}</li>`).join('')}</ul>
          <div class="ma-r">Recomenda-se liberação médica antes de iniciar o programa.</div>
        </div>` : `
        <div class="marca-ok">
          Questionário de prontidão (PAR-Q) sem restrições relatadas.
        </div>`}
      <div class="qa">
        ${ANAMNESE.slice(1).flatMap((s) => s.itens).map((it) => {
          const v = anamnese.respostas[it.k];
          if (!v || (Array.isArray(v) && !v.length)) return '';
          return `
          <div class="qa-i">
            <div class="qa-q">${it.q}</div>
            <div class="qa-a">${Array.isArray(v) ? v.join(', ') : v}</div>
          </div>`;
        }).join('')}
      </div>
    </section>` : '';

  /* ── Recomendações ── */
  const recomendacoes = ultima.observacoes ? `
    <section class="bloco">
      <h2>Recomendações do profissional</h2>
      <div class="reco">${ultima.observacoes.replace(/\n/g, '<br>')}</div>
    </section>` : '';

  /* ── HTML ── */
  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Avaliação física — ${aluno.nome}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  @page{size:A4;margin:0}

  *{margin:0;padding:0;box-sizing:border-box}

  body{
    font-family:'Inter',-apple-system,'Segoe UI',sans-serif;
    font-size:11.5px;line-height:1.55;color:#16181A;background:#F2F3F1;
    -webkit-font-smoothing:antialiased;
  }

  .pg{
    width:210mm;min-height:297mm;background:#fff;
    margin:0 auto;padding:17mm 16mm 15mm;
    position:relative;page-break-after:always;
    display:flex;flex-direction:column;
  }
  .pg:last-child{page-break-after:auto}

  .disp{font-family:'Instrument Sans',sans-serif;letter-spacing:-.018em}
  .mn{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
  .forte{font-weight:600}
  .tenue{color:#AEB3B7}
  .dir{text-align:right}

  /* ── CAPA ── */
  .capa{justify-content:space-between}

  .capa-topo{display:flex;justify-content:space-between;align-items:flex-start}
  .logo{max-height:52px;max-width:150px;object-fit:contain}
  .marca{
    font-family:'Instrument Sans',sans-serif;font-weight:600;
    font-size:15px;letter-spacing:.11em;text-transform:uppercase;
  }
  .marca em{font-style:normal;color:#2F5D62}
  .capa-tag{
    font-size:9.5px;font-weight:600;color:#878C92;
    text-transform:uppercase;letter-spacing:.13em;text-align:right;
  }

  .capa-meio{padding:22mm 0}
  .capa-olho{
    font-size:10px;font-weight:600;color:#878C92;
    text-transform:uppercase;letter-spacing:.14em;margin-bottom:10px;
  }
  .capa-nome{
    font-family:'Instrument Sans',sans-serif;font-weight:600;
    font-size:38px;line-height:1.12;letter-spacing:-.028em;margin-bottom:14px;
  }
  .capa-meta{
    display:flex;gap:22px;font-size:12px;color:#55595E;
    padding-top:14px;border-top:1px solid #E2E5E3;
  }
  .capa-meta b{color:#16181A;font-weight:600}

  .capa-rod{
    display:flex;justify-content:space-between;align-items:flex-end;
    padding-top:16px;border-top:2px solid #16181A;
  }
  .capa-prof{font-size:11.5px;line-height:1.6}
  .capa-prof b{font-size:13px;font-weight:600}
  .capa-prof span{color:#878C92}
  .capa-data{font-size:10.5px;color:#878C92;text-align:right;line-height:1.6}

  /* ── Blocos ── */
  .bloco{margin-bottom:9mm}
  .bloco:last-child{margin-bottom:0}
  .quebra{page-break-inside:avoid}

  h2{
    font-family:'Instrument Sans',sans-serif;
    font-size:10px;font-weight:600;text-transform:uppercase;
    letter-spacing:.13em;color:#878C92;
    padding-bottom:7px;margin-bottom:13px;
    border-bottom:1px solid #E2E5E3;
  }
  .nota{font-size:10.5px;color:#878C92;margin:-6px 0 12px;line-height:1.5}

  /* ── Sumário ── */
  .dest{display:grid;grid-template-columns:1fr 1fr;gap:9px}
  .dest-c{
    border:1px solid #E2E5E3;border-radius:9px;padding:13px 14px;
    border-left:3px solid #CBD0CD;
  }
  .dest-c.ok{border-left-color:#2F7A63;background:#FAFDFB}
  .dest-c.at{border-left-color:#B58A3C;background:#FEFCF8}
  .dest-c.largo{grid-column:1 / -1}
  .dest-v{
    font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;
    font-size:22px;font-weight:600;line-height:1.1;letter-spacing:-.02em;
  }
  .dest-c.ok .dest-v{color:#2F7A63}
  .dest-c.at .dest-v{color:#8E6B27}
  .dest-c.largo .dest-v{font-size:17px;font-family:'Instrument Sans',sans-serif}
  .dest-t{font-size:11.5px;font-weight:600;margin-top:4px}
  .dest-d{font-size:10.5px;color:#878C92;margin-top:2px;line-height:1.45}

  /* ── Composição ── */
  .comp{display:flex;gap:20px;align-items:center}
  .comp-esq{flex-shrink:0;text-align:center}
  .comp-leg{
    display:flex;gap:12px;justify-content:center;margin-top:9px;
    font-size:10px;color:#55595E;
  }
  .comp-leg span{display:flex;align-items:center;gap:4px}
  .comp-leg i{width:8px;height:8px;border-radius:2px;display:inline-block}

  .comp-dir{flex:1}
  .comp-pct{
    font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;
    font-size:44px;font-weight:600;line-height:1;letter-spacing:-.03em;
  }
  .comp-pct small{font-size:20px;font-weight:500}
  .tag{
    display:inline-block;padding:3px 11px;border-radius:20px;
    font-size:10.5px;font-weight:600;border:1.5px solid;margin-top:7px;
  }

  /* Faixa */
  .fx{margin-top:14px}
  .fx-t{display:flex;height:7px;border-radius:4px;overflow:hidden}
  .fx-t > div{height:100%}
  .fx-m{position:relative;height:13px}
  .fx-p{
    position:absolute;top:0;transform:translateX(-50%);
    width:2.5px;height:13px;background:#16181A;border-radius:2px;
    box-shadow:0 0 0 2px #fff;
  }
  .fx-l{
    display:flex;justify-content:space-between;
    font-size:8.5px;color:#AEB3B7;font-weight:600;
  }
  .fx-n{
    display:flex;gap:9px;flex-wrap:wrap;margin-top:9px;
    font-size:9.5px;color:#55595E;
  }
  .fx-i{display:flex;align-items:center;gap:3px}
  .fx-i i{width:7px;height:7px;border-radius:2px;display:inline-block}

  /* Números */
  .nums{
    display:grid;grid-template-columns:repeat(4,1fr);gap:12px;
    margin-top:15px;padding-top:13px;border-top:1px solid #E2E5E3;
  }
  .num-k{
    font-size:9px;color:#878C92;text-transform:uppercase;
    letter-spacing:.08em;font-weight:600;
  }
  .num-v{
    font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;
    font-size:16px;font-weight:600;margin-top:2px;
  }
  .num-d{font-size:9.5px;color:#878C92;margin-top:1px}

  /* ── Energia ── */
  .ener{
    display:grid;grid-template-columns:1fr 1fr;gap:12px;
    background:#F7F9F9;border:1px solid #DCE5E5;border-radius:9px;
    padding:14px 16px;margin-top:12px;
  }
  .ener-k{
    font-size:9px;color:#878C92;text-transform:uppercase;
    letter-spacing:.08em;font-weight:600;
  }
  .ener-v{
    font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;
    font-size:19px;font-weight:600;color:#2F5D62;margin-top:2px;
  }
  .ener-v small{font-size:11px;color:#878C92;font-weight:500}
  .ener-d{font-size:9.5px;color:#878C92;margin-top:3px;line-height:1.4}

  /* ── Tabelas ── */
  .tb{width:100%;border-collapse:collapse;font-size:11px}
  .tb th{
    text-align:left;font-size:9px;font-weight:600;color:#878C92;
    text-transform:uppercase;letter-spacing:.08em;
    padding:0 8px 7px;border-bottom:1px solid #E2E5E3;
  }
  .tb th.dir{text-align:right}
  .tb td{padding:7px 8px;border-bottom:1px solid #F2F3F1;vertical-align:middle}
  .tb tbody tr:last-child td{border-bottom:0}
  .tb td em{font-size:9px;color:#AEB3B7;font-style:normal;font-weight:500}
  .tb .soma td{
    border-top:1.5px solid #16181A;border-bottom:0;
    padding-top:8px;font-weight:600;
  }

  .dl{
    display:inline-block;font-family:'JetBrains Mono',monospace;
    font-variant-numeric:tabular-nums;font-size:10px;font-weight:600;
    padding:2px 7px;border-radius:10px;
    background:#F2F3F1;color:#878C92;min-width:46px;text-align:center;
  }
  .dl.ok{background:#EAF4F0;color:#2F7A63}
  .dl.at{background:#FBF4E7;color:#8E6B27}
  .dl.nt{background:#EAF1F1;color:#2F5D62}

  /* ── Perimetria ── */
  .perim{display:flex;gap:18px;align-items:flex-start}
  .perim-svg{flex-shrink:0;width:96px;text-align:center}
  .silh{width:96px;height:100px}
  .perim-cap{
    font-size:9px;color:#AEB3B7;margin-top:5px;
    font-weight:600;letter-spacing:.03em;
  }
  .perim .tb{flex:1}

  .rcq{
    display:flex;justify-content:space-between;align-items:center;
    margin-top:13px;padding-top:12px;border-top:1px solid #E2E5E3;
  }
  .rcq-k{
    font-size:9px;color:#878C92;text-transform:uppercase;
    letter-spacing:.08em;font-weight:600;
  }
  .rcq-d{font-size:10.5px;color:#55595E;margin-top:2px}
  .rcq-v{
    font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;
    font-size:24px;font-weight:600;
  }

  /* ── Gráfico ── */
  .graf{width:100%;height:88px}
  .leg{display:flex;gap:14px;margin-top:8px;font-size:10px;color:#55595E}
  .leg-i{display:flex;align-items:center;gap:4px}
  .leg-i i{width:9px;height:2.5px;border-radius:1px;display:inline-block}
  .graf-d{
    display:flex;justify-content:space-between;
    font-size:9.5px;color:#AEB3B7;margin-top:3px;
  }

  /* ── Saúde ── */
  .marca-alerta{
    background:#FBF4E7;border:1px solid #E8D5AA;border-left:3px solid #B58A3C;
    border-radius:8px;padding:12px 14px;margin-bottom:14px;
  }
  .ma-t{font-size:11.5px;font-weight:600;color:#7A5C21;margin-bottom:6px}
  .marca-alerta ul{margin:0 0 8px 16px;font-size:10.5px;color:#6B5426;line-height:1.5}
  .marca-alerta li{margin-bottom:3px}
  .ma-r{font-size:10.5px;font-weight:600;color:#7A5C21}

  .marca-ok{
    background:#EAF4F0;border:1px solid #BFDDD1;border-left:3px solid #2F7A63;
    border-radius:8px;padding:11px 14px;margin-bottom:14px;
    font-size:11px;color:#1F5A48;font-weight:500;
  }

  .qa{
    display:grid;grid-template-columns:1fr 1fr;
    gap:0 18px;
  }
  .qa-i{padding:8px 0;border-bottom:1px solid #F2F3F1}
  .qa-q{font-size:10px;color:#878C92;line-height:1.4}
  .qa-a{font-size:11.5px;font-weight:600;margin-top:2px;line-height:1.4}

  /* ── Recomendações ── */
  .reco{
    font-size:12px;line-height:1.65;color:#16181A;
    background:#FAFAF8;border:1px solid #E2E5E3;border-radius:9px;
    padding:14px 16px;
  }

  /* ── Rodapé ── */
  .rod{
    margin-top:auto;padding-top:11px;border-top:1px solid #E2E5E3;
    display:flex;justify-content:space-between;align-items:flex-end;
    font-size:9px;color:#AEB3B7;line-height:1.5;
  }
  .rod b{color:#878C92;font-weight:600}
  .rod-p{
    font-family:'JetBrains Mono',monospace;
    font-size:9px;font-weight:600;color:#878C92;
  }

  .glos{
    font-size:9.5px;color:#878C92;line-height:1.6;
    padding-top:11px;margin-top:11px;border-top:1px solid #E2E5E3;
  }
  .glos b{color:#55595E;font-weight:600}

  @media print{
    body{background:#fff}
    .pg{margin:0;box-shadow:none;width:auto;min-height:auto;padding:15mm 16mm}
    .quebra{break-inside:avoid}
  }
  @media screen{
    .pg{box-shadow:0 4px 24px rgba(0,0,0,.09);margin-bottom:16px}
    body{padding:16px 0}
  }
</style></head><body>

<!-- ══════════ PÁGINA 1 — CAPA E SUMÁRIO ══════════ -->
<div class="pg capa">
  <div class="capa-topo">
    ${perfil.logo_url
      ? `<img src="${perfil.logo_url}" class="logo" alt="">`
      : `<div class="marca">Avalia<em>Lab</em></div>`}
    <div class="capa-tag">
      Avaliação física<br>e composição corporal
    </div>
  </div>

  <div class="capa-meio">
    <div class="capa-olho">Relatório individual</div>
    <div class="capa-nome">${aluno.nome}</div>
    <div class="capa-meta">
      <span><b>${data(ultima.data)}</b></span>
      <span>${idade} anos</span>
      <span>${aluno.sexo === 'F' ? 'Feminino' : 'Masculino'}</span>
      <span>${PROTOCOLOS[ultima.protocolo]?.nome}</span>
    </div>
  </div>

  <section class="bloco">
    <h2>Sumário executivo</h2>
    <div class="dest">
      ${destaques.slice(0, 5).map((d) => `
        <div class="dest-c ${d.bom === true ? 'ok' : d.bom === false ? 'at' : ''} ${d.largo ? 'largo' : ''}">
          <div class="dest-v">${d.v}</div>
          <div class="dest-t">${d.t}</div>
          <div class="dest-d">${d.d}</div>
        </div>`).join('')}
    </div>
  </section>

  <div class="capa-rod">
    <div class="capa-prof">
      <b>${perfil.nome || 'Profissional'}</b><br>
      ${perfil.cref ? `<span>CREF ${perfil.cref}</span><br>` : ''}
      ${perfil.telefone ? `<span>${perfil.telefone}</span>` : ''}
    </div>
    <div class="capa-data">
      Emitido em ${new Date().toLocaleDateString('pt-BR')}<br>
      Página <span class="rod-p">1</span> de <span class="rod-p">${anamnese ? 3 : 2}</span>
    </div>
  </div>
</div>

<!-- ══════════ PÁGINA 2 — COMPOSIÇÃO ══════════ -->
<div class="pg">
  <section class="bloco">
    <h2>Composição corporal</h2>
    <div class="comp">
      <div class="comp-esq">
        ${rosca}
        <div class="comp-leg">
          <span><i style="background:#2F5D62"></i>Massa magra</span>
          <span><i style="background:#B5654A"></i>Massa gorda</span>
        </div>
      </div>
      <div class="comp-dir">
        <div class="num-k">Gordura corporal</div>
        <div class="comp-pct" style="color:${TOM_COR[cls.tom]}">
          ${num(r.percentual)}<small>%</small>
        </div>
        <span class="tag" style="border-color:${TOM_COR[cls.tom]};color:${TOM_COR[cls.tom]}">
          ${cls.label}
        </span>
        ${barraFaixa}
      </div>
    </div>

    <div class="nums">
      <div>
        <div class="num-k">Massa magra</div>
        <div class="num-v">${num(r.massaMagra)} kg</div>
        <div class="num-d">músculo, ossos, órgãos</div>
      </div>
      <div>
        <div class="num-k">Massa gorda</div>
        <div class="num-v">${num(r.massaGorda)} kg</div>
        <div class="num-d">tecido adiposo</div>
      </div>
      <div>
        <div class="num-k">Peso</div>
        <div class="num-v">${num(ultima.peso)} kg</div>
        <div class="num-d">${num(ultima.altura, 0)} cm de altura</div>
      </div>
      <div>
        <div class="num-k">IMC</div>
        <div class="num-v">${num(r.imc)}</div>
        <div class="num-d">${classificarIMC(r.imc).label.toLowerCase()}</div>
      </div>
    </div>

    <div class="ener">
      <div>
        <div class="ener-k">Taxa metabólica basal</div>
        <div class="ener-v">${r.tmb} <small>kcal/dia</small></div>
        <div class="ener-d">O que o corpo gasta em repouso absoluto.</div>
      </div>
      <div>
        <div class="ener-k">Gasto energético total</div>
        <div class="ener-v">${r.get} <small>kcal/dia</small></div>
        <div class="ener-d">Já considerando seu nível de atividade.</div>
      </div>
    </div>
  </section>

  ${tabelaDobras}
  ${graficoEvolucao}
  ${tabelaEvolucao}

  <div class="rod">
    <div>
      <b>${aluno.nome}</b> &middot; Avaliação de ${data(ultima.data)}
    </div>
    <div class="rod-p">2 / ${anamnese ? 3 : 2}</div>
  </div>
</div>

<!-- ══════════ PÁGINA 3 — PERIMETRIA E SAÚDE ══════════ -->
<div class="pg">
  ${tabelaPerimetria}
  ${fichaSaude}
  ${recomendacoes}

  <div class="glos">
    <b>Massa magra</b> é tudo que não é gordura: músculo, ossos, órgãos e água.
    Ganhar massa magra e perder gordura ao mesmo tempo é chamado de recomposição corporal.
    <b>IMC</b> relaciona peso e altura, mas não separa músculo de gordura — por isso
    a dobra cutânea é mais precisa e é ela que usamos aqui.
    <b>Taxa metabólica basal</b> é o que seu corpo gastaria se você ficasse o dia
    inteiro deitado, sem se mover.
  </div>

  <div class="rod">
    <div>
      Documento de acompanhamento profissional. <b>Não substitui avaliação médica.</b><br>
      Emitido por ${perfil.nome || ''}${perfil.cref ? `, CREF ${perfil.cref}` : ''}
      em ${new Date().toLocaleDateString('pt-BR')}.
    </div>
    <div class="rod-p">${anamnese ? '3 / 3' : '3 / 2'}</div>
  </div>
</div>

<script>
  window.onload = () => { setTimeout(() => window.print(), 800); };
<\/script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Permita pop-ups neste site para gerar o relatório.');
    return false;
  }
  w.document.write(html);
  w.document.close();
  return true;
}

/* ───────────────────────────────────────────────────────────────
   ENTRADA
   ─────────────────────────────────────────────────────────────── */

function Entrada({ toast }) {
  const [modo, setModo] = useState('entrar');
  const [f, setF] = useState({ nome: '', email: '', senha: '' });
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const enviar = async () => {
    if (!f.email || !f.senha) return toast('Preencha e-mail e senha', 'erro');
    if (modo === 'criar' && !f.nome.trim()) return toast('Informe seu nome', 'erro');
    if (f.senha.length < 6) return toast('A senha precisa de ao menos 6 caracteres', 'erro');

    setBusy(true);
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({
          email: f.email.trim(), password: f.senha,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email: f.email.trim(), password: f.senha,
          options: { data: { nome: f.nome.trim() } },
        });
        if (error) throw error;
        toast('Conta criada. Você já pode entrar.', 'ok');
        setModo('entrar');
      }
    } catch (e) {
      const m = e.message || '';
      if (m.includes('Invalid login')) toast('E-mail ou senha incorretos', 'erro');
      else if (m.includes('already registered')) toast('Este e-mail já tem conta', 'erro');
      else toast(m, 'erro');
    }
    setBusy(false);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      padding: 'var(--e4)',
    }}>
      <div style={{ width: '100%', maxWidth: 396 }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--e6)' }}>
          <div className="marca" style={{ fontSize: 26 }}>
            Avalia<em>Lab</em>
          </div>
          <div style={{
            fontSize: 13.5, color: 'var(--sombra-txt)', marginTop: 6,
          }}>
            Anamnese e composição corporal
          </div>
        </div>

        <Cart>
          <div className="pilha g5">
            <Abas
              opcoes={[{ v: 'entrar', l: 'Entrar' }, { v: 'criar', l: 'Criar conta' }]}
              valor={modo} aoTrocar={setModo} />

            <div className="pilha g4">
              {modo === 'criar' && (
                <Campo rot="Nome" id="n">
                  <input id="n" value={f.nome} autoComplete="name"
                    placeholder="Como você assina profissionalmente"
                    onChange={(e) => set('nome', e.target.value)} />
                </Campo>
              )}
              <Campo rot="E-mail" id="e">
                <input id="e" type="email" value={f.email} autoComplete="email"
                  placeholder="voce@email.com"
                  onChange={(e) => set('email', e.target.value)} />
              </Campo>
              <Campo rot="Senha" id="s"
                dica={modo === 'criar' ? 'Ao menos 6 caracteres' : null}>
                <input id="s" type="password" value={f.senha}
                  autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
                  onKeyDown={(e) => e.key === 'Enter' && enviar()}
                  onChange={(e) => set('senha', e.target.value)} />
              </Campo>

              <Btn variante="1" tam="g" cheio onClick={enviar} carregando={busy}>
                {modo === 'entrar' ? 'Entrar' : 'Criar conta'}
              </Btn>
            </div>
          </div>
        </Cart>

        <div style={{
          textAlign: 'center', fontSize: 12.5,
          color: 'var(--tenue)', marginTop: 'var(--e4)',
        }}>
          Grátis até {LIMITE_FREE} alunos. Sem cartão.
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   ANAMNESE PÚBLICA — o aluno preenche pelo celular, sem conta
   ─────────────────────────────────────────────────────────────── */

function AnamnesePublica({ token }) {
  const [aluno, setAluno]     = useState(null);
  const [resp, setResp]       = useState({});
  const [busy, setBusy]       = useState(false);
  const [pronto, setPronto]   = useState(false);
  const [erro, setErro]       = useState('');
  const [carregando, setCarregando] = useState(true);

  const chave = 'al:anam:' + token;

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('al_buscar_por_token', { p_token: token });
      const reg = data?.[0];
      if (error || !reg) {
        setErro('Este link não é válido ou já expirou.');
        setCarregando(false);
        return;
      }
      setAluno({ id: reg.id, nome: reg.nome });
      if (reg.ja_preenchida) setPronto(true);
      else {
        try {
          const salvo = localStorage.getItem(chave);
          if (salvo) setResp(JSON.parse(salvo));
        } catch { /* ignora rascunho corrompido */ }
      }
      setCarregando(false);
    })();
  }, [token, chave]);

  // Rascunho: o aluno pode fechar e voltar depois
  useEffect(() => {
    if (pronto || !Object.keys(resp).length) return;
    try { localStorage.setItem(chave, JSON.stringify(resp)); } catch { /* cheio */ }
  }, [resp, chave, pronto]);

  const set = (k, v) => { setResp((x) => ({ ...x, [k]: v })); setErro(''); };

  const alternar = (k, op) => {
    const atual = resp[k] || [];
    set(k, atual.includes(op) ? atual.filter((x) => x !== op) : [...atual, op]);
  };

  const obrigatorias = ANAMNESE.flatMap((s) => s.itens)
    .filter((i) => i.t === 'sn' || i.t === 'unica');
  const respondidas = obrigatorias.filter((i) => resp[i.k]).length;
  const progresso = Math.round((respondidas / obrigatorias.length) * 100);

  const enviar = async () => {
    const falta = obrigatorias.find((i) => !resp[i.k]);
    if (falta) {
      setErro('Ainda faltam respostas. Role a página e confira as perguntas em destaque.');
      const el = document.getElementById('p-' + falta.k);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('al_enviar_anamnese', {
      p_token: token, p_respostas: resp,
    });
    setBusy(false);
    if (error) {
      if ((error.message || '').includes('ja_preenchida')) { setPronto(true); return; }
      setErro('Não foi possível enviar. Verifique sua conexão e tente de novo.');
      return;
    }
    try { localStorage.removeItem(chave); } catch { /* ok */ }
    setPronto(true);
    window.scrollTo({ top: 0 });
  };

  if (carregando) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <span className="giro giro-aco" style={{ width: 22, height: 22 }} />
    </div>
  );

  if (erro && !aluno) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--e4)' }}>
      <Cart style={{ maxWidth: 380, textAlign: 'center' }}>
        <div className="pilha g3" style={{ alignItems: 'center' }}>
          <span style={{ color: 'var(--tenue)' }}><IcoLink size={28} /></span>
          <div className="tit t3">{erro}</div>
          <div className="dica">Peça um link novo ao seu profissional.</div>
        </div>
      </Cart>
    </div>
  );

  if (pronto) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--e4)' }}>
      <Cart style={{ maxWidth: 400, textAlign: 'center' }}>
        <div className="pilha g4" style={{ alignItems: 'center' }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'var(--verde-claro)', display: 'grid', placeItems: 'center',
            color: 'var(--verde)',
          }}>
            <IcoCheck size={26} />
          </div>
          <div className="tit t2">Respostas enviadas</div>
          <div style={{ fontSize: 14.5, color: 'var(--grafite)', lineHeight: 1.6 }}>
            Obrigado, {aluno.nome.split(' ')[0]}. Seu profissional já recebeu
            tudo. Pode fechar esta página.
          </div>
        </div>
      </Cart>
    </div>
  );

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '0 var(--e4) var(--e8)' }}>
      <div className="prog" style={{ paddingTop: 'var(--e4)' }}>
        <div className="prog-t">
          <div className="prog-b" style={{ width: `${progresso}%` }} />
        </div>
        <div className="prog-l">
          <span className="marca" style={{ fontSize: 13 }}>Avalia<em>Lab</em></span>
          <span className="mono">{respondidas} de {obrigatorias.length}</span>
        </div>
      </div>

      <div style={{ marginBottom: 'var(--e6)' }}>
        <h1 className="tit t1">Olá, {aluno.nome.split(' ')[0]}.</h1>
        <p style={{
          fontSize: 14.5, color: 'var(--grafite)',
          marginTop: 'var(--e2)', lineHeight: 1.6,
        }}>
          Estas perguntas levam cerca de cinco minutos e ajudam seu profissional
          a montar um treino seguro para você. Responda com sinceridade — nada
          aqui é julgamento.
        </p>
      </div>

      {erro && (
        <div className="aviso aviso-alerta fila g3" style={{ marginBottom: 'var(--e4)' }}>
          <IcoAviso size={18} />
          <span>{erro}</span>
        </div>
      )}

      <div className="pilha g5">
        {ANAMNESE.map((sec) => (
          <section key={sec.secao} className="pilha g3">
            <div>
              <span className="olho">{sec.secao}</span>
              {sec.nota && <p className="dica" style={{ marginTop: 4 }}>{sec.nota}</p>}
            </div>

            <Cart>
              <div className="pilha g5">
                {sec.itens.map((it) => {
                  const falta = (it.t === 'sn' || it.t === 'unica') && !resp[it.k];
                  return (
                    <div key={it.k} id={'p-' + it.k}>
                      <div style={{
                        fontSize: 14.5, lineHeight: 1.5, marginBottom: 'var(--e3)',
                        fontWeight: 500,
                      }}>
                        {it.q}
                        {falta && (
                          <span style={{
                            color: 'var(--ambar)', marginLeft: 5, fontSize: 13,
                          }}>obrigatória</span>
                        )}
                      </div>

                      {it.t === 'sn' && (
                        <div className="fila g2">
                          {['Não', 'Sim'].map((op) => (
                            <Btn key={op}
                              variante={resp[it.k] === op ? '1' : '2'}
                              cheio onClick={() => set(it.k, op)}>{op}</Btn>
                          ))}
                        </div>
                      )}

                      {it.t === 'unica' && (
                        <div className="pilha g2">
                          {it.opcoes.map((op) => (
                            <Btn key={op}
                              variante={resp[it.k] === op ? '1' : '2'}
                              cheio onClick={() => set(it.k, op)}
                              style={{ justifyContent: 'flex-start', fontWeight: 500 }}>
                              {op}
                            </Btn>
                          ))}
                        </div>
                      )}

                      {it.t === 'multi' && (
                        <div className="fila g2" style={{ flexWrap: 'wrap' }}>
                          {it.opcoes.map((op) => (
                            <Btn key={op} tam="p"
                              variante={(resp[it.k] || []).includes(op) ? '1' : '2'}
                              onClick={() => alternar(it.k, op)}
                              style={{ fontWeight: 500 }}>{op}</Btn>
                          ))}
                        </div>
                      )}

                      {it.t === 'texto' && (
                        <textarea rows={2} value={resp[it.k] || ''}
                          placeholder="Se não se aplica, deixe em branco"
                          onChange={(e) => set(it.k, e.target.value)} />
                      )}
                    </div>
                  );
                })}
              </div>
            </Cart>
          </section>
        ))}
      </div>

      <Btn variante="1" tam="g" cheio carregando={busy} onClick={enviar}
        style={{ marginTop: 'var(--e5)' }}>
        Enviar respostas
      </Btn>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   FICHA DO ALUNO
   ─────────────────────────────────────────────────────────────── */

function Ficha({ aluno, perfil, aoVoltar, aoExcluir, toast }) {
  const [aba, setAba]       = useState('avaliacoes');
  const [avals, setAvals]   = useState([]);
  const [anam, setAnam]     = useState(null);
  const [nova, setNova]     = useState(false);
  const [load, setLoad]     = useState(true);
  const [aberta, setAberta] = useState(null);
  const [excluirAval, setExcluirAval] = useState(null);

  const carregar = useCallback(async () => {
    setLoad(true);
    const [{ data: a }, { data: an }] = await Promise.all([
      supabase.from('al_avaliacoes').select('*')
        .eq('aluno_id', aluno.id).order('data', { ascending: false }),
      supabase.from('al_anamneses').select('*')
        .eq('aluno_id', aluno.id).maybeSingle(),
    ]);
    setAvals(a || []);
    setAnam(an);
    setLoad(false);
  }, [aluno.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const link = `${window.location.origin}/a/${aluno.token_anamnese}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copiado', 'ok');
    } catch {
      toast('Não foi possível copiar. Selecione o texto e copie.', 'erro');
    }
  };

  const remover = async () => {
    await supabase.from('al_avaliacoes').delete().eq('id', excluirAval);
    setExcluirAval(null);
    carregar();
    toast('Avaliação removida', 'ok');
  };

  const relatorio = () => {
    if (!avals.length) return toast('Nenhuma avaliação para exportar', 'erro');
    gerarRelatorio({ aluno, perfil, avaliacoes: avals, anamnese: anam });
  };

  if (nova) return (
    <Avaliacao aluno={aluno} perfil={perfil} ultima={avals[0]} toast={toast}
      aoSalvar={() => { setNova(false); carregar(); }}
      aoCancelar={() => setNova(false)} />
  );

  const series = avals.length >= 2 ? (() => {
    const pts = [...avals].reverse().filter((a) => a.resultados?.percentual != null);
    return [
      { nome: 'Gordura (%)', cor: 'var(--cobre)', forte: true,
        pontos: pts.map((a) => ({ v: a.resultados.percentual })) },
      { nome: 'Massa magra (kg)', cor: 'var(--aco)', forte: false,
        pontos: pts.map((a) => ({ v: a.resultados.massaMagra })) },
      { nome: 'Peso (kg)', cor: 'var(--tenue)', forte: false,
        pontos: pts.map((a) => ({ v: a.peso })) },
    ];
  })() : null;

  return (
    <div className="pilha g5">
      <div>
        <Btn variante="3" onClick={aoVoltar} style={{ marginLeft: -12 }}>
          <IcoVolta size={16} /> Alunos
        </Btn>
      </div>

      <div className="entre" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="tit t1">{aluno.nome}</h1>
          <div style={{ fontSize: 13.5, color: 'var(--sombra-txt)', marginTop: 3 }}>
            {idadeDe(aluno.nascimento)} anos
            {' · '}{aluno.sexo === 'F' ? 'Feminino' : 'Masculino'}
            {aluno.telefone && ` · ${aluno.telefone}`}
          </div>
        </div>
        <Btn variante="1" onClick={() => setNova(true)}>
          <IcoMais size={16} /> Avaliação
        </Btn>
      </div>

      <Abas
        opcoes={[
          { v: 'avaliacoes', l: 'Avaliações', selo: avals.length || null },
          { v: 'anamnese', l: 'Anamnese', ponto: !!anam },
        ]}
        valor={aba} aoTrocar={setAba} />

      {load && (
        <div className="pilha g3">
          <Esqueleto h={132} />
          <Esqueleto h={76} />
          <Esqueleto h={76} />
        </div>
      )}

      {!load && aba === 'avaliacoes' && (
        <div className="pilha g4">
          {!avals.length ? (
            <Cart>
              <Vazio
                ico={<IcoRegua size={30} />}
                titulo="Nenhuma avaliação ainda"
                desc="Registre a primeira medição para começar o histórico deste aluno."
                acao={<Btn variante="1" onClick={() => setNova(true)}>
                  Nova avaliação
                </Btn>} />
            </Cart>
          ) : (
            <>
              {series && (
                <Cart>
                  <div className="pilha g3">
                    <span className="olho">Evolução</span>
                    <GraficoLinha series={series} />
                  </div>
                </Cart>
              )}

              <Btn variante="2" cheio onClick={relatorio}>
                <IcoDoc size={17} /> Gerar relatório em PDF
              </Btn>

              <div className="pilha g2">
                {avals.map((a, i) => {
                  const res = a.resultados || {};
                  const cls = res.percentual ? classificar(res.percentual, aluno.sexo) : null;
                  const ant = avals[i + 1];
                  const exp = aberta === a.id;

                  return (
                    <Cart key={a.id} pad="0">
                      <button className="item" onClick={() => setAberta(exp ? null : a.id)}
                        style={{ border: 0, borderRadius: 0, boxShadow: 'none', transform: 'none' }}
                        aria-expanded={exp}>
                        <div>
                          <div className="mono" style={{
                            fontSize: 12, color: 'var(--sombra-txt)',
                          }}>
                            {new Date(a.data + 'T12:00').toLocaleDateString('pt-BR')}
                          </div>
                          <div className="fila g3" style={{ marginTop: 5 }}>
                            <span className="mono" style={{
                              fontSize: 23, fontWeight: 600, color: 'var(--aco)',
                            }}>{res.percentual}%</span>
                            <span className="mono" style={{
                              fontSize: 13, color: 'var(--sombra-txt)',
                            }}>{a.peso} kg</span>
                            {cls && <Selo tom={cls.tom}>{cls.label}</Selo>}
                            {ant?.resultados?.percentual != null && (
                              <Delta atual={res.percentual}
                                anterior={ant.resultados.percentual}
                                un="%" menorMelhor mostrarZero={false} />
                            )}
                          </div>
                        </div>
                        <span style={{
                          color: 'var(--tenue)',
                          transform: exp ? 'rotate(180deg)' : 'none',
                          transition: 'transform var(--t)',
                          display: 'flex',
                        }}>
                          <IcoBaixo size={18} />
                        </span>
                      </button>

                      {exp && (
                        <div style={{
                          padding: 'var(--e4)',
                          borderTop: '1px solid var(--regua)',
                          background: 'var(--papel)',
                        }}>
                          <div className="pilha g4">
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit,minmax(84px,1fr))',
                              gap: 'var(--e3)',
                            }}>
                              {[
                                ['Massa magra', `${res.massaMagra} kg`],
                                ['Massa gorda', `${res.massaGorda} kg`],
                                ['IMC', res.imc],
                                ['Somatório', `${res.somatorio} mm`],
                                ...(res.rcq ? [['RCQ', res.rcq]] : []),
                                ...(res.tmb ? [['TMB', `${res.tmb} kcal`]] : []),
                                ...(res.get ? [['GET', `${res.get} kcal`]] : []),
                              ].map(([l, v]) => (
                                <div key={l}>
                                  <div className="res-k">{l}</div>
                                  <div className="mono" style={{
                                    fontSize: 15, fontWeight: 600, marginTop: 1,
                                  }}>{v}</div>
                                </div>
                              ))}
                            </div>

                            <div className="dica">
                              {PROTOCOLOS[a.protocolo]?.nome}
                            </div>

                            {a.observacoes && (
                              <div className="aviso aviso-info">
                                {a.observacoes.split('\n').map((l, j) => (
                                  <div key={j}>{l}</div>
                                ))}
                              </div>
                            )}

                            <div>
                              <Btn variante="x" tam="p"
                                onClick={() => setExcluirAval(a.id)}>
                                <IcoLixo size={15} /> Excluir avaliação
                              </Btn>
                            </div>
                          </div>
                        </div>
                      )}
                    </Cart>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {!load && aba === 'anamnese' && (
        <div className="pilha g4">
          <Cart>
            <div className="pilha g3">
              <div>
                <span className="olho">Link para o aluno</span>
                <p className="dica" style={{ marginTop: 4 }}>
                  {anam
                    ? 'Já preenchida. Um novo envio pelo mesmo link não é aceito.'
                    : 'Mande por WhatsApp. Ele preenche pelo celular, sem criar conta.'}
                </p>
              </div>
              <div className="fila g2">
                <input readOnly value={link} className="mono"
                  onClick={(e) => e.target.select()}
                  style={{ fontSize: 12.5, color: 'var(--grafite)' }} />
                <Btn variante="2" onClick={copiar}>
                  <IcoCopia size={16} /> Copiar
                </Btn>
              </div>
            </div>
          </Cart>

          {!anam ? (
            <Cart>
              <Vazio
                ico={<IcoRelogio size={30} />}
                titulo="Aguardando o aluno"
                desc="As respostas aparecem aqui assim que ele enviar o formulário." />
            </Cart>
          ) : (
            <>
              <div className="dica">
                Preenchida em {new Date(anam.preenchida_em).toLocaleDateString('pt-BR')}
              </div>

              {ANAMNESE.map((sec) => {
                const alertas = sec.itens.filter(
                  (i) => i.k.startsWith('parq') && anam.respostas[i.k] === 'Sim'
                );
                return (
                  <Cart key={sec.secao}>
                    <div className="pilha g4">
                      <div className="entre">
                        <span className="olho">{sec.secao}</span>
                        {alertas.length > 0 && (
                          <Selo tom="medio">
                            <IcoAviso size={12} />
                            {alertas.length} a observar
                          </Selo>
                        )}
                      </div>

                      <div className="pilha g4">
                        {sec.itens.map((it) => {
                          const v = anam.respostas[it.k];
                          if (!v || (Array.isArray(v) && !v.length)) return null;
                          const alerta = it.k.startsWith('parq') && v === 'Sim';
                          return (
                            <div key={it.k}>
                              <div className="dica">{it.q}</div>
                              <div style={{
                                fontSize: 14.5, fontWeight: 600, marginTop: 2,
                                color: alerta ? 'var(--ambar)' : 'var(--tinta)',
                              }}>
                                {Array.isArray(v) ? v.join(', ') : v}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </Cart>
                );
              })}
            </>
          )}
        </div>
      )}

      <hr className="linha" />
      <div>
        <Btn variante="x" tam="p" onClick={aoExcluir}>
          <IcoLixo size={15} /> Excluir aluno
        </Btn>
      </div>

      <Modal aberto={!!excluirAval} aoFechar={() => setExcluirAval(null)}
        titulo="Excluir avaliação?"
        rodape={<>
          <Btn variante="2" onClick={() => setExcluirAval(null)}>Cancelar</Btn>
          <Btn variante="x" onClick={remover}>Excluir</Btn>
        </>}>
        <p style={{ fontSize: 14.5, color: 'var(--grafite)', lineHeight: 1.6 }}>
          As medidas desta avaliação serão apagadas e o histórico do aluno
          será recalculado sem ela. Não dá para desfazer.
        </p>
      </Modal>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   LISTA DE ALUNOS
   ─────────────────────────────────────────────────────────────── */

const semAcento = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function Lista({ perfil, aoAbrir, toast, recarregar }) {
  const [alunos, setAlunos] = useState([]);
  const [busca, setBusca]   = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [load, setLoad]     = useState(true);
  const [novo, setNovo]     = useState(false);
  const [f, setF] = useState({ nome: '', nascimento: '', sexo: 'F', telefone: '' });
  const [busy, setBusy]     = useState(false);

  const carregar = useCallback(async () => {
    setLoad(true);
    const { data: as } = await supabase.from('al_alunos')
      .select('*').eq('profile_id', perfil.id).order('nome');
    const lista = as || [];

    if (lista.length) {
      const ids = lista.map((a) => a.id);
      const [{ data: avs }, { data: ans }] = await Promise.all([
        supabase.from('al_avaliacoes').select('aluno_id, data').in('aluno_id', ids),
        supabase.from('al_anamneses').select('aluno_id').in('aluno_id', ids),
      ]);
      const ultimaDe = {};
      (avs || []).forEach((a) => {
        if (!ultimaDe[a.aluno_id] || a.data > ultimaDe[a.aluno_id]) {
          ultimaDe[a.aluno_id] = a.data;
        }
      });
      const comAnam = new Set((ans || []).map((a) => a.aluno_id));
      lista.forEach((a) => {
        a._ultima = ultimaDe[a.id] || null;
        a._anamnese = comAnam.has(a.id);
      });
    }

    setAlunos(lista);
    setLoad(false);
  }, [perfil.id]);

  useEffect(() => { carregar(); }, [carregar, recarregar]);

  const noLimite = perfil.plano === 'free' && alunos.length >= LIMITE_FREE;

  const criar = async () => {
    if (!f.nome.trim()) return toast('Informe o nome do aluno', 'erro');
    if (noLimite) return toast(`O plano grátis vai até ${LIMITE_FREE} alunos`, 'erro');
    setBusy(true);
    const { error } = await supabase.from('al_alunos').insert({
      profile_id: perfil.id, nome: f.nome.trim(),
      nascimento: f.nascimento || null, sexo: f.sexo, telefone: f.telefone,
    });
    setBusy(false);
    if (error) return toast('Não foi possível cadastrar', 'erro');
    setF({ nome: '', nascimento: '', sexo: 'F', telefone: '' });
    setNovo(false);
    carregar();
    toast('Aluno cadastrado', 'ok');
  };

  const hoje = new Date();
  const status = (a) => {
    if (!a._ultima) return { l: 'Sem avaliação', tom: 'medio' };
    const dias = Math.floor((hoje - new Date(a._ultima + 'T12:00')) / 86400000);
    if (dias > 100) return { l: 'Avaliação vencida', tom: 'alto' };
    if (dias > 75)  return { l: 'Reavaliar em breve', tom: 'medio' };
    return { l: 'Em dia', tom: 'bom' };
  };

  const filtrados = alunos
    .filter((a) => !busca || semAcento(a.nome).includes(semAcento(busca)))
    .filter((a) => {
      if (filtro === 'pendente') return !a._ultima || status(a).tom !== 'bom';
      if (filtro === 'sem-anamnese') return !a._anamnese;
      return true;
    });

  const pendentes = alunos.filter((a) => !a._ultima || status(a).tom !== 'bom').length;
  const semAnam = alunos.filter((a) => !a._anamnese).length;

  return (
    <div className="pilha g5">
      <div className="entre" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="tit t1">Alunos</h1>
          <div style={{ fontSize: 13.5, color: 'var(--sombra-txt)', marginTop: 3 }}>
            {alunos.length} cadastrado{alunos.length === 1 ? '' : 's'}
            {perfil.plano === 'free' && ` · limite de ${LIMITE_FREE} no plano grátis`}
          </div>
        </div>
        <Btn variante="1" onClick={() => setNovo(true)} disabled={noLimite}>
          <IcoMais size={16} /> Aluno
        </Btn>
      </div>

      {noLimite && (
        <div className="aviso aviso-alerta fila g3">
          <IcoAviso size={18} />
          <div>
            <strong>Limite do plano grátis atingido.</strong>{' '}
            Para cadastrar mais alunos, será preciso assinar.
          </div>
        </div>
      )}

      {alunos.length > 2 && (
        <div className="pilha g3">
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)', color: 'var(--tenue)',
              display: 'flex', pointerEvents: 'none',
            }}>
              <IcoBusca size={17} />
            </span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar aluno" aria-label="Buscar aluno"
              style={{ paddingLeft: 38 }} />
          </div>

          <div className="fila g2" style={{ flexWrap: 'wrap' }}>
            {[
              { v: 'todos', l: 'Todos', n: alunos.length },
              { v: 'pendente', l: 'A reavaliar', n: pendentes },
              { v: 'sem-anamnese', l: 'Sem anamnese', n: semAnam },
            ].map((o) => (
              <Btn key={o.v} tam="p"
                variante={filtro === o.v ? '1' : '2'}
                onClick={() => setFiltro(o.v)}
                style={{ fontWeight: 500 }}>
                {o.l}
                <span className="mono" style={{
                  fontSize: 11, opacity: .65, marginLeft: 2,
                }}>{o.n}</span>
              </Btn>
            ))}
          </div>
        </div>
      )}

      {load ? (
        <div className="pilha g2">
          {[0, 1, 2].map((i) => <Esqueleto key={i} h={70} />)}
        </div>
      ) : !filtrados.length ? (
        <Cart>
          <Vazio
            ico={<IcoPessoas size={30} />}
            titulo={busca || filtro !== 'todos'
              ? 'Nenhum aluno encontrado'
              : 'Nenhum aluno ainda'}
            desc={busca || filtro !== 'todos'
              ? 'Tente outro termo ou limpe o filtro.'
              : 'Cadastre o primeiro aluno para começar a avaliar.'}
            acao={!busca && filtro === 'todos' && (
              <Btn variante="1" onClick={() => setNovo(true)}>
                Cadastrar aluno
              </Btn>
            )} />
        </Cart>
      ) : (
        <div className="pilha g2">
          {filtrados.map((a) => {
            const st = status(a);
            return (
              <button key={a.id} className="item" onClick={() => aoAbrir(a)}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{a.nome}</div>
                  <div className="fila g2" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--sombra-txt)' }}>
                      {idadeDe(a.nascimento)} anos
                    </span>
                    <Selo tom={st.tom}>{st.l}</Selo>
                    {!a._anamnese && <Selo>Sem anamnese</Selo>}
                  </div>
                </div>
                <span style={{ color: 'var(--tenue)', display: 'flex' }}>
                  <IcoSeta size={17} />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Modal aberto={novo} aoFechar={() => setNovo(false)} titulo="Novo aluno"
        rodape={<>
          <Btn variante="2" onClick={() => setNovo(false)}>Cancelar</Btn>
          <Btn variante="1" onClick={criar} carregando={busy}>Cadastrar</Btn>
        </>}>
        <div className="pilha g4">
          <Campo rot="Nome completo" id="an">
            <input id="an" value={f.nome} autoFocus placeholder="Nome do aluno"
              onChange={(e) => setF({ ...f, nome: e.target.value })} />
          </Campo>
          <div className="grade2">
            <Campo rot="Nascimento" id="ad">
              <input id="ad" type="date" value={f.nascimento}
                onChange={(e) => setF({ ...f, nascimento: e.target.value })} />
            </Campo>
            <Campo rot="Sexo" id="as"
              dica="Define as equações do protocolo.">
              <select id="as" value={f.sexo}
                onChange={(e) => setF({ ...f, sexo: e.target.value })}>
                <option value="F">Feminino</option>
                <option value="M">Masculino</option>
              </select>
            </Campo>
          </div>
          <Campo rot="Telefone" id="at">
            <input id="at" value={f.telefone} placeholder="(00) 00000-0000"
              inputMode="tel"
              onChange={(e) => setF({ ...f, telefone: e.target.value })} />
          </Campo>
        </div>
      </Modal>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   PERFIL
   ─────────────────────────────────────────────────────────────── */

function Perfil({ perfil, aoAtualizar, toast }) {
  const [f, setF] = useState({
    nome: perfil.nome || '', cref: perfil.cref || '', telefone: perfil.telefone || '',
  });
  const [busy, setBusy] = useState(false);
  const [subindo, setSubindo] = useState(false);
  const ref = useRef();

  const salvar = async () => {
    setBusy(true);
    const { error } = await supabase.from('al_profiles').update(f).eq('id', perfil.id);
    setBusy(false);
    if (error) return toast('Não foi possível salvar', 'erro');
    toast('Perfil salvo', 'ok');
    aoAtualizar();
  };

  const enviarLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('A imagem precisa ter menos de 2 MB', 'erro');
      return;
    }
    setSubindo(true);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const caminho = `${perfil.id}/logo.${ext}`;
    const { error: up } = await supabase.storage.from('al-logos')
      .upload(caminho, file, { upsert: true });
    if (up) { setSubindo(false); return toast('Não foi possível enviar', 'erro'); }
    const { data } = supabase.storage.from('al-logos').getPublicUrl(caminho);
    await supabase.from('al_profiles')
      .update({ logo_url: `${data.publicUrl}?v=${Date.now()}` })
      .eq('id', perfil.id);
    setSubindo(false);
    toast('Logo atualizada', 'ok');
    aoAtualizar();
  };

  return (
    <div className="pilha g5" style={{ maxWidth: 520 }}>
      <h1 className="tit t1">Perfil</h1>

      <Cart>
        <div className="pilha g4">
          <Campo rot="Nome" id="pn"
            dica="Aparece no relatório que o aluno recebe.">
            <input id="pn" value={f.nome}
              onChange={(e) => setF({ ...f, nome: e.target.value })} />
          </Campo>
          <Campo rot="Registro profissional" id="pc"
            dica="CREF, CRN ou CREFITO. Vai impresso no relatório.">
            <input id="pc" value={f.cref} placeholder="000000-G/UF"
              onChange={(e) => setF({ ...f, cref: e.target.value })} />
          </Campo>
          <Campo rot="Telefone" id="pt">
            <input id="pt" value={f.telefone} placeholder="(00) 00000-0000"
              inputMode="tel"
              onChange={(e) => setF({ ...f, telefone: e.target.value })} />
          </Campo>
          <Btn variante="1" onClick={salvar} carregando={busy}>Salvar perfil</Btn>
        </div>
      </Cart>

      <Cart>
        <div className="pilha g3">
          <div>
            <span className="olho">Logo no relatório</span>
            <p className="dica" style={{ marginTop: 4 }}>
              PNG com fundo transparente funciona melhor. Até 2 MB.
            </p>
          </div>

          {perfil.logo_url ? (
            <div style={{
              background: 'var(--recuo)', borderRadius: 'var(--r2)',
              padding: 'var(--e5)', display: 'grid', placeItems: 'center',
              border: '1px solid var(--regua)',
            }}>
              <img src={perfil.logo_url} alt="Sua logo"
                style={{ maxHeight: 60, maxWidth: '100%', objectFit: 'contain' }} />
            </div>
          ) : (
            <div style={{
              background: 'var(--recuo)', borderRadius: 'var(--r2)',
              padding: 'var(--e6)', display: 'grid', placeItems: 'center',
              border: '1px dashed var(--regua-forte)', color: 'var(--tenue)',
            }}>
              <IcoImagem size={26} />
            </div>
          )}

          <input ref={ref} type="file" accept="image/*"
            onChange={enviarLogo} style={{ display: 'none' }} />
          <Btn variante="2" cheio carregando={subindo}
            onClick={() => ref.current?.click()}>
            {perfil.logo_url ? 'Trocar logo' : 'Enviar logo'}
          </Btn>
        </div>
      </Cart>

      <Cart>
        <div className="entre">
          <div>
            <span className="olho">Plano</span>
            <div className="tit t3" style={{ marginTop: 4 }}>
              {perfil.plano === 'pro' ? 'Pro' : 'Grátis'}
            </div>
            <div className="dica" style={{ marginTop: 2 }}>
              {perfil.plano === 'pro'
                ? 'Alunos ilimitados'
                : `Até ${LIMITE_FREE} alunos`}
            </div>
          </div>
          {perfil.plano === 'free' && <Selo tom="aco">Upgrade em breve</Selo>}
        </div>
      </Cart>

      <Btn variante="2" onClick={() => supabase.auth.signOut()}>
        <IcoSair size={16} /> Sair da conta
      </Btn>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   APP
   ─────────────────────────────────────────────────────────────── */

/* Definidos fora do App: se ficassem dentro, o React os trataria como
   componentes novos a cada render e remontaria a folha de estilo. */
const Estilo = () => (
  <>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" />
    <style>{CSS}</style>
  </>
);

const Carregando = () => (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
    <span className="giro giro-aco" style={{ width: 22, height: 22 }} />
  </div>
);

export default function App() {
  const [sessao, setSessao]   = useState(undefined);
  const [perfil, setPerfil]   = useState(null);
  const [tela, setTela]       = useState('alunos');
  const [aluno, setAluno]     = useState(null);
  const [recarregar, setRecarregar] = useState(0);
  const [toastMsg, setToastMsg] = useState(null);
  const [confirmar, setConfirmar] = useState(false);

  const toast = useCallback((msg, tipo) => {
    setToastMsg({ msg, tipo });
    setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const token = useMemo(() => {
    const m = window.location.pathname.match(/^\/a\/([a-z0-9]+)/i);
    return m ? m[1] : null;
  }, []);

  const carregarPerfil = useCallback(async () => {
    const { data, error } = await supabase.rpc('al_meu_perfil');
    if (error) { toast('Não foi possível carregar o perfil', 'erro'); return; }
    setPerfil(data);
  }, [toast]);

  useEffect(() => {
    if (token) { setSessao(null); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      if (data.session) carregarPerfil();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSessao(s);
      if (s) carregarPerfil();
      else { setPerfil(null); setAluno(null); setTela('alunos'); }
    });
    return () => sub.subscription.unsubscribe();
  }, [token, carregarPerfil]);

  const excluirAluno = async () => {
    await supabase.from('al_alunos').delete().eq('id', aluno.id);
    setConfirmar(false);
    setAluno(null);
    setRecarregar((r) => r + 1);
    toast('Aluno excluído', 'ok');
  };

  if (token) return <><Estilo /><AnamnesePublica token={token} /></>;
  if (sessao === undefined) return <><Estilo /><Carregando /></>;
  if (!sessao) return (
    <><Estilo /><Entrada toast={toast} />
      <Toast msg={toastMsg?.msg} tipo={toastMsg?.tipo} /></>
  );
  if (!perfil) return <><Estilo /><Carregando /></>;

  return (
    <>
      <Estilo />
      <div style={{ minHeight: '100vh' }}>
        <header style={{
          position: 'sticky', top: 0, zIndex: 20,
          background: 'rgba(255,255,255,.90)', backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--regua)',
        }}>
          <div className="entre" style={{
            maxWidth: 820, margin: '0 auto', padding: 'var(--e3) var(--e4)',
          }}>
            <button className="marca" onClick={() => { setTela('alunos'); setAluno(null); }}
              style={{
                background: 'none', border: 0, cursor: 'pointer',
                fontSize: 17, color: 'var(--tinta)', padding: 0,
              }}>
              Avalia<em>Lab</em>
            </button>

            <nav className="fila g1">
              <Btn variante={tela === 'alunos' && !aluno ? '2' : '3'} tam="p"
                onClick={() => { setTela('alunos'); setAluno(null); }}>
                <IcoPessoas size={16} /> Alunos
              </Btn>
              <Btn variante={tela === 'perfil' ? '2' : '3'} tam="p"
                onClick={() => { setTela('perfil'); setAluno(null); }}>
                <IcoUsuario size={16} /> Perfil
              </Btn>
            </nav>
          </div>
        </header>

        <main style={{
          maxWidth: 820, margin: '0 auto',
          padding: 'var(--e5) var(--e4) var(--e8)',
        }}>
          {tela === 'perfil' ? (
            <Perfil perfil={perfil} toast={toast} aoAtualizar={carregarPerfil} />
          ) : aluno ? (
            <Ficha aluno={aluno} perfil={perfil} toast={toast}
              aoVoltar={() => setAluno(null)}
              aoExcluir={() => setConfirmar(true)} />
          ) : (
            <Lista perfil={perfil} toast={toast} recarregar={recarregar}
              aoAbrir={setAluno} />
          )}
        </main>
      </div>

      <Modal aberto={confirmar} aoFechar={() => setConfirmar(false)}
        titulo="Excluir aluno?"
        rodape={<>
          <Btn variante="2" onClick={() => setConfirmar(false)}>Cancelar</Btn>
          <Btn variante="x" onClick={excluirAluno}>Excluir tudo</Btn>
        </>}>
        <p style={{ fontSize: 14.5, color: 'var(--grafite)', lineHeight: 1.6 }}>
          Todas as avaliações e a anamnese de <strong>{aluno?.nome}</strong> serão
          apagadas junto. Não dá para desfazer.
        </p>
      </Modal>

      <Toast msg={toastMsg?.msg} tipo={toastMsg?.tipo} />
    </>
  );
}
