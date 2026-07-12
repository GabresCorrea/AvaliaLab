import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

/* ============================================================
   AVALIALAB
   Anamnese digital + composição corporal para personal trainers
   ============================================================ */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const LIMITE_FREE = 3;

/* ============================================================
   MOTOR DE CÁLCULO
   ============================================================ */

// Siri (1961): densidade -> percentual de gordura
const siri = (d) => (495 / d) - 450;

const PROTOCOLOS = {
  pollock7: {
    nome: 'Pollock 7 dobras',
    desc: 'Padrão-ouro. Maior precisão, exige as 7 medidas.',
    dobras: ['tricipital', 'subescapular', 'peitoral', 'axilarMedia', 'suprailiaca', 'abdominal', 'coxa'],
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
    nome: 'Pollock 3 dobras',
    desc: 'O mais usado na prática. Rápido e confiável.',
    // Homem: peitoral, abdominal, coxa | Mulher: tricipital, suprailíaca, coxa
    dobras: ['peitoral', 'abdominal', 'coxa', 'tricipital', 'suprailiaca'],
    dobrasPorSexo: {
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
    nome: 'Faulkner 4 dobras',
    desc: 'Rápido, muito usado em academia. Não usa idade.',
    dobras: ['tricipital', 'subescapular', 'suprailiaca', 'abdominal'],
    calc: (d) => {
      const s = d.tricipital + d.subescapular + d.suprailiaca + d.abdominal;
      const percentual = (s * 0.153) + 5.783;
      return { somatorio: s, densidade: null, percentual };
    },
  },
  guedes: {
    nome: 'Guedes 3 dobras',
    desc: 'Validado para população brasileira.',
    // Homem: tricipital, suprailíaca, abdominal | Mulher: subescapular, suprailíaca, coxa
    dobras: ['tricipital', 'suprailiaca', 'abdominal', 'subescapular', 'coxa'],
    dobrasPorSexo: {
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

const LABELS_DOBRAS = {
  tricipital:   'Tricipital',
  subescapular: 'Subescapular',
  peitoral:     'Peitoral',
  axilarMedia:  'Axilar média',
  suprailiaca:  'Suprailíaca',
  abdominal:    'Abdominal',
  coxa:         'Coxa',
};

const PERIMETROS = [
  { k: 'ombro',       l: 'Ombro' },
  { k: 'torax',       l: 'Tórax' },
  { k: 'cintura',     l: 'Cintura' },
  { k: 'abdomen',     l: 'Abdômen' },
  { k: 'quadril',     l: 'Quadril' },
  { k: 'bracoD',      l: 'Braço D.' },
  { k: 'bracoE',      l: 'Braço E.' },
  { k: 'coxaD',       l: 'Coxa D.' },
  { k: 'coxaE',       l: 'Coxa E.' },
  { k: 'panturrilhaD',l: 'Panturr. D.' },
];

// Classificação ACSM
const CLASSIFICACAO = {
  M: [
    { max: 5,  label: 'Essencial',   cor: '#7DA2C4' },
    { max: 13, label: 'Atleta',      cor: '#4DB6A0' },
    { max: 17, label: 'Bom',         cor: '#6FCF97' },
    { max: 24, label: 'Aceitável',   cor: '#E8C468' },
    { max: 99, label: 'Elevado',     cor: '#E88C6A' },
  ],
  F: [
    { max: 13, label: 'Essencial',   cor: '#7DA2C4' },
    { max: 20, label: 'Atleta',      cor: '#4DB6A0' },
    { max: 24, label: 'Bom',         cor: '#6FCF97' },
    { max: 31, label: 'Aceitável',   cor: '#E8C468' },
    { max: 99, label: 'Elevado',     cor: '#E88C6A' },
  ],
};

const classificar = (pct, sexo) =>
  CLASSIFICACAO[sexo].find((c) => pct <= c.max) || CLASSIFICACAO[sexo][4];

const idadeDe = (nascimento) => {
  if (!nascimento) return 30;
  const n = new Date(nascimento);
  const h = new Date();
  let i = h.getFullYear() - n.getFullYear();
  const m = h.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && h.getDate() < n.getDate())) i--;
  return i;
};

function calcularTudo({ protocolo, dobras, peso, altura, perimetros, idade, sexo }) {
  const P = PROTOCOLOS[protocolo];
  const necessarias = P.dobrasPorSexo ? P.dobrasPorSexo[sexo] : P.dobras;
  const ok = necessarias.every((k) => Number(dobras[k]) > 0);
  if (!ok || !peso || !altura) return null;

  const d = {};
  necessarias.forEach((k) => { d[k] = Number(dobras[k]); });

  const { somatorio, densidade, percentual } = P.calc(d, idade, sexo);
  const pct = Math.max(2, Math.min(60, percentual));

  const massaGorda  = (peso * pct) / 100;
  const massaMagra  = peso - massaGorda;
  const alturaM     = altura / 100;
  const imc         = peso / (alturaM * alturaM);
  const rcq         = perimetros.cintura && perimetros.quadril
    ? Number(perimetros.cintura) / Number(perimetros.quadril)
    : null;

  return {
    somatorio: Number(somatorio.toFixed(1)),
    densidade: densidade ? Number(densidade.toFixed(5)) : null,
    percentual: Number(pct.toFixed(1)),
    massaGorda: Number(massaGorda.toFixed(1)),
    massaMagra: Number(massaMagra.toFixed(1)),
    imc: Number(imc.toFixed(1)),
    rcq: rcq ? Number(rcq.toFixed(2)) : null,
    classificacao: classificar(pct, sexo).label,
  };
}

/* ============================================================
   ANAMNESE — perguntas fixas
   ============================================================ */

const ANAMNESE = [
  {
    secao: 'Prontidão para atividade física (PAR-Q)',
    itens: [
      { k: 'parq1', t: 'sn', q: 'Algum médico já disse que você possui algum problema de coração e que só deveria fazer atividade física supervisionado por profissionais de saúde?' },
      { k: 'parq2', t: 'sn', q: 'Você sente dores no peito quando pratica atividade física?' },
      { k: 'parq3', t: 'sn', q: 'No último mês, você sentiu dores no peito quando praticou atividade física?' },
      { k: 'parq4', t: 'sn', q: 'Você apresenta desequilíbrio devido à tontura e/ou perda de consciência?' },
      { k: 'parq5', t: 'sn', q: 'Você possui algum problema ósseo ou articular que poderia ser piorado pela atividade física?' },
      { k: 'parq6', t: 'sn', q: 'Você toma atualmente algum medicamento para pressão arterial e/ou problema de coração?' },
      { k: 'parq7', t: 'sn', q: 'Sabe de alguma outra razão pela qual você não deve praticar atividade física?' },
    ],
  },
  {
    secao: 'Histórico de saúde',
    itens: [
      { k: 'condicoes', t: 'multi', q: 'Você possui alguma dessas condições?',
        opcoes: ['Hipertensão', 'Diabetes', 'Colesterol alto', 'Asma', 'Hipotireoidismo', 'Hérnia de disco', 'Artrose', 'Nenhuma'] },
      { k: 'medicamentos', t: 'texto', q: 'Faz uso de algum medicamento contínuo? Quais?' },
      { k: 'cirurgias', t: 'texto', q: 'Já realizou alguma cirurgia? Qual e quando?' },
      { k: 'lesoes', t: 'texto', q: 'Possui alguma lesão atual ou dor recorrente? Descreva.' },
      { k: 'gestante', t: 'sn', q: 'Está gestante ou no pós-parto (até 6 meses)?' },
    ],
  },
  {
    secao: 'Rotina e hábitos',
    itens: [
      { k: 'experiencia', t: 'unica', q: 'Qual sua experiência com treino de força?',
        opcoes: ['Nunca treinei', 'Menos de 6 meses', '6 meses a 2 anos', 'Mais de 2 anos'] },
      { k: 'frequencia', t: 'unica', q: 'Quantos dias por semana você pode treinar?',
        opcoes: ['2 dias', '3 dias', '4 dias', '5 dias', '6 dias'] },
      { k: 'sono', t: 'unica', q: 'Quantas horas você dorme por noite, em média?',
        opcoes: ['Menos de 5h', '5 a 6h', '6 a 7h', '7 a 8h', 'Mais de 8h'] },
      { k: 'alimentacao', t: 'unica', q: 'Como você avalia sua alimentação hoje?',
        opcoes: ['Ruim', 'Regular', 'Boa', 'Ótima'] },
      { k: 'agua', t: 'unica', q: 'Quanto de água você bebe por dia?',
        opcoes: ['Menos de 1L', '1 a 2L', '2 a 3L', 'Mais de 3L'] },
      { k: 'trabalho', t: 'unica', q: 'Sua rotina de trabalho é:',
        opcoes: ['Sentada a maior parte do dia', 'Em pé a maior parte do dia', 'Fisicamente ativa'] },
    ],
  },
  {
    secao: 'Objetivos',
    itens: [
      { k: 'objetivo', t: 'unica', q: 'Qual seu principal objetivo?',
        opcoes: ['Emagrecimento', 'Ganho de massa muscular', 'Recomposição corporal', 'Saúde e qualidade de vida', 'Performance esportiva'] },
      { k: 'prazo', t: 'unica', q: 'Em quanto tempo espera ver resultados?',
        opcoes: ['1 a 3 meses', '3 a 6 meses', '6 a 12 meses', 'Sem prazo definido'] },
      { k: 'motivacao', t: 'texto', q: 'O que te motivou a procurar acompanhamento agora?' },
      { k: 'obstaculo', t: 'texto', q: 'O que já te impediu de manter uma rotina de treino antes?' },
    ],
  },
];

/* ============================================================
   DESIGN TOKENS
   ============================================================ */

const CSS = `
:root{
  --bg:#0E1113; --surface:#171B1E; --surface2:#1F2529; --line:#2A3136;
  --line-strong:#3A444B; --text:#E6EAEC; --muted:#8A969E; --dim:#5C666D;
  --accent:#4DE0A0; --accent-dim:#1E4A3A; --warn:#E8C468; --danger:#E8705F;
  --r:6px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);
  font-family:'Barlow',-apple-system,system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.mono{font-family:'IBM Plex Mono','SF Mono',ui-monospace,monospace;
  font-variant-numeric:tabular-nums}
.disp{font-family:'Barlow Condensed','Barlow',sans-serif;
  font-weight:600;letter-spacing:.02em}

input,select,textarea,button{font-family:inherit;font-size:15px}
input,select,textarea{
  width:100%;background:var(--surface2);border:1px solid var(--line);
  border-radius:var(--r);padding:11px 12px;color:var(--text);outline:none;
  transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{
  border-color:var(--accent);box-shadow:0 0 0 3px rgba(77,224,160,.12)}
input::placeholder,textarea::placeholder{color:var(--dim)}
select{appearance:none;cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg width='10' height='6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238A969E' stroke-width='1.5' fill='none'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}
label{display:block;font-size:12px;font-weight:600;color:var(--muted);
  text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
button{cursor:pointer;border:none;border-radius:var(--r);font-weight:600;
  transition:all .15s}
button:disabled{opacity:.4;cursor:not-allowed}
button:focus-visible,a:focus-visible,input:focus-visible{
  outline:2px solid var(--accent);outline-offset:2px}

.btn{background:var(--accent);color:#08130E;padding:11px 20px}
.btn:hover:not(:disabled){background:#63EDB0}
.btn-ghost{background:transparent;color:var(--text);
  border:1px solid var(--line-strong);padding:10px 18px}
.btn-ghost:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.btn-sm{padding:7px 13px;font-size:13px}
.btn-danger{background:transparent;color:var(--danger);
  border:1px solid var(--line);padding:7px 13px;font-size:13px}
.btn-danger:hover{border-color:var(--danger);background:rgba(232,112,95,.08)}

.card{background:var(--surface);border:1px solid var(--line);
  border-radius:10px;padding:20px}
.hr{height:1px;background:var(--line);border:0;margin:20px 0}

/* Régua de dobras — elemento de assinatura */
.regua{display:grid;gap:0;border:1px solid var(--line);
  border-radius:10px;overflow:hidden;background:var(--surface2)}
.regua-item{display:grid;grid-template-columns:1fr 96px 34px;
  align-items:center;gap:12px;padding:12px 14px;
  border-bottom:1px solid var(--line);position:relative}
.regua-item:last-child{border-bottom:0}
.regua-item.off{opacity:.32}
.regua-item::before{content:'';position:absolute;left:0;top:0;bottom:0;
  width:2px;background:var(--line-strong)}
.regua-item.on::before{background:var(--accent)}
.regua-nome{font-size:14px;font-weight:500}
.regua-item input{text-align:right;padding:8px 10px;
  font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}
.regua-un{font-size:12px;color:var(--dim);font-family:'IBM Plex Mono',monospace}

.tabs{display:flex;gap:2px;background:var(--surface2);padding:3px;
  border-radius:8px;border:1px solid var(--line)}
.tab{flex:1;padding:9px;background:transparent;color:var(--muted);
  font-size:13px;font-weight:600;border-radius:5px}
.tab.on{background:var(--surface);color:var(--text);
  box-shadow:0 1px 3px rgba(0,0,0,.4)}

.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;
  border-radius:20px;font-size:12px;font-weight:600;
  background:var(--surface2);border:1px solid var(--line)}

.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);
  background:var(--surface2);border:1px solid var(--line-strong);
  padding:12px 20px;border-radius:8px;z-index:99;font-size:14px;
  box-shadow:0 8px 32px rgba(0,0,0,.5);animation:up .25s}
@keyframes up{from{opacity:0;transform:translate(-50%,10px)}}
.toast.err{border-color:var(--danger);color:var(--danger)}
.toast.ok{border-color:var(--accent);color:var(--accent)}

.spin{width:16px;height:16px;border:2px solid var(--line-strong);
  border-top-color:var(--accent);border-radius:50%;
  animation:sp .7s linear infinite;display:inline-block}
@keyframes sp{to{transform:rotate(360deg)}}

@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

/* ============================================================
   UI HELPERS
   ============================================================ */

const Toast = ({ msg, tipo }) =>
  msg ? <div className={`toast ${tipo || ''}`}>{msg}</div> : null;

const Campo = ({ label, children }) => (
  <div><label>{label}</label>{children}</div>
);

/* ============================================================
   TELA: LOGIN / CADASTRO
   ============================================================ */

function Auth({ toast }) {
  const [modo, setModo]   = useState('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome]   = useState('');
  const [busy, setBusy]   = useState(false);

  const submit = async () => {
    if (!email || !senha) return toast('Preencha e-mail e senha', 'err');
    if (modo === 'criar' && !nome) return toast('Informe seu nome', 'err');
    if (senha.length < 6) return toast('Senha precisa de ao menos 6 caracteres', 'err');
    setBusy(true);
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email, password: senha, options: { data: { nome } },
        });
        if (error) throw error;
        toast('Conta criada. Confirme o e-mail para entrar.', 'ok');
        setModo('entrar');
      }
    } catch (e) {
      const m = e.message || '';
      if (m.includes('Invalid login')) toast('E-mail ou senha incorretos', 'err');
      else if (m.includes('already registered')) toast('Este e-mail já tem conta', 'err');
      else toast(m, 'err');
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div className="disp" style={{ fontSize: 34, letterSpacing: '.06em' }}>
            AVALIA<span style={{ color: 'var(--accent)' }}>LAB</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Anamnese e composição corporal
          </div>
        </div>

        <div className="card">
          <div className="tabs" style={{ marginBottom: 20 }}>
            <button className={`tab ${modo === 'entrar' ? 'on' : ''}`}
              onClick={() => setModo('entrar')}>Entrar</button>
            <button className={`tab ${modo === 'criar' ? 'on' : ''}`}
              onClick={() => setModo('criar')}>Criar conta</button>
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            {modo === 'criar' && (
              <Campo label="Nome">
                <input value={nome} onChange={(e) => setNome(e.target.value)}
                  placeholder="Seu nome" />
              </Campo>
            )}
            <Campo label="E-mail">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com" autoComplete="email" />
            </Campo>
            <Campo label="Senha">
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="Mínimo 6 caracteres"
                autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} />
            </Campo>
            <button className="btn" onClick={submit} disabled={busy}
              style={{ width: '100%', marginTop: 4 }}>
              {busy ? <span className="spin" /> : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
            </button>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--dim)', marginTop: 18 }}>
          Grátis até {LIMITE_FREE} alunos
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TELA PÚBLICA: ANAMNESE DO ALUNO (via token)
   ============================================================ */

function AnamnesePublica({ token }) {
  const [aluno, setAluno]   = useState(null);
  const [resp, setResp]     = useState({});
  const [busy, setBusy]     = useState(false);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro]     = useState('');
  const [load, setLoad]     = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('al_buscar_por_token', { p_token: token });
      const reg = data?.[0];
      if (error || !reg) { setErro('Link inválido ou expirado.'); setLoad(false); return; }
      setAluno({ id: reg.id, nome: reg.nome });
      if (reg.ja_preenchida) setPronto(true);
      setLoad(false);
    })();
  }, [token]);

  const set = (k, v) => setResp((r) => ({ ...r, [k]: v }));

  const toggleMulti = (k, op) => {
    const atual = resp[k] || [];
    set(k, atual.includes(op) ? atual.filter((x) => x !== op) : [...atual, op]);
  };

  const enviar = async () => {
    const obrigatorias = ANAMNESE.flatMap((s) => s.itens)
      .filter((i) => i.t === 'sn' || i.t === 'unica');
    const faltando = obrigatorias.find((i) => !resp[i.k]);
    if (faltando) {
      setErro('Responda todas as perguntas de sim/não e de escolha única.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('al_enviar_anamnese', {
      p_token: token, p_respostas: resp,
    });
    setBusy(false);
    if (error) {
      const m = error.message || '';
      if (m.includes('ja_preenchida')) { setPronto(true); return; }
      setErro('Não foi possível enviar. Tente novamente.');
      return;
    }
    setPronto(true);
    window.scrollTo({ top: 0 });
  };

  if (load) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <span className="spin" />
    </div>
  );

  if (erro && !aluno) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ maxWidth: 380, textAlign: 'center' }}>
        <div style={{ fontSize: 15 }}>{erro}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
          Peça um novo link ao seu personal.
        </div>
      </div>
    </div>
  );

  if (pronto) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ maxWidth: 400, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%',
          background: 'var(--accent-dim)', display: 'grid', placeItems: 'center',
          margin: '0 auto 16px' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="var(--accent)" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="disp" style={{ fontSize: 22, marginBottom: 8 }}>Anamnese enviada</div>
        <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6 }}>
          Obrigado, {aluno.nome.split(' ')[0]}. Seu personal já recebeu as respostas.
          Pode fechar esta página.
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '32px 18px 80px' }}>
      <div style={{ marginBottom: 28 }}>
        <div className="disp" style={{ fontSize: 26, letterSpacing: '.06em' }}>
          AVALIA<span style={{ color: 'var(--accent)' }}>LAB</span>
        </div>
        <div style={{ fontSize: 15, marginTop: 12 }}>
          Olá, <strong>{aluno.nome.split(' ')[0]}</strong>.
        </div>
        <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4, lineHeight: 1.6 }}>
          Responda com sinceridade. Leva cerca de 5 minutos e ajuda seu personal
          a montar um treino seguro para você.
        </div>
      </div>

      {erro && (
        <div className="card" style={{ borderColor: 'var(--danger)',
          color: 'var(--danger)', marginBottom: 20, fontSize: 14, padding: 14 }}>
          {erro}
        </div>
      )}

      <div style={{ display: 'grid', gap: 22 }}>
        {ANAMNESE.map((sec) => (
          <div key={sec.secao} className="card">
            <div className="disp" style={{ fontSize: 17, marginBottom: 18,
              paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
              {sec.secao}
            </div>
            <div style={{ display: 'grid', gap: 20 }}>
              {sec.itens.map((it) => (
                <div key={it.k}>
                  <div style={{ fontSize: 14, marginBottom: 10, lineHeight: 1.5 }}>
                    {it.q}
                  </div>

                  {it.t === 'sn' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {['Não', 'Sim'].map((op) => (
                        <button key={op}
                          onClick={() => set(it.k, op)}
                          className={resp[it.k] === op ? 'btn' : 'btn-ghost'}
                          style={{ flex: 1, padding: '10px' }}>
                          {op}
                        </button>
                      ))}
                    </div>
                  )}

                  {it.t === 'unica' && (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {it.opcoes.map((op) => (
                        <button key={op}
                          onClick={() => set(it.k, op)}
                          className={resp[it.k] === op ? 'btn' : 'btn-ghost'}
                          style={{ textAlign: 'left', padding: '10px 14px',
                            fontWeight: 500 }}>
                          {op}
                        </button>
                      ))}
                    </div>
                  )}

                  {it.t === 'multi' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {it.opcoes.map((op) => (
                        <button key={op}
                          onClick={() => toggleMulti(it.k, op)}
                          className={(resp[it.k] || []).includes(op) ? 'btn' : 'btn-ghost'}
                          style={{ padding: '8px 14px', fontSize: 13, fontWeight: 500 }}>
                          {op}
                        </button>
                      ))}
                    </div>
                  )}

                  {it.t === 'texto' && (
                    <textarea rows={2} value={resp[it.k] || ''}
                      onChange={(e) => set(it.k, e.target.value)}
                      placeholder="Se não se aplica, deixe em branco" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button className="btn" onClick={enviar} disabled={busy}
        style={{ width: '100%', marginTop: 24, padding: 14, fontSize: 15 }}>
        {busy ? <span className="spin" /> : 'Enviar respostas'}
      </button>
    </div>
  );
}

/* ============================================================
   NOVA AVALIAÇÃO
   ============================================================ */

function NovaAvaliacao({ aluno, ultima, onSalvar, onCancelar, toast }) {
  const [protocolo, setProtocolo] = useState('pollock7');
  const [data, setData]           = useState(new Date().toISOString().slice(0, 10));
  const [peso, setPeso]           = useState(ultima?.peso || '');
  const [altura, setAltura]       = useState(ultima?.altura || '');
  const [dobras, setDobras]       = useState({});
  const [perim, setPerim]         = useState({});
  const [obs, setObs]             = useState('');
  const [busy, setBusy]           = useState(false);

  const idade = idadeDe(aluno.nascimento);
  const P = PROTOCOLOS[protocolo];
  const dobrasAtivas = P.dobrasPorSexo ? P.dobrasPorSexo[aluno.sexo] : P.dobras;

  const resultado = useMemo(() => calcularTudo({
    protocolo, dobras, peso: Number(peso), altura: Number(altura),
    perimetros: perim, idade, sexo: aluno.sexo,
  }), [protocolo, dobras, peso, altura, perim, idade, aluno.sexo]);

  const salvar = async () => {
    if (!resultado) return toast('Preencha peso, altura e todas as dobras do protocolo', 'err');
    setBusy(true);
    const { error } = await supabase.from('al_avaliacoes').insert({
      aluno_id: aluno.id, data, peso: Number(peso), altura: Number(altura),
      protocolo, dobras, perimetros: perim, resultados: resultado, observacoes: obs,
    });
    setBusy(false);
    if (error) return toast('Erro ao salvar', 'err');
    toast('Avaliação salva', 'ok');
    onSalvar();
  };

  const cls = resultado ? classificar(resultado.percentual, aluno.sexo) : null;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="disp" style={{ fontSize: 21 }}>Nova avaliação</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {aluno.nome} · {idade} anos · {aluno.sexo === 'F' ? 'Feminino' : 'Masculino'}
          </div>
        </div>
        <button className="btn-ghost btn-sm" onClick={onCancelar}>Cancelar</button>
      </div>

      <div className="card">
        <div style={{ display: 'grid', gap: 14 }}>
          <Campo label="Protocolo">
            <select value={protocolo} onChange={(e) => { setProtocolo(e.target.value); }}>
              {Object.entries(PROTOCOLOS).map(([k, v]) => (
                <option key={k} value={k}>{v.nome}</option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6 }}>
              {P.desc}
            </div>
          </Campo>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Campo label="Data">
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </Campo>
            <Campo label="Peso (kg)">
              <input type="number" step="0.1" value={peso}
                onChange={(e) => setPeso(e.target.value)} placeholder="0.0" />
            </Campo>
            <Campo label="Altura (cm)">
              <input type="number" step="0.1" value={altura}
                onChange={(e) => setAltura(e.target.value)} placeholder="0.0" />
            </Campo>
          </div>
        </div>
      </div>

      {/* RÉGUA DE DOBRAS — assinatura */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'baseline', marginBottom: 10 }}>
          <label style={{ margin: 0 }}>Dobras cutâneas</label>
          <span className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>
            {dobrasAtivas.filter((k) => Number(dobras[k]) > 0).length}/{dobrasAtivas.length}
          </span>
        </div>
        <div className="regua">
          {Object.keys(LABELS_DOBRAS).map((k) => {
            const ativa = dobrasAtivas.includes(k);
            const preenchida = Number(dobras[k]) > 0;
            return (
              <div key={k}
                className={`regua-item ${!ativa ? 'off' : ''} ${ativa && preenchida ? 'on' : ''}`}>
                <span className="regua-nome">{LABELS_DOBRAS[k]}</span>
                <input type="number" step="0.5" disabled={!ativa}
                  value={dobras[k] || ''}
                  onChange={(e) => setDobras({ ...dobras, [k]: e.target.value })}
                  placeholder={ativa ? '0.0' : '—'} />
                <span className="regua-un">mm</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 8 }}>
          Campos inativos não são usados por este protocolo.
        </div>
      </div>

      {/* RESULTADO AO VIVO */}
      {resultado && (
        <div className="card" style={{ borderColor: 'var(--accent-dim)',
          background: 'linear-gradient(180deg,rgba(77,224,160,.04),transparent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between',
            alignItems: 'flex-start', marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)',
                textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Gordura corporal
              </div>
              <div className="mono" style={{ fontSize: 44, fontWeight: 600,
                color: 'var(--accent)', lineHeight: 1.1, marginTop: 2 }}>
                {resultado.percentual}<span style={{ fontSize: 22 }}>%</span>
              </div>
            </div>
            <span className="pill" style={{ borderColor: cls.cor, color: cls.cor }}>
              {cls.label}
            </span>
          </div>

          <div style={{ display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(88px,1fr))', gap: 14 }}>
            {[
              ['Massa magra', `${resultado.massaMagra} kg`],
              ['Massa gorda', `${resultado.massaGorda} kg`],
              ['IMC', resultado.imc],
              ['Σ dobras', `${resultado.somatorio} mm`],
              ...(resultado.rcq ? [['RCQ', resultado.rcq]] : []),
            ].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 11, color: 'var(--dim)',
                  textTransform: 'uppercase', letterSpacing: '.05em' }}>{l}</div>
                <div className="mono" style={{ fontSize: 17, fontWeight: 600,
                  marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PERÍMETROS */}
      <div className="card">
        <label>Perímetros (cm) — opcional</label>
        <div style={{ display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill,minmax(104px,1fr))', gap: 10, marginTop: 4 }}>
          {PERIMETROS.map((p) => (
            <div key={p.k}>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>{p.l}</div>
              <input type="number" step="0.5" className="mono"
                value={perim[p.k] || ''}
                onChange={(e) => setPerim({ ...perim, [p.k]: e.target.value })}
                placeholder="—" style={{ textAlign: 'right', padding: '8px 10px' }} />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <Campo label="Observações">
          <textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)}
            placeholder="Anotações desta avaliação" />
        </Campo>
      </div>

      <button className="btn" onClick={salvar} disabled={busy || !resultado}
        style={{ padding: 14, fontSize: 15 }}>
        {busy ? <span className="spin" /> : 'Salvar avaliação'}
      </button>
    </div>
  );
}

/* ============================================================
   GRÁFICO DE EVOLUÇÃO (SVG puro)
   ============================================================ */

function Grafico({ avaliacoes }) {
  if (avaliacoes.length < 2) return null;

  const pontos = [...avaliacoes].reverse().map((a) => ({
    data: a.data,
    pct: a.resultados?.percentual,
    mm: a.resultados?.massaMagra,
    peso: a.peso,
  })).filter((p) => p.pct != null);

  if (pontos.length < 2) return null;

  const W = 100, H = 40, PAD = 4;
  const serie = (key, cor) => {
    const vals = pontos.map((p) => p[key]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const d = pontos.map((p, i) => {
      const x = PAD + (i / (pontos.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((p[key] - min) / range) * (H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return { d, cor, min, max, vals };
  };

  const g = serie('pct', '#4DE0A0');
  const m = serie('mm', '#7DA2C4');

  const delta = (key) => {
    const p = pontos[0][key], u = pontos[pontos.length - 1][key];
    return (u - p).toFixed(1);
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', marginBottom: 16 }}>
        <label style={{ margin: 0 }}>Evolução</label>
        <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
          <span style={{ color: '#4DE0A0' }}>● % gordura</span>
          <span style={{ color: '#7DA2C4' }}>● massa magra</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 130 }}
        preserveAspectRatio="none">
        <path d={m.d} fill="none" stroke={m.cor} strokeWidth="0.7"
          strokeLinecap="round" strokeLinejoin="round" opacity=".7"
          vectorEffect="non-scaling-stroke" />
        <path d={g.d} fill="none" stroke={g.cor} strokeWidth="1"
          strokeLinecap="round" strokeLinejoin="round"
          vectorEffect="non-scaling-stroke" />
      </svg>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 12, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        {[
          ['% gordura', delta('pct'), '%', true],
          ['Massa magra', delta('mm'), 'kg', false],
          ['Peso', delta('peso'), 'kg', null],
        ].map(([l, d, un, menorMelhor]) => {
          const n = Number(d);
          const bom = menorMelhor === null ? null
            : menorMelhor ? n < 0 : n > 0;
          return (
            <div key={l}>
              <div style={{ fontSize: 11, color: 'var(--dim)' }}>{l}</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 2,
                color: bom === null ? 'var(--text)'
                  : bom ? 'var(--accent)' : 'var(--warn)' }}>
                {n > 0 ? '+' : ''}{d} {un}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   FICHA DO ALUNO
   ============================================================ */

function FichaAluno({ aluno, profile, onVoltar, toast, onExcluir }) {
  const [aba, setAba]           = useState('avaliacoes');
  const [avaliacoes, setAv]     = useState([]);
  const [anamnese, setAnam]     = useState(null);
  const [nova, setNova]         = useState(false);
  const [load, setLoad]         = useState(true);
  const [exp, setExp]           = useState(null);

  const carregar = async () => {
    setLoad(true);
    const [{ data: av }, { data: an }] = await Promise.all([
      supabase.from('al_avaliacoes').select('*')
        .eq('aluno_id', aluno.id).order('data', { ascending: false }),
      supabase.from('al_anamneses').select('*')
        .eq('aluno_id', aluno.id).maybeSingle(),
    ]);
    setAv(av || []);
    setAnam(an);
    setLoad(false);
  };

  useEffect(() => { carregar(); }, [aluno.id]);

  const linkAnamnese = `${window.location.origin}/a/${aluno.token_anamnese}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(linkAnamnese);
      toast('Link copiado', 'ok');
    } catch { toast('Não foi possível copiar', 'err'); }
  };

  const excluirAv = async (id) => {
    if (!confirm('Excluir esta avaliação?')) return;
    await supabase.from('al_avaliacoes').delete().eq('id', id);
    carregar();
    toast('Avaliação excluída', 'ok');
  };

  const gerarPDF = () => {
    if (!avaliacoes.length) return toast('Nenhuma avaliação para exportar', 'err');
    imprimirRelatorio({ aluno, profile, avaliacoes, anamnese });
  };

  if (nova) return (
    <NovaAvaliacao aluno={aluno} ultima={avaliacoes[0]}
      onSalvar={() => { setNova(false); carregar(); }}
      onCancelar={() => setNova(false)} toast={toast} />
  );

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-start', gap: 12 }}>
        <div>
          <button className="btn-ghost btn-sm" onClick={onVoltar}
            style={{ marginBottom: 10 }}>← Alunos</button>
          <div className="disp" style={{ fontSize: 24 }}>{aluno.nome}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            {idadeDe(aluno.nascimento)} anos ·
            {' '}{aluno.sexo === 'F' ? 'Feminino' : 'Masculino'}
            {aluno.telefone && ` · ${aluno.telefone}`}
          </div>
        </div>
        <button className="btn" onClick={() => setNova(true)}>+ Avaliação</button>
      </div>

      <div className="tabs">
        <button className={`tab ${aba === 'avaliacoes' ? 'on' : ''}`}
          onClick={() => setAba('avaliacoes')}>
          Avaliações {avaliacoes.length > 0 && `(${avaliacoes.length})`}
        </button>
        <button className={`tab ${aba === 'anamnese' ? 'on' : ''}`}
          onClick={() => setAba('anamnese')}>
          Anamnese {anamnese && '✓'}
        </button>
      </div>

      {load && <div style={{ textAlign: 'center', padding: 40 }}><span className="spin" /></div>}

      {!load && aba === 'avaliacoes' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {avaliacoes.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 15, marginBottom: 6 }}>Nenhuma avaliação ainda</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
                Registre a primeira medição para começar o histórico.
              </div>
              <button className="btn" onClick={() => setNova(true)}>Nova avaliação</button>
            </div>
          ) : (
            <>
              <Grafico avaliacoes={avaliacoes} />

              <button className="btn-ghost" onClick={gerarPDF}>
                Gerar relatório em PDF
              </button>

              {avaliacoes.map((a) => {
                const r = a.resultados || {};
                const cls = r.percentual ? classificar(r.percentual, aluno.sexo) : null;
                const aberta = exp === a.id;
                return (
                  <div key={a.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div onClick={() => setExp(aberta ? null : a.id)}
                      style={{ padding: 16, cursor: 'pointer', display: 'flex',
                        justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>
                          {new Date(a.data + 'T12:00').toLocaleDateString('pt-BR')}
                        </div>
                        <div style={{ display: 'flex', gap: 16, marginTop: 6,
                          alignItems: 'baseline' }}>
                          <span className="mono" style={{ fontSize: 24, fontWeight: 600,
                            color: 'var(--accent)' }}>
                            {r.percentual}%
                          </span>
                          <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>
                            {a.peso} kg
                          </span>
                          {cls && (
                            <span className="pill" style={{ borderColor: cls.cor,
                              color: cls.cor, fontSize: 11 }}>{cls.label}</span>
                          )}
                        </div>
                      </div>
                      <span style={{ color: 'var(--dim)', fontSize: 18,
                        transform: aberta ? 'rotate(180deg)' : 'none',
                        transition: 'transform .2s' }}>⌄</span>
                    </div>

                    {aberta && (
                      <div style={{ padding: '0 16px 16px',
                        borderTop: '1px solid var(--line)' }}>
                        <div style={{ display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit,minmax(80px,1fr))',
                          gap: 12, padding: '16px 0' }}>
                          {[
                            ['Massa magra', `${r.massaMagra} kg`],
                            ['Massa gorda', `${r.massaGorda} kg`],
                            ['IMC', r.imc],
                            ['Σ dobras', `${r.somatorio} mm`],
                            ...(r.rcq ? [['RCQ', r.rcq]] : []),
                          ].map(([l, v]) => (
                            <div key={l}>
                              <div style={{ fontSize: 11, color: 'var(--dim)' }}>{l}</div>
                              <div className="mono" style={{ fontSize: 15, marginTop: 2 }}>{v}</div>
                            </div>
                          ))}
                        </div>

                        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 12 }}>
                          {PROTOCOLOS[a.protocolo]?.nome}
                          {a.observacoes && ` · ${a.observacoes}`}
                        </div>

                        <button className="btn-danger" onClick={() => excluirAv(a.id)}>
                          Excluir avaliação
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {!load && aba === 'anamnese' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card">
            <label>Link para o aluno</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input readOnly value={linkAnamnese} className="mono"
                onClick={(e) => e.target.select()}
                style={{ fontSize: 12, color: 'var(--muted)' }} />
              <button className="btn" onClick={copiar} style={{ whiteSpace: 'nowrap' }}>
                Copiar
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 8 }}>
              {anamnese
                ? 'Já preenchida. Um novo envio pelo mesmo link não é aceito.'
                : 'Envie por WhatsApp. O aluno preenche sem precisar criar conta.'}
            </div>
          </div>

          {!anamnese ? (
            <div className="card" style={{ textAlign: 'center', padding: 36 }}>
              <div style={{ fontSize: 15, marginBottom: 6 }}>Aguardando preenchimento</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                As respostas aparecem aqui assim que o aluno enviar.
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                Preenchida em{' '}
                {new Date(anamnese.preenchida_em).toLocaleDateString('pt-BR')}
              </div>

              {ANAMNESE.map((sec) => {
                const alertas = sec.itens.filter(
                  (i) => i.t === 'sn' && anamnese.respostas[i.k] === 'Sim'
                    && i.k.startsWith('parq')
                );
                return (
                  <div key={sec.secao} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: 16, paddingBottom: 12,
                      borderBottom: '1px solid var(--line)' }}>
                      <div className="disp" style={{ fontSize: 16 }}>{sec.secao}</div>
                      {alertas.length > 0 && (
                        <span className="pill" style={{ borderColor: 'var(--warn)',
                          color: 'var(--warn)' }}>
                          {alertas.length} atenção
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'grid', gap: 14 }}>
                      {sec.itens.map((it) => {
                        const v = anamnese.respostas[it.k];
                        if (!v || (Array.isArray(v) && !v.length)) return null;
                        const alerta = it.k.startsWith('parq') && v === 'Sim';
                        return (
                          <div key={it.k}>
                            <div style={{ fontSize: 12, color: 'var(--muted)',
                              lineHeight: 1.5 }}>{it.q}</div>
                            <div style={{ fontSize: 14, marginTop: 3, fontWeight: 500,
                              color: alerta ? 'var(--warn)' : 'var(--text)' }}>
                              {Array.isArray(v) ? v.join(', ') : v}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      <hr className="hr" />
      <button className="btn-danger" onClick={onExcluir} style={{ justifySelf: 'start' }}>
        Excluir aluno
      </button>
    </div>
  );
}

/* ============================================================
   RELATÓRIO EM PDF (via impressão do navegador)
   ============================================================ */

function imprimirRelatorio({ aluno, profile, avaliacoes, anamnese }) {
  const ultima = avaliacoes[0];
  const primeira = avaliacoes[avaliacoes.length - 1];
  const r = ultima.resultados || {};
  const cls = classificar(r.percentual, aluno.sexo);
  const idade = idadeDe(aluno.nascimento);

  const evolucao = avaliacoes.length > 1 ? `
    <div class="box">
      <div class="h2">Evolução desde ${new Date(primeira.data + 'T12:00').toLocaleDateString('pt-BR')}</div>
      <table class="tbl">
        <tr><th>Indicador</th><th>Primeira</th><th>Atual</th><th>Variação</th></tr>
        ${[
          ['% Gordura', primeira.resultados.percentual, r.percentual, '%'],
          ['Massa magra', primeira.resultados.massaMagra, r.massaMagra, 'kg'],
          ['Massa gorda', primeira.resultados.massaGorda, r.massaGorda, 'kg'],
          ['Peso', primeira.peso, ultima.peso, 'kg'],
        ].map(([l, a, b, un]) => {
          const d = (Number(b) - Number(a)).toFixed(1);
          return `<tr><td>${l}</td><td>${a} ${un}</td><td><b>${b} ${un}</b></td>
            <td>${Number(d) > 0 ? '+' : ''}${d} ${un}</td></tr>`;
        }).join('')}
      </table>
    </div>` : '';

  const parqAlertas = anamnese
    ? ANAMNESE[0].itens.filter((i) => anamnese.respostas[i.k] === 'Sim')
    : [];

  const histSaude = anamnese ? `
    <div class="box">
      <div class="h2">Anamnese</div>
      ${parqAlertas.length ? `
        <div class="alert">
          <b>Atenção — PAR-Q com ${parqAlertas.length} resposta(s) positiva(s):</b>
          <ul>${parqAlertas.map((i) => `<li>${i.q}</li>`).join('')}</ul>
          Recomenda-se liberação médica antes do início do programa.
        </div>` : `<div class="ok">PAR-Q sem restrições relatadas.</div>`}
      <table class="tbl">
        ${ANAMNESE.slice(1).flatMap((s) => s.itens).map((it) => {
          const v = anamnese.respostas[it.k];
          if (!v || (Array.isArray(v) && !v.length)) return '';
          return `<tr><td style="width:52%">${it.q}</td>
            <td><b>${Array.isArray(v) ? v.join(', ') : v}</b></td></tr>`;
        }).join('')}
      </table>
    </div>` : '';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Avaliação — ${aluno.nome}</title>
<style>
  @page{size:A4;margin:16mm}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font:13px/1.55 -apple-system,'Segoe UI',Arial,sans-serif;color:#1A1D1F}
  .top{display:flex;justify-content:space-between;align-items:flex-start;
    border-bottom:2px solid #1A1D1F;padding-bottom:14px;margin-bottom:22px}
  .logo{max-height:52px;max-width:170px}
  .prof{font-size:11px;color:#666;text-align:right;line-height:1.5}
  h1{font-size:23px;font-weight:700;letter-spacing:-.3px}
  .sub{font-size:12px;color:#666;margin-top:3px}
  .box{border:1px solid #DDE1E3;border-radius:8px;padding:16px;margin-bottom:16px;
    page-break-inside:avoid}
  .h2{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;
    color:#666;margin-bottom:12px;padding-bottom:7px;border-bottom:1px solid #EEF0F1}
  .hero{display:flex;align-items:center;gap:26px;margin-bottom:14px}
  .big{font-size:48px;font-weight:800;line-height:1;letter-spacing:-1.5px}
  .tag{display:inline-block;padding:4px 11px;border-radius:20px;font-size:11px;
    font-weight:700;border:1.5px solid}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;
    border-top:1px solid #EEF0F1;padding-top:14px}
  .k{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px}
  .v{font-size:17px;font-weight:700;margin-top:2px}
  .tbl{width:100%;border-collapse:collapse;font-size:12px}
  .tbl th{text-align:left;font-size:10px;text-transform:uppercase;color:#888;
    letter-spacing:.5px;padding:7px 8px;border-bottom:1px solid #DDE1E3}
  .tbl td{padding:7px 8px;border-bottom:1px solid #F2F4F5;vertical-align:top}
  .tbl tr:last-child td{border-bottom:0}
  .alert{background:#FFF6E5;border-left:3px solid #E8A020;padding:11px 13px;
    border-radius:5px;font-size:12px;margin-bottom:14px}
  .alert ul{margin:7px 0 7px 16px}
  .alert li{margin-bottom:3px}
  .ok{background:#EAF9F1;border-left:3px solid #2FA36B;padding:9px 13px;
    border-radius:5px;font-size:12px;margin-bottom:14px}
  .foot{margin-top:26px;padding-top:12px;border-top:1px solid #DDE1E3;
    font-size:10px;color:#999;display:flex;justify-content:space-between}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>

<div class="top">
  <div>
    ${profile.logo_url
      ? `<img src="${profile.logo_url}" class="logo">`
      : `<div style="font-size:20px;font-weight:800;letter-spacing:1px">
           ${(profile.nome || 'AVALIALAB').toUpperCase()}</div>`}
  </div>
  <div class="prof">
    <b>${profile.nome || ''}</b><br>
    ${profile.cref ? `CREF ${profile.cref}<br>` : ''}
    ${profile.telefone || ''}
  </div>
</div>

<h1>${aluno.nome}</h1>
<div class="sub">
  ${idade} anos · ${aluno.sexo === 'F' ? 'Feminino' : 'Masculino'} ·
  Avaliação de ${new Date(ultima.data + 'T12:00').toLocaleDateString('pt-BR')}
</div>

<div class="box" style="margin-top:20px">
  <div class="h2">Composição corporal — ${PROTOCOLOS[ultima.protocolo]?.nome}</div>
  <div class="hero">
    <div>
      <div class="k">Gordura corporal</div>
      <div class="big">${r.percentual}%</div>
    </div>
    <span class="tag" style="border-color:${cls.cor};color:${cls.cor}">${cls.label}</span>
  </div>
  <div class="grid">
    <div><div class="k">Massa magra</div><div class="v">${r.massaMagra} kg</div></div>
    <div><div class="k">Massa gorda</div><div class="v">${r.massaGorda} kg</div></div>
    <div><div class="k">Peso</div><div class="v">${ultima.peso} kg</div></div>
    <div><div class="k">IMC</div><div class="v">${r.imc}</div></div>
  </div>
</div>

<div class="box">
  <div class="h2">Dobras cutâneas</div>
  <table class="tbl">
    <tr><th>Dobra</th><th style="text-align:right">Medida</th></tr>
    ${Object.entries(ultima.dobras || {})
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => `<tr><td>${LABELS_DOBRAS[k]}</td>
        <td style="text-align:right"><b>${v} mm</b></td></tr>`).join('')}
    <tr><td><b>Somatório</b></td>
      <td style="text-align:right"><b>${r.somatorio} mm</b></td></tr>
  </table>
</div>

${Object.values(ultima.perimetros || {}).some((v) => Number(v) > 0) ? `
<div class="box">
  <div class="h2">Perímetros</div>
  <table class="tbl">
    ${PERIMETROS.filter((p) => Number(ultima.perimetros[p.k]) > 0)
      .map((p) => `<tr><td>${p.l}</td>
        <td style="text-align:right"><b>${ultima.perimetros[p.k]} cm</b></td></tr>`).join('')}
    ${r.rcq ? `<tr><td><b>Relação cintura/quadril</b></td>
      <td style="text-align:right"><b>${r.rcq}</b></td></tr>` : ''}
  </table>
</div>` : ''}

${evolucao}
${histSaude}

<div class="foot">
  <span>Emitido em ${new Date().toLocaleDateString('pt-BR')} · AvaliaLab</span>
  <span>Documento de uso profissional. Não substitui avaliação médica.</span>
</div>

<script>window.onload=()=>{setTimeout(()=>window.print(),400)}</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Permita pop-ups para gerar o PDF.'); return; }
  w.document.write(html);
  w.document.close();
}

/* ============================================================
   LISTA DE ALUNOS
   ============================================================ */

function ListaAlunos({ profile, onAbrir, toast, refresh }) {
  const [alunos, setAlunos] = useState([]);
  const [busca, setBusca]   = useState('');
  const [novo, setNovo]     = useState(false);
  const [load, setLoad]     = useState(true);
  const [f, setF] = useState({ nome: '', nascimento: '', sexo: 'F', telefone: '' });
  const [busy, setBusy]     = useState(false);

  const carregar = async () => {
    setLoad(true);
    const { data } = await supabase.from('al_alunos').select('*')
      .eq('profile_id', profile.id).order('nome');
    setAlunos(data || []);
    setLoad(false);
  };

  useEffect(() => { carregar(); }, [refresh]);

  const noLimite = profile.plano === 'free' && alunos.length >= LIMITE_FREE;

  const criar = async () => {
    if (!f.nome.trim()) return toast('Informe o nome', 'err');
    if (noLimite) return toast(`Plano grátis: até ${LIMITE_FREE} alunos`, 'err');
    setBusy(true);
    const { error } = await supabase.from('al_alunos').insert({
      profile_id: profile.id, nome: f.nome.trim(),
      nascimento: f.nascimento || null, sexo: f.sexo, telefone: f.telefone,
    });
    setBusy(false);
    if (error) return toast('Erro ao cadastrar', 'err');
    setF({ nome: '', nascimento: '', sexo: 'F', telefone: '' });
    setNovo(false);
    carregar();
    toast('Aluno cadastrado', 'ok');
  };

  const filtrados = alunos.filter((a) =>
    a.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .includes(busca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  );

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', gap: 12 }}>
        <div>
          <div className="disp" style={{ fontSize: 24 }}>Alunos</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {alunos.length} cadastrado{alunos.length !== 1 ? 's' : ''}
            {profile.plano === 'free' && ` · limite ${LIMITE_FREE} no plano grátis`}
          </div>
        </div>
        <button className="btn" onClick={() => setNovo(!novo)} disabled={noLimite}>
          {novo ? 'Fechar' : '+ Aluno'}
        </button>
      </div>

      {noLimite && (
        <div className="card" style={{ borderColor: 'var(--warn)', padding: 14 }}>
          <div style={{ fontSize: 14, color: 'var(--warn)', fontWeight: 600 }}>
            Limite do plano grátis atingido
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Faça upgrade para cadastrar alunos sem limite.
          </div>
        </div>
      )}

      {novo && (
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <Campo label="Nome completo">
            <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })}
              placeholder="Nome do aluno" autoFocus />
          </Campo>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Campo label="Nascimento">
              <input type="date" value={f.nascimento}
                onChange={(e) => setF({ ...f, nascimento: e.target.value })} />
            </Campo>
            <Campo label="Sexo">
              <select value={f.sexo} onChange={(e) => setF({ ...f, sexo: e.target.value })}>
                <option value="F">Feminino</option>
                <option value="M">Masculino</option>
              </select>
            </Campo>
          </div>
          <Campo label="Telefone">
            <input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })}
              placeholder="(00) 00000-0000" />
          </Campo>
          <button className="btn" onClick={criar} disabled={busy}>
            {busy ? <span className="spin" /> : 'Cadastrar aluno'}
          </button>
        </div>
      )}

      {alunos.length > 3 && (
        <input value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar aluno" />
      )}

      {load ? (
        <div style={{ textAlign: 'center', padding: 40 }}><span className="spin" /></div>
      ) : filtrados.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 44 }}>
          <div style={{ fontSize: 15, marginBottom: 6 }}>
            {busca ? 'Nenhum aluno encontrado' : 'Nenhum aluno ainda'}
          </div>
          {!busca && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Cadastre o primeiro aluno para começar.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {filtrados.map((a) => (
            <div key={a.id} className="card" onClick={() => onAbrir(a)}
              style={{ cursor: 'pointer', padding: 15, display: 'flex',
                justifyContent: 'space-between', alignItems: 'center' }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--line-strong)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--line)'}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{a.nome}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {idadeDe(a.nascimento)} anos · {a.sexo === 'F' ? 'Feminino' : 'Masculino'}
                </div>
              </div>
              <span style={{ color: 'var(--dim)' }}>›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   PERFIL
   ============================================================ */

function Perfil({ profile, onAtualizar, toast }) {
  const [f, setF] = useState({
    nome: profile.nome || '', cref: profile.cref || '',
    telefone: profile.telefone || '',
  });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  const salvar = async () => {
    setBusy(true);
    const { error } = await supabase.from('al_profiles').update(f).eq('id', profile.id);
    setBusy(false);
    if (error) return toast('Erro ao salvar', 'err');
    toast('Perfil salvo', 'ok');
    onAtualizar();
  };

  const enviarLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast('Imagem acima de 2 MB', 'err');
    setBusy(true);
    const ext = file.name.split('.').pop();
    const path = `${profile.id}/logo.${ext}`;
    const { error: up } = await supabase.storage.from('al-logos')
      .upload(path, file, { upsert: true });
    if (up) { setBusy(false); return toast('Erro ao enviar imagem', 'err'); }
    const { data } = supabase.storage.from('al-logos').getPublicUrl(path);
    const url = `${data.publicUrl}?t=${Date.now()}`;
    await supabase.from('al_profiles').update({ logo_url: url }).eq('id', profile.id);
    setBusy(false);
    toast('Logo atualizada', 'ok');
    onAtualizar();
  };

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 480 }}>
      <div className="disp" style={{ fontSize: 24 }}>Perfil</div>

      <div className="card" style={{ display: 'grid', gap: 14 }}>
        <Campo label="Nome">
          <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Campo>
        <Campo label="CREF">
          <input value={f.cref} onChange={(e) => setF({ ...f, cref: e.target.value })}
            placeholder="000000-G/UF" />
        </Campo>
        <Campo label="Telefone">
          <input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })}
            placeholder="(00) 00000-0000" />
        </Campo>
        <button className="btn" onClick={salvar} disabled={busy}>
          {busy ? <span className="spin" /> : 'Salvar perfil'}
        </button>
      </div>

      <div className="card">
        <label>Logo no relatório</label>
        {profile.logo_url && (
          <div style={{ background: '#fff', borderRadius: 6, padding: 14,
            marginBottom: 12, display: 'grid', placeItems: 'center' }}>
            <img src={profile.logo_url} alt="" style={{ maxHeight: 60, maxWidth: '100%' }} />
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" onChange={enviarLogo}
          style={{ display: 'none' }} />
        <button className="btn-ghost" onClick={() => fileRef.current.click()}
          disabled={busy} style={{ width: '100%' }}>
          {profile.logo_url ? 'Trocar logo' : 'Enviar logo'}
        </button>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 8 }}>
          PNG com fundo transparente. Até 2 MB.
        </div>
      </div>

      <div className="card">
        <label>Plano</label>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {profile.plano === 'pro' ? 'Pro' : 'Grátis'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              {profile.plano === 'pro'
                ? 'Alunos ilimitados'
                : `Até ${LIMITE_FREE} alunos`}
            </div>
          </div>
          {profile.plano === 'free' && (
            <span className="pill" style={{ color: 'var(--muted)' }}>
              Upgrade em breve
            </span>
          )}
        </div>
      </div>

      <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>
        Sair da conta
      </button>
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */

export default function App() {
  const [sessao, setSessao]   = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [tela, setTela]       = useState('alunos');
  const [aluno, setAluno]     = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [toastMsg, setToastMsg] = useState(null);

  const toast = (msg, tipo) => {
    setToastMsg({ msg, tipo });
    setTimeout(() => setToastMsg(null), 3000);
  };

  // Rota pública de anamnese
  const tokenAnamnese = useMemo(() => {
    const m = window.location.pathname.match(/^\/a\/([a-z0-9]+)/i);
    return m ? m[1] : null;
  }, []);

  // Não existe trigger em auth.users (para não conflitar com o IPBCharts).
  // Esta RPC cria o perfil no primeiro acesso e devolve ele.
  const carregarProfile = async () => {
    const { data, error } = await supabase.rpc('al_meu_perfil');
    if (error) { toast('Erro ao carregar perfil', 'err'); return; }
    setProfile(data);
  };

  useEffect(() => {
    if (tokenAnamnese) { setSessao(null); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      if (data.session) carregarProfile();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSessao(s);
      if (s) carregarProfile();
      else { setProfile(null); setAluno(null); setTela('alunos'); }
    });
    return () => sub.subscription.unsubscribe();
  }, [tokenAnamnese]);

  const excluirAluno = async () => {
    if (!confirm(`Excluir ${aluno.nome} e todas as avaliações? Isso não pode ser desfeito.`))
      return;
    await supabase.from('al_alunos').delete().eq('id', aluno.id);
    setAluno(null);
    setRefresh((r) => r + 1);
    toast('Aluno excluído', 'ok');
  };

  const Estilos = () => (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        rel="stylesheet" />
      <style>{CSS}</style>
    </>
  );

  // Rota pública
  if (tokenAnamnese) return (
    <><Estilos /><AnamnesePublica token={tokenAnamnese} /></>
  );

  if (sessao === undefined) return (
    <><Estilos />
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <span className="spin" />
      </div>
    </>
  );

  if (!sessao) return (
    <><Estilos /><Auth toast={toast} />
      <Toast msg={toastMsg?.msg} tipo={toastMsg?.tipo} /></>
  );

  if (!profile) return (
    <><Estilos />
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <span className="spin" />
      </div>
    </>
  );

  return (
    <>
      <Estilos />
      <div style={{ minHeight: '100vh' }}>
        <header style={{ borderBottom: '1px solid var(--line)',
          background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ maxWidth: 780, margin: '0 auto', padding: '14px 18px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => { setTela('alunos'); setAluno(null); }}
              className="disp"
              style={{ background: 'none', fontSize: 19, letterSpacing: '.06em',
                color: 'var(--text)', padding: 0 }}>
              AVALIA<span style={{ color: 'var(--accent)' }}>LAB</span>
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className={tela === 'alunos' && !aluno ? 'btn btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => { setTela('alunos'); setAluno(null); }}>Alunos</button>
              <button
                className={tela === 'perfil' ? 'btn btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => { setTela('perfil'); setAluno(null); }}>Perfil</button>
            </div>
          </div>
        </header>

        <main style={{ maxWidth: 780, margin: '0 auto', padding: '26px 18px 60px' }}>
          {tela === 'perfil' ? (
            <Perfil profile={profile} toast={toast}
              onAtualizar={() => carregarProfile()} />
          ) : aluno ? (
            <FichaAluno aluno={aluno} profile={profile} toast={toast}
              onVoltar={() => setAluno(null)} onExcluir={excluirAluno} />
          ) : (
            <ListaAlunos profile={profile} toast={toast} refresh={refresh}
              onAbrir={setAluno} />
          )}
        </main>
      </div>
      <Toast msg={toastMsg?.msg} tipo={toastMsg?.tipo} />
    </>
  );
}
