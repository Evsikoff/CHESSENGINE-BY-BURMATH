/**
 * engine_history.js — эвристики для улучшения упорядочивания ходов
 * Версия: 2.0
 * 
 * Содержит:
 * - История ходов (History Heuristic) — веса для тихих ходов
 * - Killer Moves — запоминание хороших ходов на каждой глубине
 * - Counter Moves — запоминание ответов на конкретные ходы
 * - Follow-up Moves — улучшение упорядочивания на основе предыдущего хода
 * - Сброс статистики при перезапуске поиска
 * - Поддержка адаптивного обучения
 */

(function() {
    'use strict';

    // ======================== Константы ========================
    const MAX_PLY = 128;
    const MAX_HISTORY = 16384;
    const HISTORY_LIMIT = 10000;
    const KILLER_SLOTS = 2;

    // ======================== История ходов (History Heuristic) ========================
    class HistoryTable {
        constructor() {
            // [color][from][to] — вес хода для каждого цвета
            this.history = new Array(2);
            for (let c = 0; c < 2; c++) {
                this.history[c] = new Array(64);
                for (let f = 0; f < 64; f++) {
                    this.history[c][f] = new Array(64);
                    for (let t = 0; t < 64; t++) {
                        this.history[c][f][t] = 0;
                    }
                }
            }
            this.maxValue = 0;
        }

        // Очистить таблицу
        clear() {
            for (let c = 0; c < 2; c++) {
                for (let f = 0; f < 64; f++) {
                    for (let t = 0; t < 64; t++) {
                        this.history[c][f][t] = 0;
                    }
                }
            }
            this.maxValue = 0;
        }

        // Получить вес хода
        get(color, from, to) {
            return this.history[color][from][to];
        }

        // Обновить вес хода (увеличить)
        update(color, from, to, depth) {
            const bonus = depth * depth;
            const newValue = this.history[color][from][to] + bonus;
            if (newValue > HISTORY_LIMIT) {
                // Масштабирование при переполнении
                for (let c = 0; c < 2; c++) {
                    for (let f = 0; f < 64; f++) {
                        for (let t = 0; t < 64; t++) {
                            this.history[c][f][t] = Math.floor(this.history[c][f][t] / 2);
                        }
                    }
                }
                this.history[color][from][to] = newValue / 2;
            } else {
                this.history[color][from][to] = newValue;
            }
            if (this.history[color][from][to] > this.maxValue) this.maxValue = this.history[color][from][to];
        }

        // Уменьшить вес (для неоправдавшихся ходов)
        penalize(color, from, to, depth) {
            const penalty = depth * depth;
            const newValue = this.history[color][from][to] - penalty;
            this.history[color][from][to] = Math.max(0, newValue);
        }
    }

    // ======================== Killer Moves (по глубине) ========================
    class KillerTable {
        constructor(ply = MAX_PLY) {
            this.killers = new Array(ply);
            for (let i = 0; i < ply; i++) {
                this.killers[i] = [null, null];
            }
            this.ply = ply;
        }

        // Добавить ход как killer на глубине depth
        add(depth, move) {
            if (!move) return;
            const killers = this.killers[depth];
            if (killers[0] && killers[0].equals(move)) return;
            // Сдвигаем существующие
            killers[1] = killers[0];
            killers[0] = move;
        }

        // Проверить, является ли ход killer на данной глубине
        isKiller(depth, move) {
            const killers = this.killers[depth];
            return (killers[0] && killers[0].equals(move)) || (killers[1] && killers[1].equals(move));
        }

        // Получить killer ходы для глубины
        get(depth) {
            return this.killers[depth] || [null, null];
        }

        // Очистить все killer ходы
        clear() {
            for (let i = 0; i < this.ply; i++) {
                this.killers[i][0] = null;
                this.killers[i][1] = null;
            }
        }
    }

    // ======================== Counter Moves ========================
    class CounterTable {
        constructor() {
            // [color][from][to] -> ответный ход (лучший ответ)
            this.counter = new Array(2);
            for (let c = 0; c < 2; c++) {
                this.counter[c] = new Array(64);
                for (let f = 0; f < 64; f++) {
                    this.counter[c][f] = new Array(64);
                    for (let t = 0; t < 64; t++) {
                        this.counter[c][f][t] = null;
                    }
                }
            }
        }

        // Сохранить ответный ход
        set(color, from, to, responseMove) {
            if (responseMove) {
                this.counter[color][from][to] = responseMove;
            }
        }

        // Получить ответный ход
        get(color, from, to) {
            return this.counter[color][from][to];
        }

        // Очистить
        clear() {
            for (let c = 0; c < 2; c++) {
                for (let f = 0; f < 64; f++) {
                    for (let t = 0; t < 64; t++) {
                        this.counter[c][f][t] = null;
                    }
                }
            }
        }
    }

    // ======================== Follow-up Moves ========================
    class FollowupTable {
        constructor() {
            // [color][from][to] -> лучший следующий ход
            this.followup = new Array(2);
            for (let c = 0; c < 2; c++) {
                this.followup[c] = new Array(64);
                for (let f = 0; f < 64; f++) {
                    this.followup[c][f] = new Array(64);
                    for (let t = 0; t < 64; t++) {
                        this.followup[c][f][t] = null;
                    }
                }
            }
        }

        set(color, from, to, nextMove) {
            if (nextMove) this.followup[color][from][to] = nextMove;
        }

        get(color, from, to) {
            return this.followup[color][from][to];
        }

        clear() {
            for (let c = 0; c < 2; c++) {
                for (let f = 0; f < 64; f++) {
                    for (let t = 0; t < 64; t++) {
                        this.followup[c][f][t] = null;
                    }
                }
            }
        }
    }

    // ======================== Управление эвристиками ========================
    class HeuristicsManager {
        constructor() {
            this.history = new HistoryTable();
            this.killers = new KillerTable();
            this.counters = new CounterTable();
            this.followups = new FollowupTable();
            this.contempt = 0;  // небольшое смещение для игры против слабых соперников
            this.randomness = 0; // для разнообразия
        }

        // Сброс всех эвристик (при новом поиске)
        reset() {
            this.history.clear();
            this.killers.clear();
            this.counters.clear();
            this.followups.clear();
        }

        // Обновление эвристик после завершения поиска (успешные ходы)
        updateSuccess(color, move, depth, isCapture, isQuiet) {
            if (isQuiet && !isCapture && !move.promotion) {
                this.history.update(color, move.from, move.to, depth);
            }
        }

        // Обновление для неудачных ходов (например, при cutoff)
        updateFail(color, move, depth, isQuiet) {
            if (isQuiet) {
                this.history.penalize(color, move.from, move.to, depth);
            }
        }

        // Получить вес хода для сортировки
        getMoveScore(color, move, depth, isKiller, isCapture, victimValue, attackerValue) {
            let score = 0;
            if (isCapture) {
                // MVV-LVA
                score += 10000 + (victimValue * 100) - attackerValue;
            } else {
                // История
                score += this.history.get(color, move.from, move.to);
                // Killer
                if (isKiller) score += 5000;
                // Counter move
                // Можно добавить дополнительные веса
            }
            return score;
        }

        // Сортировка списка ходов (основная функция)
        sortMoves(moves, pos, depth) {
            const color = pos.side;
            for (const move of moves) {
                let score = 0;
                const fromPiece = pos.pieceAt(move.from);
                const toPiece = pos.pieceAt(move.to);
                const isCapture = toPiece !== null;
                const isPromotion = !!(move.flags & 4);
                const isCastle = !!(move.flags & 2);
                const isEnPassant = !!(move.flags & 1);

                if (isCapture) {
                    const victimValue = this.getPieceValue(toPiece.piece);
                    const attackerValue = this.getPieceValue(fromPiece.piece);
                    score = 10000 + victimValue * 100 - attackerValue;
                } else if (isPromotion) {
                    score = 8000;
                } else if (isCastle) {
                    score = 6000;
                } else if (this.killers.isKiller(depth, move)) {
                    score = 5000;
                } else {
                    score = this.history.get(color, move.from, move.to);
                }
                move.score = score;
            }
            moves.sort((a, b) => b.score - a.score);
        }

        getPieceValue(piece) {
            const values = [0, 100, 320, 330, 500, 900, 0];
            return values[piece] || 0;
        }
    }

    // ======================== Экспорт ========================
    window.BurchessHistory = {
        HistoryTable,
        KillerTable,
        CounterTable,
        FollowupTable,
        HeuristicsManager
    };
})();
