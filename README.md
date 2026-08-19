# zeus-crm-notify-bot

Слушает вебхуки KeyCRM о новых карточках в выбранной воронке и пересылает уведомление в Telegram-группу.

## Как это работает

1. KeyCRM при создании карточки в отслеживаемой воронке отправляет POST-запрос на `/webhook/keycrm`.
2. Бот проверяет, что событие — создание карточки, и что карточка из нужной воронки (`PIPELINE_ID`).
3. Если подходит — форматирует сообщение и отправляет его в Telegram-группу через Bot API.

## 1. Загрузка на GitHub

В этой песочнице нет доступа в интернет, поэтому запушить репозиторий отсюда напрямую нельзя. Сделай это у себя:

```bash
cd zeus-crm-notify-bot
git init
git add .
git commit -m "Initial commit: KeyCRM -> Telegram notify bot"
git branch -M main
git remote add origin https://github.com/<твой-аккаунт>/zeus-crm-notify-bot.git
git push -u origin main
```

(Создай пустой репозиторий на github.com заранее, без README/gitignore, чтобы не было конфликтов.)

## 2. Переменные окружения

Скопируй `.env.example` в `.env` и заполни:

- `TELEGRAM_BOT_TOKEN` — токен от @BotFather (для @zevs_Bid_bot)
- `TELEGRAM_CHAT_ID` — chat_id группы (см. ниже, как узнать точно)
- `PIPELINE_ID` — ID воронки KeyCRM, за которой следим
- `WEBHOOK_SECRET` — любая строка-пароль, чтобы вебхук не мог вызвать кто попало
- `ADMIN_KEY` — пароль для тестового роута `/test-notify`

### Как точно узнать TELEGRAM_CHAT_ID

1. Добавь бота в группу как администратора.
2. Напиши в группе любое сообщение.
3. Открой в браузере: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. В ответе найди `"chat":{"id": ...}` — это и есть `TELEGRAM_CHAT_ID`.

## 3. Деплой на Railway

1. New Project → Deploy from GitHub repo → выбери `zeus-crm-notify-bot`.
2. Railway сам определит Node.js и запустит `npm start`.
3. В Settings → Variables добавь те же переменные, что в `.env.example`.
4. В Settings → Networking сгенерируй публичный домен (Generate Domain) — понадобится для вебхука.

## 4. Проверка, что бот жив

Открой `https://<твой-домен>.up.railway.app/test-notify?key=<ADMIN_KEY>` — в группу должно прийти тестовое сообщение "✅ Тестовое уведомление".

## 5. Настройка вебхука в KeyCRM

В KeyCRM нет отдельного раздела "Webhooks" — вебхук настраивается через **Автоматизацію (тригери) для воронок**:

1. Налаштування → Автоматизація процесів → розділ автоматизації для воронок
2. «Додати тригер» → умова спрацювання: воронка = та, что в `PIPELINE_ID`, подія = «Картка створена у воронці»
3. Дія: «Відправити Webhook»
4. URL: `https://<твой-домен>.up.railway.app/webhook/keycrm?secret=<WEBHOOK_SECRET>`, метод: **POST**
5. Зберегти тригер

KeyCRM всегда шлёт JSON вида:
```json
{
  "event": "lead.change_lead_status",
  "context": { "id": ..., "title": ..., "pipeline_id": ..., "contact_id": ..., "manager_id": ..., "source_id": ..., ... }
}
```
Бот уже настроен под этот формат. **Важно:** в самом вебхуке нет имени/телефона клиента — только `contact_id`. Если нужно, чтобы в уведомлении было имя и телефон, надо добавить дополнительный запрос к KeyCRM API (`GET /contacts/{contact_id}`) с твоим API-ключом KeyCRM — скажи, если это нужно, допишу.

После первого реального вебхука посмотри логи Railway — там будет весь JSON от KeyCRM, можно свериться, что всё совпадает.

## Локальный запуск

```bash
npm install
cp .env.example .env   # и заполнить
npm start
```
