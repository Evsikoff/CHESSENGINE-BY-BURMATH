/**
 * engine_utils.js — утилиты, математические функции, инициализация таблиц
 * Версия: 2.0
 * Содержит:
 * - битовые операции для BigInt
 * - генерацию таблиц Zobrist
 * - функции для работы с FEN и нотацией
 * - вспомогательные математические функции
 * - отладочные инструменты
 * - предварительный расчёт всех необходимых таблиц для ускорения работы движка
 */

(function() {
    'use strict';

    // ======================== Битовые операции (BigInt) ========================
    const Utils = {
        // Количество бит в 64-битном числе (popcount)
        popCount: (x) => {
            if (typeof x === 'bigint') {
                let count = 0;
                while (x) {
                    count += Number(x & 1n);
                    x >>= 1n;
                }
                return count;
            }
            return 0;
        },

        // Наименьший установленный бит (индекс 0-63)
        lsbIndex: (x) => {
            if (x === 0n) return -1;
            let idx = 0;
            while ((x & 1n) === 0n) {
                x >>= 1n;
                idx++;
            }
            return idx;
        },

        // Наибольший установленный бит (индекс)
        msbIndex: (x) => {
            if (x === 0n) return -1;
            let idx = 63;
            while ((x >> BigInt(idx)) === 0n) idx--;
            return idx;
        },

        // Извлечь все индексы установленных битов
        bitsToList: (x) => {
            const list = [];
            let i = 0;
            while (x) {
                if (x & 1n) list.push(i);
                x >>= 1n;
                i++;
            }
            return list;
        },

        // Поворот битовой доски на 90, 180, 270 градусов (для симметрий)
        rotate90: (x) => {
            // Неэффективно, но для инициализации
            let result = 0n;
            for (let i = 0; i < 64; i++) {
                if ((x >> BigInt(i)) & 1n) {
                    const file = i % 8;
                    const rank = Math.floor(i / 8);
                    const newRank = file;
                    const newFile = 7 - rank;
                    result |= 1n << BigInt(newRank * 8 + newFile);
                }
            }
            return result;
        },

        rotate180: (x) => {
            let result = 0n;
            for (let i = 0; i < 64; i++) {
                if ((x >> BigInt(i)) & 1n) {
                    const newIdx = 63 - i;
                    result |= 1n << BigInt(newIdx);
                }
            }
            return result;
        },

        rotate270: (x) => {
            let result = 0n;
            for (let i = 0; i < 64; i++) {
                if ((x >> BigInt(i)) & 1n) {
                    const file = i % 8;
                    const rank = Math.floor(i / 8);
                    const newRank = 7 - file;
                    const newFile = rank;
                    result |= 1n << BigInt(newRank * 8 + newFile);
                }
            }
            return result;
        },

        // Зеркало по вертикали (смена файлов)
        mirrorVertical: (x) => {
            let result = 0n;
            for (let i = 0; i < 64; i++) {
                if ((x >> BigInt(i)) & 1n) {
                    const file = i % 8;
                    const rank = Math.floor(i / 8);
                    const newFile = 7 - file;
                    result |= 1n << BigInt(rank * 8 + newFile);
                }
            }
            return result;
        },

        // Зеркало по горизонтали (смена рангов)
        mirrorHorizontal: (x) => {
            let result = 0n;
            for (let i = 0; i < 64; i++) {
                if ((x >> BigInt(i)) & 1n) {
                    const file = i % 8;
                    const rank = Math.floor(i / 8);
                    const newRank = 7 - rank;
                    result |= 1n << BigInt(newRank * 8 + file);
                }
            }
            return result;
        },

        // Проверка на степень двойки
        isPowerOfTwo: (x) => x !== 0n && (x & (x - 1n)) === 0n,

        // Пересечение двух битовых досок
        intersect: (a, b) => a & b,
        union: (a, b) => a | b,
        diff: (a, b) => a & ~b,

        // Получить случайное 64-битное число (для Zobrist)
        randomU64: () => {
            const random = () => Math.floor(Math.random() * 0x100000000);
            return (BigInt(random()) << 32n) | BigInt(random());
        }
    };

    // ======================== Zobrist таблицы ========================
    class Zobrist {
        constructor() {
            // [pieceType][color][square]  pieceType 1..6, color 0..1
            this.pieceKeys = Array(7).fill().map(() => Array(2).fill().map(() => Array(64).fill(0n)));
            this.sideKey = 0n;
            this.castlingKeys = Array(16).fill(0n); // 16 комбинаций прав рокировки
            this.epKeys = Array(8).fill(0n); // для каждого файла

            this.init();
        }

        init() {
            for (let p = 1; p <= 6; p++) {
                for (let c = 0; c < 2; c++) {
                    for (let sq = 0; sq < 64; sq++) {
                        this.pieceKeys[p][c][sq] = Utils.randomU64();
                    }
                }
            }
            this.sideKey = Utils.randomU64();
            for (let i = 0; i < 16; i++) {
                this.castlingKeys[i] = Utils.randomU64();
            }
            for (let f = 0; f < 8; f++) {
                this.epKeys[f] = Utils.randomU64();
            }
        }

        // Вычислить хеш позиции
        computeHash(board, colors, side, castling, epSquare) {
            let hash = 0n;
            for (let sq = 0; sq < 64; sq++) {
                const piece = board[sq];
                if (piece !== 0) {
                    const color = colors[sq];
                    hash ^= this.pieceKeys[piece][color][sq];
                }
            }
            if (side === 1) hash ^= this.sideKey;
            let castlingIdx = 0;
            if (castling.whiteK) castlingIdx |= 1;
            if (castling.whiteQ) castlingIdx |= 2;
            if (castling.blackK) castlingIdx |= 4;
            if (castling.blackQ) castlingIdx |= 8;
            hash ^= this.castlingKeys[castlingIdx];
            if (epSquare !== -1) {
                const epFile = epSquare % 8;
                hash ^= this.epKeys[epFile];
            }
            return hash;
        }
    }

    // ======================== Таблицы атак (precomputed) ========================
    const AttackTables = {
        // Для пешек: атаки для каждого квадрата и цвета
        pawnAttacks: Array(2).fill().map(() => Array(64).fill(0n)),
        // Для коней
        knightAttacks: Array(64).fill(0n),
        // Для короля
        kingAttacks: Array(64).fill(0n),
        // Для слонов и ферзей (диагонали) — будут вычисляться динамически с помощью магии
        // но для скорости используем таблицы для всех квадратов
        bishopAttacks: Array(64).fill(0n),
        rookAttacks: Array(64).fill(0n),
        queenAttacks: Array(64).fill(0n)
    };

    // Инициализация таблиц атак
    function initAttackTables() {
        // Пешки
        for (let sq = 0; sq < 64; sq++) {
            const file = sq % 8;
            const rank = Math.floor(sq / 8);
            // Белая пешка атакует вверх-влево и вверх-вправо
            if (rank > 0) {
                if (file > 0) AttackTables.pawnAttacks[0][sq] |= 1n << BigInt(sq - 9);
                if (file < 7) AttackTables.pawnAttacks[0][sq] |= 1n << BigInt(sq - 7);
            }
            // Чёрная пешка атакует вниз-влево и вниз-вправо
            if (rank < 7) {
                if (file > 0) AttackTables.pawnAttacks[1][sq] |= 1n << BigInt(sq + 7);
                if (file < 7) AttackTables.pawnAttacks[1][sq] |= 1n << BigInt(sq + 9);
            }
        }

        // Конь
        const knightOffsets = [-17, -15, -10, -6, 6, 10, 15, 17];
        for (let sq = 0; sq < 64; sq++) {
            const file = sq % 8;
            const rank = Math.floor(sq / 8);
            for (const off of knightOffsets) {
                const to = sq + off;
                if (to >= 0 && to < 64) {
                    const toFile = to % 8;
                    const toRank = Math.floor(to / 8);
                    if (Math.abs(toFile - file) <= 2 && Math.abs(toRank - rank) <= 2) {
                        AttackTables.knightAttacks[sq] |= 1n << BigInt(to);
                    }
                }
            }
        }

        // Король
        const kingOffsets = [-9, -8, -7, -1, 1, 7, 8, 9];
        for (let sq = 0; sq < 64; sq++) {
            const file = sq % 8;
            const rank = Math.floor(sq / 8);
            for (const off of kingOffsets) {
                const to = sq + off;
                if (to >= 0 && to < 64) {
                    const toFile = to % 8;
                    const toRank = Math.floor(to / 8);
                    if (Math.abs(toFile - file) <= 1 && Math.abs(toRank - rank) <= 1) {
                        AttackTables.kingAttacks[sq] |= 1n << BigInt(to);
                    }
                }
            }
        }

        // Слон, ладья, ферзь — используются магические биты, для упрощения создадим простые таблицы
        // В реальном движке — магические биты, здесь реализуем наивно для всех квадратов
        for (let sq = 0; sq < 64; sq++) {
            const file = sq % 8;
            const rank = Math.floor(sq / 8);
            // Диагональные направления
            let bishopMask = 0n;
            // Вверх-влево
            for (let f = file-1, r = rank-1; f >= 0 && r >= 0; f--, r--) bishopMask |= 1n << BigInt(r*8 + f);
            // Вверх-вправо
            for (let f = file+1, r = rank-1; f < 8 && r >= 0; f++, r--) bishopMask |= 1n << BigInt(r*8 + f);
            // Вниз-влево
            for (let f = file-1, r = rank+1; f >= 0 && r < 8; f--, r++) bishopMask |= 1n << BigInt(r*8 + f);
            // Вниз-вправо
            for (let f = file+1, r = rank+1; f < 8 && r < 8; f++, r++) bishopMask |= 1n << BigInt(r*8 + f);
            AttackTables.bishopAttacks[sq] = bishopMask;

            // Прямые направления (ладья)
            let rookMask = 0n;
            // Вверх
            for (let r = rank-1; r >= 0; r--) rookMask |= 1n << BigInt(r*8 + file);
            // Вниз
            for (let r = rank+1; r < 8; r++) rookMask |= 1n << BigInt(r*8 + file);
            // Влево
            for (let f = file-1; f >= 0; f--) rookMask |= 1n << BigInt(rank*8 + f);
            // Вправо
            for (let f = file+1; f < 8; f++) rookMask |= 1n << BigInt(rank*8 + f);
            AttackTables.rookAttacks[sq] = rookMask;

            AttackTables.queenAttacks[sq] = AttackTables.bishopAttacks[sq] | AttackTables.rookAttacks[sq];
        }
    }

    // ======================== Функции для работы с FEN ========================
    function parseFEN(fen) {
        const parts = fen.split(' ');
        const board = [];
        const rows = parts[0].split('/');
        for (let r = 0; r < 8; r++) {
            const row = rows[r];
            for (let i = 0; i < row.length; i++) {
                const ch = row[i];
                if (ch >= '1' && ch <= '8') {
                    const empty = parseInt(ch);
                    for (let e = 0; e < empty; e++) board.push(0);
                } else {
                    let piece = 0, color = 0;
                    switch (ch) {
                        case 'P': piece = 1; color = 0; break;
                        case 'N': piece = 2; color = 0; break;
                        case 'B': piece = 3; color = 0; break;
                        case 'R': piece = 4; color = 0; break;
                        case 'Q': piece = 5; color = 0; break;
                        case 'K': piece = 6; color = 0; break;
                        case 'p': piece = 1; color = 1; break;
                        case 'n': piece = 2; color = 1; break;
                        case 'b': piece = 3; color = 1; break;
                        case 'r': piece = 4; color = 1; break;
                        case 'q': piece = 5; color = 1; break;
                        case 'k': piece = 6; color = 1; break;
                        default: continue;
                    }
                    board.push({ piece, color });
                }
            }
        }
        const side = parts[1] === 'w' ? 0 : 1;
        const castlingStr = parts[2];
        const castling = {
            whiteK: castlingStr.includes('K'),
            whiteQ: castlingStr.includes('Q'),
            blackK: castlingStr.includes('k'),
            blackQ: castlingStr.includes('q')
        };
        let epSquare = -1;
        if (parts[3] !== '-') {
            epSquare = (parts[3][0].charCodeAt(0) - 97) + (8 - parseInt(parts[3][1])) * 8;
        }
        const halfMove = parseInt(parts[4]);
        const fullMove = parseInt(parts[5]);
        return { board, side, castling, epSquare, halfMove, fullMove };
    }

    function toFEN(board, side, castling, epSquare, halfMove, fullMove) {
        let fen = '';
        for (let r = 0; r < 8; r++) {
            let empty = 0;
            for (let f = 0; f < 8; f++) {
                const idx = r*8 + f;
                const piece = board[idx];
                if (piece === 0) {
                    empty++;
                } else {
                    if (empty > 0) {
                        fen += empty;
                        empty = 0;
                    }
                    const pieceChar = (piece.piece === 1 ? 'P' : piece.piece === 2 ? 'N' : piece.piece === 3 ? 'B' : piece.piece === 4 ? 'R' : piece.piece === 5 ? 'Q' : 'K');
                    fen += piece.color === 0 ? pieceChar : pieceChar.toLowerCase();
                }
            }
            if (empty > 0) fen += empty;
            if (r < 7) fen += '/';
        }
        fen += ' ' + (side === 0 ? 'w' : 'b');
        let castlingStr = '';
        if (castling.whiteK) castlingStr += 'K';
        if (castling.whiteQ) castlingStr += 'Q';
        if (castling.blackK) castlingStr += 'k';
        if (castling.blackQ) castlingStr += 'q';
        fen += ' ' + (castlingStr || '-');
        fen += ' ' + (epSquare !== -1 ? String.fromCharCode(97 + (epSquare % 8)) + (8 - Math.floor(epSquare / 8)) : '-');
        fen += ' ' + halfMove;
        fen += ' ' + fullMove;
        return fen;
    }

    // ======================== Преобразование ходов ========================
    function moveToUCI(from, to, promotion) {
        const fromName = String.fromCharCode(97 + (from % 8)) + (8 - Math.floor(from / 8));
        const toName = String.fromCharCode(97 + (to % 8)) + (8 - Math.floor(to / 8));
        let uci = fromName + toName;
        if (promotion) uci += promotion;
        return uci;
    }

    function uciToMove(uci) {
        if (uci.length < 4) return null;
        const fromFile = uci.charCodeAt(0) - 97;
        const fromRank = 8 - parseInt(uci[1]);
        const toFile = uci.charCodeAt(2) - 97;
        const toRank = 8 - parseInt(uci[3]);
        const from = fromRank * 8 + fromFile;
        const to = toRank * 8 + toFile;
        let promotion = null;
        if (uci.length === 5) promotion = uci[4];
        return { from, to, promotion };
    }

    // ======================== Отладочные функции ========================
    function printBoard(board) {
        let output = '';
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const idx = r*8 + f;
                const p = board[idx];
                if (p === 0) output += '. ';
                else {
                    const pieceChar = (p.piece === 1 ? 'P' : p.piece === 2 ? 'N' : p.piece === 3 ? 'B' : p.piece === 4 ? 'R' : p.piece === 5 ? 'Q' : 'K');
                    output += (p.color === 0 ? pieceChar : pieceChar.toLowerCase()) + ' ';
                }
            }
            output += '\n';
        }
        console.log(output);
    }

    function printBitboard(bb) {
        let str = '';
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const sq = r*8 + f;
                if ((bb >> BigInt(sq)) & 1n) str += '1 ';
                else str += '. ';
            }
            str += '\n';
        }
        console.log(str);
    }

    // ======================== Инициализация всех таблиц ========================
    function init() {
        initAttackTables();
        console.log('[Utils] Attack tables initialized');
        const zobrist = new Zobrist();
        console.log('[Utils] Zobrist keys generated');
        window.Zobrist = zobrist;
        window.AttackTables = AttackTables;
        window.Utils = Utils;
    }

    // Экспорт в глобальный объект
    window.BurchessUtils = {
        Utils,
        Zobrist,
        AttackTables,
        parseFEN,
        toFEN,
        moveToUCI,
        uciToMove,
        printBoard,
        printBitboard,
        init
    };
})();
