# 🚀 Teleport PRO — пошаговый запуск и публикация

## 0. Что это
Полноценный мессенджер: фронтенд (PWA) + бэкенд (Node.js, REST+WebSocket) + база данных.
Регистрация/вход: **почта** (рабочая, с подтверждением кодом из письма), **телефон** (через SMS-шлюз или EMAIL_MODE), VK/Яндекс — позже.

## 1. Локальный запуск (5 минут)
```bash
git clone https://github.com/<логин>/<репо>.git && cd <репо>/messenger-app
npm install --omit=dev        # ставит только 'ws'
node server.js                # → http://localhost:8080
```
Откройте две вкладки (или телефон в той же Wi-Fi сети: http://IP-компьютера:8080) — регистрируйтесь под двумя аккаунтами и переписывайтесь вживую. Бада — файл `data/teleport-db.json` (или SQLite при `npm i better-sqlite3`).

⚠️ Без SMTP регистрация по почте работает сразу (код не требуется). Как только зададите SMTP в `.env` — код из письма станет обязательным (боевой режим).

## 2. Рабочая почта для кодов (что нажать)
1. Заведите отдельный ящик, напр. `teleport-noreply@yandex.ru`.
2. Яндекс Почта: Настройки → «Пароли приложений» → создать пароль для «Другое». Mail.ru: «Пароли приложений» в настройках. Gmail: 2FA → App Passwords.
3. `cp .env.example .env` и заполните SMTP_HOST/SMTP_USER/SMTP_PASS (+EMAIL_MODE=1 если хотите вход по телефону через e-mail без SMS).
4. Перезапустите сервер. Готово: письма с кодами идут сами.

## 3. Вход по номеру телефона (SMS)
Нужен SMS-шлюз (выберите один):
- **СМС-Точка (smsc.ru)**: регистрация → пополнить баланс (~300₽ хватит на тесты) → в профиле включить API, задать логин/пароль → в `.env`: `SMS_PROVIDER=smscru`, `SMSCRU_LOGIN`, `SMSCRU_PASSWORD`.
- **Cellhippus**: токен из кабинета → `SMS_PROVIDER=cellhippus`, `CELLHIPPUS_TOKEN=...`.
Без шлюза телефон-вход корректно блокируется подсказкой (демо-кодов нет).

## 4. Публикация в интернет
### Вариант A — VPS в РФ (рекомендую для RuStore/друзей в РФ): ~300–600 ₽/мес
1. Купите VPS (Selectel, Timeweb Cloud, Aeza, RUvps) — Ubuntu 22+/Debian 12, домен (.ru ~990₽/год reg.ru).
2. На сервере:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs git caddy
git clone https://github.com/<логин>/<репо>.git && cd <репо>/messenger-app
npm install --omit=dev && cp .env.example .env && nano .env   # заполните SMTP и т.д.
mkdir -p /opt/teleport && cp -r . /opt/teleport
cat > /etc/systemd/system/teleport.service <<S
[Unit]
Description=Teleport Messenger
After=network.target
[Service]
WorkingDirectory=/opt/teleport
ExecStart=/usr/bin/node server.js
Restart=always
EnvironmentFile=-/opt/teleport/.env
User=root
[Install]
WantedBy=multi-user.target
S
systemctl enable --now teleport
caddy reverse-proxy --from moy-domen.ru --to localhost:8080   # HTTPS-сертификат автоматически
```
3. Домен: A-запись у регистратора → IP сервера. Всё — приложение боевое, с TLS (нужен для микрофона/камеры/PWA).

### Вариант B — бесплатный Paas (для теста): Render.com → New Web Service → Node → start `node server.js`. Бесплатный тариф засыпает, но для друзей пожить хватит.

## 5. Android APK / RuStore
```bash
cd capacitor && npm install && npx cap add android && npx cap sync && cd android && ./gradlew assembleRelease
```
(нужен Android Studio; SERVER_URL в capacitor.config.json → ваш домен). Для RuStore: аккаунт разработчика в partnerstore.vk.com (~5500₽ разово или бесплатно по акции), загрузить .aab, заполнить анкету, пройти модерацию. PWA-ссылку можно дать друзьям прямо сейчас — работает как приложение.

## 6. Масштабирование БД (когда вырастете)
JSON/SQLite хватает на тысячи пользователей. Дальше: PostgreSQL (Supabase/Яндекс Cloud) — движок выбирается сам в `db.js`, достаточно указать `DATABASE_URL`.
