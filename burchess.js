/**
 * burchess.js — загрузчик WASM модуля (заглушка)
 * Версия: 2.0
 * 
 * В реальном проекте здесь будет загрузка и инициализация WASM.
 * Для данной версии все компоненты реализованы в JS, поэтому этот файл просто заглушка.
 */

(function() {
    console.log('[Burchess WASM] Loading emulated (JS only)');
    // Эмуляция загрузки
    window.WASM_READY = true;
    if (window.BurchessEngine && typeof window.BurchessEngine === 'function') {
        // Можно передать управление
    }
})();
