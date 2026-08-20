// Envio de alertas pelo Telegram.
// As credenciais NUNCA ficam no codigo: vem de variaveis de ambiente
// (.env no PC, ou "Secrets" no GitHub).

// Lido na hora do uso (e nao na importacao): em ESM os imports rodam antes
// do .env ser carregado, entao ler aqui em cima pegaria valores vazios.
const token = () => process.env.TELEGRAM_TOKEN;
const chatId = () => process.env.TELEGRAM_CHAT_ID;

export function estaConfigurado() {
  return Boolean(token() && chatId());
}

function escapar(txt) {
  return String(txt).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function chamar(metodo, corpo) {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const json = await r.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram (${metodo}): ${json.description || r.status}`);
  return json.result;
}

/** Monta o texto do card. Separado do envio para dar pra pre-visualizar no modo teste. */
export function montarMensagem(anuncio, nomeBusca) {
  const idade =
    anuncio.idadeHoras == null ? '' :
    anuncio.idadeHoras < 1 ? '🔥 <b>agora há pouco</b>' :
    anuncio.idadeHoras < 24 ? `há ${Math.round(anuncio.idadeHoras)}h` :
    `há ${Math.round(anuncio.idadeHoras / 24)} dia(s)`;

  return [
    `🔎 <b>${escapar(nomeBusca)}</b>`,
    '',
    `<b>${escapar(anuncio.titulo)}</b>`,
    `💰 <b>${escapar(anuncio.precoTexto)}</b>`,
    `📍 ${escapar(anuncio.local)}${anuncio.profissional ? ' · <i>anunciante profissional</i>' : ''}`,
    idade ? `🕒 ${idade}` : null, // null = campo ausente; '' = linha em branco de proposito
    '',
    `<a href="${escapar(anuncio.url)}">Abrir anúncio na ${escapar(anuncio.fonte)}</a>`,
  ].filter((linha) => linha !== null).join('\n');
}

/** Monta e envia o card de um anuncio. */
export async function enviarAnuncio(anuncio, nomeBusca) {
  await chamar('sendMessage', {
    chat_id: chatId(),
    text: montarMensagem(anuncio, nomeBusca),
    parse_mode: 'HTML',
    link_preview_options: { url: anuncio.imagem || anuncio.url, prefer_large_media: true },
  });
}

/** Aviso simples de texto (erros, resumos). */
export async function enviarAviso(texto) {
  await chamar('sendMessage', { chat_id: chatId(), text: texto, parse_mode: 'HTML' });
}
