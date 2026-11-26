/* M&L Advocacia e Assessoria — servidor do site
 * Node.js 22.13+ sem dependências externas.
 * - Serve o site estático (pasta public/) com compressão, cache e cabeçalhos de segurança
 * - API POST /api/leads: validação, antispam, armazenamento em SQLite (node:sqlite)
 * - Integrações opcionais: webhook de CRM/automação e aviso por e-mail (Resend)
 * - Painel /admin protegido por senha: lista, estado, exclusão (LGPD) e exportação CSV
 * - sitemap.xml e robots.txt gerados a partir de SITE_URL
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

try { process.loadEnvFile(path.join(__dirname, ".env")); } catch { /* .env opcional */ }

const { DatabaseSync } = require("node:sqlite");
const autentique = require("./autentique");

const CONFIG = {
  porta: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  siteUrl: (process.env.SITE_URL || "").replace(/\/+$/, ""),
  producao: process.env.NODE_ENV === "production",
  pastaDados: path.resolve(process.env.DATA_DIR || path.join(__dirname, "data")),
  adminUser: process.env.ADMIN_USER || "admin",
  adminSenha: process.env.ADMIN_PASSWORD || "",
  saltIp: process.env.IP_SALT || "",
  confiarProxy: process.env.TRUST_PROXY === "1",
  webhookUrl: process.env.CRM_WEBHOOK_URL || "",
  webhookSegredo: process.env.CRM_WEBHOOK_SECRET || "",
  resendKey: process.env.RESEND_API_KEY || "",
  emailPara: process.env.NOTIFY_EMAIL_TO || "",
  emailDe: process.env.NOTIFY_EMAIL_FROM || "",
  limiteEnvios: Number(process.env.RATE_LIMIT_MAX || 5),
  // Assinatura eletrônica (Autentique)
  autentiqueToken: process.env.AUTENTIQUE_TOKEN || "",
  autentiqueSandbox: process.env.AUTENTIQUE_SANDBOX !== "0",
  autentiqueSegredo: process.env.AUTENTIQUE_WEBHOOK_SECRET || "",
  autentiqueUrl: process.env.AUTENTIQUE_API_URL || undefined,
  modelo: {
    advogado_nome: process.env.MODELO_ADVOGADO_NOME || "",
    advogado_oab: process.env.MODELO_ADVOGADO_OAB || "",
    escritorio_endereco: process.env.MODELO_ESCRITORIO_ENDERECO || "Av. João XXIII, 183, Sala 1, Vila Formosa, São Paulo - SP",
  },
};
const assinador = autentique.criarCliente({ token: CONFIG.autentiqueToken, sandbox: CONFIG.autentiqueSandbox, url: CONFIG.autentiqueUrl });
const PASTA_MODELOS = path.join(__dirname, "modelos");
const PUBLICO = path.join(__dirname, "public");

if (!CONFIG.saltIp) {
  CONFIG.saltIp = crypto.randomBytes(16).toString("hex");
  console.warn("[aviso] IP_SALT não definido: usando um valor temporário (defina-o no .env para produção).");
}

/* ------------------------------------------------------------------ Banco de dados */
fs.mkdirSync(CONFIG.pastaDados, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(CONFIG.pastaDados, "leads.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    criado_em TEXT NOT NULL,
    situacao TEXT,
    interesse TEXT,
    respostas TEXT NOT NULL,
    nome TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    email TEXT,
    cidade TEXT NOT NULL,
    uf TEXT NOT NULL,
    consentimento_versao TEXT,
    consentimento_em TEXT NOT NULL,
    origem TEXT,
    estado TEXT NOT NULL DEFAULT 'novo',
    ip_hash TEXT,
    atualizado_em TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_leads_criado ON leads(criado_em DESC);
  CREATE TABLE IF NOT EXISTS assinaturas (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    documento_id TEXT NOT NULL UNIQUE,
    nome_documento TEXT NOT NULL,
    metodo TEXT NOT NULL,
    link TEXT,
    estado TEXT NOT NULL DEFAULT 'enviado',
    arquivo_assinado TEXT,
    sandbox INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_assinaturas_lead ON assinaturas(lead_id);
  CREATE TABLE IF NOT EXISTS eventos_autentique (id TEXT PRIMARY KEY, recebido_em TEXT NOT NULL);
`);
const sqlInserir = db.prepare(`INSERT INTO leads
  (id, criado_em, situacao, interesse, respostas, nome, whatsapp, email, cidade, uf, consentimento_versao, consentimento_em, origem, ip_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

/* ------------------------------------------------------------------ Regras do formulário */
const OPCOES = {
  situacao: ["gravida", "bebe_recente", "bebe_meses", "nunca_solicitou", "negado", "saber_direito", "outra"],
  momento: ["gestante", "ja_nasceu", "adocao", "nao_sei"],
  ja_solicitou: ["sim", "nao", "nao_sei"],
  status_pedido: ["aprovado", "negado", "em_analise", "nao_sei"],
  contribuiu: ["sim", "nao", "nao_sei"],
  vinculo: ["clt", "domestica", "autonoma", "mei", "desempregada", "rural", "facultativa", "outra", "nao_sei"],
  meu_inss: ["sim", "nao", "nao_sei"],
  comunicacao_inss: ["sim", "nao", "nao_sei"],
  documentos: ["sim", "alguns", "nao", "nao_sei"],
  deseja_orientacao: ["sim", "entender", "nao_sei"],
};
const ROTULOS = {
  situacao: { gravida: "Está grávida", bebe_recente: "Teve bebê recentemente", bebe_meses: "Bebê com alguns meses", nunca_solicitou: "Mãe, nunca solicitou", negado: "Pedido negado pelo INSS", saber_direito: "Quer saber se tem direito", outra: "Outra situação" },
  momento: { gestante: "Gestante", ja_nasceu: "Bebê já nasceu", adocao: "Adoção/guarda", nao_sei: "Não sabe" },
  status_pedido: { aprovado: "Aprovado", negado: "Negado", em_analise: "Em análise", nao_sei: "Não sabe" },
  vinculo: { clt: "Carteira assinada", domestica: "Doméstica", autonoma: "Autônoma", mei: "MEI", desempregada: "Desempregada", rural: "Rural", facultativa: "Facultativa", outra: "Outra", nao_sei: "Não sabe" },
  documentos: { sim: "Tem", alguns: "Alguns", nao: "Ainda não", nao_sei: "Não sabe" },
  deseja_orientacao: { sim: "Quer orientação", entender: "Quer entender primeiro", nao_sei: "Não sabe" },
  _simnao: { sim: "Sim", nao: "Não", nao_sei: "Não sabe" },
};
const NOMES_PERGUNTAS = {
  previsao_parto: "Previsão do parto", nascimento_bebe: "Nascimento/adoção", momento: "Momento", ja_solicitou: "Já solicitou",
  status_pedido: "Estado do pedido", contribuiu: "Já contribuiu", vinculo: "Situação de trabalho", descricao: "Descrição",
  meu_inss: "Meu INSS", comunicacao_inss: "Comunicação do INSS", documentos: "Documentos", deseja_orientacao: "Orientação",
};
const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const ESTADOS_LEAD = ["novo", "em_contato", "convertido", "descartado"];

function texto(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
function dataIso(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T12:00:00Z");
  if (isNaN(d)) return null;
  const ano = d.getUTCFullYear();
  return ano >= 2000 && ano <= 2100 ? v : null;
}

/** Valida e normaliza o envio. Devolve { erro } ou { lead }. */
function validarLead(b) {
  if (!b || typeof b !== "object") return { erro: "Dados inválidos." };
  const r = b.respostas && typeof b.respostas === "object" ? b.respostas : {};
  const respostas = {};
  for (const [chave, permitidos] of Object.entries(OPCOES)) {
    if (r[chave] === undefined || r[chave] === "") continue;
    if (!permitidos.includes(r[chave])) return { erro: "Resposta inválida no formulário." };
    respostas[chave] = r[chave];
  }
  for (const chave of ["previsao_parto", "nascimento_bebe"]) {
    if (r[chave] === undefined || r[chave] === "") continue;
    const d = dataIso(r[chave]);
    if (!d) return { erro: "Data inválida no formulário." };
    respostas[chave] = d;
  }
  if (r.descricao) respostas.descricao = texto(r.descricao, 600);
  const situacao = respostas.situacao;
  if (!situacao) return { erro: "Informe a sua situação." };
  if (situacao === "gravida" && !respostas.previsao_parto) return { erro: "Informe a previsão do parto." };
  if (["bebe_recente", "bebe_meses", "nunca_solicitou", "negado"].includes(situacao) && !respostas.nascimento_bebe) return { erro: "Informe a data de nascimento do bebê." };
  if (situacao === "outra" && (!respostas.descricao || respostas.descricao.length < 10)) return { erro: "Descreva brevemente a sua situação." };

  const c = b.contato && typeof b.contato === "object" ? b.contato : {};
  const nome = texto(c.nome, 120);
  const whatsapp = String(c.whatsapp || "").replace(/\D/g, "");
  const email = texto(c.email, 160).toLowerCase();
  const cidade = texto(c.cidade, 80);
  const uf = texto(c.uf, 2).toUpperCase();
  if (nome.length < 5 || nome.split(" ").length < 2) return { erro: "Informe o seu nome completo." };
  if (!/^[1-9]\d{9,10}$/.test(whatsapp)) return { erro: "Informe um WhatsApp válido com DDD." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { erro: "Confira o e-mail informado." };
  if (cidade.length < 2) return { erro: "Informe a sua cidade." };
  if (!UFS.includes(uf)) return { erro: "Selecione o estado." };
  if (!b.consentimento || b.consentimento.aceito !== true) return { erro: "É preciso autorizar o tratamento dos dados." };

  const o = b.origem && typeof b.origem === "object" ? b.origem : {};
  const origem = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "referencia", "pagina_entrada"]) {
    const v = texto(o[k], 300);
    if (v) origem[k] = v;
  }
  return {
    lead: {
      respostas, situacao, interesse: texto(b.interesse, 120), nome, whatsapp, email, cidade, uf,
      consentimentoVersao: texto(b.consentimento.versao_politica, 20), origem,
    },
  };
}

/* ------------------------------------------------------------------ Antispam */
const janelas = new Map(); // chave -> [timestamps]
function limitar(chave, max, janelaMs) {
  const agora = Date.now();
  const lista = (janelas.get(chave) || []).filter((t) => agora - t < janelaMs);
  lista.push(agora);
  janelas.set(chave, lista);
  return lista.length > max;
}
setInterval(() => {
  const agora = Date.now();
  for (const [k, l] of janelas) if (!l.some((t) => agora - t < 3600_000)) janelas.delete(k);
}, 600_000).unref();

function ipDe(req) {
  if (CONFIG.confiarProxy) {
    const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || "";
}
const hashIp = (ip) => crypto.createHmac("sha256", CONFIG.saltIp).update(ip).digest("hex").slice(0, 32);

/* ------------------------------------------------------------------ Integrações (opcionais) */
async function notificar(lead) {
  const payload = {
    evento: "novo_lead", id: lead.id, criado_em: lead.criado_em, situacao: lead.situacao,
    situacao_rotulo: ROTULOS.situacao[lead.situacao] || lead.situacao, interesse: lead.interesse,
    respostas: lead.respostas, contato: { nome: lead.nome, whatsapp: lead.whatsapp, email: lead.email, cidade: lead.cidade, uf: lead.uf },
    origem: lead.origem,
  };
  const tarefas = [];
  if (CONFIG.webhookUrl) {
    const corpo = JSON.stringify(payload);
    const cab = { "Content-Type": "application/json" };
    if (CONFIG.webhookSegredo) cab["X-ML-Assinatura"] = "sha256=" + crypto.createHmac("sha256", CONFIG.webhookSegredo).update(corpo).digest("hex");
    tarefas.push(fetch(CONFIG.webhookUrl, { method: "POST", headers: cab, body: corpo, signal: AbortSignal.timeout(8000) })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); })
      .catch((e) => console.error("[webhook] falhou:", e.message)));
  }
  if (CONFIG.resendKey && CONFIG.emailPara && CONFIG.emailDe) {
    const linhas = [
      `Novo contato pelo site — ${payload.situacao_rotulo}`, "",
      `Nome: ${lead.nome}`, `WhatsApp: ${lead.whatsapp}`, `E-mail: ${lead.email || "-"}`, `Cidade: ${lead.cidade}/${lead.uf}`,
      lead.interesse ? `Interesse: ${lead.interesse}` : "", "",
      ...Object.entries(lead.respostas).map(([k, v]) => `${NOMES_PERGUNTAS[k] || k}: ${rotuloResposta(k, v)}`), "",
      `Origem: ${lead.origem.utm_source || lead.origem.referencia || "direto"}`,
      CONFIG.siteUrl ? `Painel: ${CONFIG.siteUrl}/admin` : "",
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "");
    tarefas.push(fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${CONFIG.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: CONFIG.emailDe, to: CONFIG.emailPara.split(",").map((s) => s.trim()), subject: `Novo contato pelo site: ${lead.nome}`, text: linhas.join("\n") }),
      signal: AbortSignal.timeout(8000),
    }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); })
      .catch((e) => console.error("[email] falhou:", e.message)));
  }
  await Promise.all(tarefas);
}
function rotuloResposta(k, v) {
  if (k === "previsao_parto" || k === "nascimento_bebe") return v.split("-").reverse().join("/");
  const mapa = ROTULOS[k] || ROTULOS._simnao;
  return (mapa && mapa[v]) || v;
}

/* ------------------------------------------------------------------ Utilidades HTTP */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};
const COMPRIMIVEL = /^(text\/|application\/(json|xml|manifest)|image\/svg)/;

function cabecalhosSeguranca(res, admin) {
  const csp = admin
    ? "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://images.unsplash.com; frame-src https://www.google.com https://maps.google.com; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'" + (CONFIG.producao ? "; upgrade-insecure-requests" : "");
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (CONFIG.producao) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function enviar(req, res, status, corpo, tipo, extra = {}) {
  let buf = Buffer.isBuffer(corpo) ? corpo : Buffer.from(String(corpo));
  const cab = { "Content-Type": tipo, ...extra };
  if (COMPRIMIVEL.test(tipo) && buf.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    buf = zlib.gzipSync(buf, { level: 6 });
    cab["Content-Encoding"] = "gzip";
    cab["Vary"] = "Accept-Encoding";
  }
  cab["Content-Length"] = buf.length;
  res.writeHead(status, cab);
  res.end(req.method === "HEAD" ? undefined : buf);
}
const json = (req, res, status, obj) => enviar(req, res, status, JSON.stringify(obj), "application/json; charset=utf-8", { "Cache-Control": "no-store" });

function lerCorpo(req, limite) {
  return new Promise((resolve, reject) => {
    let total = 0; const partes = [];
    req.on("data", (p) => {
      total += p.length;
      if (total > limite) { reject(Object.assign(new Error("grande"), { status: 413 })); req.destroy(); return; }
      partes.push(p);
    });
    req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
    req.on("error", reject);
  });
}

/* ------------------------------------------------------------------ Páginas HTML com URL absoluta */
const cacheHtml = new Map();
function html(nome) {
  if (cacheHtml.has(nome) && CONFIG.producao) return cacheHtml.get(nome);
  let s = fs.readFileSync(path.join(PUBLICO, nome), "utf8");
  if (CONFIG.siteUrl) {
    s = s.replace(/<link rel="canonical" href="(\/[^"]*)">/, (_, c) => `<link rel="canonical" href="${CONFIG.siteUrl}${c}">\n<meta property="og:url" content="${CONFIG.siteUrl}${c}">`)
      .replace(/content="\/?assets\//g, `content="${CONFIG.siteUrl}/assets/`)
      .replace(/"(image|logo)": "\/?assets\//g, `"$1": "${CONFIG.siteUrl}/assets/`)
      .replace('"areaServed": "BR",', `"areaServed": "BR",\n  "url": "${CONFIG.siteUrl}/",`);
  }
  cacheHtml.set(nome, s);
  return s;
}

function servirEstatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const alvo = path.normalize(path.join(PUBLICO, rel));
  if (!alvo.startsWith(PUBLICO + path.sep)) return naoEncontrado(req, res);
  let info;
  try { info = fs.statSync(alvo); } catch { return naoEncontrado(req, res); }
  if (!info.isFile()) return naoEncontrado(req, res);
  const ext = path.extname(alvo).toLowerCase();
  const tipo = MIME[ext] || "application/octet-stream";
  cabecalhosSeguranca(res, false);
  if (ext === ".html") return enviar(req, res, 200, html(path.relative(PUBLICO, alvo)), tipo, { "Cache-Control": "no-cache" });
  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
  const cache = rel.startsWith("/assets/") ? "public, max-age=604800" : "public, max-age=86400";
  enviar(req, res, 200, fs.readFileSync(alvo), tipo, { "Cache-Control": cache, ETag: etag });
}

function naoEncontrado(req, res) {
  cabecalhosSeguranca(res, false);
  enviar(req, res, 404, `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Página não encontrada | M&amp;L Advocacia</title><link rel="stylesheet" href="/assets/css/site.css"><main class="secao"><div class="container cta-final"><p class="rotulo">Erro 404</p><h1>Página não encontrada</h1><p>O endereço que você procura não existe ou foi movido.</p><a class="btn btn-azul" href="/">Voltar ao início</a></div></main></html>`, "text/html; charset=utf-8", { "Cache-Control": "no-store" });
}

/* ------------------------------------------------------------------ API de leads */
async function apiLeads(req, res) {
  const ip = ipDe(req); const ipH = hashIp(ip);
  if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) return json(req, res, 415, { erro: "Formato não suportado." });
  const origemCab = req.headers.origin;
  if (origemCab && CONFIG.siteUrl && origemCab !== CONFIG.siteUrl && CONFIG.producao) return json(req, res, 403, { erro: "Origem não permitida." });
  if (limitar("lead:" + ipH, CONFIG.limiteEnvios, 15 * 60_000)) return json(req, res, 429, { erro: "Muitos envios seguidos. Tente novamente em alguns minutos." });

  let corpo;
  try { corpo = JSON.parse(await lerCorpo(req, 16 * 1024)); }
  catch (e) { return json(req, res, e.status === 413 ? 413 : 400, { erro: "Dados inválidos." }); }

  // Antispam: campo-isca preenchido ou envio rápido demais → resposta neutra, nada é guardado.
  if ((corpo && corpo.site) || !corpo || Number(corpo.tempo_preenchimento_ms) < 4000) {
    console.warn("[antispam] envio descartado");
    return json(req, res, 200, { ok: true });
  }

  const { erro, lead } = validarLead(corpo);
  if (erro) return json(req, res, 400, { erro });

  const registro = { id: crypto.randomUUID(), criado_em: new Date().toISOString(), ...lead };
  try {
    sqlInserir.run(registro.id, registro.criado_em, registro.situacao, registro.interesse, JSON.stringify(registro.respostas),
      registro.nome, registro.whatsapp, registro.email || null, registro.cidade, registro.uf, registro.consentimentoVersao,
      registro.criado_em, JSON.stringify(registro.origem), ipH);
  } catch (e) {
    console.error("[db] erro ao gravar lead:", e.message);
    return json(req, res, 500, { erro: "Não foi possível registrar o envio. Tente novamente." });
  }
  notificar(registro).catch(() => {});
  json(req, res, 201, { ok: true, id: registro.id });
}

/* ------------------------------------------------------------------ Painel administrativo */
const tokenCsrf = (sessao) => crypto.createHmac("sha256", CONFIG.saltIp + CONFIG.adminSenha).update(sessao).digest("hex").slice(0, 40);
function iguais(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function autenticar(req, res) {
  if (CONFIG.adminSenha.length < 12) {
    cabecalhosSeguranca(res, true);
    enviar(req, res, 503, "Painel desativado: defina ADMIN_PASSWORD (12+ caracteres) no arquivo .env.", "text/plain; charset=utf-8");
    return false;
  }
  const ipH = hashIp(ipDe(req));
  const cab = String(req.headers.authorization || "");
  const [tipo, cred] = cab.split(" ");
  let ok = false;
  if (tipo === "Basic" && cred) {
    const [u, ...resto] = Buffer.from(cred, "base64").toString("utf8").split(":");
    ok = iguais(u, CONFIG.adminUser) & iguais(resto.join(":"), CONFIG.adminSenha);
  }
  if (!ok) {
    if (cab && limitar("login:" + ipH, 10, 15 * 60_000)) { cabecalhosSeguranca(res, true); enviar(req, res, 429, "Muitas tentativas. Aguarde 15 minutos.", "text/plain; charset=utf-8"); return false; }
    cabecalhosSeguranca(res, true);
    res.setHeader("WWW-Authenticate", 'Basic realm="Painel M&L", charset="UTF-8"');
    enviar(req, res, 401, "Acesso restrito.", "text/plain; charset=utf-8");
    return false;
  }
  return true;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dataBR = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const foneBR = (d) => d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;
const ROTULO_ESTADO = { novo: "Novo", em_contato: "Em contato", convertido: "Convertido", descartado: "Descartado" };

/* ------------------------------------------------------------------ Assinatura eletrônica (Autentique) */
const ESTADOS_ASSINATURA = {
  enviado: "Enviado", visualizado: "Visualizado", assinado: "Assinado", recusado: "Recusado",
  falha_envio: "Falha no envio", cancelado: "Cancelado",
};
const ORDEM_ASSINATURA = { enviado: 1, falha_envio: 1, visualizado: 2, assinado: 3, recusado: 3, cancelado: 4 };
const TIPOS_ARQUIVO = { ".pdf": "application/pdf", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain", ".html": "text/html" };
const LIMITE_ARQUIVO = 5 * 1024 * 1024; // limite do plano gratuito do Autentique

function listarModelos() {
  let nomes = [];
  try { nomes = fs.readdirSync(PASTA_MODELOS).filter((n) => /^[a-z0-9-]+\.html$/.test(n)).sort(); } catch { return []; }
  return nomes.map((arquivo) => {
    const html = fs.readFileSync(path.join(PASTA_MODELOS, arquivo), "utf8");
    const titulo = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || arquivo;
    return { arquivo, titulo: titulo.trim(), html };
  });
}
function preencherModelo(html, lead) {
  const valores = {
    nome: lead.nome, cidade: lead.cidade, uf: lead.uf,
    data: new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "long", year: "numeric" }),
    ...CONFIG.modelo,
  };
  const faltam = new Set();
  const corpo = html.replace(/<!--[\s\S]*?-->/g, "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => {
    if (!(k in valores) || !String(valores[k]).trim()) { faltam.add(k); return ""; }
    return esc(valores[k]);
  });
  return { corpo, faltam: [...faltam] };
}
function atualizarAssinatura(documentoId, estado, extra = {}) {
  const a = db.prepare("SELECT * FROM assinaturas WHERE documento_id = ?").get(documentoId);
  if (!a) return false;
  // eventos podem chegar fora de ordem: só avança (exceto "cancelado", que sempre vale)
  const novo = estado && (estado === "cancelado" || (ORDEM_ASSINATURA[estado] || 0) >= (ORDEM_ASSINATURA[a.estado] || 0)) ? estado : a.estado;
  db.prepare("UPDATE assinaturas SET estado = ?, arquivo_assinado = COALESCE(?, arquivo_assinado), atualizado_em = ? WHERE id = ?")
    .run(novo, extra.arquivoAssinado || null, new Date().toISOString(), a.id);
  if (novo === "assinado") {
    db.prepare("UPDATE leads SET estado = 'convertido', atualizado_em = ? WHERE id = ? AND estado IN ('novo', 'em_contato')").run(new Date().toISOString(), a.lead_id);
  }
  return true;
}

// avisos de uma só leitura no painel (resultado das ações)
const avisos = new Map();
function guardarAviso(tipo, texto) {
  const k = crypto.randomBytes(8).toString("hex");
  avisos.set(k, { tipo, texto, em: Date.now() });
  for (const [c, v] of avisos) if (Date.now() - v.em > 600_000) avisos.delete(c);
  return k;
}

function lerBuffer(req, limite) {
  return new Promise((resolve, reject) => {
    let total = 0; const partes = [];
    req.on("data", (p) => {
      total += p.length;
      if (total > limite) { reject(Object.assign(new Error("grande"), { status: 413 })); req.destroy(); return; }
      partes.push(p);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}

async function enviarParaAssinatura(req, res, leadId) {
  const voltar = (tipo, texto) => { res.writeHead(303, { Location: "/admin?aviso=" + guardarAviso(tipo, texto) + "#lead-" + leadId }); res.end(); };
  const ct = String(req.headers["content-type"] || "");
  if (!ct.startsWith("multipart/form-data")) return json(req, res, 415, { erro: "Formato inválido." });
  let form;
  try {
    const buf = await lerBuffer(req, LIMITE_ARQUIVO + 64 * 1024);
    form = await new Response(buf, { headers: { "Content-Type": ct } }).formData();
  } catch (e) {
    if (e.status === 413) return voltar("erro", "O arquivo passa de 5 MB, o limite do Autentique no plano gratuito.");
    return voltar("erro", "Não foi possível ler o formulário.");
  }
  if (!iguais(String(form.get("csrf") || ""), tokenCsrf(String(req.headers.authorization)))) return json(req, res, 403, { erro: "Token inválido." });
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);
  if (!lead) return voltar("erro", "Contato não encontrado.");
  if (!assinador.ativo) return voltar("erro", "Configure AUTENTIQUE_TOKEN no .env para enviar documentos.");

  const metodo = String(form.get("metodo") || "");
  if (!["whatsapp", "email", "link"].includes(metodo)) return voltar("erro", "Escolha como enviar o documento.");
  if (metodo === "email" && !lead.email) return voltar("erro", "Este contato não informou e-mail. Use WhatsApp ou link.");

  // documento: modelo preenchido ou arquivo enviado pelo escritório
  const origem = String(form.get("documento") || "");
  let arquivo, nomeDocumento = texto(form.get("nome_documento"), 120);
  if (origem === "upload") {
    const f = form.get("arquivo");
    if (!f || typeof f === "string" || !f.size) return voltar("erro", "Escolha o arquivo (PDF, DOC, DOCX ou TXT).");
    const ext = path.extname(f.name || "").toLowerCase();
    if (!TIPOS_ARQUIVO[ext] || ext === ".html") return voltar("erro", "Formato não aceito. Envie PDF, DOC, DOCX ou TXT.");
    if (f.size > LIMITE_ARQUIVO) return voltar("erro", "O arquivo passa de 5 MB.");
    const buffer = Buffer.from(await f.arrayBuffer());
    if (ext === ".pdf" && buffer.subarray(0, 5).toString() !== "%PDF-") return voltar("erro", "O arquivo não parece ser um PDF válido.");
    arquivo = { buffer, nome: path.basename(f.name).replace(/[^\w.\- ]+/g, "_"), tipo: TIPOS_ARQUIVO[ext] };
    nomeDocumento = nomeDocumento || path.basename(f.name, ext);
  } else {
    const modelo = listarModelos().find((m) => m.arquivo === origem);
    if (!modelo) return voltar("erro", "Escolha um documento.");
    const { corpo, faltam } = preencherModelo(modelo.html, lead);
    if (faltam.length) return voltar("erro", "Faltam dados no .env para este modelo: " + faltam.map((k) => "MODELO_" + k.toUpperCase()).join(", ") + ".");
    arquivo = { buffer: Buffer.from(corpo, "utf8"), nome: modelo.arquivo, tipo: "text/html" };
    nomeDocumento = nomeDocumento || modelo.titulo;
  }
  nomeDocumento = `${nomeDocumento} — ${lead.nome}`.slice(0, 180);

  try {
    const r = await assinador.criarDocumento({
      nomeDocumento, arquivo,
      mensagem: "Olá! Segue o documento da M&L Advocacia e Assessoria para a sua assinatura eletrônica.",
      signatario: { nome: lead.nome, email: lead.email, telefone: lead.whatsapp, metodo },
    });
    db.prepare(`INSERT INTO assinaturas (id, lead_id, documento_id, nome_documento, metodo, link, estado, sandbox, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, 'enviado', ?, ?)`).run(crypto.randomUUID(), lead.id, r.id, nomeDocumento, metodo, r.link || null, CONFIG.autentiqueSandbox ? 1 : 0, new Date().toISOString());
    if (lead.estado === "novo") db.prepare("UPDATE leads SET estado = 'em_contato', atualizado_em = ? WHERE id = ?").run(new Date().toISOString(), lead.id);
    const como = metodo === "whatsapp" ? "pelo WhatsApp" : metodo === "email" ? "por e-mail" : "por link (copie o link abaixo e envie ao cliente)";
    return voltar("ok", `Documento enviado para assinatura ${como}${CONFIG.autentiqueSandbox ? " — MODO DE TESTE (sandbox): não tem validade" : ""}.`);
  } catch (e) {
    console.error("[autentique]", e.message);
    return voltar("erro", e.message);
  }
}

async function atualizarDoAutentique(req, res, assinaturaId) {
  const a = db.prepare("SELECT * FROM assinaturas WHERE id = ?").get(assinaturaId);
  const voltar = (tipo, txt) => { res.writeHead(303, { Location: "/admin?aviso=" + guardarAviso(tipo, txt) + (a ? "#lead-" + a.lead_id : "") }); res.end(); };
  const corpo = new URLSearchParams(await lerCorpo(req, 4096).catch(() => ""));
  if (!iguais(corpo.get("csrf") || "", tokenCsrf(String(req.headers.authorization)))) return json(req, res, 403, { erro: "Token inválido." });
  if (!a) return voltar("erro", "Documento não encontrado.");
  try {
    const r = await assinador.consultarDocumento(a.documento_id);
    atualizarAssinatura(a.documento_id, r.estado, { arquivoAssinado: r.arquivoAssinado });
    return voltar("ok", `Situação atualizada: ${ESTADOS_ASSINATURA[r.estado] || r.estado}.`);
  } catch (e) { return voltar("erro", e.message); }
}

async function webhookAutentique(req, res) {
  if (!CONFIG.autentiqueSegredo) return json(req, res, 503, { erro: "Webhook não configurado." });
  let bruto;
  try { bruto = await lerBuffer(req, 1024 * 1024); } catch { return json(req, res, 413, { erro: "Corpo grande demais." }); }
  if (!autentique.verificarWebhook(bruto, req.headers["x-autentique-signature"], CONFIG.autentiqueSegredo)) return json(req, res, 401, { erro: "Assinatura inválida." });
  let dados; try { dados = JSON.parse(bruto.toString("utf8")); } catch { return json(req, res, 400, { erro: "JSON inválido." }); }
  const evento = dados.event || dados;
  const idEvento = String(evento.id || "");
  if (idEvento) {
    const novo = db.prepare("INSERT OR IGNORE INTO eventos_autentique (id, recebido_em) VALUES (?, ?)").run(idEvento, new Date().toISOString());
    if (!novo.changes) return json(req, res, 200, { ok: true, duplicado: true });
  }
  const estado = autentique.estadoDoEvento(evento.type);
  const doc = autentique.documentoDoEvento(evento);
  if (estado && doc) atualizarAssinatura(String(doc), estado);
  return json(req, res, 200, { ok: true });
}

function blocoAssinatura(l, csrf, modelos) {
  const docs = db.prepare("SELECT * FROM assinaturas WHERE lead_id = ? ORDER BY criado_em DESC").all(l.id);
  const lista = docs.map((a) => `<li class="ass ass-${esc(a.estado)}"><b>${esc(a.nome_documento.replace(" — " + l.nome, ""))}</b>
      <span class="selo">${esc(ESTADOS_ASSINATURA[a.estado] || a.estado)}</span>${a.sandbox ? ' <span class="selo teste">teste</span>' : ""}
      <br><small>${esc(dataBR(a.criado_em))} · ${a.metodo === "whatsapp" ? "WhatsApp" : a.metodo === "email" ? "E-mail" : "Link"}</small>
      ${a.link ? `<br><label class="link">Link de assinatura <input readonly value="${esc(a.link)}"></label>` : ""}
      ${a.arquivo_assinado ? `<br><a href="${esc(a.arquivo_assinado)}" target="_blank" rel="noopener">Baixar documento assinado</a>` : ""}
      <form method="post" action="/admin/assinaturas/${esc(a.id)}/atualizar"><input type="hidden" name="csrf" value="${csrf}"><button class="sec">Atualizar situação</button></form></li>`).join("");
  const opcoes = modelos.map((m) => `<option value="${esc(m.arquivo)}">${esc(m.titulo)} (modelo)</option>`).join("") + '<option value="upload">Enviar um arquivo (PDF, DOC, DOCX)</option>';
  const form = assinador.ativo
    ? `<details class="enviar-ass"><summary>Enviar documento para assinatura</summary>
      <form method="post" action="/admin/leads/${esc(l.id)}/assinatura" enctype="multipart/form-data">
        <input type="hidden" name="csrf" value="${csrf}">
        <label>Documento <select name="documento">${opcoes}</select></label>
        <label>Arquivo (se escolheu "Enviar um arquivo") <input type="file" name="arquivo" accept=".pdf,.doc,.docx,.txt"></label>
        <label>Nome do documento (opcional) <input name="nome_documento" maxlength="120" placeholder="Ex.: Contrato de honorários"></label>
        <fieldset><legend>Enviar por</legend>
          <label><input type="radio" name="metodo" value="whatsapp" checked> WhatsApp ${esc(foneBR(l.whatsapp))}</label>
          ${l.email ? `<label><input type="radio" name="metodo" value="email"> E-mail ${esc(l.email)}</label>` : ""}
          <label><input type="radio" name="metodo" value="link"> Só gerar o link</label></fieldset>
        <button>Enviar para assinatura</button>
      </form></details>`
    : '<p class="dica">Assinatura eletrônica desativada: defina AUTENTIQUE_TOKEN no .env.</p>';
  return (lista ? `<ul class="assinaturas">${lista}</ul>` : "") + form;
}

function paginaAdmin(req, res, url) {
  const filtro = ESTADOS_LEAD.includes(url.searchParams.get("estado")) ? url.searchParams.get("estado") : "";
  const linhas = filtro
    ? db.prepare("SELECT * FROM leads WHERE estado = ? ORDER BY criado_em DESC LIMIT 1000").all(filtro)
    : db.prepare("SELECT * FROM leads ORDER BY criado_em DESC LIMIT 1000").all();
  const contagem = Object.fromEntries(db.prepare("SELECT estado, COUNT(*) n FROM leads GROUP BY estado").all().map((r) => [r.estado, r.n]));
  const total = Object.values(contagem).reduce((a, b) => a + b, 0);
  const csrf = tokenCsrf(String(req.headers.authorization));
  const modelos = listarModelos();
  const aviso = avisos.get(url.searchParams.get("aviso") || "");
  const corpo = linhas.map((l) => {
    const resp = JSON.parse(l.respostas); const org = JSON.parse(l.origem || "{}");
    const detalhes = Object.entries(resp).filter(([k]) => k !== "situacao").map(([k, v]) => `<li><b>${esc(NOMES_PERGUNTAS[k] || k)}:</b> ${esc(rotuloResposta(k, v))}</li>`).join("");
    const origemTxt = [org.utm_source, org.utm_medium, org.utm_campaign].filter(Boolean).join(" / ") || (org.referencia ? esc(org.referencia) : "direto");
    return `<tr id="lead-${esc(l.id)}">
      <td>${esc(dataBR(l.criado_em))}</td>
      <td><b>${esc(l.nome)}</b><br><a href="https://wa.me/55${esc(l.whatsapp)}" target="_blank" rel="noopener">${esc(foneBR(l.whatsapp))}</a>${l.email ? `<br>${esc(l.email)}` : ""}<br>${esc(l.cidade)}/${esc(l.uf)}</td>
      <td><b>${esc(ROTULOS.situacao[l.situacao] || l.situacao)}</b>${l.interesse ? `<br><i>${esc(l.interesse)}</i>` : ""}<ul>${detalhes}</ul></td>
      <td>${esc(origemTxt)}</td>
      <td><form method="post" action="/admin/leads/${esc(l.id)}/estado"><input type="hidden" name="csrf" value="${csrf}"><select name="estado">${ESTADOS_LEAD.map((e) => `<option value="${e}"${e === l.estado ? " selected" : ""}>${ROTULO_ESTADO[e]}</option>`).join("")}</select> <button>Salvar</button></form>
      <form method="post" action="/admin/leads/${esc(l.id)}/excluir" class="excluir"><input type="hidden" name="csrf" value="${csrf}"><label><input type="checkbox" name="confirmar" value="sim" required> confirmar</label> <button>Excluir</button></form></td>
      <td>${blocoAssinatura(l, csrf, modelos)}</td>
    </tr>`;
  }).join("");
  const filtros = [["", `Todos (${total})`], ...ESTADOS_LEAD.map((e) => [e, `${ROTULO_ESTADO[e]} (${contagem[e] || 0})`])]
    .map(([v, t]) => `<a href="/admin${v ? "?estado=" + v : ""}"${v === filtro ? ' class="ativo"' : ""}>${t}</a>`).join("");
  cabecalhosSeguranca(res, true);
  enviar(req, res, 200, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Painel de contatos · M&amp;L</title>
<style>
body{margin:0;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#172A31;background:#fff}
header{background:#172A31;color:#fff;padding:20px 28px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;border-bottom:3px solid #A59970}
header h1{margin:0;font-size:20px;font-family:Georgia,serif}header a{color:#fff}
main{padding:24px 28px}.filtros{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}.filtros a{padding:8px 14px;border:1px solid #172A31;border-radius:4px;text-decoration:none;color:#172A31;font-size:14px}.filtros a.ativo{background:#172A31;color:#fff}
.tabela{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:1180px;font-size:14px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #d9dcdd}th{font-size:12px;letter-spacing:.08em;text-transform:uppercase;background:#f4f2ec}
ul{margin:6px 0 0;padding-left:18px}form{margin:0 0 8px}select,button{font:inherit;padding:6px 10px;border:1px solid #172A31;border-radius:4px;background:#fff;color:#172A31}button{background:#172A31;color:#fff;cursor:pointer}.excluir button{background:#fff;color:#8A1C1C;border-color:#8A1C1C}.excluir label{font-size:12px}
.vazio{padding:48px;text-align:center;border:1px dashed #A59970}.nota{font-size:13px;margin-top:20px}
.aviso{padding:14px 18px;border-radius:4px;margin-bottom:18px;font-size:14px}.aviso.ok{background:#EAF4EE;border:1px solid #2E8B57}.aviso.erro{background:#FBEFEF;border:1px solid #8A1C1C;color:#8A1C1C}
.sandbox{background:#FFF7E0;border:1px solid #A59970;padding:10px 14px;font-size:13px;margin-bottom:18px}
.assinaturas{list-style:none;padding:0;margin:0 0 10px}.ass{padding:8px 0;border-bottom:1px dashed #d9dcdd}.ass form{margin:6px 0 0}
.selo{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:#e6e9ea}.ass-assinado .selo{background:#2E8B57;color:#fff}.ass-recusado .selo,.ass-falha_envio .selo{background:#8A1C1C;color:#fff}.ass-visualizado .selo{background:#A59970;color:#fff}.selo.teste{background:#FFF0B3;color:#6b5400}
.link input{box-sizing:border-box;width:100%;font-size:12px;padding:4px 6px;margin-top:2px;border:1px solid #d9dcdd}
.enviar-ass summary{cursor:pointer;font-weight:600;color:#172A31}.enviar-ass form{display:grid;gap:8px;margin-top:10px;max-width:320px}.enviar-ass label{display:grid;gap:3px;font-size:13px}.enviar-ass input:not([type=radio]),.enviar-ass select{font:inherit;padding:6px 8px;border:1px solid #172A31;border-radius:4px}
.enviar-ass fieldset{border:1px solid #d9dcdd;padding:8px 10px;margin:0;display:grid;gap:4px}.enviar-ass fieldset label{display:flex;gap:6px;align-items:center}button.sec{background:#fff;color:#172A31;font-size:12px;padding:4px 10px}.dica{font-size:12px;color:#555}
</style></head><body><header><h1>Painel de contatos · M&amp;L Advocacia</h1><a href="/admin/leads.csv">Exportar CSV</a></header>
<main>${aviso ? `<p class="aviso ${aviso.tipo}" role="status">${esc(aviso.texto)}</p>` : ""}${assinador.ativo && CONFIG.autentiqueSandbox ? '<p class="sandbox"><b>Autentique em modo de teste (sandbox):</b> os documentos não gastam créditos, são apagados em poucos dias e <b>não têm validade jurídica</b>. Para usar de verdade, defina AUTENTIQUE_SANDBOX=0 no .env.</p>' : ""}<nav class="filtros">${filtros}</nav>
${linhas.length ? `<div class="tabela"><table><thead><tr><th>Data</th><th>Contato</th><th>Situação e respostas</th><th>Origem</th><th>Estado</th><th>Assinatura digital</th></tr></thead><tbody>${corpo}</tbody></table></div>` : `<p class="vazio">Nenhum contato ${filtro ? "neste estado" : "recebido ainda"}.</p>`}
<p class="nota">Dados pessoais protegidos pela LGPD: use-os apenas para responder ao contato. A exclusão é definitiva.</p></main></body></html>`, "text/html; charset=utf-8", { "Cache-Control": "no-store" });
}

function mesmaOrigem(req) {
  const o = req.headers.origin || req.headers.referer || "";
  return !o || o.replace(/^https?:\/\//, "").startsWith(req.headers.host || "");
}
async function acaoAdmin(req, res, id, acao) {
  const origemCab = req.headers.origin || req.headers.referer || "";
  const hostAtual = req.headers.host || "";
  if (origemCab && !origemCab.replace(/^https?:\/\//, "").startsWith(hostAtual)) return json(req, res, 403, { erro: "Origem inválida." });
  const corpo = new URLSearchParams(await lerCorpo(req, 4096).catch(() => ""));
  if (!iguais(corpo.get("csrf") || "", tokenCsrf(String(req.headers.authorization)))) return json(req, res, 403, { erro: "Token inválido." });
  if (acao === "estado") {
    const estado = corpo.get("estado");
    if (!ESTADOS_LEAD.includes(estado)) return json(req, res, 400, { erro: "Estado inválido." });
    db.prepare("UPDATE leads SET estado = ?, atualizado_em = ? WHERE id = ?").run(estado, new Date().toISOString(), id);
  } else if (acao === "excluir") {
    if (corpo.get("confirmar") !== "sim") return json(req, res, 400, { erro: "Confirme a exclusão." });
    db.prepare("DELETE FROM assinaturas WHERE lead_id = ?").run(id);
    db.prepare("DELETE FROM leads WHERE id = ?").run(id);
  }
  res.writeHead(303, { Location: "/admin" }); res.end();
}

function csvAdmin(req, res) {
  const linhas = db.prepare("SELECT * FROM leads ORDER BY criado_em DESC").all();
  const col = ["data", "nome", "whatsapp", "email", "cidade", "uf", "situacao", "interesse", ...Object.keys(NOMES_PERGUNTAS), "origem", "campanha", "estado", "versao_politica"];
  const c = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const out = [col.map(c).join(";")];
  for (const l of linhas) {
    const r = JSON.parse(l.respostas); const o = JSON.parse(l.origem || "{}");
    out.push([dataBR(l.criado_em), l.nome, l.whatsapp, l.email, l.cidade, l.uf, ROTULOS.situacao[l.situacao] || l.situacao, l.interesse,
      ...Object.keys(NOMES_PERGUNTAS).map((k) => (r[k] ? rotuloResposta(k, r[k]) : "")), o.utm_source || o.referencia || "direto", o.utm_campaign || "",
      ROTULO_ESTADO[l.estado] || l.estado, l.consentimento_versao].map(c).join(";"));
  }
  cabecalhosSeguranca(res, true);
  enviar(req, res, 200, "﻿" + out.join("\r\n"), "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="contatos-wl-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" });
}

/* ------------------------------------------------------------------ Roteador */
const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    if (p === "/api/leads") {
      if (req.method !== "POST") return json(req, res, 405, { erro: "Método não permitido." });
      cabecalhosSeguranca(res, false);
      return await apiLeads(req, res);
    }
    if (p === "/api/autentique/webhook") {
      if (req.method !== "POST") return json(req, res, 405, { erro: "Método não permitido." });
      return await webhookAutentique(req, res);
    }
    if (p === "/healthz") return json(req, res, 200, { ok: true });
    if (p === "/robots.txt") {
      return enviar(req, res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n${CONFIG.siteUrl ? `\nSitemap: ${CONFIG.siteUrl}/sitemap.xml\n` : ""}`, "text/plain; charset=utf-8", { "Cache-Control": "public, max-age=86400" });
    }
    if (p === "/sitemap.xml") {
      const base = CONFIG.siteUrl || `http://${req.headers.host}`;
      const hoje = new Date().toISOString().slice(0, 10);
      return enviar(req, res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${base}/</loc><lastmod>${hoje}</lastmod><priority>1.0</priority></url>\n<url><loc>${base}/politica-de-privacidade.html</loc><lastmod>${hoje}</lastmod><priority>0.3</priority></url>\n</urlset>\n`, "application/xml; charset=utf-8", { "Cache-Control": "public, max-age=86400" });
    }
    if (p === "/admin" || p.startsWith("/admin/")) {
      if (!autenticar(req, res)) return;
      if (p === "/admin" && req.method === "GET") return paginaAdmin(req, res, url);
      if (p === "/admin/leads.csv" && req.method === "GET") return csvAdmin(req, res);
      const m = p.match(/^\/admin\/leads\/([0-9a-f-]{36})\/(estado|excluir)$/);
      if (m && req.method === "POST") return await acaoAdmin(req, res, m[1], m[2]);
      const ma = p.match(/^\/admin\/leads\/([0-9a-f-]{36})\/assinatura$/);
      if (ma && req.method === "POST") { if (!mesmaOrigem(req)) return json(req, res, 403, { erro: "Origem inválida." }); return await enviarParaAssinatura(req, res, ma[1]); }
      const mu = p.match(/^\/admin\/assinaturas\/([0-9a-f-]{36})\/atualizar$/);
      if (mu && req.method === "POST") { if (!mesmaOrigem(req)) return json(req, res, 403, { erro: "Origem inválida." }); return await atualizarDoAutentique(req, res, mu[1]); }
      return naoEncontrado(req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(req, res, 405, { erro: "Método não permitido." });
    return servirEstatico(req, res, url);
  } catch (e) {
    console.error("[erro]", e);
    if (!res.headersSent) json(req, res, 500, { erro: "Erro interno." });
  }
});
servidor.headersTimeout = 15_000;
servidor.requestTimeout = 20_000;
servidor.listen(CONFIG.porta, CONFIG.host, () => {
  console.log(`Site M&L em http://localhost:${CONFIG.porta}`);
  if (CONFIG.adminSenha.length < 12) console.warn("[aviso] Painel /admin desativado: defina ADMIN_PASSWORD (12+ caracteres).");
  if (assinador.ativo) console.log(`Autentique ativo${CONFIG.autentiqueSandbox ? " em MODO DE TESTE (sandbox)" : ""}.`);
  if (!CONFIG.siteUrl) console.warn("[aviso] SITE_URL não definido: canonical, Open Graph e sitemap usarão URLs relativas.");
});
for (const sinal of ["SIGINT", "SIGTERM"]) process.on(sinal, () => { servidor.close(); db.close(); process.exit(0); });
