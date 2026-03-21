/**
 * board.js — отрисовка шахматной доски и фигур, обработка кликов
 * Версия: 2.0
 * Модуль отвечает за:
 * - рисование доски, фигур, координат
 * - обработку кликов мыши по доске
 * - выделение выбранной клетки, возможных ходов, последнего хода, шахов
 * - адаптацию размера canvas под контейнер
 * - поддержку разных стилей фигур (Merida, Alpha, CBurnett)
 * - работу с системой координат (буквенно-цифровая)
 * - взаимодействие с игровой логикой через колбэки
 */

(function() {
    'use strict';

    // ======================== Константы ========================
    const BOARD_SIZE = 8;
    const SQUARE_SIZE = 600 / BOARD_SIZE; // 75px при canvas 600x600
    const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

    // Цвета клеток (светлые и тёмные)
    const COLORS = {
        light: '#f0d9b5',
        dark: '#b58863',
        highlight: 'rgba(46, 204, 113, 0.5)',
        lastMove: 'rgba(155, 199, 0, 0.4)',
        check: 'rgba(231, 76, 60, 0.6)',
        selected: 'rgba(52, 152, 219, 0.5)'
    };

    // Символы фигур (Unicode) для стандартного отображения
    const UNICODE_PIECES = {
        'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
        'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
    };

    // ======================== Глобальные переменные модуля ========================
    const Board = {
        canvas: null,
        ctx: null,
        container: null,
        boardFlipped: false,    // перевернута ли доска (игрок играет чёрными)
        selectedSquare: null,   // выбранная клетка {file, rank}
        validMoves: [],         // массив допустимых ходов из выбранной клетки
        lastMove: null,         // последний сделанный ход {from, to, piece}
        checkSquare: null,      // клетка, на которой стоит король под шахом
        pieceStyle: 'merida',   // стиль фигур (merida, alpha, cburnett)
        showCoordinates: true,  // показывать координаты
        boardWidth: 600,        // текущий размер canvas (пиксели)
        boardHeight: 600,
        // Колбэки, устанавливаемые из game.js
        callbacks: {
            onSquareClick: null,     // (square) => void, где square {file, rank}
            onPieceDrag: null,       // (from, to) => boolean (если true, ход выполнен)
            onPromotion: null        // (from, to, pieceType) => void
        },
        // Текущая позиция фигур (FEN-подобный объект)
        position: null,         // будет заполняться из game.js
        // Промоушн (ожидание выбора фигуры)
        awaitingPromotion: false,
        promotionFrom: null,
        promotionTo: null
    };

    // ======================== Инициализация ========================
    function init() {
        Board.canvas = document.getElementById('chess-canvas');
        if (!Board.canvas) {
            console.error('[Board] Canvas not found');
            return;
        }
        Board.ctx = Board.canvas.getContext('2d');
        Board.container = Board.canvas.parentElement;

        // Устанавливаем размер canvas
        resizeCanvas();
        window.addEventListener('resize', () => resizeCanvas());

        // Обработчики событий мыши
        Board.canvas.addEventListener('click', handleCanvasClick);
        // Для поддержки drag-and-drop (дополнительно)
        Board.canvas.addEventListener('mousedown', handleMouseDown);
        Board.canvas.addEventListener('mousemove', handleMouseMove);
        Board.canvas.addEventListener('mouseup', handleMouseUp);

        // Загружаем настройки отображения
        loadDisplaySettings();

        console.log('[Board] Инициализирован');
    }

    function resizeCanvas() {
        if (!Board.container) return;
        // Получаем ширину контейнера (может быть меньше 600px на мобильных)
        const containerWidth = Board.container.clientWidth;
        const size = Math.min(containerWidth, 600);
        Board.boardWidth = size;
        Board.boardHeight = size;
        Board.canvas.width = size;
        Board.canvas.height = size;
        // Перерисовываем доску
        draw();
    }

    function loadDisplaySettings() {
        const settings = window.BurchessSettings;
        if (settings) {
            Board.pieceStyle = settings.pieceStyle || 'merida';
            Board.showCoordinates = settings.showCoordinates !== undefined ? settings.showCoordinates : true;
        }
        // Подписка на изменения настроек
        if (window.UI && window.UI.setCallbacks) {
            // Сохраним старый колбэк, чтобы не потерять
            const oldCallback = window.UI.callbacks?.onSettingsChange;
            window.UI.callbacks.onSettingsChange = (newSettings) => {
                if (oldCallback) oldCallback(newSettings);
                Board.pieceStyle = newSettings.pieceStyle;
                Board.showCoordinates = newSettings.showCoordinates;
                draw();
            };
        }
    }

    // ======================== Отрисовка ========================
    function draw() {
        if (!Board.ctx) return;
        drawBoard();
        drawPieces();
        drawCoordinates();
        drawHighlights();
    }

    function drawBoard() {
        const ctx = Board.ctx;
        const size = BOARD_SIZE;
        const squareSize = Board.boardWidth / size;
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const isLight = (row + col) % 2 === 0;
                const fillColor = isLight ? COLORS.light : COLORS.dark;
                ctx.fillStyle = fillColor;
                ctx.fillRect(col * squareSize, row * squareSize, squareSize, squareSize);
            }
        }
    }

    function drawPieces() {
        if (!Board.position) return;
        const squareSize = Board.boardWidth / BOARD_SIZE;
        for (let file = 0; file < BOARD_SIZE; file++) {
            for (let rank = 0; rank < BOARD_SIZE; rank++) {
                const piece = getPieceAt(file, rank);
                if (piece) {
                    const x = file * squareSize;
                    const y = rank * squareSize;
                    drawPiece(piece, x, y, squareSize);
                }
            }
        }
    }

    function drawPiece(piece, x, y, size) {
        const ctx = Board.ctx;
        // Используем стиль фигур
        if (Board.pieceStyle === 'merida') {
            // Рисуем Unicode (можно вписать в canvas)
            ctx.font = `${size * 0.7}px "Segoe UI", "Arial", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const symbol = UNICODE_PIECES[piece];
            if (symbol) {
                ctx.fillStyle = piece === piece.toUpperCase() ? '#fff' : '#222';
                ctx.shadowBlur = 0;
                ctx.fillText(symbol, x + size/2, y + size/2);
            }
        } else {
            // Для альфа и CBurnett используем загрузку изображений (в упрощённом виде рисуем цветные фигуры)
            // В реальном проекте нужно загружать SVG или изображения. Для простоты оставим Unicode с подложкой.
            ctx.font = `${size * 0.7}px "Segoe UI", "Arial", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const symbol = UNICODE_PIECES[piece];
            if (symbol) {
                ctx.fillStyle = piece === piece.toUpperCase() ? '#f5f5f5' : '#2c3e50';
                ctx.fillText(symbol, x + size/2, y + size/2);
            }
        }
    }

    function drawCoordinates() {
        if (!Board.showCoordinates) return;
        const ctx = Board.ctx;
        const squareSize = Board.boardWidth / BOARD_SIZE;
        ctx.font = `${Math.max(10, squareSize * 0.2)}px monospace`;
        ctx.fillStyle = '#333';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < BOARD_SIZE; i++) {
            // Координаты по вертикали (ранги)
            const rank = RANKS[i];
            const x = squareSize * 0.15;
            const y = (Board.boardFlipped ? i : BOARD_SIZE - 1 - i) * squareSize + squareSize/2;
            ctx.fillText(rank, x, y);
            // Координаты по горизонтали (файлы)
            const file = FILES[i];
            const x2 = (Board.boardFlipped ? i : BOARD_SIZE - 1 - i) * squareSize + squareSize/2;
            const y2 = Board.boardHeight - squareSize * 0.15;
            ctx.fillText(file, x2, y2);
        }
    }

    function drawHighlights() {
        const ctx = Board.ctx;
        const squareSize = Board.boardWidth / BOARD_SIZE;
        // Подсветка последнего хода
        if (Board.lastMove) {
            const from = Board.lastMove.from;
            const to = Board.lastMove.to;
            if (from) {
                ctx.fillStyle = COLORS.lastMove;
                ctx.fillRect(from.file * squareSize, from.rank * squareSize, squareSize, squareSize);
            }
            if (to) {
                ctx.fillStyle = COLORS.lastMove;
                ctx.fillRect(to.file * squareSize, to.rank * squareSize, squareSize, squareSize);
            }
        }
        // Подсветка шаха
        if (Board.checkSquare) {
            ctx.fillStyle = COLORS.check;
            ctx.fillRect(Board.checkSquare.file * squareSize, Board.checkSquare.rank * squareSize, squareSize, squareSize);
        }
        // Подсветка выбранной клетки
        if (Board.selectedSquare) {
            ctx.fillStyle = COLORS.selected;
            ctx.fillRect(Board.selectedSquare.file * squareSize, Board.selectedSquare.rank * squareSize, squareSize, squareSize);
        }
        // Подсветка допустимых ходов
        if (Board.validMoves && Board.validMoves.length) {
            ctx.fillStyle = COLORS.highlight;
            for (const move of Board.validMoves) {
                ctx.fillRect(move.to.file * squareSize, move.to.rank * squareSize, squareSize, squareSize);
                // Можно добавить кружок в центре
                ctx.beginPath();
                ctx.arc((move.to.file + 0.5) * squareSize, (move.to.rank + 0.5) * squareSize, squareSize * 0.2, 0, 2 * Math.PI);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.fill();
            }
        }
    }

    // ======================== Преобразование координат ========================
    function getSquareFromPixel(clientX, clientY) {
        const rect = Board.canvas.getBoundingClientRect();
        const scaleX = Board.canvas.width / rect.width;
        const scaleY = Board.canvas.height / rect.height;
        const canvasX = (clientX - rect.left) * scaleX;
        const canvasY = (clientY - rect.top) * scaleY;
        if (canvasX < 0 || canvasX > Board.boardWidth || canvasY < 0 || canvasY > Board.boardHeight) return null;
        const file = Math.floor(canvasX / (Board.boardWidth / BOARD_SIZE));
        const rank = Math.floor(canvasY / (Board.boardHeight / BOARD_SIZE));
        if (file < 0 || file >= BOARD_SIZE || rank < 0 || rank >= BOARD_SIZE) return null;
        // Если доска перевернута, нужно инвертировать координаты
        let actualFile = file;
        let actualRank = rank;
        if (Board.boardFlipped) {
            actualFile = BOARD_SIZE - 1 - file;
            actualRank = BOARD_SIZE - 1 - rank;
        }
        return { file: actualFile, rank: actualRank, fileChar: FILES[actualFile], rankChar: RANKS[actualRank] };
    }

    // ======================== Получение фигуры ========================
    function getPieceAt(file, rank) {
        if (!Board.position) return null;
        // Board.position должен быть объектом с ключами вида "a1", "e2" и т.д.
        const square = FILES[file] + RANKS[rank];
        return Board.position[square] || null;
    }

    // ======================== Обработка кликов ========================
    function handleCanvasClick(e) {
        if (Board.awaitingPromotion) return; // ждем выбора фигуры
        const square = getSquareFromPixel(e.clientX, e.clientY);
        if (!square) return;
        // Вызываем колбэк игровой логики
        if (Board.callbacks.onSquareClick) {
            Board.callbacks.onSquareClick(square);
        }
    }

    // ======================== Drag-and-drop (дополнительно) ========================
    let dragStartSquare = null;
    let dragTargetSquare = null;
    let isDragging = false;

    function handleMouseDown(e) {
        if (Board.awaitingPromotion) return;
        const square = getSquareFromPixel(e.clientX, e.clientY);
        if (!square) return;
        dragStartSquare = square;
        isDragging = true;
        e.preventDefault();
    }

    function handleMouseMove(e) {
        if (!isDragging) return;
        // можно рисовать призрака, но для простоты пропустим
        const square = getSquareFromPixel(e.clientX, e.clientY);
        if (square) dragTargetSquare = square;
    }

    function handleMouseUp(e) {
        if (!isDragging) return;
        isDragging = false;
        const target = getSquareFromPixel(e.clientX, e.clientY);
        if (dragStartSquare && target && (dragStartSquare.file !== target.file || dragStartSquare.rank !== target.rank)) {
            // Выполняем ход через колбэк
            if (Board.callbacks.onPieceDrag) {
                const from = dragStartSquare;
                const to = target;
                Board.callbacks.onPieceDrag(from, to);
            }
        }
        dragStartSquare = null;
        dragTargetSquare = null;
    }

    // ======================== Публичный API ========================
    function setPosition(position) {
        Board.position = position;
        draw();
    }

    function setBoardFlipped(flipped) {
        Board.boardFlipped = flipped;
        draw();
    }

    function setSelectedSquare(square) {
        Board.selectedSquare = square;
        draw();
    }

    function setValidMoves(moves) {
        Board.validMoves = moves;
        draw();
    }

    function setLastMove(from, to) {
        Board.lastMove = { from, to };
        draw();
    }

    function setCheckSquare(square) {
        Board.checkSquare = square;
        draw();
    }

    function clearHighlights() {
        Board.selectedSquare = null;
        Board.validMoves = [];
        draw();
    }

    function setAwaitingPromotion(awaiting, from = null, to = null) {
        Board.awaitingPromotion = awaiting;
        Board.promotionFrom = from;
        Board.promotionTo = to;
        if (awaiting && window.UI && typeof window.UI.openPromotionModal === 'function') {
            window.UI.openPromotionModal();
        }
    }

    function refresh() {
        draw();
    }

    // Регистрируем модуль в глобальном объекте
    window.Board = {
        init,
        setPosition,
        setBoardFlipped,
        setSelectedSquare,
        setValidMoves,
        setLastMove,
        setCheckSquare,
        clearHighlights,
        setAwaitingPromotion,
        refresh,
        draw,
        // Для доступа к колбэкам из game.js
        setCallbacks: (callbacks) => {
            Object.assign(Board.callbacks, callbacks);
        },
        getSquareFromPixel,
        getPieceAt
    };
})();
