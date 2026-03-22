/**
 * UI.js — управление пользовательским интерфейсом BURCHESS
 * Версия: 3.0
 */

(function() {
    'use strict';

    const UI = {
        elements: {},
        isDarkTheme: false,
        isFullscreen: false,
        timers: {
            white: null,
            black: null,
            whiteTime: 15 * 60,
            blackTime: 15 * 60,
            active: false
        },
        callbacks: {
            onNewGame: null,
            onUndo: null,
            onHint: null,
            onFlipBoard: null,
            onSettingsChange: null,
            onPromotion: null
        },
        currentTurn: 'white',
        gameOver: false,
        toastTimeout: null
    };

    function init() {
        cacheElements();
        attachEventListeners();
        loadSettings();
        applyTheme();
        updateTurnDisplay('white');
        updateTimersDisplay();
        setupModalClosers();
    }

    function cacheElements() {
        var e = UI.elements;
        e.app = document.querySelector('.app');
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

        e.settingsModal = document.getElementById('settings-modal');
        e.promotionModal = document.getElementById('promotion-modal');
        e.gameOverModal = document.getElementById('game-over-modal');
        e.toast = document.getElementById('toast-message');

        e.playerColor = document.getElementById('player-color');
        e.gameTime = document.getElementById('game-time');
        e.soundToggle = document.getElementById('sound-toggle');
        e.showCoordinates = document.getElementById('show-coordinates');
        e.saveSettings = document.getElementById('save-settings');
        e.resetDefaults = document.getElementById('reset-defaults');

        e.promotionBtns = document.querySelectorAll('.promo-btn');
        e.gameOverNewGame = document.getElementById('game-over-new-game');
        e.engineStatus = document.getElementById('engine-status');
    }

    function attachEventListeners() {
        var e = UI.elements;
        if (e.flipBoardBtn) e.flipBoardBtn.addEventListener('click', function() { if (UI.callbacks.onFlipBoard) UI.callbacks.onFlipBoard(); });
        if (e.undoBtn) e.undoBtn.addEventListener('click', function() { if (UI.callbacks.onUndo) UI.callbacks.onUndo(); });
        if (e.newGameBtn) e.newGameBtn.addEventListener('click', function() { if (UI.callbacks.onNewGame) UI.callbacks.onNewGame(); });
        if (e.settingsBtn) e.settingsBtn.addEventListener('click', function() { openModal('settings'); });
        if (e.hintBtn) e.hintBtn.addEventListener('click', function() { if (UI.callbacks.onHint) UI.callbacks.onHint(); });
        if (e.fullscreenBtn) e.fullscreenBtn.addEventListener('click', toggleFullscreen);
        if (e.themeToggle) e.themeToggle.addEventListener('click', toggleTheme);
        if (e.clearHistoryBtn) e.clearHistoryBtn.addEventListener('click', clearMoveHistory);
        if (e.saveSettings) e.saveSettings.addEventListener('click', saveSettings);
        if (e.resetDefaults) e.resetDefaults.addEventListener('click', resetSettings);
        if (e.gameOverNewGame) e.gameOverNewGame.addEventListener('click', function() {
            closeModal('gameOver');
            if (UI.callbacks.onNewGame) UI.callbacks.onNewGame();
        });

        e.promotionBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var piece = btn.getAttribute('data-piece');
                if (UI.callbacks.onPromotion) UI.callbacks.onPromotion(piece);
                closeModal('promotion');
            });
        });

        var modals = ['settings', 'promotion', 'gameOver'];
        modals.forEach(function(modal) {
            var modalElement = UI.elements[modal + 'Modal'];
            if (modalElement) {
                var closeBtn = modalElement.querySelector('.close');
                if (closeBtn) closeBtn.addEventListener('click', function() { closeModal(modal); });
                modalElement.addEventListener('click', function(ev) {
                    if (ev.target === modalElement) closeModal(modal);
                });
            }
        });
    }

    function openModal(modalName) {
        var modal = UI.elements[modalName + 'Modal'];
        if (modal) modal.style.display = 'flex';
    }

    function closeModal(modalName) {
        var modal = UI.elements[modalName + 'Modal'];
        if (modal) modal.style.display = 'none';
    }

    function setupModalClosers() {
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeModal('settings');
                closeModal('promotion');
                closeModal('gameOver');
            }
        });
    }

    // ======================== Настройки ========================
    function loadSettings() {
        var defaults = {
            playerColor: 'white',
            gameTime: 15,
            soundEnabled: true,
            showCoordinates: true,
            theme: 'light'
        };
        var settings;
        try {
            var stored = localStorage.getItem('burchess_settings');
            if (stored) {
                settings = JSON.parse(stored);
                settings = Object.assign({}, defaults, settings);
            } else {
                settings = Object.assign({}, defaults);
            }
        } catch(e) {
            settings = Object.assign({}, defaults);
        }

        if (UI.elements.playerColor) UI.elements.playerColor.value = settings.playerColor;
        if (UI.elements.gameTime) UI.elements.gameTime.value = settings.gameTime || 15;
        if (UI.elements.soundToggle) UI.elements.soundToggle.checked = settings.soundEnabled;
        if (UI.elements.showCoordinates) UI.elements.showCoordinates.checked = settings.showCoordinates;

        UI.isDarkTheme = (settings.theme === 'dark');
        if (UI.isDarkTheme) document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');

        window.BurchessSettings = settings;
    }

    function saveSettings() {
        var settings = {
            playerColor: UI.elements.playerColor ? UI.elements.playerColor.value : 'white',
            gameTime: UI.elements.gameTime ? parseInt(UI.elements.gameTime.value) : 15,
            soundEnabled: UI.elements.soundToggle ? UI.elements.soundToggle.checked : true,
            showCoordinates: UI.elements.showCoordinates ? UI.elements.showCoordinates.checked : true,
            theme: UI.isDarkTheme ? 'dark' : 'light'
        };
        localStorage.setItem('burchess_settings', JSON.stringify(settings));
        window.BurchessSettings = settings;
        closeModal('settings');
        showToast('Настройки сохранены', 2000);
        if (UI.callbacks.onSettingsChange) UI.callbacks.onSettingsChange(settings);
    }

    function resetSettings() {
        if (UI.elements.playerColor) UI.elements.playerColor.value = 'white';
        if (UI.elements.gameTime) UI.elements.gameTime.value = 15;
        if (UI.elements.soundToggle) UI.elements.soundToggle.checked = true;
        if (UI.elements.showCoordinates) UI.elements.showCoordinates.checked = true;
        showToast('Настройки сброшены', 1500);
    }

    // ======================== Тема ========================
    function applyTheme() {
        if (UI.isDarkTheme) {
            document.documentElement.setAttribute('data-theme', 'dark');
            if (UI.elements.themeToggle) UI.elements.themeToggle.textContent = '☀️';
        } else {
            document.documentElement.removeAttribute('data-theme');
            if (UI.elements.themeToggle) UI.elements.themeToggle.textContent = '🌙';
        }
    }

    function toggleTheme() {
        UI.isDarkTheme = !UI.isDarkTheme;
        applyTheme();
        if (window.BurchessSettings) {
            window.BurchessSettings.theme = UI.isDarkTheme ? 'dark' : 'light';
            try {
                localStorage.setItem('burchess_settings', JSON.stringify(window.BurchessSettings));
            } catch(e) {}
        }
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(function() {});
            UI.isFullscreen = true;
            if (UI.elements.fullscreenBtn) UI.elements.fullscreenBtn.textContent = '✕';
        } else {
            document.exitFullscreen();
            UI.isFullscreen = false;
            if (UI.elements.fullscreenBtn) UI.elements.fullscreenBtn.textContent = '⛶';
        }
    }

    document.addEventListener('fullscreenchange', function() {
        UI.isFullscreen = !!document.fullscreenElement;
        if (UI.elements.fullscreenBtn) {
            UI.elements.fullscreenBtn.textContent = UI.isFullscreen ? '✕' : '⛶';
        }
    });

    // ======================== Таймеры ========================
    function startTimers() {
        stopTimers();
        UI.timers.active = true;
        var gameTime = (window.BurchessSettings && window.BurchessSettings.gameTime) || 15;
        UI.timers.whiteTime = gameTime * 60;
        UI.timers.blackTime = gameTime * 60;
        updateTimersDisplay();
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
        stopTimers();
        UI.timers.active = true;
        var color = UI.currentTurn;
        var interval = setInterval(function() {
            if (!UI.timers.active || UI.gameOver) {
                clearInterval(interval);
                return;
            }
            if (color === 'white') {
                if (UI.timers.whiteTime <= 0) {
                    onTimeOut('white');
                    clearInterval(interval);
                    return;
                }
                UI.timers.whiteTime--;
            } else {
                if (UI.timers.blackTime <= 0) {
                    onTimeOut('black');
                    clearInterval(interval);
                    return;
                }
                UI.timers.blackTime--;
            }
            updateTimersDisplay();
        }, 1000);
        if (color === 'white') UI.timers.white = interval;
        else UI.timers.black = interval;
    }

    function updateTimersDisplay() {
        if (UI.elements.whiteTimer) UI.elements.whiteTimer.textContent = formatTime(UI.timers.whiteTime);
        if (UI.elements.blackTimer) UI.elements.blackTimer.textContent = formatTime(UI.timers.blackTime);
    }

    function formatTime(seconds) {
        var mins = Math.floor(seconds / 60);
        var secs = seconds % 60;
        return (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
    }

    function onTimeOut(color) {
        UI.gameOver = true;
        UI.timers.active = false;
        stopTimers();
        var winner = color === 'white' ? 'Чёрные' : 'Белые';
        showGameOverMessage(winner + ' выиграли по времени!');
    }

    // ======================== Статус ========================
    function updateTurnDisplay(turn) {
        UI.currentTurn = turn;
        if (UI.elements.turnText) {
            UI.elements.turnText.textContent = turn === 'white' ? 'Ход белых' : 'Ход чёрных';
        }
        if (UI.elements.turnPiece) {
            UI.elements.turnPiece.textContent = turn === 'white' ? '♔' : '♚';
        }
        if (UI.timers.active && !UI.gameOver) {
            startActiveTimer();
        }
    }

    function updateEngineInfo(depth, nodes, nps, pv, bestMove, evalValue) {
        if (UI.elements.depthBadge) UI.elements.depthBadge.textContent = 'Глубина: ' + depth;
        if (UI.elements.nodesCount) UI.elements.nodesCount.textContent = 'Узлов: ' + (nodes ? nodes.toLocaleString() : '0');
        if (UI.elements.nps) UI.elements.nps.textContent = 'NPS: ' + (nps ? nps.toLocaleString() : '0');
        if (UI.elements.engineThought) {
            var thought = bestMove ? ('Лучший ход: ' + bestMove) : 'Анализ...';
            if (evalValue !== undefined) {
                var evalStr;
                if (Math.abs(evalValue) >= 10000) {
                    var mate = Math.round(evalValue / 10000);
                    evalStr = (mate > 0 ? '#' : '-#') + Math.abs(mate);
                } else {
                    evalStr = (evalValue / 100).toFixed(2);
                    if (evalValue > 0) evalStr = '+' + evalStr;
                }
                thought += ' | Оценка: ' + evalStr;
            }
            UI.elements.engineThought.textContent = thought;
        }
        if (UI.elements.pvLine) {
            UI.elements.pvLine.textContent = pv ? ('Вариант: ' + pv) : '';
        }
        // Обновляем шкалу оценки
        if (evalValue !== undefined) {
            var percent = Math.min(100, Math.max(0, 50 + (evalValue / 500) * 50));
            if (UI.elements.evalFill) UI.elements.evalFill.style.width = percent + '%';
            if (UI.elements.evalNumeric) {
                var displayVal;
                if (Math.abs(evalValue) >= 10000) {
                    var m = Math.round(evalValue / 10000);
                    displayVal = (m > 0 ? '#' : '-#') + Math.abs(m);
                } else {
                    displayVal = (evalValue / 100).toFixed(2);
                    if (evalValue > 0) displayVal = '+' + displayVal;
                }
                UI.elements.evalNumeric.textContent = displayVal;
            }
        }
    }

    function clearMoveHistory() {
        if (UI.elements.moveList) UI.elements.moveList.innerHTML = '';
    }

    function showGameOverMessage(message) {
        var titleElem = document.getElementById('game-over-title');
        var msgElem = document.getElementById('game-over-message');
        if (titleElem) titleElem.textContent = 'Игра окончена';
        if (msgElem) msgElem.textContent = message;
        openModal('gameOver');
    }

    function showToast(message, duration) {
        duration = duration || 2000;
        if (!UI.elements.toast) return;
        UI.elements.toast.textContent = message;
        UI.elements.toast.classList.add('show');
        if (UI.toastTimeout) clearTimeout(UI.toastTimeout);
        UI.toastTimeout = setTimeout(function() {
            UI.elements.toast.classList.remove('show');
        }, duration);
    }

    function setEngineStatus(active) {
        var led = UI.elements.engineStatus ? UI.elements.engineStatus.querySelector('.status-led') : null;
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
        init: init,
        updateTurnDisplay: updateTurnDisplay,
        updateEngineInfo: updateEngineInfo,
        clearMoveHistory: clearMoveHistory,
        showGameOverMessage: showGameOverMessage,
        showToast: showToast,
        setEngineStatus: setEngineStatus,
        setGameOver: setGameOver,
        openPromotionModal: openPromotionModal,
        startTimers: startTimers,
        stopTimers: stopTimers,
        setCallbacks: function(callbacks) {
            Object.assign(UI.callbacks, callbacks);
        },
        getSettings: function() { return window.BurchessSettings; },
        refreshBoard: function() {},
        // Геттеры для таймеров (используются в game.js для передачи времени Stockfish)
        getWhiteTime: function() { return UI.timers.whiteTime; },
        getBlackTime: function() { return UI.timers.blackTime; }
    };
})();
