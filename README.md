# Site M&L Advocacia e Assessoria

Landing page institucional com funil de qualificação de contatos, painel administrativo e integrações, usando a identidade visual Leque da M&L (azul petróleo `#172A31`, dourado champanhe `#A59970`, branco).

## O que está incluído

| Parte | Onde |
|---|---|
| Página com as secções 01 a 09, cabeçalho, rodapé e WhatsApp flutuante | `public/index.html` |
| Estilos (mobile first, sem frameworks) | `public/assets/css/site.css` |
| Menu, botões de WhatsApp e serviços | `public/assets/js/app.js` |
| Funil em formato de conversa (chatbot) | `public/assets/js/chat.js` |
| Assinatura eletrônica (Autentique) | `autentique.js`, `modelos/` |
| Camada de movimento (rolagem suave, revelações, cabeçalho, transições) | `public/assets/js/motion.js` |
| Cenas guiadas pelo scroll (túnel 3D, galeria horizontal, texto que acende, parallax) | `public/assets/js/scroll.js` |
| Configuração pública (WhatsApp, e-mail, Instagram) | `public/assets/js/config.js` |
| Política de Privacidade (LGPD) | `public/politica-de-privacidade.html` |
| Servidor, API de leads, antispam, painel `/admin`, sitemap e robots | `server.js` |
| Testes automáticos | `tests/` |

### Funil de qualificação em formato de conversa (`public/assets/js/chat.js`)
- O formulário de captação é um **assistente virtual estilo chatbot**: faz uma pergunta de cada vez, com indicador de "digitando…", e a pessoa responde por botões de resposta rápida ou escrevendo.
- Começa sozinho quando a conversa aparece no ecrã. Barra de progresso no topo e botão "Recomeçar".
- Só aparecem as perguntas relevantes para cada situação. Por exemplo, "grávida" pede a previsão do parto, "pedido negado" pede a comunicação do INSS e "já solicitou: sim" pergunta o estado do pedido.
- Cada resposta tem um botão **Editar**: a conversa volta a esse ponto e refaz as perguntas seguintes, que podem mudar.
- Validação dentro da conversa (datas, nome completo, WhatsApp com máscara, e-mail opcional com "Pular"), opção "Não sei informar".
- Consentimento LGPD específico no último passo, que menciona os dados de gestação (dados sensíveis).
- Os cards de serviço, sem WhatsApp configurado, abrem a conversa já com o serviço escolhido.
- O envio usa exatamente o mesmo formato de `/api/leads` (validação, antispam, painel e webhook continuam iguais).
- Na conclusão, o botão "Continuar pelo WhatsApp" envia uma mensagem pré-preenchida só com nome, situação, interesse e cidade. Datas e respostas detalhadas não vão na mensagem.
- Acessível: a conversa é uma região `role="log"` com `aria-live`, botões com rótulos e animações reduzidas quando o sistema pede menos movimento.

### Segurança e LGPD
- Validação no servidor: lista fechada de respostas aceitas e campos não previstos descartados.
- Antispam: campo-isca, tempo mínimo de preenchimento e limite de 5 envios a cada 15 minutos por IP.
- O IP nunca é guardado em texto, só um código irreversível (HMAC).
- Cabeçalhos de segurança: CSP, HSTS (em produção), X-Frame-Options, Referrer-Policy e Permissions-Policy.
- Painel com senha, proteção contra força bruta, token CSRF nas ações e exclusão definitiva de um lead (direito de eliminação da LGPD).
- Nenhuma chave de API fica no frontend.


## Assinatura eletrônica (Autentique)

O painel `/admin` envia documentos para o cliente assinar on-line pelo [Autentique](https://www.autentique.com.br), com validade jurídica (Lei 14.063/2020).

**Como usar**
1. Em cada contato, abra "Enviar documento para assinatura".
2. Escolha um **modelo** (a procuração previdenciária já vem pronta e é preenchida com o nome e a cidade do cliente) ou **envie um arquivo** seu (PDF, DOC, DOCX ou TXT, até 5 MB), por exemplo o contrato de honorários.
3. Escolha como o cliente recebe: **WhatsApp**, **e-mail** ou **só gerar o link** (para você mandar pela conversa).
4. A coluna "Assinatura digital" mostra a situação: Enviado → Visualizado → Assinado (ou Recusado). Quando o cliente assina, o contato passa automaticamente para "Convertido" e aparece o link para baixar o PDF assinado.

**Configuração (.env)**
- `AUTENTIQUE_TOKEN`: chave da API (painel do Autentique → Chaves de API). Nunca vai para o navegador.
- `AUTENTIQUE_SANDBOX=1` (padrão): modo de teste. Os documentos não gastam créditos, são apagados em poucos dias e **não têm validade**. Mude para `0` quando estiver tudo certo.
- `AUTENTIQUE_WEBHOOK_SECRET`: cadastre no Autentique o webhook `https://SEU-DOMINIO/api/autentique/webhook` e copie o segredo para cá. O servidor confere a assinatura HMAC de cada aviso e ignora avisos repetidos. Sem webhook, use o botão "Atualizar situação".
- `MODELO_ADVOGADO_NOME`, `MODELO_ADVOGADO_OAB`, `MODELO_ESCRITORIO_ENDERECO`: dados do(a) advogado(a) usados nos modelos. O painel não envia um modelo se faltar algum destes dados.

**Modelos** ficam na pasta `modelos/` (HTML). Para criar outro, copie `procuracao-previdenciaria.html`, mude o `<title>` e o texto. Campos disponíveis: `{{nome}}`, `{{cidade}}`, `{{uf}}`, `{{data}}`, `{{advogado_nome}}`, `{{advogado_oab}}`, `{{escritorio_endereco}}`. **O texto do modelo de procuração deve ser revisto pelo(a) advogado(a) responsável antes do uso.**

**Custos** (tabela do Autentique): o plano gratuito permite 10 documentos por mês pela API; acima disso, cobra-se por documento e por envio (WhatsApp custa mais do que e-mail). Veja https://docs.autentique.com.br/api/api-pricing.

> A assinatura eletrônica precisa do servidor Node (`server.js`). Num site só estático (ex.: Netlify sem funções) o painel e o envio não funcionam.

## Movimento e interações (`motion.js`)

Inspirado no acabamento de portfólios premium, sem bibliotecas:
- **Rolagem suave com inércia** na roda do rato, no estilo do Lenis. No toque e no teclado a rolagem continua nativa.
- **Título principal** que surge palavra a palavra, saindo de um desfoque.
- **Títulos das secções** que sobem linha a linha por trás de uma máscara.
- **Textos e cards** em cascata. **Imagens e molduras** reveladas por "wipe" (de baixo para cima).
- **Botões** em que o texto rola para cima e uma cópia entra por baixo. **Setas** que deslizam no hover.
- **Cabeçalho** que se esconde ao descer e volta ao subir. **Barra de progresso** dourada no topo.
- **Menu** que marca a secção visível no momento.
- **Animações ligadas à rolagem**: o sol do símbolo nasce e as decorações se deslocam (em navegadores com suporte).
- **Botão de WhatsApp "magnético"** e **transição suave** entre páginas.

Com "reduzir movimento" ativado no sistema, nada é animado e todo o conteúdo aparece de imediato.

## Cenas de scroll (`scroll.js`), inspiradas no layout "Margem"

- **Túnel de fotografias no topo**: o scroll avança a "câmara" num túnel 3D de fotografias (grávidas, mães com bebês, famílias, advogadas, aposentados). O título fica no centro; no fim, uma fotografia sai do centro e abre até ocupar o ecrã.
- **Faixa** com os serviços, que acelera e inclina conforme a velocidade do scroll.
- **Galeria horizontal fixa** com as 4 etapas do atendimento, barra de progresso e parallax dentro de cada fotografia. No celular vira um carrossel com deslize.
- **Títulos que acendem** palavra a palavra durante a leitura.
- **Parallax** nas colagens de fotografias.
- **Lista de serviços** em que a linha se pinta de azul no hover e uma fotografia segue o cursor. No celular cada linha mostra uma miniatura.
- **Citação** sobre um campo de fotografias desfocadas a diferentes profundidades.

Tudo usa só `transform`, `opacity` e `clip-path`, num único ciclo de animação.

## Fotografias

- As fotografias vêm do [Unsplash](https://unsplash.com/license), cuja licença permite uso comercial gratuito, sem atribuição obrigatória. A lista está em `CREDITOS-FOTOS.md`.
- Estão ligadas diretamente aos servidores do Unsplash (`images.unsplash.com`), já no tamanho certo para cada lugar.
- **Recomendação para produção**: substituir pelas fotografias reais do escritório e das clientes (com autorização), ou baixar as do Unsplash para `public/assets/img/`. Para trocar uma foto, basta mudar o endereço no `index.html`.

## Tecnologia (e por que não Next.js)

O briefing sugeria React/Next.js com Tailwind. Optei por **HTML, CSS e JavaScript puros no frontend e Node.js sem dependências no backend**, com o banco SQLite nativo do Node (`node:sqlite`):

- **Zero dependências:** nada para instalar ou atualizar e menos superfície de ataque.
- **Desempenho:** a página não carrega nenhum framework de JavaScript, o que ajuda nas métricas do Core Web Vitals.
- **Hospedagem:** funciona em qualquer serviço que rode Node 22.
- **Testes:** o ambiente onde o site foi construído não permitia instalar pacotes. Com esta stack consegui testar tudo de ponta a ponta.

Os componentes estão organizados por secção. Se quiserem migrar para Next.js mais tarde, o HTML e o CSS passam quase diretamente para componentes.

## Como rodar

Requisito: **Node.js 22.13 ou superior** (verifique com `node -v`).

```bash
cp .env.example .env      # e preencha (veja abaixo)
npm start                 # http://localhost:3000
npm test                  # 23 testes da API, do painel e de segurança
```

Não há `npm install`, porque não há dependências.

## Antes de publicar: o que preencher

1. **`public/assets/js/config.js`**: o WhatsApp já está configurado (`5511972732213`, +55 11 97273-2213). Falta o e-mail e o Instagram.
   - Se trocar o número, atualize também os links fixos da secção de localização, do rodapé e o `telephone` dos dados estruturados no `index.html`.
2. **`.env`** (copie de `.env.example`):
   - `SITE_URL`: o domínio final.
   - `ADMIN_PASSWORD`: senha do painel, com 12 ou mais caracteres.
   - `IP_SALT`: texto aleatório, por exemplo gerado com `openssl rand -hex 32`.
   - `TRUST_PROXY=1`, se o site estiver atrás de proxy ou CDN.
3. **Fotografias**: o site já tem fotografias de banco livre (veja "Fotografias"). Se possível, substitua-as por fotos reais do escritório.
4. **Textos marcados `[ … ]`** (com fundo dourado claro):
   - no rodapé do `index.html`: responsável técnica e número da OAB. O Código de Ética da OAB exige estes dados na publicidade.
   - na `politica-de-privacidade.html`: CNPJ, encarregado de dados (DPO) e prazo de retenção.

   Não inventei nenhum destes dados.
5. **Serviços**: apague os cards da secção 07 que o escritório não oferece.
6. **Revisão jurídica**: as respostas do FAQ foram verificadas com as regras em vigor em novembro de 2026, mas devem ser revistas pela advogada responsável antes de publicar. Vale confirmar também, à luz do Provimento 205/2021 da OAB, o uso do termo "especialista" no botão do topo.

## Integrações (opcionais, por variáveis no `.env`)

- **CRM e automação (`CRM_WEBHOOK_URL`)**: cada novo lead é enviado em JSON para n8n, Make, Zapier, RD Station ou similar.
  - Com `CRM_WEBHOOK_SECRET`, o pedido leva o cabeçalho `X-ML-Assinatura: sha256=<HMAC do corpo>`, para conferir que veio do site.
- **Aviso por e-mail (`RESEND_API_KEY`, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM`)**: um e-mail para o escritório a cada novo contato, via [Resend](https://resend.com). O domínio do remetente precisa estar verificado lá.
- **WhatsApp Business**: a integração é feita pelo link oficial `wa.me`, com a mensagem pré-preenchida. Para respostas automáticas (API oficial da Meta), use o webhook acima para ligar a uma plataforma de atendimento.

Se uma integração falhar, o lead continua guardado no banco e o erro fica registrado no log do servidor.

## Painel administrativo

Acesse `https://seudominio/admin` com o usuário e a senha do `.env`. Lá você pode:
- ver os contatos com as respostas e a origem;
- filtrar e mudar o estado (novo, em contato, convertido, descartado);
- excluir um contato;
- exportar CSV (abre no Excel).

## Hospedagem

O site precisa de um servidor Node com **disco persistente** para o arquivo `data/leads.db`. Por isso, uma hospedagem só de arquivos estáticos, como o Netlify, não serve. Opções:
- **Render ou Railway**: crie um Web Service com o comando `npm start` e adicione um disco persistente montado em `/data`, com `DATA_DIR=/data`.
- **VPS (Hostinger, DigitalOcean, Contabo)**: Node 22, `npm start` com PM2 ou systemd, e Nginx com HTTPS (Let's Encrypt).

Faça backup do `leads.db` com regularidade.

## SEO

Já estão implementados:
- meta title e description, URL canônica e Open Graph (imagem 1200 × 630);
- dados estruturados `LegalService`;
- `sitemap.xml` e `robots.txt` (o painel e a API ficam fora do Google);
- HTML semântico e imagens com dimensões e lazy loading.

Depois de publicar:
1. Cadastre o domínio no Google Search Console e envie o sitemap.
2. Crie ou atualize o Perfil da Empresa no Google com o mesmo endereço.

## Testes

- `npm test` testa a API, o antispam, o painel, o CSRF, o CSV, a exclusão, o SEO e a segurança de caminhos.
- `tests/e2e.js` testa a conversa do funil no navegador (requer Playwright): lógica condicional, validações, envio, WhatsApp, menu mobile, rolagem horizontal, tamanho dos alvos de toque as animações e as cenas de scroll (36 verificações).

  ```bash
  npx playwright install chromium && node tests/e2e.js
  ```

## Acessibilidade

- Navegação por teclado e link "Ir para o conteúdo".
- Foco visível e mensagens de erro anunciadas por leitores de tela.
- Contraste conforme a WCAG AA: o dourado nunca é usado como cor de texto sobre fundo branco.
- Respeito à preferência de movimento reduzido e alvos de toque com 44 px ou mais.

## Observação sobre fontes

As fontes Playfair Display e Montserrat vêm do Google Fonts. Para tirar essa dependência externa (desempenho e privacidade), pode hospedá-las localmente em `public/assets/fonts/` e ajustar o `<link>` e a CSP no `server.js`.
