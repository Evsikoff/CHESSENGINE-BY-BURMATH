/**
 * UI.js — управление пользовательским интерфейсом BURCHESS
 * Версия: 2.0
 * Модуль отвечает за:
 * - инициализацию DOM-элементов
 * - обработку кликов по кнопкам
 * - модальные окна (настройки, превращение, окончание игры)
 * - таймеры, тосты, смену темы, полноэкранный режим
 * - сохранение и загрузку настроек из localStorage
 * - взаимодействие с игровой логикой через колбэки
 */

(function() {
    'use strict';

    // ======================== Глобальные переменные UI ========================
    const UI = {
        // DOM элементы
        elements: {},
        // Состояние интерфейса
        isDarkTheme: false,
        isFullscreen: false,
        // Таймеры
        timers: {
            white: null,
            black: null,
            whiteTime: 15 * 60, // секунды
            blackTime: 15 * 60,
            active: false
        },
        // Колбэки (устанавливаются из game.js)
        callbacks: {
            onNewGame: null,
            onUndo: null,
            onHint: null,
            onFlipBoard: null,
            onSettingsChange: null,
            onPromotion: null,
            onMoveFromUI: null
        },
        // Текущая позиция (будет обновляться из game.js)
        currentTurn: 'white',
        gameOver: false,
        // Очередь тостов
        toastTimeout: null
    };

    // ======================== Инициализация ========================
    function init() {
        cacheElements();
        attachEventListeners();
        loadSettings();
        applyTheme();
        updateTurnDisplay('white');
        updateTimersDisplay();
        setupModalClosers();
        console.log('[UI] Инициализация завершена');
    }

    function cacheElements() {
        const e = UI.elements;
        e.app = document.querySelector('.app');
        e.canvas = document.getElementById('chess-canvas');
        e.statusMsg = document.getElementById('status-message');
        e.turnIndicator = document.getElementById('turn-indicator');
        e.turnText = document.querySelector('.turn-text');
        e.turnPiece = document.querySelector('.turn-piece');
        e.whiteTimer = document.getElementById('white-timer');
        e.blackTimer = document.getElementById('black-timer');
        e.evalFill = document.getElementById('eval-fill');
        e.evalNumeric = document.getElementById('eval-numeric');
        e.moveList = document.getElementById('move-list');
        e.engineThought = document.getElementById('engine-thought');
        e.pvLine = document.getElementById('pv-line');
        e.nodesCount = document.getElementById('nodes-count');
        e.nps = document.getElementById('nps');
        e.depthBadge = document.getElementById('search-depth');
        e.flipBoardBtn = document.getElementById('flip-board-btn');
        e.undoBtn = document.getElementById('undo-btn');
        e.newGameBtn = document.getElementById('new-game-btn');
        e.settingsBtn = document.getElementById('settings-btn');
        e.hintBtn = document.getElementById('hint-btn');
        e.fullscreenBtn = document.getElementById('fullscreen-btn');
        e.themeToggle = document.getElementById('theme-toggle');
        e.clearHistoryBtn = document.getElementById('clear-history-btn');
        
        // Модальные окна
        e.settingsModal = document.getElementById('settings-modal');
        e.promotionModal = document.getElementById('promotion-modal');
        e.gameOverModal = document.getElementById('game-over-modal');
        e.toast = document.getElementById('toast-message');
        
        // Элементы настроек
        e.skillLevel = document.getElementById('skill-level');
        e.skillValueDisplay = document.getElementById('skill-value-display');
        e.moveTime = document.getElementById('move-time');
        e.playerColor = document.getElementById('player-color');
        e.soundToggle = document.getElementById('sound-toggle');
        e.showCoordinates = document.getElementById('show-coordinates');
        e.pieceStyle = document.getElementById('piece-style');
        e.saveSettings = document.getElementById('save-settings');
        e.resetDefaults = document.getElementById('reset-defaults');
        
        // Кнопки превращения
        e.promotionBtns = document.querySelectorAll('.promo-btn');
        
        // Кнопки модалки окончания игры
        e.gameOverNewGame = document.getElementById('game-over-new-game');
        
        // Дополнительные элементы
        e.engineStatus = document.getElementById('engine-status');
        e.evalContainer = document.getElementById('eval-container');
    }

    function attachEventListeners() {
        const e = UI.elements;
        if (e.flipBoardBtn) e.flipBoardBtn.addEventListener('click', () => UI.callbacks.onFlipBoard?.());
        if (e.undoBtn) e.undoBtn.addEventListener('click', () => UI.callbacks.onUndo?.());
        if (e.newGameBtn) e.newGameBtn.addEventListener('click', () => UI.callbacks.onNewGame?.());
        if (e.settingsBtn) e.settingsBtn.addEventListener('click', () => openModal('settings'));
        if (e.hintBtn) e.hintBtn.addEventListener('click', () => UI.callbacks.onHint?.());
        if (e.fullscreenBtn) e.fullscreenBtn.addEventListener('click', toggleFullscreen);
        if (e.themeToggle) e.themeToggle.addEventListener('click', toggleTheme);
        if (e.clearHistoryBtn) e.clearHistoryBtn.addEventListener('click', () => clearMoveHistory());
        if (e.saveSettings) e.saveSettings.addEventListener('click', saveSettings);
        if (e.resetDefaults) e.resetDefaults.addEventListener('click', resetSettings);
        if (e.gameOverNewGame) e.gameOverNewGame.addEventListener('click', () => {
            closeModal('gameOver');
            UI.callbacks.onNewGame?.();
        });
        
        // Слайдер сложности
        if (e.skillLevel) {
            e.skillLevel.addEventListener('input', (event) => {
                if (e.skillValueDisplay) e.skillValueDisplay.textContent = event.target.value;
            });
        }
        
        // Кнопки превращения
        e.promotionBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const piece = btn.getAttribute('data-piece');
                if (UI.callbacks.onPromotion) {
                    UI.callbacks.onPromotion(piece);
                }
                closeModal('promotion');
            });
        });
        
        // Закрытие модалок по клику на крестик или оверлей
        const modals = ['settings', 'promotion', 'gameOver'];
        modals.forEach(modal => {
            const modalElement = UI.elements[`${modal}Modal`];
            if (modalElement) {
                const closeBtn = modalElement.querySelector('.close');
                if (closeBtn) closeBtn.addEventListener('click', () => closeModal(modal));
                modalElement.addEventListener('click', (e) => {
                    if (e.target === modalElement) closeModal(modal);
                });
            }
        });
    }

    // ======================== Управление модальными окнами ========================
    function openModal(modalName) {
        const modal = UI.elements[`${modalName}Modal`];
        if (modal) modal.style.display = 'flex';
    }

    function closeModal(modalName) {
        const modal = UI.elements[`${modalName}Modal`];
        if (modal) modal.style.display = 'none';
    }

    function setupModalClosers() {
        // Дополнительно: закрытие по Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal('settings');
                closeModal('promotion');
                closeModal('gameOver');
            }
        });
    }

    // ======================== Настройки ========================
    function loadSettings() {
        const defaults = {
            skillLevel: 15,
            moveTime: 1000,
            playerColor: 'white',
            soundEnabled: true,
            showCoordinates: true,
            pieceStyle: 'merida',
            theme: 'light'
        };
        let settings;
        try {
            const stored = localStorage.getItem('burchess_settings');
            if (stored) {
                settings = JSON.parse(stored);
            } else {
                settings = { ...defaults };
            }
        } catch(e) {
            settings = { ...defaults };
        }
        // Применяем к элементам
        if (UI.elements.skillLevel) UI.elements.skillLevel.value = settings.skillLevel;
        if (UI.elements.skillValueDisplay) UI.elements.skillValueDisplay.textContent = settings.skillLevel;
        if (UI.elements.moveTime) UI.elements.moveTime.value = settings.moveTime;
        if (UI.elements.playerColor) UI.elements.playerColor.value = settings.playerColor;
        if (UI.elements.soundToggle) UI.elements.soundToggle.checked = settings.soundEnabled;
        if (UI.elements.showCoordinates) UI.elements.showCoordinates.checked = settings.showCoordinates;
        if (UI.elements.pieceStyle) UI.elements.pieceStyle.value = settings.pieceStyle;
        
        // Тема
        UI.isDarkTheme = (settings.theme === 'dark');
        if (UI.isDarkTheme) document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
        
        // Сохраняем настройки в глобальный объект (доступен другим модулям)
        window.BurchessSettings = {
            skillLevel: settings.skillLevel,
            moveTime: settings.moveTime,
            playerColor: settings.playerColor,
            soundEnabled: settings.soundEnabled,
            showCoordinates: settings.showCoordinates,
            pieceStyle: settings.pieceStyle,
            theme: settings.theme
        };
    }

    function saveSettings() {
        const settings = {
            skillLevel: parseInt(UI.elements.skillLevel.value),
            moveTime: parseInt(UI.elements.moveTime.value),
            playerColor: UI.elements.playerColor.value,
            soundEnabled: UI.elements.soundToggle.checked,
            showCoordinates: UI.elements.showCoordinates.checked,
            pieceStyle: UI.elements.pieceStyle.value,
            theme: UI.isDarkTheme ? 'dark' : 'light'
        };
        localStorage.setItem('burchess_settings', JSON.stringify(settings));
        window.BurchessSettings = settings;
        closeModal('settings');
        showToast('Настройки сохранены', 2000);
        if (UI.callbacks.onSettingsChange) UI.callbacks.onSettingsChange(settings);
    }

    function resetSettings() {
        if (UI.elements.skillLevel) UI.elements.skillLevel.value = 15;
        if (UI.elements.skillValueDisplay) UI.elements.skillValueDisplay.textContent = 15;
        if (UI.elements.moveTime) UI.elements.moveTime.value = 1000;
        if (UI.elements.playerColor) UI.elements.playerColor.value = 'white';
        if (UI.elements.soundToggle) UI.elements.soundToggle.checked = true;
        if (UI.elements.showCoordinates) UI.elements.showCoordinates.checked = true;
        if (UI.elements.pieceStyle) UI.elements.pieceStyle.value = 'merida';
        // Тему не сбрасываем, оставляем текущую
        showToast('Настройки сброшены', 1500);
    }

    // ======================== Тема и полноэкранный режим ========================
    function toggleTheme() {
        UI.isDarkTheme = !UI.isDarkTheme;
        if (UI.isDarkTheme) {
            document.documentElement.setAttribute('data-theme', 'dark');
            UI.elements.themeToggle.textContent = '☀️';
        } else {
            document.documentElement.removeAttribute('data-theme');
            UI.elements.themeToggle.textContent = '🌙';
        }
        // Сохраняем тему в настройках
        if (window.BurchessSettings) {
            window.BurchessSettings.theme = UI.isDarkTheme ? 'dark' : 'light';
            saveSettings(); // сохраним все настройки (обновит тему)
        }
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.warn(`Fullscreen error: ${err.message}`);
            });
            UI.isFullscreen = true;
            UI.elements.fullscreenBtn.textContent = '✕';
        } else {
            document.exitFullscreen();
            UI.isFullscreen = false;
            UI.elements.fullscreenBtn.textContent = '⛶';
        }
    }

    document.addEventListener('fullscreenchange', () => {
        UI.isFullscreen = !!document.fullscreenElement;
        if (UI.elements.fullscreenBtn) {
            UI.elements.fullscreenBtn.textContent = UI.isFullscreen ? '✕' : '⛶';
        }
    });

    // ======================== Таймеры ========================
    function startTimers() {
        stopTimers();
        UI.timers.active = true;
        UI.timers.whiteTime = getTimeForColor('white');
        UI.timers.blackTime = getTimeForColor('black');
        updateTimersDisplay();
        // Запускаем активный таймер
        startActiveTimer();
    }

    function stopTimers() {
        UI.timers.active = false;
        if (UI.timers.white) clearInterval(UI.timers.white);
        if (UI.timers.black) clearInterval(UI.timers.black);
        UI.timers.white = null;
        UI.timers.black = null;
    }

    function startActiveTimer() {
        if (!UI.timers.active || UI.gameOver) return;
        stopTimers(); // очищаем предыдущие интервалы
        const color = UI.currentTurn;
        const updateTimer = () => {
            if (!UI.timers.active || UI.gameOver) return;
            if (color === 'white') {
                if (UI.timers.whiteTime <= 0) {
                    onTimeOut('white');
                    return;
                }
                UI.timers.whiteTime--;
            } else {
                if (UI.timers.blackTime <= 0) {
                    onTimeOut('black');
                    return;
                }
                UI.timers.blackTime--;
            }
            updateTimersDisplay();
        };
        const interval = setInterval(updateTimer, 1000);
        if (color === 'white') UI.timers.white = interval;
        else UI.timers.black = interval;
    }

    function updateTimersDisplay() {
        if (UI.elements.whiteTimer) {
            UI.elements.whiteTimer.textContent = formatTime(UI.timers.whiteTime);
        }
        if (UI.elements.blackTimer) {
            UI.elements.blackTimer.textContent = formatTime(UI.timers.blackTime);
        }
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    function getTimeForColor(color) {
        // Здесь можно вернуть время из настроек, пока 15 минут
        return 15 * 60;
    }

    function onTimeOut(color) {
        UI.gameOver = true;
        UI.timers.active = false;
        stopTimers();
        const winner = color === 'white' ? 'Чёрные' : 'Белые';
        showGameOverMessage(`${winner} выиграли по времени!`, winner === 'Белые' ? 'white' : 'black');
        if (UI.callbacks.onGameOver) UI.callbacks.onGameOver(`timeout ${color}`);
    }

    // ======================== Статус и отображение ========================
    function updateTurnDisplay(turn) {
        UI.currentTurn = turn;
        if (UI.elements.turnText) {
            UI.elements.turnText.textContent = turn === 'white' ? 'Ход белых' : 'Ход чёрных';
        }
        if (UI.elements.turnPiece) {
            UI.elements.turnPiece.textContent = turn === 'white' ? '♔' : '♚';
        }
        // Перезапускаем таймер, если активен
        if (UI.timers.active && !UI.gameOver) {
            startActiveTimer();
        }
    }

    function updateEval(evalValue, isMate = false) {
        // evalValue в сотых пешки (например, 150 = 1.50 пешки)
        let displayValue;
        if (isMate) {
            const movesToMate = Math.abs(evalValue);
            displayValue = evalValue > 0 ? `#${movesToMate}` : `-#${movesToMate}`;
        } else {
            displayValue = (evalValue / 100).toFixed(2);
            if (evalValue > 0) displayValue = '+' + displayValue;
        }
        if (UI.elements.evalNumeric) UI.elements.evalNumeric.textContent = displayValue;
        // Заполнение шкалы
        const percent = Math.min(100, Math.max(0, 50 + (evalValue / 500) * 50));
        if (UI.elements.evalFill) UI.elements.evalFill.style.width = percent + '%';
    }

    function updateEngineInfo(depth, nodes, nps, pv, bestMove, evalValue) {
        if (UI.elements.depthBadge) UI.elements.depthBadge.textContent = `Глубина: ${depth}`;
        if (UI.elements.nodesCount) UI.elements.nodesCount.textContent = `Узлов: ${nodes?.toLocaleString() || 0}`;
        if (UI.elements.nps) UI.elements.nps.textContent = `NPS: ${nps?.toLocaleString() || 0}`;
        if (UI.elements.engineThought) {
            let thought = bestMove ? `Лучший ход: ${bestMove}` : 'Анализ...';
            if (evalValue !== undefined) {
                let evalStr = (evalValue / 100).toFixed(2);
                if (evalValue > 0) evalStr = '+' + evalStr;
                thought += ` | Оценка: ${evalStr}`;
            }
            UI.elements.engineThought.textContent = thought;
        }
        if (UI.elements.pvLine) {
            UI.elements.pvLine.textContent = pv ? `Вариант: ${pv}` : '';
        }
    }

    function addMoveToHistory(moveNumber, moveWhite, moveBlack) {
        if (!UI.elements.moveList) return;
        const div = document.createElement('div');
        div.className = 'move-entry';
        if (moveWhite && moveBlack) {
            div.innerHTML = `<span class="move-number">${moveNumber}.</span> <span class="move-white">${moveWhite}</span> <span class="move-black">${moveBlack}</span>`;
        } else if (moveWhite) {
            div.innerHTML = `<span class="move-number">${moveNumber}.</span> <span class="move-white">${moveWhite}</span>`;
        }
        UI.elements.moveList.appendChild(div);
        // Автоскролл вниз
        UI.elements.moveList.scrollTop = UI.elements.moveList.scrollHeight;
    }

    function clearMoveHistory() {
        if (UI.elements.moveList) UI.elements.moveList.innerHTML = '';
    }

    function showGameOverMessage(message, winner = null) {
        const titleElem = document.getElementById('game-over-title');
        const msgElem = document.getElementById('game-over-message');
        if (titleElem) titleElem.textContent = 'Игра окончена';
        if (msgElem) msgElem.textContent = message;
        openModal('gameOver');
    }

    function showToast(message, duration = 2000) {
        if (!UI.elements.toast) return;
        UI.elements.toast.textContent = message;
        UI.elements.toast.classList.add('show');
        if (UI.toastTimeout) clearTimeout(UI.toastTimeout);
        UI.toastTimeout = setTimeout(() => {
            UI.elements.toast.classList.remove('show');
        }, duration);
    }

    function setEngineStatus(active) {
        const led = UI.elements.engineStatus?.querySelector('.status-led');
        if (led) {
            led.style.backgroundColor = active ? '#2ecc71' : '#e74c3c';
        }
    }

    function setGameOver(over) {
        UI.gameOver = over;
        if (over) stopTimers();
    }

    function openPromotionModal() {
        openModal('promotion');
    }

    // ======================== Публичный API ========================
    window.UI = {
        init,
        updateTurnDisplay,
        updateEval,
        updateEngineInfo,
        addMoveToHistory,
        clearMoveHistory,
        showGameOverMessage,
        showToast,
        setEngineStatus,
        setGameOver,
        openPromotionModal,
        startTimers,
        stopTimers,
        setCallbacks: (callbacks) => {
            Object.assign(UI.callbacks, callbacks);
        },
        getSettings: () => window.BurchessSettings,
        refreshBoard: () => {
            // вызовется из board.js
            if (window.Board && typeof window.Board.draw === 'function') {
                window.Board.draw();
            }
        }
    };
})();
