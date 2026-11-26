/* M&L Advocacia — cenas guiadas pelo scroll (sem dependências).
 *
 * Um único ciclo requestAnimationFrame lê a posição de rolagem e atualiza:
 *   1. Túnel de fotografias do topo: a "câmara" avança em profundidade (3D) e, no fim,
 *      uma fotografia abre-se até ocupar o ecrã inteiro (inspirado no layout "Margem").
 *   2. Faixa com os serviços, que corre mais depressa e inclina conforme a velocidade do scroll.
 *   3. Galeria horizontal fixa das etapas do atendimento, com barra de progresso.
 *   4. Títulos que "acendem" palavra a palavra conforme a leitura.
 *   5. Parallax em fotografias ([data-parallax]).
 *   6. Fotografia que segue o cursor na lista de serviços.
 * Só se usam transform/opacity/clip-path (animações na GPU). Com "reduzir movimento",
 * as cenas ficam estáticas e todo o conteúdo continua acessível.
 */
(function () {
  "use strict";
  var doc = document.documentElement;
  var reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ponteiroFino = window.matchMedia("(pointer: fine)").matches;
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function lim(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function faixa(v, a, b) { return lim((v - a) / (b - a), 0, 1); }        // progresso de v entre a e b
  function suave(t) { return t * t * (3 - 2 * t); }                         // smoothstep
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  var cenas = [];
  var vw = window.innerWidth, vh = window.innerHeight;
  var y = window.scrollY, yAnt = y, vel = 0;

  /* Medidas das secções (atualizadas no resize e quando as fontes/imagens mudam o layout) */
  function topoAbs(el) { var t = 0; while (el) { t += el.offsetTop; el = el.offsetParent; } return t; }

  /* ------------------------------------------------------------------ 1. Túnel */
  var tunel = $(".tunel");
  if (tunel) {
    if (reduzir) tunel.classList.add("estatico");
    var fotos = $$(".tunel-foto", tunel);
    var texto = $(".tunel-texto", tunel);
    var final = $(".tunel-final", tunel);
    var finalImg = final && $("img", final);
    var finalTexto = final && $(".tunel-final-texto", final);
    var dica = $(".tunel-dica", tunel);
    var PROF = 3600;                     // profundidade total do túnel
    var dados = [];
    // Distribuição determinística: ângulos dourados à volta do centro, profundidades escalonadas
    function distribuir() {
      var n = fotos.length, estreito = vw < 700;
      var rx = vw * (estreito ? 0.46 : 0.4), ry = vh * (estreito ? 0.4 : 0.36);
      dados = fotos.map(function (f, i) {
        var ang = i * 2.39996323 + 0.6;                       // ângulo de ouro
        var raio = 0.78 + ((i * 37) % 23) / 23 * 0.42;        // 0.78 – 1.2
        var z = -((i + 0.5) / n) * PROF * 0.92;
        var abrir = 1 + (-z / PROF) * 1.15;                     // fotos distantes afastam-se do centro (texto legível)
        var x = Math.cos(ang) * rx * raio * abrir, yy = Math.sin(ang) * ry * raio * abrir;
        // as fotos mais próximas nunca ficam por trás do bloco de texto central
        if (z > -1300 && Math.abs(x) < vw * (estreito ? 0.36 : 0.34) && Math.abs(yy) < vh * 0.34) x = (x < 0 ? -1 : 1) * vw * (estreito ? 0.36 : 0.34);
        return {
          el: f,
          x: x,
          y: yy,
          z: z,
          rot: (((i * 53) % 17) - 8) * 0.6
        };
      });
    }
    if (!reduzir) {
      distribuir();
      cenas.push({
        medir: function () { this.ini = topoAbs(tunel); this.alt = tunel.offsetHeight - vh; distribuir(); },
        atualizar: function () {
          var p = faixa(y, this.ini, this.ini + this.alt);           // 0 → 1 ao longo do túnel
          var avanco = faixa(p, 0, 0.72) * PROF * 0.98;               // a câmara avança
          for (var i = 0; i < dados.length; i++) {
            var d = dados[i], z = d.z + avanco;
            var op = z > 420 ? 0 : z > 140 ? 1 - (z - 140) / 280 : z < -PROF * 0.82 ? lim((z + PROF) / (PROF * 0.18), 0, 1) * 0.6 : z < -1900 ? 0.6 + 0.4 * (1 - (-z - 1900) / (PROF * 0.82 - 1900)) : 1;
            if (op <= 0.001) { if (d.vis !== false) { d.el.style.opacity = "0"; d.el.style.visibility = "hidden"; d.vis = false; } continue; }
            if (d.vis === false) { d.el.style.visibility = ""; d.vis = true; }
            d.el.style.opacity = op.toFixed(3);
            d.el.style.transform = "translate3d(" + d.x.toFixed(1) + "px," + d.y.toFixed(1) + "px," + z.toFixed(1) + "px) rotate(" + d.rot + "deg)";
            var desfoque = z < -1900 ? 3 : z < -1200 ? 1.5 : 0;   // profundidade de campo em 3 níveis
            if (d.blur !== desfoque) { d.el.style.filter = desfoque ? "blur(" + desfoque + "px)" : ""; d.blur = desfoque; }
          }
          // título central: some à medida que entramos no túnel
          var t = faixa(p, 0.16, 0.42);
          texto.style.opacity = (1 - t).toFixed(3);
          texto.style.transform = "translateY(" + (-t * 60).toFixed(1) + "px) scale(" + (1 - t * 0.06).toFixed(4) + ")";
          texto.style.pointerEvents = t > 0.6 ? "none" : "";
          texto.style.visibility = t >= 1 ? "hidden" : "";
          if (dica) dica.style.opacity = (1 - faixa(p, 0, 0.06)).toFixed(3);
          // abertura final: a fotografia sai do centro e ocupa o ecrã
          var f = easeInOut(faixa(p, 0.62, 0.94));
          var ix = (1 - f) * 42, iy = (1 - f) * 38;
          final.style.clipPath = "inset(" + iy.toFixed(2) + "% " + ix.toFixed(2) + "% " + iy.toFixed(2) + "% " + ix.toFixed(2) + "% round " + ((1 - f) * 10).toFixed(1) + "px)";
          final.style.visibility = f <= 0.001 ? "hidden" : "";
          if (finalImg) finalImg.style.transform = "scale(" + (1.35 - f * 0.35).toFixed(4) + ")";
          if (finalTexto) {
            var ft = faixa(p, 0.86, 0.98);
            finalTexto.style.opacity = ft.toFixed(3);
            finalTexto.style.transform = "translateY(" + ((1 - ft) * 30).toFixed(1) + "px)";
          }
        }
      });
    }
  }

  /* ------------------------------------------------------------------ 2. Faixa com velocidade */
  var trilhoFaixa = $(".faixa-trilho");
  if (trilhoFaixa && !reduzir) {
    var desloc = 0, largMetade = 0, inclinar = 0;
    cenas.push({
      medir: function () { largMetade = trilhoFaixa.scrollWidth / 2; },
      atualizar: function (dt) {
        desloc -= (0.04 * dt) + vel * 0.6;
        if (largMetade) { while (desloc <= -largMetade) desloc += largMetade; while (desloc > 0) desloc -= largMetade; }
        inclinar += (lim(vel * 0.25, -8, 8) - inclinar) * 0.12;
        trilhoFaixa.style.transform = "translate3d(" + desloc.toFixed(1) + "px,0,0) skewX(" + (-inclinar).toFixed(2) + "deg)";
      },
      sempre: true
    });
  }

  /* ------------------------------------------------------------------ 3. Galeria horizontal fixa */
  var processo = $(".processo");
  if (processo && !reduzir) {
    var trilho = $(".processo-trilho", processo), janela = $(".processo-janela", processo);
    var barraPP = $(".pp-barra", processo), rotulos = $$(".pp-rotulos li", processo);
    var imgsEtapa = $$(".etapa-card img", processo);
    cenas.push({
      medir: function () {
        this.ativo = vw >= 900;
        this.ini = topoAbs(processo); this.alt = processo.offsetHeight - vh;
        this.dist = Math.max(0, trilho.scrollWidth - janela.clientWidth);
        this.cartoes = imgsEtapa.map(function (img) { var card = img.closest(".etapa-card"); return { img: img, centro: card.offsetLeft + card.offsetWidth / 2 }; });
        if (!this.ativo) { trilho.style.transform = ""; imgsEtapa.forEach(function (i) { i.style.transform = ""; }); }
      },
      atualizar: function () {
        if (!this.ativo) return;
        var p = faixa(y, this.ini + vh * 0.05, this.ini + this.alt - vh * 0.05);
        var x = -suave(p) * this.dist;
        trilho.style.transform = "translate3d(" + x.toFixed(1) + "px,0,0)";
        // parallax interno: cada fotografia desliza dentro da moldura
        for (var i = 0; i < this.cartoes.length; i++) {
          var c = (this.cartoes[i].centro + x - vw / 2) / vw;
          this.cartoes[i].img.style.transform = "translate3d(" + (c * -8).toFixed(2) + "%,0,0) scale(1.12)";
        }
        barraPP.style.setProperty("--pp", p.toFixed(4));
        var ativo = Math.min(rotulos.length - 1, Math.floor(p * rotulos.length * 0.999));
        rotulos.forEach(function (li, i) { li.classList.toggle("ativo", i <= ativo); });
      }
    });
  }

  /* ------------------------------------------------------------------ 4. Títulos que acendem */
  $$("[data-acender]").forEach(function (el) {
    var palavras = el.textContent.trim().split(/\s+/);
    el.setAttribute("aria-label", el.textContent.trim());
    el.innerHTML = "";
    palavras.forEach(function (p, i) {
      var s = document.createElement("span"); s.className = "ac"; s.textContent = p; s.setAttribute("aria-hidden", "true");
      el.appendChild(s); if (i < palavras.length - 1) el.appendChild(document.createTextNode(" "));
    });
    if (reduzir) return;
    var spans = $$(".ac", el), aceso = -1;
    cenas.push({
      medir: function () { this.ini = topoAbs(el); this.alt = el.offsetHeight; },
      atualizar: function () {
        // começa quando o título entra a 85% da altura do ecrã e termina a 35%
        var p = faixa(y + vh * 0.85, this.ini, this.ini + this.alt + vh * 0.5);
        var n = Math.round(p * spans.length);
        if (n === aceso) return;
        for (var i = 0; i < spans.length; i++) spans[i].classList.toggle("on", i < n);
        aceso = n;
      }
    });
  });

  /* ------------------------------------------------------------------ 5. Parallax */
  if (!reduzir) {
    var paralaxe = $$("[data-parallax]").map(function (el) { return { el: el, f: parseFloat(el.getAttribute("data-parallax")) || 0 }; });
    if (paralaxe.length) cenas.push({
      medir: function () { paralaxe.forEach(function (o) { o.ini = topoAbs(o.el); o.alt = o.el.offsetHeight; }); },
      atualizar: function () {
        for (var i = 0; i < paralaxe.length; i++) {
          var o = paralaxe[i];
          var centro = o.ini + o.alt / 2 - (y + vh / 2);
          if (Math.abs(centro) > vh * 1.5) continue;
          o.el.style.translate = "0 " + (centro * o.f).toFixed(1) + "px";
        }
      }
    });
  }

  /* ------------------------------------------------------------------ 6. Fotografia que segue o cursor */
  var seguidor = $(".seguidor");
  if (seguidor && ponteiroFino && !reduzir) {
    var segImg = $("img", seguidor);
    var mx = 0, my = 0, sx = 0, sy = 0, dentro = false;
    $$(".servico-linha[data-foto]").forEach(function (linha) {
      var pre = new Image(); // pré-carregamento leve ao primeiro hover
      linha.addEventListener("mouseenter", function () {
        var url = linha.getAttribute("data-foto");
        if (!pre.src) pre.src = url;
        if (segImg.getAttribute("src") !== url) segImg.setAttribute("src", url);
        seguidor.classList.add("visivel"); dentro = true;
      });
      linha.addEventListener("mouseleave", function () { seguidor.classList.remove("visivel"); dentro = false; });
    });
    window.addEventListener("mousemove", function (e) { mx = e.clientX; my = e.clientY; }, { passive: true });
    cenas.push({
      medir: function () {},
      atualizar: function () {
        if (!dentro && !seguidor.classList.contains("visivel")) return;
        sx += (mx - sx) * 0.14; sy += (my - sy) * 0.14;
        var w = seguidor.offsetWidth, h = seguidor.offsetHeight;
        seguidor.style.translate = (sx + 28).toFixed(1) + "px " + (sy - h / 2).toFixed(1) + "px";
        if (sx + 28 + w > vw) seguidor.style.translate = (sx - w - 28).toFixed(1) + "px " + (sy - h / 2).toFixed(1) + "px";
      },
      sempre: true
    });
  }

  /* ------------------------------------------------------------------ Ciclo único */
  function medirTudo() {
    vw = window.innerWidth; vh = window.innerHeight;
    cenas.forEach(function (c) { c.medir(); });
  }
  var ultimo = 0;
  function quadro(t) {
    var dt = ultimo ? Math.min(50, t - ultimo) : 16.7;
    ultimo = t;
    y = window.scrollY;
    vel += ((y - yAnt) - vel) * 0.2;
    yAnt = y;
    for (var i = 0; i < cenas.length; i++) cenas[i].atualizar(dt);
    requestAnimationFrame(quadro);
  }
  if (cenas.length) {
    medirTudo();
    requestAnimationFrame(quadro);
    var tempo;
    window.addEventListener("resize", function () { clearTimeout(tempo); tempo = setTimeout(medirTudo, 120); });
    window.addEventListener("load", medirTudo);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(medirTudo);
    if ("ResizeObserver" in window) new ResizeObserver(function () { clearTimeout(tempo); tempo = setTimeout(medirTudo, 120); }).observe(document.body);
  }
})();
