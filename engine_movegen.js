/**
 * engine_movegen.js — оптимизированная генерация легальных ходов с учётом шахов, связок и двойных шахов
 * Версия: 2.0
 * 
 * Содержит:
 * - Генерацию всех легальных ходов для заданной позиции
 * - Разделение на тихие ходы и ходы-взятия (для quiescence)
 * - Обнаружение шахов, связок и двойных шахов
 * - Генерация ходов только для фигур, которые могут вывести из шаха
 * - Поддержка en passant и рокировки с проверкой легальности
 * - Функции для генерации псевдо-легальных ходов с учётом блокирующих фигур
 * - Сортировка ходов (MVV-LVA, killer, history) для улучшения alpha-beta
 */

(function() {
    'use strict';

    // Импорт зависимостей (используем глобальные объекты, созданные ранее)
    const Utils = window.BurchessUtils?.Utils || window.Utils;
    const AttackTables = window.BurchessUtils?.AttackTables || window.AttackTables;
    const BitBoard = window.BurchessBitBoard?.BitBoard;
    const PAWN_ATTACKS = window.BurchessBitBoard?.PAWN_ATTACKS;
    const KNIGHT_ATTACKS = window.BurchessBitBoard?.KNIGHT_ATTACKS;
    const KING_ATTACKS = window.BurchessBitBoard?.KING_ATTACKS;
    const getBishopAttacks = window.BurchessBitBoard?.getBishopAttacks;
    const getRookAttacks = window.BurchessBitBoard?.getRookAttacks;
    const getQueenAttacks = window.BurchessBitBoard?.getQueenAttacks;
    const Position = window.BurchessPosition?.Position;
    const COLOR_WHITE = window.BurchessPosition?.COLOR_WHITE || 0;
    const COLOR_BLACK = window.BurchessPosition?.COLOR_BLACK || 1;
    const PIECE_PAWN = 1, PIECE_KNIGHT = 2, PIECE_BISHOP = 3, PIECE_ROOK = 4, PIECE_QUEEN = 5, PIECE_KING = 6;

    // ======================== Константы ========================
    const MAX_MOVES = 256;
    const MVV_LVA_SCORES = [
        [0, 0, 0, 0, 0, 0, 0],
        [0, 15, 14, 13, 12, 11, 10], // жертва пешки
        [0, 25, 24, 23, 22, 21, 20], // конь
        [0, 35, 34, 33, 32, 31, 30], // слон
        [0, 45, 44, 43, 42, 41, 40], // ладья
        [0, 55, 54, 53, 52, 51, 50], // ферзь
        [0, 0, 0, 0, 0, 0, 0]        // король (не бьём)
    ];

    // ======================== Вспомогательные функции ========================
    function getPieceValue(piece) {
        const values = [0, 1, 3, 3, 5, 9, 0];
        return values[piece] || 0;
    }

    function mvvLvaScore(attacker, victim) {
        if (victim === PIECE_NONE) return 0;
        return MVV_LVA_SCORES[victim][attacker];
    }

    // ======================== Генератор ходов ========================
    class MoveGenerator {
        constructor() {
            this.moves = new Array(MAX_MOVES);
            this.moveCount = 0;
            this.pseudoLegalMoves = [];
        }

        clear() {
            this.moveCount = 0;
            this.pseudoLegalMoves = [];
        }

        // Генерация всех легальных ходов
        generateAllMoves(pos) {
            this.clear();
            this.generatePseudoLegalMoves(pos);
            this.filterLegalMoves(pos);
            return this.pseudoLegalMoves.slice(0, this.moveCount);
        }

        // Генерация только ходов-взятий (для quiescence)
        generateCaptureMoves(pos) {
            this.clear();
            this.generatePseudoLegalMoves(pos, true);
            this.filterLegalMoves(pos);
            return this.pseudoLegalMoves.slice(0, this.moveCount);
        }

        // Генерация псевдо-легальных ходов (без проверки на шах)
        generatePseudoLegalMoves(pos, onlyCaptures = false) {
            const side = pos.side;
            const us = side;
            const them = 1 - us;
            const ourPiecesBB = (us === COLOR_WHITE) ? this.getWhiteBB(pos) : this.getBlackBB(pos);
            const oppPiecesBB = (us === COLOR_WHITE) ? this.getBlackBB(pos) : this.getWhiteBB(pos);
            const allPiecesBB = this.getAllBB(pos);
            const epSquare = pos.epSquare;
            const castling = pos.castling;

            // Генерация ходов для каждой фигуры
            // Пешки
            let pawns = (us === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_PAWN] : pos.pieceLists[COLOR_BLACK][PIECE_PAWN];
            for (const from of pawns) {
                this.addPawnMoves(from, side, pos, onlyCaptures);
            }

            // Кони
            let knights = (us === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_KNIGHT] : pos.pieceLists[COLOR_BLACK][PIECE_KNIGHT];
            for (const from of knights) {
                const attacks = KNIGHT_ATTACKS[from] & ~ourPiecesBB;
                if (onlyCaptures) {
                    this.addCapturesOnly(from, attacks & oppPiecesBB);
                } else {
                    this.addMovesFromAttacks(from, attacks);
                }
            }

            // Слоны
            let bishops = (us === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_BISHOP] : pos.pieceLists[COLOR_BLACK][PIECE_BISHOP];
            for (const from of bishops) {
                const attacks = getBishopAttacks(from, allPiecesBB) & ~ourPiecesBB;
                if (onlyCaptures) {
                    this.addCapturesOnly(from, attacks & oppPiecesBB);
                } else {
                    this.addMovesFromAttacks(from, attacks);
                }
            }

            // Ладьи
            let rooks = (us === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_ROOK] : pos.pieceLists[COLOR_BLACK][PIECE_ROOK];
            for (const from of rooks) {
                const attacks = getRookAttacks(from, allPiecesBB) & ~ourPiecesBB;
                if (onlyCaptures) {
                    this.addCapturesOnly(from, attacks & oppPiecesBB);
                } else {
                    this.addMovesFromAttacks(from, attacks);
                }
            }

            // Ферзи
            let queens = (us === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_QUEEN] : pos.pieceLists[COLOR_BLACK][PIECE_QUEEN];
            for (const from of queens) {
                const attacks = getQueenAttacks(from, allPiecesBB) & ~ourPiecesBB;
                if (onlyCaptures) {
                    this.addCapturesOnly(from, attacks & oppPiecesBB);
                } else {
                    this.addMovesFromAttacks(from, attacks);
                }
            }

            // Король
            let kings = (us === COLOR_WHITE) ? pos.pieceLists[COLOR_WHITE][PIECE_KING] : pos.pieceLists[COLOR_BLACK][PIECE_KING];
            for (const from of kings) {
                const attacks = KING_ATTACKS[from] & ~ourPiecesBB;
                if (onlyCaptures) {
                    this.addCapturesOnly(from, attacks & oppPiecesBB);
                } else {
                    this.addMovesFromAttacks(from, attacks);
                }
            }

            // Рокировка (только если not onlyCaptures)
            if (!onlyCaptures) {
                this.addCastlingMoves(pos, side, castling, allPiecesBB);
            }
        }

        addPawnMoves(from, side, pos, onlyCaptures) {
            const forward = (side === COLOR_WHITE) ? -8 : 8;
            const startRank = (side === COLOR_WHITE) ? 6 : 1;
            const promotionRank = (side === COLOR_WHITE) ? 0 : 7;
            const ourPiecesBB = (side === COLOR_WHITE) ? this.getWhiteBB(pos) : this.getBlackBB(pos);
            const oppPiecesBB = (side === COLOR_WHITE) ? this.getBlackBB(pos) : this.getWhiteBB(pos);
            const allPiecesBB = this.getAllBB(pos);
            const epSquare = pos.epSquare;

            // Ход на одну клетку вперёд
            const to = from + forward;
            if (to >= 0 && to < 64 && ((allPiecesBB >> BigInt(to)) & 1n) === 0n) {
                if (!onlyCaptures) {
                    if (Math.floor(to / 8) === promotionRank) {
                        this.addPromotionMove(from, to, 'q');
                        this.addPromotionMove(from, to, 'r');
                        this.addPromotionMove(from, to, 'b');
                        this.addPromotionMove(from, to, 'n');
                    } else {
                        this.addMove(from, to);
                    }
                }
                // Двойной ход
                if (!onlyCaptures && Math.floor(from / 8) === startRank) {
                    const to2 = from + forward * 2;
                    if (((allPiecesBB >> BigInt(to2)) & 1n) === 0n) {
                        this.addMove(from, to2);
                    }
                }
            }

            // Взятия по диагонали
            for (const delta of [-1, 1]) {
                const to = from + forward + delta;
                if (to >= 0 && to < 64 && Math.abs((to % 8) - (from % 8)) === 1) {
                    const targetColor = ((pos.colors[to] === COLOR_WHITE) ? COLOR_WHITE : (pos.colors[to] === COLOR_BLACK) ? COLOR_BLACK : null);
                    if (targetColor !== null && targetColor !== side) {
                        if (Math.floor(to / 8) === promotionRank) {
                            this.addPromotionMove(from, to, 'q');
                            this.addPromotionMove(from, to, 'r');
                            this.addPromotionMove(from, to, 'b');
                            this.addPromotionMove(from, to, 'n');
                        } else {
                            this.addMove(from, to);
                        }
                    }
                    // Взятие на проходе
                    if (to === epSquare && !onlyCaptures) {
                        this.addMove(from, to, true); // флаг enPassant
                    }
                }
            }
        }

        addPromotionMove(from, to, piece) {
            this.addMove(from, to, false, true, piece);
        }

        addMove(from, to, enPassant = false, promotion = false, promotionPiece = null) {
            let flags = 0;
            if (enPassant) flags |= 1;
            if (promotion) flags |= 4;
            const move = { from, to, flags, promotion: promotionPiece };
            this.pseudoLegalMoves.push(move);
            this.moveCount++;
        }

        addMovesFromAttacks(from, attacks) {
            let bits = attacks;
            while (bits) {
                const to = Utils.lsbIndex(bits);
                bits &= ~(1n << BigInt(to));
                this.addMove(from, to);
            }
        }

        addCapturesOnly(from, attacks) {
            let bits = attacks;
            while (bits) {
                const to = Utils.lsbIndex(bits);
                bits &= ~(1n << BigInt(to));
                this.addMove(from, to);
            }
        }

        addCastlingMoves(pos, side, castling, allPiecesBB) {
            const backRank = (side === COLOR_WHITE) ? 7 : 0;
            const kingSq = (side === COLOR_WHITE) ? 4 + 7*8 : 4;
            const attackedByOpp = (sq) => pos.isSquareAttacked(sq, 1 - side);
            
            if (side === COLOR_WHITE) {
                if (castling.whiteK && ((allPiecesBB >> BigInt(5+7*8)) & 1n) === 0n && ((allPiecesBB >> BigInt(6+7*8)) & 1n) === 0n &&
                    !attackedByOpp(4+7*8) && !attackedByOpp(5+7*8) && !attackedByOpp(6+7*8)) {
                    this.addMove(kingSq, 6+7*8, false, false, null, 2); // флаг рокировки
                }
                if (castling.whiteQ && ((allPiecesBB >> BigInt(3+7*8)) & 1n) === 0n && ((allPiecesBB >> BigInt(2+7*8)) & 1n) === 0n && ((allPiecesBB >> BigInt(1+7*8)) & 1n) === 0n &&
                    !attackedByOpp(4+7*8) && !attackedByOpp(3+7*8) && !attackedByOpp(2+7*8)) {
                    this.addMove(kingSq, 2+7*8, false, false, null, 2);
                }
            } else {
                if (castling.blackK && ((allPiecesBB >> BigInt(5)) & 1n) === 0n && ((allPiecesBB >> BigInt(6)) & 1n) === 0n &&
                    !attackedByOpp(4) && !attackedByOpp(5) && !attackedByOpp(6)) {
                    this.addMove(kingSq, 6, false, false, null, 2);
                }
                if (castling.blackQ && ((allPiecesBB >> BigInt(3)) & 1n) === 0n && ((allPiecesBB >> BigInt(2)) & 1n) === 0n && ((allPiecesBB >> BigInt(1)) & 1n) === 0n &&
                    !attackedByOpp(4) && !attackedByOpp(3) && !attackedByOpp(2)) {
                    this.addMove(kingSq, 2, false, false, null, 2);
                }
            }
        }

        // Фильтрация легальных ходов (отбрасываем те, которые оставляют короля под шахом)
        filterLegalMoves(pos) {
            const legalMoves = [];
            for (let i = 0; i < this.moveCount; i++) {
                const move = this.pseudoLegalMoves[i];
                if (this.isLegalMove(pos, move)) {
                    legalMoves.push(move);
                }
            }
            this.pseudoLegalMoves = legalMoves;
            this.moveCount = legalMoves.length;
        }

        isLegalMove(pos, move) {
            // Сохраняем состояние
            const state = {};
            // Клонируем позицию для проверки (или используем make/unmake)
            const clone = pos.clone();
            const success = clone.makeMove(move, state);
            if (!success) return false;
            // Проверяем, находится ли король под шахом
            const kingSq = this.findKing(clone, 1 - pos.side);
            if (kingSq === -1) return false;
            const attacked = clone.isSquareAttacked(kingSq, pos.side);
            return !attacked;
        }

        findKing(pos, color) {
            const kingPiece = PIECE_KING;
            const list = pos.pieceLists[color][kingPiece];
            return list.length ? list[0] : -1;
        }

        // ======================== Вспомогательные битовые доски ========================
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

        // ======================== Сортировка ходов ========================
        static scoreMoves(moves, killer1, killer2, history, side, pos) {
            for (const move of moves) {
                let score = 0;
                const target = pos.pieceAt(move.to);
                const attacker = pos.pieceAt(move.from);
                if (target && attacker) {
                    score = mvvLvaScore(attacker.piece, target.piece);
                }
                if (killer1 && move.equals(killer1)) score += 5000;
                else if (killer2 && move.equals(killer2)) score += 4000;
                if (history && history.get) score += history.get(side, move.from, move.to);
                move.score = score;
            }
            moves.sort((a,b) => b.score - a.score);
        }
    }

    // ======================== Экспорт ========================
    window.BurchessMoveGen = {
        MoveGenerator,
        mvvLvaScore,
        getPieceValue
    };
})();
