/* M&L Advocacia — camada de movimento (sem dependências).
 * Inspirada em sites de portfólio premium: rolagem suave com inércia, revelação de títulos
 * palavra a palavra e linha a linha, botões com texto que rola, cabeçalho que se esconde ao descer,
 * barra de progresso de leitura, menu que acompanha a secção ativa e transição entre páginas.
 * Respeita "reduzir movimento": nesse caso nada é animado e o conteúdo aparece de imediato.
 */
(function () {
  "use strict";
  var doc = document.documentElement;
  var reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ponteiroFino = window.matchMedia("(pointer: fine)").matches;
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function limitar(v, a, b) { return Math.min(b, Math.max(a, v)); }
  var expoOut = function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); };

  doc.classList.add("mov");
  if (reduzir) doc.classList.add("mov-reduzido");

  /* ------------------------------------------------------------------
   * 0. Carregamento inicial com o logotipo
   *    A linha dourada acompanha o carregamento real das primeiras fotografias e das fontes.
   *    Mostra-se pelo menos 1,6 s (para o logotipo se revelar) e nunca mais de 4,5 s.
   * ------------------------------------------------------------------ */
  var carregador = $("#carregador");
  window.wlPronto = new Promise(function (resolver) {
    if (!carregador) { resolver(); return; }
    doc.classList.add("carregando");
    var linha = $(".car-linha", carregador), numero = $(".car-num", carregador);
    var inicio = performance.now();
    var MIN = reduzir ? 250 : 1600, MAX = 4500;
    var itens = $$(".tunel-foto img").slice(0, 10).concat($$(".car-logo, .marca img"));
    var total = itens.length + 1, feitos = 0, mostrado = 0, terminado = false;
    function um() { feitos = Math.min(total, feitos + 1); }
    itens.forEach(function (img) {
      if (img.complete) um();
      else { img.addEventListener("load", um, { once: true }); img.addEventListener("error", um, { once: true }); }
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(um, um); else um();
    function sair() {
      if (terminado) return; terminado = true;
      carregador.classList.add("saindo");
      setTimeout(function () { doc.classList.remove("carregando"); resolver(); }, reduzir ? 0 : 320);
      setTimeout(function () { carregador.remove(); }, reduzir ? 350 : 1100);
    }
    (function tique(t) {
      var decorrido = t - inicio;
      var alvo = decorrido > MAX ? 1 : feitos / total;
      alvo = Math.min(alvo, decorrido / MIN);                      // não corre mais depressa do que o mínimo
      mostrado += (alvo - mostrado) * 0.12;
      if (alvo >= 1 && mostrado > 0.995) mostrado = 1;
      linha.style.setProperty("--c", mostrado.toFixed(4));
      numero.textContent = Math.round(mostrado * 100) + "%";
      if (mostrado >= 1) { setTimeout(sair, 180); return; }
      requestAnimationFrame(tique);
    })(inicio);
  });

  /* ------------------------------------------------------------------
   * 1. Rolagem suave (inércia na roda do rato; toque e teclado ficam nativos)
   * ------------------------------------------------------------------ */
  var rol = { atual: window.scrollY, alvo: window.scrollY, ativo: false, raf: 0, ultimo: 0, anim: null };
  function maxRolagem() { return doc.scrollHeight - window.innerHeight; }
  function quadro(t) {
    var dt = rol.ultimo ? Math.min(64, t - rol.ultimo) : 16.7;
    rol.ultimo = t;
    if (rol.anim) {
      var a = rol.anim, p = limitar((t - a.inicio) / a.duracao, 0, 1);
      rol.atual = a.de + (a.para - a.de) * expoOut(p);
      window.scrollTo(0, rol.atual);
      if (p >= 1) { rol.anim = null; parar(); return; }
    } else {
      var fator = 1 - Math.pow(1 - 0.1, dt / 16.7);
      rol.atual += (rol.alvo - rol.atual) * fator;
      if (Math.abs(rol.alvo - rol.atual) < 0.4) { rol.atual = rol.alvo; window.scrollTo(0, rol.atual); parar(); return; }
      window.scrollTo(0, rol.atual);
    }
    rol.raf = requestAnimationFrame(quadro);
  }
  function iniciar() {
    if (rol.ativo) return;
    rol.ativo = true; rol.ultimo = 0; doc.classList.add("rolagem-suave");
    rol.raf = requestAnimationFrame(quadro);
  }
  function parar() { rol.ativo = false; cancelAnimationFrame(rol.raf); doc.classList.remove("rolagem-suave"); }

  function podeRolarDentro(el, dy) {
    while (el && el !== document.body && el !== doc) {
      var cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        if ((dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) || (dy < 0 && el.scrollTop > 0)) return true;
      }
      el = el.parentElement;
    }
    return false;
  }
  if (!reduzir && ponteiroFino) {
    window.addEventListener("wheel", function (e) {
      if (doc.classList.contains("carregando")) { e.preventDefault(); return; }
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (document.body.style.overflow === "hidden") return;
      if (e.target.closest && e.target.closest("textarea, select, iframe, [data-rolagem-nativa]")) return;
      var dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1);
      if (podeRolarDentro(e.target, dy)) return;
      e.preventDefault();
      if (!rol.ativo || rol.anim) { rol.anim = null; rol.atual = window.scrollY; rol.alvo = window.scrollY; }
      rol.alvo = limitar(rol.alvo + dy, 0, maxRolagem());
      iniciar();
    }, { passive: false });
    window.addEventListener("keydown", function (e) {
      if (/^(Arrow|Page|Home|End| )/.test(e.key) || e.key === " ") { rol.anim = null; parar(); }
    });
    window.addEventListener("touchstart", function () { rol.anim = null; parar(); }, { passive: true });
  }

  /** Rola até um elemento (ou posição) com aceleração suave; exposto para o app.js. */
  function rolarPara(destino, opcoes) {
    opcoes = opcoes || {};
    var y = typeof destino === "number" ? destino
      : destino.getBoundingClientRect().top + window.scrollY - (opcoes.margem != null ? opcoes.margem : alturaTopo() + 12);
    y = limitar(y, 0, maxRolagem());
    if (reduzir) { window.scrollTo(0, y); return; }
    var dist = Math.abs(y - window.scrollY);
    rol.anim = { de: window.scrollY, para: y, inicio: performance.now(), duracao: limitar(600 + dist * 0.25, 700, 1600) };
    rol.atual = window.scrollY; rol.alvo = y;
    parar(); iniciar();
  }
  window.wlRolar = rolarPara;

  /* ------------------------------------------------------------------
   * 2. Cabeçalho que se esconde ao descer + barra de progresso
   * ------------------------------------------------------------------ */
  var topo = $("#topo");
  function alturaTopo() { return topo ? topo.offsetHeight : 0; }
  var barra = document.createElement("div");
  barra.className = "barra-leitura"; barra.setAttribute("aria-hidden", "true");
  document.body.appendChild(barra);
  var ultimoY = window.scrollY, pendente = false;
  function aoRolar() {
    pendente = false;
    var y = window.scrollY, max = maxRolagem();
    barra.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0);
    if (topo) {
      var menuAberto = topo.classList.contains("menu-aberto");
      var focoNoTopo = topo.contains(document.activeElement) && document.activeElement !== document.body;
      if (!menuAberto && !focoNoTopo && y > 160 && y > ultimoY + 4) topo.classList.add("escondido");
      else if (y < ultimoY - 4 || y <= 160 || menuAberto) topo.classList.remove("escondido");
    }
    ultimoY = y;
  }
  window.addEventListener("scroll", function () {
    if (!rol.ativo) { rol.atual = window.scrollY; rol.alvo = window.scrollY; }
    if (!pendente) { pendente = true; requestAnimationFrame(aoRolar); }
  }, { passive: true });
  if (topo) topo.addEventListener("focusin", function () { topo.classList.remove("escondido"); });
  aoRolar();

  /* ------------------------------------------------------------------
   * 3. Âncoras internas com rolagem suave e foco acessível
   * ------------------------------------------------------------------ */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || a.hasAttribute("data-ir-funil") || a.hasAttribute("data-whats")) return;
    var id = a.getAttribute("href").slice(1);
    var alvo = id ? document.getElementById(id) : null;
    if (!alvo) return;
    e.preventDefault();
    rolarPara(id === "inicio" ? 0 : alvo);
    if (history.replaceState) history.replaceState(null, "", "#" + id);
    setTimeout(function () { alvo.setAttribute("tabindex", "-1"); alvo.focus({ preventScroll: true }); }, 700);
  });

  /* ------------------------------------------------------------------
   * 4. Menu acompanha a secção visível (aria-current)
   * ------------------------------------------------------------------ */
  var linksMenu = $$("#menu a[href^='#']:not(.btn)");
  if ("IntersectionObserver" in window && linksMenu.length) {
    var mapa = {};
    linksMenu.forEach(function (l) { mapa[l.getAttribute("href").slice(1)] = l; });
    var espia = new IntersectionObserver(function (ent) {
      ent.forEach(function (en) {
        if (!en.isIntersecting) return;
        linksMenu.forEach(function (l) { l.removeAttribute("aria-current"); });
        var l = mapa[en.target.id]; if (l) l.setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    Object.keys(mapa).forEach(function (id) { var s = document.getElementById(id); if (s) espia.observe(s); });
  }

  /* ------------------------------------------------------------------
   * 5. Revelações: palavras (título principal), linhas (títulos), fade e "wipe"
   * ------------------------------------------------------------------ */
  function dividirPalavras(el) {
    // Envolve cada palavra num <span class="pal"><span class="pal-in">…</span></span>, preservando <em>, <strong> etc.
    var n = 0;
    (function andar(no) {
      Array.prototype.slice.call(no.childNodes).forEach(function (filho) {
        if (filho.nodeType === 3) {
          var partes = filho.textContent.split(/(\s+)/);
          var frag = document.createDocumentFragment();
          partes.forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(" ")); return; }
            var ext = document.createElement("span"); ext.className = "pal";
            var int = document.createElement("span"); int.className = "pal-in"; int.textContent = p;
            int.style.setProperty("--i", n++);
            ext.appendChild(int); frag.appendChild(ext);
          });
          no.replaceChild(frag, filho);
        } else if (filho.nodeType === 1 && !/^(SVG|BR)$/i.test(filho.tagName)) andar(filho);
      });
    })(el);
    return n;
  }
  function agruparLinhas(el) {
    // Usa as palavras já divididas e numera cada uma pela linha visual em que caiu.
    var pals = $$(".pal", el), linha = -1, topoAnt = null;
    pals.forEach(function (p) {
      var t = p.offsetTop;
      if (topoAnt === null || Math.abs(t - topoAnt) > 4) { linha++; topoAnt = t; }
      p.firstChild.style.setProperty("--l", linha);
    });
  }

  var revelaveis = [];
  function marcar(el, tipo, atraso) {
    el.setAttribute("data-rv", tipo);
    if (atraso) el.style.setProperty("--d", atraso + "ms");
    revelaveis.push(el);
  }
  $$(".revelar").forEach(function (el) {
    el.classList.remove("revelar");
    var tag = el.tagName;
    if (el.closest(".hero, .tunel") && tag === "H1") { dividirPalavras(el); marcar(el, "palavras"); }
    else if (/^H[12]$/.test(tag)) { dividirPalavras(el); agruparLinhas(el); marcar(el, "linhas"); }
    else if (el.matches(".hero-visual, .retrato, .arco, figure")) marcar(el, "wipe");
    else {
      // irmãos em grelha entram em cascata
      var irmaos = el.parentElement ? $$(":scope > [data-rv], :scope > .revelar", el.parentElement) : [];
      var idx = Math.max(0, irmaos.indexOf(el));
      var emGrelha = el.parentElement && el.parentElement.matches(".lista-materna, .passos, .diferenciais, .servicos, .lista-servicos, .hero-acoes");
      marcar(el, "fade", emGrelha ? Math.min(idx, 8) * 70 : 0);
    }
  });
  // atraso em cascata para os elementos de texto da primeira dobra
  $$(".hero-texto > [data-rv]").forEach(function (el, i) { if (i) el.style.setProperty("--d", (i * 110 + 150) + "ms"); });

  var reagrupar;
  window.addEventListener("resize", function () {
    clearTimeout(reagrupar);
    reagrupar = setTimeout(function () { $$('[data-rv="linhas"]').forEach(agruparLinhas); }, 150);
  });

  if (reduzir || !("IntersectionObserver" in window)) {
    revelaveis.forEach(function (el) { el.classList.add("is-in", "is-set"); });
  } else {
    // Elementos com "wipe" ficam recortados (clip-path) e o observador não os vê:
    // nesses casos observa-se o elemento-pai.
    var porAlvo = new Map();
    var obs = new IntersectionObserver(function (ent) {
      ent.forEach(function (en) {
        if (!en.isIntersecting) return;
        (porAlvo.get(en.target) || []).forEach(function (el) { el.classList.add("is-in"); });
        obs.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.01 });
    revelaveis.forEach(function (el) {
      var alvo = el.getAttribute("data-rv") === "wipe" && el.parentElement ? el.parentElement : el;
      if (!porAlvo.has(alvo)) porAlvo.set(alvo, []);
      porAlvo.get(alvo).push(el);
    });
    // as revelações só começam quando a cortina do carregamento sobe
    window.wlPronto.then(function () { requestAnimationFrame(function () { porAlvo.forEach(function (_, alvo) { obs.observe(alvo); }); }); });
  }

  /* ------------------------------------------------------------------
   * 6. Botões com texto que rola no hover + setas que deslizam
   * ------------------------------------------------------------------ */
  $$(".btn").forEach(function (b) {
    if (b.id === "btn-avancar" || b.querySelector(".rolo")) return;
    var texto = "";
    Array.prototype.slice.call(b.childNodes).forEach(function (n) { if (n.nodeType === 3) texto += n.textContent; });
    texto = texto.trim();
    if (!texto || texto.length > 34) return;
    Array.prototype.slice.call(b.childNodes).forEach(function (n) { if (n.nodeType === 3) b.removeChild(n); });
    var rolo = document.createElement("span"); rolo.className = "rolo";
    var a = document.createElement("span"); a.className = "rolo-a"; a.textContent = texto;
    var c = document.createElement("span"); c.className = "rolo-b"; c.textContent = texto; c.setAttribute("aria-hidden", "true");
    rolo.appendChild(a); rolo.appendChild(c);
    b.appendChild(rolo);
  });

  /* ------------------------------------------------------------------
   * 7. Botão flutuante "magnético" (só com rato)
   * ------------------------------------------------------------------ */
  var flutuante = $("#whats-flutuante");
  if (flutuante && ponteiroFino && !reduzir) {
    window.addEventListener("mousemove", function (e) {
      var r = flutuante.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      var d = Math.hypot(dx, dy);
      if (d < 120) flutuante.style.translate = (dx * 0.18).toFixed(1) + "px " + (dy * 0.18).toFixed(1) + "px";
      else if (flutuante.style.translate) flutuante.style.translate = "";
    }, { passive: true });
  }

  /* ------------------------------------------------------------------
   * 8. Transição suave entre páginas (ex.: Política de Privacidade)
   * ------------------------------------------------------------------ */
  var cortina = document.createElement("div");
  cortina.className = "cortina"; cortina.setAttribute("aria-hidden", "true");
  document.body.appendChild(cortina);
  requestAnimationFrame(function () { doc.classList.add("pagina-pronta"); });
  window.addEventListener("pageshow", function (e) { if (e.persisted) doc.classList.remove("saindo"); });
  if (!reduzir) {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank" || a.hasAttribute("download")) return;
      var href = a.getAttribute("href");
      if (!href || href.charAt(0) === "#" || /^(mailto|tel|javascript):/i.test(href)) return;
      var url = new URL(a.href, location.href);
      if (url.origin !== location.origin && location.protocol !== "file:") return;
      if (url.pathname === location.pathname && url.hash) return;
      e.preventDefault();
      doc.classList.add("saindo");
      setTimeout(function () { location.href = a.href; }, 420);
    });
  }
})();
