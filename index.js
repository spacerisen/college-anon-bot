const TelegramBot = require('node-telegram-bot-api');

// ─── Config ───────────────────────────────────────────────────────────────────
const TOKEN = process.env.BOT_TOKEN || '8715025357:AAHf-rl0IQU1cdopa9cmVbo_ELgihATDwBw';
const bot   = new TelegramBot(TOKEN, { polling: true });

// ─── State ────────────────────────────────────────────────────────────────────
const waitingQueue = [];       // user IDs waiting for a match
const activePairs  = new Map(); // userId ↔ userId
const userState    = new Map(); // userId → 'idle' | 'waiting' | 'chatting'
const userStats    = new Map(); // userId → { chats, messages }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const getState   = (id) => userState.get(id) || 'idle';
const getPartner = (id) => activePairs.get(id);
const getStats   = (id) => userStats.get(id) || { chats: 0, messages: 0 };

function removeFromQueue(id) {
  const i = waitingQueue.indexOf(id);
  if (i !== -1) waitingQueue.splice(i, 1);
}

function pairUsers(id1, id2) {
  activePairs.set(id1, id2);
  activePairs.set(id2, id1);
  userState.set(id1, 'chatting');
  userState.set(id2, 'chatting');
  const s1 = getStats(id1); s1.chats++; userStats.set(id1, s1);
  const s2 = getStats(id2); s2.chats++; userStats.set(id2, s2);
}

function unpairUser(id) {
  const partner = activePairs.get(id);
  if (partner) {
    activePairs.delete(partner);
    userState.set(partner, 'idle');
  }
  activePairs.delete(id);
  userState.set(id, 'idle');
  return partner;
}

const send = (id, text, opts = {}) =>
  bot.sendMessage(id, text, { parse_mode: 'Markdown', ...opts });

async function tryMatch(id) {
  if (waitingQueue.length > 0) {
    const partner = waitingQueue.shift();
    pairUsers(id, partner);
    const msg = '🎉 *Connected!* Say hi to your anonymous stranger 👋\n\n_/next → new stranger  |  /stop → end chat_';
    await send(id, msg);
    await send(partner, msg);
  } else {
    waitingQueue.push(id);
    userState.set(id, 'waiting');
    await send(id, '⏳ *Searching for a stranger...*\nYou\'ll be connected as soon as someone joins.\n\n_/stop to cancel_');
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const id    = msg.chat.id;
  const state = getState(id);

  if (state === 'chatting') return send(id, '⚠️ You\'re already in a chat!\nType /next to find someone new or /stop to end.');
  if (state === 'waiting')  return send(id, '⏳ Still searching... hang tight!\nType /stop to cancel.');

  await send(id,
    '👋 *Welcome to Anonymous College Chat!*\n\n' +
    'Connect with a random stranger from your college — completely anonymous.\n\n' +
    '*Commands:*\n' +
    '/start → Find a stranger\n' +
    '/stop  → End current chat\n' +
    '/next  → Skip to someone new\n' +
    '/stats → Your statistics\n' +
    '/help  → Show this menu\n\n' +
    'Searching for someone now...'
  );
  await tryMatch(id);
});

bot.onText(/\/stop/, async (msg) => {
  const id    = msg.chat.id;
  const state = getState(id);

  if (state === 'idle') return send(id, '💬 You\'re not in a chat.\nType /start to find a stranger!');

  if (state === 'waiting') {
    removeFromQueue(id);
    userState.set(id, 'idle');
    return send(id, '❌ Search cancelled. Type /start whenever you\'re ready!');
  }

  const partner = unpairUser(id);
  const stats   = getStats(id);
  await send(id, `👋 *Chat ended.*\nYou sent *${stats.messages}* message(s) this session.\n\nType /start to find a new stranger!`);
  if (partner) await send(partner, '👋 *Stranger has left the chat.*\nType /start to find someone new!');
});

bot.onText(/\/next/, async (msg) => {
  const id    = msg.chat.id;
  const state = getState(id);

  if (state === 'chatting') {
    const partner = unpairUser(id);
    if (partner) await send(partner, '👋 *Stranger skipped you.*\nType /start to find someone new!');
  } else if (state === 'waiting') {
    removeFromQueue(id);
    userState.set(id, 'idle');
  } else {
    // Idle — just find a stranger
  }
  await send(id, '⏭ Finding you a new stranger...');
  await tryMatch(id);
});

bot.onText(/\/stats/, async (msg) => {
  const id = msg.chat.id;
  const s  = getStats(id);
  await send(id,
    `📊 *Your Stats*\n\n` +
    `🗣 Strangers chatted: *${s.chats}*\n` +
    `💬 Messages sent: *${s.messages}*\n\n` +
    `👥 People waiting right now: *${waitingQueue.length}*\n` +
    `🔗 Active pairs: *${activePairs.size / 2}*`
  );
});

bot.onText(/\/help/, async (msg) => {
  await send(msg.chat.id,
    '🤖 *Anonymous Chat Commands*\n\n' +
    '/start → Find a random stranger\n' +
    '/stop  → End your current chat\n' +
    '/next  → Skip & find someone new\n' +
    '/stats → Your chat statistics\n' +
    '/help  → Show this menu\n\n' +
    '💡 *Tips:*\n' +
    '• Photos, stickers & voice notes work too!\n' +
    '• Stay respectful — be kind to strangers 🙏'
  );
});

// ─── Message Forwarding ───────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  const id      = msg.chat.id;
  const state   = getState(id);
  const text    = msg.text || '';
  const isCmd   = text.startsWith('/');

  // Skip commands — handled above
  if (isCmd) return;

  if (state !== 'chatting') {
    if (state === 'idle') {
      await send(id, '💬 Type /start to find a stranger first!');
    }
    return;
  }

  const partner = getPartner(id);
  if (!partner) {
    userState.set(id, 'idle');
    activePairs.delete(id);
    return send(id, '👋 *Stranger has left.*\nType /start to find someone new!');
  }

  // Track sent messages
  const s = getStats(id); s.messages++; userStats.set(id, s);

  try {
    // Forward based on message type — everything Telegram supports
    if (msg.text)       await bot.sendMessage(partner, msg.text);
    else if (msg.sticker)    await bot.sendSticker(partner, msg.sticker.file_id);
    else if (msg.photo)      await bot.sendPhoto(partner, msg.photo.at(-1).file_id, { caption: msg.caption || '' });
    else if (msg.voice)      await bot.sendVoice(partner, msg.voice.file_id);
    else if (msg.video)      await bot.sendVideo(partner, msg.video.file_id, { caption: msg.caption || '' });
    else if (msg.video_note) await bot.sendVideoNote(partner, msg.video_note.file_id);
    else if (msg.audio)      await bot.sendAudio(partner, msg.audio.file_id, { caption: msg.caption || '' });
    else if (msg.document)   await bot.sendDocument(partner, msg.document.file_id, { caption: msg.caption || '' });
    else if (msg.animation)  await bot.sendAnimation(partner, msg.animation.file_id, { caption: msg.caption || '' });
    else await send(id, '⚠️ This message type can\'t be forwarded.');
  } catch (err) {
    console.error('Forward error:', err.message);
  }
});

// ─── Error handling ───────────────────────────────────────────────────────────
bot.on('polling_error', (err) => console.error('Polling error:', err.message));

const ADMIN_ID = 5343418779; // replace this

bot.onText(/\/admin/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return; // only you can use this
  
  await send(msg.chat.id,
    `📊 *Live Stats*\n\n` +
    `👥 Waiting: *${waitingQueue.length}* people\n` +
    `🔗 Active pairs: *${activePairs.size / 2}*\n` +
    `👤 Total users seen: *${userStats.size}*`
  );
});

console.log('🤖 Anonymous College Chat Bot is running...');
