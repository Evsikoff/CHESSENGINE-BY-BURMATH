/**
 * engine_eval.js — статическая оценка позиции (классическая + NNUE)
 * Версия: 2.0
 * 
 * Содержит:
 * - Материальную оценку (таблицы значений фигур)
 * - Позиционную оценку (таблицы PST для каждой фигуры)
 * - Мобильность, пешечную структуру, контроль центра
 * - Корректировку за рокировку, изолированные пешки, проходные пешки
 * - Функцию eval() для получения оценки позиции в сотых пешки
 * - Подготовку входных данных для NNUE (если используется)
 */

(function() {
    'use strict';

    // ======================== Константы ========================
    const COLOR_WHITE = 0;
    const COLOR_BLACK = 1;
    const PIECE_NONE = 0;
    const PIECE_PAWN = 1;
    const PIECE_KNIGHT = 2;
    const PIECE_BISHOP = 3;
    const PIECE_ROOK = 4;
    const PIECE_QUEEN = 5;
    const PIECE_KING = 6;

    const PIECE_VALUES = [0, 100, 320, 330, 500, 900, 0];  // в сотых пешки

    // Таблицы пешечной структуры (базовые)
    const PAWN_TABLE = [
         0,  0,  0,  0,  0,  0,  0,  0,
         5, 10, 10,-20,-20, 10, 10,  5,
         2,  5,  8, 12, 12,  8,  5,  2,
         1,  2,  4,  8,  8,  4,  2,  1,
         0,  1,  2,  4,  4,  2,  1,  0,
         0,  0,  1,  2,  2,  1,  0,  0,
         0,  0,  0,  0,  0,  0,  0,  0,
         0,  0,  0,  0,  0,  0,  0,  0
    ];

    const KNIGHT_TABLE = [
        -5, -4, -3, -2, -2, -3, -4, -5,
        -4, -2,  0,  1,  1,  0, -2, -4,
        -3,  1,  2,  3,  3,  2,  1, -3,
        -2,  1,  3,  4,  4,  3,  1, -2,
        -2,  1,  3,  4,  4,  3,  1, -2,
        -3,  1,  2,  3,  3,  2,  1, -3,
        -4, -2,  0,  1,  1,  0, -2, -4,
        -5, -4, -3, -2, -2, -3, -4, -5
    ];

    const BISHOP_TABLE = [
        -2, -1, -1, -1, -1, -1, -1, -2,
        -1,  1,  1,  1,  1,  1,  1, -1,
        -1,  1,  3,  3,  3,  3,  1, -1,
        -1,  1,  3,  5,  5,  3,  1, -1,
        -1,  1,  3,  5,  5,  3,  1, -1,
        -1,  1,  3,  3,  3,  3,  1, -1,
        -1,  1,  1,  1,  1,  1,  1, -1,
        -2, -1, -1, -1, -1, -1, -1, -2
    ];

    const ROOK_TABLE = [
        0,  0,  1,  2,  2,  1,  0,  0,
        0,  1,  2,  3,  3,  2,  1,  0,
        0,  1,  2,  3,  3,  2,  1,  0,
        0,  1,  2,  3,  3,  2,  1,  0,
        0,  1,  2,  3,  3,  2,  1,  0,
        0,  1,  2,  3,  3,  2,  1,  0,
        0,  1,  2,  3,  3,  2,  1,  0,
        0,  0,  1,  2,  2,  1,  0,  0
    ];

    const QUEEN_TABLE = [
        -2, -1, -1,  0,  0, -1, -1, -2,
        -1,  0,  1,  1,  1,  1,  0, -1,
        -1,  1,  2,  2,  2,  2,  1, -1,
         0,  1,  2,  3,  3,  2,  1,  0,
         0,  1,  2,  3,  3,  2,  1,  0,
        -1,  1,  2,  2,  2,  2,  1, -1,
        -1,  0,  1,  1,  1,  1,  0, -1,
        -2, -1, -1,  0,  0, -1, -1, -2
    ];

    const KING_MIDDLE_TABLE = [
        -3, -4, -4, -5, -5, -4, -4, -3,
        -3, -4, -4, -5, -5, -4, -4, -3,
        -3, -4, -4, -5, -5, -4, -4, -3,
        -3, -4, -4, -5, -5, -4, -4, -3,
        -2, -3, -3, -4, -4, -3, -3, -2,
        -1, -2, -2, -2, -2, -2, -2, -1,
         2,  2,  1,  0,  0,  1,  2,  2,
         4,  5,  3,  0,  0,  3,  5,  4
    ];

    const KING_ENDGAME_TABLE = [
        -5, -4, -3, -2, -2, -3, -4, -5,
        -3, -2, -1,  0,  0, -1, -2, -3,
        -2, -1,  1,  2,  2,  1, -1, -2,
        -1,  0,  2,  3,  3,  2,  0, -1,
        -1,  0,  2,  3,  3,  2,  0, -1,
        -2, -1,  1,  2,  2,  1, -1, -2,
        -3, -2, -1,  0,  0, -1, -2, -3,
        -5, -4, -3, -2, -2, -3, -4, -5
    ];

    // Функция для получения таблицы с учётом цвета (зеркалирование для чёрных)
    function mirrorSquare(sq) {
        const rank = Math.floor(sq / 8);
        const file = sq % 8;
        return (7 - rank) * 8 + file;
    }

    class Evaluator {
        constructor() {
            this.useNNUE = false;  // флаг использования нейросети (можно включить позже)
            this.nnue = null;      // будет инициализирован в engine_nnue.js
        }

        // Основная функция оценки позиции
        evaluate(pos) {
            let score = 0;
            const isEndgame = this.isEndgame(pos);
            // Материальная оценка
            score += this.evaluateMaterial(pos);
            // Позиционная оценка
            score += this.evaluatePositional(pos, isEndgame);
            // Мобильность (упрощённо)
            score += this.evaluateMobility(pos);
            // Пешечная структура (изолированные, сдвоенные, проходные)
            score += this.evaluatePawnStructure(pos);
            // Центр и контроль
            score += this.evaluateCenterControl(pos);
            // Рокировка
            score += this.evaluateCastling(pos);
            // Возвращаем оценку с точки зрения белых
            return score;
        }

        // Материальная оценка
        evaluateMaterial(pos) {
            let material = 0;
            for (let sq = 0; sq < 64; sq++) {
                const piece = pos.board[sq];
                if (piece !== PIECE_NONE) {
                    const color = pos.colors[sq];
                    const value = PIECE_VALUES[piece];
                    if (color === COLOR_WHITE) material += value;
                    else material -= value;
                }
            }
            return material;
        }

        // Позиционная оценка (PST)
        evaluatePositional(pos, isEndgame) {
            let positional = 0;
            for (let sq = 0; sq < 64; sq++) {
                const piece = pos.board[sq];
                if (piece === PIECE_NONE) continue;
                const color = pos.colors[sq];
                let table;
                switch (piece) {
                    case PIECE_PAWN: table = PAWN_TABLE; break;
                    case PIECE_KNIGHT: table = KNIGHT_TABLE; break;
                    case PIECE_BISHOP: table = BISHOP_TABLE; break;
                    case PIECE_ROOK: table = ROOK_TABLE; break;
                    case PIECE_QUEEN: table = QUEEN_TABLE; break;
                    case PIECE_KING: table = isEndgame ? KING_ENDGAME_TABLE : KING_MIDDLE_TABLE; break;
                    default: continue;
                }
                const index = (color === COLOR_WHITE) ? sq : mirrorSquare(sq);
                const value = table[index];
                positional += (color === COLOR_WHITE) ? value : -value;
            }
            return positional;
        }

        // Мобильность (количество ходов)
        evaluateMobility(pos) {
            // Упрощённо: считаем количество ходов для каждой фигуры (без учёта шахов)
            let mobility = 0;
            const side = pos.side;
            const moves = this.generateMobilityMoves(pos, COLOR_WHITE);
            mobility += moves * 2;   // каждый ход даёт +2 сотых
            const movesBlack = this.generateMobilityMoves(pos, COLOR_BLACK);
            mobility -= movesBlack * 2;
            return mobility;
        }

        generateMobilityMoves(pos, color) {
            // Простейшая генерация ходов (только псевдо-легальные) для подсчёта
            let count = 0;
            const allPieces = this.getAllBB(pos);
            const ourPieces = (color === COLOR_WHITE) ? this.getWhiteBB(pos) : this.getBlackBB(pos);
            const oppPieces = (color === COLOR_WHITE) ? this.getBlackBB(pos) : this.getWhiteBB(pos);
            const knightAttacks = window.BurchessBitBoard?.KNIGHT_ATTACKS;
            const kingAttacks = window.BurchessBitBoard?.KING_ATTACKS;
            const getBishopAttacks = window.BurchessBitBoard?.getBishopAttacks;
            const getRookAttacks = window.BurchessBitBoard?.getRookAttacks;
            const getQueenAttacks = window.BurchessBitBoard?.getQueenAttacks;

            // Пешки
            let pawns = (color === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_PAWN] : pos.pieceLists[COLOR_BLACK][PIECE_PAWN];
            for (const from of pawns) {
                const forward = (color === COLOR_WHITE) ? -8 : 8;
                const to = from + forward;
                if (to >= 0 && to < 64 && ((allPieces >> BigInt(to)) & 1n) === 0n) count++;
                if (color === COLOR_WHITE && Math.floor(from / 8) === 6) {
                    const to2 = from - 16;
                    if (((allPieces >> BigInt(to2)) & 1n) === 0n) count++;
                }
                if (color === COLOR_BLACK && Math.floor(from / 8) === 1) {
                    const to2 = from + 16;
                    if (((allPieces >> BigInt(to2)) & 1n) === 0n) count++;
                }
                // Взятия
                for (const delta of [-1, 1]) {
                    const to = from + forward + delta;
                    if (to >= 0 && to < 64 && Math.abs((to % 8) - (from % 8)) === 1) {
                        if (((oppPieces >> BigInt(to)) & 1n) !== 0n) count++;
                    }
                }
            }

            // Кони
            let knights = (color === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_KNIGHT] : pos.pieceLists[COLOR_BLACK][PIECE_KNIGHT];
            for (const from of knights) {
                const attacks = knightAttacks[from] & ~ourPieces;
                count += Utils.popCount(attacks);
            }

            // Слоны
            let bishops = (color === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_BISHOP] : pos.pieceLists[COLOR_BLACK][PIECE_BISHOP];
            for (const from of bishops) {
                const attacks = getBishopAttacks(from, allPieces) & ~ourPieces;
                count += Utils.popCount(attacks);
            }

            // Ладьи
            let rooks = (color === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_ROOK] : pos.pieceLists[COLOR_BLACK][PIECE_ROOK];
            for (const from of rooks) {
                const attacks = getRookAttacks(from, allPieces) & ~ourPieces;
                count += Utils.popCount(attacks);
            }

            // Ферзи
            let queens = (color === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_QUEEN] : pos.pieceLists[COLOR_BLACK][PIECE_QUEEN];
            for (const from of queens) {
                const attacks = getQueenAttacks(from, allPieces) & ~ourPieces;
                count += Utils.popCount(attacks);
            }

            // Король
            let kings = (color === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_KING] : pos.pieceLists[COLOR_BLACK][PIECE_KING];
            for (const from of kings) {
                const attacks = kingAttacks[from] & ~ourPieces;
                count += Utils.popCount(attacks);
            }

            return count;
        }

        // Пешечная структура (изолированные, сдвоенные, проходные)
        evaluatePawnStructure(pos) {
            let score = 0;
            const whitePawns = pos.pieceLists[COLOR_WHITE][PIECE_PAWN];
            const blackPawns = pos.pieceLists[COLOR_BLACK][PIECE_PAWN];

            // Изолированные пешки
            const isolated = (pawns, color) => {
                let penalty = 0;
                for (const sq of pawns) {
                    const file = sq % 8;
                    let hasNeighbor = false;
                    for (const other of pawns) {
                        const otherFile = other % 8;
                        if (Math.abs(file - otherFile) === 1) { hasNeighbor = true; break; }
                    }
                    if (!hasNeighbor) penalty += 10;
                }
                return penalty;
            };
            score -= isolated(whitePawns, COLOR_WHITE) * 2;
            score += isolated(blackPawns, COLOR_BLACK) * 2;

            // Сдвоенные пешки
            const doubled = (pawns, color) => {
                let penalty = 0;
                const fileCount = new Array(8).fill(0);
                for (const sq of pawns) {
                    fileCount[sq % 8]++;
                }
                for (let f = 0; f < 8; f++) {
                    if (fileCount[f] > 1) penalty += (fileCount[f] - 1) * 15;
                }
                return penalty;
            };
            score -= doubled(whitePawns, COLOR_WHITE) * 3;
            score += doubled(blackPawns, COLOR_BLACK) * 3;

            // Проходные пешки
            const passed = (pawns, color, enemyPawns) => {
                let bonus = 0;
                for (const sq of pawns) {
                    const file = sq % 8;
                    const rank = Math.floor(sq / 8);
                    let blocked = false;
                    for (const enemy of enemyPawns) {
                        const enemyFile = enemy % 8;
                        const enemyRank = Math.floor(enemy / 8);
                        if (enemyFile === file && ((color === COLOR_WHITE && enemyRank < rank) || (color === COLOR_BLACK && enemyRank > rank))) {
                            blocked = true;
                            break;
                        }
                        if (Math.abs(enemyFile - file) === 1 && ((color === COLOR_WHITE && enemyRank <= rank) || (color === COLOR_BLACK && enemyRank >= rank))) {
                            blocked = true;
                            break;
                        }
                    }
                    if (!blocked) {
                        const distToPromotion = (color === COLOR_WHITE) ? rank : 7 - rank;
                        bonus += (7 - distToPromotion) * 8;
                    }
                }
                return bonus;
            };
            score += passed(whitePawns, COLOR_WHITE, blackPawns);
            score -= passed(blackPawns, COLOR_BLACK, whitePawns);

            return score;
        }

        // Центр и контроль
        evaluateCenterControl(pos) {
            let score = 0;
            const centerSquares = [27, 28, 35, 36]; // d4, e4, d5, e5
            for (const sq of centerSquares) {
                const piece = pos.pieceAt(sq);
                if (piece) {
                    const value = PIECE_VALUES[piece.piece] / 10;
                    score += (piece.color === COLOR_WHITE) ? value : -value;
                }
            }
            return score;
        }

        // Рокировка (бонус, если рокировка ещё возможна)
        evaluateCastling(pos) {
            let score = 0;
            if (pos.castling.whiteK) score += 20;
            if (pos.castling.whiteQ) score += 20;
            if (pos.castling.blackK) score -= 20;
            if (pos.castling.blackQ) score -= 20;
            return score;
        }

        // Определение эндшпиля (мало фигур)
        isEndgame(pos) {
            let total = 0;
            for (let c = 0; c < 2; c++) {
                total += pos.pieceLists[c][PIECE_QUEEN].length * 9;
                total += pos.pieceLists[c][PIECE_ROOK].length * 5;
                total += pos.pieceLists[c][PIECE_BISHOP].length * 3;
                total += pos.pieceLists[c][PIECE_KNIGHT].length * 3;
            }
            return total < 20;  // если общая сила меньше 20, считаем эндшпилем
        }

        // Вспомогательные битовые функции
        getWhiteBB(pos) {
            let bb = 0n;
            for (let p = 1; p <= 6; p++) {
                for (const sq of pos.pieceLists[COLOR_WHITE][p]) {
                    bb |= 1n << BigInt(sq);
                }
            }
            return bb;
        }

        getBlackBB(pos) {
            let bb = 0n;
            for (let p = 1; p <= 6; p++) {
                for (const sq of pos.pieceLists[COLOR_BLACK][p]) {
                    bb |= 1n << BigInt(sq);
                }
            }
            return bb;
        }

        getAllBB(pos) {
            return this.getWhiteBB(pos) | this.getBlackBB(pos);
        }

        // NNUE оценка (если включена)
        evaluateNNUE(pos) {
            if (!this.useNNUE || !this.nnue) return 0;
            // Здесь будет вызов нейросетевой оценки
            return this.nnue.evaluate(pos);
        }
    }

    // Экспорт
    window.BurchessEval = {
        Evaluator,
        PIECE_VALUES,
        PAWN_TABLE,
        KNIGHT_TABLE,
        BISHOP_TABLE,
        ROOK_TABLE,
        QUEEN_TABLE,
        KING_MIDDLE_TABLE,
        KING_ENDGAME_TABLE
    };
})();
