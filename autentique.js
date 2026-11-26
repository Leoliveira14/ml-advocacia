/* Integração com o Autentique (assinatura eletrônica) — API GraphQL v2, sem dependências.
 *
 * Documentação: https://docs.autentique.com.br/api
 *  - criarDocumento: mutation createDocument (envio multipart, especificação "GraphQL multipart request")
 *  - consultarDocumento: query document(id)
 *  - verificarWebhook: cabeçalho X-Autentique-Signature = HMAC-SHA256 (hex) do corpo bruto
 *
 * A chave da API fica só no servidor (.env). O navegador nunca a vê.
 */
"use strict";
const crypto = require("node:crypto");

const URL_PADRAO = "https://api.autentique.com.br/v2/graphql";

function criarCliente({ token, sandbox = true, url = URL_PADRAO, timeoutMs = 30_000 }) {
  async function chamar(corpo, cabecalhosExtra = {}) {
    if (!token) throw Object.assign(new Error("AUTENTIQUE_TOKEN não configurado."), { codigo: "sem_token" });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let r;
    try {
      r = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token, ...cabecalhosExtra }, body: corpo, signal: ctrl.signal });
    } catch (e) {
      throw Object.assign(new Error(e.name === "AbortError" ? "O Autentique não respondeu a tempo." : "Não foi possível falar com o Autentique."), { codigo: "rede" });
    } finally { clearTimeout(t); }
    const txt = await r.text();
    let dados; try { dados = JSON.parse(txt); } catch { dados = null; }
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error("Chave do Autentique inválida ou sem permissão."), { codigo: "auth" });
    if (r.status === 429) throw Object.assign(new Error("Limite de pedidos do Autentique atingido. Tente de novo em um minuto."), { codigo: "limite" });
    if (!dados) throw Object.assign(new Error(`Resposta inesperada do Autentique (HTTP ${r.status}).`), { codigo: "resposta" });
    if (dados.errors && dados.errors.length) {
      const msg = dados.errors.map((e) => e.message).filter(Boolean).join("; ") || "erro desconhecido";
      throw Object.assign(new Error("Autentique: " + msg), { codigo: "graphql" });
    }
    return dados.data;
  }

  /**
   * Cria um documento e envia-o para assinatura de UM signatário (o cliente).
   * arquivo: { buffer, nome, tipo }
   * signatario: { nome, email?, telefone? (só dígitos com DDD), metodo: "whatsapp" | "email" | "link" }
   */
  async function criarDocumento({ nomeDocumento, mensagem, arquivo, signatario }) {
    const s = { action: "SIGN" };
    if (signatario.metodo === "email") s.email = signatario.email;
    else if (signatario.metodo === "whatsapp") { s.phone = "+55" + signatario.telefone; s.delivery_method = "DELIVERY_METHOD_WHATSAPP"; }
    else s.name = signatario.nome; // link: o Autentique devolve o link para enviarmos nós
    const doc = { name: nomeDocumento, refusable: true, locale: { country: "BR", language: "pt-BR", timezone: "America/Sao_Paulo", date_format: "DD_MM_YYYY" } };
    if (mensagem) doc.message = mensagem;
    const query = `mutation CriarDocumento($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
      createDocument(${sandbox ? "sandbox: true, " : ""}document: $document, signers: $signers, file: $file) {
        id name created_at
        signatures { public_id name email action { name } link { short_link } }
      }
    }`;
    const fd = new FormData();
    fd.append("operations", JSON.stringify({ query, variables: { document: doc, signers: [s], file: null } }));
    fd.append("map", JSON.stringify({ file: ["variables.file"] }));
    fd.append("file", new Blob([arquivo.buffer], { type: arquivo.tipo || "application/octet-stream" }), arquivo.nome);
    const d = await chamar(fd);
    const c = d && d.createDocument;
    if (!c || !c.id) throw Object.assign(new Error("O Autentique não devolveu o documento criado."), { codigo: "resposta" });
    // assinatura do cliente (ignora a do dono da conta, se o Autentique a incluir)
    const sig = (c.signatures || []).find((x) => x.action && x.action.name && x.action.name.toUpperCase() !== "OWNER" && (x.link || x.email || x.name)) || (c.signatures || [])[0] || {};
    return { id: c.id, link: (sig.link && sig.link.short_link) || "" };
  }

  /** Lê o estado atual do documento (fallback para quando o webhook não estiver configurado). */
  async function consultarDocumento(id) {
    const query = `query Documento($id: UUID!) {
      document(id: $id) {
        id name
        files { original signed }
        signatures { public_id name email action { name } link { short_link }
          viewed { created_at } signed { created_at } rejected { created_at } }
      }
    }`;
    const d = await chamar(JSON.stringify({ query, variables: { id } }), { "Content-Type": "application/json" });
    const doc = d && d.document;
    if (!doc) throw Object.assign(new Error("Documento não encontrado no Autentique."), { codigo: "nao_encontrado" });
    const sigs = (doc.signatures || []).filter((x) => !(x.action && /owner/i.test(x.action.name || "")));
    const alvo = sigs.length ? sigs : doc.signatures || [];
    let estado = "enviado";
    if (alvo.some((x) => x.rejected)) estado = "recusado";
    else if (alvo.length && alvo.every((x) => x.signed)) estado = "assinado";
    else if (alvo.some((x) => x.viewed || x.signed)) estado = "visualizado";
    return { estado, arquivoAssinado: (doc.files && doc.files.signed) || "" };
  }

  return { criarDocumento, consultarDocumento, ativo: Boolean(token), sandbox };
}

/** Confere a assinatura HMAC do webhook (comparação em tempo constante). */
function verificarWebhook(corpoBruto, assinatura, segredo) {
  if (!segredo || !assinatura) return false;
  const esperado = crypto.createHmac("sha256", segredo).update(corpoBruto).digest("hex");
  const recebido = String(assinatura).trim().replace(/^sha256=/i, "").toLowerCase();
  if (recebido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
}

/** Traduz um evento do webhook para o estado da assinatura (null = evento sem efeito no estado). */
function estadoDoEvento(tipo) {
  return ({
    "signature.viewed": "visualizado",
    "signature.accepted": "assinado",
    "signature.rejected": "recusado",
    "signature.delivery_failed": "falha_envio",
    "document.finished": "assinado",
    "document.deleted": "cancelado",
  })[tipo] || null;
}

/** Encontra o ID do documento dentro do evento (o formato muda entre eventos de documento e de assinatura). */
function documentoDoEvento(evento) {
  const d = (evento && evento.data) || {};
  if (String(evento.type || "").startsWith("document.")) return d.id || null;
  return (d.document && (d.document.id || d.document)) || d.document_id || d.documentId || null;
}

module.exports = { criarCliente, verificarWebhook, estadoDoEvento, documentoDoEvento };
