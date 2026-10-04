FROM nginx:alpine

# Создаём красивый финальный сайт
RUN mkdir -p /usr/share/nginx/html/legacy && mv /usr/share/nginx/html/index.html /usr/share/nginx/html/legacy/index.html && cat > /usr/share/nginx/html/index.html << 'HTML'
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎓 Мой DevOps Путь</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #f8f9fa;
            line-height: 1.6;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        header {
            text-align: center;
            padding: 3rem 0;
            margin-bottom: 3rem;
        }
        
        .hero {
            font-size: 4rem;
            margin-bottom: 1rem;
        }
        
        h1 {
            font-size: 3rem;
            background: linear-gradient(90deg, #00ff9d, #667eea);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 1rem;
        }
        
        .subtitle {
            font-size: 1.2rem;
            opacity: 0.8;
            max-width: 600px;
            margin: 0 auto 2rem;
        }
        
        .achievement-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            margin-bottom: 3rem;
        }
        
        .card {
            background: rgba(255, 255, 255, 0.05);
            padding: 2rem;
            border-radius: 15px;
            border-left: 4px solid #00ff9d;
            transition: transform 0.3s;
        }
        
        .card:hover {
            transform: translateY(-5px);
        }
        
        .card h3 {
            color: #00ff9d;
            margin-bottom: 1rem;
            font-size: 1.5rem;
        }
        
        .services {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
            margin-bottom: 3rem;
        }
        
        .service {
            background: rgba(0, 0, 0, 0.3);
            padding: 1.5rem;
            border-radius: 10px;
            text-align: center;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .service h4 {
            color: #00ff9d;
            margin: 1rem 0;
        }
        
        .status {
            display: inline-block;
            padding: 0.3rem 1rem;
            border-radius: 20px;
            font-weight: bold;
            margin-top: 1rem;
            font-size: 0.9rem;
        }
        
        .status.up {
            background: rgba(39, 174, 96, 0.2);
            color: #27ae60;
            border: 1px solid #27ae60;
        }
        
        footer {
            text-align: center;
            padding: 2rem;
            margin-top: 3rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            opacity: 0.7;
        }
        
        .tech-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            justify-content: center;
            margin: 1rem 0;
        }
        
        .tag {
            background: rgba(102, 126, 234, 0.2);
            padding: 0.3rem 0.8rem;
            border-radius: 15px;
            border: 1px solid #667eea;
            font-size: 0.9rem;
        }
        
        .tg-btn {
            display: inline-block; background: #3390ec; color: #fff; text-decoration: none;
            padding: 14px 28px; border-radius: 30px; font-size: 1.1rem; font-weight: 600;
            box-shadow: 0 4px 20px rgba(51,144,236,.4); transition: transform .2s;
        }
        .tg-btn:hover { transform: translateY(-3px); }

        @media (max-width: 768px) {
            h1 {
                font-size: 2rem;
            }
            
            .hero {
                font-size: 3rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="hero">🚀🐳</div>
            <h1>Мой DevOps Путь</h1>
            <p class="subtitle">От установки Ubuntu до продакшн Docker стека за 3 дня</p>
            
            <div class="tech-tags">
                <span class="tag">Ubuntu</span>
                <span class="tag">Docker</span>
                <span class="tag">Nginx</span>
                <span class="tag">Redis</span>
                <span class="tag">Git</span>
                <span class="tag">Linux</span>
            </div>
        </header>
        
        <div class="achievement-grid">
            <div class="card">
                <h3>✅ День 1: Основы</h3>
                <p>• Установка Ubuntu Server</p>
                <p>• Настройка Nginx</p>
                <p>• Работа с терминалом</p>
                <p>• Сетевые настройки</p>
            </div>
            
            <div class="card">
                <h3>✅ День 2: Docker</h3>
                <p>• Установка Docker</p>
                <p>• Dockerfile и образы</p>
                <p>• Docker Compose</p>
                <p>• Управление контейнерами</p>
            </div>
            
            <div class="card">
                <h3>✅ День 3: Продакшн</h3>
                <p>• Multi-service стек</p>
                <p>• Решение проблем (403 ошибка)</p>
                <p>• Мониторинг и логи</p>
                <p>• Git и документация</p>
            </div>
        </div>
        
        <div class="services">
            <div class="service">
                <div style="font-size: 2rem;">🌐</div>
                <h4>Веб-Сервер</h4>
                <p>Порт: 8888</p>
                <p>Статус: <span id="web-status" class="status up">РАБОТАЕТ</span></p>
            </div>
            
            <div class="service">
                <div style="font-size: 2rem;">🔍</div>
                <h4>Whoami Сервис</h4>
                <p>Порт: 8889</p>
                <p>Статус: <span id="whoami-status" class="status up">РАБОТАЕТ</span></p>
            </div>
            
            <div class="service">
                <div style="font-size: 2rem;">🗄️</div>
                <h4>Redis База</h4>
                <p>Порт: 6379</p>
                <p>Статус: <span id="redis-status" class="status up">РАБОТАЕТ</span></p>
            </div>
        </div>
        
        <div style="text-align:center;margin-bottom:3rem">
            <a href="/messenger/" class="tg-btn">💬 Открыть мессенджер Teleport →</a>
        </div>

        <footer>
            <p>👨‍💻 Проект создал: <strong>Егор (kosenGeorge)</strong></p>
            <p>📧 kosenkovegor01@gmail.com</p>
            <p>🌍 Сервер: 192.168.0.43</p>
            <p>⏰ Обновлено: <span id="current-time">загрузка...</span></p>
        </footer>
    </div>
    
    <script>
        // Обновляем время
        function updateTime() {
            const now = new Date();
            const timeStr = now.toLocaleString('ru-RU');
            document.getElementById('current-time').textContent = timeStr;
        }
        
        // Обновляем время сразу и каждую минуту
        updateTime();
        setInterval(updateTime, 60000);
        
        // Простая анимация для статусов
        const statusElements = document.querySelectorAll('.status');
        statusElements.forEach(el => {
            setInterval(() => {
                el.style.opacity = el.style.opacity === '0.8' ? '1' : '0.8';
            }, 1000);
        });
    </script>
</body>
</html>
HTML

# --- Мессенджер Teleport (PWA) в подпапке /messenger/ ---
COPY messenger-app/ /usr/share/nginx/html/messenger/

# Корневая страница-хаб со ссылкой на мессенджер
COPY index.html /usr/share/nginx/html/index.html

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost || exit 1

EXPOSE 80
