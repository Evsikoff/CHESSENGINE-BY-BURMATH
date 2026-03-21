(function(){
    'use strict';

    // ======================== Игровое состояние ========================
    const Game = {
        // Доска: 8x8, хранит символы фигур (KQRBNP в верхнем регистре - белые, нижний - чёрные)
        board: Array(8).fill().map(() => Array(8).fill('')),
        // Текущий игрок: 'w' или 'b'
        turn: 'w',
        // Флаги для рокировки
        whiteCanCastleKingside: true,
        whiteCanCastleQueenside: true,
        blackCanCastleKingside: true,
        blackCanCastleQueenside: true,
        // Поле en passant (клетка, на которую можно взять на проходе)
        enPassantTarget: null, // { file, rank } или null
        // Полуходы (для правила 50 ходов)
        halfMoveClock: 0,
        // Номер полного хода (начинается с 1)
        fullMoveNumber: 1,
        // История позиций для троекратного повторения
        positionHistory: new Map(),
        // Флаг окончания игры
        gameOver: false,
        gameResult: null, // '1-0', '0-1', '1/2-1/2'
        // Колбэки для обновления UI
        callbacks: {},
        // Состояние ожидания хода движка
        waitingForEngine: false,
        // Настройки из UI
        settings: null,
        // Режим: игрок за белых/чёрных
        playerColor: 'white',
        // Инициализация завершена?
        initialized: false
    };

    // ======================== Константы и вспомогательные функции ========================
    const FILES = ['a','b','c','d','e','f','g','h'];
    const RANKS = ['8','7','6','5','4','3','2','1'];
    const FILE_MAP = { a:0, b:1, c:2, d:3, e:4, f:5, g:6, h:7 };
    const RANK_MAP = { '8':0, '7':1, '6':2, '5':3, '4':4, '3':5, '2':6, '1':7 };

    function fileToIndex(f) { return FILE_MAP[f]; }
    function rankToIndex(r) { return RANK_MAP[r]; }
    function indexToFile(i) { return FILES[i]; }
    function indexToRank(i) { return RANKS[i]; }

    // Получить символ фигуры в клетке
    function getPieceAt(file, rank) {
        if (file<0 || file>7 || rank<0 || rank>7) return null;
        return Game.board[rank][file];
    }

    function setPieceAt(file, rank, piece) {
        Game.board[rank][file] = piece;
    }

    // Проверка цвета фигуры
    function isWhitePiece(piece) { return piece && piece === piece.toUpperCase() && piece !== ''; }
    function isBlackPiece(piece) { return piece && piece !== piece.toUpperCase() && piece !== ''; }
    function pieceColor(piece) {
        if (!piece) return null;
        return (piece === piece.toUpperCase() && piece !== '') ? 'w' : 'b';
    }

    // ======================== Инициализация и загрузка позиции ========================
    function initBoardFromFEN(fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
        const parts = fen.split(' ');
        const positionPart = parts[0];
        const rows = positionPart.split('/');
        for (let i = 0; i < 8; i++) {
            let file = 0;
            for (let j = 0; j < rows[i].length; j++) {
                const ch = rows[i][j];
                if (ch >= '1' && ch <= '8') {
                    const empty = parseInt(ch);
                    for (let k = 0; k < empty; k++) {
                        Game.board[i][file++] = '';
                    }
                } else {
                    Game.board[i][file++] = ch;
                }
            }
        }
        // Определяем чей ход
        Game.turn = (parts[1] === 'w') ? 'w' : 'b';
        // Флаги рокировки
        const castling = parts[2];
        Game.whiteCanCastleKingside = castling.includes('K');
        Game.whiteCanCastleQueenside = castling.includes('Q');
        Game.blackCanCastleKingside = castling.includes('k');
        Game.blackCanCastleQueenside = castling.includes('q');
        // en passant
        if (parts[3] !== '-') {
            const epFile = parts[3][0];
            const epRank = parts[3][1];
            Game.enPassantTarget = { file: fileToIndex(epFile), rank: rankToIndex(epRank) };
        } else {
            Game.enPassantTarget = null;
        }
        Game.halfMoveClock = parts[4] ? parseInt(parts[4]) : 0;
        Game.fullMoveNumber = parts[5] ? parseInt(parts[5]) : 1;
        updatePositionHistory();
    }

    function getCurrentFEN() {
        let fen = '';
        for (let r = 0; r < 8; r++) {
            let empty = 0;
            for (let f = 0; f < 8; f++) {
                const piece = Game.board[r][f];
                if (piece === '') {
                    empty++;
                } else {
                    if (empty > 0) {
                        fen += empty;
                        empty = 0;
                    }
                    fen += piece;
                }
            }
            if (empty > 0) fen += empty;
            if (r < 7) fen += '/';
        }
        fen += ' ' + (Game.turn === 'w' ? 'w' : 'b');
        let castling = '';
        if (Game.whiteCanCastleKingside) castling += 'K';
        if (Game.whiteCanCastleQueenside) castling += 'Q';
        if (Game.blackCanCastleKingside) castling += 'k';
        if (Game.blackCanCastleQueenside) castling += 'q';
        fen += ' ' + (castling ? castling : '-');
        fen += ' ' + (Game.enPassantTarget ? (indexToFile(Game.enPassantTarget.file) + indexToRank(Game.enPassantTarget.rank)) : '-');
        fen += ' ' + Game.halfMoveClock;
        fen += ' ' + Game.fullMoveNumber;
        return fen;
    }

    function updatePositionHistory() {
        const fen = getCurrentFEN();
        const count = Game.positionHistory.get(fen) || 0;
        Game.positionHistory.set(fen, count + 1);
    }

    function isThreefoldRepetition() {
        const currentFEN = getCurrentFEN();
        const count = Game.positionHistory.get(currentFEN);
        return count >= 3;
    }

    // ======================== Генерация ходов (для проверки легальности) ========================
    function getAllMovesForColor(color) {
        const moves = [];
        for (let rank = 0; rank < 8; rank++) {
            for (let file = 0; file < 8; file++) {
                const piece = Game.board[rank][file];
                if (piece && ((color === 'w' && isWhitePiece(piece)) || (color === 'b' && isBlackPiece(piece)))) {
                    const pieceMoves = generateMovesFromSquare(file, rank);
                    moves.push(...pieceMoves);
                }
            }
        }
        return moves;
    }

    function generateMovesFromSquare(file, rank) {
        const piece = Game.board[rank][file];
        if (!piece) return [];
        const color = pieceColor(piece);
        const type = piece.toLowerCase();
        let moves = [];
        switch (type) {
            case 'p': moves = generatePawnMoves(file, rank, color); break;
            case 'n': moves = generateKnightMoves(file, rank, color); break;
            case 'b': moves = generateBishopMoves(file, rank, color); break;
            case 'r': moves = generateRookMoves(file, rank, color); break;
            case 'q': moves = generateQueenMoves(file, rank, color); break;
            case 'k': moves = generateKingMoves(file, rank, color); break;
        }
        // Фильтруем ходы, которые оставляют короля под шахом
        return moves.filter(move => !isMoveIllegalDueToCheck(file, rank, move.toFile, move.toRank, color));
    }

    function generatePawnMoves(file, rank, color) {
        const moves = [];
        const direction = (color === 'w') ? -1 : 1;
        const startRank = (color === 'w') ? 6 : 1;
        // Ход на одну клетку вперёд
        const newRank = rank + direction;
        if (newRank >= 0 && newRank < 8 && Game.board[newRank][file] === '') {
            moves.push({ fromFile: file, fromRank: rank, toFile: file, toRank: newRank, promotion: newRank === 0 || newRank === 7 });
            // Ход на две клетки из начальной позиции
            if (rank === startRank && Game.board[rank + 2*direction][file] === '') {
                moves.push({ fromFile: file, fromRank: rank, toFile: file, toRank: rank + 2*direction, promotion: false });
            }
        }
        // Взятие по диагонали
        for (const delta of [-1, 1]) {
            const newFile = file + delta;
            if (newFile >= 0 && newFile < 8) {
                const newRank2 = rank + direction;
                if (newRank2 >= 0 && newRank2 < 8) {
                    const targetPiece = Game.board[newRank2][newFile];
                    if (targetPiece && pieceColor(targetPiece) !== color) {
                        moves.push({ fromFile: file, fromRank: rank, toFile: newFile, toRank: newRank2, promotion: newRank2 === 0 || newRank2 === 7 });
                    }
                    // Взятие на проходе
                    if (Game.enPassantTarget && Game.enPassantTarget.file === newFile && Game.enPassantTarget.rank === newRank2) {
                        moves.push({ fromFile: file, fromRank: rank, toFile: newFile, toRank: newRank2, promotion: false, enPassant: true });
                    }
                }
            }
        }
        return moves;
    }

    function generateKnightMoves(file, rank, color) {
        const offsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        const moves = [];
        for (const [dx, dy] of offsets) {
            const newFile = file + dx;
            const newRank = rank + dy;
            if (newFile >= 0 && newFile < 8 && newRank >= 0 && newRank < 8) {
                const target = Game.board[newRank][newFile];
                if (!target || pieceColor(target) !== color) {
                    moves.push({ fromFile: file, fromRank: rank, toFile: newFile, toRank: newRank });
                }
            }
        }
        return moves;
    }

    function generateBishopMoves(file, rank, color) { return slidingMoves(file, rank, color, [[-1,-1],[-1,1],[1,-1],[1,1]]); }
    function generateRookMoves(file, rank, color) { return slidingMoves(file, rank, color, [[-1,0],[1,0],[0,-1],[0,1]]); }
    function generateQueenMoves(file, rank, color) { return slidingMoves(file, rank, color, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]); }

    function slidingMoves(file, rank, color, directions) {
        const moves = [];
        for (const [dx, dy] of directions) {
            let newFile = file + dx;
            let newRank = rank + dy;
            while (newFile >= 0 && newFile < 8 && newRank >= 0 && newRank < 8) {
                const target = Game.board[newRank][newFile];
                if (!target) {
                    moves.push({ fromFile: file, fromRank: rank, toFile: newFile, toRank: newRank });
                } else {
                    if (pieceColor(target) !== color) moves.push({ fromFile: file, fromRank: rank, toFile: newFile, toRank: newRank });
                    break;
                }
                newFile += dx;
                newRank += dy;
            }
        }
        return moves;
    }

    function generateKingMoves(file, rank, color) {
        const offsets = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        const moves = [];
        for (const [dx, dy] of offsets) {
            const newFile = file + dx;
            const newRank = rank + dy;
            if (newFile >= 0 && newFile < 8 && newRank >= 0 && newRank < 8) {
                const target = Game.board[newRank][newFile];
                if (!target || pieceColor(target) !== color) {
                    moves.push({ fromFile: file, fromRank: rank, toFile: newFile, toRank: newRank });
                }
            }
        }
        // Рокировка
        const backRank = (color === 'w') ? 7 : 0;
        if (color === 'w' && Game.whiteCanCastleKingside && Game.board[backRank][5] === '' && Game.board[backRank][6] === '' && !isSquareAttacked(4, backRank, 'b') && !isSquareAttacked(5, backRank, 'b') && !isSquareAttacked(6, backRank, 'b')) {
            moves.push({ fromFile: file, fromRank: rank, toFile: 6, toRank: backRank, castle: 'kingside' });
        }
        if (color === 'w' && Game.whiteCanCastleQueenside && Game.board[backRank][1] === '' && Game.board[backRank][2] === '' && Game.board[backRank][3] === '' && !isSquareAttacked(4, backRank, 'b') && !isSquareAttacked(3, backRank, 'b') && !isSquareAttacked(2, backRank, 'b')) {
            moves.push({ fromFile: file, fromRank: rank, toFile: 2, toRank: backRank, castle: 'queenside' });
        }
        if (color === 'b' && Game.blackCanCastleKingside && Game.board[backRank][5] === '' && Game.board[backRank][6] === '' && !isSquareAttacked(4, backRank, 'w') && !isSquareAttacked(5, backRank, 'w') && !isSquareAttacked(6, backRank, 'w')) {
            moves.push({ fromFile: file, fromRank: rank, toFile: 6, toRank: backRank, castle: 'kingside' });
        }
        if (color === 'b' && Game.blackCanCastleQueenside && Game.board[backRank][1] === '' && Game.board[backRank][2] === '' && Game.board[backRank][3] === '' && !isSquareAttacked(4, backRank, 'w') && !isSquareAttacked(3, backRank, 'w') && !isSquareAttacked(2, backRank, 'w')) {
            moves.push({ fromFile: file, fromRank: rank, toFile: 2, toRank: backRank, castle: 'queenside' });
        }
        return moves;
    }

    function isSquareAttacked(file, rank, byColor) {
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const piece = Game.board[r][f];
                if (piece && pieceColor(piece) === byColor) {
                    const type = piece.toLowerCase();
                    let attacks = false;
                    if (type === 'p') {
                        const dir = (byColor === 'w') ? -1 : 1;
                        const targets = [[f-1, r+dir], [f+1, r+dir]];
                        for (const [tf, tr] of targets) {
                            if (tf === file && tr === rank) attacks = true;
                        }
                    } else if (type === 'n') {
                        const offsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
                        for (const [dx, dy] of offsets) {
                            if (f+dx === file && r+dy === rank) attacks = true;
                        }
                    } else if (type === 'k') {
                        const offsets = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
                        for (const [dx, dy] of offsets) {
                            if (f+dx === file && r+dy === rank) attacks = true;
                        }
                    } else if (type === 'b' || type === 'q') {
                        const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
                        for (const [dx, dy] of dirs) {
                            let tf = f+dx, tr = r+dy;
                            while (tf>=0 && tf<8 && tr>=0 && tr<8) {
                                if (tf === file && tr === rank) attacks = true;
                                if (Game.board[tr][tf] !== '') break;
                                tf += dx; tr += dy;
                            }
                        }
                    }
                    if (type === 'r' || type === 'q') {
                        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
                        for (const [dx, dy] of dirs) {
                            let tf = f+dx, tr = r+dy;
                            while (tf>=0 && tf<8 && tr>=0 && tr<8) {
                                if (tf === file && tr === rank) attacks = true;
                                if (Game.board[tr][tf] !== '') break;
                                tf += dx; tr += dy;
                            }
                        }
                    }
                    if (attacks) return true;
                }
            }
        }
        return false;
    }

    function isMoveIllegalDueToCheck(fromFile, fromRank, toFile, toRank, color) {
        const boardCopy = copyBoard();
        const epTargetCopy = Game.enPassantTarget;
        const halfMoveCopy = Game.halfMoveClock;
        const fullMoveCopy = Game.fullMoveNumber;
        const whiteKingsideCopy = Game.whiteCanCastleKingside;
        const whiteQueensideCopy = Game.whiteCanCastleQueenside;
        const blackKingsideCopy = Game.blackCanCastleKingside;
        const blackQueensideCopy = Game.blackCanCastleQueenside;
        makeMoveInternal(fromFile, fromRank, toFile, toRank, false);
        const kingPos = findKing(color);
        const inCheck = isSquareAttacked(kingPos.file, kingPos.rank, color === 'w' ? 'b' : 'w');
        restoreBoard(boardCopy, epTargetCopy, halfMoveCopy, fullMoveCopy, whiteKingsideCopy, whiteQueensideCopy, blackKingsideCopy, blackQueensideCopy);
        return inCheck;
    }

    function makeMoveInternal(fromFile, fromRank, toFile, toRank, updateHistory = true) {
        const piece = Game.board[fromRank][fromFile];
        if (!piece) return false;
        const color = pieceColor(piece);
        const isCapture = Game.board[toRank][toFile] !== '';
        let enPassantCapture = false;
        let capturedPiece = Game.board[toRank][toFile];
        // Обработка превращения
        let promotionPiece = null;
        const isPawn = piece.toLowerCase() === 'p';
        const isPromotionMove = isPawn && (toRank === 0 || toRank === 7);
        // Запоминаем старые флаги рокировки для возможного обновления
        const oldWhiteKingside = Game.whiteCanCastleKingside;
        const oldWhiteQueenside = Game.whiteCanCastleQueenside;
        const oldBlackKingside = Game.blackCanCastleKingside;
        const oldBlackQueenside = Game.blackCanCastleQueenside;
        // Обновляем флаги рокировки если двигается король или ладья
        if (piece === 'K') {
            Game.whiteCanCastleKingside = false;
            Game.whiteCanCastleQueenside = false;
        } else if (piece === 'k') {
            Game.blackCanCastleKingside = false;
            Game.blackCanCastleQueenside = false;
        }
        if (piece === 'R' && fromFile === 0 && fromRank === 7) Game.whiteCanCastleQueenside = false;
        if (piece === 'R' && fromFile === 7 && fromRank === 7) Game.whiteCanCastleKingside = false;
        if (piece === 'r' && fromFile === 0 && fromRank === 0) Game.blackCanCastleQueenside = false;
        if (piece === 'r' && fromFile === 7 && fromRank === 0) Game.blackCanCastleKingside = false;
        // Перемещаем фигуру
        Game.board[toRank][toFile] = piece;
        Game.board[fromRank][fromFile] = '';
        // Рокировка: перемещаем ладью
        let isCastling = false;
        if ((piece === 'K' && Math.abs(toFile - fromFile) === 2) || (piece === 'k' && Math.abs(toFile - fromFile) === 2)) {
            isCastling = true;
            const backRank = (color === 'w') ? 7 : 0;
            if (toFile === 6) {
                const rookFile = 7;
                Game.board[backRank][5] = Game.board[backRank][rookFile];
                Game.board[backRank][rookFile] = '';
            } else if (toFile === 2) {
                const rookFile = 0;
                Game.board[backRank][3] = Game.board[backRank][rookFile];
                Game.board[backRank][rookFile] = '';
            }
        }
        // Взятие на проходе
        if (Game.enPassantTarget && Game.enPassantTarget.file === toFile && Game.enPassantTarget.rank === toRank && isPawn && Math.abs(toFile - fromFile) === 1) {
            const epRank = (color === 'w') ? toRank + 1 : toRank - 1;
            capturedPiece = Game.board[epRank][toFile];
            Game.board[epRank][toFile] = '';
            enPassantCapture = true;
            isCapture = true;
        }
        // Обновление en passant target
        let newEnPassant = null;
        if (isPawn && Math.abs(toRank - fromRank) === 2) {
            const epRank = (color === 'w') ? fromRank - 1 : fromRank + 1;
            newEnPassant = { file: fromFile, rank: epRank };
        }
        Game.enPassantTarget = newEnPassant;
        // Обновление полуходов и полных ходов
        if (isCapture || isPawn) {
            Game.halfMoveClock = 0;
        } else {
            Game.halfMoveClock++;
        }
        if (color === 'b') Game.fullMoveNumber++;
        // Смена хода
        Game.turn = (Game.turn === 'w') ? 'b' : 'w';
        // Сохраняем историю позиций для трёхкратного повторения
        if (updateHistory) updatePositionHistory();
        return true;
    }

    function copyBoard() {
        const boardCopy = Array(8).fill().map(() => Array(8).fill(''));
        for (let i=0;i<8;i++) for (let j=0;j<8;j++) boardCopy[i][j] = Game.board[i][j];
        return boardCopy;
    }

    function restoreBoard(board, epTarget, halfMove, fullMove, wk, wq, bk, bq) {
        Game.board = board;
        Game.enPassantTarget = epTarget;
        Game.halfMoveClock = halfMove;
        Game.fullMoveNumber = fullMove;
        Game.whiteCanCastleKingside = wk;
        Game.whiteCanCastleQueenside = wq;
        Game.blackCanCastleKingside = bk;
        Game.blackCanCastleQueenside = bq;
    }

    function findKing(color) {
        const target = (color === 'w') ? 'K' : 'k';
        for (let r=0;r<8;r++) for (let f=0;f<8;f++) if (Game.board[r][f] === target) return { file: f, rank: r };
        return null;
    }

    function isCheckmate() {
        const moves = getAllMovesForColor(Game.turn);
        if (moves.length > 0) return false;
        const kingPos = findKing(Game.turn);
        return isSquareAttacked(kingPos.file, kingPos.rank, Game.turn === 'w' ? 'b' : 'w');
    }

    function isStalemate() {
        const moves = getAllMovesForColor(Game.turn);
        if (moves.length > 0) return false;
        const kingPos = findKing(Game.turn);
        return !isSquareAttacked(kingPos.file, kingPos.rank, Game.turn === 'w' ? 'b' : 'w');
    }

    function isFiftyMoveRule() {
        return Game.halfMoveClock >= 100;
    }

    function isInsufficientMaterial() {
        let whitePieces = [], blackPieces = [];
        for (let r=0;r<8;r++) for (let f=0;f<8;f++) {
            const p = Game.board[r][f];
            if (p === 'K') whitePieces.push(p);
            else if (p === 'k') blackPieces.push(p);
            else if (p === 'N') whitePieces.push(p);
            else if (p === 'n') blackPieces.push(p);
            else if (p === 'B') whitePieces.push(p);
            else if (p === 'b') blackPieces.push(p);
            else if (p !== '') return false;
        }
        if (whitePieces.length === 1 && blackPieces.length === 1) return true;
        if (whitePieces.length === 1 && blackPieces.length === 2 && (blackPieces[0] === 'n' || blackPieces[0] === 'b')) return true;
        if (blackPieces.length === 1 && whitePieces.length === 2 && (whitePieces[0] === 'N' || whitePieces[0] === 'B')) return true;
        return false;
    }

    function checkGameOver() {
        if (Game.gameOver) return true;
        if (isCheckmate()) {
            Game.gameOver = true;
            Game.gameResult = Game.turn === 'w' ? '0-1' : '1-0';
            const winner = Game.turn === 'w' ? 'Чёрные' : 'Белые';
            if (Game.callbacks.onGameOver) Game.callbacks.onGameOver(Game.gameResult, winner);
            return true;
        }
        if (isStalemate()) {
            Game.gameOver = true;
            Game.gameResult = '1/2-1/2';
            if (Game.callbacks.onGameOver) Game.callbacks.onGameOver(Game.gameResult, 'Пат');
            return true;
        }
        if (isFiftyMoveRule()) {
            Game.gameOver = true;
            Game.gameResult = '1/2-1/2';
            if (Game.callbacks.onGameOver) Game.callbacks.onGameOver(Game.gameResult, 'Правило 50 ходов');
            return true;
        }
        if (isThreefoldRepetition()) {
            Game.gameOver = true;
            Game.gameResult = '1/2-1/2';
            if (Game.callbacks.onGameOver) Game.callbacks.onGameOver(Game.gameResult, 'Троекратное повторение');
            return true;
        }
        if (isInsufficientMaterial()) {
            Game.gameOver = true;
            Game.gameResult = '1/2-1/2';
            if (Game.callbacks.onGameOver) Game.callbacks.onGameOver(Game.gameResult, 'Недостаточно фигур');
            return true;
        }
        return false;
    }

    // ======================== Основной игровой процесс ========================
    function makeMove(from, to, promotionPiece = 'q') {
        if (Game.gameOver || Game.waitingForEngine) return false;
        const piece = getPieceAt(from.file, from.rank);
        if (!piece) return false;
        const pieceColor = (piece === piece.toUpperCase() && piece !== '') ? 'w' : 'b';
        if (pieceColor !== Game.turn) return false;
        // Проверяем, является ли ход допустимым
        const moves = generateMovesFromSquare(from.file, from.rank);
        const validMove = moves.find(m => m.toFile === to.file && m.toRank === to.rank);
        if (!validMove) return false;
        // Сохраняем состояние для отката
        const oldState = {
            board: copyBoard(),
            turn: Game.turn,
            whiteCanCastleKingside: Game.whiteCanCastleKingside,
            whiteCanCastleQueenside: Game.whiteCanCastleQueenside,
            blackCanCastleKingside: Game.blackCanCastleKingside,
            blackCanCastleQueenside: Game.blackCanCastleQueenside,
            enPassantTarget: Game.enPassantTarget,
            halfMoveClock: Game.halfMoveClock,
            fullMoveNumber: Game.fullMoveNumber,
            positionHistory: new Map(Game.positionHistory)
        };
        // Выполняем ход
        const isPromotion = validMove.promotion && piece.toLowerCase() === 'p';
        let pieceBefore = piece;
        if (isPromotion) {
            const promoChar = (Game.turn === 'w') ? promotionPiece.toUpperCase() : promotionPiece.toLowerCase();
            Game.board[from.rank][from.file] = promoChar;
            pieceBefore = Game.board[from.rank][from.file];
        }
        const success = makeMoveInternal(from.file, from.rank, to.file, to.rank, true);
        if (!success) return false;
        // Записываем ход в историю
        const san = moveToSAN(from, to, piece, validMove);
        const uci = indexToFile(from.file) + indexToRank(from.rank) + indexToFile(to.file) + indexToRank(to.rank) + (isPromotion ? promotionPiece : '');
        if (window.MoveHistory) {
            window.MoveHistory.addMove(san, uci, from, to, piece, isPromotion ? promotionPiece : null, getCurrentFEN());
        }
        // Обновляем доску и UI
        if (window.Board) {
            window.Board.setPosition(boardToPositionObject());
            window.Board.setLastMove(from, to);
            window.Board.clearHighlights();
            const kingPos = findKing(Game.turn === 'w' ? 'b' : 'w');
            if (kingPos && isSquareAttacked(kingPos.file, kingPos.rank, Game.turn)) {
                window.Board.setCheckSquare(kingPos);
            } else {
                window.Board.setCheckSquare(null);
            }
        }
        if (window.UI) {
            window.UI.updateTurnDisplay(Game.turn === 'w' ? 'white' : 'black');
            window.UI.refreshBoard();
        }
        if (window.Sound) {
            if (validMove.castle) window.Sound.play('castle');
            else if (validMove.enPassant || (Game.board[to.rank][to.file] === '' && pieceBefore && pieceBefore.toLowerCase() === 'p' && Math.abs(to.file - from.file) === 1)) window.Sound.play('capture');
            else if (isPromotion) window.Sound.play('promotion');
            else if (Game.board[to.rank][to.file] !== '') window.Sound.play('capture');
            else window.Sound.play('move');
        }
        if (window.Animations) {
            window.Animations.animateMove(from.file, from.rank, to.file, to.rank, piece, () => {
                if (isPromotion) window.Animations.animatePromotion(to.file, to.rank, promotionPiece);
            });
        }
        // Проверка окончания игры
        const gameEnded = checkGameOver();
        if (!gameEnded && Game.turn !== (Game.playerColor === 'white' ? 'w' : 'b')) {
            // Ход движка
            Game.waitingForEngine = true;
            if (window.Bridge && window.Bridge.getEngineReady()) {
                const fen = getCurrentFEN();
                window.Bridge.setPosition(fen);
                const depth = Game.settings?.skillLevel || 15;
                const movetime = Game.settings?.moveTime || 1000;
                window.Bridge.startSearch({ depth: depth, movetime: movetime });
                window.Bridge.setCallbacks({
                    onBestMove: (bestMoveUCI) => {
                        Game.waitingForEngine = false;
                        if (Game.gameOver) return;
                        const fromFile = fileToIndex(bestMoveUCI[0]);
                        const fromRank = rankToIndex(bestMoveUCI[1]);
                        const toFile = fileToIndex(bestMoveUCI[2]);
                        const toRank = rankToIndex(bestMoveUCI[3]);
                        let promotion = null;
                        if (bestMoveUCI.length === 5) promotion = bestMoveUCI[4];
                        const from = { file: fromFile, rank: fromRank };
                        const to = { file: toFile, rank: toRank };
                        // Проверяем легальность (на всякий случай)
                        const enginePiece = getPieceAt(from.file, from.rank);
                        if (enginePiece && pieceColor(enginePiece) === Game.turn) {
                            makeMove(from, to, promotion);
                        }
                    },
                    onInfo: (info) => {
                        if (window.UI) {
                            window.UI.updateEngineInfo(info.depth, info.nodes, info.nps, info.pv.join(' '), info.pv[0], info.mate ? (info.mate * 10000) : info.score);
                        }
                    }
                });
            } else {
                Game.waitingForEngine = false;
            }
        }
        return true;
    }

    function moveToSAN(from, to, piece, move) {
        const fromSquare = indexToFile(from.file) + indexToRank(from.rank);
        const toSquare = indexToFile(to.file) + indexToRank(to.rank);
        let san = '';
        if (move.castle) {
            if (to.file === 6) san = 'O-O';
            else san = 'O-O-O';
            return san;
        }
        if (piece.toLowerCase() !== 'p') {
            san = piece.toUpperCase();
            // Уточняем файл или ранг при необходимости
            san += fromSquare;
        }
        if (Game.board[to.rank][to.file] !== '' || move.enPassant) san += 'x';
        san += toSquare;
        if (move.promotion) san += '=' + (move.promotionPiece ? move.promotionPiece.toUpperCase() : 'Q');
        return san;
    }

    function boardToPositionObject() {
        const pos = {};
        for (let r=0;r<8;r++) {
            for (let f=0;f<8;f++) {
                const piece = Game.board[r][f];
                if (piece) {
                    const square = indexToFile(f) + indexToRank(r);
                    pos[square] = piece;
                }
            }
        }
        return pos;
    }

    function newGame() {
        initBoardFromFEN();
        Game.gameOver = false;
        Game.gameResult = null;
        Game.waitingForEngine = false;
        Game.positionHistory.clear();
        updatePositionHistory();
        if (window.MoveHistory) window.MoveHistory.init(getCurrentFEN());
        if (window.Board) {
            window.Board.setPosition(boardToPositionObject());
            window.Board.setBoardFlipped(Game.playerColor === 'black');
            window.Board.clearHighlights();
            window.Board.setLastMove(null, null);
        }
        if (window.UI) {
            window.UI.updateTurnDisplay(Game.turn === 'w' ? 'white' : 'black');
            window.UI.setGameOver(false);
            window.UI.startTimers();
        }
        if (window.Sound) window.Sound.play('gameStart');
        // Если игрок играет чёрными и первый ход за белыми (движок), запускаем движок
        if (Game.playerColor === 'black' && Game.turn === 'w') {
            Game.waitingForEngine = true;
            setTimeout(() => {
                if (window.Bridge && window.Bridge.getEngineReady() && Game.turn === 'w' && !Game.gameOver) {
                    const fen = getCurrentFEN();
                    window.Bridge.setPosition(fen);
                    const depth = Game.settings?.skillLevel || 15;
                    const movetime = Game.settings?.moveTime || 1000;
                    window.Bridge.startSearch({ depth, movetime });
                }
            }, 100);
        }
    }

    function setPositionFromFEN(fen) {
        initBoardFromFEN(fen);
        if (window.Board) {
            window.Board.setPosition(boardToPositionObject());
            window.Board.refresh();
        }
        if (window.UI) window.UI.updateTurnDisplay(Game.turn === 'w' ? 'white' : 'black');
    }

    function setPositionFromHistory(fen) {
        setPositionFromFEN(fen);
    }

    function undoMove() {
        if (Game.gameOver) return false;
        // Временно не реализован полный откат, но можно вызвать MoveHistory.undo()
        if (window.MoveHistory && window.MoveHistory.undo()) {
            const fen = window.MoveHistory.getCurrentFEN();
            setPositionFromFEN(fen);
            return true;
        }
        return false;
    }

    function hint() {
        // Запрашиваем у движка лучший ход для текущей позиции
        if (Game.waitingForEngine || Game.gameOver) return;
        if (window.Bridge && window.Bridge.getEngineReady()) {
            const fen = getCurrentFEN();
            window.Bridge.setPosition(fen);
            window.Bridge.startSearch({ depth: 10, movetime: 500 });
            window.Bridge.setCallbacks({
                onBestMove: (bestMoveUCI) => {
                    if (bestMoveUCI) {
                        const fromFile = fileToIndex(bestMoveUCI[0]);
                        const fromRank = rankToIndex(bestMoveUCI[1]);
                        const toFile = fileToIndex(bestMoveUCI[2]);
                        const toRank = rankToIndex(bestMoveUCI[3]);
                        if (window.Board) {
                            window.Board.setSelectedSquare({ file: fromFile, rank: fromRank });
                            const moves = generateMovesFromSquare(fromFile, fromRank);
                            const validMoves = moves.filter(m => m.toFile === toFile && m.toRank === toRank);
                            if (validMoves.length) window.Board.setValidMoves([{ from: {file:fromFile,rank:fromRank}, to: {file:toFile,rank:toRank} }]);
                            setTimeout(() => window.Board.clearHighlights(), 2000);
                        }
                    }
                }
            });
        }
    }

    // ======================== Инициализация ========================
    function init() {
        if (Game.initialized) return;
        Game.settings = window.Settings ? window.Settings.load() : { skillLevel:15, moveTime:1000, playerColor:'white' };
        Game.playerColor = Game.settings.playerColor || 'white';
        initBoardFromFEN();
        if (window.Board) {
            window.Board.setPosition(boardToPositionObject());
            window.Board.setBoardFlipped(Game.playerColor === 'black');
            window.Board.setCallbacks({
                onSquareClick: (square) => {
                    if (Game.gameOver || Game.waitingForEngine) return;
                    // Логика выбора клетки
                    if (Game.selectedSquare && Game.selectedSquare.file === square.file && Game.selectedSquare.rank === square.rank) {
                        window.Board.setSelectedSquare(null);
                        window.Board.setValidMoves([]);
                        Game.selectedSquare = null;
                    } else if (Game.selectedSquare) {
                        makeMove(Game.selectedSquare, square);
                        window.Board.setSelectedSquare(null);
                        window.Board.setValidMoves([]);
                        Game.selectedSquare = null;
                    } else {
                        const piece = getPieceAt(square.file, square.rank);
                        if (piece && pieceColor(piece) === Game.turn) {
                            Game.selectedSquare = square;
                            const moves = generateMovesFromSquare(square.file, square.rank);
                            window.Board.setSelectedSquare(square);
                            window.Board.setValidMoves(moves.map(m => ({ from: square, to: { file: m.toFile, rank: m.toRank } })));
                        }
                    }
                },
                onPieceDrag: (from, to) => makeMove(from, to)
            });
        }
        if (window.UI) {
            window.UI.setCallbacks({
                onNewGame: () => newGame(),
                onUndo: () => undoMove(),
                onHint: () => hint(),
                onFlipBoard: () => {
                    if (window.Board) window.Board.setBoardFlipped(!window.Board.boardFlipped);
                },
                onSettingsChange: (settings) => {
                    Game.settings = settings;
                    Game.playerColor = settings.playerColor;
                    if (window.Board) window.Board.setBoardFlipped(Game.playerColor === 'black');
                    // Можно перезапустить игру
                },
                onPromotion: (pieceType) => {
                    if (Game.pendingPromotion) {
                        makeMove(Game.pendingPromotion.from, Game.pendingPromotion.to, pieceType);
                        Game.pendingPromotion = null;
                    }
                }
            });
            window.UI.setGameOver(false);
        }
        if (window.Bridge) {
            window.Bridge.init();
            window.Bridge.setOption('SkillLevel', Game.settings.skillLevel);
            window.Bridge.setCallbacks({
                onReady: () => {
                    console.log('Engine ready');
                    if (Game.playerColor === 'black' && Game.turn === 'w' && !Game.gameOver) {
                        Game.waitingForEngine = true;
                        const fen = getCurrentFEN();
                        window.Bridge.setPosition(fen);
                        window.Bridge.startSearch({ depth: Game.settings.skillLevel, movetime: Game.settings.moveTime });
                    }
                }
            });
        }
        Game.initialized = true;
        newGame(); // старт
    }

    window.Game = {
        init,
        makeMove,
        newGame,
        setPositionFromHistory,
        getCurrentFEN,
        undo: undoMove,
        hint,
        isGameOver: () => Game.gameOver
    };
})();
