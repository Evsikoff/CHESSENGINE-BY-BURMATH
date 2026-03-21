/**
 * engine_moves.js — генерация ходов с использованием битовых досок
 * Версия: 2.0
 * 
 * Содержит:
 * - Полную генерацию всех легальных ходов
 * - Генерацию псевдо-легальных ходов для всех фигур
 * - Проверку легальности ходов (шах королю)
 * - Поддержку рокировки и en passant
 * - Функции для получения всех ходов из позиции
 * - Сортировку ходов (MvvLva, killer, history)
 */

(function() {
    'use strict';

    // ======================== Импорт зависимостей ========================
    // Используем глобальные объекты, созданные в предыдущих файлах
    const Utils = window.BurchessUtils?.Utils || window.Utils;
    const AttackTables = window.BurchessUtils?.AttackTables || window.AttackTables;
    const BitBoard = window.BurchessBitBoard?.BitBoard;
    const PAWN_ATTACKS = window.BurchessBitBoard?.PAWN_ATTACKS;
    const KNIGHT_ATTACKS = window.BurchessBitBoard?.KNIGHT_ATTACKS;
    const KING_ATTACKS = window.BurchessBitBoard?.KING_ATTACKS;
    const getBishopAttacks = window.BurchessBitBoard?.getBishopAttacks;
    const getRookAttacks = window.BurchessBitBoard?.getRookAttacks;
    const getQueenAttacks = window.BurchessBitBoard?.getQueenAttacks;

    // ======================== Константы ========================
    const COLOR_WHITE = 0;
    const COLOR_BLACK = 1;
    const PIECE_PAWN = 1;
    const PIECE_KNIGHT = 2;
    const PIECE_BISHOP = 3;
    const PIECE_ROOK = 4;
    const PIECE_QUEEN = 5;
    const PIECE_KING = 6;

    // ======================== Структура хода ========================
    class Move {
        constructor(from, to, promotion = null, flags = 0) {
            this.from = from;           // 0-63
            this.to = to;               // 0-63
            this.promotion = promotion; // 'q','r','b','n' или null
            this.flags = flags;         // битовые флаги: 1=enPassant, 2=castle, 4=promotion
            this.score = 0;             // для сортировки
        }

        toString() {
            let str = Utils.squareToAlgebraic(this.from) + Utils.squareToAlgebraic(this.to);
            if (this.promotion) str += this.promotion;
            return str;
        }

        equals(other) {
            return other && this.from === other.from && this.to === other.to && this.promotion === other.promotion;
        }
    }

    // ======================== Класс генератора ходов ========================
    class MoveGenerator {
        constructor() {
            this.moves = [];
            this.pseudoLegalMoves = [];
            this.legalMoves = [];
        }

        clear() {
            this.moves = [];
            this.pseudoLegalMoves = [];
            this.legalMoves = [];
        }

        // Генерация всех псевдо-легальных ходов для позиции
        generatePseudoLegalMoves(board, side, castling, epSquare) {
            this.pseudoLegalMoves = [];
            const ourPieces = (side === COLOR_WHITE) ? board.white : board.black;
            const oppPieces = (side === COLOR_WHITE) ? board.black : board.white;
            const allPieces = board.allPieces();

            // Генерация ходов для каждой фигуры
            // Пешки
            let pawns = (side === COLOR_WHITE) ? board.pawns & board.white : board.pawns & board.black;
            let pawnBits = pawns;
            while (pawnBits) {
                const from = Utils.lsbIndex(pawnBits);
                pawnBits &= ~(1n << BigInt(from));
                this.addPawnMoves(from, side, board, epSquare);
            }

            // Кони
            let knights = (side === COLOR_WHITE) ? board.knights & board.white : board.knights & board.black;
            let knightBits = knights;
            while (knightBits) {
                const from = Utils.lsbIndex(knightBits);
                knightBits &= ~(1n << BigInt(from));
                const attacks = KNIGHT_ATTACKS[from] & ~ourPieces;
                this.addMovesFromAttacks(from, attacks);
            }

            // Слоны
            let bishops = (side === COLOR_WHITE) ? board.bishops & board.white : board.bishops & board.black;
            let bishopBits = bishops;
            while (bishopBits) {
                const from = Utils.lsbIndex(bishopBits);
                bishopBits &= ~(1n << BigInt(from));
                const attacks = getBishopAttacks(from, allPieces) & ~ourPieces;
                this.addMovesFromAttacks(from, attacks);
            }

            // Ладьи
            let rooks = (side === COLOR_WHITE) ? board.rooks & board.white : board.rooks & board.black;
            let rookBits = rooks;
            while (rookBits) {
                const from = Utils.lsbIndex(rookBits);
                rookBits &= ~(1n << BigInt(from));
                const attacks = getRookAttacks(from, allPieces) & ~ourPieces;
                this.addMovesFromAttacks(from, attacks);
            }

            // Ферзи
            let queens = (side === COLOR_WHITE) ? board.queens & board.white : board.queens & board.black;
            let queenBits = queens;
            while (queenBits) {
                const from = Utils.lsbIndex(queenBits);
                queenBits &= ~(1n << BigInt(from));
                const attacks = getQueenAttacks(from, allPieces) & ~ourPieces;
                this.addMovesFromAttacks(from, attacks);
            }

            // Король
            let kings = (side === COLOR_WHITE) ? board.kings & board.white : board.kings & board.black;
            let kingBits = kings;
            while (kingBits) {
                const from = Utils.lsbIndex(kingBits);
                kingBits &= ~(1n << BigInt(from));
                const attacks = KING_ATTACKS[from] & ~ourPieces;
                this.addMovesFromAttacks(from, attacks);
            }

            // Рокировка
            this.addCastlingMoves(board, side, castling, allPieces);
            return this.pseudoLegalMoves;
        }

        // Добавление ходов пешек
        addPawnMoves(from, side, board, epSquare) {
            const forward = (side === COLOR_WHITE) ? -8 : 8;
            const startRank = (side === COLOR_WHITE) ? 6 : 1;
            const promotionRank = (side === COLOR_WHITE) ? 0 : 7;
            const ourPieces = (side === COLOR_WHITE) ? board.white : board.black;
            const oppPieces = (side === COLOR_WHITE) ? board.black : board.white;
            const allPieces = board.allPieces();

            // Ход на одну клетку вперёд
            const to = from + forward;
            if (to >= 0 && to < 64 && ((allPieces >> BigInt(to)) & 1n) === 0n) {
                if (Math.floor(to / 8) === promotionRank) {
                    // Превращение
                    this.addPromotionMove(from, to, 'q');
                    this.addPromotionMove(from, to, 'r');
                    this.addPromotionMove(from, to, 'b');
                    this.addPromotionMove(from, to, 'n');
                } else {
                    this.pseudoLegalMoves.push(new Move(from, to));
                }
                // Двойной ход
                if (Math.floor(from / 8) === startRank) {
                    const to2 = from + forward * 2;
                    if (((allPieces >> BigInt(to2)) & 1n) === 0n) {
                        this.pseudoLegalMoves.push(new Move(from, to2));
                    }
                }
            }

            // Взятия по диагонали
            for (const delta of [-1, 1]) {
                const to = from + forward + delta;
                if (to >= 0 && to < 64 && Math.abs((to % 8) - (from % 8)) === 1) {
                    const targetColor = ((board.black >> BigInt(to)) & 1n) ? COLOR_BLACK : ((board.white >> BigInt(to)) & 1n) ? COLOR_WHITE : null;
                    if (targetColor !== null && targetColor !== side) {
                        if (Math.floor(to / 8) === promotionRank) {
                            this.addPromotionMove(from, to, 'q');
                            this.addPromotionMove(from, to, 'r');
                            this.addPromotionMove(from, to, 'b');
                            this.addPromotionMove(from, to, 'n');
                        } else {
                            this.pseudoLegalMoves.push(new Move(from, to));
                        }
                    }
                    // Взятие на проходе
                    if (to === epSquare) {
                        this.pseudoLegalMoves.push(new Move(from, to, null, 1)); // флаг enPassant
                    }
                }
            }
        }

        addPromotionMove(from, to, piece) {
            const move = new Move(from, to, piece, 4);
            this.pseudoLegalMoves.push(move);
        }

        addMovesFromAttacks(from, attacks) {
            let bits = attacks;
            while (bits) {
                const to = Utils.lsbIndex(bits);
                bits &= ~(1n << BigInt(to));
                this.pseudoLegalMoves.push(new Move(from, to));
            }
        }

        addCastlingMoves(board, side, castling, allPieces) {
            const backRank = (side === COLOR_WHITE) ? 7 : 0;
            const kingSq = (side === COLOR_WHITE) ? 4 + 7*8 : 4;
            const attackedByOpp = (sq) => this.isSquareAttacked(sq, 1 - side, board, allPieces);
            
            if (side === COLOR_WHITE) {
                if (castling.whiteK && ((allPieces >> BigInt(5+7*8)) & 1n) === 0n && ((allPieces >> BigInt(6+7*8)) & 1n) === 0n &&
                    !attackedByOpp(4+7*8) && !attackedByOpp(5+7*8) && !attackedByOpp(6+7*8)) {
                    this.pseudoLegalMoves.push(new Move(kingSq, 6+7*8, null, 2));
                }
                if (castling.whiteQ && ((allPieces >> BigInt(3+7*8)) & 1n) === 0n && ((allPieces >> BigInt(2+7*8)) & 1n) === 0n && ((allPieces >> BigInt(1+7*8)) & 1n) === 0n &&
                    !attackedByOpp(4+7*8) && !attackedByOpp(3+7*8) && !attackedByOpp(2+7*8)) {
                    this.pseudoLegalMoves.push(new Move(kingSq, 2+7*8, null, 2));
                }
            } else {
                if (castling.blackK && ((allPieces >> BigInt(5)) & 1n) === 0n && ((allPieces >> BigInt(6)) & 1n) === 0n &&
                    !attackedByOpp(4) && !attackedByOpp(5) && !attackedByOpp(6)) {
                    this.pseudoLegalMoves.push(new Move(kingSq, 6, null, 2));
                }
                if (castling.blackQ && ((allPieces >> BigInt(3)) & 1n) === 0n && ((allPieces >> BigInt(2)) & 1n) === 0n && ((allPieces >> BigInt(1)) & 1n) === 0n &&
                    !attackedByOpp(4) && !attackedByOpp(3) && !attackedByOpp(2)) {
                    this.pseudoLegalMoves.push(new Move(kingSq, 2, null, 2));
                }
            }
        }

        // Проверка, атакована ли клетка (используется для легальности)
        isSquareAttacked(sq, byColor, board, allPieces) {
            const ourPieces = (byColor === COLOR_WHITE) ? board.white : board.black;
            const oppPieces = (byColor === COLOR_WHITE) ? board.black : board.white;
            // Пешки
            const pawnAttacks = PAWN_ATTACKS[byColor][sq];
            if ((pawnAttacks & ((byColor === COLOR_WHITE) ? board.pawns & board.white : board.pawns & board.black)) !== 0n) return true;
            // Кони
            if ((KNIGHT_ATTACKS[sq] & ((byColor === COLOR_WHITE) ? board.knights & board.white : board.knights & board.black)) !== 0n) return true;
            // Король
            if ((KING_ATTACKS[sq] & ((byColor === COLOR_WHITE) ? board.kings & board.white : board.kings & board.black)) !== 0n) return true;
            // Слоны/ферзи (диагонали)
            const bishopAttacks = getBishopAttacks(sq, allPieces);
            const bishopQueen = ((byColor === COLOR_WHITE) ? (board.bishops | board.queens) & board.white : (board.bishops | board.queens) & board.black);
            if ((bishopAttacks & bishopQueen) !== 0n) return true;
            // Ладьи/ферзи (вертикали/горизонтали)
            const rookAttacks = getRookAttacks(sq, allPieces);
            const rookQueen = ((byColor === COLOR_WHITE) ? (board.rooks | board.queens) & board.white : (board.rooks | board.queens) & board.black);
            if ((rookAttacks & rookQueen) !== 0n) return true;
            return false;
        }

        // Проверка, оставляет ли ход короля под шахом (фильтрация легальных ходов)
        isLegalMove(board, side, move, castling, epSquare) {
            // Создаём копию доски и выполняем ход
            const newBoard = board.clone();
            const fromPiece = newBoard.pieceAt(move.from);
            if (!fromPiece) return false;
            const pieceType = fromPiece.type;
            const pieceColor = fromPiece.color;
            if (pieceColor !== (side === COLOR_WHITE ? 'white' : 'black')) return false;
            
            // Применяем ход
            const toPiece = newBoard.pieceAt(move.to);
            // Убираем фигуру с from
            newBoard.removePiece(move.from);
            // Добавляем на to
            let newPieceType = pieceType;
            if (move.promotion) {
                newPieceType = move.promotion === 'q' ? 'queen' : move.promotion === 'r' ? 'rook' : move.promotion === 'b' ? 'bishop' : 'knight';
            }
            newBoard.setPiece(move.to, newPieceType, pieceColor);
            
            // Если en passant, убираем взятую пешку
            if (move.flags & 1) {
                const epRank = (side === COLOR_WHITE) ? move.to + 8 : move.to - 8;
                newBoard.removePiece(epRank);
            }
            
            // Если рокировка, перемещаем ладью
            if (move.flags & 2) {
                const backRank = (side === COLOR_WHITE) ? 7 : 0;
                let rookFrom, rookTo;
                if (move.to === 6+backRank*8) {
                    rookFrom = 7+backRank*8;
                    rookTo = 5+backRank*8;
                } else {
                    rookFrom = backRank*8;
                    rookTo = 3+backRank*8;
                }
                const rookPiece = newBoard.pieceAt(rookFrom);
                if (rookPiece) {
                    newBoard.removePiece(rookFrom);
                    newBoard.setPiece(rookTo, rookPiece.type, rookPiece.color);
                }
            }
            
            // Находим короля
            const kingSq = (side === COLOR_WHITE) ? Utils.lsbIndex(newBoard.kings & newBoard.white) : Utils.lsbIndex(newBoard.kings & newBoard.black);
            const allPieces = newBoard.allPieces();
            // Проверяем, атакован ли король
            const attacked = this.isSquareAttacked(kingSq, 1 - side, newBoard, allPieces);
            return !attacked;
        }

        // Генерация всех легальных ходов (фильтрация псевдо-легальных)
        generateLegalMoves(board, side, castling, epSquare) {
            const pseudo = this.generatePseudoLegalMoves(board, side, castling, epSquare);
            this.legalMoves = [];
            for (const move of pseudo) {
                if (this.isLegalMove(board, side, move, castling, epSquare)) {
                    this.legalMoves.push(move);
                }
            }
            return this.legalMoves;
        }

        // Сортировка ходов для улучшения альфа-бета (MVV-LVA, killer, history)
        static scoreMoves(moves, killer1, killer2, history, side) {
            for (const move of moves) {
                let score = 0;
                // Приоритет: ход, бьющий фигуру (MVV-LVA)
                const targetPiece = move.targetPiece; // должно быть заполнено извне
                if (targetPiece) {
                    const victimValue = [0, 1, 3, 3, 5, 9, 0][targetPiece];
                    const attackerValue = [0, 1, 3, 3, 5, 9, 0][move.pieceType];
                    score = 10 * victimValue - attackerValue;
                }
                // Killer moves
                if (killer1 && move.equals(killer1)) score += 5000;
                else if (killer2 && move.equals(killer2)) score += 4000;
                // History heuristic
                score += history.get(side, move.from, move.to);
                move.score = score;
            }
            moves.sort((a,b) => b.score - a.score);
        }
    }

    // ======================== Экспорт ========================
    window.BurchessMoves = {
        Move,
        MoveGenerator
    };
})();
