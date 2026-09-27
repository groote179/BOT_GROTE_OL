# Robô OLX

Vigia buscas específicas na OLX e avisa no Telegram quando aparece anúncio novo.
Roda de graça no GitHub Actions, a cada 20 minutos, sem precisar deixar o PC ligado.

## Como funciona

1. Abre cada busca do `config.json` ordenada pelos **mais recentes**.
2. Lê os 50 anúncios da página (título, preço, cidade, link, idade do anúncio).
3. Descarta o que já foi visto antes e o que não passa nos seus filtros.
4. Manda o que sobrou no Telegram.

O arquivo `dados/vistos.json` é a memória do robô — é ele que impede você de
receber o mesmo anúncio duas vezes.

## Comandos

```bash
npm run teste
```
Roda sem enviar nada e sem gravar nada. Use para ajustar filtros à vontade.

```bash
npm run testar-telegram
```
Envia uma mensagem de exemplo para conferir se o bot do Telegram está certo.
Não consulta a OLX e não mexe na memória.

```bash
npm start
```
Roda de verdade: envia no Telegram e grava a memória.

> Na **primeira execução** o robô só registra os anúncios que já existem, sem alertar —
> senão você receberia 50 mensagens de uma vez. Da segunda em diante, só novidade.
> Para forçar o alerta já na primeira: `node src/index.mjs --avisar-tudo`.

## Configuração das buscas (`config.json`)

Faça a busca no site da OLX, ajuste os filtros lá mesmo (preço, região, categoria)
e **cole a URL da barra de endereços**:

```json
{
  "nome": "TAG Heuer R$ 1.500-7.000",
  "fonte": "olx",
  "url": "https://www.olx.com.br/brasil?ps=1500&pe=7000&q=tag+heuer",
  "excluirPalavras": ["replica", "pulseira", "sucata"],
  "exigirPalavras": ["tag", "heuer", "hauer"],
  "paginas": 1
}
```

| Campo | Para que serve |
|---|---|
| `url` | A busca copiada da OLX. O robô já força a ordenação por mais recentes. |
| `excluirPalavras` | Se o título tiver **qualquer** uma delas, o anúncio é descartado. |
| `exigirPalavras` | O título precisa ter **pelo menos uma**. Deixe `[]` para aceitar tudo. |
| `paginas` | Quantas páginas ler (50 anúncios cada). `1` basta para monitoramento. |

As palavras casam **inteiras e sem acento**: `"tag"` acha `TAG Heuer` e `Tag`,
mas não acha `vantagem`; `"replica"` acha `RÉPLICA`.

Em `opcoes`:

| Campo | Para que serve |
|---|---|
| `idadeMaximaHoras` | Ignora anúncio mais velho que isso (`72` = 3 dias). |
| `maxAlertasPorRodada` | Teto de mensagens por rodada, para não inundar o Telegram. |

## Instalação

### 1. Criar o bot do Telegram

1. No Telegram, fale com **@BotFather** → `/newbot` → escolha um nome.
   Ele devolve um **token** (algo como `8123456789:AAF...`).
2. Envie qualquer mensagem para o **seu** bot recém-criado.
3. Fale com **@userinfobot** → ele responde o seu **Chat ID** (um número).

### 2. Rodar no PC (para testar)

```bash
npm install
npx playwright install chromium
```

Copie `.env.example` para `.env` e preencha o token e o chat ID.
O `.env` está no `.gitignore` — ele nunca vai para o GitHub.

```bash
npm run teste
```

### 3. Hospedar de graça no GitHub

1. Crie um repositório **público** em github.com (público = minutos ilimitados
   no Actions; privado só dá 2.000 min/mês, e o robô usa mais que isso).
   As suas buscas ficam visíveis, mas o token **não** — ele vai em "Secrets".
2. Suba a pasta do projeto.
3. No repositório: **Settings → Secrets and variables → Actions → New repository secret**.
   Crie dois:
   - `TELEGRAM_TOKEN`
   - `TELEGRAM_CHAT_ID`
4. Em **Settings → Actions → General → Workflow permissions**, marque
   **Read and write permissions** (o robô precisa gravar a memória de volta).
5. Na aba **Actions**, abra "Robô OLX" e clique em **Run workflow** para testar.

Depois disso ele roda sozinho a cada 20 minutos.

## Observações

- **O agendador do GitHub atrasa às vezes.** Em horário de pico uma rodada pode
  sair 5–10 minutos depois. Como o robô lembra o que já viu, atraso não faz
  perder anúncio — só chega um pouco mais tarde.
- **A OLX bloqueia acesso automatizado comum.** Testado: `curl` e `fetch` do Node
  levam HTTP 403 (Cloudflare). Por isso o robô usa Chromium de verdade, com o
  User-Agent ajustado. Se um dia voltar a dar 403, é esse ponto que precisa de
  ajuste — veja `src/navegador.mjs`.
- A OLX mistura anúncios não relacionados no resultado ("veja também").
  É para isso que serve o `exigirPalavras`.

## Estrutura

```
config.json              suas buscas
src/index.mjs            orquestra tudo
src/navegador.mjs        Chromium ajustado para não ser bloqueado
src/fontes/olx.mjs       lê e padroniza os anúncios da OLX
src/notificacao/telegram.mjs
src/estado.mjs           memória do que já foi visto
dados/vistos.json        a memória em si
.github/workflows/robo.yml
```

Para acrescentar o **Enjoei** depois: basta criar `src/fontes/enjoei.mjs`
exportando a mesma função `buscar()` e registrá-lo em `FONTES` no `index.mjs`.
Todo o resto (filtros, memória, Telegram) já funciona para qualquer fonte.
