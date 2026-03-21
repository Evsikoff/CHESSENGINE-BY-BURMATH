(function(){
    const DEFAULTS = {
        skillLevel: 15,
        moveTime: 1000,
        playerColor: 'white',
        soundEnabled: true,
        showCoordinates: true,
        pieceStyle: 'merida',
        theme: 'light',
        boardSize: 600,
        animationSpeed: 250,
        showThinking: true,
        highlightLastMove: true,
        autoFlip: false,
        gameMode: 'normal',
        timeControl: '15+0',
        fenStart: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    };

    let current = { ...DEFAULTS };

    function load() {
        try {
            const stored = localStorage.getItem('burchess_settings');
            if (stored) {
                const parsed = JSON.parse(stored);
                current = { ...DEFAULTS, ...parsed };
            } else {
                current = { ...DEFAULTS };
            }
        } catch(e) {
            current = { ...DEFAULTS };
        }
        apply();
        return current;
    }

    function save() {
        try {
            localStorage.setItem('burchess_settings', JSON.stringify(current));
        } catch(e) {}
        apply();
    }

    function apply() {
        document.documentElement.setAttribute('data-theme', current.theme);
        if (window.Board && current.showCoordinates !== undefined) {
            window.Board.showCoordinates = current.showCoordinates;
            window.Board.draw();
        }
        if (window.Sound) window.Sound.setEnabled(current.soundEnabled);
        if (window.Animations) window.Animations.setDuration(current.animationSpeed);
    }

    function get(key) { return current[key]; }
    function set(key, value) { current[key] = value; save(); }
    function reset() { current = { ...DEFAULTS }; save(); }

    window.Settings = { load, save, get, set, reset, DEFAULTS };
    window.Settings.load();
})();
