# GigaChat React App

Простое React TypeScript приложение для чата с GigaChat API.

## Установка

1. Установите зависимости:
```bash
npm install
```

2. Создайте файл `.env` в корне проекта со следующим содержимым:
```
VITE_AUTH_TOKEN=your_auth_token_here
VITE_SCOPE=your_scope_here
VITE_OPENROUTER_API_KEY=your_openrouter_api_key_here
```

Замените значения на ваши реальные:
- `your_auth_token_here` и `your_scope_here` - для GigaChat API
- `your_openrouter_api_key_here` - API ключ OpenRouter (можно получить на https://openrouter.ai)

## Запуск

Для запуска в режиме разработки:
```bash
npm run dev
```

Для сборки проекта:
```bash
npm run build
```

## Функциональность

- Чат с GigaChat API
- Автоматическое управление OAuth токенами с обновлением за 5 минут до истечения
- Счетчик символов в поле ввода
- Ограничение количества сообщений в диалоге: 5 сообщений с счетчиком
- История переписки с передачей всего контекста в каждом запросе
- Кнопка очистки диалога
- Спиннер загрузки во время ожидания ответа
