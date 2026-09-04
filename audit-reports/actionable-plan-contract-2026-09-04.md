# Граница нативного OMP и контракт исполнимого плана v1.3.0

Дата: 2026-09-04
Версия OMP: `@oh-my-pi/pi-coding-agent` 17.3.7
Статус: аудит завершён; границы зафиксированы, расширения плана спроектированы без нарушения нативного OMP.

## 1. Подтверждённый OMP-контракт и архитектурная граница

| Аспект | Файл и строки | Подтверждённый факт и контракт |
|---|---|---|
| Нативный контракт секций плана | `src/prompts/system/plan-mode-active.md:80-94` | Нативный системный prompt OMP задаёт ровно пять канонических H2-секций: `Context`, `Approach`, `Critical files & anchors`, `Verification`, `Assumptions & contingencies`. Для `Approach` прямо предписано: «Concrete edit: verb, exact target, new behavior; NEVER merely area to “update”/“handle”». Для `Verification`: «≥1 new-behavior check: concrete input → expected observable output, not just build/typecheck/existing suite». |
| Точка перехвата `tool_call` | `src/extensibility/hooks/types.ts:302-313` | Событие `ToolCallEvent` (`type: "tool_call"`, `toolName`, `toolCallId`, `input`) вызывается перед выполнением инструмента. Расширение может заблокировать вызов через `{ block: true, reason }`. |
| Контекст расширений | `src/extensibility/extensions/types.ts:443-463` | `ExtensionContext` предоставляет `ui`, `mode`, `getContextUsage()`, `getAsyncJobSnapshot()`, `compact()`, `hasUI`, `cwd`, `sessionManager`, `modelRegistry`, `localProtocolOptions`. |
| Перехват и fail-closed политика | `src/extensibility/hooks/tool-wrapper.ts:40-70`, `src/extensibility/extensions/runner.ts:1429-1444` | Вызов `emitToolCall` выполняется до передачи инструмента исполнителю. Политика при ошибке/таймауте: fail-closed (`{ block: true }`), блокирующая передачу небезопасного инструмента в систему. |
| Запрет prompt injection через `before_agent_start` | `src/extensibility/hooks/types.ts:426-429`, `src/extensibility/extensions/runner.ts:1688-1735` | Публичный интерфейс `BeforeAgentStartEventResult` содержит строго `message?: CustomMessagePayload`. Внутренний механизм `runner.ts` читает `result.systemPrompt`, однако этот механизм не является стабильным публичным API типов OMP. Попытка мутировать системный промпт через расширения нарушает изоляцию и создаёт скрытую связность. Принято решение: **полный отказ от prompt injection**. Все правила валидируются строго детерминированным парсером структуры при попытке handoff. |

## 2. Порядок обработки plan handoff

Полная цепочка обработки запроса `write xd://propose <title>`:

```text
write xd://propose <title>
  │
  ▼
[1. Exact local-plan preflight]
  ├── Проверка наличия и доступности exact local plan файла
  └── Ошибка: [PLAN_VALIDATOR_BLOCK] PLAN_FILE_MISSING (0 LLM tokens)
  │
  ▼
[2. Convergence Latch Check]
  ├── Если лимит попыток исчерпан (MAX_FAILED_VALIDATIONS=3, MAX_SAME_HASH_REPEATS=2, MAX_NO_PROGRESS=2, MAX_TURN_PROPOSALS=4)
  └── Ошибка: [PLAN_VALIDATOR_STOPPED] Sticky turn latch (0 LLM tokens)
  │
  ▼
[3. Deterministic Structural Validator (v1.3.0)]
  ├── Проверка канонических секций: PLAN_EMPTY, SECTION_MISSING, SECTION_DUPLICATE, SECTION_ORDER, SECTION_EMPTY
  ├── Проверка Approach (v1.3.0): APPROACH_TARGET_MISSING на каждом шаге (H3 или 1./1) или секции)
  ├── Проверка Verification (v1.3.0): VERIFICATION_NOT_ACTIONABLE (наличие `<action>` → `<result>` или fenced code + `Expected:`)
  └── Ошибка: [PLAN_VALIDATOR_BLOCK] с полным пакетом исправлений (0 LLM tokens)
  │
  ▼
[4. Bounded AI Advisor]
  ├── Запускается строго при 0 детерминированных структурных ошибках
  ├── Оценивает смысловую полноту, скрытые риски и инварианты
  └── Возвращает замечания советника или подтверждение
  │
  ▼
[5. Native OMP Operator Review]
  └── Пользователь подтверждает переход из plan mode в execution mode
```

## 3. Принципы чистоты контракта (Non-Goals)

1. **Никаких вымышленных секций**: Мы не добавляем секции `Tasks`, `File Changes`, `Steps` или `Checklist`. План обязан следовать исключительно пяти нативным H2-секциям OMP.
2. **Никаких искусственных префиксов**: Мы не требуем идентификаторов FR-1, AC-1, T-1 или синтетических меток.
3. **Никакого белого списка CLI**: Валидатор `Verification` принимает любые исполнимые действия (`command`, API route, UI экран браузера, состояние TUI, ручные шаги проверки), а не только bash CLI.
4. **Никаких проверок существования файлов на диске**: Проверка существования файлов через fs stats во время валидации плана отвергнута, так как создаваемые планом файлы ещё не существуют на момент планирования.
5. **Никакого LLM-анализа свободного текста в валидаторе**: Валидатор проверяет только однозначные синтаксические токены (inline code, стрелки, ключевые слова). Смысловой анализ остаётся за AI-советником.

## 4. Таблица отказов (Failure Matrix)

| Сценарий | Нарушение | Результат валидатора | Вызов советника |
|---|---|---|---|
| Пустой Approach | Секция `## Approach` не содержит текста | `SECTION_EMPTY` | Нет (0 токенов) |
| Шаг без точной цели | `### 1. Update the validator` без inline-кода с путями/символами | `APPROACH_TARGET_MISSING` на строке шага | Нет (0 токенов) |
| Секция без шагов и без цели | `## Approach\nJust do the work.` | `APPROACH_TARGET_MISSING` на строке Approach | Нет (0 токенов) |
| Verification без доказательства | `## Verification\nRun tests.` | `VERIFICATION_NOT_ACTIONABLE` на строке Verification | Нет (0 токенов) |
| Verification только с командой без результата | `` `npm test` `` без `→`/`=>` и без `Expected:` | `VERIFICATION_NOT_ACTIONABLE` | Нет (0 токенов) |
| Verification с блоком без Expected: | ```` ```bash\nnpm test\n``` ```` без строки `Expected:` | `VERIFICATION_NOT_ACTIONABLE` | Нет (0 токенов) |
| Missing/Empty секция с шагами | Секция `Approach` отсутствует | Только `SECTION_MISSING` (зависимая `APPROACH_TARGET_MISSING` подавлена) | Нет (0 токенов) |
| Исполнимый план | Шаги содержат `src/plan-validator.ts#validatePlanStructure`, Verification содержит `` `npm test` → all pass `` | 0 ошибок | Да (1 вызов) |

## 5. Проверочные сценарии (Verification Scenarios)

1. **Негативный тест Approach**: Шаг без точной цели возвращает `APPROACH_TARGET_MISSING`, строку H3/пункта и сообщение с примерами `src/file.ts#symbol`, `GET /api/orders`, `Settings > Billing`.
2. **Негативный тест Verification**: Секция без стрелки `→`/`=>` или блока с `Expected:` возвращает `VERIFICATION_NOT_ACTIONABLE` на строке `## Verification`.
3. **Позитивный тест Verification (inline action)**: Формат `` `<action>` → <observable expected result> `` проходит валидацию.
4. **Позитивный тест Verification (fenced block)**: Непустой блок кода, за которым следует `Expected: <result>` или `Ожидаемо: <result>`, проходит валидацию.
5. **Позитивный тест UI-плана без CLI**: Шаги с `Settings > Billing` и верификация `` `Settings > Billing` → confirmation is visible `` успешно проходят валидатор и передаются в advisor.
6. **Подавление зависимых ошибок**: При отсутствии секции `Approach` или `Verification` возвращается только `SECTION_MISSING`, вторичные ошибки не плодятся.
7. **Стабильность сигнатуры**: Сдвиг строк и добавление пробелов не меняет `issueSignature`, предотвращая ложный сброс счётчиков сходимости.

## 6. Порядок работ

1. Обновить `PlanIssue.code` в `src/plan-validator.ts`, добавив `APPROACH_TARGET_MISSING` и `VERIFICATION_NOT_ACTIONABLE`.
2. Реализовать разбиение `Approach` на шаги (H3 -> нумерованные списки -> целая секция) и проверку точных целей в inline-коде (`/`, `\`, `#`, `::`, вызовы `()`, цепочки `.`, иерархии `>`).
3. Реализовать проверку `Verification` на наличие `` `<action>` → <result> `` или fenced code + `Expected:`.
4. Обеспечить подавление зависимых ошибок при missing/empty/duplicate секциях.
5. Расширить тестовый набор `tests/e2e-plan-validator.mjs` и обновить fixtures в `tests/e2e-*.mjs`.
6. Проверить в `tests/e2e-real-plan-handoff.mjs` блокировку неисполнимого плана без вызова советника и сквозной проход валидного плана.

## 7. Одношаговый откат (One-Step Rollback)

Каждое новое правило изолировано и может быть мгновенно отключено без побочных эффектов:

- **Откат `APPROACH_TARGET_MISSING`**: удалить вызов проверки целей шагов в `validatePlanStructure` и удалить литерал `"APPROACH_TARGET_MISSING"` из union-типа `PlanIssue["code"]`.
- **Откат `VERIFICATION_NOT_ACTIONABLE`**: удалить вызов проверки верификации в `validatePlanStructure` и удалить литерал `"VERIFICATION_NOT_ACTIONABLE"` из union-типа `PlanIssue["code"]`.
- Контроллер сходимости, кэширование хэшей, sticky latch и порядок взаимодействия с AI-советником остаются полностью работоспособными, так как опираются на обобщённый массив `PlanIssue[]` и не завязаны на конкретные типы ошибок.
