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

/* ── Termo de responsabilidade ──
   Texto-modelo. O profissional pode editar, e a maioria não vai —
   então ele precisa estar correto e honesto por padrão. Não promete
   proteção jurídica que ninguém pode garantir: registra o que o aluno
   declarou, na data em que declarou. É isso que tem valor. */
const TERMO_MODELO = (perfil) => `TERMO DE CIÊNCIA E RESPONSABILIDADE

Declaro estar ciente de que:

1. A prática de exercício físico envolve riscos inerentes, incluindo, entre outros, lesões musculares, articulares e ósseas, e, em casos raros, eventos cardiovasculares.

2. As informações que prestei na anamnese são verdadeiras e completas. Não omiti nenhuma condição de saúde, lesão prévia, cirurgia, uso de medicamento ou sintoma relevante.

3. Estou ciente de que omitir informações de saúde compromete a segurança do programa de treinamento elaborado para mim, e assumo a responsabilidade por qualquer omissão.

4. Comprometo-me a informar${perfil?.nome ? ` ${perfil.nome}` : ' meu profissional'} imediatamente sobre qualquer alteração no meu estado de saúde, surgimento de sintoma, dor, desconforto, lesão ou início de novo medicamento.

5. Caso o questionário de prontidão (PAR-Q) aponte necessidade de liberação médica, comprometo-me a obtê-la antes de iniciar o programa, e estou ciente de que a recusa em fazê-lo é de minha inteira responsabilidade.

6. Devo interromper o exercício imediatamente e comunicar o profissional caso sinta dor no peito, tontura, falta de ar anormal, náusea ou qualquer mal-estar durante a atividade.

7. Este documento não substitui avaliação médica. O acompanhamento profissional em educação física não constitui diagnóstico, prescrição ou tratamento médico.

Declaro ter lido e compreendido integralmente o presente termo antes de assiná-lo.`;

/* ── Trilha de auditoria ── */

const ROTULO_EVENTO = {
  anamnese_assinada:  'Anamnese assinada',
  anamnese_adendo:    'Adendo de anamnese',
  avaliacao_criada:   'Avaliação registrada',
  avaliacao_editada:  'Avaliação corrigida',
  avaliacao_excluida: 'Avaliação excluída',
  // Linhas anteriores ao versionamento: houve edição, mas o conteúdo
  // anterior não foi preservado. Registrar isso é mais honesto do que
  // deixar a trilha parecer completa quando não é.
  avaliacao_editada_legado: 'Avaliação corrigida (antes do versionamento)',
};

// Eventos que carregam assinatura do aluno. Marcados com bolinha cheia
// na trilha: é o que distingue declaração assinada de registro interno.
const EVENTO_FORTE = ['anamnese_assinada', 'anamnese_adendo'];

// Nomes de campo legíveis para o diff de edição. Sem isso a trilha
// mostraria 'obs_partes' e 'resultados' para o profissional.
const ROTULO_CAMPO = {
  data: 'data', peso: 'peso', altura: 'altura', protocolo: 'protocolo',
  dobras: 'dobras cutâneas', perimetros: 'perímetros',
  resultados: 'resultados', observacoes: 'observações',
};

const descreverEvento = (h) => {
  const d = h.detalhe || {};
  const dt = (s) => s
    ? new Date(s + 'T12:00').toLocaleDateString('pt-BR')
    : '';

  switch (h.evento) {
    case 'anamnese_assinada':
      return [
        d.assinante ? `Assinada por ${d.assinante}` : 'Assinada pelo aluno',
        d.termo_versao ? `Termo versão ${d.termo_versao} aceito` : null,
      ].filter(Boolean).join('. ') + '.';

    case 'avaliacao_criada':
      return [
        `Medição de ${dt(d.data)}`,
        d.percentual ? `${d.percentual}% de gordura` : null,
        PROTOCOLOS[d.protocolo]?.nome,
      ].filter(Boolean).join(' · ');

    case 'avaliacao_editada': {
      const campos = Object.keys(d.campos || {})
        .map((k) => ROTULO_CAMPO[k] || k);
      return [
        `Medição de ${dt(d.data)} — versão ${d.versao}`,
        campos.length ? `Alterado: ${campos.join(', ')}` : null,
        d.motivo ? `Motivo: ${d.motivo}` : null,
      ].filter(Boolean).join('. ') + '.';
    }

    case 'avaliacao_editada_legado':
      return `Medição de ${dt(d.data)} foi corrigida antes do versionamento. `
        + 'O conteúdo anterior não foi preservado.';

    case 'anamnese_adendo': {
      const campos = (d.campos || []).length;
      return [
        d.origem === 'aluno'
          ? `Informação atualizada e assinada por ${d.assinante || 'o aluno'}`
          : 'Informação atualizada pelo profissional a partir de relato do aluno',
        campos ? `${campos} ${campos === 1 ? 'campo' : 'campos'} alterado${campos === 1 ? '' : 's'}` : null,
        d.motivo ? `Motivo: ${d.motivo}` : null,
      ].filter(Boolean).join('. ') + '.';
    }

    case 'avaliacao_excluida':
      return `Medição de ${dt(d.data)} foi removida do histórico.`;

    default:
      return '';
  }
};

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

/* Símbolo + palavra, alinhados pela base ótica */
.marca-l{
  display:inline-flex;align-items:center;gap:.42em;
  color:var(--tinta);line-height:1;
}

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

/* ── Assinatura ── */
.assina{
  position:relative;background:var(--superficie);
  border:1px solid var(--regua);border-radius:var(--r2);
  height:150px;overflow:hidden;
  transition:border-color var(--t);
}
.assina:hover{border-color:var(--regua-forte)}
.assina-cv{
  width:100%;height:100%;display:block;
  cursor:crosshair;touch-action:none; /* impede scroll ao assinar */
  position:relative;z-index:2;
}
.assina-dica{
  position:absolute;inset:0;display:grid;place-items:center;
  color:var(--tenue);font-size:14px;pointer-events:none;z-index:1;
}
.assina-linha{
  position:absolute;left:24px;right:24px;bottom:34px;
  height:1px;background:var(--regua);pointer-events:none;z-index:1;
}

/* ── Termo ── */
.termo{
  background:var(--papel);border:1px solid var(--regua);
  border-radius:var(--r2);padding:var(--e4);
  max-height:220px;overflow-y:auto;
  font-size:13px;line-height:1.65;color:var(--grafite);
  white-space:pre-wrap;
}

.caixa{
  display:flex;align-items:flex-start;gap:var(--e3);
  padding:var(--e3) var(--e4);cursor:pointer;
  border:1px solid var(--regua);border-radius:var(--r2);
  background:var(--superficie);transition:all var(--t);
  text-align:left;width:100%;font-family:inherit;
}
.caixa:hover{border-color:var(--regua-forte)}
.caixa.marcada{border-color:var(--aco);background:var(--aco-claro)}
.caixa-q{
  width:20px;height:20px;flex-shrink:0;margin-top:1px;
  border:1.5px solid var(--regua-forte);border-radius:5px;
  display:grid;place-items:center;transition:all var(--t);
  color:transparent;background:var(--superficie);
}
.caixa.marcada .caixa-q{
  background:var(--aco);border-color:var(--aco);color:#fff;
}
.caixa-t{font-size:14px;line-height:1.5}

/* ── Trilha de auditoria ── */
.trilha{position:relative;padding-left:22px}
.trilha::before{
  content:'';position:absolute;left:5px;top:6px;bottom:6px;
  width:1px;background:var(--regua);
}
.trilha-i{position:relative;padding:var(--e3) 0}
.trilha-i::before{
  content:'';position:absolute;left:-21px;top:17px;
  width:9px;height:9px;border-radius:50%;
  background:var(--superficie);border:2px solid var(--regua-forte);
}
.trilha-i.forte::before{border-color:var(--aco);background:var(--aco)}
.trilha-e{font-size:14px;font-weight:600}
.trilha-d{font-size:12.5px;color:var(--sombra-txt);margin-top:2px;line-height:1.45}
.trilha-q{
  font-family:'JetBrains Mono',monospace;font-size:11px;
  color:var(--tenue);margin-top:3px;
}

.selado{
  display:flex;align-items:center;gap:var(--e3);
  background:var(--verde-claro);border:1px solid #BFDDD1;
  border-left:3px solid var(--verde);
  border-radius:var(--r2);padding:var(--e3) var(--e4);
}
.selado-t{font-size:13.5px;font-weight:600;color:#1F5A48}
.selado-d{font-size:12.5px;color:#3E7A63;margin-top:1px;line-height:1.45}

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
const IcoLapis   = (p) => <Ico {...p} d={<><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14.5 7.5 2 2"/></>} />;
const IcoAviso   = (p) => <Ico {...p} d={<><path d="M12 3 2 20h20L12 3z"/><path d="M12 9v5M12 17.5v.5"/></>} />;
const IcoImagem  = (p) => <Ico {...p} d={<><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m3 17 5-5 4 4 3-3 6 6"/></>} />;
const IcoFogo    = (p) => <Ico {...p} d={<><path d="M12 22a6 6 0 0 0 6-6c0-4-3-5-3-9 0 0-3 1-3 4 0-2-2-3-2-3s-1 2-1 4c-1-1-2-2-2-2s-1 2-1 6a6 6 0 0 0 6 6z"/></>} />;
const IcoRelogio = (p) => <Ico {...p} d={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>} />;
const IcoX       = (p) => <Ico {...p} d={<path d="M18 6 6 18M6 6l12 12"/>} />;
const IcoFiltro  = (p) => <Ico {...p} d={<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>} />;
const IcoEscudo  = (p) => <Ico {...p} d={<><path d="M12 3 4 6v6c0 4.5 3.2 8.3 8 9 4.8-.7 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></>} />;
const IcoHistorico = (p) => <Ico {...p} d={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M3.5 9a9 9 0 0 1 1.5-3"/></>} />;
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

/* ── Marca ──
   Símbolo: as duas hastes de um adipômetro, e entre elas a escala.
   O vão é a medida. Em tamanho pequeno (<=20px) as marcas curtas
   viram borrão, então existe uma variante com só as três longas. */
const VB_MARCA = '0 0 746 830';
const D_HASTE  = 'M0.1 664.2L0.2 498.5L2.1 509.3C6.6 534.9 18.0 560.0 34.9 581.6C37.9 585.4 56.2 604.5 75.5 624.0C94.8 643.5 121.4 670.5 134.5 684.0C147.7 697.4 169.5 719.7 183.0 733.5C241.1 792.8 276.6 828.5 277.8 828.8C278.8 829.1 279.0 815.5 278.8 758.3L278.5 687.4L275.5 681.7C272.4 675.8 271.1 674.4 190.0 592.5C133.3 535.2 131.2 532.9 125.6 522.1C115.9 503.2 115.9 503.6 115.9 426.0C115.9 349.0 115.9 349.9 125.3 331.5C130.1 322.2 137.8 314.1 249.4 201.0L316.0 133.6L316.0 67.3L316.0 1.0L296.2 1.0L276.5 1.0L234.5 43.2C211.4 66.5 176.3 101.9 156.5 122.0C136.8 142.1 104.2 175.1 84.1 195.4C63.9 215.7 44.2 236.0 40.2 240.4C19.3 263.4 4.4 295.4 0.7 325.5C0.5 327.1 0.2 254.6 0.1 164.2L0.0 0.0L373.0 0.0L746.0 0.0L746.0 415.0L746.0 830.0L373.0 830.0L0.0 830.0L0.1 664.2Z';
const D_ESCALA = 'M0.0 415.0L0.0 0.0L214.8 -0.0L429.5 -0.0L429.2 66.6L429.0 133.1L510.3 215.3C624.8 331.1 617.4 323.0 623.9 339.9C628.9 352.9 629.0 354.7 629.0 425.9C629.0 498.0 628.9 498.8 623.4 513.3C618.2 527.0 613.2 532.7 562.6 583.9C536.2 610.6 504.9 642.3 493.0 654.3C476.9 670.6 470.9 677.3 469.0 681.3L466.5 686.5L466.2 758.2L465.9 830.0L233.0 830.0L0.0 830.0L0.0 415.0ZM469.2 829.1C469.4 828.6 514.0 783.3 568.5 728.3C706.1 589.5 709.5 586.0 716.6 575.5C732.0 552.8 740.8 530.6 744.5 505.0C745.6 498.0 745.8 525.6 745.9 663.2L746.0 830.0L607.4 830.0C525.6 830.0 469.0 829.6 469.2 829.1ZM413.0 569.5L413.0 565.0L372.5 565.0L332.0 565.0L332.0 569.5L332.0 574.0L372.5 574.0L413.0 574.0L413.0 569.5ZM388.5 534.0L388.5 531.5L372.7 531.2C359.3 531.0 356.9 531.2 356.4 532.5C354.8 536.7 356.2 537.1 372.7 536.8L388.5 536.5L388.5 534.0ZM388.8 500.3C389.2 497.8 384.0 497.2 366.2 497.9C356.2 498.2 356.0 498.3 356.0 500.6L356.0 503.0L372.2 502.8C388.0 502.5 388.5 502.4 388.8 500.3ZM388.8 466.8L389.1 464.0L372.6 464.0L356.0 464.0L356.0 466.3C356.0 470.0 356.4 470.1 372.9 469.8L388.5 469.5L388.8 466.8ZM389.0 433.5L389.0 431.0L372.5 431.0L356.0 431.0L356.0 433.5L356.0 436.0L372.5 436.0L389.0 436.0L389.0 433.5ZM410.5 400.0L410.5 397.5L372.2 397.2L334.0 397.0L334.0 400.0L334.0 403.0L372.2 402.8L410.5 402.5L410.5 400.0ZM389.0 366.5L389.0 364.0L372.5 364.0L356.0 364.0L356.0 366.5L356.0 369.0L372.5 369.0L389.0 369.0L389.0 366.5ZM388.5 333.0L388.5 330.5L372.5 330.5L356.5 330.5L356.2 333.3L355.9 336.1L372.2 335.8L388.5 335.5L388.5 333.0ZM745.0 327.6C745.0 313.2 734.9 283.1 723.9 264.4C713.3 246.4 707.0 239.9 520.2 51.8L468.9 0.0L607.4 0.0L746.0 0.0L746.0 165.5C746.0 256.5 745.8 331.0 745.5 331.0C745.2 331.0 745.0 329.5 745.0 327.6ZM388.8 299.2L389.1 297.0L372.6 297.0L356.0 297.0L356.0 299.5L356.0 302.0L372.2 301.8C388.2 301.5 388.5 301.5 388.8 299.2ZM388.5 266.0L388.5 263.5L372.7 263.2C356.2 262.9 354.8 263.3 356.4 267.5C356.9 268.8 359.3 269.0 372.7 268.8L388.5 268.5L388.5 266.0ZM413.0 231.5L413.0 227.0L372.5 227.0L332.0 227.0L332.0 231.5L332.0 236.0L372.5 236.0L413.0 236.0L413.0 231.5Z';
const D_ESCALA_MIUDA = 'M0.0 415.0L0.0 0.0L214.8 -0.0L429.5 -0.0L429.2 66.6L429.0 133.1L510.3 215.3C624.8 331.1 617.4 323.0 623.9 339.9C628.9 352.9 629.0 354.7 629.0 425.9C629.0 498.0 628.9 498.8 623.4 513.3C618.2 527.0 613.2 532.7 562.6 583.9C536.2 610.6 504.9 642.3 493.0 654.3C476.9 670.6 470.9 677.3 469.0 681.3L466.5 686.5L466.2 758.2L465.9 830.0L233.0 830.0L0.0 830.0L0.0 415.0ZM469.2 829.1C469.4 828.6 514.0 783.3 568.5 728.3C706.1 589.5 709.5 586.0 716.6 575.5C732.0 552.8 740.8 530.6 744.5 505.0C745.6 498.0 745.8 525.6 745.9 663.2L746.0 830.0L607.4 830.0C525.6 830.0 469.0 829.6 469.2 829.1ZM413.0 569.5L413.0 565.0L372.5 565.0L332.0 565.0L332.0 569.5L332.0 574.0L372.5 574.0L413.0 574.0L413.0 569.5ZM410.5 400.0L410.5 397.5L372.2 397.2L334.0 397.0L334.0 400.0L334.0 403.0L372.2 402.8L410.5 402.5L410.5 400.0ZM745.0 327.6C745.0 313.2 734.9 283.1 723.9 264.4C713.3 246.4 707.0 239.9 520.2 51.8L468.9 0.0L607.4 0.0L746.0 0.0L746.0 165.5C746.0 256.5 745.8 331.0 745.5 331.0C745.2 331.0 745.0 329.5 745.0 327.6ZM413.0 231.5L413.0 227.0L372.5 227.0L332.0 227.0L332.0 231.5L332.0 236.0L372.5 236.0L413.0 236.0L413.0 231.5Z';

const Simbolo = ({ tam = 20 }) => (
  <svg viewBox={VB_MARCA} height={tam}
       style={{ display: 'block', flexShrink: 0 }}
       role="img" aria-label="AvaliaLab">
    <path fill="var(--aco)"  d={D_HASTE} />
    <path fill="currentColor" fillRule="evenodd"
          d={tam <= 20 ? D_ESCALA_MIUDA : D_ESCALA} />
  </svg>
);

/* Símbolo + palavra. A palavra fica: o produto ainda é novo
   e um símbolo sozinho não ensina nome a ninguém. */
const Marca = ({ tam = 17, ...resto }) => (
  <span className="marca-l" style={{ fontSize: tam }} {...resto}>
    <Simbolo tam={Math.round(tam * 1.15)} />
    <span className="marca">Avalia<em>Lab</em></span>
  </span>
);

/* ── Assinatura em canvas ──
   O aluno assina com o dedo (celular) ou o mouse. O traço é gravado
   como PNG e guardado junto com a anamnese. Não é assinatura digital
   certificada (ICP-Brasil) — é registro de que aquela pessoa assinou
   aquele documento naquela data. O app é honesto sobre isso. */
const Assinatura = ({ valor, aoMudar }) => {
  const ref = useRef(null);
  const desenhando = useRef(false);
  const ultimo = useRef(null);
  const [vazio, setVazio] = useState(!valor);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    // Resolução real do dispositivo, senão o traço fica serrilhado
    const escala = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    cv.width = r.width * escala;
    cv.height = r.height * escala;
    const ctx = cv.getContext('2d');
    ctx.scale(escala, escala);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#16181A';
  }, []);

  const ponto = (e) => {
    const r = ref.current.getBoundingClientRect();
    const t = e.touches?.[0] || e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };

  const comecar = (e) => {
    e.preventDefault();
    desenhando.current = true;
    ultimo.current = ponto(e);
  };

  const mover = (e) => {
    if (!desenhando.current) return;
    e.preventDefault();
    const ctx = ref.current.getContext('2d');
    const p = ponto(e);
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo.current = p;
    if (vazio) setVazio(false);
  };

  const parar = () => {
    if (!desenhando.current) return;
    desenhando.current = false;
    aoMudar(ref.current.toDataURL('image/png'));
  };

  const limpar = () => {
    const cv = ref.current;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    setVazio(true);
    aoMudar(null);
  };

  return (
    <div className="pilha g2">
      <div className="assina">
        <canvas
          ref={ref}
          className="assina-cv"
          onMouseDown={comecar} onMouseMove={mover}
          onMouseUp={parar} onMouseLeave={parar}
          onTouchStart={comecar} onTouchMove={mover} onTouchEnd={parar}
        />
        {vazio && (
          <div className="assina-dica">Assine aqui com o dedo</div>
        )}
        <div className="assina-linha" />
      </div>
      {!vazio && (
        <button type="button" className="btn btn-3" onClick={limpar}
          style={{ alignSelf: 'flex-start', fontSize: 13 }}>
          Limpar e assinar de novo
        </button>
      )}
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

/* Reabre as observações que foram fundidas numa string só.
   Plano A: obs_partes, gravado desde a migração 003 — exato.
   Plano B: avaliações antigas, sem obs_partes. Aí é parsing por
   prefixo, e é falível: se o profissional escreveu "Perimetria:"
   dentro do texto geral, cai no campo errado. Aceitável, porque
   é uma vez só — ao salvar, obs_partes passa a existir. */
const separarObs = (aval) => {
  if (aval?.obs_partes) {
    const p = aval.obs_partes;
    return { obsAntro: p.antro || '', obsPerim: p.perim || '', obsGeral: p.geral || '' };
  }
  const linhas = (aval?.observacoes || '').split('\n');
  const r = { obsAntro: '', obsPerim: '', obsGeral: [] };
  for (const l of linhas) {
    if (l.startsWith('Antropometria: ')) r.obsAntro = l.slice(15);
    else if (l.startsWith('Perimetria: ')) r.obsPerim = l.slice(12);
    else r.obsGeral.push(l);
  }
  return { ...r, obsGeral: r.obsGeral.join('\n').trim() };
};

function Avaliacao({ aluno, ultima, perfil, edicao, aoSalvar, aoCancelar, toast }) {
  const editando = !!edicao;
  // Rascunho é só para avaliação nova. Numa edição, o rascunho de
  // outra avaliação não pode vazar por cima dos dados reais.
  const chave = RASCUNHO + aluno.id;

  const inicial = () => {
    if (editando) {
      return {
        protocolo: edicao.protocolo,
        data: edicao.data,
        peso: edicao.peso ?? '',
        altura: edicao.altura ?? '',
        nivelAtiv: edicao.resultados?.nivelAtiv ?? 1.55,
        dobras: edicao.dobras || {},
        perim: edicao.perimetros || {},
        ...separarObs(edicao),
        // Sempre vazio ao abrir: o motivo é desta correção, não da anterior.
        motivoEdicao: '',
      };
    }
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

  // Auto-save do rascunho — só para avaliação nova
  useEffect(() => {
    if (editando) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(chave, JSON.stringify(f));
        setRascunhoOk(true);
        setTimeout(() => setRascunhoOk(false), 1600);
      } catch { /* storage cheio: segue sem rascunho */ }
    }, 700);
    return () => clearTimeout(t);
  }, [f, chave, editando]);

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
    // O motivo é obrigatório na correção. A fricção é proposital: quem
    // corrige um dado clínico assinado precisa nomear o que mudou. É esse
    // texto que sustenta o registro se a medição for contestada depois.
    if (editando && f.motivoEdicao.trim().length < 3) {
      toast('Descreva o motivo da correção antes de salvar', 'erro');
      document.getElementById('motivo-edicao')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSalvando(true);
    const obs = [
      f.obsAntro && `Antropometria: ${f.obsAntro}`,
      f.obsPerim && `Perimetria: ${f.obsPerim}`,
      f.obsGeral,
    ].filter(Boolean).join('\n');

    const campos = {
      data: f.data,
      peso: Number(f.peso),
      altura: Number(f.altura),
      protocolo: f.protocolo,
      dobras: f.dobras,
      perimetros: f.perim,
      resultados: resultado,
      observacoes: obs,
      // as três partes cruas, para reabrir o formulário sem parsing
      obs_partes: { antro: f.obsAntro, perim: f.obsPerim, geral: f.obsGeral },
    };

    // Editar NÃO é update. Dado clínico assinado nunca é reescrito: a
    // correção entra como versão nova e a anterior fica marcada como
    // substituída. O trigger registra o diff na trilha.
    //
    // A aba de histórico promete ao aluno que o registro não pode ser
    // alterado "nem por você". Um update silencioso quebrava exatamente
    // essa promessa — era o único caminho no app que mexia em medida já
    // gravada sem deixar rastro.
    const { error } = editando
      ? await supabase.rpc('al_editar_avaliacao', {
          p_id: edicao.id,
          p_campos: campos,
          p_motivo: f.motivoEdicao.trim(),
        })
      : await supabase.from('al_avaliacoes')
          .insert({ ...campos, aluno_id: aluno.id });

    setSalvando(false);

    if (error) {
      const m = error.message || '';
      // Outra aba já corrigiu esta versão. Recarregar evita gravar em
      // cima de uma correção que o profissional não viu.
      if (m.includes('ja_substituida')) {
        toast('Esta avaliação já foi corrigida em outro lugar. Recarregue.', 'erro');
        return;
      }
      toast('Não foi possível salvar. Tente de novo.', 'erro');
      return;
    }
    if (!editando) sessionStorage.removeItem(chave);
    toast(editando ? 'Correção registrada' : 'Avaliação registrada', 'ok');
    aoSalvar();
  };

  const sair = () => {
    // Editando, qualquer saída é perda de alteração: sempre confirma.
    const temDados = editando || preenchidas > 0 || f.obsGeral || f.obsAntro;
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

      {/* ── Motivo da correção — só na edição ── */}
      {editando && (
        <section className="pilha g3">
          <span className="olho">Motivo da correção</span>
          <Cart>
            <div className="pilha g3">
              <div className="aviso aviso-info fila g3">
                <IcoEscudo size={18} />
                <span>
                  A avaliação original não será apagada. Ela fica guardada como
                  versão anterior, e esta correção entra no histórico com o que
                  mudou e o motivo — visível para você e para o aluno.
                </span>
              </div>
              <Campo dica="Ex.: dobra subescapular digitada errada na coleta."
                id="motivo-edicao">
                <textarea id="motivo-edicao" rows={2} value={f.motivoEdicao}
                  placeholder="O que estava errado e por quê"
                  onChange={(e) => set('motivoEdicao', e.target.value)} />
              </Campo>
            </div>
          </Cart>
        </section>
      )}

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
          {editando ? 'Salvar alterações' : 'Salvar avaliação'}
        </Btn>
      </div>

      <Modal aberto={confirmarSaida} aoFechar={() => setConfirmarSaida(false)}
        titulo={editando ? 'Descartar alterações?' : 'Sair sem salvar?'}
        rodape={<>
          <Btn variante="2" onClick={() => setConfirmarSaida(false)}>Continuar aqui</Btn>
          <Btn variante="x" onClick={descartar}>Descartar</Btn>
        </>}>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--grafite)' }}>
          {editando
            ? 'A avaliação continua como estava. O que você alterou aqui se perde.'
            : `O rascunho fica guardado enquanto esta aba estiver aberta.
               Se descartar, as medidas desta avaliação se perdem.`}
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

/* Avaliações salvas antes de o app calcular TMB e GET não têm esses campos
   no jsonb `resultados`. O TMB por Cunningham depende só da massa magra, que
   toda avaliação tem — então dá para reconstruir. O fator de atividade não
   existe nesses registros; assumimos moderado (1,55) e sinalizamos no texto. */
function completarResultados(aval) {
  const r = { ...(aval.resultados || {}) };
  if (r.tmb == null && r.massaMagra > 0) {
    r.tmb = Math.round(tmbCunningham(r.massaMagra));
    r.tmbEstimado = true;
  }
  if (r.get == null && r.tmb > 0) {
    r.fatorAtiv = r.fatorAtiv || 1.55;
    r.get = Math.round(r.tmb * r.fatorAtiv);
    r.getEstimado = true;
  }
  return r;
}

function gerarRelatorio({ aluno, perfil, avaliacoes, anamnese }) {
  const ultima   = avaliacoes[0];
  const anterior = avaliacoes[1] || null;
  const primeira = avaliacoes[avaliacoes.length - 1];
  const r        = completarResultados(ultima);
  const cls      = classificar(r.percentual, aluno.sexo);
  const idade    = idadeDe(aluno.nascimento);
  const temHist  = avaliacoes.length > 1;

  // Páginas: capa, composição, perimetria/saúde e (se houver) o anexo assinado.
  const totalPgs = (anamnese ? 3 : 2) + (anamnese?.assinatura ? 1 : 0);

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
    if (r.get) {
      destaques.push({
        v: `${r.get}`, t: 'Gasto energético diário',
        d: 'Estimativa em quilocalorias, incluindo o nível de atividade', bom: null,
      });
    } else {
      destaques.push({
        v: `${num(r.imc)}`, t: 'IMC',
        d: classificarIMC(r.imc).label, bom: null,
      });
    }
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

  /* ── Anexo: o documento assinado ──
        Sem esta página, o prontuário não serve de nada — a prova
        ficaria só no banco. Aqui ela vira papel. */
  const temAssinatura = !!anamnese?.assinatura;

  const anexoAssinatura = temAssinatura ? `
  <div class="pg">
    <div class="anexo-topo">
      <div>
        <div class="capa-olho">Anexo</div>
        <div class="anexo-tit">Declaração e assinatura</div>
      </div>
      <div class="anexo-selo">Documento assinado</div>
    </div>

    <section class="bloco">
      <h2>Registro do aceite</h2>
      <table class="tb">
        <tbody>
          <tr>
            <td>Assinado por</td>
            <td class="dir forte">${anamnese.assinante_nome || aluno.nome}</td>
          </tr>
          <tr>
            <td>Data e hora</td>
            <td class="dir mn forte">${new Date(anamnese.assinada_em || anamnese.preenchida_em)
              .toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}</td>
          </tr>
          <tr>
            <td>Declarou veracidade das informações</td>
            <td class="dir forte">${anamnese.declarou_veracidade ? 'Sim' : 'Não'}</td>
          </tr>
          ${anamnese.aceitou_termo ? `
          <tr>
            <td>Aceitou o termo de responsabilidade</td>
            <td class="dir forte">Sim, versão ${anamnese.termo_versao}</td>
          </tr>` : ''}
          ${anamnese.user_agent ? `
          <tr>
            <td>Dispositivo</td>
            <td class="dir tenue" style="font-size:9px">${anamnese.user_agent.slice(0, 90)}</td>
          </tr>` : ''}
        </tbody>
      </table>
    </section>

    ${anamnese.termo_texto ? `
    <section class="bloco">
      <h2>Termo aceito, na íntegra</h2>
      <div class="termo-pdf">${anamnese.termo_texto
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/\n/g, '<br>')}</div>
    </section>` : ''}

    <section class="bloco quebra">
      <h2>Assinatura</h2>
      <div class="assina-pdf">
        <img src="${anamnese.assinatura}" alt="">
        <div class="assina-nome">${anamnese.assinante_nome || aluno.nome}</div>
        <div class="assina-data">
          Assinado em ${new Date(anamnese.assinada_em || anamnese.preenchida_em)
            .toLocaleDateString('pt-BR')}
        </div>
      </div>
    </section>

    <div class="glos">
      Este anexo registra o que o avaliado declarou e em que data. Ele constitui
      registro profissional de saúde, e não assinatura digital com certificado
      ICP-Brasil. A guarda deste documento é de responsabilidade do profissional
      que o emitiu.
    </div>

    <div class="rod">
      <div>
        <b>${aluno.nome}</b> &middot; Anexo de declaração e assinatura
      </div>
      <div class="rod-p">${totalPgs} / ${totalPgs}</div>
    </div>
  </div>` : '';

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
  .marca-l{display:flex;align-items:center;gap:9px}
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

  /* ── Anexo assinado ── */
  .anexo-topo{
    display:flex;justify-content:space-between;align-items:flex-start;
    padding-bottom:14px;margin-bottom:9mm;border-bottom:2px solid #16181A;
  }
  .anexo-tit{
    font-family:'Instrument Sans',sans-serif;font-weight:600;
    font-size:26px;letter-spacing:-.02em;margin-top:4px;
  }
  .anexo-selo{
    font-size:9px;font-weight:600;color:#2F7A63;
    text-transform:uppercase;letter-spacing:.11em;
    border:1.5px solid #BFDDD1;background:#EAF4F0;
    border-radius:20px;padding:5px 12px;white-space:nowrap;
  }

  .termo-pdf{
    font-size:10px;line-height:1.65;color:#55595E;
    background:#FAFAF8;border:1px solid #E2E5E3;
    border-radius:8px;padding:14px 16px;
  }

  .assina-pdf{
    border:1px solid #E2E5E3;border-radius:9px;
    padding:20px;text-align:center;background:#fff;
  }
  .assina-pdf img{
    max-height:80px;max-width:280px;display:block;margin:0 auto 6px;
  }
  .assina-nome{
    font-size:12px;font-weight:600;
    border-top:1px solid #16181A;
    display:inline-block;padding:7px 40px 0;margin-top:2px;
  }
  .assina-data{font-size:9.5px;color:#878C92;margin-top:5px}

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
      : `<div class="marca-l">
           <svg viewBox="0 0 746 830" height="30" aria-hidden="true">
             <path fill="#2F5D62" d="M0.1 664.2L0.2 498.5L2.1 509.3C6.6 534.9 18.0 560.0 34.9 581.6C37.9 585.4 56.2 604.5 75.5 624.0C94.8 643.5 121.4 670.5 134.5 684.0C147.7 697.4 169.5 719.7 183.0 733.5C241.1 792.8 276.6 828.5 277.8 828.8C278.8 829.1 279.0 815.5 278.8 758.3L278.5 687.4L275.5 681.7C272.4 675.8 271.1 674.4 190.0 592.5C133.3 535.2 131.2 532.9 125.6 522.1C115.9 503.2 115.9 503.6 115.9 426.0C115.9 349.0 115.9 349.9 125.3 331.5C130.1 322.2 137.8 314.1 249.4 201.0L316.0 133.6L316.0 67.3L316.0 1.0L296.2 1.0L276.5 1.0L234.5 43.2C211.4 66.5 176.3 101.9 156.5 122.0C136.8 142.1 104.2 175.1 84.1 195.4C63.9 215.7 44.2 236.0 40.2 240.4C19.3 263.4 4.4 295.4 0.7 325.5C0.5 327.1 0.2 254.6 0.1 164.2L0.0 0.0L373.0 0.0L746.0 0.0L746.0 415.0L746.0 830.0L373.0 830.0L0.0 830.0L0.1 664.2Z"/>
             <path fill="#16181A" fill-rule="evenodd" d="M0.0 415.0L0.0 0.0L214.8 -0.0L429.5 -0.0L429.2 66.6L429.0 133.1L510.3 215.3C624.8 331.1 617.4 323.0 623.9 339.9C628.9 352.9 629.0 354.7 629.0 425.9C629.0 498.0 628.9 498.8 623.4 513.3C618.2 527.0 613.2 532.7 562.6 583.9C536.2 610.6 504.9 642.3 493.0 654.3C476.9 670.6 470.9 677.3 469.0 681.3L466.5 686.5L466.2 758.2L465.9 830.0L233.0 830.0L0.0 830.0L0.0 415.0ZM469.2 829.1C469.4 828.6 514.0 783.3 568.5 728.3C706.1 589.5 709.5 586.0 716.6 575.5C732.0 552.8 740.8 530.6 744.5 505.0C745.6 498.0 745.8 525.6 745.9 663.2L746.0 830.0L607.4 830.0C525.6 830.0 469.0 829.6 469.2 829.1ZM413.0 569.5L413.0 565.0L372.5 565.0L332.0 565.0L332.0 569.5L332.0 574.0L372.5 574.0L413.0 574.0L413.0 569.5ZM388.5 534.0L388.5 531.5L372.7 531.2C359.3 531.0 356.9 531.2 356.4 532.5C354.8 536.7 356.2 537.1 372.7 536.8L388.5 536.5L388.5 534.0ZM388.8 500.3C389.2 497.8 384.0 497.2 366.2 497.9C356.2 498.2 356.0 498.3 356.0 500.6L356.0 503.0L372.2 502.8C388.0 502.5 388.5 502.4 388.8 500.3ZM388.8 466.8L389.1 464.0L372.6 464.0L356.0 464.0L356.0 466.3C356.0 470.0 356.4 470.1 372.9 469.8L388.5 469.5L388.8 466.8ZM389.0 433.5L389.0 431.0L372.5 431.0L356.0 431.0L356.0 433.5L356.0 436.0L372.5 436.0L389.0 436.0L389.0 433.5ZM410.5 400.0L410.5 397.5L372.2 397.2L334.0 397.0L334.0 400.0L334.0 403.0L372.2 402.8L410.5 402.5L410.5 400.0ZM389.0 366.5L389.0 364.0L372.5 364.0L356.0 364.0L356.0 366.5L356.0 369.0L372.5 369.0L389.0 369.0L389.0 366.5ZM388.5 333.0L388.5 330.5L372.5 330.5L356.5 330.5L356.2 333.3L355.9 336.1L372.2 335.8L388.5 335.5L388.5 333.0ZM745.0 327.6C745.0 313.2 734.9 283.1 723.9 264.4C713.3 246.4 707.0 239.9 520.2 51.8L468.9 0.0L607.4 0.0L746.0 0.0L746.0 165.5C746.0 256.5 745.8 331.0 745.5 331.0C745.2 331.0 745.0 329.5 745.0 327.6ZM388.8 299.2L389.1 297.0L372.6 297.0L356.0 297.0L356.0 299.5L356.0 302.0L372.2 301.8C388.2 301.5 388.5 301.5 388.8 299.2ZM388.5 266.0L388.5 263.5L372.7 263.2C356.2 262.9 354.8 263.3 356.4 267.5C356.9 268.8 359.3 269.0 372.7 268.8L388.5 268.5L388.5 266.0ZM413.0 231.5L413.0 227.0L372.5 227.0L332.0 227.0L332.0 231.5L332.0 236.0L372.5 236.0L413.0 236.0L413.0 231.5Z"/>
           </svg>
           <div class="marca">Avalia<em>Lab</em></div>
         </div>`}
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
      Página <span class="rod-p">1</span> de <span class="rod-p">${totalPgs}</span>
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

    ${r.tmb ? `
    <div class="ener">
      <div>
        <div class="ener-k">Taxa metabólica basal</div>
        <div class="ener-v">${r.tmb} <small>kcal/dia</small></div>
        <div class="ener-d">O que o corpo gasta em repouso absoluto.</div>
      </div>
      <div>
        <div class="ener-k">Gasto energético total</div>
        <div class="ener-v">${r.get} <small>kcal/dia</small></div>
        <div class="ener-d">${r.getEstimado
          ? 'Estimado com nível de atividade moderado.'
          : 'Já considerando seu nível de atividade.'}</div>
      </div>
    </div>` : ''}
  </section>

  ${tabelaDobras}
  ${graficoEvolucao}
  ${tabelaEvolucao}

  <div class="rod">
    <div>
      <b>${aluno.nome}</b> &middot; Avaliação de ${data(ultima.data)}
    </div>
    <div class="rod-p">2 / ${totalPgs}</div>
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
    <div class="rod-p">3 / ${totalPgs}</div>
  </div>
</div>

${anexoAssinatura}

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
          <Marca tam={26} style={{ justifyContent: 'center' }} />
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
  const [dados, setDados]   = useState(null);   // aluno + termo + profissional
  const [resp, setResp]     = useState({});
  const [assinatura, setAssinatura] = useState(null);
  const [nomeAssina, setNomeAssina] = useState('');
  const [declarou, setDeclarou]     = useState(false);
  const [aceitouTermo, setAceitou]  = useState(false);
  const [busy, setBusy]     = useState(false);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro]     = useState('');
  const [expirado, setExpirado]     = useState(false);
  const [carregando, setCarregando] = useState(true);

  const chave = 'al:anam:' + token;

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('al_buscar_por_token', { p_token: token });
      const reg = data?.[0];
      if (error || !reg) {
        setErro('Este link não é válido.');
        setCarregando(false);
        return;
      }
      if (reg.expirado) { setExpirado(true); setCarregando(false); return; }
      if (reg.ja_preenchida) { setPronto(true); setCarregando(false); return; }

      setDados(reg);
      try {
        const salvo = localStorage.getItem(chave);
        if (salvo) {
          const s = JSON.parse(salvo);
          setResp(s.resp || {});
          setNomeAssina(s.nome || '');
        }
      } catch { /* rascunho corrompido: ignora */ }
      setCarregando(false);
    })();
  }, [token, chave]);

  // Rascunho: o aluno pode fechar e voltar depois.
  // A assinatura não é salva — tem que ser feita no ato do envio.
  useEffect(() => {
    if (pronto || !Object.keys(resp).length) return;
    try {
      localStorage.setItem(chave, JSON.stringify({ resp, nome: nomeAssina }));
    } catch { /* storage cheio */ }
  }, [resp, nomeAssina, chave, pronto]);

  const set = (k, v) => { setResp((x) => ({ ...x, [k]: v })); setErro(''); };

  const alternar = (k, op) => {
    const atual = resp[k] || [];
    set(k, atual.includes(op) ? atual.filter((x) => x !== op) : [...atual, op]);
  };

  const obrigatorias = ANAMNESE.flatMap((s) => s.itens)
    .filter((i) => i.t === 'sn' || i.t === 'unica');
  const respondidas = obrigatorias.filter((i) => resp[i.k]).length;

  const temTermo = !!dados?.termo_texto;
  const passos = obrigatorias.length + 3 + (temTermo ? 1 : 0);
  const feitos = respondidas
    + (assinatura ? 1 : 0)
    + (nomeAssina.trim().length >= 3 ? 1 : 0)
    + (declarou ? 1 : 0)
    + (temTermo && aceitouTermo ? 1 : 0);
  const progresso = Math.round((feitos / passos) * 100);

  const enviar = async () => {
    const falta = obrigatorias.find((i) => !resp[i.k]);
    if (falta) {
      setErro('Ainda faltam respostas. Role a página e confira as perguntas marcadas.');
      document.getElementById('p-' + falta.k)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (temTermo && !aceitouTermo) {
      setErro('É preciso ler e aceitar o termo de responsabilidade.');
      document.getElementById('assinar')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (nomeAssina.trim().length < 3) {
      setErro('Digite seu nome completo para assinar.');
      document.getElementById('assinar')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (!declarou) {
      setErro('É preciso declarar que as informações são verdadeiras.');
      document.getElementById('assinar')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (!assinatura) {
      setErro('Assine no quadro antes de enviar.');
      document.getElementById('assinar')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc('al_enviar_anamnese', {
      p_token: token,
      p_respostas: resp,
      p_assinatura: assinatura,
      p_nome: nomeAssina.trim(),
      p_termo_versao: temTermo ? dados.termo_versao : null,
      p_termo_texto: temTermo ? dados.termo_texto : null,
      p_user_agent: navigator.userAgent.slice(0, 300),
    });
    setBusy(false);

    if (error) {
      const m = error.message || '';
      if (m.includes('ja_preenchida')) { setPronto(true); return; }
      if (m.includes('token_expirado')) { setExpirado(true); return; }
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

  if (expirado) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--e4)' }}>
      <Cart style={{ maxWidth: 380, textAlign: 'center' }}>
        <div className="pilha g3" style={{ alignItems: 'center' }}>
          <span style={{ color: 'var(--tenue)' }}><IcoRelogio size={28} /></span>
          <div className="tit t3">Este link expirou</div>
          <div className="dica">
            Por segurança, o link vale sete dias. Peça um novo ao seu profissional.
          </div>
        </div>
      </Cart>
    </div>
  );

  if (erro && !dados) return (
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
          <div className="tit t2">Recebido e assinado</div>
          <div style={{ fontSize: 14.5, color: 'var(--grafite)', lineHeight: 1.6 }}>
            Suas respostas foram registradas com data e hora. Seu profissional
            já tem tudo. Pode fechar esta página.
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
          <Marca tam={13} />
          <span className="mono">{progresso}%</span>
        </div>
      </div>

      <div style={{ marginBottom: 'var(--e6)' }}>
        <h1 className="tit t1">Olá, {dados.nome.split(' ')[0]}.</h1>
        <p style={{
          fontSize: 14.5, color: 'var(--grafite)',
          marginTop: 'var(--e2)', lineHeight: 1.6,
        }}>
          Estas perguntas levam cerca de cinco minutos e ajudam
          {dados.prof_nome ? ` ${dados.prof_nome.split(' ')[0]}` : ' seu profissional'} a
          montar um treino seguro para você. Ao final, você assina — isso registra
          o que foi informado e em que data.
        </p>
        <p className="dica" style={{ marginTop: 'var(--e2)' }}>
          Responda com sinceridade. Nada aqui é julgamento, e omitir uma
          condição de saúde é o que coloca você em risco.
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
                        fontSize: 14.5, lineHeight: 1.5,
                        marginBottom: 'var(--e3)', fontWeight: 500,
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
                            <Btn key={op} variante={resp[it.k] === op ? '1' : '2'}
                              cheio onClick={() => set(it.k, op)}>{op}</Btn>
                          ))}
                        </div>
                      )}

                      {it.t === 'unica' && (
                        <div className="pilha g2">
                          {it.opcoes.map((op) => (
                            <Btn key={op} variante={resp[it.k] === op ? '1' : '2'}
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

        {/* ── Termo e assinatura ── */}
        <section className="pilha g3" id="assinar">
          <div>
            <span className="olho">Declaração e assinatura</span>
            <p className="dica" style={{ marginTop: 4 }}>
              Esta é a parte que transforma suas respostas em um registro
              com data. Leia antes de assinar.
            </p>
          </div>

          <Cart>
            <div className="pilha g5">

              {temTermo && (
                <div className="pilha g3">
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                    Termo de responsabilidade
                  </span>
                  <div className="termo">{dados.termo_texto}</div>
                  <button type="button"
                    className={`caixa ${aceitouTermo ? 'marcada' : ''}`}
                    onClick={() => { setAceitou(!aceitouTermo); setErro(''); }}
                    aria-pressed={aceitouTermo}>
                    <span className="caixa-q"><IcoCheck size={13} /></span>
                    <span className="caixa-t">
                      Li o termo acima por completo e concordo com o seu conteúdo.
                    </span>
                  </button>
                </div>
              )}

              <div className="pilha g3">
                <button type="button"
                  className={`caixa ${declarou ? 'marcada' : ''}`}
                  onClick={() => { setDeclarou(!declarou); setErro(''); }}
                  aria-pressed={declarou}>
                  <span className="caixa-q"><IcoCheck size={13} /></span>
                  <span className="caixa-t">
                    Declaro que todas as informações que dei aqui são verdadeiras
                    e completas, e que não omiti nenhuma condição de saúde,
                    lesão ou medicamento.
                  </span>
                </button>
              </div>

              <Campo rot="Seu nome completo" id="nomeass"
                dica="Digite como está no seu documento.">
                <input id="nomeass" value={nomeAssina}
                  autoComplete="name"
                  placeholder={dados.nome}
                  onChange={(e) => { setNomeAssina(e.target.value); setErro(''); }} />
              </Campo>

              <div className="pilha g2">
                <span className="rot">Assinatura</span>
                <Assinatura valor={assinatura}
                  aoMudar={(v) => { setAssinatura(v); setErro(''); }} />
                <span className="dica">
                  Use o dedo, se estiver no celular. Pode limpar e refazer
                  quantas vezes quiser.
                </span>
              </div>

              <div className="aviso aviso-info" style={{ fontSize: 12.5 }}>
                Ao enviar, ficam registrados a data, a hora e o dispositivo usado.
                Este documento é um registro profissional de saúde — não é
                assinatura digital com certificado ICP-Brasil.
              </div>
            </div>
          </Cart>
        </section>
      </div>

      <Btn variante="1" tam="g" cheio carregando={busy} onClick={enviar}
        style={{ marginTop: 'var(--e5)' }}>
        Assinar e enviar
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
  const [editar, setEditar] = useState(null);   // avaliação sendo editada
  const [load, setLoad]     = useState(true);
  const [aberta, setAberta] = useState(null);
  const [excluirAval, setExcluirAval] = useState(null);
  const [renovando, setRenovando] = useState(false);
  const [tokenAtual, setTokenAtual] = useState(aluno.token_anamnese);
  const [expiraEm, setExpiraEm] = useState(aluno.token_expira_em);
  const [historico, setHistorico] = useState([]);
  const [adendos, setAdendos] = useState([]);
  const [novoAdendo, setNovoAdendo] = useState(false);
  const [adendoResp, setAdendoResp] = useState({});
  const [adendoMotivo, setAdendoMotivo] = useState('');
  const [salvandoAdendo, setSalvandoAdendo] = useState(false);

  // A anamnese assinada é imutável. O que o app mostra é o estado efetivo:
  // a base com os adendos aplicados em ordem. Nada é sobrescrito — a base
  // original continua reconstruível a qualquer momento, e é ela que carrega
  // a assinatura e a versão do termo aceito.
  const anamneseEfetiva = useMemo(() => {
    if (!anam) return null;
    return adendos.reduce(
      (acc, ad) => ({ ...acc, ...ad.respostas }),
      anam.respostas || {}
    );
  }, [anam, adendos]);

  // Campos que já foram alterados por algum adendo. Marcados na tela para
  // que o profissional saiba que aquela resposta não é mais a da assinatura.
  const camposComAdendo = useMemo(() => {
    const s = new Set();
    adendos.forEach((ad) => Object.keys(ad.respostas || {}).forEach((k) => s.add(k)));
    return s;
  }, [adendos]);

  const carregar = useCallback(async () => {
    setLoad(true);
    const [{ data: a }, { data: an }, { data: h }, { data: ad }] = await Promise.all([
      // Só as vigentes. Versões substituídas continuam no banco — é o que
      // dá lastro à trilha — mas não entram em gráfico, relatório nem
      // comparativo. Para o resto do app, existe uma avaliação por data.
      supabase.from('al_avaliacoes').select('*')
        .eq('aluno_id', aluno.id)
        .is('substituida_por', null)
        .order('data', { ascending: false }),
      supabase.from('al_anamneses').select('*')
        .eq('aluno_id', aluno.id).maybeSingle(),
      supabase.rpc('al_historico', { p_aluno: aluno.id }),
      supabase.from('al_anamnese_adendos').select('*')
        .eq('aluno_id', aluno.id)
        .order('criado_em', { ascending: true }),
    ]);
    setAvals(a || []);
    setAnam(an);
    setHistorico(h || []);
    setAdendos(ad || []);
    setLoad(false);
  }, [aluno.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const link = `${window.location.origin}/a/${tokenAtual}`;

  const linkExpirado = expiraEm ? new Date(expiraEm) < new Date() : false;
  const diasRestantes = (() => {
    if (!expiraEm) return null;
    const d = Math.ceil((new Date(expiraEm) - new Date()) / 86400000);
    if (d <= 0) return null;
    return d === 1 ? '1 dia' : `${d} dias`;
  })();

  const renovarLink = async () => {
    setRenovando(true);
    const { data, error } = await supabase.rpc('al_renovar_token', { p_aluno: aluno.id });
    setRenovando(false);
    if (error || !data) { toast('Não foi possível gerar o link', 'erro'); return; }
    setTokenAtual(data);
    setExpiraEm(new Date(Date.now() + 7 * 86400000).toISOString());
    toast('Link novo gerado. Vale por sete dias.', 'ok');
  };

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

  // O relatório recebe a base assinada E os adendos. Passar só `anam`
  // faria o PDF mostrar a resposta da assinatura para um campo que já foi
  // corrigido — o mesmo buraco do PAR-Q, só que impresso e entregue.
  const relatorio = () => {
    if (!avals.length) return toast('Nenhuma avaliação para exportar', 'erro');
    gerarRelatorio({
      aluno, perfil, avaliacoes: avals,
      anamnese: anam, adendos, anamneseEfetiva,
    });
  };

  const salvarAdendo = async () => {
    const campos = Object.keys(adendoResp);
    if (!campos.length) {
      toast('Selecione ao menos uma resposta para atualizar', 'erro');
      return;
    }
    if (adendoMotivo.trim().length < 3) {
      toast('Descreva o que o aluno relatou', 'erro');
      return;
    }
    setSalvandoAdendo(true);
    const { error } = await supabase.from('al_anamnese_adendos').insert({
      anamnese_id: anam.id,
      aluno_id: aluno.id,
      origem: 'profissional',
      respostas: adendoResp,
      motivo: adendoMotivo.trim(),
    });
    setSalvandoAdendo(false);
    if (error) { toast('Não foi possível registrar o adendo', 'erro'); return; }
    setNovoAdendo(false);
    setAdendoResp({});
    setAdendoMotivo('');
    carregar();
    toast('Adendo registrado', 'ok');
  };

  if (nova) return (
    <Avaliacao aluno={aluno} perfil={perfil} ultima={avals[0]} toast={toast}
      aoSalvar={() => { setNova(false); carregar(); }}
      aoCancelar={() => setNova(false)} />
  );

  if (editar) return (
    <Avaliacao aluno={aluno} perfil={perfil} edicao={editar} toast={toast}
      aoSalvar={() => { setEditar(null); carregar(); }}
      aoCancelar={() => setEditar(null)} />
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
          { v: 'historico', l: 'Histórico', selo: historico.length || null },
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
                  const res = completarResultados(a);
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

                            <div className="fila g2">
                              <Btn variante="2" tam="p"
                                onClick={() => setEditar(a)}>
                                <IcoLapis size={15} /> Editar
                              </Btn>
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
              <div className="entre">
                <div>
                  <span className="olho">Link para o aluno</span>
                  <p className="dica" style={{ marginTop: 4 }}>
                    {anam
                      ? 'Já assinada. O link não aceita novo envio.'
                      : 'Mande por WhatsApp. Ele preenche e assina pelo celular.'}
                  </p>
                </div>
                {!anam && (
                  linkExpirado
                    ? <Selo tom="alto">Expirado</Selo>
                    : <Selo tom="info">Vale {diasRestantes}</Selo>
                )}
              </div>

              {!anam && (
                <>
                  <div className="fila g2">
                    <input readOnly value={link} className="mono"
                      onClick={(e) => e.target.select()}
                      disabled={linkExpirado}
                      style={{ fontSize: 12.5, color: 'var(--grafite)' }} />
                    <Btn variante="2" onClick={copiar} disabled={linkExpirado}>
                      <IcoCopia size={16} /> Copiar
                    </Btn>
                  </div>

                  {linkExpirado && (
                    <div className="aviso aviso-alerta fila g3">
                      <IcoAviso size={18} />
                      <span>
                        Este link passou dos sete dias. Gere um novo para
                        que o aluno possa preencher.
                      </span>
                    </div>
                  )}

                  <Btn variante={linkExpirado ? '1' : '3'} tam="p"
                    carregando={renovando} onClick={renovarLink}
                    style={linkExpirado ? {} : { alignSelf: 'flex-start' }}>
                    Gerar link novo
                  </Btn>
                </>
              )}
            </div>
          </Cart>

          {!anam ? (
            <Cart>
              <Vazio
                ico={<IcoRelogio size={30} />}
                titulo="Aguardando o aluno"
                desc="As respostas aparecem aqui assim que ele assinar e enviar." />
            </Cart>
          ) : (
            <>
              {anam.assinatura ? (
                <Cart>
                  <div className="pilha g4">
                    <div className="selado">
                      <span style={{ color: 'var(--verde)', flexShrink: 0 }}>
                        <IcoEscudo size={20} />
                      </span>
                      <div>
                        <div className="selado-t">Assinada e registrada</div>
                        <div className="selado-d">
                          Por {anam.assinante_nome}, em{' '}
                          {new Date(anam.assinada_em || anam.preenchida_em)
                            .toLocaleString('pt-BR', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}.
                          {anam.declarou_veracidade && ' Declarou veracidade das informações.'}
                          {anam.aceitou_termo && ` Aceitou o termo (versão ${anam.termo_versao}).`}
                        </div>
                      </div>
                    </div>

                    <div className="pilha g2">
                      <span className="olho">Assinatura</span>
                      <div style={{
                        background: 'var(--papel)', border: '1px solid var(--regua)',
                        borderRadius: 'var(--r2)', padding: 'var(--e3)',
                        display: 'grid', placeItems: 'center',
                      }}>
                        <img src={anam.assinatura} alt="Assinatura do aluno"
                          style={{ maxHeight: 90, maxWidth: '100%' }} />
                      </div>
                    </div>
                  </div>
                </Cart>
              ) : (
                <div className="aviso aviso-alerta fila g3">
                  <IcoAviso size={18} />
                  <span>
                    Esta anamnese foi preenchida antes da assinatura existir.
                    Ela não tem valor de prova. Para regularizar, exclua e
                    peça ao aluno que preencha de novo.
                  </span>
                </div>
              )}

              {/* ── Adendos ── */}
              <Cart>
                <div className="pilha g4">
                  <div className="entre">
                    <div>
                      <span className="olho">Adendos</span>
                      <p className="dica" style={{ marginTop: 4 }}>
                        A anamnese assinada não pode ser alterada. Informação
                        nova entra como adendo, sem apagar o que foi assinado.
                      </p>
                    </div>
                    {adendos.length > 0 && (
                      <Selo tom="info">{adendos.length}</Selo>
                    )}
                  </div>

                  {adendos.length > 0 && (
                    <div className="trilha">
                      {adendos.map((ad) => {
                        const doAluno = ad.origem === 'aluno';
                        return (
                          <div key={ad.id}
                            className={`trilha-i ${doAluno ? 'forte' : ''}`}>
                            <div className="trilha-e">
                              {doAluno
                                ? `Assinado por ${ad.nome_assina}`
                                : 'Registrado pelo profissional'}
                            </div>
                            <div className="trilha-d">
                              {Object.keys(ad.respostas || {}).length}
                              {Object.keys(ad.respostas || {}).length === 1
                                ? ' campo atualizado' : ' campos atualizados'}
                              {ad.motivo ? `. ${ad.motivo}` : '.'}
                              {!doAluno && ' Relato do aluno, sem assinatura.'}
                            </div>
                            <div className="trilha-q">
                              {new Date(ad.criado_em).toLocaleString('pt-BR', {
                                day: '2-digit', month: '2-digit', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="aviso aviso-info fila g3">
                    <IcoEscudo size={18} />
                    <span>
                      Adendo assinado pelo aluno tem o mesmo peso da anamnese
                      original. Adendo registrado por você vale como relato
                      anotado em consulta — fica claro no prontuário e no
                      relatório qual é qual.
                    </span>
                  </div>

                  <div className="fila g2" style={{ flexWrap: 'wrap' }}>
                    <Btn variante="2" tam="p"
                      carregando={renovando} onClick={renovarLink}>
                      <IcoCopia size={15} /> Gerar link de adendo
                    </Btn>
                    <Btn variante="3" tam="p" onClick={() => setNovoAdendo(true)}>
                      Registrar relato
                    </Btn>
                  </div>

                  {tokenAtual && !linkExpirado && (
                    <div className="fila g2">
                      <input readOnly value={link} className="mono"
                        onClick={(e) => e.target.select()}
                        style={{ fontSize: 12.5, color: 'var(--grafite)' }} />
                      <Btn variante="2" onClick={copiar}>
                        <IcoCopia size={16} /> Copiar
                      </Btn>
                    </div>
                  )}
                </div>
              </Cart>

              {/* As respostas exibidas são o estado EFETIVO: base + adendos.
                  Isso importa para o PAR-Q. Se o aluno relatou dor no peito
                  num adendo, o alerta tem que acender aqui — ler da base
                  assinada mostraria "Não" para uma contraindicação real. */}
              {ANAMNESE.map((sec) => {
                const alertas = sec.itens.filter(
                  (i) => i.k.startsWith('parq') && anamneseEfetiva[i.k] === 'Sim'
                );
                const alterados = sec.itens.filter((i) => camposComAdendo.has(i.k)).length;
                return (
                  <Cart key={sec.secao}>
                    <div className="pilha g4">
                      <div className="entre">
                        <span className="olho">{sec.secao}</span>
                        <div className="fila g2">
                          {alterados > 0 && (
                            <Selo tom="info">
                              {alterados} atualizado{alterados === 1 ? '' : 's'}
                            </Selo>
                          )}
                          {alertas.length > 0 && (
                            <Selo tom="medio">
                              <IcoAviso size={12} />
                              {alertas.length} a observar
                            </Selo>
                          )}
                        </div>
                      </div>

                      <div className="pilha g4">
                        {sec.itens.map((it) => {
                          const v = anamneseEfetiva[it.k];
                          if (!v || (Array.isArray(v) && !v.length)) return null;
                          const alerta = it.k.startsWith('parq') && v === 'Sim';
                          const mudou = camposComAdendo.has(it.k);
                          const orig = anam.respostas?.[it.k];
                          return (
                            <div key={it.k}>
                              <div className="dica">{it.q}</div>
                              <div style={{
                                fontSize: 14.5, fontWeight: 600, marginTop: 2,
                                color: alerta ? 'var(--ambar)' : 'var(--tinta)',
                              }}>
                                {Array.isArray(v) ? v.join(', ') : v}
                              </div>
                              {mudou && (
                                <div className="dica" style={{ marginTop: 3 }}>
                                  Atualizado por adendo.
                                  {orig && ` Na assinatura: ${
                                    Array.isArray(orig) ? orig.join(', ') : orig
                                  }.`}
                                </div>
                              )}
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

      {!load && aba === 'historico' && (
        <div className="pilha g4">
          <div className="aviso aviso-info fila g3">
            <IcoEscudo size={18} />
            <span>
              Este histórico não pode ser editado nem apagado — nem por você.
              É o que dá peso ao prontuário: um registro que o próprio
              profissional pudesse alterar depois não provaria nada.
            </span>
          </div>

          {!historico.length ? (
            <Cart>
              <Vazio
                ico={<IcoHistorico size={30} />}
                titulo="Nada registrado ainda"
                desc="Cada anamnese assinada e cada avaliação lançada aparece aqui, com data e hora." />
            </Cart>
          ) : (
            <Cart>
              <div className="trilha">
                {historico.map((h, i) => {
                  const forte = EVENTO_FORTE.includes(h.evento);
                  return (
                    <div key={i} className={`trilha-i ${forte ? 'forte' : ''}`}>
                      <div className="trilha-e">{ROTULO_EVENTO[h.evento] || h.evento}</div>
                      <div className="trilha-d">{descreverEvento(h)}</div>
                      <div className="trilha-q">
                        {new Date(h.em).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Cart>
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

      {/* ── Adendo registrado pelo profissional ──
          Sem assinatura, por definição: quem está digitando é você, não o
          aluno. Por isso o registro é explicitamente rotulado como relato
          em todo lugar que aparece. Fingir que isso equivale a uma
          declaração assinada seria justamente o que tira o valor do
          prontuário. Para informação sensível, o caminho é o link. */}
      <Modal aberto={novoAdendo} aoFechar={() => setNovoAdendo(false)}
        titulo="Registrar relato do aluno"
        rodape={<>
          <Btn variante="2" onClick={() => setNovoAdendo(false)}>Cancelar</Btn>
          <Btn variante="1" onClick={salvarAdendo} carregando={salvandoAdendo}>
            Registrar adendo
          </Btn>
        </>}>
        <div className="pilha g4">
          <div className="aviso aviso-alerta fila g3">
            <IcoAviso size={18} />
            <span>
              Este adendo <strong>não é assinado pelo aluno</strong>. Vale como
              anotação sua do que ele relatou. Se a informação for sensível —
              condição cardíaca, gestação, lesão nova — prefira mandar o link
              para que ele mesmo declare e assine.
            </span>
          </div>

          <Campo rot="O que o aluno relatou" id="adendo-motivo"
            dica="Fica registrado no histórico junto com a data.">
            <textarea id="adendo-motivo" rows={2} value={adendoMotivo}
              placeholder="Ex.: relatou dor lombar nova durante a sessão de hoje"
              onChange={(e) => setAdendoMotivo(e.target.value)} />
          </Campo>

          <div className="pilha g3">
            <span className="olho">Respostas a atualizar</span>
            <p className="dica">
              Só o que você mexer entra no adendo. O resto continua valendo
              como foi assinado.
            </p>

            {ANAMNESE.map((sec) => (
              <div key={sec.secao} className="pilha g3">
                <span className="rot">{sec.secao}</span>
                {sec.itens.map((it) => {
                  const atual = adendoResp[it.k] ?? anamneseEfetiva?.[it.k] ?? '';
                  const mexeu = it.k in adendoResp;
                  const set = (v) => setAdendoResp((p) => ({ ...p, [it.k]: v }));
                  const limpar = () => setAdendoResp((p) => {
                    const n = { ...p }; delete n[it.k]; return n;
                  });
                  return (
                    <div key={it.k} className="pilha g2">
                      <div className="entre">
                        <span className="dica" style={{ flex: 1 }}>{it.q}</span>
                        {mexeu && (
                          <Btn variante="3" tam="p" onClick={limpar}>Desfazer</Btn>
                        )}
                      </div>

                      {it.t === 'sn' && (
                        <div className="fila g2">
                          {['Sim', 'Não'].map((op) => (
                            <Btn key={op} tam="p"
                              variante={atual === op ? '1' : '2'}
                              onClick={() => set(op)}>{op}</Btn>
                          ))}
                        </div>
                      )}

                      {it.t === 'texto' && (
                        <textarea rows={2} value={atual}
                          onChange={(e) => set(e.target.value)} />
                      )}

                      {it.t === 'multi' && (
                        <div className="fila g2" style={{ flexWrap: 'wrap' }}>
                          {(it.opcoes || []).map((op) => {
                            const arr = Array.isArray(atual) ? atual : [];
                            const on = arr.includes(op);
                            return (
                              <Btn key={op} tam="p"
                                variante={on ? '1' : '2'}
                                onClick={() => set(on
                                  ? arr.filter((x) => x !== op)
                                  : [...arr, op])}>{op}</Btn>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
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
        // Vigentes apenas: senão a contagem por aluno somaria as versões
        // substituídas e a "última avaliação" poderia apontar para uma
        // versão já corrigida.
        supabase.from('al_avaliacoes').select('aluno_id, data')
          .in('aluno_id', ids).is('substituida_por', null),
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

  const [termo, setTermo] = useState('');
  const [termoVersao, setTermoVersao] = useState(null);
  const [termoSalvo, setTermoSalvo] = useState('');
  const [salvandoTermo, setSalvandoTermo] = useState(false);
  const [confirmarTermo, setConfirmarTermo] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('al_termos')
        .select('texto, versao')
        .eq('profile_id', perfil.id)
        .order('versao', { ascending: false })
        .limit(1);
      const t = data?.[0];
      if (t) {
        setTermo(t.texto);
        setTermoSalvo(t.texto);
        setTermoVersao(t.versao);
      } else {
        setTermo(TERMO_MODELO(perfil));
      }
    })();
  }, [perfil]);

  const termoMudou = termo.trim() !== termoSalvo.trim() && termo.trim().length > 0;

  const salvarTermo = async () => {
    setSalvandoTermo(true);
    const { data, error } = await supabase.rpc('al_salvar_termo', { p_texto: termo.trim() });
    setSalvandoTermo(false);
    setConfirmarTermo(false);
    if (error) { toast('Não foi possível salvar o termo', 'erro'); return; }
    setTermoSalvo(termo.trim());
    setTermoVersao(data);
    toast(`Termo salvo. Versão ${data}.`, 'ok');
  };

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
        <div className="pilha g4">
          <div className="entre" style={{ alignItems: 'flex-start' }}>
            <div>
              <span className="olho">Termo de responsabilidade</span>
              <p className="dica" style={{ marginTop: 4, maxWidth: 380 }}>
                O aluno lê e aceita este texto ao assinar a anamnese. Uma cópia
                fica congelada dentro do registro dele — se você editar depois,
                o que ele assinou continua valendo.
              </p>
            </div>
            {termoVersao && <Selo tom="aco">Versão {termoVersao}</Selo>}
          </div>

          {!termoVersao && (
            <div className="aviso aviso-alerta fila g3">
              <IcoAviso size={18} />
              <span>
                Você ainda não publicou o termo. Sem ele, os alunos assinam
                apenas a declaração de veracidade. Revise o texto abaixo e salve.
              </span>
            </div>
          )}

          <textarea rows={14} value={termo}
            onChange={(e) => setTermo(e.target.value)}
            style={{ fontSize: 13, lineHeight: 1.6 }} />

          <div className="fila g2" style={{ flexWrap: 'wrap' }}>
            <Btn variante="1" disabled={!termoMudou}
              onClick={() => setConfirmarTermo(true)}>
              {termoVersao ? 'Publicar nova versão' : 'Publicar termo'}
            </Btn>
            {termoMudou && termoVersao && (
              <Btn variante="3" onClick={() => setTermo(termoSalvo)}>
                Descartar alterações
              </Btn>
            )}
          </div>

          <div className="dica">
            Este texto é um modelo, não uma peça jurídica revisada. Se o
            faturamento justificar, vale mostrar a um advogado.
          </div>
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

      <Modal aberto={confirmarTermo} aoFechar={() => setConfirmarTermo(false)}
        titulo={termoVersao ? 'Publicar nova versão?' : 'Publicar termo?'}
        rodape={<>
          <Btn variante="2" onClick={() => setConfirmarTermo(false)}>Cancelar</Btn>
          <Btn variante="1" onClick={salvarTermo} carregando={salvandoTermo}>
            Publicar
          </Btn>
        </>}>
        <p style={{ fontSize: 14.5, color: 'var(--grafite)', lineHeight: 1.6 }}>
          {termoVersao ? (
            <>
              Isto cria a <strong>versão {termoVersao + 1}</strong>. Os alunos que
              assinarem a partir de agora aceitam o novo texto. Quem já assinou
              continua vinculado à versão que leu — nada muda para eles.
              <br /><br />
              Versões antigas não são apagadas. É isso que permite provar qual
              texto estava valendo em cada data.
            </>
          ) : (
            <>
              A partir de agora, todo aluno que preencher a anamnese vai ler e
              aceitar este termo antes de assinar. Uma cópia do texto fica
              guardada dentro do registro dele.
            </>
          )}
        </p>
      </Modal>
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
            <button onClick={() => { setTela('alunos'); setAluno(null); }}
              aria-label="Ir para os alunos"
              style={{
                background: 'none', border: 0, cursor: 'pointer', padding: 0,
              }}>
              <Marca tam={17} />
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
