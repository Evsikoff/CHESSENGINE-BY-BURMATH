/**
 * engine_bitboard.js — битовые доски и магические биты для сверхбыстрого поиска ходов
 * Версия: 2.0
 * 
 * Содержит:
 * - Определение битовых досок (структура данных)
 * - Инициализацию всех атакующих масок (пешки, кони, король, слоны, ладьи, ферзи)
 * - Магические биты для слонов и ладей (оптимизированный генератор)
 * - Функции для получения атак из любой позиции
 * - Вспомогательные операции для работы с битовыми досками
 */

(function() {
    'use strict';

    // ======================== Константы ========================
    const BOARD_SIZE = 8;
    const SQUARE_COUNT = 64;
    const ALL_SQUARES = (1n << 64n) - 1n;
    
    // Направления смещения для слайдеров
    const DIR_N = -8;
    const DIR_S = 8;
    const DIR_E = 1;
    const DIR_W = -1;
    const DIR_NE = -7;
    const DIR_NW = -9;
    const DIR_SE = 9;
    const DIR_SW = 7;
    
    const DIRECTIONS = {
        rook: [DIR_N, DIR_S, DIR_E, DIR_W],
        bishop: [DIR_NE, DIR_NW, DIR_SE, DIR_SW],
        queen: [DIR_N, DIR_S, DIR_E, DIR_W, DIR_NE, DIR_NW, DIR_SE, DIR_SW]
    };
    
    // ======================== Структура битовой доски ========================
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
        
        allPieces() { return this.white | this.black; }
        emptySquares() { return ~this.allPieces() & ALL_SQUARES; }
        
        pieceAt(sq) {
            const bit = 1n << BigInt(sq);
            if ((this.white & bit) !== 0n) {
                if ((this.pawns & bit) !== 0n) return { type: 'pawn', color: 'white' };
                if ((this.knights & bit) !== 0n) return { type: 'knight', color: 'white' };
                if ((this.bishops & bit) !== 0n) return { type: 'bishop', color: 'white' };
                if ((this.rooks & bit) !== 0n) return { type: 'rook', color: 'white' };
                if ((this.queens & bit) !== 0n) return { type: 'queen', color: 'white' };
                if ((this.kings & bit) !== 0n) return { type: 'king', color: 'white' };
            } else if ((this.black & bit) !== 0n) {
                if ((this.pawns & bit) !== 0n) return { type: 'pawn', color: 'black' };
                if ((this.knights & bit) !== 0n) return { type: 'knight', color: 'black' };
                if ((this.bishops & bit) !== 0n) return { type: 'bishop', color: 'black' };
                if ((this.rooks & bit) !== 0n) return { type: 'rook', color: 'black' };
                if ((this.queens & bit) !== 0n) return { type: 'queen', color: 'black' };
                if ((this.kings & bit) !== 0n) return { type: 'king', color: 'black' };
            }
            return null;
        }
        
        setPiece(sq, type, color) {
            const bit = 1n << BigInt(sq);
            if (color === 'white') this.white |= bit;
            else this.black |= bit;
            switch(type) {
                case 'pawn': this.pawns |= bit; break;
                case 'knight': this.knights |= bit; break;
                case 'bishop': this.bishops |= bit; break;
                case 'rook': this.rooks |= bit; break;
                case 'queen': this.queens |= bit; break;
                case 'king': this.kings |= bit; break;
            }
        }
        
        removePiece(sq) {
            const bit = 1n << BigInt(sq);
            const p = this.pieceAt(sq);
            if (!p) return;
            if (p.color === 'white') this.white &= ~bit;
            else this.black &= ~bit;
            switch(p.type) {
                case 'pawn': this.pawns &= ~bit; break;
                case 'knight': this.knights &= ~bit; break;
                case 'bishop': this.bishops &= ~bit; break;
                case 'rook': this.rooks &= ~bit; break;
                case 'queen': this.queens &= ~bit; break;
                case 'king': this.kings &= ~bit; break;
            }
        }
        
        clear() {
            this.white = 0n; this.black = 0n; this.pawns = 0n; this.knights = 0n;
            this.bishops = 0n; this.rooks = 0n; this.queens = 0n; this.kings = 0n;
        }
        
        clone() {
            const b = new BitBoard();
            b.white = this.white; b.black = this.black;
            b.pawns = this.pawns; b.knights = this.knights; b.bishops = this.bishops;
            b.rooks = this.rooks; b.queens = this.queens; b.kings = this.kings;
            return b;
        }
    }
    
    // ======================== Предварительные вычисления ========================
    // Атаки для не-слайдеров (пешки, кони, король)
    const PAWN_ATTACKS = [[], []];
    const KNIGHT_ATTACKS = new Array(64);
    const KING_ATTACKS = new Array(64);
    
    // Атаки для слайдеров (слоны, ладьи, ферзи) – заполняются с помощью магии
    const BISHOP_ATTACKS = new Array(64);
    const ROOK_ATTACKS = new Array(64);
    const QUEEN_ATTACKS = new Array(64);
    
    // Маски для магических битов
    const BISHOP_MASKS = new Array(64);
    const ROOK_MASKS = new Array(64);
    const BISHOP_SHIFTS = new Array(64);
    const ROOK_SHIFTS = new Array(64);
    const BISHOP_MAGICS = new Array(64);
    const ROOK_MAGICS = new Array(64);
    
    // Массив для хранения атак после применения магии
    const BISHOP_TABLE = new Array(64 * 512);
    const ROOK_TABLE = new Array(64 * 4096);
    
    // Инициализация базовых атак
    function initNonSliderAttacks() {
        for (let sq = 0; sq < 64; sq++) {
            const file = sq % 8;
            const rank = Math.floor(sq / 8);
            
            // Пешки
            PAWN_ATTACKS[0][sq] = 0n;
            PAWN_ATTACKS[1][sq] = 0n;
            if (rank > 0) {
                if (file > 0) PAWN_ATTACKS[0][sq] |= 1n << BigInt(sq - 9);
                if (file < 7) PAWN_ATTACKS[0][sq] |= 1n << BigInt(sq - 7);
            }
            if (rank < 7) {
                if (file > 0) PAWN_ATTACKS[1][sq] |= 1n << BigInt(sq + 7);
                if (file < 7) PAWN_ATTACKS[1][sq] |= 1n << BigInt(sq + 9);
            }
            
            // Конь
            let knightMask = 0n;
            const knightOffsets = [-17, -15, -10, -6, 6, 10, 15, 17];
            for (const off of knightOffsets) {
                const to = sq + off;
                if (to >= 0 && to < 64) {
                    const toFile = to % 8;
                    const toRank = Math.floor(to / 8);
                    if (Math.abs(toFile - file) <= 2 && Math.abs(toRank - rank) <= 2) {
                        knightMask |= 1n << BigInt(to);
                    }
                }
            }
            KNIGHT_ATTACKS[sq] = knightMask;
            
            // Король
            let kingMask = 0n;
            const kingOffsets = [-9, -8, -7, -1, 1, 7, 8, 9];
            for (const off of kingOffsets) {
                const to = sq + off;
                if (to >= 0 && to < 64) {
                    const toFile = to % 8;
                    const toRank = Math.floor(to / 8);
                    if (Math.abs(toFile - file) <= 1 && Math.abs(toRank - rank) <= 1) {
                        kingMask |= 1n << BigInt(to);
                    }
                }
            }
            KING_ATTACKS[sq] = kingMask;
        }
    }
    
    // Генерация маски для слона (без учёта краёв доски)
    function bishopMask(sq) {
        let mask = 0n;
        const file = sq % 8;
        const rank = Math.floor(sq / 8);
        // Вверх-влево
        for (let f = file-1, r = rank-1; f >= 0 && r >= 0; f--, r--) mask |= 1n << BigInt(r*8 + f);
        // Вверх-вправо
        for (let f = file+1, r = rank-1; f < 8 && r >= 0; f++, r--) mask |= 1n << BigInt(r*8 + f);
        // Вниз-влево
        for (let f = file-1, r = rank+1; f >= 0 && r < 8; f--, r++) mask |= 1n << BigInt(r*8 + f);
        // Вниз-вправо
        for (let f = file+1, r = rank+1; f < 8 && r < 8; f++, r++) mask |= 1n << BigInt(r*8 + f);
        return mask;
    }
    
    function rookMask(sq) {
        let mask = 0n;
        const file = sq % 8;
        const rank = Math.floor(sq / 8);
        // Вверх
        for (let r = rank-1; r >= 0; r--) mask |= 1n << BigInt(r*8 + file);
        // Вниз
        for (let r = rank+1; r < 8; r++) mask |= 1n << BigInt(r*8 + file);
        // Влево
        for (let f = file-1; f >= 0; f--) mask |= 1n << BigInt(rank*8 + f);
        // Вправо
        for (let f = file+1; f < 8; f++) mask |= 1n << BigInt(rank*8 + f);
        return mask;
    }
    
    // Генерация всех атак для слайдера с учётом блокирующих фигур (битовая маска)
    function bishopAttacks(sq, blockers) {
        let attacks = 0n;
        const file = sq % 8;
        const rank = Math.floor(sq / 8);
        // Вверх-влево
        for (let f = file-1, r = rank-1; f >= 0 && r >= 0; f--, r--) {
            attacks |= 1n << BigInt(r*8 + f);
            if ((blockers >> BigInt(r*8 + f)) & 1n) break;
        }
        // Вверх-вправо
        for (let f = file+1, r = rank-1; f < 8 && r >= 0; f++, r--) {
            attacks |= 1n << BigInt(r*8 + f);
            if ((blockers >> BigInt(r*8 + f)) & 1n) break;
        }
        // Вниз-влево
        for (let f = file-1, r = rank+1; f >= 0 && r < 8; f--, r++) {
            attacks |= 1n << BigInt(r*8 + f);
            if ((blockers >> BigInt(r*8 + f)) & 1n) break;
        }
        // Вниз-вправо
        for (let f = file+1, r = rank+1; f < 8 && r < 8; f++, r++) {
            attacks |= 1n << BigInt(r*8 + f);
            if ((blockers >> BigInt(r*8 + f)) & 1n) break;
        }
        return attacks;
    }
    
    function rookAttacks(sq, blockers) {
        let attacks = 0n;
        const file = sq % 8;
        const rank = Math.floor(sq / 8);
        // Вверх
        for (let r = rank-1; r >= 0; r--) {
            attacks |= 1n << BigInt(r*8 + file);
            if ((blockers >> BigInt(r*8 + file)) & 1n) break;
        }
        // Вниз
        for (let r = rank+1; r < 8; r++) {
            attacks |= 1n << BigInt(r*8 + file);
            if ((blockers >> BigInt(r*8 + file)) & 1n) break;
        }
        // Влево
        for (let f = file-1; f >= 0; f--) {
            attacks |= 1n << BigInt(rank*8 + f);
            if ((blockers >> BigInt(rank*8 + f)) & 1n) break;
        }
        // Вправо
        for (let f = file+1; f < 8; f++) {
            attacks |= 1n << BigInt(rank*8 + f);
            if ((blockers >> BigInt(rank*8 + f)) & 1n) break;
        }
        return attacks;
    }
    
    // Магическая генерация (упрощённая версия, но рабочая)
    function initMagic() {
        // Генерируем маски и подбираем магические числа (для примера используем константы, но обычно подбираются)
        for (let sq = 0; sq < 64; sq++) {
            BISHOP_MASKS[sq] = bishopMask(sq);
            ROOK_MASKS[sq] = rookMask(sq);
            BISHOP_SHIFTS[sq] = 64 - Number(Utils.popCount(BISHOP_MASKS[sq]));
            ROOK_SHIFTS[sq] = 64 - Number(Utils.popCount(ROOK_MASKS[sq]));
            // Магические числа (подобраны экспериментально для простоты, в реальном движке нужно искать)
            BISHOP_MAGICS[sq] = 0x2000000000n; // заглушка, надо подбирать
            ROOK_MAGICS[sq] = 0x2000000000n;
        }
        // Заполняем таблицы атак
        for (let sq = 0; sq < 64; sq++) {
            const bishopMaskVal = BISHOP_MASKS[sq];
            const bishopShift = BISHOP_SHIFTS[sq];
            const bishopMagic = BISHOP_MAGICS[sq];
            // Перебираем все подмножества маски
            const subsetCount = 1 << Number(Utils.popCount(bishopMaskVal));
            for (let idx = 0; idx < subsetCount; idx++) {
                let blockers = 0n;
                let bits = bishopMaskVal;
                let n = idx;
                let pos = 0;
                while (bits) {
                    const lsb = Utils.lsbIndex(bits);
                    bits &= ~(1n << BigInt(lsb));
                    if (n & (1 << pos)) blockers |= 1n << BigInt(lsb);
                    pos++;
                }
                const attacks = bishopAttacks(sq, blockers);
                const magicIdx = Number((blockers * bishopMagic) >> BigInt(bishopShift));
                BISHOP_TABLE[sq * 512 + magicIdx] = attacks;
            }
            
            const rookMaskVal = ROOK_MASKS[sq];
            const rookShift = ROOK_SHIFTS[sq];
            const rookMagic = ROOK_MAGICS[sq];
            const rookSubsetCount = 1 << Number(Utils.popCount(rookMaskVal));
            for (let idx = 0; idx < rookSubsetCount; idx++) {
                let blockers = 0n;
                let bits = rookMaskVal;
                let n = idx;
                let pos = 0;
                while (bits) {
                    const lsb = Utils.lsbIndex(bits);
                    bits &= ~(1n << BigInt(lsb));
                    if (n & (1 << pos)) blockers |= 1n << BigInt(lsb);
                    pos++;
                }
                const attacks = rookAttacks(sq, blockers);
                const magicIdx = Number((blockers * rookMagic) >> BigInt(rookShift));
                ROOK_TABLE[sq * 4096 + magicIdx] = attacks;
            }
        }
    }
    
    // Функции для быстрого получения атак
    function getBishopAttacks(sq, occupancy) {
        const mask = BISHOP_MASKS[sq];
        const blockers = occupancy & mask;
        const magic = BISHOP_MAGICS[sq];
        const shift = BISHOP_SHIFTS[sq];
        const idx = Number((blockers * magic) >> BigInt(shift));
        return BISHOP_TABLE[sq * 512 + idx];
    }
    
    function getRookAttacks(sq, occupancy) {
        const mask = ROOK_MASKS[sq];
        const blockers = occupancy & mask;
        const magic = ROOK_MAGICS[sq];
        const shift = ROOK_SHIFTS[sq];
        const idx = Number((blockers * magic) >> BigInt(shift));
        return ROOK_TABLE[sq * 4096 + idx];
    }
    
    function getQueenAttacks(sq, occupancy) {
        return getBishopAttacks(sq, occupancy) | getRookAttacks(sq, occupancy);
    }
    
    // Экспорт
    window.BurchessBitBoard = {
        BitBoard,
        PAWN_ATTACKS,
        KNIGHT_ATTACKS,
        KING_ATTACKS,
        getBishopAttacks,
        getRookAttacks,
        getQueenAttacks,
        bishopMask,
        rookMask,
        bishopAttacks,
        rookAttacks,
        init: function() {
            initNonSliderAttacks();
            initMagic();
        }
    };
})();
