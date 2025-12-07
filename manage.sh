#!/bin/bash

# Скрипт управления Docker проектом
# Автор: Егор (kosenGeorge)

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

show_menu() {
    clear
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}       🐳 DOCKER STACK MANAGER       ${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "${GREEN}1. 🚀 Запустить все сервисы${NC}"
    echo -e "${GREEN}2. 🛑 Остановить все сервисы${NC}"
    echo -e "${GREEN}3. 🔄 Перезапустить сервисы${NC}"
    echo -e "${GREEN}4. 📊 Показать статус${NC}"
    echo -e "${GREEN}5. 📝 Показать логи${NC}"
    echo -e "${GREEN}6. 🧪 Запустить тесты${NC}"
    echo -e "${GREEN}7. 🧹 Очистить всё${NC}"
    echo -e "${GREEN}8. ❓ Помощь${NC}"
    echo -e "${GREEN}0. 🔚 Выход${NC}"
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -n "Выберите вариант: "
}

start_services() {
    echo -e "${YELLOW}🚀 Запускаю Docker Compose stack...${NC}"
    docker compose up -d
    echo -e "${GREEN}✅ Сервисы запущены!${NC}"
    echo ""
    echo -e "${BLUE}🌐 Доступные сервисы:${NC}"
    echo "  • Веб-сайт:    http://192.168.0.43:8888"
    echo "  • Whoami:      http://192.168.0.43:8889"
    echo "  • Redis CLI:   docker exec -it redis-cache redis-cli"
    echo ""
    sleep 2
}

stop_services() {
    echo -e "${YELLOW}🛑 Останавливаю сервисы...${NC}"
    docker compose down
    echo -e "${GREEN}✅ Сервисы остановлены${NC}"
    sleep 2
}

show_status() {
    echo -e "${BLUE}📊 Статус сервисов:${NC}"
    echo ""
    docker compose ps
    echo ""
    
    echo -e "${BLUE}📈 Использование ресурсов:${NC}"
    echo ""
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null || echo "  (запустите сервисы для просмотра статистики)"
    echo ""
    
    read -p "Нажмите Enter для продолжения..."
}

show_logs() {
    echo -e "${YELLOW}📝 Последние логи (20 строк):${NC}"
    echo ""
    docker compose logs --tail=20
    echo ""
    echo -e "${BLUE}Для логов в реальном времени:${NC} docker compose logs -f"
    echo ""
    read -p "Нажмите Enter для продолжения..."
}

run_tests() {
    echo -e "${BLUE}🧪 Запускаю тесты сервисов...${NC}"
    echo ""
    
    # Проверяем Docker
    if ! docker --version > /dev/null 2>&1; then
        echo -e "${RED}❌ Docker не доступен${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Docker доступен${NC}"
    echo ""
    
    # Проверяем запущены ли сервисы
    if [ $(docker ps -q | wc -l) -eq 0 ]; then
        echo -e "${YELLOW}⚠️  Сервисы не запущены. Запускаю...${NC}"
        start_services
        sleep 5
    fi
    
    echo -e "${BLUE}🔍 Проверяю сервисы:${NC}"
    echo ""
    
    # Веб-сайт
    if curl -s -f http://localhost:8888 > /dev/null; then
        echo -e "${GREEN}✅ Веб-сайт (порт 8888) работает${NC}"
    else
        echo -e "${RED}❌ Веб-сайт (порт 8888) не доступен${NC}"
    fi
    
    # Whoami
    if curl -s -f http://localhost:8889 > /dev/null; then
        echo -e "${GREEN}✅ Whoami (порт 8889) работает${NC}"
        echo "   Ответ: $(curl -s http://localhost:8889 | head -1)"
    else
        echo -e "${RED}❌ Whoami (порт 8889) не доступен${NC}"
    fi
    
    # Redis
    if docker exec redis-cache redis-cli ping 2>/dev/null | grep -q PONG; then
        echo -e "${GREEN}✅ Redis (порт 6379) работает${NC}"
        # Сохраняем тестовые данные
        docker exec redis-cache redis-cli set "devops_student" "Егор" > /dev/null 2>&1
        echo "   Тестовые данные: $(docker exec redis-cache redis-cli get devops_student 2>/dev/null)"
    else
        echo -e "${RED}❌ Redis (порт 6379) не доступен${NC}"
    fi
    
    echo ""
    echo -e "${GREEN}✅ Все тесты завершены${NC}"
    echo ""
    read -p "Нажмите Enter для продолжения..."
}

clean_all() {
    echo -e "${YELLOW}🧹 Очищаю всё...${NC}"
    docker compose down -v 2>/dev/null
    docker system prune -f
    echo -e "${GREEN}✅ Очистка завершена${NC}"
    sleep 2
}

show_help() {
    clear
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}              📚 ПОМОЩЬ               ${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "${GREEN}Этот скрипт управляет Docker стеком:${NC}"
    echo ""
    echo "🐳 Сервисы:"
    echo "  • Nginx веб-сервер (порт 8888)"
    echo "  • Whoami сервис (порт 8889)"
    echo "  • Redis база данных (порт 6379)"
    echo ""
    echo "📁 Файлы проекта:"
    echo "  • docker-compose.yml - конфигурация"
    echo "  • Dockerfile - образ веб-сервера"
    echo "  • README.md - документация"
    echo "  • manage.sh - этот скрипт"
    echo ""
    echo "👨‍💻 Автор: Егор (kosenGeorge)"
    echo "📧 kosenkovegor01@gmail.com"
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo ""
    read -p "Нажмите Enter для возврата в меню..."
}

# Основной цикл
while true; do
    show_menu
    read choice
    
    case $choice in
        1)
            start_services
            ;;
        2)
            stop_services
            ;;
        3)
            stop_services
            sleep 2
            start_services
            ;;
        4)
            show_status
            ;;
        5)
            show_logs
            ;;
        6)
            run_tests
            ;;
        7)
            clean_all
            ;;
        8)
            show_help
            ;;
        0)
            echo -e "${BLUE}👋 До свидания!${NC}"
            echo ""
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Неверный выбор${NC}"
            sleep 2
            ;;
    esac
done
