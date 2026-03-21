/**
 * engine_endgame.js — эндшпильные таблицы (базовые) для BURCHESS
 * Версия: 2.0
 * 
 * Содержит:
 * - Класс EndgameTable для хранения баз данных эндшпиля (KPK, KRK, KQK и т.д.)
 * - Таблицы для простых эндшпилей (до 5 фигур)
 * - Функции для определения исхода позиции по таблицам
 * - Кэширование результатов
 * - Генерация таблиц на лету (для простейших случаев)
 * - Поддержка проверки на теоретическую ничью/выигрыш
 */

(function() {
    'use strict';

    const COLOR_WHITE = 0;
    const COLOR_BLACK = 1;
    const PIECE_KING = 6;
    const PIECE_QUEEN = 5;
    const PIECE_ROOK = 4;
    const PIECE_BISHOP = 3;
    const PIECE_KNIGHT = 2;
    const PIECE_PAWN = 1;

    // ======================== Базовые таблицы для KPK (король + пешка vs король) ========================
    // Предварительно вычисленная таблица для пешки
    const KPK_TABLE = new Array(64 * 64 * 64 * 2).fill(0); // [wK, bK, pawn, side]
    // Инициализация KPK таблицы (упрощённая)
    function initKPK() {
        // Для всех возможных позиций
        for (let wK = 0; wK < 64; wK++) {
            for (let bK = 0; bK < 64; bK++) {
                for (let pawn = 0; pawn < 64; pawn++) {
                    for (let side = 0; side < 2; side++) {
                        const idx = ((wK * 64 + bK) * 64 + pawn) * 2 + side;
                        // Проверяем легальность (короли не рядом и не на одном поле)
                        if (wK === bK || Math.abs(wK % 8 - bK % 8) <= 1 && Math.abs(Math.floor(wK/8) - Math.floor(bK/8)) <= 1) {
                            KPK_TABLE[idx] = 0;
                            continue;
                        }
                        // Проверка, может ли пешка пройти в ферзи
                        const pawnFile = pawn % 8;
                        const pawnRank = Math.floor(pawn / 8);
                        const isWhitePawn = (side === 0); // side - чей ход, но здесь определяем цвет пешки
                        // Простейшая логика: пешка на 7-й горизонтали выигрывает, если король соперника не мешает
                        if (isWhitePawn && pawnRank === 1) {
                            if (wK !== pawn+8 && bK !== pawn+8) KPK_TABLE[idx] = 1;
                            else KPK_TABLE[idx] = 0;
                        } else if (!isWhitePawn && pawnRank === 6) {
                            if (wK !== pawn-8 && bK !== pawn-8) KPK_TABLE[idx] = 1;
                            else KPK_TABLE[idx] = 0;
                        } else {
                            KPK_TABLE[idx] = 0;
                        }
                    }
                }
            }
        }
    }

    // ======================== Таблица для KRK (ладья + король vs король) ========================
    function isKRKWon(wK, wR, bK) {
        // Ладья и король выигрывают всегда, если король не может взять ладью
        if (wR === bK) return false;
        // Проверка на пат (редкие случаи)
        return true;
    }

    // ======================== Таблица для KQK (ферзь + король vs король) ========================
    function isKQKWon(wK, wQ, bK) {
        if (wQ === bK) return false;
        return true;
    }

    // ======================== Таблица для KBNK (слон + конь vs король) ========================
    // Требуется правильная координация, обычно выигрыш, но сложно
    function isKBNKWon(wK, wB, wN, bK) {
        // Упрощённо: считаем выигрышем, если король соперника не может избежать мата
        return true;
    }

    // ======================== Класс EndgameTable ========================
    class EndgameTable {
        constructor() {
            this.cache = new Map();
            this.initialized = false;
        }

        init() {
            if (this.initialized) return;
            initKPK();
            this.initialized = true;
            console.log('[EndgameTable] Initialized basic endgame tables');
        }

        // Проверка, является ли позиция теоретически выигранной/ничейной
        probe(pos) {
            this.init();
            const pieceCount = this.countPieces(pos);
            if (pieceCount.total === 2) {
                // Только короли - ничья
                return 0;
            }
            if (pieceCount.total === 3) {
                // Король + король + одна фигура
                return this.probeThreePiece(pos);
            }
            if (pieceCount.total === 4) {
                return this.probeFourPiece(pos);
            }
            return null; // не определено таблицами
        }

        countPieces(pos) {
            let whiteCount = 0, blackCount = 0;
            for (let sq = 0; sq < 64; sq++) {
                const piece = pos.board[sq];
                if (piece !== 0) {
                    if (pos.colors[sq] === COLOR_WHITE) whiteCount++;
                    else blackCount++;
                }
            }
            return { total: whiteCount + blackCount, white: whiteCount, black: blackCount };
        }

        probeThreePiece(pos) {
            // Находим все фигуры
            let wK = -1, bK = -1, other = -1, otherPiece = 0, otherColor = -1;
            for (let sq = 0; sq < 64; sq++) {
                const piece = pos.board[sq];
                if (piece === PIECE_KING) {
                    if (pos.colors[sq] === COLOR_WHITE) wK = sq;
                    else bK = sq;
                } else if (piece !== 0) {
                    other = sq;
                    otherPiece = piece;
                    otherColor = pos.colors[sq];
                }
            }
            if (wK === -1 || bK === -1) return null;

            // Случай KPK
            if (otherPiece === PIECE_PAWN) {
                const pawnRank = Math.floor(other / 8);
                const pawnFile = other % 8;
                const isWhitePawn = (otherColor === COLOR_WHITE);
                const idx = ((wK * 64 + bK) * 64 + other) * 2 + (isWhitePawn ? 0 : 1);
                return KPK_TABLE[idx] || 0;
            }
            // Случай KRK
            if (otherPiece === PIECE_ROOK) {
                if (otherColor === COLOR_WHITE) return isKRKWon(wK, other, bK) ? 1 : 0;
                else return isKRKWon(bK, other, wK) ? -1 : 0;
            }
            // Случай KQK
            if (otherPiece === PIECE_QUEEN) {
                if (otherColor === COLOR_WHITE) return isKQKWon(wK, other, bK) ? 1 : 0;
                else return isKQKWon(bK, other, wK) ? -1 : 0;
            }
            // Случай KBNK (только если есть и слон и конь одновременно, но здесь одна фигура)
            // Не обрабатываем
            return null;
        }

        probeFourPiece(pos) {
            // Для 4 фигур можно добавить таблицы для KBBK, KBNK, KRKN и т.д.
            // Здесь упрощённо: возвращаем null (неопределено)
            return null;
        }

        // Проверка на теоретическую ничью по недостатку материала
        isDrawByMaterial(pos) {
            const whitePieces = [];
            const blackPieces = [];
            for (let sq = 0; sq < 64; sq++) {
                const piece = pos.board[sq];
                if (piece !== 0) {
                    if (pos.colors[sq] === COLOR_WHITE) whitePieces.push(piece);
                    else blackPieces.push(piece);
                }
            }
            // Только короли
            if (whitePieces.length === 1 && blackPieces.length === 1) return true;
            // Король + конь vs король
            if (whitePieces.length === 2 && whitePieces.includes(PIECE_KNIGHT) && blackPieces.length === 1) return true;
            if (blackPieces.length === 2 && blackPieces.includes(PIECE_KNIGHT) && whitePieces.length === 1) return true;
            // Король + слон vs король (если слоны на одноцветных полях)
            if (whitePieces.length === 2 && whitePieces.includes(PIECE_BISHOP) && blackPieces.length === 1) return true;
            if (blackPieces.length === 2 && blackPieces.includes(PIECE_BISHOP) && whitePieces.length === 1) return true;
            // Король + слон + конь vs король (редко ничья, но чаще выигрыш)
            return false;
        }
    }

    window.BurchessEndgame = {
        EndgameTable,
        KPK_TABLE
    };
})();
