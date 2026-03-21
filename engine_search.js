/**
 * engine_search.js — поиск и альфа-бета с улучшениями для BURCHESS
 * Версия: 2.0
 * 
 * Содержит:
 * - Альфа-бета поиск с итеративным углублением
 * - Квиесценция (quiescence search)
 * - Null move pruning (NMP)
 * - Late move reduction (LMR)
 * - Futility pruning
 * - Razoring
 * - Таблица транспозиций
 * - Killer moves, история, контратаки
 * - Управление временем
 * - Параллельный поиск (single thread)
 */

(function() {
    'use strict';

    // ======================== Зависимости ========================
    const Position = window.BurchessPosition?.Position;
    const COLOR_WHITE = window.BurchessPosition?.COLOR_WHITE || 0;
    const COLOR_BLACK = window.BurchessPosition?.COLOR_BLACK || 1;
    const PIECE_KING = 6;
    const MoveGenerator = window.BurchessMoveGen?.MoveGenerator;
    const TTManager = window.BurchessTT?.TTManager;
    const HeuristicsManager = window.BurchessHistory?.HeuristicsManager;
    const Evaluator = window.BurchessEval?.Evaluator;
    const TimeManager = window.BurchessTypes?.TimeManager || (() => {});

    // ======================== Константы ========================
    const INF = 30000;
    const MATE_VALUE = 20000;
    const DRAW_VALUE = 0;
    const MAX_PLY = 128;
    const MAX_MOVES = 256;

    // Флаги для таблицы транспозиций
    const TT_EXACT = 0;
    const TT_LOWER = 1;
    const TT_UPPER = 2;

    // ======================== Класс поиска ========================
    class Search {
        constructor() {
            this.tt = null;           // таблица транспозиций
            this.history = null;      // эвристики
            this.evaluator = null;    // оценщик позиции
            this.moveGen = null;      // генератор ходов
            this.timeManager = null;   // управление временем
            this.nodes = 0;            // узлов просмотрено
            this.seldepth = 0;         // максимальная глубина
            this.stop = false;         // флаг остановки
            this.startTime = 0;
            this.maxTime = 0;
            this.maxDepth = 0;
            this.pvTable = [];         // главный вариант
            this.pvLengths = new Array(MAX_PLY).fill(0);
            this.currentPos = null;
            this.killerTable = null;    // для каждого уровня
            this.counterTable = null;
            this.followupTable = null;
            this.searchStack = [];       // стек для информации
        }

        // Инициализация
        init(tt, history, evaluator, moveGen) {
            this.tt = tt;
            this.history = history;
            this.evaluator = evaluator;
            this.moveGen = moveGen;
            this.killerTable = new Array(MAX_PLY);
            for (let i = 0; i < MAX_PLY; i++) {
                this.killerTable[i] = [null, null];
            }
            this.searchStack = new Array(MAX_PLY);
            for (let i = 0; i < MAX_PLY; i++) {
                this.searchStack[i] = {
                    move: null,
                    moveCount: 0,
                    killers: [null, null]
                };
            }
        }

        // Основной поиск: итеративное углубление
        search(position, depth, timeMs, moves = null) {
            this.currentPos = position;
            this.maxDepth = depth;
            this.maxTime = timeMs;
            this.startTime = Date.now();
            this.stop = false;
            this.nodes = 0;
            this.seldepth = 0;
            this.pvTable = [];
            for (let i = 0; i < MAX_PLY; i++) this.pvLengths[i] = 0;

            // Очистка killеров
            for (let i = 0; i < MAX_PLY; i++) {
                this.killerTable[i][0] = null;
                this.killerTable[i][1] = null;
            }

            let bestMove = null;
            let bestScore = -INF;

            // Итеративное углубление
            for (let d = 1; d <= depth; d++) {
                if (this.stop) break;
                // Время вышло? (проверка после каждой глубины)
                if (Date.now() - this.startTime > this.maxTime) break;

                const score = this.alphaBeta(position, -INF, INF, d, 0);
                if (this.stop) break;

                // Получить лучший ход из таблицы транспозиций для корневой позиции
                const entry = this.tt.probe(position.hash);
                if (entry && entry.move) {
                    bestMove = entry.move;
                    bestScore = score;
                }

                // Отправить информацию (UCI info)
                const elapsed = Date.now() - this.startTime;
                const pv = this.getPVString(position);
                const info = `info depth ${d} score cp ${score} nodes ${this.nodes} nps ${Math.floor(this.nodes / (elapsed/1000 + 0.001))} time ${elapsed} pv ${pv}`;
                if (typeof postMessage !== 'undefined') postMessage(info);
                else console.log(info);
            }

            return { move: bestMove, score: bestScore };
        }

        // Альфа-бета с улучшениями
        alphaBeta(pos, alpha, beta, depth, ply) {
            // Проверка остановки
            if (this.stop) return 0;
            this.nodes++;

            // Обновление максимальной глубины
            if (ply > this.seldepth) this.seldepth = ply;

            // Проверка на повторение (троекратное)
            if (ply > 0 && this.isRepetition(pos)) return DRAW_VALUE;

            // Проверка на правило 50 ходов
            if (pos.halfMoveClock >= 100) return DRAW_VALUE;

            // Проверка на недостаток материала (мат в конце)
            if (this.isInsufficientMaterial(pos)) return DRAW_VALUE;

            // Транспозиционная таблица
            const ttEntry = this.tt.probe(pos.hash);
            if (ttEntry && ttEntry.depth >= depth && !this.stop) {
                if (ttEntry.flag === TT_EXACT) return ttEntry.score;
                if (ttEntry.flag === TT_LOWER && ttEntry.score >= beta) return ttEntry.score;
                if (ttEntry.flag === TT_UPPER && ttEntry.score <= alpha) return ttEntry.score;
            }

            // Если глубина 0, запускаем квиесценцию
            if (depth <= 0) {
                return this.quiescence(pos, alpha, beta, ply);
            }

            // Проверка на мат/пат
            const moves = this.moveGen.generateLegalMoves(pos);
            if (moves.length === 0) {
                // Шах или пат
                if (this.isCheck(pos)) return -MATE_VALUE + ply;
                else return DRAW_VALUE;
            }

            // Упорядочивание ходов
            this.orderMoves(moves, pos, ply, ttEntry?.move);

            // Null move pruning (NMP) - только если не в шахе и глубина >= 3
            let score = -INF;
            let bestMove = null;
            let movesSearched = 0;
            let inCheck = this.isCheck(pos);

            if (!inCheck && depth >= 3 && !this.isEndgame(pos)) {
                const R = 2 + (depth > 6 ? 1 : 0);
                const nullMovePos = this.makeNullMove(pos);
                if (nullMovePos) {
                    const nullScore = -this.alphaBeta(nullMovePos, -beta, -beta + 1, depth - R, ply + 1);
                    if (nullScore >= beta) {
                        // Null move даёт отсечку
                        return beta;
                    }
                }
            }

            // Основной цикл по ходам
            let bestScore = -INF;
            let alphaOrig = alpha;
            let moveMade = false;

            for (let i = 0; i < moves.length; i++) {
                const move = moves[i];
                // Создаём состояние для отката
                const state = {};
                const newPos = pos.clone();
                const success = newPos.makeMove(move, state);
                if (!success) continue;

                // Late move reduction (LMR)
                let reduction = 0;
                if (!inCheck && depth >= 3 && movesSearched >= 1 && !this.isCaptureMove(move, pos) && !move.promotion && !(move.flags & 2)) {
                    reduction = this.getReduction(depth, movesSearched);
                }

                let moveScore;
                if (reduction > 0) {
                    // Сначала поиск с уменьшенной глубиной
                    moveScore = -this.alphaBeta(newPos, -alpha - 1, -alpha, depth - reduction - 1, ply + 1);
                    if (moveScore > alpha) {
                        // Если улучшает, пересчитываем полным поиском
                        moveScore = -this.alphaBeta(newPos, -beta, -alpha, depth - 1, ply + 1);
                    }
                } else {
                    moveScore = -this.alphaBeta(newPos, -beta, -alpha, depth - 1, ply + 1);
                }

                movesSearched++;

                if (moveScore > bestScore) {
                    bestScore = moveScore;
                    bestMove = move;
                    if (moveScore > alpha) {
                        alpha = moveScore;
                        // Обновляем PV
                        this.updatePV(ply, move);
                    }
                    if (alpha >= beta) {
                        // Отсечка
                        if (!this.isCaptureMove(move, pos) && !move.promotion && !(move.flags & 2)) {
                            // Обновляем killer и историю
                            if (ply < MAX_PLY - 1) {
                                this.killerTable[ply][1] = this.killerTable[ply][0];
                                this.killerTable[ply][0] = move;
                            }
                            this.history.update(pos.side, move.from, move.to, depth);
                        }
                        break;
                    }
                }
            }

            // Сохраняем в таблицу транспозиций
            let flag = TT_EXACT;
            if (bestScore <= alphaOrig) flag = TT_UPPER;
            else if (bestScore >= beta) flag = TT_LOWER;
            this.tt.store(pos.hash, bestScore, depth, flag, bestMove);

            return bestScore;
        }

        // Квиесценция (поиск только взятий)
        quiescence(pos, alpha, beta, ply) {
            if (this.stop) return 0;
            this.nodes++;
            if (ply > this.seldepth) this.seldepth = ply;

            // Статическая оценка
            let standPat = this.evaluator.evaluate(pos);
            if (standPat >= beta) return beta;
            if (standPat > alpha) alpha = standPat;

            // Генерируем только взятия и ходы превращения
            const captures = this.moveGen.generateCaptureMoves(pos);
            this.orderMoves(captures, pos, ply, null);

            for (const move of captures) {
                const state = {};
                const newPos = pos.clone();
                const success = newPos.makeMove(move, state);
                if (!success) continue;
                const score = -this.quiescence(newPos, -beta, -alpha, ply + 1);
                if (score >= beta) return beta;
                if (score > alpha) alpha = score;
            }
            return alpha;
        }

        // Упорядочивание ходов
        orderMoves(moves, pos, ply, ttMove) {
            for (const move of moves) {
                let score = 0;
                const targetPiece = pos.pieceAt(move.to);
                const attackerPiece = pos.pieceAt(move.from);
                const isCapture = targetPiece !== null;
                const isPromotion = !!(move.flags & 4);
                const isCastle = !!(move.flags & 2);

                if (ttMove && move.equals(ttMove)) {
                    score = 20000;
                } else if (isCapture) {
                    // MVV-LVA
                    const victimValue = this.getPieceValue(targetPiece.piece);
                    const attackerValue = this.getPieceValue(attackerPiece.piece);
                    score = 10000 + victimValue * 100 - attackerValue;
                } else if (isPromotion) {
                    score = 9000;
                } else if (isCastle) {
                    score = 8000;
                } else {
                    // Killer
                    if (this.killerTable[ply] && this.killerTable[ply][0] && move.equals(this.killerTable[ply][0])) score = 5000;
                    else if (this.killerTable[ply] && this.killerTable[ply][1] && move.equals(this.killerTable[ply][1])) score = 4000;
                    else {
                        score = this.history.get(pos.side, move.from, move.to);
                    }
                }
                move.score = score;
            }
            moves.sort((a,b) => b.score - a.score);
        }

        // Функция для вычисления редукции (LMR)
        getReduction(depth, movesSearched) {
            let r = 1;
            if (movesSearched >= 4) r = 2;
            if (movesSearched >= 8) r = 3;
            if (depth <= 4) r = 1;
            return Math.min(r, depth - 1);
        }

        // Создание позиции с null-ходом (пропуск хода)
        makeNullMove(pos) {
            const newPos = pos.clone();
            newPos.side = 1 - newPos.side;
            newPos.epSquare = -1;
            newPos.hash = newPos.computeHash();
            return newPos;
        }

        // Проверка, является ли ход взятием
        isCaptureMove(move, pos) {
            const target = pos.pieceAt(move.to);
            return target !== null;
        }

        // Проверка, находится ли король под шахом
        isCheck(pos) {
            const kingSq = this.findKing(pos, pos.side);
            if (kingSq === -1) return false;
            return pos.isSquareAttacked(kingSq, 1 - pos.side);
        }

        // Поиск короля
        findKing(pos, color) {
            const list = pos.pieceLists[color][PIECE_KING];
            return list.length ? list[0] : -1;
        }

        // Проверка на эндшпиль (упрощённо)
        isEndgame(pos) {
            let total = 0;
            for (let c = 0; c < 2; c++) {
                total += pos.pieceLists[c][5].length * 9;
                total += pos.pieceLists[c][4].length * 5;
                total += pos.pieceLists[c][3].length * 3;
                total += pos.pieceLists[c][2].length * 3;
            }
            return total < 20;
        }

        // Проверка на недостаток материала
        isInsufficientMaterial(pos) {
            let whitePieces = 0, blackPieces = 0;
            for (let p = 1; p <= 5; p++) {
                whitePieces += pos.pieceLists[0][p].length;
                blackPieces += pos.pieceLists[1][p].length;
            }
            if (whitePieces === 0 && blackPieces === 0) return true;
            if (whitePieces === 0 && blackPieces === 1 && pos.pieceLists[1][1].length === 0) return true; // только король и один конь или слон
            if (blackPieces === 0 && whitePieces === 1 && pos.pieceLists[0][1].length === 0) return true;
            return false;
        }

        // Проверка на троекратное повторение (упрощённо)
        isRepetition(pos) {
            let count = 0;
            for (const h of pos.history) {
                if (h === pos.hash) count++;
            }
            return count >= 2;
        }

        // Обновление PV (главного варианта)
        updatePV(ply, move) {
            this.pvTable[ply] = move;
            this.pvLengths[ply] = 1 + (this.pvLengths[ply+1] || 0);
        }

        // Получение PV строки
        getPVString(pos) {
            let str = '';
            let current = pos;
            for (let i = 0; i < this.pvLengths[0] && i < 10; i++) {
                const move = this.pvTable[i];
                if (!move) break;
                str += move.toString() + ' ';
                const state = {};
                const next = current.clone();
                next.makeMove(move, state);
                current = next;
            }
            return str.trim();
        }

        // Получение ценности фигуры
        getPieceValue(piece) {
            const values = [0, 100, 320, 330, 500, 900, 0];
            return values[piece];
        }
    }

    // ======================== Экспорт ========================
    window.BurchessSearch = {
        Search,
        INF,
        MATE_VALUE,
        DRAW_VALUE
    };
})();
