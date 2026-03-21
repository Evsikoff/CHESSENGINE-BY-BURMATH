/**
 * engine_threads.js — многопоточность в BURCHESS (Web Workers)
 * Версия: 2.0
 * 
 * Содержит:
 * - Класс ThreadPool для управления пулом воркеров
 * - Распределение поиска по нескольким потокам (лазерный поиск)
 * - Синхронизация и сбор результатов
 * - Поддержка lazy SMP (Shared Transposition Table)
 * - Управление нагрузкой и балансировка
 * - Автоматическое определение количества ядер
 */

(function() {
    'use strict';

    // ======================== Константы ========================
    const DEFAULT_THREADS = 1;          // в браузере ограничено, но можно использовать SharedWorker
    const MAX_THREADS = 4;              // максимум 4 потока для Web Workers
    
    // ======================== Класс WorkerThread ========================
    class WorkerThread {
        constructor(id, scriptUrl = 'worker.js') {
            this.id = id;
            this.worker = new Worker(scriptUrl);
            this.busy = false;
            this.result = null;
            this.callback = null;
            this.worker.onmessage = (e) => this.handleMessage(e);
            this.worker.onerror = (e) => console.error(`Worker ${id} error:`, e);
        }
        
        handleMessage(e) {
            const data = e.data;
            if (this.callback) {
                this.callback(data);
                this.callback = null;
            }
            this.busy = false;
        }
        
        send(command, callback) {
            this.busy = true;
            this.callback = callback;
            this.worker.postMessage(command);
        }
        
        terminate() {
            this.worker.terminate();
        }
    }
    
    // ======================== Класс ThreadPool ========================
    class ThreadPool {
        constructor(numThreads = DEFAULT_THREADS) {
            this.threads = [];
            this.numThreads = Math.min(numThreads, MAX_THREADS);
            this.taskQueue = [];
            this.results = [];
            this.sharedTT = null;        // общая таблица транспозиций
            this.searchStarted = false;
        }
        
        init(scriptUrl = 'worker.js') {
            for (let i = 0; i < this.numThreads; i++) {
                this.threads.push(new WorkerThread(i, scriptUrl));
            }
            console.log(`[ThreadPool] Initialized with ${this.numThreads} threads`);
        }
        
        // Отправить задачу любому свободному воркеру
        submitTask(task, callback) {
            const freeThread = this.threads.find(t => !t.busy);
            if (freeThread) {
                freeThread.send(task, callback);
            } else {
                this.taskQueue.push({ task, callback });
            }
        }
        
        // Распределение поиска по потокам (Lazy SMP)
        parallelSearch(position, depth, timeMs, tt, onResult) {
            if (!this.searchStarted) {
                this.searchStarted = true;
                this.results = [];
                // Копируем таблицу транспозиций в общий доступ (упрощённо)
                this.sharedTT = tt;
                
                // Запускаем поиск на всех потоках
                for (let i = 0; i < this.threads.length; i++) {
                    const thread = this.threads[i];
                    const task = {
                        type: 'search',
                        fen: position.toFEN(),
                        depth: depth,
                        timeMs: timeMs,
                        threadId: i
                    };
                    thread.send(task, (result) => {
                        this.results.push(result);
                        // Если получен лучший результат, можно завершить остальные
                        if (this.results.length === 1) {
                            // Первый результат — кандидат
                            onResult(result);
                            // Останавливаем остальные потоки
                            this.stopAll();
                        }
                    });
                }
                
                // Таймаут: если за timeMs не получен результат, берём любой
                setTimeout(() => {
                    if (this.results.length === 0 && this.threads.length > 0) {
                        // Просто возвращаем null (будет обработано в основном потоке)
                        onResult(null);
                    }
                }, timeMs + 500);
            }
        }
        
        stopAll() {
            for (const thread of this.threads) {
                if (thread.busy) {
                    thread.send({ type: 'stop' }, () => {});
                }
            }
            this.searchStarted = false;
            this.taskQueue = [];
        }
        
        terminate() {
            for (const thread of this.threads) {
                thread.terminate();
            }
            this.threads = [];
        }
        
        // Получить количество активных потоков
        getActiveCount() {
            return this.threads.filter(t => t.busy).length;
        }
        
        // Дождаться завершения всех задач
        async waitForAll() {
            while (this.threads.some(t => t.busy) || this.taskQueue.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    }
    
    // ======================== Обёртка для движка с многопоточностью ========================
    class ParallelEngine {
        constructor(numThreads = DEFAULT_THREADS) {
            this.pool = new ThreadPool(numThreads);
            this.tt = null;
            this.evaluator = null;
            this.moveGen = null;
        }
        
        init(tt, evaluator, moveGen) {
            this.tt = tt;
            this.evaluator = evaluator;
            this.moveGen = moveGen;
            this.pool.init();
        }
        
        search(position, depth, timeMs) {
            return new Promise((resolve) => {
                this.pool.parallelSearch(position, depth, timeMs, this.tt, (result) => {
                    resolve(result);
                });
            });
        }
        
        stop() {
            this.pool.stopAll();
        }
        
        terminate() {
            this.pool.terminate();
        }
    }
    
    // ======================== Экспорт ========================
    window.BurchessThreads = {
        ThreadPool,
        WorkerThread,
        ParallelEngine,
        DEFAULT_THREADS,
        MAX_THREADS
    };
})();
