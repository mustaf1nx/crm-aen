# AEN CRM

CRM для бренда одежды AEN: Семей, Караганда, Өскемен.
React + TypeScript, FastAPI, PostgreSQL. Вход администратора и менеджеров,
клиенты, канбан лидов, заказы, аналитика, Instagram inbox и ответы.

## Railway

Корневой Dockerfile собирает React и обслуживает интерфейс и API одним
сервисом. PORT задаётся Railway. Healthcheck: `/api/health` с проверкой БД.
Создайте PostgreSQL и задайте DATABASE_URL через ссылку на переменную базы.
Поддерживаются URL postgresql:// и postgresql+psycopg://.

Обязательные переменные: DATABASE_URL, SECRET_KEY (случайный, минимум
32 символа), ADMIN_USERNAME, ADMIN_PASSWORD (минимум 12 символов).
Пароль ADMIN_PASSWORD используется только для первого администратора.
Не храните секреты, .env и дампы базы в Git. Настройте CORS_ORIGINS на URL CRM.

Instagram: META_APP_SECRET, IG_VERIFY_TOKEN, IG_ACCESS_TOKEN, IG_ACCOUNT_ID,
IG_PAGE_ID, IG_CITY_NAME, IG_AUTH_MODE=facebook. При необходимости задайте
IG_GRAPH_VERSION; исходное значение по умолчанию v24.0.
Callback: `https://<домен>/api/webhooks/instagram`.
Входящие POST всегда проверяются по HMAC-SHA256 от исходных байтов тела.
Проверка подписки GET использует отдельный IG_VERIFY_TOKEN.
Не включайте полные access logs: query string содержит verify_token.
ENABLE_DEMO_INGEST=false для облачного сервиса.

После подключения Meta проверьте реальный входящий DM, создание клиента/лида
и доставку ответа в Instagram. Наличие переменных не доказывает корректность
токена и разрешений. Тестовая кнопка Meta не заменяет сквозную проверку.

## Локальный Docker

Скопируйте .env.example в .env и заполните значения, затем
`docker compose up -d --build`. UI: http://127.0.0.1:8080,
ограниченный webhook-вход: http://127.0.0.1:8081/api/webhooks/instagram.
Храните исходное имя Compose-проекта и volume postgres_data.
Не выполняйте down -v при обновлениях. Перед обновлением сделайте pg_dump.
Облачная БД создаётся отдельно: данные локального Docker автоматически
не переносятся. Для переноса нужен приватный dump и проверка восстановления.

## Проверки

Backend: установить backend/requirements.txt, в backend выполнить
`python -m unittest -v test_instagram`. Используется SQLite в памяти;
внешний Meta API в тесте ответа имитируется.
Frontend: `cd frontend`, `npm ci`, `npm run build`.

## Текущие ограничения

Один подключаемый Instagram-аккаунт; поддержка трёх аккаунтов и WhatsApp
остаётся следующим этапом. Последовательные дубли сообщений отсекаются.
Конкурентные конфликты транзакций и миграции схемы требуют дальнейшей работы.
В репозитории нет данных клиентов или рабочих ключей.
