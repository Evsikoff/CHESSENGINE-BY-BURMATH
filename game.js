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
    let waitingForHint = false;
    let resettingEngine = false;
    let searchGeneration = 0;

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

        // Инициализация истории
        if (window.MoveHistory) {
            window.MoveHistory.init(chess.fen());
        }

        // Звук
        if (window.Sound) window.Sound.play('gameStart');

        // Запускаем таймеры
        if (window.UI) window.UI.startTimers();

        initialized = true;

        // Все части игры готовы до первого хода, в том числе при игре за чёрных.
        if (window.Bridge) {
            window.Bridge.setCallbacks({
                onReady: onEngineReady,
                onBestMove: onEngineBestMove,
                onInfo: onEngineInfo,
                onConnectionChange: onConnectionChange,
                onError: onEngineError
            });
            onConnectionChange(window.Bridge.getRemoteConnected(), window.Bridge.getConnectionState());
            if (window.Bridge.getEngineReady()) onEngineReady();
        }
    }

    // ======================== Обработчики доски (chessboard.js) ========================

    function onDragStart(source, piece, position, orientation) {
        // Запрет перетаскивания в неподходящих ситуациях
        if (gameOver) return false;
        if (waitingForEngine || waitingForHint) return false;

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
        if (gameOver || waitingForEngine || waitingForHint || isEngineTurn()) return 'snapback';
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
        if (window.UI) window.UI.setEngineStatus(true);

        if (initialized && !resettingEngine && !waitingForEngine && !waitingForHint &&
                isEngineTurn() && !gameOver) {
            makeEngineMove();
        }
    }

    function onConnectionChange(connected, state) {
        if (window.UI && window.UI.setConnectionStatus) {
            window.UI.setConnectionStatus(connected, state);
            window.UI.setEngineStatus(window.Bridge.getEngineReady());
        }
    }

    function onEngineError(error) {
        waitingForEngine = false;
        waitingForHint = false;
        if (window.UI) {
            window.UI.setEngineStatus(false);
            window.UI.showToast('Не удалось запустить движок. Попробуйте начать новую игру.', 5000);
        }
        console.error('Engine unavailable:', error);
    }

    function isEngineTurn() {
        return chess && chess.turn() !== (playerColor === 'white' ? 'w' : 'b');
    }

    function validateEngineMove(fen, moveStr) {
        if (typeof moveStr !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(moveStr)) return false;
        var position = new Chess(fen);
        return !!position.move({
            from: moveStr.substring(0, 2),
            to: moveStr.substring(2, 4),
            promotion: moveStr.length > 4 ? moveStr[4] : undefined
        });
    }

    function getEngineFEN(fen) {
        var fields = fen.split(' ');
        // chess-api.com принимает поле en passant только при возможном взятии.
        // chess.js 0.10.3 записывает его после любого двойного хода пешки.
        if (fields[3] !== '-') {
            var position = new Chess(fen);
            var canCaptureEnPassant = position.moves({ verbose: true }).some(function(move) {
                return move.flags.indexOf('e') !== -1;
            });
            if (!canCaptureEnPassant) fields[3] = '-';
        }
        return fields.join(' ');
    }

    function cancelEngineSearch() {
        searchGeneration++;
        waitingForEngine = false;
        waitingForHint = false;
        if (window.Bridge) window.Bridge.stopSearch();
    }

    function makeEngineMove() {
        if (gameOver || !isEngineTurn() || waitingForEngine) return;
        waitingForEngine = true;
        if (resettingEngine) return;

        var fen = chess.fen();
        var generation = ++searchGeneration;
        window.Bridge.setPosition(getEngineFEN(fen));

        // Передаём оставшееся время для оптимального тайм-менеджмента Stockfish
        var whiteTimeMs = getTimerMs('white');
        var blackTimeMs = getTimerMs('black');

        window.Bridge.startSearch({
            wtime: whiteTimeMs,
            btime: blackTimeMs,
            validateMove: function(moveStr) { return validateEngineMove(fen, moveStr); },
            onBestMove: function(moveStr, ponder) {
                if (generation !== searchGeneration || chess.fen() !== fen || !waitingForEngine) return;
                onEngineBestMove(moveStr, ponder);
            }
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
        cancelEngineSearch();
        var generation = searchGeneration;
        resettingEngine = true;
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

        waitingForEngine = playerColor === 'black';
        // Каждая новая партия заново проверяет доступность удалённого движка.
        return Promise.resolve(window.Bridge.newGame()).then(function() {
            if (generation !== searchGeneration) return;
            resettingEngine = false;
            waitingForEngine = false;
            if (!window.Bridge.getEngineReady()) return;
            if (isEngineTurn() && !gameOver) makeEngineMove();
        }).catch(function(error) {
            if (generation !== searchGeneration) return;
            resettingEngine = false;
            onEngineError(error);
        });
    }

    function undoMove() {
        if (gameOver || waitingForEngine || waitingForHint || resettingEngine) return false;
        // Первый ход движка за белых не образует пару с ходом игрока.
        if (chess.history().length < 2) return false;

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
        if (waitingForEngine || waitingForHint || resettingEngine || gameOver || isEngineTurn()) return;

        var fen = chess.fen();
        var generation = ++searchGeneration;
        waitingForHint = true;
        window.Bridge.setPosition(getEngineFEN(fen));
        window.Bridge.startSearch({
            movetime: 1000,
            validateMove: function(moveStr) { return validateEngineMove(fen, moveStr); },
            onBestMove: function(moveStr) {
                if (generation !== searchGeneration || chess.fen() !== fen || gameOver) return;
                waitingForHint = false;
                // Подсветим ход на доске через greySquare
                if (moveStr && moveStr.length >= 4) {
                    var from = moveStr.substring(0, 2);
                    var to = moveStr.substring(2, 4);
                    highlightSquare(from);
                    highlightSquare(to);
                    setTimeout(function() { removeHighlights(); }, 2000);
                }
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
        cancelEngineSearch();
        resettingEngine = false;
        pendingPromotion = null;
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
            if (gameOver || waitingForEngine || waitingForHint || isEngineTurn()) return false;
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
