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
// NOTE: KeyCRM's exact webhook JSON shape can vary slightly by event/version.
// This pulls known field names defensively and falls back gracefully.
// If your test webhook payload uses different field names, adjust the
// `extractCard` function below to match — the raw payload is always logged.

function extractCard(body) {
  // KeyCRM commonly wraps the card under `card`, `data`, or sends it flat.
  const card = body.card || body.data || body;

  return {
    id: card.id ?? card.card_id ?? null,
    title: card.title ?? card.name ?? '(без названия)',
    pipelineId: card.pipeline_id ?? card.pipeline?.id ?? card.funnel_id ?? null,
    pipelineName: card.pipeline?.name ?? card.pipeline_name ?? null,
    statusName: card.status?.name ?? card.status_name ?? null,
    managerName: card.manager?.name ?? card.assigned_to?.name ?? null,
    contactName: card.contact?.full_name ?? card.client?.full_name ?? card.contact_name ?? null,
    contactPhone: card.contact?.phone ?? card.client?.phone ?? card.phone ?? null,
    value: card.value ?? card.amount ?? null,
    source: card.source?.name ?? card.source_name ?? null,
    comment: card.comment ?? card.note ?? card.description ?? null,
    url: card.id ? `https://app.keycrm.app/pipelines/card/${card.id}` : null,
  };
}

function formatMessage(card, event) {
  const lines = [
    `🆕 <b>Новая карточка в KeyCRM</b>`,
    card.pipelineName ? `Воронка: ${escapeHtml(card.pipelineName)}` : null,
    `Название: ${escapeHtml(card.title)}`,
    card.contactName ? `Клиент: ${escapeHtml(card.contactName)}` : null,
    card.contactPhone ? `Телефон: ${escapeHtml(card.contactPhone)}` : null,
    card.value ? `Сумма: ${escapeHtml(card.value)}` : null,
    card.source ? `Источник: ${escapeHtml(card.source)}` : null,
    card.managerName ? `Менеджер: ${escapeHtml(card.managerName)}` : null,
    card.comment ? `Комментарий: ${escapeHtml(card.comment)}` : null,
    card.url ? `<a href="${card.url}">Открыть карточку</a>` : null,
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

  const event = body.event || body.type || 'unknown';

  // Only react to card-created events. KeyCRM's event name for this has
  // varied across versions/docs — accept a few likely spellings.
  const isCardCreated = /card.*creat|creat.*card|pipeline_card\.created/i.test(event);
  if (!isCardCreated) {
    return res.status(200).send('ignored: not a card-created event');
  }

  const card = extractCard(body);

  if (PIPELINE_ID && String(card.pipelineId) !== String(PIPELINE_ID)) {
    console.log(`Ignored card ${card.id}: pipeline ${card.pipelineId} != watched ${PIPELINE_ID}`);
    return res.status(200).send('ignored: different pipeline');
  }

  const message = formatMessage(card, event);
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
