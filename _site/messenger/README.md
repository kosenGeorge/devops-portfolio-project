# 📨 Teleport — мессенджер в стиле Telegram

**Готовое веб-приложение (PWA), которое превращается в Android `.apk` за пару команд.**
Максимальное сходство с Telegram по интерфейсу + собственные доработки.

![preview](../screenshots/README.md)

## ✨ Возможности

| Функция | Описание |
|---|---|
| 💬 Чаты и сообщения | Список чатов, счётчики непрочитанных, время, аватары с цветами как в TG |
| ✅✔️ Статусы доставки | одна галочка → две → синие (Прочитано), как в Telegram |
| ⌨️ «печатает…» | анимированные точки, собеседник печатает в реальном времени |
| ↩️ Ответы / ✏️ редактирование / 🗑 удаление | действия прямо на пузыре сообщения |
| 📷 Фото | отправка изображений (автосжатие), просмотр в лайтбоксе |
| 😀 Эмодзи-панель | быстрый выбор эмодзи |
| 🔍 Поиск по чатам | мгновенная фильтрация |
| 🆕 Создание чатов | любой контакт/группа |
| 🔖 Избранное | личный блокнот, как Saved Messages |
| 🤖 Живые ответы | встроенный «собеседник» имитирует переписку (в т.ч. фоновые сообщения) |
| 🔔 Push-уведомления | через Web Notifications API |
| 🌙 Тёмная тема | переключение в меню-бургере |
| 📱 Мобильная вёрстка | один экран = список или чат, кнопка «назад» |
| 💾 Офлайн-хранение | localStorage + Service Worker (работает без интернета) |
| 📲 Установка как APK | Capacitor / PWA Builder |

## 📁 Структура

```
messenger-app/
├── index.html              # разметка приложения
├── manifest.webmanifest    # PWA-манифест (имя, иконки, standalone)
├── sw.js                   # Service Worker: офлайн-кэш
├── serve.js                # локальный запуск: node serve.js
├── css/style.css           # стили в духе Telegram (светлая/тёмная темы)
├── js/store.js             # хранилище данных (localStorage)
├── js/bot.js               # имитация собеседника («печатает…», ответы)
├── js/app.js               # UI-логика: чаты, сообщения, реакции
├── vendor/                 # Bootstrap Icons (локально, работает офлайн)
├── icons/                  # иконки PWA 192/512 (+maskable)
└── capacitor/              # конфиг для сборки APK
    ├── package.json
    └── capacitor.config.json
```

## 🚀 Как открыть и запустить

### Способ 1 — просто открыть в браузере
Двойной клик по `messenger-app/index.html` — всё работает сразу
(иконки и уведомления требуют запуска через HTTP-сервер).

### Способ 2 — локальный сервер (рекомендуется)
```bash
cd messenger-app
node serve.js
# откройте http://localhost:8080
```
или без Node:
```bash
cd messenger-app && python3 -m http.server 8080
```

### Способ 3 — GitHub Pages (бесплатный хостинг)
1. Запушьте этот репозиторий на GitHub.
2. **Settings → Pages → Source: Deploy from a branch → `/ (root)`**.
3. Приложение будет доступно по адресу
   `https://ваш-логин.github.io/имя-репозитория/messenger-app/`.

### Способ 4 — установить прямо из браузера на телефон (PWA)
Откройте ссылку из способа 3 в Chrome на Android →
**Меню ⋮ → «Установить приложение»**. Получите иконку на рабочем столе,
приложение открывается без адресной строки, работает офлайн.

## 🤖 Сборка настоящего .APK

### Вариант A — PWA Builder (без установки Android Studio, самый простой)
1. Опубликуйте приложение (Способ 3).
2. Зайдите на **https://www.pwabuilder.com**
3. Вставьте URL → **Package For Stores** → Android → скачайте `.apk/.aab`.

### Вариант B — Capacitor (полноценная сборка, все файлы уже в проекте)
Нужны: [Node.js](https://nodejs.org) 18+, [Android Studio](https://developer.android.com/studio) (со JDK).

```bash
cd messenger-app/capacitor
npm install                      # ставит @capacitor/cli, @capacitor/android
npx cap add android              # создаёт папку android/ (проект Android Studio)
npx cap sync                     # копирует PWA внутрь проекта
npx cap open android             # открыть в Android Studio
# Android Studio: Build → Build App Bundle(s)/APK(s) → build APK(s)
# Готовый файл: messenger-app/capacitor/android/app/build/outputs/apk/debug/app-debug.apk
```

Или одной командой из терминала:
```bash
cd messenger-app/capacitor && npm install && npx cap add android && npx cap sync
./android/gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

### Вариант C — онлайн-сборка в GitHub Actions
В репозитории есть готовый workflow: `.github/workflows/build-apk.yml`.
Он собирает debug-APK при каждом пуше в `main` — скачать можно
во вкладке **Actions → последний запуск → Artifacts → teleport-apk**.

## 🧪 Быстрая проверка функций
1. Введите имя → «Начать чат».
2. Откройте «Алису», напишите сообщение — увидите галочки, «печатает…» и ответ.
3. Нажмите ✏️/↩️/🗑 на своём сообщении — изменение, ответ, удаление.
4. 📎 — отправьте картинку, клик по ней — лайтбокс.
5. Бургер-меню ☰ — тёмная тема, уведомления, выход.

## 🔧 Свои доработки (идеи roadmap)
- 🔐 Пароль/PIN на вход
- 🌍 Мультиязычность (EN/RU)
- 📞 Реальные звонки через WebRTC
- 🛰 Синхронизация между устройствами (Firebase/Supabase вместо localStorage)
- 🎨 Пользовательские обои чата

## 📄 Лицензия
MIT — используйте свободно. Иконки: Bootstrap Icons (MIT).
