/**
 * movehistory.js — управление историей ходов, навигация, откат
 * Версия: 2.0
 * Модуль отвечает за:
 * - хранение полной истории партии (ходы, позиции)
 * - отображение списка ходов в интерфейсе
 * - навигацию по истории (перемотка вперёд/назад)
 * - поддержку отмены хода (undo) с возвратом в предыдущее состояние
 * - формирование PGN записи партии
 * - экспорт/импорт PGN
 * - работу с комментариями и вариациями (базовая)
 */

(function() {
    'use strict';

    // ======================== Структура хранения ========================
    class MoveHistory {
        constructor() {
            this.moves = [];            // массив объектов ходов
            this.positions = [];        // FEN позиции после каждого хода
            this.currentIndex = -1;     // текущий индекс в истории (на какой позиции мы находимся)
            this.startFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            this.gameResult = '*';       // результат: 1-0, 0-1, 1/2-1/2, *
            this.headers = {             // заголовки PGN
                Event: 'BURCHESS Game',
                Site: 'GitHub Pages',
                Date: new Date().toISOString().slice(0,10),
                Round: '1',
                White: 'Player',
                Black: 'BURCHESS',
                Result: '*'
            };
            this.callbacks = {
                onHistoryChange: null    // вызывается при изменении истории (обновление UI)
            };
        }

        // Инициализация новой партии
        init(startFEN = null) {
            this.moves = [];
            this.positions = [];
            this.currentIndex = -1;
            this.startFEN = startFEN || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            this.gameResult = '*';
            this.headers.Result = '*';
            this.headers.Date = new Date().toISOString().slice(0,10);
            this.addPosition(this.startFEN);
            this._notifyChange();
        }

        // Добавить новую позицию (FEN) в историю
        addPosition(fen) {
            this.positions.push(fen);
            // если мы не в конце истории, удаляем всё после currentIndex
            if (this.currentIndex + 1 < this.positions.length) {
                this.positions = this.positions.slice(0, this.currentIndex + 2);
                this.moves = this.moves.slice(0, this.currentIndex + 1);
            }
            this.currentIndex = this.positions.length - 1;
            this._notifyChange();
        }

        // Добавить ход (в формате SAN, UCI, with from/to)
        addMove(san, uci, from, to, piece, promotion = null, fenAfter = null) {
            const moveNumber = Math.floor(this.moves.length / 2) + 1;
            const isWhite = (this.moves.length % 2 === 0);
            const moveObj = {
                san,
                uci,
                from,
                to,
                piece,
                promotion,
                moveNumber,
                color: isWhite ? 'w' : 'b',
                fenBefore: this.getCurrentFEN(),
                fenAfter: fenAfter || null
            };
            // Если мы не в конце, удаляем будущие ходы
            if (this.currentIndex + 1 < this.positions.length) {
                this.positions = this.positions.slice(0, this.currentIndex + 1);
                this.moves = this.moves.slice(0, this.currentIndex);
            }
            this.moves.push(moveObj);
            if (fenAfter) this.addPosition(fenAfter);
            else this._notifyChange();
            return moveObj;
        }

        // Получить текущую позицию (FEN)
        getCurrentFEN() {
            if (this.currentIndex >= 0 && this.currentIndex < this.positions.length) {
                return this.positions[this.currentIndex];
            }
            return this.startFEN;
        }

        // Откат на один ход назад (если возможно)
        undo() {
            if (this.currentIndex > 0) {
                this.currentIndex--;
                this._notifyChange();
                return true;
            }
            return false;
        }

        // Откат на несколько ходов
        undoTo(index) {
            if (index >= 0 && index < this.positions.length) {
                this.currentIndex = index;
                this._notifyChange();
                return true;
            }
            return false;
        }

        // Перемотка вперёд (redo) до конца
        redo() {
            if (this.currentIndex + 1 < this.positions.length) {
                this.currentIndex++;
                this._notifyChange();
                return true;
            }
            return false;
        }

        // Получить последний сделанный ход (объект)
        getLastMove() {
            if (this.moves.length === 0) return null;
            return this.moves[this.moves.length - 1];
        }

        // Получить историю ходов для отображения в UI
        getMoveListForDisplay() {
            const result = [];
            for (let i = 0; i < this.moves.length; i++) {
                const move = this.moves[i];
                const moveNumber = Math.floor(i / 2) + 1;
                if (i % 2 === 0) {
                    // белый ход
                    result.push({
                        number: moveNumber,
                        white: move.san,
                        black: null
                    });
                } else {
                    // чёрный ход
                    const last = result[result.length - 1];
                    if (last && last.number === moveNumber) {
                        last.black = move.san;
                    } else {
                        result.push({
                            number: moveNumber,
                            white: null,
                            black: move.san
                        });
                    }
                }
            }
            return result;
        }

        // Сформировать PGN
        exportPGN() {
            let pgn = '';
            // Заголовки
            for (const [key, value] of Object.entries(this.headers)) {
                if (value) pgn += `[${key} "${value}"]\n`;
            }
            pgn += '\n';
            // Ходы
            let moveText = '';
            for (let i = 0; i < this.moves.length; i++) {
                const move = this.moves[i];
                const moveNumber = Math.floor(i / 2) + 1;
                if (i % 2 === 0) {
                    moveText += `${moveNumber}. ${move.san} `;
                } else {
                    moveText += `${move.san} `;
                }
            }
            pgn += moveText.trim();
            pgn += ` ${this.gameResult}`;
            return pgn;
        }

        // Импорт PGN (простая реализация, разбор базовый)
        importPGN(pgnText) {
            // TODO: полноценный парсер PGN
            console.warn('PGN import is not fully implemented');
        }

        // Установить результат игры
        setResult(result) {
            this.gameResult = result;
            this.headers.Result = result;
            this._notifyChange();
        }

        // Очистить историю
        clear() {
            this.init(this.startFEN);
        }

        // Проверить, можно ли отменить ход (есть ли предыдущие)
        canUndo() {
            return this.currentIndex > 0;
        }

        // Проверить, можно ли вернуть отменённый ход
        canRedo() {
            return this.currentIndex + 1 < this.positions.length;
        }

        // Внутреннее уведомление об изменении
        _notifyChange() {
            if (this.callbacks.onHistoryChange) {
                this.callbacks.onHistoryChange(this);
            }
        }

        // Получить текущий индекс (для отладки)
        getCurrentIndex() {
            return this.currentIndex;
        }

        // Получить общее количество позиций
        getTotalPositions() {
            return this.positions.length;
        }

        // Получить все позиции (для навигации)
        getAllPositions() {
            return this.positions.slice();
        }
    }

    // ======================== Глобальный экземпляр и интеграция с UI ========================
    const history = new MoveHistory();
    let uiMoveListElement = null;
    let isUpdatingFromHistory = false;

    // Инициализация UI-компонента истории ходов
    function initUI() {
        uiMoveListElement = document.getElementById('move-list');
        if (!uiMoveListElement) return;

        // Подписка на изменения истории
        history.callbacks.onHistoryChange = () => {
            if (isUpdatingFromHistory) return;
            renderMoveList();
        };

        // Добавляем обработчики для кликов по ходам (навигация)
        uiMoveListElement.addEventListener('click', (e) => {
            let target = e.target;
            while (target && target !== uiMoveListElement && !target.hasAttribute('data-move-index')) {
                target = target.parentElement;
            }
            if (target && target.hasAttribute('data-move-index')) {
                const index = parseInt(target.getAttribute('data-move-index'), 10);
                if (!isNaN(index)) {
                    goToMoveIndex(index);
                }
            }
        });
    }

    function renderMoveList() {
        if (!uiMoveListElement) return;
        const moveList = history.getMoveListForDisplay();
        uiMoveListElement.innerHTML = '';
        for (const item of moveList) {
            const div = document.createElement('div');
            div.className = 'move-entry';
            let moveNumberSpan = `<span class="move-number">${item.number}.</span>`;
            let whiteSpan = item.white ? `<span class="move-white" data-move-index="${(item.number-1)*2}">${item.white}</span>` : '<span class="move-white"></span>';
            let blackSpan = item.black ? `<span class="move-black" data-move-index="${(item.number-1)*2+1}">${item.black}</span>` : '<span class="move-black"></span>';
            div.innerHTML = `${moveNumberSpan} ${whiteSpan} ${blackSpan}`;
            uiMoveListElement.appendChild(div);
        }
    }

    function goToMoveIndex(moveIndex) {
        // moveIndex — индекс хода в массиве moves (0-based)
        if (moveIndex < 0 || moveIndex >= history.moves.length) return;
        // Позиция после этого хода — moveIndex+1
        const targetPosIndex = moveIndex + 1;
        if (targetPosIndex < history.positions.length) {
            history.undoTo(targetPosIndex);
            // Вызовем колбэк из game.js для обновления доски
            if (window.Game && typeof window.Game.setPositionFromHistory === 'function') {
                window.Game.setPositionFromHistory(history.getCurrentFEN());
            }
        }
    }

    // Публичный API для использования другими модулями
    window.MoveHistory = {
        init: (startFEN) => history.init(startFEN),
        addMove: (san, uci, from, to, piece, promotion, fenAfter) => history.addMove(san, uci, from, to, piece, promotion, fenAfter),
        undo: () => {
            const success = history.undo();
            if (success && window.Game && typeof window.Game.setPositionFromHistory === 'function') {
                window.Game.setPositionFromHistory(history.getCurrentFEN());
            }
            return success;
        },
        redo: () => {
            const success = history.redo();
            if (success && window.Game && typeof window.Game.setPositionFromHistory === 'function') {
                window.Game.setPositionFromHistory(history.getCurrentFEN());
            }
            return success;
        },
        getCurrentFEN: () => history.getCurrentFEN(),
        getLastMove: () => history.getLastMove(),
        setResult: (result) => history.setResult(result),
        exportPGN: () => history.exportPGN(),
        clear: () => history.clear(),
        canUndo: () => history.canUndo(),
        canRedo: () => history.canRedo(),
        getMoveListForDisplay: () => history.getMoveListForDisplay(),
        initUI,
        renderMoveList,
        getHistoryObject: () => history,
        // Для навигации из game.js
        goToPosition: (index) => {
            if (history.undoTo(index)) {
                if (window.Game && typeof window.Game.setPositionFromHistory === 'function') {
                    window.Game.setPositionFromHistory(history.getCurrentFEN());
                }
                return true;
            }
            return false;
        }
    };

    // Автоматическая инициализация UI после загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.MoveHistory.initUI();
            window.MoveHistory.init(); // начальная инициализация пустой истории
        });
    } else {
        window.MoveHistory.initUI();
        window.MoveHistory.init();
    }
})();
