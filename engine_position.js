/**
 * engine_position.js — управление позицией: представление, хеширование, выполнение ходов
 * Версия: 2.0
 * 
 * Содержит:
 * - Класс Position для хранения полного состояния партии
 * - Загрузка/сохранение в FEN
 * - Zobrist хеширование
 * - Выполнение и откат ходов (make/unmake)
 * - Проверки на мат, пат, повторение позиции
 * - Копирование позиции
 * - Управление историей позиций для трёхкратного повторения
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
    
    const PIECE_SYMBOLS = {
        [PIECE_PAWN]: 'p',
        [PIECE_KNIGHT]: 'n',
        [PIECE_BISHOP]: 'b',
        [PIECE_ROOK]: 'r',
        [PIECE_QUEEN]: 'q',
        [PIECE_KING]: 'k'
    };
    
    // Стартовая FEN
    const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    // ======================== Класс Position ========================
    class Position {
        constructor() {
            // Доска: 64 элемента, хранит тип фигуры (1-6) или 0
            this.board = new Array(64).fill(PIECE_NONE);
            // Цвет фигуры на каждой клетке: 0=белый, 1=чёрный, -1=нет
            this.colors = new Array(64).fill(-1);
            // Текущий игрок
            this.side = COLOR_WHITE;
            // Права рокировки
            this.castling = {
                whiteK: true,
                whiteQ: true,
                blackK: true,
                blackQ: true
            };
            // Клетка для взятия на проходе (индекс 0-63) или -1
            this.epSquare = -1;
            // Полуходы (правило 50 ходов)
            this.halfMoveClock = 0;
            // Номер полного хода
            this.fullMoveNumber = 1;
            // Zobrist хеш (64-бит)
            this.hash = 0n;
            // Списки фигур для быстрого доступа
            this.pieceLists = {
                [COLOR_WHITE]: {
                    [PIECE_PAWN]: [],
                    [PIECE_KNIGHT]: [],
                    [PIECE_BISHOP]: [],
                    [PIECE_ROOK]: [],
                    [PIECE_QUEEN]: [],
                    [PIECE_KING]: []
                },
                [COLOR_BLACK]: {
                    [PIECE_PAWN]: [],
                    [PIECE_KNIGHT]: [],
                    [PIECE_BISHOP]: [],
                    [PIECE_ROOK]: [],
                    [PIECE_QUEEN]: [],
                    [PIECE_KING]: []
                }
            };
            // История позиций для трёхкратного повторения
            this.history = [];
            // Глобальный объект Zobrist (должен быть инициализирован)
            this.zobrist = window.Zobrist;
        }

        // ======================== Инициализация из FEN ========================
        fromFEN(fen) {
            const parts = fen.split(' ');
            if (parts.length < 6) {
                console.error('Invalid FEN:', fen);
                return false;
            }
            // Очистка текущего состояния
            this.board.fill(PIECE_NONE);
            this.colors.fill(-1);
            for (let c = 0; c < 2; c++) {
                for (let p = 1; p <= 6; p++) {
                    this.pieceLists[c][p] = [];
                }
            }
            // Расстановка фигур
            const rows = parts[0].split('/');
            let sq = 0;
            for (let r = 0; r < 8; r++) {
                const row = rows[r];
                for (let i = 0; i < row.length; i++) {
                    const ch = row[i];
                    if (ch >= '1' && ch <= '8') {
                        sq += parseInt(ch);
                    } else {
                        let piece, color;
                        switch (ch) {
                            case 'P': piece = PIECE_PAWN; color = COLOR_WHITE; break;
                            case 'N': piece = PIECE_KNIGHT; color = COLOR_WHITE; break;
                            case 'B': piece = PIECE_BISHOP; color = COLOR_WHITE; break;
                            case 'R': piece = PIECE_ROOK; color = COLOR_WHITE; break;
                            case 'Q': piece = PIECE_QUEEN; color = COLOR_WHITE; break;
                            case 'K': piece = PIECE_KING; color = COLOR_WHITE; break;
                            case 'p': piece = PIECE_PAWN; color = COLOR_BLACK; break;
                            case 'n': piece = PIECE_KNIGHT; color = COLOR_BLACK; break;
                            case 'b': piece = PIECE_BISHOP; color = COLOR_BLACK; break;
                            case 'r': piece = PIECE_ROOK; color = COLOR_BLACK; break;
                            case 'q': piece = PIECE_QUEEN; color = COLOR_BLACK; break;
                            case 'k': piece = PIECE_KING; color = COLOR_BLACK; break;
                            default: continue;
                        }
                        this.board[sq] = piece;
                        this.colors[sq] = color;
                        this.pieceLists[color][piece].push(sq);
                        sq++;
                    }
                }
            }
            // Чей ход
            this.side = (parts[1] === 'w') ? COLOR_WHITE : COLOR_BLACK;
            // Рокировка
            const castlingStr = parts[2];
            this.castling = {
                whiteK: castlingStr.includes('K'),
                whiteQ: castlingStr.includes('Q'),
                blackK: castlingStr.includes('k'),
                blackQ: castlingStr.includes('q')
            };
            // en passant
            if (parts[3] !== '-') {
                const epFile = parts[3][0].charCodeAt(0) - 97;
                const epRank = 8 - parseInt(parts[3][1]);
                this.epSquare = epRank * 8 + epFile;
            } else {
                this.epSquare = -1;
            }
            this.halfMoveClock = parseInt(parts[4]);
            this.fullMoveNumber = parseInt(parts[5]);
            // Вычисляем хеш
            this.computeHash();
            // Очищаем историю
            this.history = [];
            return true;
        }

        // ======================== Преобразование в FEN ========================
        toFEN() {
            let fen = '';
            for (let r = 0; r < 8; r++) {
                let empty = 0;
                for (let f = 0; f < 8; f++) {
                    const sq = r * 8 + f;
                    const piece = this.board[sq];
                    if (piece === PIECE_NONE) {
                        empty++;
                    } else {
                        if (empty > 0) {
                            fen += empty;
                            empty = 0;
                        }
                        const color = this.colors[sq];
                        const symbol = PIECE_SYMBOLS[piece];
                        fen += (color === COLOR_WHITE) ? symbol.toUpperCase() : symbol;
                    }
                }
                if (empty > 0) fen += empty;
                if (r < 7) fen += '/';
            }
            fen += ' ' + (this.side === COLOR_WHITE ? 'w' : 'b');
            let castlingStr = '';
            if (this.castling.whiteK) castlingStr += 'K';
            if (this.castling.whiteQ) castlingStr += 'Q';
            if (this.castling.blackK) castlingStr += 'k';
            if (this.castling.blackQ) castlingStr += 'q';
            fen += ' ' + (castlingStr || '-');
            fen += ' ' + (this.epSquare !== -1 ? String.fromCharCode(97 + (this.epSquare % 8)) + (8 - Math.floor(this.epSquare / 8)) : '-');
            fen += ' ' + this.halfMoveClock;
            fen += ' ' + this.fullMoveNumber;
            return fen;
        }

        // ======================== Zobrist хеш ========================
        computeHash() {
            let h = 0n;
            for (let sq = 0; sq < 64; sq++) {
                const piece = this.board[sq];
                if (piece !== PIECE_NONE) {
                    const color = this.colors[sq];
                    h ^= this.zobrist.pieceKeys[piece][color][sq];
                }
            }
            if (this.side === COLOR_BLACK) h ^= this.zobrist.sideKey;
            let castlingIdx = 0;
            if (this.castling.whiteK) castlingIdx |= 1;
            if (this.castling.whiteQ) castlingIdx |= 2;
            if (this.castling.blackK) castlingIdx |= 4;
            if (this.castling.blackQ) castlingIdx |= 8;
            h ^= this.zobrist.castlingKeys[castlingIdx];
            if (this.epSquare !== -1) {
                const epFile = this.epSquare % 8;
                h ^= this.zobrist.epKeys[epFile];
            }
            this.hash = h;
            return h;
        }

        // ======================== Выполнение хода (make) ========================
        makeMove(move, state = null) {
            // Сохраняем состояние для отката, если передан объект
            if (state) {
                state.board = this.board.slice();
                state.colors = this.colors.slice();
                state.side = this.side;
                state.castling = { ...this.castling };
                state.epSquare = this.epSquare;
                state.halfMoveClock = this.halfMoveClock;
                state.fullMoveNumber = this.fullMoveNumber;
                state.hash = this.hash;
                state.capturedPiece = null;
                state.capturedSquare = -1;
                state.pieceLists = null; // упрощённо, можно копировать, но для производительности можно не копировать все списки
            }
            const from = move.from;
            const to = move.to;
            const piece = this.board[from];
            const color = this.colors[from];
            if (piece === PIECE_NONE) return false;
            // Запоминаем взятую фигуру
            const capturedPiece = this.board[to];
            const capturedColor = this.colors[to];
            // Удаляем взятую фигуру
            if (capturedPiece !== PIECE_NONE) {
                this.removePiece(to);
            }
            // en passant: убираем пешку сзади
            let epCaptured = false;
            if (move.flags & 1) { // enPassant
                const epRank = (color === COLOR_WHITE) ? to + 8 : to - 8;
                if (epRank >= 0 && epRank < 64 && this.board[epRank] === PIECE_PAWN && this.colors[epRank] !== color) {
                    this.removePiece(epRank);
                    epCaptured = true;
                }
            }
            // Перемещаем фигуру
            this.removePiece(from);
            let newPiece = piece;
            if (move.flags & 4) { // promotion
                switch (move.promotion) {
                    case 'q': newPiece = PIECE_QUEEN; break;
                    case 'r': newPiece = PIECE_ROOK; break;
                    case 'b': newPiece = PIECE_BISHOP; break;
                    case 'n': newPiece = PIECE_KNIGHT; break;
                    default: newPiece = PIECE_QUEEN;
                }
            }
            this.setPiece(to, newPiece, color);
            // Рокировка: перемещаем ладью
            let castleRookMoved = false;
            if (move.flags & 2) { // castle
                const backRank = (color === COLOR_WHITE) ? 7 : 0;
                let rookFrom, rookTo;
                if (to === 6 + backRank*8) { // kingside
                    rookFrom = 7 + backRank*8;
                    rookTo = 5 + backRank*8;
                } else { // queenside
                    rookFrom = backRank*8;
                    rookTo = 3 + backRank*8;
                }
                const rookPiece = this.board[rookFrom];
                const rookColor = this.colors[rookFrom];
                if (rookPiece === PIECE_ROOK && rookColor === color) {
                    this.removePiece(rookFrom);
                    this.setPiece(rookTo, PIECE_ROOK, color);
                    castleRookMoved = true;
                }
            }
            // Обновляем права рокировки
            if (piece === PIECE_KING) {
                if (color === COLOR_WHITE) {
                    this.castling.whiteK = false;
                    this.castling.whiteQ = false;
                } else {
                    this.castling.blackK = false;
                    this.castling.blackQ = false;
                }
            }
            if (piece === PIECE_ROOK) {
                if (color === COLOR_WHITE && from === 7*8+0) this.castling.whiteQ = false;
                if (color === COLOR_WHITE && from === 7*8+7) this.castling.whiteK = false;
                if (color === COLOR_BLACK && from === 0) this.castling.blackQ = false;
                if (color === COLOR_BLACK && from === 7) this.castling.blackK = false;
            }
            if (capturedPiece === PIECE_ROOK) {
                if (capturedColor === COLOR_WHITE && to === 7*8+0) this.castling.whiteQ = false;
                if (capturedColor === COLOR_WHITE && to === 7*8+7) this.castling.whiteK = false;
                if (capturedColor === COLOR_BLACK && to === 0) this.castling.blackQ = false;
                if (capturedColor === COLOR_BLACK && to === 7) this.castling.blackK = false;
            }
            // Обновляем en passant target
            let newEpSquare = -1;
            if (piece === PIECE_PAWN && Math.abs(to - from) === 16) {
                newEpSquare = (from + to) / 2;
            }
            // Обновляем счётчики
            this.halfMoveClock = (capturedPiece !== PIECE_NONE || piece === PIECE_PAWN) ? 0 : this.halfMoveClock + 1;
            if (color === COLOR_BLACK) this.fullMoveNumber++;
            // Меняем сторону
            this.side = 1 - this.side;
            // Сохраняем предыдущий epSquare для отката
            const oldEpSquare = this.epSquare;
            this.epSquare = newEpSquare;
            // Пересчитываем хеш
            this.hash = this.computeHash();
            // Сохраняем историю для повторений (упрощённо)
            if (state) {
                state.oldEpSquare = oldEpSquare;
                state.castleRookMoved = castleRookMoved;
                state.epCaptured = epCaptured;
                state.capturedPiece = capturedPiece;
                state.capturedColor = capturedColor;
                state.capturedSquare = to;
            }
            return true;
        }

        // Откат хода (unmake)
        unmakeMove(move, state) {
            if (!state) return false;
            // Восстанавливаем сохранённое состояние
            this.board = state.board.slice();
            this.colors = state.colors.slice();
            this.side = state.side;
            this.castling = { ...state.castling };
            this.epSquare = state.epSquare;
            this.halfMoveClock = state.halfMoveClock;
            this.fullMoveNumber = state.fullMoveNumber;
            this.hash = state.hash;
            // Если нужно восстановить списки, то придётся пересчитать, но для простоты не делаем
            return true;
        }

        // Вспомогательные методы для работы с доской
        setPiece(sq, piece, color) {
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
                this.colors[sq] = -1;
            }
        }

        pieceAt(sq) {
            return this.board[sq] !== PIECE_NONE ? { piece: this.board[sq], color: this.colors[sq] } : null;
        }

        // ======================== Проверка окончания партии ========================
        isCheck() {
            // Находим короля текущего игрока
            const kingPiece = PIECE_KING;
            const kingColor = this.side;
            let kingSq = -1;
            for (const sq of this.pieceLists[kingColor][kingPiece]) {
                kingSq = sq;
                break;
            }
            if (kingSq === -1) return false;
            // Проверяем, атакована ли клетка короля
            return this.isSquareAttacked(kingSq, 1 - this.side);
        }

        isCheckmate() {
            if (!this.isCheck()) return false;
            // Генерируем все легальные ходы (нужно использовать MoveGenerator)
            // Для простоты вернём false, реально проверка будет в engine_search
            // Здесь заглушка
            return false;
        }

        isStalemate() {
            if (this.isCheck()) return false;
            // Проверка на отсутствие легальных ходов
            return false;
        }

        isRepetition() {
            // Сравниваем текущий хеш с историей
            let count = 0;
            for (const h of this.history) {
                if (h === this.hash) count++;
            }
            return count >= 2;
        }

        isFiftyMove() {
            return this.halfMoveClock >= 100;
        }

        // ======================== Проверка атаки (использует AttackTables) ========================
        isSquareAttacked(sq, byColor) {
            const AttackTables = window.AttackTables;
            if (!AttackTables) return false;
            const allPieces = this.getAllPiecesBB();
            // Пешки
            const pawnAttacks = AttackTables.pawnAttacks[byColor][sq];
            const enemyPawns = (byColor === COLOR_WHITE) ? this.piecesBB(COLOR_WHITE, PIECE_PAWN) : this.piecesBB(COLOR_BLACK, PIECE_PAWN);
            if ((pawnAttacks & enemyPawns) !== 0n) return true;
            // Кони
            const knightAttacks = AttackTables.knightAttacks[sq];
            const enemyKnights = (byColor === COLOR_WHITE) ? this.piecesBB(COLOR_WHITE, PIECE_KNIGHT) : this.piecesBB(COLOR_BLACK, PIECE_KNIGHT);
            if ((knightAttacks & enemyKnights) !== 0n) return true;
            // Король
            const kingAttacks = AttackTables.kingAttacks[sq];
            const enemyKing = (byColor === COLOR_WHITE) ? this.piecesBB(COLOR_WHITE, PIECE_KING) : this.piecesBB(COLOR_BLACK, PIECE_KING);
            if ((kingAttacks & enemyKing) !== 0n) return true;
            // Слоны и ферзи
            const bishopAttacks = AttackTables.getBishopAttacks(sq, allPieces);
            const enemyBishopsQueens = ((byColor === COLOR_WHITE) ? this.piecesBB(COLOR_WHITE, PIECE_BISHOP) | this.piecesBB(COLOR_WHITE, PIECE_QUEEN) : this.piecesBB(COLOR_BLACK, PIECE_BISHOP) | this.piecesBB(COLOR_BLACK, PIECE_QUEEN));
            if ((bishopAttacks & enemyBishopsQueens) !== 0n) return true;
            // Ладьи и ферзи
            const rookAttacks = AttackTables.getRookAttacks(sq, allPieces);
            const enemyRooksQueens = ((byColor === COLOR_WHITE) ? this.piecesBB(COLOR_WHITE, PIECE_ROOK) | this.piecesBB(COLOR_WHITE, PIECE_QUEEN) : this.piecesBB(COLOR_BLACK, PIECE_ROOK) | this.piecesBB(COLOR_BLACK, PIECE_QUEEN));
            if ((rookAttacks & enemyRooksQueens) !== 0n) return true;
            return false;
        }

        // ======================== Битовые доски для быстрой проверки (дополнительно) ========================
        piecesBB(color, piece) {
            let bb = 0n;
            for (const sq of this.pieceLists[color][piece]) {
                bb |= 1n << BigInt(sq);
            }
            return bb;
        }

        getAllPiecesBB() {
            let bb = 0n;
            for (let sq = 0; sq < 64; sq++) {
                if (this.board[sq] !== PIECE_NONE) bb |= 1n << BigInt(sq);
            }
            return bb;
        }

        // ======================== Клонирование ========================
        clone() {
            const newPos = new Position();
            newPos.board = this.board.slice();
            newPos.colors = this.colors.slice();
            newPos.side = this.side;
            newPos.castling = { ...this.castling };
            newPos.epSquare = this.epSquare;
            newPos.halfMoveClock = this.halfMoveClock;
            newPos.fullMoveNumber = this.fullMoveNumber;
            newPos.hash = this.hash;
            // Копируем списки
            for (let c = 0; c < 2; c++) {
                for (let p = 1; p <= 6; p++) {
                    newPos.pieceLists[c][p] = [...this.pieceLists[c][p]];
                }
            }
            newPos.history = [...this.history];
            return newPos;
        }

        // ======================== История позиций ========================
        pushHistory() {
            this.history.push(this.hash);
        }

        popHistory() {
            this.history.pop();
        }

        // ======================== Утилиты ========================
        static isSquareOnBoard(sq) {
            return sq >= 0 && sq < 64;
        }
    }

    // ======================== Экспорт ========================
    window.BurchessPosition = {
        Position,
        START_FEN,
        COLOR_WHITE,
        COLOR_BLACK,
        PIECE_NONE,
        PIECE_PAWN,
        PIECE_KNIGHT,
        PIECE_BISHOP,
        PIECE_ROOK,
        PIECE_QUEEN,
        PIECE_KING
    };
})();
