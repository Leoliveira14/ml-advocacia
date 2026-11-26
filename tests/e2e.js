/* Teste ponta a ponta do funil no navegador (opcional: requer Playwright).
   Uso: npx playwright install chromium && node tests/e2e.js
   Variáveis: CHROME_PATH (executável do Chrome), SHOTS (pasta para capturas de tela). */
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(process.env.PLAYWRIGHT_PATH || "playwright"); }

const PORTA = 4100 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORTA}`;
const DADOS = fs.mkdtempSync(path.join(os.tmpdir(), "wl-e2e-"));
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "wl-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const SENHA = "senha-de-teste-123";
const AUTH = "Basic " + Buffer.from("admin:" + SENHA).toString("base64");
const NUM = "5511900000000";
let ok = 0;
async function caso(nome, fn) { await fn(); ok++; console.log("  ✓ " + nome); }
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function novaPagina(navegador, { largura = 1440, altura = 900, comWhats = false } = {}) {
  const ctx = await navegador.newContext({ viewport: { width: largura, height: altura }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const erros = [];
  page.on("pageerror", (e) => erros.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|fonts\.g|google/.test(m.text())) erros.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com|google\.com\/maps/, (r) => r.abort());
  await page.route("**/assets/js/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: comWhats
    ? `window.WL_CONFIG={whatsapp:"${NUM}",email:"contato@exemplo.com.br",instagram:"https://www.instagram.com/exemplo",politicaVersao:"2026-11"};`
    : `window.WL_CONFIG={whatsapp:"",email:"",instagram:"",politicaVersao:"2026-11"};` }));
  await page.goto(BASE + "/?utm_source=teste&utm_campaign=e2e", { waitUntil: "load" });
  await page.waitForSelector("#carregador", { state: "detached", timeout: 8000 });
  return { page, ctx, erros };
}
const opcao = (page, nome, valor) => page.locator(`input[name="${nome}"][value="${valor}"]`).check({ force: true });

(async () => {
  const srv = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORTA), HOST: "127.0.0.1", DATA_DIR: DADOS, ADMIN_PASSWORD: SENHA, IP_SALT: "e2e", NODE_ENV: "test", RATE_LIMIT_MAX: "50" }, stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + "/healthz"); break; } catch { await espera(100); } }
  const navegador = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
  try {
    console.log("Funil — pedido negado, com WhatsApp configurado");
    const { page, erros } = await novaPagina(navegador, { comWhats: true });
    await page.screenshot({ path: path.join(SHOTS, "01-desktop-hero.png") });
    await page.screenshot({ path: path.join(SHOTS, "00-desktop-pagina-inteira.png"), fullPage: true });

    // ajudantes da conversa
    const chip = async (p, valor) => { const b = p.locator(`#chat-entrada .chip[data-valor="${valor}"]`); await b.waitFor({ timeout: 8000 }); await b.click(); };
    const campo = (p) => p.locator("#chat-entrada input:not([type=checkbox]), #chat-entrada textarea, #chat-entrada select").first();
    const escrever = async (p, v) => { const c = campo(p); await c.waitFor({ timeout: 8000 }); await c.fill(v); await p.locator("#chat-entrada [type=submit]").first().click(); };
    const ultimaBot = (p) => p.locator(".msg-bot:not(.digitando)").last().textContent();
    const temMsg = (p, t) => p.locator(".msg-bot", { hasText: t }).count();

    await caso("a conversa começa quando aparece no ecrã, com saudação e 7 opções", async () => {
      await page.locator("#funil").scrollIntoViewIfNeeded();
      await page.locator("#chat-entrada .chip").first().waitFor({ timeout: 8000 });
      assert.ok(await temMsg(page, "assistente virtual da M&L") > 0);
      assert.equal(await page.locator("#chat-entrada .chip").count(), 7);
    });
    await caso("'pedido negado' leva à pergunta da data de nascimento", async () => {
      await chip(page, "negado");
      await campo(page).waitFor();
      assert.equal(await campo(page).getAttribute("type"), "date");
      assert.match(await ultimaBot(page), /adoção ou guarda/);
    });
    await caso("recusa data de nascimento no futuro", async () => {
      await escrever(page, "2099-01-01");
      assert.match(await page.locator(".chat-erro").textContent(), /futuro/);
    });
    await caso("data válida avança e não pergunta 'já solicitou' (pedido negado)", async () => {
      await escrever(page, "2026-09-10");
      await chip(page, "sim");                         // já contribuiu
      assert.equal(await temMsg(page, "Você já solicitou"), 0);
      await chip(page, "autonoma");                    // vínculo
      await page.screenshot({ path: path.join(SHOTS, "02-chat-meio.png") });
    });
    await caso("pergunta sobre comunicação do INSS aparece no caso de pedido negado", async () => {
      await chip(page, "sim");                         // meu INSS
      await page.locator(".msg-bot", { hasText: "comunicação do INSS" }).waitFor();
      await chip(page, "sim");                         // comunicação
      await chip(page, "alguns");                      // documentos
      await page.locator(".msg-bot", { hasText: "Deseja orientação" }).waitFor();
    });
    await caso("editar uma resposta volta a esse ponto e refaz as seguintes", async () => {
      await page.locator('.msg-eu[data-q="documentos"] .msg-editar').click();
      assert.equal(await temMsg(page, "Deseja orientação"), 0);
      assert.ok(await page.locator('#chat-entrada .chip.anterior[data-valor="alguns"]').count() === 1);
      await chip(page, "sim");
      await chip(page, "sim");                         // deseja orientação
    });
    await caso("valida o nome completo", async () => {
      await escrever(page, "Ana");
      assert.match(await page.locator(".chat-erro").textContent(), /nome completo/);
      await escrever(page, "Ana Paula Souza");
      await page.locator(".msg-bot", { hasText: "Prazer, Ana" }).waitFor();
    });
    await caso("máscara do WhatsApp", async () => {
      const c = campo(page); await c.waitFor();
      await c.pressSequentially("11987654321");
      assert.equal(await c.inputValue(), "(11) 98765-4321");
      await page.locator("#chat-entrada [type=submit]").click();
    });
    await caso("e-mail é opcional (Pular)", async () => {
      await page.locator("#chat-entrada .chip-pular").click();
      await escrever(page, "São Paulo");
      await page.locator("#chat-entrada select").waitFor();
      assert.equal(await page.locator("#chat-entrada select").inputValue(), "SP");
      await page.locator("#chat-entrada [type=submit]").click();
    });
    await caso("exige consentimento LGPD", async () => {
      await page.locator("#chat-consentimento").waitFor();
      await page.locator("#chat-entrada [type=submit]").click();
      assert.match(await page.locator(".chat-erro").textContent(), /autorizar/);
    });
    await caso("envia, grava e conclui com WhatsApp pré-preenchido", async () => {
      await espera(4200);
      await page.locator("#chat-consentimento").check();
      await page.locator("#chat-entrada [type=submit]").click();
      await page.locator("#btn-whats-final").waitFor({ timeout: 8000 });
      const href = await page.locator("#btn-whats-final").getAttribute("href");
      assert.match(href, new RegExp("^https://wa\\.me/" + NUM));
      const msg = decodeURIComponent(href.split("text=")[1]);
      assert.match(msg, /Ana Paula Souza/); assert.match(msg, /pedido negado/); assert.match(msg, /São Paulo\/SP/);
      assert.doesNotMatch(msg, /2026-09-10|10\/09/);
      assert.ok(await temMsg(page, "Obrigada por compartilhar") > 0);
      await page.locator("#funil").screenshot({ path: path.join(SHOTS, "04-chat-fim.png") });
    });
    await caso("lead gravado com respostas corretas e origem (UTM)", async () => {
      const t = await (await fetch(BASE + "/admin", { headers: { Authorization: AUTH } })).text();
      assert.match(t, /Ana Paula Souza/); assert.match(t, /teste \/ e2e/); assert.match(t, /Pedido negado pelo INSS/);
      assert.match(t, /Documentos:<\/b> Tem/); assert.match(t, /10\/09\/2026/);
    });
    await caso("botões de serviço abrem WhatsApp identificando o serviço", async () => {
      await page.evaluate(() => { window.__abertos = []; window.open = (u) => { window.__abertos.push(u); return null; }; });
      await page.locator('[data-servico="BPC/LOAS"]').click();
      const url = (await page.evaluate(() => window.__abertos))[0];
      assert.match(url, new RegExp("^https://wa\\.me/" + NUM));
      assert.match(decodeURIComponent(url), /BPC\/LOAS/);
    });
    await caso("rodapé mostra os contatos configurados", async () => {
      assert.match(await page.locator("#rodape-contatos").textContent(), /contato@exemplo\.com\.br/);
    });
    await caso("sem erros de JavaScript", async () => { assert.deepEqual(erros, []); });

    console.log("Conversa — lógica condicional e sem WhatsApp configurado");
    const p2 = await novaPagina(navegador);
    const pg = p2.page;
    await caso("'já solicitou: sim' pergunta o estado do pedido; ao editar para 'não', deixa de perguntar", async () => {
      await pg.locator("#funil").scrollIntoViewIfNeeded();
      await chip(pg, "bebe_recente");
      await escrever(pg, "2026-10-01");
      await chip(pg, "sim");
      await pg.locator(".msg-bot", { hasText: "aprovado, negado" }).waitFor();
      await pg.locator('.msg-eu[data-q="ja_solicitou"] .msg-editar').click();
      await chip(pg, "nao");
      await pg.locator(".msg-bot", { hasText: "contribuiu para o INSS" }).waitFor();
      assert.equal(await temMsg(pg, "aprovado, negado"), 0);
    });
    await caso("'grávida' pergunta a previsão do parto", async () => {
      await pg.locator(".chat-reiniciar").click();
      await chip(pg, "gravida");
      await pg.locator(".msg-bot", { hasText: "previsão do parto" }).or(pg.locator(".msg-bot", { hasText: "prevista para o parto" })).first().waitFor();
      assert.equal(await campo(pg).getAttribute("type"), "date");
    });
    await caso("sem número configurado, serviços abrem a conversa com o interesse", async () => {
      await pg.reload({ waitUntil: "load" });
      await pg.waitForSelector("#carregador", { state: "detached", timeout: 8000 });
      await pg.locator('[data-servico="Pensão por morte"]').click();
      await campo(pg).waitFor({ timeout: 8000 });
      assert.match(await campo(pg).inputValue(), /Pensão por morte/);
      assert.ok(await temMsg(pg, "interesse em: Pensão por morte") > 0);
    });
    await caso("sem número configurado, a conclusão não mostra botão de WhatsApp", async () => {
      await pg.locator("#chat-entrada [type=submit]").click();
      await chip(pg, "nao_sei"); await chip(pg, "nao"); await chip(pg, "entender");
      await escrever(pg, "Joana Teste Lima"); await escrever(pg, "11912345678");
      await pg.locator("#chat-entrada .chip-pular").click();
      await escrever(pg, "Guarulhos");
      await pg.locator("#chat-entrada select").waitFor(); await pg.locator("#chat-entrada [type=submit]").click();
      await espera(4200);
      await pg.locator("#chat-consentimento").check(); await pg.locator("#chat-entrada [type=submit]").click();
      await pg.locator(".msg-bot", { hasText: "Obrigada por compartilhar" }).waitFor({ timeout: 8000 });
      assert.equal(await pg.locator("#btn-whats-final").count(), 0);
      const t = await (await fetch(BASE + "/admin", { headers: { Authorization: AUTH } })).text();
      assert.match(t, /Joana Teste Lima/); assert.match(t, /Pensão por morte/);
    });
    await caso("sem erros de JavaScript", async () => { assert.deepEqual(p2.erros, []); });

    console.log("Telemóvel (390 × 844)");
    const m = await novaPagina(navegador, { largura: 390, altura: 844 });
    await m.page.screenshot({ path: path.join(SHOTS, "05-mobile-hero.png") });
    await caso("menu abre e fecha", async () => {
      await m.page.locator(".abrir-menu").click();
      await m.page.waitForFunction(() => getComputedStyle(document.querySelector("#menu")).visibility === "visible");
      assert.ok(await m.page.locator("#menu").isVisible());
      await m.page.screenshot({ path: path.join(SHOTS, "06-mobile-menu.png") });
      await m.page.locator('#menu a[href="#duvidas"]').click();
      await espera(400);
      assert.equal(await m.page.locator(".abrir-menu").getAttribute("aria-expanded"), "false");
    });
    await caso("sem rolagem horizontal", async () => {
      const larg = await m.page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(larg <= 390, "scrollWidth=" + larg);
    });
    await caso("FAQ abre em acordeão", async () => {
      const d = m.page.locator("details.faq").first();
      await d.locator("summary").click();
      assert.equal(await d.getAttribute("open"), "");
    });
    await m.page.locator("#contato").scrollIntoViewIfNeeded();
    await m.page.locator("#chat-entrada .chip").first().waitFor({ timeout: 8000 });
    await m.page.locator('#chat-entrada .chip[data-valor="gravida"]').click();
    await m.page.locator("#chat-entrada input").waitFor();
    await m.page.locator("#funil").screenshot({ path: path.join(SHOTS, "07-mobile-funil.png") });
    await m.page.screenshot({ path: path.join(SHOTS, "08-mobile-pagina-inteira.png"), fullPage: true });
    await caso("alvos de toque com pelo menos 44 px", async () => {
      const pequenos = await m.page.evaluate(() => Array.from(document.querySelectorAll(".btn, .chip, .chat-btn-enviar, .abrir-menu")).filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).length);
      assert.equal(pequenos, 0);
    });
    await caso("sem erros de JavaScript", async () => { assert.deepEqual(m.erros, []); });

    console.log("Movimento (animações ativas)");
    const ctxM = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
    const pm = await ctxM.newPage(); const errosM = [];
    pm.on("pageerror", (e) => errosM.push(e.message));
    await pm.route(/fonts\.(googleapis|gstatic)\.com|google\.com\/maps/, (r) => r.abort());
    await pm.goto(BASE + "/", { waitUntil: "load" });
    await caso("carregamento com o logotipo aparece e sai sozinho", async () => {
      assert.equal(await pm.locator("#carregador .car-logo").count(), 1);
      assert.ok(await pm.evaluate(() => document.documentElement.classList.contains("carregando")));
      await pm.waitForSelector("#carregador", { state: "detached", timeout: 8000 });
      assert.ok(!(await pm.evaluate(() => document.documentElement.classList.contains("carregando"))));
      assert.equal(await pm.locator(".tunel [data-rv].is-in").count() > 0, true);
    });
    await caso("título principal dividido em palavras e botões com texto que rola", async () => {
      assert.ok(await pm.locator("[data-rv=palavras] .pal").count() > 5);
      assert.ok(await pm.locator(".btn .rolo").count() >= 5);
      assert.equal(await pm.locator(".btn .rolo-b[aria-hidden=true]").count(), await pm.locator(".btn .rolo").count());
    });
    await caso("rolagem suave com a roda do rato", async () => {
      await pm.mouse.move(700, 500); await pm.mouse.wheel(0, 600); await espera(60);
      const meio = await pm.evaluate(() => scrollY); await espera(1300);
      const fim = await pm.evaluate(() => scrollY);
      assert.ok(meio < fim && fim > 500, `meio=${meio} fim=${fim}`);
    });
    await caso("cabeçalho esconde ao descer e volta ao subir; barra de progresso", async () => {
      assert.ok(await pm.evaluate(() => document.querySelector("#topo").classList.contains("escondido")));
      assert.ok(Number(await pm.evaluate(() => getComputedStyle(document.querySelector(".barra-leitura")).getPropertyValue("--p"))) > 0);
      await pm.mouse.wheel(0, -200); await espera(900);
      assert.ok(!(await pm.evaluate(() => document.querySelector("#topo").classList.contains("escondido"))));
    });
    await caso("link do menu rola até a secção e marca-a como ativa", async () => {
      await pm.click('#menu a[href="#servicos"]'); await espera(1800);
      const top = await pm.evaluate(() => document.querySelector("#servicos").getBoundingClientRect().top);
      assert.ok(Math.abs(top - 96) < 12, "top=" + top);
      assert.equal(await pm.getAttribute("#menu a[aria-current]", "href"), "#servicos");
    });
    await caso("todo o conteúdo fica visível depois de rolar a página", async () => {
      const H = await pm.evaluate(() => document.body.scrollHeight);
      for (let y = 0; y < H; y += 400) { await pm.evaluate((v) => scrollTo(0, v), y); await espera(70); }
      await espera(1500);
      assert.equal(await pm.locator("[data-rv]:not(.is-in)").count(), 0);
    });
    await caso("túnel: a câmara avança e a fotografia final abre ao rolar", async () => {
      await pm.evaluate(() => scrollTo(0, 0)); await espera(300);
      const z0 = await pm.evaluate(() => document.querySelector(".tunel-foto").style.transform);
      const fim = await pm.evaluate(() => { const t = document.querySelector(".tunel"); return t.offsetTop + t.offsetHeight - innerHeight; });
      await pm.evaluate((v) => scrollTo(0, v), fim); await espera(300);
      const z1 = await pm.evaluate(() => document.querySelector(".tunel-foto").style.transform);
      assert.notEqual(z0, z1);
      assert.match(await pm.evaluate(() => document.querySelector(".tunel-final").style.clipPath), /^inset\(0%/);
    });
    await caso("galeria horizontal desliza com o scroll vertical", async () => {
      const meio = await pm.evaluate(() => { const t = document.querySelector(".processo"); let y = 0, x = t; while (x) { y += x.offsetTop; x = x.offsetParent; } return y + (t.offsetHeight - innerHeight) / 2; });
      await pm.evaluate((v) => scrollTo(0, v), meio); await espera(300);
      const tx = await pm.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".processo-trilho")).transform).m41);
      assert.ok(tx < -100, "tx=" + tx);
    });
    await caso("lista de serviços mostra fotografia que segue o cursor", async () => {
      const linha = pm.locator(".servico-linha").nth(1);
      await linha.scrollIntoViewIfNeeded(); await espera(400);
      const r = await linha.boundingBox(); await pm.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await espera(500);
      assert.ok(await pm.evaluate(() => document.querySelector(".seguidor").classList.contains("visivel")));
    });
    await caso("títulos acendem palavra a palavra", async () => {
      await pm.locator("#titulo-dif").scrollIntoViewIfNeeded(); await espera(400);
      assert.ok(await pm.locator("#titulo-dif .ac.on").count() > 0);
      assert.match(await pm.getAttribute("#titulo-dif", "aria-label"), /Atendimento jurídico/);
    });
    await caso("sem erros de JavaScript com animações", async () => { assert.deepEqual(errosM, []); });

    console.log(`\n${ok} verificações passaram. Capturas em ${SHOTS}`);
  } catch (e) {
    console.error("\n✗ Falhou:", e.message); process.exitCode = 1;
  } finally {
    await navegador.close(); srv.kill(); fs.rmSync(DADOS, { recursive: true, force: true });
  }
})();
