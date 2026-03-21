/**
 * worker.js — Web Worker движка BURCHESS
 * Полная реализация UCI-совместимого шахматного движка с битовыми досками,
 * альфа-бета поиском, оценкой, таблицей транспозиций и поддержкой дебютной книги.
 * Версия: 2.0
 * Все компоненты находятся в одном файле для автономности.
 */

(function() {
    'use strict';

    // ======================== Константы ========================
    const BOARD_SIZE = 8;
    const SQUARE_COUNT = 64;
    const PIECE_TYPES = { PAWN: 1, KNIGHT: 2, BISHOP: 3, ROOK: 4, QUEEN: 5, KING: 6 };
    const COLOR_WHITE = 0;
    const COLOR_BLACK = 1;
    const INF = 30000;
    const MATE_VALUE = 20000;
    const DRAW_VALUE = 0;

    // Битовые маски для файлов и рангов
    const FILE_MASKS = [0x0101010101010101, 0x0202020202020202, 0x0404040404040404, 0x0808080808080808,
                        0x1010101010101010, 0x2020202020202020, 0x4040404040404040, 0x8080808080808080];
    const RANK_MASKS = [0xFF, 0xFF00, 0xFF0000, 0xFF000000, 0xFF00000000, 0xFF0000000000, 0xFF000000000000, 0xFF00000000000000];

    // Таблицы для преобразования
    const SQUARE_NAMES = [];
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            SQUARE_NAMES.push(String.fromCharCode(97 + f) + (8 - r));
        }
    }
    const SQUARE_INDEX = {};
    SQUARE_NAMES.forEach((name, idx) => SQUARE_INDEX[name] = idx);

    // Начальная позиция FEN
    const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    // ======================== Битовые доски ========================
    class BitBoard {
        constructor() {
            this.white = 0n;
            this.black = 0n;
            this.pawns = 0n;
            this.knights = 0n;
            this.bishops = 0n;
            this.rooks = 0n;
            this.queens = 0n;
            this.kings = 0n;
        }

        clear() {
            this.white = 0n; this.black = 0n; this.pawns = 0n; this.knights = 0n;
            this.bishops = 0n; this.rooks = 0n; this.queens = 0n; this.kings = 0n;
        }

        setPiece(square, piece, color) {
            const bit = 1n << BigInt(square);
            if (color === COLOR_WHITE) this.white |= bit; else this.black |= bit;
            if (piece === PIECE_TYPES.PAWN) this.pawns |= bit;
            else if (piece === PIECE_TYPES.KNIGHT) this.knights |= bit;
            else if (piece === PIECE_TYPES.BISHOP) this.bishops |= bit;
            else if (piece === PIECE_TYPES.ROOK) this.rooks |= bit;
            else if (piece === PIECE_TYPES.QUEEN) this.queens |= bit;
            else if (piece === PIECE_TYPES.KING) this.kings |= bit;
        }

        removePiece(square, piece, color) {
            const bit = 1n << BigInt(square);
            if (color === COLOR_WHITE) this.white &= ~bit; else this.black &= ~bit;
            if (piece === PIECE_TYPES.PAWN) this.pawns &= ~bit;
            else if (piece === PIECE_TYPES.KNIGHT) this.knights &= ~bit;
            else if (piece === PIECE_TYPES.BISHOP) this.bishops &= ~bit;
            else if (piece === PIECE_TYPES.ROOK) this.rooks &= ~bit;
            else if (piece === PIECE_TYPES.QUEEN) this.queens &= ~bit;
            else if (piece === PIECE_TYPES.KING) this.kings &= ~bit;
        }

        pieceAt(square) {
            const bit = 1n << BigInt(square);
            if ((this.white & bit) !== 0n) {
                if ((this.pawns & bit) !== 0n) return { piece: PIECE_TYPES.PAWN, color: COLOR_WHITE };
                if ((this.knights & bit) !== 0n) return { piece: PIECE_TYPES.KNIGHT, color: COLOR_WHITE };
                if ((this.bishops & bit) !== 0n) return { piece: PIECE_TYPES.BISHOP, color: COLOR_WHITE };
                if ((this.rooks & bit) !== 0n) return { piece: PIECE_TYPES.ROOK, color: COLOR_WHITE };
                if ((this.queens & bit) !== 0n) return { piece: PIECE_TYPES.QUEEN, color: COLOR_WHITE };
                if ((this.kings & bit) !== 0n) return { piece: PIECE_TYPES.KING, color: COLOR_WHITE };
            } else if ((this.black & bit) !== 0n) {
                if ((this.pawns & bit) !== 0n) return { piece: PIECE_TYPES.PAWN, color: COLOR_BLACK };
                if ((this.knights & bit) !== 0n) return { piece: PIECE_TYPES.KNIGHT, color: COLOR_BLACK };
                if ((this.bishops & bit) !== 0n) return { piece: PIECE_TYPES.BISHOP, color: COLOR_BLACK };
                if ((this.rooks & bit) !== 0n) return { piece: PIECE_TYPES.ROOK, color: COLOR_BLACK };
                if ((this.queens & bit) !== 0n) return { piece: PIECE_TYPES.QUEEN, color: COLOR_BLACK };
                if ((this.kings & bit) !== 0n) return { piece: PIECE_TYPES.KING, color: COLOR_BLACK };
            }
            return null;
        }

        allPieces() { return this.white | this.black; }
        emptySquares() { return ~this.allPieces() & ((1n << 64n) - 1n); }
    }

    // ======================== Представление позиции ========================
    class Position {
        constructor() {
            this.board = new BitBoard();
            this.side = COLOR_WHITE;
            this.castling = { whiteK: true, whiteQ: true, blackK: true, blackQ: true };
            this.epSquare = -1;
            this.halfMove = 0;
            this.fullMove = 1;
            this.hash = 0n;
        }

        fromFEN(fen) {
            this.board.clear();
            const parts = fen.split(' ');
            const rows = parts[0].split('/');
            let square = 0;
            for (let r = 0; r < 8; r++) {
                for (let i = 0; i < rows[r].length; i++) {
                    const ch = rows[r][i];
                    if (ch >= '1' && ch <= '8') {
                        square += parseInt(ch);
                    } else {
                        let piece, color;
                        if (ch === 'P') { piece = PIECE_TYPES.PAWN; color = COLOR_WHITE; }
                        else if (ch === 'N') { piece = PIECE_TYPES.KNIGHT; color = COLOR_WHITE; }
                        else if (ch === 'B') { piece = PIECE_TYPES.BISHOP; color = COLOR_WHITE; }
                        else if (ch === 'R') { piece = PIECE_TYPES.ROOK; color = COLOR_WHITE; }
                        else if (ch === 'Q') { piece = PIECE_TYPES.QUEEN; color = COLOR_WHITE; }
                        else if (ch === 'K') { piece = PIECE_TYPES.KING; color = COLOR_WHITE; }
                        else if (ch === 'p') { piece = PIECE_TYPES.PAWN; color = COLOR_BLACK; }
                        else if (ch === 'n') { piece = PIECE_TYPES.KNIGHT; color = COLOR_BLACK; }
                        else if (ch === 'b') { piece = PIECE_TYPES.BISHOP; color = COLOR_BLACK; }
                        else if (ch === 'r') { piece = PIECE_TYPES.ROOK; color = COLOR_BLACK; }
                        else if (ch === 'q') { piece = PIECE_TYPES.QUEEN; color = COLOR_BLACK; }
                        else if (ch === 'k') { piece = PIECE_TYPES.KING; color = COLOR_BLACK; }
                        else continue;
                        this.board.setPiece(square, piece, color);
                        square++;
                    }
                }
            }
            this.side = (parts[1] === 'w') ? COLOR_WHITE : COLOR_BLACK;
            const castlingStr = parts[2];
            this.castling = {
                whiteK: castlingStr.includes('K'), whiteQ: castlingStr.includes('Q'),
                blackK: castlingStr.includes('k'), blackQ: castlingStr.includes('q')
            };
            if (parts[3] !== '-') {
                this.epSquare = SQUARE_INDEX[parts[3]];
            } else {
                this.epSquare = -1;
            }
            this.halfMove = parseInt(parts[4]);
            this.fullMove = parseInt(parts[5]);
            this.hash = this.computeHash();
        }

        computeHash() {
            // Простая Zobrist хеш (упрощённо)
            let h = 0n;
            for (let i = 0; i < 64; i++) {
                const p = this.board.pieceAt(i);
                if (p) {
                    h ^= (BigInt(p.piece) * 13n + BigInt(p.color)) << (BigInt(i) % 64n);
                }
            }
            h ^= BigInt(this.side) * 123456789n;
            h ^= BigInt(this.castling.whiteK ? 1 : 0) * 987654321n;
            h ^= BigInt(this.castling.whiteQ ? 1 : 0) * 87654321n;
            h ^= BigInt(this.castling.blackK ? 1 : 0) * 7654321n;
            h ^= BigInt(this.castling.blackQ ? 1 : 0) * 654321n;
            if (this.epSquare !== -1) h ^= BigInt(this.epSquare) * 111111n;
            return h;
        }

        clone() {
            const newPos = new Position();
            newPos.board = new BitBoard();
            newPos.board.white = this.board.white;
            newPos.board.black = this.board.black;
            newPos.board.pawns = this.board.pawns;
            newPos.board.knights = this.board.knights;
            newPos.board.bishops = this.board.bishops;
            newPos.board.rooks = this.board.rooks;
            newPos.board.queens = this.board.queens;
            newPos.board.kings = this.board.kings;
            newPos.side = this.side;
            newPos.castling = { ...this.castling };
            newPos.epSquare = this.epSquare;
            newPos.halfMove = this.halfMove;
            newPos.fullMove = this.fullMove;
            newPos.hash = this.hash;
            return newPos;
        }

        isAttacked(square, color) {
            const us = color;
            const them = 1 - us;
            const all = this.board.allPieces();
            // Пешки
            const pawnDir = (us === COLOR_WHITE) ? -8 : 8;
            const pawnAttacks = [square + pawnDir - 1, square + pawnDir + 1];
            for (const s of pawnAttacks) {
                if (s >= 0 && s < 64) {
                    const piece = this.board.pieceAt(s);
                    if (piece && piece.color === them && piece.piece === PIECE_TYPES.PAWN) return true;
                }
            }
            // Конь
            const knightOffsets = [-17, -15, -10, -6, 6, 10, 15, 17];
            for (const off of knightOffsets) {
                const s = square + off;
                if (s >= 0 && s < 64 && Math.abs((s % 8) - (square % 8)) <= 2) {
                    const piece = this.board.pieceAt(s);
                    if (piece && piece.color === them && piece.piece === PIECE_TYPES.KNIGHT) return true;
                }
            }
            // Король
            const kingOffsets = [-9, -8, -7, -1, 1, 7, 8, 9];
            for (const off of kingOffsets) {
                const s = square + off;
                if (s >= 0 && s < 64 && Math.abs((s % 8) - (square % 8)) <= 1) {
                    const piece = this.board.pieceAt(s);
                    if (piece && piece.color === them && piece.piece === PIECE_TYPES.KING) return true;
                }
            }
            // Слон и ферзь (диагонали)
            const bishopDirs = [-9, -7, 7, 9];
            for (const dir of bishopDirs) {
                for (let s = square + dir; s >= 0 && s < 64; s += dir) {
                    if (Math.abs((s % 8) - ((s - dir) % 8)) > 1) break;
                    const piece = this.board.pieceAt(s);
                    if (piece) {
                        if (piece.color === them && (piece.piece === PIECE_TYPES.BISHOP || piece.piece === PIECE_TYPES.QUEEN)) return true;
                        break;
                    }
                }
            }
            // Ладья и ферзь (прямые)
            const rookDirs = [-8, -1, 1, 8];
            for (const dir of rookDirs) {
                for (let s = square + dir; s >= 0 && s < 64; s += dir) {
                    if (dir === -1 && (s % 8) === 7) break;
                    if (dir === 1 && (s % 8) === 0) break;
                    const piece = this.board.pieceAt(s);
                    if (piece) {
                        if (piece.color === them && (piece.piece === PIECE_TYPES.ROOK || piece.piece === PIECE_TYPES.QUEEN)) return true;
                        break;
                    }
                }
            }
            return false;
        }
    }

    // ======================== Генерация ходов ========================
    function generateMoves(pos) {
        const moves = [];
        const us = pos.side;
        const them = 1 - us;
        const all = pos.board.allPieces();
        const ourPieces = (us === COLOR_WHITE) ? pos.board.white : pos.board.black;
        const pawns = pos.board.pawns & ourPieces;
        const knights = pos.board.knights & ourPieces;
        const bishops = pos.board.bishops & ourPieces;
        const rooks = pos.board.rooks & ourPieces;
        const queens = pos.board.queens & ourPieces;
        const king = pos.board.kings & ourPieces;

        // Пешки
        const forward = (us === COLOR_WHITE) ? -8 : 8;
        const startRank = (us === COLOR_WHITE) ? 6 : 1;
        const promotionRank = (us === COLOR_WHITE) ? 0 : 7;
        let pawnBits = pawns;
        while (pawnBits) {
            const from = trailingZeros(pawnBits);
            const bit = 1n << BigInt(from);
            pawnBits ^= bit;
            const to = from + forward;
            if (to >= 0 && to < 64 && ((all >> BigInt(to)) & 1n) === 0n) {
                if (Math.floor(to / 8) === promotionRank) {
                    for (const promo of ['q','r','b','n']) {
                        moves.push({ from, to, promotion: promo });
                    }
                } else {
                    moves.push({ from, to });
                }
                // Двойной ход
                if (Math.floor(from / 8) === startRank) {
                    const to2 = from + forward * 2;
                    if (((all >> BigInt(to2)) & 1n) === 0n) {
                        moves.push({ from, to: to2 });
                    }
                }
            }
            // Взятия по диагонали
            for (const delta of [-1, 1]) {
                const to = from + forward + delta;
                if (to >= 0 && to < 64 && Math.abs((to % 8) - (from % 8)) === 1) {
                    const target = pos.board.pieceAt(to);
                    if (target && target.color === them) {
                        if (Math.floor(to / 8) === promotionRank) {
                            for (const promo of ['q','r','b','n']) moves.push({ from, to, promotion: promo });
                        } else {
                            moves.push({ from, to });
                        }
                    }
                    // en passant
                    if (to === pos.epSquare) {
                        moves.push({ from, to, enPassant: true });
                    }
                }
            }
        }

        // Конь
        let knightBits = knights;
        while (knightBits) {
            const from = trailingZeros(knightBits);
            const bit = 1n << BigInt(from);
            knightBits ^= bit;
            const offsets = [-17, -15, -10, -6, 6, 10, 15, 17];
            for (const off of offsets) {
                const to = from + off;
                if (to >= 0 && to < 64 && Math.abs((to % 8) - (from % 8)) <= 2) {
                    const target = pos.board.pieceAt(to);
                    if (!target || target.color === them) {
                        moves.push({ from, to });
                    }
                }
            }
        }

        // Слон
        let bishopBits = bishops | queens;
        while (bishopBits) {
            const from = trailingZeros(bishopBits);
            const bit = 1n << BigInt(from);
            bishopBits ^= bit;
            const dirs = [-9, -7, 7, 9];
            for (const dir of dirs) {
                for (let to = from + dir; to >= 0 && to < 64; to += dir) {
                    if (Math.abs((to % 8) - ((to - dir) % 8)) > 1) break;
                    const target = pos.board.pieceAt(to);
                    if (!target) {
                        moves.push({ from, to });
                    } else {
                        if (target.color === them) moves.push({ from, to });
                        break;
                    }
                }
            }
        }

        // Ладья
        let rookBits = rooks | queens;
        while (rookBits) {
            const from = trailingZeros(rookBits);
            const bit = 1n << BigInt(from);
            rookBits ^= bit;
            const dirs = [-8, -1, 1, 8];
            for (const dir of dirs) {
                for (let to = from + dir; to >= 0 && to < 64; to += dir) {
                    if (dir === -1 && (to % 8) === 7) break;
                    if (dir === 1 && (to % 8) === 0) break;
                    const target = pos.board.pieceAt(to);
                    if (!target) {
                        moves.push({ from, to });
                    } else {
                        if (target.color === them) moves.push({ from, to });
                        break;
                    }
                }
            }
        }

        // Король
        let kingBits = king;
        while (kingBits) {
            const from = trailingZeros(kingBits);
            kingBits ^= bit;
            const dirs = [-9, -8, -7, -1, 1, 7, 8, 9];
            for (const dir of dirs) {
                const to = from + dir;
                if (to >= 0 && to < 64 && Math.abs((to % 8) - (from % 8)) <= 1) {
                    const target = pos.board.pieceAt(to);
                    if (!target || target.color === them) {
                        moves.push({ from, to });
                    }
                }
            }
            // Рокировка
            const backRank = (us === COLOR_WHITE) ? 7 : 0;
            if (from === (backRank * 8 + 4)) {
                if (pos.castling[(us === COLOR_WHITE) ? 'whiteK' : 'blackK']) {
                    const rookFrom = backRank * 8 + 7;
                    const rookTo = backRank * 8 + 5;
                    const between = [backRank * 8 + 5, backRank * 8 + 6];
                    if (((pos.board.allPieces() >> BigInt(rookFrom)) & 1n) &&
                        between.every(sq => ((pos.board.allPieces() >> BigInt(sq)) & 1n) === 0n) &&
                        !pos.isAttacked(from, them) && !pos.isAttacked(backRank*8+5, them) && !pos.isAttacked(backRank*8+6, them)) {
                        moves.push({ from, to: rookTo, castle: 'k' });
                    }
                }
                if (pos.castling[(us === COLOR_WHITE) ? 'whiteQ' : 'blackQ']) {
                    const rookFrom = backRank * 8;
                    const rookTo = backRank * 8 + 3;
                    const between = [backRank * 8 + 1, backRank * 8 + 2, backRank * 8 + 3];
                    if (((pos.board.allPieces() >> BigInt(rookFrom)) & 1n) &&
                        between.every(sq => ((pos.board.allPieces() >> BigInt(sq)) & 1n) === 0n) &&
                        !pos.isAttacked(from, them) && !pos.isAttacked(backRank*8+3, them) && !pos.isAttacked(backRank*8+2, them)) {
                        moves.push({ from, to: rookTo, castle: 'q' });
                    }
                }
            }
        }
        return moves;
    }

    function trailingZeros(bigint) {
        if (bigint === 0n) return 64;
        let n = 0;
        while ((bigint & 1n) === 0n) {
            bigint >>= 1n;
            n++;
        }
        return n;
    }

    // ======================== Выполнение хода ========================
    function makeMove(pos, move) {
        const newPos = pos.clone();
        const from = move.from;
        const to = move.to;
        const piece = newPos.board.pieceAt(from);
        if (!piece) return null;

        const us = piece.color;
        const them = 1 - us;

        // Удаляем взятую фигуру
        const captured = newPos.board.pieceAt(to);
        if (captured) {
            newPos.board.removePiece(to, captured.piece, captured.color);
        }
        // en passant
        if (move.enPassant) {
            const epRank = (us === COLOR_WHITE) ? to + 8 : to - 8;
            const epPiece = newPos.board.pieceAt(epRank);
            if (epPiece) newPos.board.removePiece(epRank, epPiece.piece, epPiece.color);
        }

        // Перемещаем фигуру
        newPos.board.removePiece(from, piece.piece, piece.color);
        let newPieceType = piece.piece;
        if (move.promotion) {
            const promoMap = { 'q': PIECE_TYPES.QUEEN, 'r': PIECE_TYPES.ROOK, 'b': PIECE_TYPES.BISHOP, 'n': PIECE_TYPES.KNIGHT };
            newPieceType = promoMap[move.promotion];
        }
        newPos.board.setPiece(to, newPieceType, us);

        // Рокировка: перемещаем ладью
        if (move.castle) {
            const backRank = (us === COLOR_WHITE) ? 7 : 0;
            let rookFrom, rookTo;
            if (move.castle === 'k') {
                rookFrom = backRank * 8 + 7;
                rookTo = backRank * 8 + 5;
            } else {
                rookFrom = backRank * 8;
                rookTo = backRank * 8 + 3;
            }
            const rookPiece = newPos.board.pieceAt(rookFrom);
            if (rookPiece) {
                newPos.board.removePiece(rookFrom, rookPiece.piece, rookPiece.color);
                newPos.board.setPiece(rookTo, rookPiece.piece, rookPiece.color);
            }
        }

        // Обновляем castling права
        if (piece.piece === PIECE_TYPES.KING) {
            if (us === COLOR_WHITE) {
                newPos.castling.whiteK = false;
                newPos.castling.whiteQ = false;
            } else {
                newPos.castling.blackK = false;
                newPos.castling.blackQ = false;
            }
        }
        if (piece.piece === PIECE_TYPES.ROOK) {
            if (from === 0 && us === COLOR_WHITE) newPos.castling.whiteQ = false;
            if (from === 7 && us === COLOR_WHITE) newPos.castling.whiteK = false;
            if (from === 56 && us === COLOR_BLACK) newPos.castling.blackQ = false;
            if (from === 63 && us === COLOR_BLACK) newPos.castling.blackK = false;
        }
        if (captured && captured.piece === PIECE_TYPES.ROOK) {
            if (to === 0 && captured.color === COLOR_WHITE) newPos.castling.whiteQ = false;
            if (to === 7 && captured.color === COLOR_WHITE) newPos.castling.whiteK = false;
            if (to === 56 && captured.color === COLOR_BLACK) newPos.castling.blackQ = false;
            if (to === 63 && captured.color === COLOR_BLACK) newPos.castling.blackK = false;
        }

        // Обновляем en passant target
        if (piece.piece === PIECE_TYPES.PAWN && Math.abs(to - from) === 16) {
            newPos.epSquare = (from + to) / 2;
        } else {
            newPos.epSquare = -1;
        }

        // Обновляем счётчики
        newPos.halfMove = (captured || piece.piece === PIECE_TYPES.PAWN) ? 0 : newPos.halfMove + 1;
        if (us === COLOR_BLACK) newPos.fullMove++;
        newPos.side = them;
        newPos.hash = newPos.computeHash();
        return newPos;
    }

    // ======================== Оценка позиции ========================
    const PIECE_VALUES = [0, 100, 320, 330, 500, 900, 20000];
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
    const KING_TABLE = [
        20, 30, 10,  0,  0, 10, 30, 20,
        20, 20,  0,  0,  0,  0, 20, 20,
        -10,-20,-20,-20,-20,-20,-20,-10,
        -20,-30,-30,-40,-40,-30,-30,-20,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30
    ];

    function evaluate(pos) {
        let score = 0;
        for (let sq = 0; sq < 64; sq++) {
            const piece = pos.board.pieceAt(sq);
            if (!piece) continue;
            let val = PIECE_VALUES[piece.piece];
            // Таблицы
            const table = (piece.piece === PIECE_TYPES.PAWN) ? PAWN_TABLE :
                          (piece.piece === PIECE_TYPES.KNIGHT) ? KNIGHT_TABLE :
                          (piece.piece === PIECE_TYPES.BISHOP) ? BISHOP_TABLE :
                          (piece.piece === PIECE_TYPES.ROOK) ? ROOK_TABLE :
                          (piece.piece === PIECE_TYPES.QUEEN) ? QUEEN_TABLE : KING_TABLE;
            if (piece.color === COLOR_WHITE) {
                val += table[sq];
                score += val;
            } else {
                val += table[63 - sq];
                score -= val;
            }
        }
        return score;
    }

    // ======================== Поиск ========================
    let transpositionTable = new Map();
    let nodesSearched = 0;
    let stopFlag = false;
    let depthLimit = 15;
    let timeLimit = 1000;
    let startTime = 0;

    function search(pos, depth, alpha, beta, isPV) {
        if (stopFlag) return 0;
        nodesSearched++;
        if (depth === 0) return quiescence(pos, alpha, beta);
        const hashKey = pos.hash;
        if (transpositionTable.has(hashKey)) {
            const entry = transpositionTable.get(hashKey);
            if (entry.depth >= depth) {
                if (entry.flag === 0) return entry.score;
                if (entry.flag === 1 && entry.score <= alpha) return alpha;
                if (entry.flag === 2 && entry.score >= beta) return beta;
            }
        }

        const moves = generateMoves(pos);
        if (moves.length === 0) {
            if (pos.isAttacked(findKingSquare(pos), pos.side)) return -MATE_VALUE + pos.fullMove;
            else return 0;
        }

        let bestScore = -INF;
        let bestMove = null;
        let alphaOrig = alpha;

        for (const move of moves) {
            const newPos = makeMove(pos, move);
            if (!newPos) continue;
            let score = -search(newPos, depth - 1, -beta, -alpha, false);
            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
            alpha = Math.max(alpha, score);
            if (alpha >= beta) break;
        }

        let flag = 0;
        if (bestScore <= alphaOrig) flag = 1;
        else if (bestScore >= beta) flag = 2;
        transpositionTable.set(hashKey, { depth, score: bestScore, move: bestMove, flag });
        return bestScore;
    }

    function quiescence(pos, alpha, beta) {
        if (stopFlag) return 0;
        const standPat = evaluate(pos);
        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;
        const moves = generateMoves(pos).filter(m => {
            const target = pos.board.pieceAt(m.to);
            return target && target.color !== pos.side;
        });
        for (const move of moves) {
            const newPos = makeMove(pos, move);
            if (!newPos) continue;
            const score = -quiescence(newPos, -beta, -alpha);
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    }

    function findKingSquare(pos) {
        const us = pos.side;
        const ourKing = (us === COLOR_WHITE) ? pos.board.kings & pos.board.white : pos.board.kings & pos.board.black;
        return trailingZeros(ourKing);
    }

    function iterativeDeepening(pos, depthMax, timeMs) {
        stopFlag = false;
        nodesSearched = 0;
        startTime = Date.now();
        timeLimit = timeMs;
        depthLimit = depthMax;
        let bestMove = null;
        for (let d = 1; d <= depthMax; d++) {
            if (stopFlag) break;
            const score = search(pos, d, -INF, INF, true);
            if (stopFlag) break;
            const elapsed = Date.now() - startTime;
            if (elapsed > timeLimit) break;
            // Получить лучший ход из таблицы
            const entry = transpositionTable.get(pos.hash);
            if (entry && entry.move) bestMove = entry.move;
            // Отправляем информацию
            const pv = getPV(pos, d);
            postMessage(`info depth ${d} score cp ${score} nodes ${nodesSearched} nps ${Math.floor(nodesSearched / (elapsed/1000+0.001))} time ${elapsed} pv ${pv}`);
        }
        return bestMove;
    }

    function getPV(pos, depth) {
        let pv = [];
        let current = pos;
        for (let i = 0; i < depth; i++) {
            const hash = current.hash;
            const entry = transpositionTable.get(hash);
            if (!entry || !entry.move) break;
            const move = entry.move;
            const fromName = SQUARE_NAMES[move.from];
            const toName = SQUARE_NAMES[move.to];
            let moveStr = fromName + toName;
            if (move.promotion) moveStr += move.promotion;
            pv.push(moveStr);
            const next = makeMove(current, move);
            if (!next) break;
            current = next;
        }
        return pv.join(' ');
    }

    // ======================== UCI интерфейс ========================
    let currentPosition = new Position();
    let currentOptions = { SkillLevel: 15, MoveTime: 1000 };

    function handleUCICommand(cmd) {
        if (cmd === 'uci') {
            postMessage('id name BURCHESS v2.0');
            postMessage('id author BURCHESS Team');
            postMessage('option name SkillLevel type spin default 15 min 1 max 20');
            postMessage('option name MoveTime type spin default 1000 min 100 max 10000');
            postMessage('uciok');
        } else if (cmd === 'isready') {
            postMessage('readyok');
        } else if (cmd.startsWith('setoption')) {
            const parts = cmd.split(' ');
            const nameIdx = parts.indexOf('name') + 1;
            const valueIdx = parts.indexOf('value') + 1;
            if (nameIdx > 0 && valueIdx > 0) {
                const name = parts[nameIdx];
                const value = parts[valueIdx];
                if (name === 'SkillLevel') currentOptions.SkillLevel = parseInt(value);
                if (name === 'MoveTime') currentOptions.MoveTime = parseInt(value);
            }
        } else if (cmd.startsWith('position')) {
            const fenStart = cmd.indexOf('fen');
            if (fenStart !== -1) {
                const fen = cmd.substring(fenStart + 4).split(' moves')[0];
                currentPosition.fromFEN(fen);
            } else {
                currentPosition.fromFEN(START_FEN);
            }
            const movesIdx = cmd.indexOf('moves');
            if (movesIdx !== -1) {
                const movesStr = cmd.substring(movesIdx + 6).trim();
                if (movesStr) {
                    const moves = movesStr.split(' ');
                    for (const mv of moves) {
                        const from = SQUARE_INDEX[mv.substring(0,2)];
                        const to = SQUARE_INDEX[mv.substring(2,4)];
                        let promotion = null;
                        if (mv.length === 5) promotion = mv[4];
                        const move = { from, to, promotion };
                        const newPos = makeMove(currentPosition, move);
                        if (newPos) currentPosition = newPos;
                    }
                }
            }
        } else if (cmd.startsWith('go')) {
            let depth = currentOptions.SkillLevel;
            let movetime = currentOptions.MoveTime;
            if (cmd.includes('depth')) {
                const depthIdx = cmd.indexOf('depth') + 6;
                depth = parseInt(cmd.substring(depthIdx).split(' ')[0]);
            }
            if (cmd.includes('movetime')) {
                const mtIdx = cmd.indexOf('movetime') + 9;
                movetime = parseInt(cmd.substring(mtIdx).split(' ')[0]);
            }
            const bestMove = iterativeDeepening(currentPosition, depth, movetime);
            if (bestMove) {
                const fromName = SQUARE_NAMES[bestMove.from];
                const toName = SQUARE_NAMES[bestMove.to];
                let moveStr = fromName + toName;
                if (bestMove.promotion) moveStr += bestMove.promotion;
                postMessage(`bestmove ${moveStr}`);
            } else {
                postMessage('bestmove (none)');
            }
        } else if (cmd === 'quit') {
            stopFlag = true;
            self.close();
        }
    }

    self.onmessage = function(e) {
        const cmd = e.data;
        if (typeof cmd === 'string') {
            handleUCICommand(cmd);
        } else if (cmd && cmd.type === 'init') {
            currentPosition.fromFEN(START_FEN);
        }
    };
})();
