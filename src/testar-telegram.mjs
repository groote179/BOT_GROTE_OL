// Teste rapido do Telegram: envia UMA mensagem de exemplo.
// Nao toca na OLX e nao mexe na memoria do robo.
//
//   npm run testar-telegram

try { process.loadEnvFile('.env'); } catch { /* sem .env: os avisos abaixo explicam */ }

const { estaConfigurado, enviarAnuncio } = await import('./notificacao/telegram.mjs');

if (!estaConfigurado()) {
  console.error('\n❌ Faltam as credenciais.\n');
  console.error('   1. Copie o arquivo ".env.example" para ".env"');
  console.error('   2. Preencha TELEGRAM_TOKEN (do @BotFather) e TELEGRAM_CHAT_ID (do @userinfobot)');
  console.error('   3. Rode de novo\n');
  process.exit(1);
}

const exemplo = {
  titulo: 'TAG Heuer Formula 1 — anúncio de TESTE',
  precoTexto: 'R$ 4.300',
  local: 'Curitiba - PR',
  url: 'https://www.olx.com.br/brasil?ps=1500&pe=7000&q=tag+heuer',
  imagem: null,
  idadeHoras: 0.2,
  profissional: false,
  fonte: 'OLX',
};

try {
  await enviarAnuncio(exemplo, 'Teste de configuração');
  console.log('\n✅ Mensagem enviada. Confira o Telegram.');
  console.log('   Se chegou, pode subir pro GitHub com segurança.\n');
} catch (erro) {
  console.error('\n❌ Não deu certo:', erro.message, '\n');
  if (/not found|unauthorized|401/i.test(erro.message)) {
    console.error('   → O TOKEN parece errado. Confira com o @BotFather.\n');
  } else if (/chat not found|400/i.test(erro.message)) {
    console.error('   → O CHAT_ID parece errado, OU você ainda não falou com o seu bot.');
    console.error('     Abra a conversa do bot no Telegram e mande um "oi" primeiro:');
    console.error('     o Telegram não deixa um bot iniciar conversa com você.\n');
  }
  process.exit(1);
}
