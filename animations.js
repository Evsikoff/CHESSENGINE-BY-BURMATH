/**
 * animations.js — анимации для BURCHESS
 * Версия: 2.0
 * Модуль отвечает за:
 * - плавную анимацию перемещения фигур по доске
 * - анимацию взятия (исчезновение фигуры)
 * - анимацию рокировки (перемещение ладьи)
 * - анимацию превращения пешки
 * - анимацию подсветки последнего хода
 * - эффект "шах" (пульсация короля)
 * - анимацию новых фигур при превращении
 * - управление очередью анимаций (чтобы не наслаивались)
 * - поддержку отмены анимации при быстрых действиях
 */

(function() {
    'use strict';

    // ======================== Конфигурация ========================
    const AnimationConfig = {
        duration: 250,           // длительность анимации в мс
        easing: 'easeOutCubic',  // функция смягчения
        fps: 60,
        enabled: true,
        queueEnabled: true
    };

    // Функции смягчения (easing)
    const Easings = {
        linear: t => t,
        easeInQuad: t => t * t,
        easeOutQuad: t => t * (2 - t),
        easeInOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
        easeInCubic: t => t * t * t,
        easeOutCubic: t => (--t) * t * t + 1,
        easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
        easeOutElastic: t => {
            const p = 0.3;
            return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
        }
    };

    // ======================== Глобальные переменные ========================
    let activeAnimations = [];
    let animationFrameId = null;
    let canvas = null;
    let ctx = null;
    let boardRef = null;            // ссылка на модуль Board для перерисовки
    let isAnimating = false;
    let animationQueue = [];        // очередь анимаций

    // ======================== Вспомогательные функции ========================
    function getSquareCoords(file, rank) {
        if (!boardRef) return { x: 0, y: 0, size: 0 };
        const boardWidth = boardRef.boardWidth || 600;
        const squareSize = boardWidth / 8;
        let x = file * squareSize;
        let y = rank * squareSize;
        if (boardRef.boardFlipped) {
            x = (7 - file) * squareSize;
            y = (7 - rank) * squareSize;
        }
        return { x, y, size: squareSize };
    }

    function getPieceSymbol(piece) {
        const symbols = {
            'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
            'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
        };
        return symbols[piece] || '?';
    }

    // Основная функция отрисовки анимации (вызывается в requestAnimationFrame)
    function drawAnimationFrame() {
        if (!canvas || !ctx) return;
        if (activeAnimations.length === 0) {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            isAnimating = false;
            // После завершения всех анимаций перерисовываем доску
            if (boardRef && boardRef.draw) boardRef.draw();
            // Запускаем следующую из очереди
            processQueue();
            return;
        }
        // Очищаем canvas и рисуем доску (без фигур, только фон)
        drawBoardBase();
        // Рисуем все активные анимации поверх
        for (const anim of activeAnimations) {
            drawAnimation(anim);
        }
        animationFrameId = requestAnimationFrame(drawAnimationFrame);
    }

    function drawBoardBase() {
        if (!boardRef || !boardRef.drawBoard) {
            // Рисуем доску самостоятельно
            const size = boardRef?.boardWidth || 600;
            const squareSize = size / 8;
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    const isLight = (row + col) % 2 === 0;
                    ctx.fillStyle = isLight ? '#f0d9b5' : '#b58863';
                    ctx.fillRect(col * squareSize, row * squareSize, squareSize, squareSize);
                }
            }
        } else {
            boardRef.drawBoard();
        }
        // Рисуем статические фигуры, которые не участвуют в анимации
        drawStaticPieces();
    }

    function drawStaticPieces() {
        if (!boardRef || !boardRef.position) return;
        const size = boardRef.boardWidth / 8;
        for (let file = 0; file < 8; file++) {
            for (let rank = 0; rank < 8; rank++) {
                const piece = boardRef.getPieceAt(file, rank);
                if (piece) {
                    // Проверяем, не участвует ли фигура в активной анимации
                    const isAnimated = activeAnimations.some(anim => 
                        (anim.type === 'move' && ((anim.fromFile === file && anim.fromRank === rank) || (anim.toFile === file && anim.toRank === rank))) ||
                        (anim.type === 'capture' && anim.capturedFile === file && anim.capturedRank === rank)
                    );
                    if (!isAnimated) {
                        const { x, y } = getSquareCoords(file, rank);
                        drawPiece(piece, x, y, size);
                    }
                }
            }
        }
    }

    function drawPiece(piece, x, y, size) {
        const style = boardRef?.pieceStyle || 'merida';
        if (style === 'merida') {
            ctx.font = `${size * 0.7}px "Segoe UI", "Arial", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const symbol = getPieceSymbol(piece);
            ctx.fillStyle = piece === piece.toUpperCase() ? '#fff' : '#222';
            ctx.fillText(symbol, x + size/2, y + size/2);
        } else {
            // упрощённо
            ctx.font = `${size * 0.7}px monospace`;
            ctx.fillStyle = piece === piece.toUpperCase() ? '#eee' : '#111';
            ctx.fillText(piece, x + size/2, y + size/2);
        }
    }

    function drawAnimation(anim) {
        const t = Math.min(1, (Date.now() - anim.startTime) / anim.duration);
        const ease = Easings[anim.easing] || Easings.easeOutCubic;
        const progress = ease(t);
        if (t >= 1) {
            // анимация завершена
            anim.completed = true;
            return;
        }
        const size = boardRef?.boardWidth / 8 || 75;
        if (anim.type === 'move') {
            const fromX = anim.fromX;
            const fromY = anim.fromY;
            const toX = anim.toX;
            const toY = anim.toY;
            const currentX = fromX + (toX - fromX) * progress;
            const currentY = fromY + (toY - fromY) * progress;
            drawPiece(anim.piece, currentX, currentY, size);
        } else if (anim.type === 'capture') {
            // Рисуем исчезающую фигуру
            const alpha = 1 - progress;
            ctx.save();
            ctx.globalAlpha = alpha;
            const { x, y } = getSquareCoords(anim.capturedFile, anim.capturedRank);
            drawPiece(anim.capturedPiece, x, y, size);
            ctx.restore();
        } else if (anim.type === 'promotion') {
            // Анимация появления новой фигуры (увеличение)
            const scale = 0.5 + progress * 0.5;
            const { x, y } = getSquareCoords(anim.toFile, anim.toRank);
            ctx.save();
            ctx.translate(x + size/2, y + size/2);
            ctx.scale(scale, scale);
            ctx.translate(-(x + size/2), -(y + size/2));
            drawPiece(anim.newPiece, x, y, size);
            ctx.restore();
        } else if (anim.type === 'highlight') {
            // Пульсирующая подсветка
            const intensity = 0.5 + 0.5 * Math.sin(progress * Math.PI * 4);
            const { x, y } = getSquareCoords(anim.file, anim.rank);
            ctx.fillStyle = `rgba(255, 215, 0, ${0.3 * (1 - progress)})`;
            ctx.fillRect(x, y, size, size);
        }
    }

    function processQueue() {
        if (!AnimationConfig.queueEnabled) return;
        if (activeAnimations.length === 0 && animationQueue.length > 0) {
            const next = animationQueue.shift();
            startAnimation(next);
        }
    }

    function startAnimation(anim) {
        if (!boardRef) return;
        if (!AnimationConfig.enabled) {
            // Если анимации выключены, сразу завершаем
            if (anim.onComplete) anim.onComplete();
            return;
        }
        // Добавляем анимацию в активные
        anim.startTime = Date.now();
        anim.completed = false;
        anim.easing = anim.easing || AnimationConfig.easing;
        anim.duration = anim.duration || AnimationConfig.duration;
        // Если нужно, предварительно вычисляем координаты
        if (anim.type === 'move') {
            const from = getSquareCoords(anim.fromFile, anim.fromRank);
            const to = getSquareCoords(anim.toFile, anim.toRank);
            anim.fromX = from.x;
            anim.fromY = from.y;
            anim.toX = to.x;
            anim.toY = to.y;
        } else if (anim.type === 'capture') {
            // координаты уже будут в drawAnimation
        } else if (anim.type === 'promotion') {
            // подготовка
        }
        activeAnimations.push(anim);
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(drawAnimationFrame);
        }
        // Через duration убираем анимацию
        setTimeout(() => {
            const index = activeAnimations.indexOf(anim);
            if (index !== -1 && anim.completed) {
                activeAnimations.splice(index, 1);
                if (anim.onComplete) anim.onComplete();
            }
        }, anim.duration + 50);
    }

    // ======================== Публичные функции анимаций ========================
    function animateMove(fromFile, fromRank, toFile, toRank, piece, onComplete) {
        const anim = {
            type: 'move',
            fromFile, fromRank,
            toFile, toRank,
            piece,
            onComplete
        };
        if (AnimationConfig.queueEnabled && isAnimating) {
            animationQueue.push(anim);
        } else {
            startAnimation(anim);
        }
    }

    function animateCapture(capturedFile, capturedRank, capturedPiece, onComplete) {
        const anim = {
            type: 'capture',
            capturedFile, capturedRank,
            capturedPiece,
            onComplete
        };
        if (AnimationConfig.queueEnabled && isAnimating) {
            animationQueue.push(anim);
        } else {
            startAnimation(anim);
        }
    }

    function animatePromotion(toFile, toRank, newPiece, onComplete) {
        const anim = {
            type: 'promotion',
            toFile, toRank,
            newPiece,
            onComplete
        };
        if (AnimationConfig.queueEnabled && isAnimating) {
            animationQueue.push(anim);
        } else {
            startAnimation(anim);
        }
    }

    function animateHighlight(file, rank, duration = 300, onComplete) {
        const anim = {
            type: 'highlight',
            file, rank,
            duration,
            onComplete
        };
        startAnimation(anim);
    }

    function clearQueue() {
        animationQueue = [];
    }

    function stopAll() {
        activeAnimations = [];
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        isAnimating = false;
        if (boardRef && boardRef.draw) boardRef.draw();
    }

    function setEnabled(enabled) {
        AnimationConfig.enabled = enabled;
        if (!enabled) stopAll();
    }

    function setQueueEnabled(enabled) {
        AnimationConfig.queueEnabled = enabled;
    }

    function setDuration(durationMs) {
        AnimationConfig.duration = durationMs;
    }

    // Инициализация модуля
    function init(board) {
        boardRef = board;
        canvas = document.getElementById('chess-canvas');
        if (canvas) ctx = canvas.getContext('2d');
        console.log('[Animations] Initialized');
    }

    // Публичный API
    window.Animations = {
        init,
        animateMove,
        animateCapture,
        animatePromotion,
        animateHighlight,
        clearQueue,
        stopAll,
        setEnabled,
        setQueueEnabled,
        setDuration
    };
})();
