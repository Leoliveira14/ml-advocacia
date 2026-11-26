/* M&L Advocacia — interações do site e funil de qualificação (sem dependências). */
(function () {
  "use strict";
  document.documentElement.classList.remove("sem-js");

  var CFG = window.WL_CONFIG || {};
  var NUM_WHATS = String(CFG.whatsapp || "").replace(/\D/g, "");
  var TEM_WHATS = NUM_WHATS.length >= 12;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function linkWhats(texto) { return "https://wa.me/" + NUM_WHATS + "?text=" + encodeURIComponent(texto); }

  /* ---------- Origem do lead (UTM, referência, página) ---------- */
  var origem = (function () {
    try {
      var salvo = sessionStorage.getItem("wl_origem");
      if (salvo) return JSON.parse(salvo);
    } catch (e) {}
    var p = new URLSearchParams(location.search);
    var o = {
      utm_source: p.get("utm_source") || "", utm_medium: p.get("utm_medium") || "",
      utm_campaign: p.get("utm_campaign") || "", utm_term: p.get("utm_term") || "",
      utm_content: p.get("utm_content") || "", gclid: p.get("gclid") || "", fbclid: p.get("fbclid") || "",
      referencia: document.referrer ? document.referrer.split("?")[0] : "",
      pagina_entrada: location.pathname
    };
    try { sessionStorage.setItem("wl_origem", JSON.stringify(o)); } catch (e) {}
    return o;
  })();

  /* ---------- Cabeçalho e menu ---------- */
  var topo = $("#topo"), menu = $("#menu"), botaoMenu = $(".abrir-menu");
  function fecharMenu() {
    menu.classList.remove("aberto"); topo.classList.remove("menu-aberto");
    botaoMenu.setAttribute("aria-expanded", "false"); botaoMenu.setAttribute("aria-label", "Abrir menu");
    document.body.style.overflow = "";
  }
  botaoMenu.addEventListener("click", function () {
    var abrir = !menu.classList.contains("aberto");
    if (!abrir) return fecharMenu();
    menu.classList.add("aberto"); topo.classList.add("menu-aberto");
    botaoMenu.setAttribute("aria-expanded", "true"); botaoMenu.setAttribute("aria-label", "Fechar menu");
    document.body.style.overflow = "hidden";
  });
  $$("a", menu).forEach(function (a) { a.addEventListener("click", fecharMenu); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.classList.contains("aberto")) { fecharMenu(); botaoMenu.focus(); } });
  function aoRolar() { topo.classList.toggle("rolado", window.scrollY > 8); }
  window.addEventListener("scroll", aoRolar, { passive: true }); aoRolar();

  /* ---------- Revelar ao rolar ---------- */
  if ("IntersectionObserver" in window) {
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("visivel"); obs.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    $$(".revelar").forEach(function (el) { obs.observe(el); });
  } else {
    $$(".revelar").forEach(function (el) { el.classList.add("visivel"); });
  }

  /* ---------- Fotografias (aparecem só quando o arquivo existe) ---------- */
  $$("[data-foto]").forEach(function (moldura) {
    var img = $("img.foto", moldura);
    if (!img) return;
    function ok() { if (img.naturalWidth > 0) { img.hidden = false; moldura.classList.add("com-foto"); } }
    if (img.complete) ok(); else img.addEventListener("load", ok);
  });

  /* ---------- Rodapé: contatos configurados ---------- */
  var listaContatos = $("#rodape-contatos");
  if (listaContatos) {
    if (CFG.email) { var li = document.createElement("li"); var a = document.createElement("a"); a.href = "mailto:" + CFG.email; a.textContent = CFG.email; li.appendChild(a); listaContatos.appendChild(li); }
    if (CFG.instagram && /^https:\/\//.test(CFG.instagram)) { var li2 = document.createElement("li"); var a2 = document.createElement("a"); a2.href = CFG.instagram; a2.target = "_blank"; a2.rel = "noopener"; a2.textContent = "Instagram"; li2.appendChild(a2); listaContatos.appendChild(li2); }
  }
  var ano = $("#ano"); if (ano) ano.textContent = new Date().getFullYear();

  /* ---------- Funil: a conversa com o assistente está em chat.js ---------- */

  /* ---------- Botões de WhatsApp e serviços ---------- */
  function irParaFunil(interesse, descricao) {
    if (window.WLChat) window.WLChat.iniciar({ interesse: interesse || "", descricao: descricao || "" });
    if (window.wlRolar) window.wlRolar($("#contato")); else $("#contato").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  $$("[data-whats]").forEach(function (el) {
    if (TEM_WHATS) {
      el.href = linkWhats(el.getAttribute("data-whats")); el.target = "_blank"; el.rel = "noopener";
    } else {
      el.addEventListener("click", function (e) { e.preventDefault(); irParaFunil(el.getAttribute("data-interesse")); });
    }
  });
  $$("[data-servico]").forEach(function (b) {
    b.addEventListener("click", function () {
      var s = b.getAttribute("data-servico");
      if (TEM_WHATS) window.open(linkWhats("Olá! Gostaria de saber mais sobre: " + s + "."), "_blank", "noopener");
      else irParaFunil(s, "Gostaria de saber mais sobre: " + s + ".");
    });
  });
  $$("[data-ir-funil]").forEach(function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); irParaFunil(); });
  });

  /* Botão flutuante: fica oculto enquanto o formulário está visível */
  var flutuante = $("#whats-flutuante");
  if (flutuante && "IntersectionObserver" in window) {
    new IntersectionObserver(function (en) { flutuante.classList.toggle("oculto", en[0].isIntersecting); }, { threshold: 0.15 }).observe($("#contato"));
  }

})();
