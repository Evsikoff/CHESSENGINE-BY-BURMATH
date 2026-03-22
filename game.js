(function(){
    'use strict';

    // ======================== Состояние игры ========================
    let chess = null;           // chess.js instance
    let board = null;           // chessboard.js instance
    let playerColor = 'white';  // цвет игрока
    let gameOver = false;
    let waitingForEngine = false;
    let initialized = false;
    let moveList = [];          // UCI-ходы для передачи движку
    let pendingPromotion = null;

    // ======================== Инициализация ========================
    function init() {
        if (initialized) return;

        // Загружаем настройки
        const settings = window.Settings ? window.Settings.load() : {};
        playerColor = settings.playerColor || 'white';

        // chess.js
        chess = new Chess();

        // chessboard.js
        const boardConfig = {
            position: 'start',
            draggable: true,
            orientation: playerColor,
            pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
            onDragStart: onDragStart,
            onDrop: onDrop,
            onSnapEnd: onSnapEnd,
            moveSpeed: 200,
            snapbackSpeed: 300,
            snapSpeed: 100,
            showNotation: true
        };
        board = Chessboard('chess-board', boardConfig);

        // Адаптивный размер
        $(window).on('resize', function() {
            board.resize();
        });

        // Инициализация UI
        if (window.UI) {
            window.UI.init();
            window.UI.setCallbacks({
                onNewGame: newGame,
                onUndo: undoMove,
                onHint: hint,
                onFlipBoard: flipBoard,
                onSettingsChange: onSettingsChange,
                onPromotion: onPromotionChoice
            });
            window.UI.updateTurnDisplay('white');
        }

        // Инициализация движка (Bridge.init() уже вызван из загрузочного экрана)
        if (window.Bridge) {
            window.Bridge.setCallbacks({
                onReady: onEngineReady,
                onBestMove: onEngineBestMove,
                onInfo: onEngineInfo
            });
            // Если движок уже готов к этому моменту
            if (window.Bridge.getEngineReady()) {
                onEngineReady();
            }
        }

        // Инициализация истории
        if (window.MoveHistory) {
            window.MoveHistory.init(chess.fen());
        }

        // Звук
        if (window.Sound) window.Sound.play('gameStart');

        // Запускаем таймеры
        if (window.UI) window.UI.startTimers();

        initialized = true;

        // Если игрок за чёрных — движок делает первый ход
        if (playerColor === 'black') {
            waitingForEngine = true;
        }
    }

    // ======================== Обработчики доски (chessboard.js) ========================

    function onDragStart(source, piece, position, orientation) {
        // Запрет перетаскивания в неподходящих ситуациях
        if (gameOver) return false;
        if (waitingForEngine) return false;

        // Только свои фигуры в свой ход
        if (chess.turn() === 'w' && piece.search(/^b/) !== -1) return false;
        if (chess.turn() === 'b' && piece.search(/^w/) !== -1) return false;

        // Только когда ход игрока
        var isPlayerTurn = (playerColor === 'white' && chess.turn() === 'w') ||
                           (playerColor === 'black' && chess.turn() === 'b');
        if (!isPlayerTurn) return false;

        return true;
    }

    function onDrop(source, target) {
        if (source === target) return 'snapback';

        // Проверяем, является ли это превращением пешки
        var piece = chess.get(source);
        if (piece && piece.type === 'p') {
            var targetRank = target[1];
            if ((piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1')) {
                // Проверяем, что ход легален хотя бы с каким-то превращением
                var testMove = chess.move({ from: source, to: target, promotion: 'q' });
                if (testMove === null) return 'snapback';
                chess.undo(); // откатываем пробный ход

                // Сохраняем и показываем модальное окно выбора фигуры
                pendingPromotion = { from: source, to: target };
                if (window.UI) window.UI.openPromotionModal();
                return; // не возвращаем snapback — позиция обновится после выбора
            }
        }

        // Обычный ход
        var move = chess.move({ from: source, to: target, promotion: 'q' });
        if (move === null) return 'snapback';

        afterPlayerMove(move);
    }

    function onSnapEnd() {
        board.position(chess.fen());
    }

    // ======================== Превращение пешки ========================

    function onPromotionChoice(pieceType) {
        if (!pendingPromotion) return;

        var move = chess.move({
            from: pendingPromotion.from,
            to: pendingPromotion.to,
            promotion: pieceType
        });
        pendingPromotion = null;

        if (move === null) {
            board.position(chess.fen());
            return;
        }

        afterPlayerMove(move);
        board.position(chess.fen());
    }

    // ======================== После хода игрока ========================

    function afterPlayerMove(move) {
        moveList.push(move.from + move.to + (move.promotion || ''));

        // Записываем в историю
        if (window.MoveHistory) {
            var from = { file: move.from.charCodeAt(0) - 97, rank: 8 - parseInt(move.from[1]) };
            var to = { file: move.to.charCodeAt(0) - 97, rank: 8 - parseInt(move.to[1]) };
            window.MoveHistory.addMove(move.san, move.from + move.to + (move.promotion || ''),
                from, to, move.piece, move.promotion, chess.fen());
        }

        // Звук
        playMoveSound(move);

        // Обновляем UI
        updateStatus();

        // Обновляем позицию доски
        board.position(chess.fen());

        // Проверяем окончание игры
        if (checkGameOver()) return;

        // Ход движка
        makeEngineMove();
    }

    // ======================== Движок ========================

    function onEngineReady() {
        console.log('Stockfish ready');
        if (window.UI) window.UI.setEngineStatus(true);

        // Если игрок за чёрных, движок ходит первым
        if (playerColor === 'black' && chess.turn() === 'w' && !gameOver) {
            makeEngineMove();
        }
    }

    function makeEngineMove() {
        if (gameOver) return;
        waitingForEngine = true;

        var fen = chess.fen();
        window.Bridge.setPosition(fen);

        // Передаём оставшееся время для оптимального тайм-менеджмента Stockfish
        var whiteTimeMs = getTimerMs('white');
        var blackTimeMs = getTimerMs('black');

        window.Bridge.startSearch({
            wtime: whiteTimeMs,
            btime: blackTimeMs
        });
    }

    function getTimerMs(color) {
        if (window.UI && window.UI.getWhiteTime && window.UI.getBlackTime) {
            var seconds = color === 'white' ? window.UI.getWhiteTime() : window.UI.getBlackTime();
            return seconds * 1000;
        }
        return 900000; // 15 min default
    }

    function onEngineBestMove(moveStr, ponder) {
        waitingForEngine = false;
        if (gameOver || !moveStr || moveStr === '(none)') return;

        var from = moveStr.substring(0, 2);
        var to = moveStr.substring(2, 4);
        var promotion = moveStr.length > 4 ? moveStr[4] : undefined;

        var move = chess.move({ from: from, to: to, promotion: promotion });
        if (!move) {
            console.error('Engine returned illegal move:', moveStr);
            return;
        }

        moveList.push(moveStr);

        // Обновляем доску с анимацией
        board.position(chess.fen());

        // Записываем в историю
        if (window.MoveHistory) {
            var fromSq = { file: from.charCodeAt(0) - 97, rank: 8 - parseInt(from[1]) };
            var toSq = { file: to.charCodeAt(0) - 97, rank: 8 - parseInt(to[1]) };
            window.MoveHistory.addMove(move.san, moveStr, fromSq, toSq, move.piece, move.promotion, chess.fen());
        }

        // Звук
        playMoveSound(move);

        // Обновляем UI
        updateStatus();

        // Проверяем окончание
        checkGameOver();
    }

    function onEngineInfo(info) {
        if (window.UI) {
            var evalValue = info.mate ? (info.mate * 10000) : info.score;
            window.UI.updateEngineInfo(
                info.depth,
                info.nodes,
                info.nps,
                info.pv ? info.pv.join(' ') : '',
                info.pv ? info.pv[0] : '',
                evalValue
            );
        }
    }

    // ======================== Статус и проверки ========================

    function updateStatus() {
        var turn = chess.turn() === 'w' ? 'white' : 'black';
        if (window.UI) window.UI.updateTurnDisplay(turn);
    }

    function checkGameOver() {
        if (gameOver) return true;

        if (chess.in_checkmate()) {
            gameOver = true;
            var winner = chess.turn() === 'w' ? 'Чёрные' : 'Белые';
            var result = chess.turn() === 'w' ? '0-1' : '1-0';
            if (window.MoveHistory) window.MoveHistory.setResult(result);
            if (window.UI) {
                window.UI.setGameOver(true);
                window.UI.showGameOverMessage('Мат! ' + winner + ' победили!');
            }
            if (window.Sound) window.Sound.play('gameEnd');
            return true;
        }

        if (chess.in_stalemate()) {
            gameOver = true;
            if (window.MoveHistory) window.MoveHistory.setResult('1/2-1/2');
            if (window.UI) {
                window.UI.setGameOver(true);
                window.UI.showGameOverMessage('Пат! Ничья.');
            }
            if (window.Sound) window.Sound.play('gameEnd');
            return true;
        }

        if (chess.in_threefold_repetition()) {
            gameOver = true;
            if (window.MoveHistory) window.MoveHistory.setResult('1/2-1/2');
            if (window.UI) {
                window.UI.setGameOver(true);
                window.UI.showGameOverMessage('Троекратное повторение! Ничья.');
            }
            if (window.Sound) window.Sound.play('gameEnd');
            return true;
        }

        if (chess.insufficient_material()) {
            gameOver = true;
            if (window.MoveHistory) window.MoveHistory.setResult('1/2-1/2');
            if (window.UI) {
                window.UI.setGameOver(true);
                window.UI.showGameOverMessage('Недостаточно фигур! Ничья.');
            }
            if (window.Sound) window.Sound.play('gameEnd');
            return true;
        }

        if (chess.in_draw()) {
            gameOver = true;
            if (window.MoveHistory) window.MoveHistory.setResult('1/2-1/2');
            if (window.UI) {
                window.UI.setGameOver(true);
                window.UI.showGameOverMessage('Ничья по правилу 50 ходов.');
            }
            if (window.Sound) window.Sound.play('gameEnd');
            return true;
        }

        return false;
    }

    // ======================== Звуки ========================

    function playMoveSound(move) {
        if (!window.Sound) return;
        if (move.flags.includes('k') || move.flags.includes('q')) {
            window.Sound.play('castle');
        } else if (move.flags.includes('c') || move.flags.includes('e')) {
            window.Sound.play('capture');
        } else if (move.flags.includes('p')) {
            window.Sound.play('promotion');
        } else {
            window.Sound.play('move');
        }
        // Шах
        if (chess.in_check()) {
            setTimeout(function() { window.Sound.play('check'); }, 100);
        }
    }

    // ======================== Действия пользователя ========================

    function newGame() {
        chess = new Chess();
        moveList = [];
        gameOver = false;
        waitingForEngine = false;
        pendingPromotion = null;

        board.orientation(playerColor);
        board.position('start');

        if (window.MoveHistory) window.MoveHistory.init(chess.fen());
        if (window.UI) {
            window.UI.updateTurnDisplay('white');
            window.UI.setGameOver(false);
            window.UI.startTimers();
        }
        if (window.Sound) window.Sound.play('gameStart');

        // Сбрасываем движок
        if (window.Bridge) {
            window.Bridge.sendCommand('ucinewgame');
            window.Bridge.sendCommand('isready');
        }

        // Если игрок за чёрных, движок ходит первым
        if (playerColor === 'black') {
            waitingForEngine = true;
            setTimeout(function() {
                if (window.Bridge && window.Bridge.getEngineReady()) {
                    makeEngineMove();
                }
            }, 300);
        }
    }

    function undoMove() {
        if (gameOver || waitingForEngine) return false;

        // Откатываем 2 хода (ход движка + ход игрока)
        var undone1 = chess.undo();
        var undone2 = chess.undo();
        if (!undone1 && !undone2) return false;

        // Восстанавливаем moveList
        if (undone1) moveList.pop();
        if (undone2) moveList.pop();

        board.position(chess.fen());
        updateStatus();

        if (window.MoveHistory) {
            window.MoveHistory.undo();
            if (undone2) window.MoveHistory.undo();
        }

        return true;
    }

    function hint() {
        if (waitingForEngine || gameOver) return;

        var fen = chess.fen();
        window.Bridge.setPosition(fen);
        window.Bridge.startSearch({ movetime: 1000 });

        var oldCallback = window.Bridge.callbacks ? window.Bridge.callbacks.onBestMove : null;
        window.Bridge.setCallbacks({
            onBestMove: function(moveStr) {
                // Подсветим ход на доске через greySquare
                if (moveStr && moveStr.length >= 4) {
                    var from = moveStr.substring(0, 2);
                    var to = moveStr.substring(2, 4);
                    highlightSquare(from);
                    highlightSquare(to);
                    setTimeout(function() { removeHighlights(); }, 2000);
                }
                // Восстанавливаем оригинальный колбэк
                window.Bridge.setCallbacks({ onBestMove: onEngineBestMove, onInfo: onEngineInfo });
            }
        });
    }

    function highlightSquare(square) {
        var el = $('#chess-board .square-' + square);
        el.css('background', 'radial-gradient(circle, rgba(46,204,113,0.6) 40%, transparent 70%)');
    }

    function removeHighlights() {
        $('#chess-board .square-55d63').css('background', '');
        // Перерисовываем доску чтобы убрать подсветку
        board.position(chess.fen());
    }

    function flipBoard() {
        board.flip();
    }

    function onSettingsChange(settings) {
        playerColor = settings.playerColor || 'white';
        if (window.Settings) {
            window.Settings.set('playerColor', playerColor);
            if (settings.soundEnabled !== undefined) window.Settings.set('soundEnabled', settings.soundEnabled);
            if (settings.showCoordinates !== undefined) window.Settings.set('showCoordinates', settings.showCoordinates);
            if (settings.gameTime !== undefined) window.Settings.set('gameTime', settings.gameTime);
        }
    }

    function setPositionFromHistory(fen) {
        chess.load(fen);
        board.position(fen);
        updateStatus();
    }

    function getCurrentFEN() {
        return chess.fen();
    }

    // ======================== Публичный API ========================

    window.Game = {
        init: init,
        makeMove: function(from, to, promotion) {
            var move = chess.move({ from: from, to: to, promotion: promotion || 'q' });
            if (move) {
                afterPlayerMove(move);
                board.position(chess.fen());
            }
            return !!move;
        },
        newGame: newGame,
        setPositionFromHistory: setPositionFromHistory,
        getCurrentFEN: getCurrentFEN,
        undo: undoMove,
        hint: hint,
        isGameOver: function() { return gameOver; }
    };
})();
