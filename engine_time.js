/**
 * engine_time.js — управление временем и адаптивный контроль
 * Версия: 2.0
 * 
 * Содержит:
 * - Класс TimeManager для управления лимитами времени
 * - Алгоритмы для расчета времени на ход (классический, адаптивный, UCI)
 * - Поддержка фиксированного времени на ход (movetime)
 * - Поддержка времени с инкрементом (wtime, btime, winc, binc)
 * - Поддержка глубины поиска (depth)
 * - Остановка поиска по времени (soft/hard limits)
 * - Приоритетное планирование (выделение большего времени на сложные позиции)
 * - Логирование времени для отладки
 */

(function() {
    'use strict';

    // ======================== Константы ========================
    const DEFAULT_TIME_MS = 1000;          // время на ход по умолчанию
    const DEFAULT_MAX_TIME_MS = 60000;     // максимальное время на ход
    const DEFAULT_MIN_TIME_MS = 100;       // минимальное время на ход
    const TIME_FACTOR = 1.2;               // множитель для адаптивного времени
    const MOVES_REMAINING_ESTIMATE = 40;   // предполагаемое количество оставшихся ходов

    // ======================== Класс TimeManager ========================
    class TimeManager {
        constructor() {
            this.startTime = 0;
            this.softLimit = 0;      // мягкий лимит (время до окончания)
            this.hardLimit = 0;      // жесткий лимит (максимальное время)
            this.infinite = false;    // бесконечный поиск (для анализа)
            this.ponder = false;      // режим обдумывания (ожидание)
            this.movetime = 0;        // фиксированное время на ход
            this.depth = 0;           // фиксированная глубина
            this.nodes = 0;           // максимальное количество узлов
            
            // UCI параметры
            this.wtime = 0;           // время белых в мс
            this.btime = 0;           // время чёрных в мс
            this.winc = 0;            // инкремент белых
            this.binc = 0;            // инкремент чёрных
            this.movesToGo = 0;       // ходов до следующего контроля времени
            
            // Статистика
            this.totalTimeUsed = 0;
            this.lastMoveTime = 0;
            this.averageMoveTime = 0;
            this.moveCount = 0;
        }

        // ======================== Инициализация из UCI параметров ========================
        setLimits(params) {
            this.reset();
            
            if (params.movetime) {
                this.movetime = Math.min(params.movetime, DEFAULT_MAX_TIME_MS);
                this.softLimit = this.movetime;
                this.hardLimit = this.movetime + 50; // небольшой запас
                return;
            }
            
            if (params.depth) {
                this.depth = params.depth;
                return;
            }
            
            if (params.nodes) {
                this.nodes = params.nodes;
                return;
            }
            
            if (params.infinite) {
                this.infinite = true;
                return;
            }
            
            if (params.ponder) {
                this.ponder = true;
                return;
            }
            
            // Управление временем на основе wtime/btime
            if (params.wtime !== undefined && params.btime !== undefined) {
                this.wtime = params.wtime;
                this.btime = params.btime;
                this.winc = params.winc || 0;
                this.binc = params.binc || 0;
                this.movesToGo = params.movesToGo || MOVES_REMAINING_ESTIMATE;
                this.calculateTime();
            }
        }
        
        calculateTime() {
            const myTime = (this.getCurrentSide() === 'white') ? this.wtime : this.btime;
            const myInc = (this.getCurrentSide() === 'white') ? this.winc : this.binc;
            
            // Если времени мало, играем быстро
            if (myTime < 1000) {
                this.softLimit = Math.max(100, Math.floor(myTime * 0.8));
                this.hardLimit = Math.min(myTime, this.softLimit + 200);
                return;
            }
            
            // Адаптивный расчёт
            let movesLeft = Math.max(1, this.movesToGo);
            let baseTime = myTime / movesLeft;
            
            // Добавляем инкремент (в среднем половину инкремента)
            baseTime += myInc * 0.6;
            
            // Корректировка с учётом сложности позиции (будет установлено позже)
            let complexity = 1.0;
            
            let allocated = baseTime * TIME_FACTOR * complexity;
            allocated = Math.min(allocated, myTime * 0.9);   // не более 90% от оставшегося времени
            allocated = Math.max(allocated, DEFAULT_MIN_TIME_MS);
            allocated = Math.min(allocated, DEFAULT_MAX_TIME_MS);
            
            this.softLimit = Math.floor(allocated);
            this.hardLimit = Math.floor(allocated * 1.1) + 100; // жёсткий лимит на 10% больше
            
            // Адаптивное уменьшение времени, если мы уже потратили много
            if (this.moveCount > 5 && this.averageMoveTime > 0) {
                const avg = this.averageMoveTime;
                if (avg > this.softLimit * 1.2) {
                    this.softLimit = Math.max(DEFAULT_MIN_TIME_MS, Math.floor(this.softLimit * 0.8));
                    this.hardLimit = Math.floor(this.softLimit * 1.1);
                }
            }
        }
        
        getCurrentSide() {
            // Внешний интерфейс: side передаётся из позиции, здесь используем глобальную переменную
            // Для простоты возвращаем 'white' по умолчанию, но в реальном движке нужно передавать
            return (typeof window.currentSearchSide !== 'undefined') ? window.currentSearchSide : 'white';
        }
        
        start() {
            this.startTime = Date.now();
            this.lastMoveTime = this.startTime;
        }
        
        shouldStop() {
            if (this.infinite) return false;
            if (this.depth > 0) return false; // глубина контролируется извне
            if (this.nodes > 0) return false; // узлы контролируются извне
            
            const elapsed = Date.now() - this.startTime;
            
            if (this.movetime > 0 && elapsed >= this.movetime) {
                return true;
            }
            
            if (this.softLimit > 0 && elapsed >= this.softLimit) {
                return true;
            }
            
            if (this.hardLimit > 0 && elapsed >= this.hardLimit) {
                return true;
            }
            
            return false;
        }
        
        elapsed() {
            return Date.now() - this.startTime;
        }
        
        stop() {
            this.hardLimit = 0;
            this.softLimit = 0;
        }
        
        reset() {
            this.startTime = 0;
            this.softLimit = 0;
            this.hardLimit = 0;
            this.infinite = false;
            this.ponder = false;
            this.movetime = 0;
            this.depth = 0;
            this.nodes = 0;
            this.wtime = 0;
            this.btime = 0;
            this.winc = 0;
            this.binc = 0;
            this.movesToGo = 0;
        }
        
        recordMoveTime() {
            if (this.startTime === 0) return;
            const moveTime = Date.now() - this.startTime;
            this.totalTimeUsed += moveTime;
            this.moveCount++;
            this.averageMoveTime = this.totalTimeUsed / this.moveCount;
        }
        
        // Адаптивная настройка сложности на основе оценки позиции
        adjustForPosition(evalScore, depth) {
            let complexity = 1.0;
            const absEval = Math.abs(evalScore);
            if (absEval > 200) {
                // Преимущество большое - можно играть быстрее
                complexity = 0.8;
            } else if (absEval > 100) {
                complexity = 0.9;
            } else if (absEval < 50 && absEval > 20) {
                complexity = 1.1;
            } else if (absEval < 20) {
                complexity = 1.3;
            }
            // Чем больше глубина, тем больше времени
            if (depth > 10) complexity *= 1.2;
            if (depth > 15) complexity *= 1.1;
            return complexity;
        }
        
        // Получить оставшееся время в мс
        remainingTime() {
            if (this.hardLimit === 0) return Infinity;
            return Math.max(0, this.hardLimit - (Date.now() - this.startTime));
        }
        
        // Проверка, достаточно ли времени для продолжения поиска
        enoughTimeForNextIteration(depth, moveCount, totalMoves) {
            if (this.depth > 0) return true;
            if (this.infinite) return true;
            
            const elapsed = Date.now() - this.startTime;
            // Если потратили уже 80% жёсткого лимита, останавливаемся
            if (this.hardLimit > 0 && elapsed > this.hardLimit * 0.8) {
                return false;
            }
            // Приблизительная оценка времени на следующую итерацию
            const estimatedNext = elapsed * (depth + 1) / (depth + 0.5);
            if (this.hardLimit > 0 && estimatedNext > this.hardLimit * 0.9) {
                return false;
            }
            return true;
        }
        
        // Получить описание текущего лимита (для отладки)
        getLimitDescription() {
            if (this.infinite) return "infinite";
            if (this.depth > 0) return `depth ${this.depth}`;
            if (this.nodes > 0) return `nodes ${this.nodes}`;
            if (this.movetime > 0) return `movetime ${this.movetime}ms`;
            return `time ${this.softLimit}ms (soft) / ${this.hardLimit}ms (hard)`;
        }
    }

    // ======================== Глобальное хранилище ========================
    let globalTimeManager = null;
    
    function getTimeManager() {
        if (!globalTimeManager) globalTimeManager = new TimeManager();
        return globalTimeManager;
    }
    
    // ======================== Экспорт ========================
    window.BurchessTime = {
        TimeManager,
        getTimeManager,
        DEFAULT_TIME_MS,
        DEFAULT_MAX_TIME_MS,
        DEFAULT_MIN_TIME_MS
    };
})();
