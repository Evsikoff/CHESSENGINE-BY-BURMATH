/**
 * engine_tt.js — таблица транспозиций (Transposition Table) для BURCHESS
 * Версия: 2.0
 * 
 * Содержит:
 * - Класс TranspositionTable для хранения результатов поиска
 * - Реализацию хранения записей с глубиной, оценкой, лучшим ходом, флагом
 * - Замещение записей (always replace, depth-preferred, и другие стратегии)
 * - Поддержка разных типов оценок: точная (exact), нижняя граница (lower), верхняя граница (upper)
 * - Функции для сохранения и извлечения позиций по Zobrist хешу
 * - Управление возрастом записей для очистки
 */

(function() {
    'use strict';

    // ======================== Константы ========================
    const TT_EXACT = 0;      // точная оценка
    const TT_LOWER = 1;      // нижняя граница (alpha)
    const TT_UPPER = 2;      // верхняя граница (beta)
    
    const DEFAULT_SIZE_MB = 32;  // 32 MB по умолчанию
    const ENTRY_SIZE = 24;       // примерный размер записи в байтах (хеш 8, оценка 4, глубина 2, флаг 1, ход 4, возраст 1, выравнивание)
    
    // ======================== Класс записи таблицы ========================
    class TTEntry {
        constructor() {
            this.hash = 0n;          // 64-битный Zobrist хеш
            this.score = 0;          // оценка в сотых пешки
            this.depth = 0;          // глубина поиска
            this.flag = TT_EXACT;    // тип оценки
            this.move = null;        // лучший ход (объект Move)
            this.age = 0;            // возраст (для стратегии замещения)
            this.bound = 0;          // дополнительная граница
        }
        
        set(hash, score, depth, flag, move, age) {
            this.hash = hash;
            this.score = score;
            this.depth = depth;
            this.flag = flag;
            this.move = move;
            this.age = age;
        }
        
        clear() {
            this.hash = 0n;
            this.score = 0;
            this.depth = 0;
            this.flag = TT_EXACT;
            this.move = null;
            this.age = 0;
        }
    }
    
    // ======================== Класс таблицы транспозиций ========================
    class TranspositionTable {
        constructor(sizeMB = DEFAULT_SIZE_MB) {
            this.sizeMB = sizeMB;
            this.numEntries = Math.floor((sizeMB * 1024 * 1024) / ENTRY_SIZE);
            this.table = new Array(this.numEntries);
            this.age = 0;
            this.hits = 0;
            this.probes = 0;
            this.inserts = 0;
            this.collisions = 0;
            
            // Инициализация пустыми записями
            for (let i = 0; i < this.numEntries; i++) {
                this.table[i] = new TTEntry();
            }
        }
        
        // Увеличить возраст (вызывается каждый ход)
        incrementAge() {
            this.age = (this.age + 1) & 0xFF;  // 0-255
        }
        
        // Получить запись по хешу
        probe(hash) {
            this.probes++;
            const idx = this.getIndex(hash);
            const entry = this.table[idx];
            if (entry && entry.hash === hash) {
                this.hits++;
                return entry;
            }
            return null;
        }
        
        // Сохранить запись с возможным замещением
        store(hash, score, depth, flag, move, ageOverride = null) {
            this.inserts++;
            const idx = this.getIndex(hash);
            const entry = this.table[idx];
            const entryAge = (ageOverride !== null) ? ageOverride : this.age;
            
            // Стратегия замещения: сохраняем, если запись пуста, или глубина больше, или возраст старше
            if (entry.hash === 0n || depth >= entry.depth || entry.age !== this.age) {
                entry.set(hash, score, depth, flag, move, entryAge);
            } else {
                // Альтернативная стратегия: сохраняем только если оценка лучше (для хеш-коллизий)
                // Для простоты оставляем старую запись, но можно реализовать always replace
                // Здесь используем always replace для новых записей с большей глубиной
                this.collisions++;
            }
        }
        
        // Получить лучший ход из таблицы для позиции
        getBestMove(hash) {
            const entry = this.probe(hash);
            if (entry && entry.move) {
                return entry.move;
            }
            return null;
        }
        
        // Очистить таблицу (сброс всех записей)
        clear() {
            for (let i = 0; i < this.numEntries; i++) {
                this.table[i].clear();
            }
            this.hits = 0;
            this.probes = 0;
            this.inserts = 0;
            this.collisions = 0;
        }
        
        // Получить индекс для хеша (простое маскирование)
        getIndex(hash) {
            // Используем младшие биты для индекса
            return Number(hash % BigInt(this.numEntries));
        }
        
        // Статистика использования
        getStats() {
            return {
                sizeMB: this.sizeMB,
                numEntries: this.numEntries,
                probes: this.probes,
                hits: this.hits,
                hitRate: this.probes ? (this.hits / this.probes * 100).toFixed(2) : 0,
                inserts: this.inserts,
                collisions: this.collisions,
                age: this.age
            };
        }
        
        // Изменение размера таблицы (с потерей данных)
        resize(newSizeMB) {
            this.sizeMB = newSizeMB;
            this.numEntries = Math.floor((newSizeMB * 1024 * 1024) / ENTRY_SIZE);
            const oldTable = this.table;
            this.table = new Array(this.numEntries);
            for (let i = 0; i < this.numEntries; i++) {
                this.table[i] = new TTEntry();
            }
            // Переносим существующие записи (простая перезапись)
            for (const entry of oldTable) {
                if (entry.hash !== 0n) {
                    this.store(entry.hash, entry.score, entry.depth, entry.flag, entry.move, entry.age);
                }
            }
        }
        
        // Предзагрузка из массива записей (для восстановления)
        loadEntries(entries) {
            this.clear();
            for (const e of entries) {
                if (e.hash) {
                    this.store(e.hash, e.score, e.depth, e.flag, e.move, e.age);
                }
            }
        }
        
        // Экспорт всех записей (для отладки)
        exportEntries() {
            const result = [];
            for (const entry of this.table) {
                if (entry.hash !== 0n) {
                    result.push({
                        hash: entry.hash.toString(),
                        score: entry.score,
                        depth: entry.depth,
                        flag: entry.flag,
                        move: entry.move ? { from: entry.move.from, to: entry.move.to, promotion: entry.move.promotion } : null,
                        age: entry.age
                    });
                }
            }
            return result;
        }
    }
    
    // ======================== Обёртка для использования в движке ========================
    class TTManager {
        constructor() {
            this.tt = null;
            this.enabled = true;
        }
        
        init(sizeMB = DEFAULT_SIZE_MB) {
            this.tt = new TranspositionTable(sizeMB);
            return this.tt;
        }
        
        // Получение оценки из таблицы для текущей позиции
        probeScore(hash, depth, alpha, beta) {
            if (!this.enabled || !this.tt) return null;
            const entry = this.tt.probe(hash);
            if (!entry || entry.depth < depth) return null;
            
            let score = entry.score;
            // Корректировка оценки для мата (сохраняем относительность)
            if (Math.abs(score) > 10000) {
                // Матовая оценка требует приведения к текущей глубине
                if (score > 0) score -= entry.depth;
                else score += entry.depth;
            }
            
            // Проверяем границы
            if (entry.flag === TT_EXACT) return score;
            if (entry.flag === TT_LOWER && score >= beta) return score;
            if (entry.flag === TT_UPPER && score <= alpha) return score;
            return null;
        }
        
        // Сохранение оценки
        storeScore(hash, score, depth, flag, move, age = null) {
            if (!this.enabled || !this.tt) return;
            // Приведение матовых оценок
            let storedScore = score;
            if (Math.abs(score) > 10000) {
                if (score > 0) storedScore = score + depth;
                else storedScore = score - depth;
            }
            this.tt.store(hash, storedScore, depth, flag, move, age);
        }
        
        // Получить лучший ход
        getBestMove(hash) {
            if (!this.enabled || !this.tt) return null;
            return this.tt.getBestMove(hash);
        }
        
        // Очистка
        clear() {
            if (this.tt) this.tt.clear();
        }
        
        // Увеличить возраст
        incrementAge() {
            if (this.tt) this.tt.incrementAge();
        }
        
        // Получить статистику
        getStats() {
            return this.tt ? this.tt.getStats() : null;
        }
        
        // Включить/выключить
        setEnabled(enabled) {
            this.enabled = enabled;
        }
    }
    
    // ======================== Экспорт ========================
    window.BurchessTT = {
        TranspositionTable,
        TTManager,
        TTEntry,
        TT_EXACT,
        TT_LOWER,
        TT_UPPER,
        DEFAULT_SIZE_MB
    };
})();
