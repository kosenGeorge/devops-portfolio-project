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
3. Через 1–2 минуты сайт будет на `https://kosenGeorge.github.io/<репо>/messenger-app/...` — эту ссылку можно давать людям. Они откроют в Chrome/Safari и смогут «Установить приложение» (PWA).

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
