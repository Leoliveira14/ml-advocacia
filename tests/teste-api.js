/* Testes automáticos da API e do painel (sem dependências).
   Uso: npm test  — sobe um servidor temporário numa porta livre com dados num diretório temporário. */
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const PORTA = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORTA}`;
const DADOS = fs.mkdtempSync(path.join(os.tmpdir(), "wl-teste-"));
const SENHA = "senha-de-teste-123";
const AUTH = "Basic " + Buffer.from("admin:" + SENHA).toString("base64");

const valido = () => ({
  respostas: { situacao: "bebe_recente", nascimento_bebe: "2026-10-01", ja_solicitou: "sim", status_pedido: "negado", contribuiu: "sim", vinculo: "mei", meu_inss: "sim", comunicacao_inss: "sim", documentos: "alguns", deseja_orientacao: "sim" },
  contato: { nome: "Maria Teste da Silva", whatsapp: "11912345678", email: "maria@example.com", cidade: "São Paulo", uf: "SP" },
  consentimento: { aceito: true, versao_politica: "2026-11" },
  interesse: "", origem: { utm_source: "instagram", utm_campaign: "maes", pagina_entrada: "/" }, site: "", tempo_preenchimento_ms: 25000,
});
const post = (corpo, cab = {}) => fetch(BASE + "/api/leads", { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(corpo) });
const crypto = require("node:crypto");
const http = require("node:http");
const SEGREDO_WH = "segredo-webhook-teste";
// Autentique falso: guarda os pedidos recebidos e responde como a API real
const recebidos = [];
let docN = 0;
const falso = http.createServer(async (req, res) => {
  const partes = []; for await (const p of req) partes.push(p);
  const buf = Buffer.concat(partes);
  const reg = { auth: req.headers.authorization, ct: req.headers["content-type"] };
  const resp = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (String(reg.ct).startsWith("multipart/")) {
    const fd = await new Response(buf, { headers: { "Content-Type": reg.ct } }).formData();
    reg.ops = JSON.parse(fd.get("operations")); reg.map = JSON.parse(fd.get("map"));
    const f = fd.get("file"); reg.arquivo = { nome: f.name, tipo: f.type, texto: Buffer.from(await f.arrayBuffer()).toString("utf8") };
    recebidos.push(reg);
    const s = reg.ops.variables.signers[0];
    if (s.email === "falha@example.com") return resp({ errors: [{ message: "email inválido" }] });
    const id = "doc-" + (++docN).toString().padStart(4, "0") + "-aaaa-bbbb-cccc";
    return resp({ data: { createDocument: { id, name: reg.ops.variables.document.name, created_at: "2026-11-25", signatures: [
      { public_id: "own", name: "Escritório", email: "esc@x.com", action: { name: "OWNER" }, link: null },
      { public_id: "p1", name: s.name || null, email: s.email || null, action: { name: "SIGN" }, link: s.name ? { short_link: "https://assina.ae/teste" + docN } : null }] } } });
  }
  reg.json = JSON.parse(buf.toString()); recebidos.push(reg);
  return resp({ data: { document: { id: reg.json.variables.id, name: "x", files: { original: "https://o", signed: "https://autentique.test/assinado.pdf" },
    signatures: [{ public_id: "own", action: { name: "OWNER" }, signed: { created_at: "x" } }, { public_id: "p1", action: { name: "SIGN" }, viewed: { created_at: "x" }, signed: { created_at: "y" }, rejected: null }] } } });
});
const PORTA_FALSA = PORTA + 200;
let ok = 0;
async function caso(nome, fn) { await fn(); ok++; console.log("  ✓ " + nome); }

(async () => {
  await new Promise((r) => falso.listen(PORTA_FALSA, "127.0.0.1", r));
  const srv = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORTA), HOST: "127.0.0.1", DATA_DIR: DADOS, ADMIN_PASSWORD: SENHA, IP_SALT: "teste", NODE_ENV: "test", RATE_LIMIT_MAX: "9", SITE_URL: "https://www.exemplo.com.br",
      AUTENTIQUE_TOKEN: "token-teste", AUTENTIQUE_API_URL: `http://127.0.0.1:${PORTA_FALSA}/v2/graphql`, AUTENTIQUE_WEBHOOK_SECRET: SEGREDO_WH,
      MODELO_ADVOGADO_NOME: "Dra. Teste Advogada", MODELO_ADVOGADO_OAB: "OAB/SP 000.000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stderr.on("data", (d) => process.env.DEBUG && process.stderr.write(d));
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + "/healthz"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

  try {
    console.log("API de leads");
    await caso("aceita um lead válido (201)", async () => { const r = await post(valido()); assert.equal(r.status, 201); assert.ok((await r.json()).id); });
    await caso("rejeita situação inválida (400)", async () => { const c = valido(); c.respostas.situacao = "x"; assert.equal((await post(c)).status, 400); });
    await caso("rejeita WhatsApp inválido (400)", async () => { const c = valido(); c.contato.whatsapp = "123"; assert.equal((await post(c)).status, 400); });
    await caso("exige consentimento (400)", async () => { const c = valido(); c.consentimento.aceito = false; assert.equal((await post(c)).status, 400); });
    await caso("exige data do bebê quando aplicável (400)", async () => { const c = valido(); delete c.respostas.nascimento_bebe; assert.equal((await post(c)).status, 400); });
    await caso("ignora campos não previstos", async () => { const c = valido(); c.respostas.cpf = "123"; assert.equal((await post(c)).status, 201); });
    await caso("isca antispam: responde 200 e não grava", async () => { const c = valido(); c.site = "http://spam"; const r = await post(c); assert.equal(r.status, 200); assert.equal((await r.json()).id, undefined); });
    await caso("envio rápido demais: não grava", async () => { const c = valido(); c.tempo_preenchimento_ms = 500; const r = await post(c); assert.equal((await r.json()).id, undefined); });
    await caso("limite de envios por IP (429)", async () => { let s; for (let i = 0; i < 10; i++) s = (await post(valido())).status; assert.equal(s, 429); });
    await caso("rejeita content-type não JSON (415)", async () => { const r = await fetch(BASE + "/api/leads", { method: "POST", body: "a=b" }); assert.equal(r.status, 415); });
    await caso("rejeita corpo grande (413)", async () => { const r = await fetch(BASE + "/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: "a".repeat(20000) }) }); assert.ok([413, 400, 429].includes(r.status)); });

    console.log("Painel administrativo");
    await caso("sem senha → 401", async () => { assert.equal((await fetch(BASE + "/admin")).status, 401); });
    await caso("senha errada → 401", async () => { assert.equal((await fetch(BASE + "/admin", { headers: { Authorization: "Basic " + Buffer.from("admin:errada").toString("base64") } })).status, 401); });
    let html;
    await caso("com senha → lista os leads", async () => { const r = await fetch(BASE + "/admin", { headers: { Authorization: AUTH } }); assert.equal(r.status, 200); html = await r.text(); assert.match(html, /Maria Teste da Silva/); assert.match(html, /instagram/); });
    await caso("escapa HTML nos dados", async () => { assert.doesNotMatch(html, /<script>/); });
    const id = html.match(/\/admin\/leads\/([0-9a-f-]{36})\/estado/)[1];
    const csrf = html.match(/name="csrf" value="([0-9a-f]+)"/)[1];
    await caso("altera estado com CSRF válido", async () => {
      const r = await fetch(`${BASE}/admin/leads/${id}/estado`, { method: "POST", redirect: "manual", headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: `csrf=${csrf}&estado=em_contato` });
      assert.equal(r.status, 303);
    });
    await caso("bloqueia ação sem CSRF (403)", async () => {
      const r = await fetch(`${BASE}/admin/leads/${id}/estado`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: "estado=novo" });
      assert.equal(r.status, 403);
    });
    await caso("exporta CSV", async () => { const r = await fetch(BASE + "/admin/leads.csv", { headers: { Authorization: AUTH } }); assert.equal(r.status, 200); const t = await r.text(); assert.match(t, /Maria Teste da Silva/); assert.match(t, /Em contato/); });
    console.log("Assinatura eletrônica (Autentique)");
    const painel = async () => (await fetch(BASE + "/admin", { headers: { Authorization: AUTH } })).text();
    const enviarDoc = async (campos, arquivo) => {
      const fd = new FormData(); fd.append("csrf", csrf);
      for (const [k, v] of Object.entries(campos)) fd.append(k, v);
      if (arquivo) fd.append("arquivo", new Blob([arquivo.conteudo], { type: arquivo.tipo }), arquivo.nome);
      return fetch(`${BASE}/admin/leads/${id}/assinatura`, { method: "POST", redirect: "manual", headers: { Authorization: AUTH }, body: fd });
    };
    await caso("painel mostra o envio para assinatura com o modelo de procuração", async () => {
      const t = await painel(); assert.match(t, /Enviar documento para assinatura/); assert.match(t, /Procuração previdenciária \(modelo\)/); assert.match(t, /modo de teste \(sandbox\)/i);
    });
    await caso("envia a procuração preenchida pelo WhatsApp (sandbox, chave só no servidor)", async () => {
      const r = await enviarDoc({ documento: "procuracao-previdenciaria.html", metodo: "whatsapp" });
      assert.equal(r.status, 303);
      const q = recebidos.at(-1);
      assert.equal(q.auth, "Bearer token-teste");
      assert.match(q.ops.query, /createDocument\(sandbox: true/);
      assert.deepEqual(q.map, { file: ["variables.file"] });
      assert.deepEqual(q.ops.variables.signers[0], { action: "SIGN", phone: "+5511912345678", delivery_method: "DELIVERY_METHOD_WHATSAPP" });
      assert.match(q.arquivo.texto, /Maria Teste da Silva/); assert.match(q.arquivo.texto, /Dra\. Teste Advogada/); assert.match(q.arquivo.texto, /OAB\/SP 000\.000/);
      assert.doesNotMatch(q.arquivo.texto, /\{\{|MODELO —/);
      assert.match(q.ops.variables.document.name, /Procuração previdenciária — Maria Teste da Silva/);
      const t = await (await fetch(BASE + r.headers.get("location").split("#")[0], { headers: { Authorization: AUTH } })).text();
      assert.match(t, /Documento enviado para assinatura pelo WhatsApp/); assert.match(t, /class="selo">Enviado/);
    });
    await caso("envia PDF do escritório por e-mail", async () => {
      const r = await enviarDoc({ documento: "upload", metodo: "email", nome_documento: "Contrato de honorários" }, { conteudo: "%PDF-1.4 teste", tipo: "application/pdf", nome: "contrato.pdf" });
      assert.equal(r.status, 303);
      const q = recebidos.at(-1);
      assert.equal(q.ops.variables.signers[0].email, "maria@example.com"); assert.equal(q.arquivo.nome, "contrato.pdf"); assert.equal(q.arquivo.tipo, "application/pdf");
    });
    await caso("recusa arquivo que não é PDF de verdade", async () => {
      const antes = recebidos.length;
      const r = await enviarDoc({ documento: "upload", metodo: "email" }, { conteudo: "olá", tipo: "application/pdf", nome: "falso.pdf" });
      assert.equal(r.status, 303); assert.equal(recebidos.length, antes);
      const t = await (await fetch(BASE + r.headers.get("location").split("#")[0], { headers: { Authorization: AUTH } })).text();
      assert.match(t, /não parece ser um PDF válido/);
    });
    await caso("só link: mostra o link de assinatura para copiar", async () => {
      const r = await enviarDoc({ documento: "procuracao-previdenciaria.html", metodo: "link" });
      assert.equal(r.status, 303);
      assert.equal(recebidos.at(-1).ops.variables.signers[0].name, "Maria Teste da Silva");
      assert.match(await painel(), /value="https:\/\/assina\.ae\/teste3"/);
    });
    await caso("sem CSRF não envia (403)", async () => {
      const fd = new FormData(); fd.append("documento", "procuracao-previdenciaria.html"); fd.append("metodo", "link");
      const r = await fetch(`${BASE}/admin/leads/${id}/assinatura`, { method: "POST", headers: { Authorization: AUTH }, body: fd });
      assert.equal(r.status, 403);
    });
    const assinar = (corpo, seg = SEGREDO_WH) => { const b = JSON.stringify(corpo); return fetch(BASE + "/api/autentique/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Autentique-Signature": crypto.createHmac("sha256", seg).update(b).digest("hex") }, body: b }); };
    await caso("webhook com assinatura HMAC inválida → 401", async () => {
      assert.equal((await assinar({ event: { id: "e0", type: "signature.accepted", data: { document: "doc-0001-aaaa-bbbb-cccc" } } }, "errado")).status, 401);
    });
    await caso("webhook 'signature.viewed' e 'signature.accepted' atualizam o estado; lead vira Convertido", async () => {
      assert.equal((await assinar({ event: { id: "e1", type: "signature.viewed", data: { document: { id: "doc-0001-aaaa-bbbb-cccc" } } } })).status, 200);
      assert.equal((await assinar({ event: { id: "e2", type: "signature.accepted", data: { document: { id: "doc-0001-aaaa-bbbb-cccc" } } } })).status, 200);
      const t = await painel(); assert.match(t, /class="selo">Assinado/); assert.match(t, /value="convertido" selected/);
    });
    await caso("evento atrasado não faz voltar o estado; evento repetido é ignorado", async () => {
      await assinar({ event: { id: "e3", type: "signature.viewed", data: { document: { id: "doc-0001-aaaa-bbbb-cccc" } } } });
      const r = await (await assinar({ event: { id: "e3", type: "signature.viewed", data: { document: { id: "doc-0001-aaaa-bbbb-cccc" } } } })).json();
      assert.equal(r.duplicado, true);
      assert.equal(((await painel()).match(/class="selo">Assinado/g) || []).length, 1);
    });
    await caso("'Atualizar situação' consulta o Autentique e mostra o PDF assinado", async () => {
      const t = await painel();
      const aid = t.match(/\/admin\/assinaturas\/([0-9a-f-]{36})\/atualizar/)[1];
      const r = await fetch(`${BASE}/admin/assinaturas/${aid}/atualizar`, { method: "POST", redirect: "manual", headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: "csrf=" + csrf });
      assert.equal(r.status, 303);
      assert.match(JSON.stringify(recebidos.at(-1).json), /document\(id: \$id\)/);
      assert.match(await painel(), /autentique\.test\/assinado\.pdf/);
    });
    await caso("site não expõe a chave do Autentique", async () => {
      for (const u of ["/", "/assets/js/app.js", "/assets/js/config.js", "/assets/js/chat.js"]) assert.doesNotMatch(await (await fetch(BASE + u)).text(), /token-teste/);
    });

    await caso("exclui lead (LGPD)", async () => {
      const r = await fetch(`${BASE}/admin/leads/${id}/excluir`, { method: "POST", redirect: "manual", headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: `csrf=${csrf}&confirmar=sim` });
      assert.equal(r.status, 303);
    });

    console.log("Site, SEO e segurança");
    await caso("página inicial com CSP e canonical absoluto", async () => { const r = await fetch(BASE + "/"); assert.equal(r.status, 200); assert.ok(r.headers.get("content-security-policy")); const t = await r.text(); assert.match(t, /rel="canonical" href="https:\/\/www\.exemplo\.com\.br\/"/); assert.match(t, /og:image" content="https:\/\/www\.exemplo\.com\.br\/assets/); });
    await caso("sitemap.xml e robots.txt", async () => { assert.match(await (await fetch(BASE + "/sitemap.xml")).text(), /exemplo\.com\.br\/politica-de-privacidade/); assert.match(await (await fetch(BASE + "/robots.txt")).text(), /Disallow: \/admin/); });
    await caso("bloqueia path traversal", async () => { const r = await fetch(BASE + "/..%2fserver.js"); assert.equal(r.status, 404); });
    await caso("404 personalizado", async () => { const r = await fetch(BASE + "/nao-existe"); assert.equal(r.status, 404); assert.match(await r.text(), /não encontrada/); });
    console.log(`\n${ok} testes passaram.`);
  } catch (e) {
    console.error("\n✗ Falhou:", e.message); process.exitCode = 1;
  } finally {
    srv.kill(); falso.close(); fs.rmSync(DADOS, { recursive: true, force: true });
  }
})();
