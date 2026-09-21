require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '1mb' }));

const {
  PORT = 3000,
  TELEGRAM_BOT_TOKEN,       // token from @BotFather for @zevs_Bid_bot
  TELEGRAM_CHAT_ID,         // group chat_id notifications go to, e.g. -1005593387996
  PIPELINE_ID,              // KeyCRM pipeline (воронка) id to watch. Leave empty to watch all pipelines
  WEBHOOK_SECRET,           // optional: shared secret KeyCRM must send as ?secret=... in the webhook URL
} = process.env;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in environment');
  process.exit(1);
}
if (!TELEGRAM_CHAT_ID) {
  console.error('Missing TELEGRAM_CHAT_ID in environment');
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// source_id -> человекочитаемое название источника (из KeyCRM)
const SOURCE_NAMES = {
  1: 'Тік ток',
  2: 'OLX',
  3: 'Рекомендация',
  4: 'Вх звонок',
  5: 'Сайт Sindtex',
  6: 'Prom.ua',
  7: 'Telegram',
  8: 'Instagram',
  9: 'Facebook',
  10: 'Viber',
  11: 'Вх звонок OLX',
  12: 'Вх звонок PROM',
  13: 'Вх звонок TIKTOK',
  14: 'Вх звонок INSTA',
  15: 'TG leopard3',
  16: 'TG sealion05',
  17: 'TG sealion06',
  18: 'TG sealion07ev',
  19: 'TG songl',
  20: 'TG ADS',
};

// ---- Telegram helper -------------------------------------------------

async function sendTelegramMessage(text) {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error('Telegram sendMessage failed:', data);
  }
  return data;
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---- KeyCRM payload parsing --------------------------------------------
// Real shape confirmed from KeyCRM docs (help.keycrm.app): triggers fire via
// "Тригерна автоматизація" and the "Відправити Webhook" action. The card
// event is always:
//   { "event": "lead.change_lead_status", "context": { ...card fields } }
// Since the trigger itself is configured in KeyCRM to fire only on
// "Картка створена у воронці" (see README), every request that reaches this
// endpoint already represents a card creation for the pipeline you picked
// there — no need to guess from the payload.
//
// context does NOT include contact name/phone directly, only contact_id.
// To show a name/phone you'd need an extra KeyCRM API call to
// GET /contacts/{contact_id} with your KeyCRM API key — not wired up yet,
// ask if you want that added.

function extractCard(body) {
  const card = body.context || body;

  return {
    id: card.id ?? null,
    title: card.title ?? '(без назви)',
    pipelineId: card.pipeline_id ?? null,
    contactId: card.contact_id ?? null,
    managerId: card.manager_id ?? null,
    sourceId: card.source_id ?? null,
    statusId: card.status_id ?? null,
    comment: card.manager_comment || null,
    utmSource: card.utm_source || null,
    utmCampaign: card.utm_campaign || null,
    paymentsTotal: card.payments_total ?? null,
    productsTotal: card.products_total ?? null,
    createdAt: card.created_at ?? null,
    url: card.id ? `https://app.keycrm.app/pipelines/card/${card.id}` : null,
  };
}

function formatMessage(card) {
  const lines = [
    `🆕 <b>Нова картка в KeyCRM</b>`,
    `Назва: ${escapeHtml(card.title)}`,
    card.contactId ? `Контакт ID: ${escapeHtml(card.contactId)}` : null,
    card.managerId ? `Менеджер ID: ${escapeHtml(card.managerId)}` : null,
    card.sourceId ? `Джерело: ${escapeHtml(SOURCE_NAMES[card.sourceId] || `невідоме (id ${card.sourceId})`)}` : null,
    card.productsTotal ? `Сума товарів: ${escapeHtml(card.productsTotal)}` : null,
    card.comment ? `Коментар: ${escapeHtml(card.comment)}` : null,
    card.utmSource ? `UTM source: ${escapeHtml(card.utmSource)}` : null,
    card.url ? `<a href="${card.url}">Відкрити картку</a>` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

// ---- Routes -----------------------------------------------------------

app.get('/', (req, res) => {
  res.send('zeus-crm-notify-bot is running');
});

// KeyCRM should be configured to POST here, e.g.:
// https://<your-railway-domain>/webhook/keycrm?secret=YOUR_SECRET
app.post('/webhook/keycrm', async (req, res) => {
  // Optional shared-secret check so randoms can't spam your Telegram group
  if (WEBHOOK_SECRET && req.query.secret !== WEBHOOK_SECRET) {
    console.warn('Rejected webhook: bad or missing secret');
    return res.status(401).send('unauthorized');
  }

  const body = req.body || {};
  console.log('Incoming KeyCRM webhook:', JSON.stringify(body));

  const event = body.event || 'unknown';

  // KeyCRM sends "lead.change_lead_status" for pipeline cards. The trigger
  // on the KeyCRM side is configured to fire only on card creation for the
  // watched pipeline (see README) — this check is just a sanity filter in
  // case the endpoint ever receives something unrelated.
  if (event !== 'lead.change_lead_status') {
    return res.status(200).send('ignored: unexpected event type');
  }

  const card = extractCard(body);

  // Extra safety net: also filter by pipeline here, in case the KeyCRM
  // trigger condition ever gets edited to include other pipelines.
  if (PIPELINE_ID && String(card.pipelineId) !== String(PIPELINE_ID)) {
    console.log(`Ignored card ${card.id}: pipeline ${card.pipelineId} != watched ${PIPELINE_ID}`);
    return res.status(200).send('ignored: different pipeline');
  }

  const message = formatMessage(card);
  await sendTelegramMessage(message);

  res.status(200).send('ok');
});

// Manual test route: GET /test-notify?key=ADMIN_KEY — sends a sample
// message so you can confirm the bot token + chat_id are wired correctly
// before hooking up real KeyCRM webhooks.
app.get('/test-notify', async (req, res) => {
  if (process.env.ADMIN_KEY && req.query.key !== process.env.ADMIN_KEY) {
    return res.status(401).send('unauthorized');
  }
  await sendTelegramMessage('✅ Тестовое уведомление от zeus-crm-notify-bot');
  res.send('sent');
});

app.listen(PORT, () => {
  console.log(`zeus-crm-notify-bot listening on port ${PORT}`);
});
