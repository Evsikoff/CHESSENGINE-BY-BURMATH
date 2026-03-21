/**
 * engine_types.js — глобальные типы, константы, структуры данных движка BURCHESS
 * Версия: 2.0
 * Содержит все определения, используемые в ядре движка.
 */

(function() {
    'use strict';

    // ======================== Основные константы ========================
    const BOARD_SIZE = 8;
    const SQUARE_COUNT = 64;
    const MAX_PLY = 128;
    const MAX_MOVES = 256;

    // Цвета
    const COLOR_WHITE = 0;
    const COLOR_BLACK = 1;
    const COLOR_NONE = 2;

    // Типы фигур
    const PIECE_NONE = 0;
    const PIECE_PAWN = 1;
    const PIECE_KNIGHT = 2;
    const PIECE_BISHOP = 3;
    const PIECE_ROOK = 4;
    const PIECE_QUEEN = 5;
    const PIECE_KING = 6;

    // Значения фигур (в сотых пешки)
    const PIECE_VALUES = {
        [PIECE_PAWN]: 100,
        [PIECE_KNIGHT]: 320,
        [PIECE_BISHOP]: 330,
        [PIECE_ROOK]: 500,
        [PIECE_QUEEN]: 900,
        [PIECE_KING]: 20000
    };

    // ======================== Преобразование квадратов ========================
    const SQUARE_NAMES = [];
    const SQUARE_INDEX = {};
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const name = String.fromCharCode(97 + f) + (8 - r);
            SQUARE_NAMES.push(name);
            SQUARE_INDEX[name] = r * 8 + f;
        }
    }

    // Массивы для быстрого получения файла/ранга из индекса
    const FILE_OF = new Array(64);
    const RANK_OF = new Array(64);
    for (let sq = 0; sq < 64; sq++) {
        FILE_OF[sq] = sq % 8;
        RANK_OF[sq] = Math.floor(sq / 8);
    }

    // Маски для битовых досок (BigInt)
    const SQUARE_BITS = new Array(64);
    const FILE_MASKS = new Array(8);
    const RANK_MASKS = new Array(8);
    for (let i = 0; i < 64; i++) SQUARE_BITS[i] = 1n << BigInt(i);
    for (let f = 0; f < 8; f++) {
        let mask = 0n;
        for (let r = 0; r < 8; r++) mask |= SQUARE_BITS[r * 8 + f];
        FILE_MASKS[f] = mask;
    }
    for (let r = 0; r < 8; r++) {
        let mask = 0n;
        for (let f = 0; f < 8; f++) mask |= SQUARE_BITS[r * 8 + f];
        RANK_MASKS[r] = mask;
    }

    // ======================== Структуры данных ========================
    class Move {
        constructor(from, to, promotion = null, flags = 0) {
            this.from = from;           // 0-63
            this.to = to;               // 0-63
            this.promotion = promotion; // 'q','r','b','n' или null
            this.flags = flags;         // битовые флаги: 1=enPassant, 2=castle, 4=promotion
            this.score = 0;             // для сортировки ходов
        }

        toString() {
            let str = SQUARE_NAMES[this.from] + SQUARE_NAMES[this.to];
            if (this.promotion) str += this.promotion;
            return str;
        }

        equals(other) {
            return this.from === other.from && this.to === other.to && this.promotion === other.promotion;
        }
    }

    class Position {
        constructor() {
            this.board = new Array(64).fill(PIECE_NONE);
            this.colors = new Array(64).fill(COLOR_NONE);
            this.side = COLOR_WHITE;
            this.castling = { whiteK: true, whiteQ: true, blackK: true, blackQ: true };
            this.epSquare = -1;
            this.halfMove = 0;
            this.fullMove = 1;
            this.hash = 0n;
            this.pieceLists = {
                [COLOR_WHITE]: { [PIECE_PAWN]: [], [PIECE_KNIGHT]: [], [PIECE_BISHOP]: [], [PIECE_ROOK]: [], [PIECE_QUEEN]: [], [PIECE_KING]: [] },
                [COLOR_BLACK]: { [PIECE_PAWN]: [], [PIECE_KNIGHT]: [], [PIECE_BISHOP]: [], [PIECE_ROOK]: [], [PIECE_QUEEN]: [], [PIECE_KING]: [] }
            };
        }

        clone() {
            const newPos = new Position();
            newPos.board = this.board.slice();
            newPos.colors = this.colors.slice();
            newPos.side = this.side;
            newPos.castling = { ...this.castling };
            newPos.epSquare = this.epSquare;
            newPos.halfMove = this.halfMove;
            newPos.fullMove = this.fullMove;
            newPos.hash = this.hash;
            // копируем списки
            for (let c = 0; c < 2; c++) {
                for (let p = 1; p <= 6; p++) {
                    newPos.pieceLists[c][p] = this.pieceLists[c][p].slice();
                }
            }
            return newPos;
        }

        setPiece(sq, piece, color) {
            if (this.board[sq] !== PIECE_NONE) {
                this.removePiece(sq);
            }
            this.board[sq] = piece;
            this.colors[sq] = color;
            this.pieceLists[color][piece].push(sq);
        }

        removePiece(sq) {
            const piece = this.board[sq];
            const color = this.colors[sq];
            if (piece !== PIECE_NONE) {
                const idx = this.pieceLists[color][piece].indexOf(sq);
                if (idx !== -1) this.pieceLists[color][piece].splice(idx, 1);
                this.board[sq] = PIECE_NONE;
                this.colors[sq] = COLOR_NONE;
            }
        }

        pieceAt(sq) {
            return this.board[sq] !== PIECE_NONE ? { piece: this.board[sq], color: this.colors[sq] } : null;
        }

        // Zobrist хеш (упрощённая версия, в реальном движке используется 64-битная)
        computeHash() {
            let h = 0n;
            for (let sq = 0; sq < 64; sq++) {
                const p = this.pieceAt(sq);
                if (p) {
                    h ^= (BigInt(p.piece) * 13n + BigInt(p.color)) << (BigInt(sq) % 64n);
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

        // Проверка, атакована ли клетка
        isAttacked(sq, byColor) {
            // реализация будет в engine_movegen.js
            return false;
        }
    }

    // ======================== Таблицы транспозиций ========================
    class TranspositionTable {
        constructor(sizeMB = 16) {
            this.size = Math.floor(sizeMB * 1024 * 1024 / 32); // примерно 32 байта на запись
            this.table = new Array(this.size);
            this.age = 0;
        }

        clear() {
            this.table.fill(null);
        }

        get(hash) {
            const idx = Number(hash % BigInt(this.size));
            const entry = this.table[idx];
            if (entry && entry.hash === hash) return entry;
            return null;
        }

        put(hash, depth, score, move, flag) {
            const idx = Number(hash % BigInt(this.size));
            // Замещение по глубине
            const existing = this.table[idx];
            if (!existing || existing.depth <= depth) {
                this.table[idx] = { hash, depth, score, move, flag, age: this.age };
            }
        }

        incrementAge() {
            this.age++;
        }
    }

    // ======================== Эвристики ========================
    class HistoryHeuristic {
        constructor() {
            // history[color][from][to]
            this.history = Array(2).fill().map(() => Array(64).fill().map(() => new Array(64).fill(0)));
        }

        clear() {
            for (let c = 0; c < 2; c++)
                for (let f = 0; f < 64; f++)
                    for (let t = 0; t < 64; t++)
                        this.history[c][f][t] = 0;
        }

        update(color, from, to, depth) {
            this.history[color][from][to] += depth * depth;
        }

        get(color, from, to) {
            return this.history[color][from][to];
        }
    }

    class KillerMoves {
        constructor(ply) {
            this.killers = Array(MAX_PLY).fill().map(() => [null, null]);
        }

        add(ply, move) {
            if (this.killers[ply][0] && this.killers[ply][0].equals(move)) return;
            this.killers[ply][1] = this.killers[ply][0];
            this.killers[ply][0] = move;
        }

        isKiller(ply, move) {
            return (this.killers[ply][0] && this.killers[ply][0].equals(move)) ||
                   (this.killers[ply][1] && this.killers[ply][1].equals(move));
        }
    }

    // ======================== Управление временем ========================
    class TimeManager {
        constructor() {
            this.startTime = 0;
            this.timeLimit = 0;
            this.infinite = false;
            this.nodesLimit = 0;
            this.moveTime = 0;
            this.remainingTime = [0, 0];
            this.increment = [0, 0];
        }

        start(limits) {
            this.startTime = Date.now();
            this.timeLimit = limits.timeLimit || 0;
            this.infinite = limits.infinite || false;
            this.nodesLimit = limits.nodesLimit || 0;
            this.moveTime = limits.moveTime || 0;
            if (limits.wtime) this.remainingTime[COLOR_WHITE] = limits.wtime;
            if (limits.btime) this.remainingTime[COLOR_BLACK] = limits.btime;
            if (limits.winc) this.increment[COLOR_WHITE] = limits.winc;
            if (limits.binc) this.increment[COLOR_BLACK] = limits.binc;
        }

        shouldStop() {
            if (this.infinite) return false;
            if (this.nodesLimit > 0 && window.engineNodes >= this.nodesLimit) return true;
            if (this.moveTime > 0 && Date.now() - this.startTime >= this.moveTime) return true;
            if (this.timeLimit > 0 && Date.now() - this.startTime >= this.timeLimit) return true;
            if (this.remainingTime[0] > 0 || this.remainingTime[1] > 0) {
                const elapsed = Date.now() - this.startTime;
                // Простая логика: тратим не более 5% от оставшегося времени
                const color = window.currentPosition?.side || COLOR_WHITE;
                const timeLeft = this.remainingTime[color];
                if (timeLeft > 0 && elapsed > timeLeft * 0.05) return true;
            }
            return false;
        }

        elapsed() {
            return Date.now() - this.startTime;
        }
    }

    // ======================== Вспомогательные функции ========================
    function squareToAlgebraic(sq) {
        return SQUARE_NAMES[sq];
    }

    function algebraicToSquare(alg) {
        return SQUARE_INDEX[alg];
    }

    function fileRankToSquare(file, rank) {
        return rank * 8 + file;
    }

    function squareToFileRank(sq) {
        return { file: FILE_OF[sq], rank: RANK_OF[sq] };
    }

    // ======================== Экспорт (глобальный объект) ========================
    window.BurchessTypes = {
        BOARD_SIZE, SQUARE_COUNT, MAX_PLY, MAX_MOVES,
        COLOR_WHITE, COLOR_BLACK, COLOR_NONE,
        PIECE_NONE, PIECE_PAWN, PIECE_KNIGHT, PIECE_BISHOP, PIECE_ROOK, PIECE_QUEEN, PIECE_KING,
        PIECE_VALUES,
        SQUARE_NAMES, SQUARE_INDEX, FILE_OF, RANK_OF, SQUARE_BITS, FILE_MASKS, RANK_MASKS,
        Move, Position, TranspositionTable, HistoryHeuristic, KillerMoves, TimeManager,
        squareToAlgebraic, algebraicToSquare, fileRankToSquare, squareToFileRank
    };
})();
