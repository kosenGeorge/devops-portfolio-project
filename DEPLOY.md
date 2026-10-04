# 🚀 Как выложить Teleport людям и что нужно для продакшена

## 1. Что это за приложение?
**Teleport** — это пока **чистый мессенджер** (демо-класс), но архитектура готова к росту:
- UI и логика разделены (`app.js` — интерфейс, `store.js` — данные, `bot.js` — «серверная» имитация).
- Сейчас все данные живут в браузере (localStorage) — **без сервера**. Это плюс для приватности,
  минус — нет переписки между реальными людьми и синхронизации между устройствами.

### Дорожная карта «больше чем мессенджер»
| Этап | Что добавить | Стек |
|---|---|---|
| MVP-2 | Реальные чаты между пользователями | WebSocket (Socket.IO) + Node.js бэкенд |
| MVP-3 | Аккаунты, телефон/почта, сессии | Firebase Auth или свой JWT |
| MVP-4 | Звонки, голосовые сообщения | WebRTC |
| MVP-5 | Боты, каналы, публичные группы | как в Telegram |

## 2. Как выложить людям (по возрастанию сложности)

### Способ A. GitHub Pages — бесплатно, 5 минут (рекомендую для раздачи ссылки)
1. Репозиторий уже содержит workflow `.github/workflows/pages.yml`.
2. GitHub → ваш репо → **Settings → Pages → Source: GitHub Actions** (или просто пуш в `main` — сборка запустится сама).
3. Через 1–2 минуты:
   - лендинг-визитка: `https://kosenGeorge.github.io/<репо>/`
   - сам мессенджер: `https://kosenGeorge.github.io/<репо>/messenger-app/`
   Эту вторую ссылку можно давать людям. В workflow встроены проверки: если вдруг снова появится докер-заглушка («My Docker Website»), сборка **упадёт с ошибкой**, а не выложит мусор.
4. ⚠️ Если у вас уже был старый Pages-деплой с заглушкой — обновите страницу с очисткой кэша (Ctrl+F5) или в инкогнито: Service Worker старого сайта может держать кэш. Новая версия кэшируется под новым именем (`teleport-v4`), поэтому после первого открытия всё обновится само.

### Способ B. Vercel / Netlify — бесплатно, ещё проще
- **Vercel**: vercel.com → New Project → импорт GitHub-репо → Framework: *Other*, Output: `messenger-app` → Deploy.
- **Netlify**: app.netlify.com → "Import from Git" → Publish directory: `messenger-app`.
Плюс: мгновенный HTTPS из коробки (нужен для Push-уведомлений и установки PWA).

### Способ C. Свой сервер через Docker (уже настроен в этом репо)
```bash
git pull
docker compose up -d --build website
# сайт: http://IP:8888/messenger/
```
Для людей из интернета нужен белый IP/домен + HTTPS (см. пункт 3).

### Способ D. APK/AAB для Android и iOS
- **APK без Android Studio**: [pwabuilder.com](https://www.pwabuilder.com) → вставить URL сайта → Package for Windows/Android → скачать APK/AAB.
- **Capacitor** (конфиги в `messenger-app/capacitor/`):
  ```bash
  cd messenger-app/capacitor && npm install && npx cap add android && npx cap sync
  ./gradlew assembleDebug   # debug APK
  ./gradlew assembleRelease # release (подпишите ключом и в Google Play)
  ```
- GitHub Actions: workflow `build-apk.yml` собирает APK автоматически во вкладке **Actions** (артефакт `teleport-apk`).
- **iOS**: нужен Mac + Xcode + аккаунт Apple Developer ($99/год) → `npx cap add ios` → Archive → App Store.


## 2.5. Куда положить, чтобы открыть людям (пошагово)

### Вариант 1 — GitHub Pages (бесплатно, без сервера) ✅ рекомендуемый
1. Заведите репозиторий на GitHub (у вас уже есть) и запушьте туда проект:
   ```bash
   git add . && git commit -m "Teleport v4" && git push origin main
   ```
2. GitHub → репо → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Откройте вкладку **Actions** — workflow «Deploy to GitHub Pages» соберётся сам за ~1 минуту.
4. Ссылка для людей появится на странице Settings → Pages: `https://<логин>.github.io/<репо>/messenger-app/`.
   Минусы: нет своего домена из коробки; HTTPS бесплатный есть.

### Вариант 2 — Netlify / Vercel (бесплатно, 2 минуты, свой домен легко подключить)
- **Netlify**: app.netlify.com → *Add new site → Import an Git repo* → выбрать репо → **Publish directory: `messenger-app`** → Deploy.
- **Vercel**: vercel.com → New Project → импортировать репо → Framework: *Other*, Output directory: `messenger-app`.
Плюсы: мгновенный HTTPS, предпросмотр каждого пуша, домен вида `teleport.netlify.app` (можно заменить своим за 1 клик).

### Вариант 3 — дешёвый российский хостинг со статикой (~60–150 ₽/мес)
Подойдёт любой хостинг с PHP/FTP (Timeweb, Beget, Reg.ru):
1. Купите тариф «L/Старт», подключите домен (.ru ~150–300 ₽/год).
2. В панели хостинга загрузите **содержимое папки `messenger-app/`** в корень сайта (`public_html`) через файловый менеджер или FTP (FileZilla).
3. Всё: сайт на `https://вашдомен.ru` с бесплатным сертификатом Let's Encrypt (ставится галочкой в панели).

### Вариант 4 — свой VPS + Docker (уже настроено в репозитории)
Для полного контроля: Selectel / Timeweb Cloud / VK Cloud / Yandex Cloud (~400–800 ₽/мес).
```bash
git clone <ваш репо> && cd <репо>
docker compose up -d --build website        # мессенджер: http://IP:8888/messenger/
# затем белый домен + certbot (см. раздел 3)
```

### Чек-лист перед раздачей ссылки
- [ ] Открыть ссылку с телефона Android (Chrome) и iPhone (Safari) — проверить установку PWA.
- [ ] `https://` обязателен (на GitHub Pages/Netlify он есть) — иначе не работают уведомления и установка.
- [ ] Предупредите людей: это демо-мессенджер без сервера — переписка каждого хранится только у него на устройстве (общение «человек-человек» появится после подключения WebSocket-бэкенда, см. дорожную карту).

## 3. Что нужно для ПОЛНОЦЕННОГО продакшена (например, в России)

1. **Домен в зоне .RU/.РФ** — регистраторы: reg.ru, nic.ru, r01.ru (~150–600 ₽/год).
2. **Хостинг/сервер в РФ** (быстрее для российских пользователей и требования по 152-ФЗ):
   - VPS от Selectel, Timeweb Cloud, VK Cloud, Yandex Cloud, Masterhost (~400–800 ₽/мес за 1–2 CPU).
   - Ставите туда то же самое: `git clone` → `docker compose up -d`.
3. **HTTPS-сертификат** — бесплатный Let's Encrypt:
   ```bash
   apt install certbot nginx python3-certbot-nginx
   certbot --nginx -d teleport.example.ru
   ```
   Без HTTPS не работают: установка PWA, push-уведомления, камера/микрофон, WebRTC.
4. **Реестр ОРД** (если мессенджер реально хранит переписку пользователей из РФ): по 152-ФЗ о персональных данных нужно уведомить Роскомнадзор через er.rkn.gov.ru — бесплатно. Если всё остаётся в браузере пользователя (как сейчас) — формально обрабатывать ПД вы не начинаете, но при добавлении сервера/аккаунтов — обязательно.
5. **Юридическая обёртка** (для публикации в RuStore/Google Play):
   - ИП или самозанятость (для приёма платежей, если будут),
   - политика конфиденциальности + пользовательское соглашение (обязательны для RuStore),
   - e-mail поддержки и ссылка на них в сторе.
6. **RuStore** (ru-store.ru):
   1. Регистрация разработчика (бесплатно, нужны паспорт + ИНН/СНИЛС).
   2. Приложение собирается в **AAB/APK** (Capacitor/pwabuilder), подпись release-ключом.
   3. В кабинете: карточка, скриншоты, описание, иконка 512×512, ссылка на privacy policy → модерация 1–3 дня.
7. **Мониторинг/бэкапы**: хотя бы cron-выгрузка `docker exec ... ` + uptime-проверка (UptimeRobot бесплатен).

## 4. Быстрый чек-лист «выложить сегодня»
- [x] Пуш в main → GitHub Pages поднимет сайт сам (workflow уже есть)
- [ ] Settings → Pages → Source: **GitHub Actions** (один раз)
- [ ] Скопировать ссылку → отправить друзьям
- [ ] (Опция) pwabuilder → APK → раздать файл или залить в RuStore позже
