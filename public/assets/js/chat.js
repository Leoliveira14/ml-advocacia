/* M&L Advocacia — funil de captação em formato de conversa (chatbot), sem dependências.
 *
 * O assistente faz uma pergunta de cada vez, com indicação de "digitando…", e só mostra
 * as perguntas que fazem sentido para a situação da pessoa (lógica condicional).
 * Cada resposta pode ser editada: a conversa volta a esse ponto e as perguntas seguintes
 * são refeitas. No fim, as respostas vão para POST /api/leads (mesmo formato do servidor).
 *
 * API pública: window.WLChat.iniciar({ interesse, descricao })
 */
(function () {
  "use strict";
  var raiz = document.getElementById("funil");
  if (!raiz) return;

  var CFG = window.WL_CONFIG || {};
  var NUM_WHATS = String(CFG.whatsapp || "").replace(/\D/g, "");
  var TEM_WHATS = NUM_WHATS.length >= 12;
  var reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function $(s, c) { return (c || document).querySelector(s); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function espera(ms) { return new Promise(function (r) { setTimeout(r, reduzir ? 0 : ms); }); }

  var log = $("#chat-log", raiz), entrada = $("#chat-entrada", raiz), barra = $(".chat-progresso span", raiz);
  var isca = $("#campo-site", raiz), btnReiniciar = $(".chat-reiniciar", raiz);

  /* ------------------------------------------------------------------ Roteiro */
  var SN = [["sim", "Sim"], ["nao", "Não"], ["nao_sei", "Não sei informar"]];
  var UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
  function hoje0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function data(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; var d = new Date(s + "T00:00:00"); return isNaN(d) ? null : d; }
  var DIA = 864e5;
  function primeiroNome() { return (R.nome || "").split(/\s+/)[0] || ""; }

  var ROTEIRO = [
    { id: "situacao", tipo: "opcoes", grupo: 1,
      bot: ["Olá! Sou o assistente virtual da M&L Advocacia.", "Vou fazer algumas perguntas rápidas para entender o seu caso. Leva cerca de 2 minutos.", "Para começar: qual situação melhor representa o que você procura?"],
      opcoes: [["gravida", "Estou grávida"], ["bebe_recente", "Tive um bebê recentemente"], ["bebe_meses", "O meu bebê já tem alguns meses"], ["nunca_solicitou", "Sou mãe e nunca solicitei o salário-maternidade"], ["negado", "Tive o meu pedido negado pelo INSS"], ["saber_direito", "Quero saber se tenho direito ao benefício"], ["outra", "Outra situação"]] },
    { id: "previsao_parto", tipo: "data", grupo: 2, se: function () { return R.situacao === "gravida"; },
      bot: ["Que fase especial! Qual é a data prevista para o parto?"], rotulo: "Data prevista do parto",
      validar: function (v) { var d = data(v); if (!d) return "Informe uma data válida."; if (d < new Date(+hoje0() - 30 * DIA)) return "Essa data já passou. Se o bebê já nasceu, toque em Editar na sua primeira resposta."; if (d > new Date(+hoje0() + 300 * DIA)) return "Confira a data: ela parece muito distante."; return ""; } },
    { id: "nascimento_bebe", tipo: "data", grupo: 2, se: function () { return ["bebe_recente", "bebe_meses", "nunca_solicitou", "negado"].indexOf(R.situacao) > -1; },
      bot: ["Qual foi a data de nascimento do bebê?", "Se for adoção ou guarda, informe a data da adoção ou da guarda."], rotulo: "Data de nascimento, adoção ou guarda",
      validar: function (v) { var d = data(v); if (!d) return "Informe uma data válida."; if (d > hoje0()) return "A data não pode estar no futuro."; if (d < new Date(+hoje0() - 20 * 365 * DIA)) return "Confira a data informada."; return ""; } },
    { id: "momento", tipo: "opcoes", grupo: 2, se: function () { return R.situacao === "saber_direito"; },
      bot: ["Certo. Em que momento você está?"], opcoes: [["gestante", "Estou grávida"], ["ja_nasceu", "O bebê já nasceu"], ["adocao", "Adoção ou guarda"], ["nao_sei", "Não sei informar"]] },
    { id: "ja_solicitou", tipo: "opcoes", grupo: 2, se: function () { return ["bebe_recente", "bebe_meses", "saber_direito"].indexOf(R.situacao) > -1; },
      bot: ["Você já solicitou o salário-maternidade?"], opcoes: SN },
    { id: "status_pedido", tipo: "opcoes", grupo: 2, se: function () { return R.ja_solicitou === "sim"; },
      bot: ["E o pedido foi aprovado, negado ou ainda está em análise?"], opcoes: [["aprovado", "Aprovado"], ["negado", "Negado"], ["em_analise", "Em análise"], ["nao_sei", "Não sei informar"]] },
    { id: "descricao", tipo: "texto-longo", grupo: 2, se: function () { return R.situacao === "outra"; },
      bot: ["Conte em poucas palavras a sua situação.", "Por favor, não inclua dados de saúde nem números de documentos."], rotulo: "A sua situação", max: 600,
      validar: function (v) { return v.length < 10 ? "Conte-nos um pouco mais (pelo menos 10 caracteres)." : ""; } },
    { id: "contribuiu", tipo: "opcoes", grupo: 2, se: function () { return R.situacao !== "outra"; },
      bot: ["Você já contribuiu para o INSS em algum momento?", "Vale trabalho com carteira assinada, MEI, carnê de autônoma ou contribuição facultativa."], opcoes: SN },
    { id: "vinculo", tipo: "opcoes", grupo: 2, se: function () { return R.situacao !== "outra"; },
      bot: ["E qual é a sua situação de trabalho atual?"],
      opcoes: [["clt", "Carteira assinada"], ["domestica", "Empregada doméstica"], ["autonoma", "Autônoma"], ["mei", "MEI"], ["desempregada", "Desempregada"], ["rural", "Trabalhadora rural"], ["facultativa", "Contribuo como facultativa"], ["outra", "Outra situação"], ["nao_sei", "Não sei informar"]] },
    { id: "meu_inss", tipo: "opcoes", grupo: 3, bot: ["Você já tem cadastro no Meu INSS?"], opcoes: SN },
    { id: "comunicacao_inss", tipo: "opcoes", grupo: 3, se: function () { return R.situacao === "negado" || R.ja_solicitou === "sim"; },
      bot: ["Recebeu alguma comunicação do INSS sobre o pedido?", "Por exemplo, uma carta, uma exigência de documentos ou uma decisão no Meu INSS."], opcoes: SN },
    { id: "documentos", tipo: "opcoes", grupo: 3, bot: ["Você tem documentos relacionados ao seu caso?"],
      opcoes: [["sim", "Sim, tenho"], ["alguns", "Tenho alguns"], ["nao", "Ainda não"], ["nao_sei", "Não sei informar"]] },
    { id: "deseja_orientacao", tipo: "opcoes", grupo: 3, bot: ["Deseja orientação para verificar a possibilidade de requerer o benefício?"],
      opcoes: [["sim", "Sim, quero orientação"], ["entender", "Quero entender melhor primeiro"], ["nao_sei", "Não sei informar"]] },
    { id: "nome", tipo: "texto", grupo: 4, rotulo: "Nome completo", auto: "name", max: 120,
      bot: ["Obrigado pelas respostas! Agora preciso dos seus contatos para a nossa equipe falar com você.", "Qual é o seu nome completo?"],
      validar: function (v) { return (v.length < 5 || v.split(/\s+/).length < 2) ? "Informe o seu nome completo (nome e sobrenome)." : ""; } },
    { id: "whatsapp", tipo: "tel", grupo: 4, rotulo: "WhatsApp com DDD", auto: "tel-national",
      bot: function () { return ["Prazer, " + primeiroNome() + "! Qual é o seu WhatsApp com DDD?"]; },
      validar: function (v) { var d = v.replace(/\D/g, ""); return (d.length < 10 || d.length > 11 || /^0/.test(d)) ? "Informe um WhatsApp válido com DDD, por exemplo (11) 91234-5678." : ""; } },
    { id: "email", tipo: "email", grupo: 4, opcional: true, rotulo: "E-mail (opcional)", auto: "email", max: 160,
      bot: ["Quer deixar também um e-mail? É opcional."],
      validar: function (v) { return v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "Confira o e-mail ou toque em Pular." : ""; } },
    { id: "cidade", tipo: "texto", grupo: 4, rotulo: "Cidade", auto: "address-level2", max: 80, bot: ["Em que cidade você mora?"],
      validar: function (v) { return v.length < 2 ? "Informe a sua cidade." : ""; } },
    { id: "uf", tipo: "uf", grupo: 4, rotulo: "Estado", bot: ["E o estado?"] },
    { id: "consentimento", tipo: "consentimento", grupo: 4,
      bot: ["Último passo: preciso da sua autorização para tratar os dados que você compartilhou, incluindo as informações sobre gestação e maternidade, para analisar o seu caso e entrar em contato com você."] }
  ];
  var POR_ID = {}; ROTEIRO.forEach(function (q) { POR_ID[q.id] = q; });

  /* ------------------------------------------------------------------ Estado */
  var geracao = 0, R = {}, ROT = {}, historico = [], atual = null, iniciado = false, enviando = false, inicio = 0, interesse = "", ocupado = false;
  function ativa(q) { return !q.se || q.se(); }
  function proxima() {
    for (var i = 0; i < ROTEIRO.length; i++) { var q = ROTEIRO[i]; if (ativa(q) && !(q.id in R)) return q; }
    return null;
  }
  function progresso() {
    var total = ROTEIRO.filter(ativa).length, feitas = ROTEIRO.filter(function (q) { return ativa(q) && q.id in R; }).length;
    barra.style.transform = "scaleX(" + (total ? feitas / total : 0).toFixed(3) + ")";
    raiz.setAttribute("data-grupo", atual ? atual.grupo : 4);
  }

  /* ------------------------------------------------------------------ Mensagens */
  function rolarFim() {
    var alvo = log.scrollHeight;
    if (reduzir || !log.scrollTo) log.scrollTop = alvo; else log.scrollTo({ top: alvo, behavior: "smooth" });
  }
  function bolhaBot(texto, q, extraCls) {
    var m = el("div", "msg msg-bot" + (extraCls ? " " + extraCls : ""));
    m.setAttribute("data-q", q || "");
    m.appendChild(el("p", null, texto));
    log.appendChild(m); rolarFim();
    return m;
  }
  function digitando() {
    var t = el("div", "msg msg-bot digitando"); t.setAttribute("aria-hidden", "true");
    t.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(t); rolarFim();
    return t;
  }
  async function falar(linhas, q) {
    var g = geracao;
    for (var i = 0; i < linhas.length; i++) {
      var t = digitando();
      await espera(Math.min(1300, 420 + linhas[i].length * 11));
      t.remove();
      if (g !== geracao) return;          // a conversa foi recomeçada entretanto
      bolhaBot(linhas[i], q);
      await espera(160);
    }
  }
  function bolhaUsuario(q, texto) {
    var m = el("div", "msg msg-eu"); m.setAttribute("data-q", q.id);
    m.appendChild(el("p", null, texto));
    if (q.id !== "consentimento") {
      var b = el("button", "msg-editar", "Editar"); b.type = "button";
      b.setAttribute("aria-label", "Editar a resposta: " + texto);
      b.addEventListener("click", function () { editar(q.id); });
      m.appendChild(b);
    }
    log.appendChild(m); rolarFim();
  }

  /* ------------------------------------------------------------------ Área de resposta */
  function limparEntrada() { entrada.innerHTML = ""; entrada.onsubmit = null; }
  function erroEntrada(msg) {
    var e = $(".chat-erro", entrada);
    if (e) e.textContent = msg || "";
    var c = $("input, textarea, select", entrada);
    if (c) { if (msg) c.setAttribute("aria-invalid", "true"); else c.removeAttribute("aria-invalid"); }
  }
  function focarSePerto(alvo) {
    if (!alvo) return;
    var r = raiz.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) alvo.focus({ preventScroll: true });
  }
  function mascaraTel(inp) {
    inp.addEventListener("input", function () {
      var d = inp.value.replace(/\D/g, "").slice(0, 11), f = d;
      if (d.length > 2) f = "(" + d.slice(0, 2) + ") " + d.slice(2);
      if (d.length > 6) f = "(" + d.slice(0, 2) + ") " + d.slice(2, d.length === 11 ? 7 : 6) + "-" + d.slice(d.length === 11 ? 7 : 6);
      inp.value = f;
    });
  }

  function mostrarEntrada(q, anterior) {
    limparEntrada();
    entrada.setAttribute("data-tipo", q.tipo);
    if (q.tipo === "opcoes") {
      var grupo = el("div", "chips"); grupo.setAttribute("role", "group");
      grupo.setAttribute("aria-label", "Respostas");
      q.opcoes.forEach(function (o) {
        var b = el("button", "chip" + (anterior === o[0] ? " anterior" : ""), o[1]); b.type = "button";
        b.setAttribute("data-valor", o[0]);
        b.addEventListener("click", function () { responder(q, o[0], o[1]); });
        grupo.appendChild(b);
      });
      entrada.appendChild(grupo);
      focarSePerto(grupo.querySelector(".anterior") || grupo.firstChild);
      return;
    }
    if (q.tipo === "consentimento") {
      var lab = el("label", "chat-consentimento");
      var cb = el("input"); cb.type = "checkbox"; cb.id = "chat-consentimento";
      var sp = el("span");
      sp.innerHTML = 'Autorizo o tratamento dos meus dados nos termos da <a href="politica-de-privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a> e da LGPD.';
      lab.appendChild(cb); lab.appendChild(sp);
      var linha = el("div", "chat-linha");
      var env = el("button", "btn btn-azul chat-enviar", "Enviar respostas"); env.type = "submit";
      linha.appendChild(lab); linha.appendChild(env);
      entrada.appendChild(linha); entrada.appendChild(el("p", "chat-erro"));
      $(".chat-erro", entrada).setAttribute("role", "alert");
      entrada.onsubmit = function (e) {
        e.preventDefault();
        if (!cb.checked) return erroEntrada("Para enviar, é preciso autorizar o tratamento dos dados.");
        responder(q, "sim", "Autorizo o tratamento dos meus dados.");
      };
      focarSePerto(cb);
      return;
    }
    // campos de texto, data, telefone, e-mail e estado
    var id = "chat-campo-" + q.id;
    var rot = el("label", "sr-only", q.rotulo || "Sua resposta"); rot.setAttribute("for", id);
    var campo;
    if (q.tipo === "uf") {
      campo = el("select");
      UFS.forEach(function (u) { var o = el("option", null, u); o.value = u; if (u === (anterior || "SP")) o.selected = true; campo.appendChild(o); });
    } else if (q.tipo === "texto-longo") {
      campo = el("textarea"); campo.rows = 2; campo.maxLength = q.max || 600;
      campo.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); entrada.requestSubmit ? entrada.requestSubmit() : entrada.onsubmit(e); } });
    } else {
      campo = el("input");
      campo.type = q.tipo === "data" ? "date" : q.tipo === "tel" ? "tel" : q.tipo === "email" ? "email" : "text";
      if (q.tipo === "tel") { campo.inputMode = "numeric"; campo.placeholder = "(11) 91234-5678"; campo.maxLength = 15; mascaraTel(campo); }
      if (q.max) campo.maxLength = q.max;
      if (q.tipo === "texto") campo.placeholder = "Digite aqui";
      if (q.tipo === "email") campo.placeholder = "seu@email.com";
    }
    campo.id = id; campo.name = q.id;
    if (q.auto) campo.autocomplete = q.auto;
    if (anterior != null) campo.value = anterior;
    var linhaC = el("div", "chat-linha");
    linhaC.appendChild(rot); linhaC.appendChild(campo);
    var enviar = el("button", "chat-btn-enviar"); enviar.type = "submit"; enviar.setAttribute("aria-label", "Enviar resposta");
    enviar.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    linhaC.appendChild(enviar);
    entrada.appendChild(linhaC);
    if (q.opcional) {
      var pular = el("button", "chip chip-pular", "Pular"); pular.type = "button";
      pular.addEventListener("click", function () { responder(q, "", "Prefiro não informar"); });
      entrada.appendChild(pular);
    }
    var erro = el("p", "chat-erro"); erro.setAttribute("role", "alert"); entrada.appendChild(erro);
    campo.addEventListener("input", function () { if (campo.getAttribute("aria-invalid")) erroEntrada(""); });
    entrada.onsubmit = function (e) {
      e.preventDefault();
      var v = (campo.value || "").trim();
      if (!v && !q.opcional && q.tipo !== "uf") return erroEntrada("Escreva a sua resposta para continuar.");
      var msg = q.validar ? q.validar(v) : "";
      if (msg) { erroEntrada(msg); campo.focus(); return; }
      var mostrar = v;
      if (q.tipo === "data") mostrar = v.split("-").reverse().join("/");
      if (q.tipo === "email" && !v) mostrar = "Prefiro não informar";
      responder(q, q.tipo === "tel" ? v.replace(/\D/g, "") : v, mostrar);
    };
    focarSePerto(campo);
  }

  /* ------------------------------------------------------------------ Fluxo */
  async function perguntar(q) {
    atual = q; progresso(); limparEntrada();
    ocupado = true;
    var linhas = typeof q.bot === "function" ? q.bot() : q.bot;
    var g = geracao;
    await falar(linhas, q.id);
    if (g !== geracao) return;
    ocupado = false;
    if (atual !== q) return;               // a pessoa editou enquanto o assistente "digitava"
    mostrarEntrada(q, q._anterior);
    q._anterior = undefined;
  }
  async function responder(q, valor, texto) {
    if (ocupado || atual !== q) return;
    limparEntrada();
    R[q.id] = valor; ROT[q.id] = texto; historico.push(q.id);
    bolhaUsuario(q, texto);
    if (q.id === "consentimento") return enviar();
    var prox = proxima();
    progresso();
    if (prox) perguntar(prox);
  }
  function editar(id) {
    if (enviando || ocupado) return;
    var pos = historico.indexOf(id);
    if (pos < 0) return;
    var q = POR_ID[id];
    q._anterior = R[id];
    // remove esta resposta e todas as seguintes (as perguntas posteriores podem mudar)
    historico.splice(pos).forEach(function (k) { delete R[k]; delete ROT[k]; });
    // apaga da conversa a resposta editada e tudo o que veio depois dela
    var msgs = log.querySelectorAll(".msg"), corte = null;
    for (var i = 0; i < msgs.length; i++) { if (msgs[i].classList.contains("msg-eu") && msgs[i].getAttribute("data-q") === id) { corte = msgs[i]; break; } }
    if (corte) { while (corte.nextSibling) log.removeChild(corte.nextSibling); log.removeChild(corte); }
    atual = q; ocupado = false; progresso();
    mostrarEntrada(q, q._anterior); q._anterior = undefined;
    rolarFim();
  }

  /* ------------------------------------------------------------------ Envio */
  function coletar() {
    var respostas = {};
    ["situacao", "previsao_parto", "nascimento_bebe", "momento", "ja_solicitou", "status_pedido", "contribuiu", "vinculo", "descricao", "meu_inss", "comunicacao_inss", "documentos", "deseja_orientacao"]
      .forEach(function (k) { if (POR_ID[k] && ativa(POR_ID[k]) && R[k]) respostas[k] = R[k]; });
    var origem = {};
    try { origem = JSON.parse(sessionStorage.getItem("wl_origem") || "{}"); } catch (e) {}
    return {
      respostas: respostas,
      contato: { nome: R.nome || "", whatsapp: R.whatsapp || "", email: R.email || "", cidade: R.cidade || "", uf: R.uf || "" },
      consentimento: { aceito: R.consentimento === "sim", versao_politica: CFG.politicaVersao || "" },
      interesse: interesse, origem: origem, site: isca ? isca.value : "",
      tempo_preenchimento_ms: Date.now() - inicio
    };
  }
  function linkWhats(texto) { return "https://wa.me/" + NUM_WHATS + "?text=" + encodeURIComponent(texto); }
  async function enviar() {
    enviando = true; atual = null; progresso();
    var dados = coletar();
    var t = digitando();
    var ok = false, msgErro = "";
    if (location.protocol === "file:") {
      await espera(700); ok = true;
    } else {
      try {
        var r = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados), credentials: "same-origin" });
        var corpo = await r.json().catch(function () { return {}; });
        if (r.ok) ok = true;
        else msgErro = r.status === 429 ? "Recebemos vários envios seguidos. Aguarde alguns minutos e tente novamente." : (corpo.erro || "Não foi possível enviar agora.");
      } catch (e) { msgErro = "Não foi possível enviar agora. Verifique a sua conexão com a internet."; }
    }
    t.remove();
    if (!ok) {
      enviando = false;
      bolhaBot(msgErro + (TEM_WHATS ? " Se preferir, fale conosco pelo WhatsApp." : ""), "envio", "msg-alerta");
      limparEntrada();
      var linha = el("div", "chips");
      var tentar = el("button", "chip", "Tentar novamente"); tentar.type = "button";
      tentar.addEventListener("click", function () { limparEntrada(); enviar(); });
      linha.appendChild(tentar);
      if (TEM_WHATS) { var w = el("a", "chip", "Falar pelo WhatsApp"); w.href = linkWhats("Olá! Tentei enviar o formulário do site da M&L e não consegui."); w.target = "_blank"; w.rel = "noopener"; linha.appendChild(w); }
      entrada.appendChild(linha);
      return;
    }
    barra.style.transform = "scaleX(1)";
    raiz.classList.add("concluido");
    await falar(["Obrigada por compartilhar as suas informações, " + primeiroNome() + "!", "Recebemos os seus dados e a nossa equipe poderá analisar as informações fornecidas para orientar os próximos passos."], "fim");
    if (location.protocol === "file:") bolhaBot("Modo de pré-visualização: com o arquivo aberto direto no navegador, os dados não são gravados. No site publicado, o envio vai para o servidor e aparece no painel.", "fim", "msg-nota");
    limparEntrada(); entrada.setAttribute("data-tipo", "fim");
    if (TEM_WHATS) {
      var texto = "Olá! Meu nome é " + R.nome + ". Acabei de conversar com o assistente no site da M&L." +
        "\nSituação: " + (ROT.situacao || "não informada") + (interesse ? "\nInteresse: " + interesse : "") +
        "\nCidade: " + R.cidade + "/" + R.uf;
      var a = el("a", "btn btn-azul chat-whats");
      a.href = linkWhats(texto); a.target = "_blank"; a.rel = "noopener"; a.id = "btn-whats-final";
      a.innerHTML = '<svg aria-hidden="true"><use href="#i-whats"/></svg>Continuar pelo WhatsApp';
      entrada.appendChild(a);
      entrada.appendChild(el("p", "chat-nota", "A mensagem abre no WhatsApp com o seu nome, a sua situação e a sua cidade. Você pode revisá-la antes de enviar."));
    } else {
      entrada.appendChild(el("p", "chat-nota", "Entraremos em contato pelo WhatsApp informado."));
    }
  }

  /* ------------------------------------------------------------------ Início */
  function limpar() {
    geracao++;
    R = {}; ROT = {}; historico = []; atual = null; enviando = false; iniciado = false; ocupado = false;
    raiz.classList.remove("concluido"); log.innerHTML = ""; limparEntrada();
  }
  function reiniciar() {
    if (enviando && !raiz.classList.contains("concluido")) return;
    limpar();
    iniciar({ interesse: interesse });
  }
  function iniciar(op) {
    op = op || {};
    if (op.interesse) interesse = op.interesse;
    // vindo de um card de serviço: se a pessoa ainda não respondeu nada, recomeça já com o serviço escolhido
    if (op.descricao && iniciado && !historico.length && !enviando) limpar();
    if (op.descricao && !iniciado) {
      // vindo de um card de serviço sem WhatsApp configurado: começa já em "Outra situação"
      iniciado = true; inicio = Date.now();
      R.situacao = "outra"; ROT.situacao = "Outra situação"; historico.push("situacao");
      bolhaBot("Olá! Sou o assistente virtual da M&L Advocacia. Vi que você tem interesse em: " + (op.interesse || "outro serviço") + ".", "situacao");
      bolhaUsuario(POR_ID.situacao, "Outra situação");
      POR_ID.descricao._anterior = op.descricao;
      perguntar(POR_ID.descricao);
      return;
    }
    if (iniciado) return;
    iniciado = true; inicio = Date.now();
    perguntar(ROTEIRO[0]);
  }
  if (btnReiniciar) btnReiniciar.addEventListener("click", reiniciar);
  // começa quando a conversa aparece no ecrã (ou quando a pessoa clica num botão que leva até aqui)
  if ("IntersectionObserver" in window) {
    var obs = new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) {
        obs.disconnect();
        (window.wlPronto || Promise.resolve()).then(function () { iniciar(); });
      }
    }, { threshold: 0.25 });
    obs.observe(raiz);
  } else iniciar();

  window.WLChat = { iniciar: iniciar, reiniciar: reiniciar, respostas: function () { return JSON.parse(JSON.stringify(R)); } };
})();
