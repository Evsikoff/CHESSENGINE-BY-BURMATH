(function(){
    const Bridge = {
        worker: null,
        callbacks: {},
        isReady: false,
        isSearching: false,
        lastBestMove: null,
        lastInfo: null
    };

    // URL к stockfish.wasm в облачном хранилище (замените на свой)
    const STOCKFISH_WASM_URL = 'https://storage.yandexcloud.net/demony/stockfish.wasm';

    const bridgeT0 = performance.now();
    const blogMsg = (msg) => console.log(`[Bridge +${((performance.now() - bridgeT0) / 1000).toFixed(1)}s] ${msg}`);

    function init(){
        if(Bridge.worker) return;
        try {
            blogMsg('Создаём Worker: engine/stockfish.js');
            Bridge.worker = new Worker('engine/stockfish.js#' + encodeURIComponent(STOCKFISH_WASM_URL));
            Bridge.worker.onmessage = handleWorkerMessage;
            Bridge.worker.onerror = (e) => {
                blogMsg('Worker ERROR: ' + (e.message || e));
                console.error('Worker error:', e);
            };
            Bridge.worker.onmessageerror = (e) => {
                blogMsg('Worker MESSAGE ERROR: ' + e);
            };
            blogMsg('Worker создан, отправляем "uci"');
            sendCommand('uci');
        } catch(e){
            blogMsg('ИСКЛЮЧЕНИЕ при создании Worker: ' + e.message);
            console.error('Failed to create worker:', e);
        }
    }

    function handleWorkerMessage(e){
        const msg = e.data;
        blogMsg('Worker → ' + (typeof msg === 'string' ? msg.substring(0, 120) : JSON.stringify(msg)));
        if(typeof msg === 'string'){
            parseUCIOutput(msg);
        }
    }

    function parseUCIOutput(line){
        if(line.startsWith('uciok')) {
            blogMsg('Получен uciok — wasm загружен, движок инициализирован');
            // Настраиваем Stockfish на максимальную силу
            sendCommand('setoption name Skill Level value 20');
            sendCommand('setoption name Threads value 1');
            sendCommand('setoption name Hash value 32');
            sendCommand('setoption name Ponder value false');
            blogMsg('Опции установлены, отправляем "isready"');
            sendCommand('isready');
        }
        else if(line.startsWith('readyok')) {
            blogMsg('Получен readyok — движок полностью готов');
            Bridge.isReady = true;
            if(Bridge.callbacks.onReady) Bridge.callbacks.onReady();
        }
        else if(line.startsWith('bestmove')) {
            const parts = line.split(' ');
            const best = parts[1];
            const ponder = parts.length > 3 ? parts[3] : null;
            handleBestMove(best, ponder);
        }
        else if(line.startsWith('info') && line.includes('depth')) {
            parseInfo(line);
        }
    }

    function parseInfo(line){
        const info = { depth:0, score:0, mate:null, nodes:0, nps:0, time:0, pv:[] };
        const tokens = line.split(' ');
        for(let i=0; i<tokens.length; i++){
            const t = tokens[i];
            if(t === 'depth') info.depth = parseInt(tokens[++i]);
            else if(t === 'score'){
                const type = tokens[++i];
                if(type === 'cp') info.score = parseInt(tokens[++i]);
                else if(type === 'mate') info.mate = parseInt(tokens[++i]);
            }
            else if(t === 'nodes') info.nodes = parseInt(tokens[++i]);
            else if(t === 'nps') info.nps = parseInt(tokens[++i]);
            else if(t === 'time') info.time = parseInt(tokens[++i]);
            else if(t === 'pv') {
                info.pv = [];
                while(++i < tokens.length) info.pv.push(tokens[i]);
                break;
            }
        }
        Bridge.lastInfo = info;
        if(Bridge.callbacks.onInfo) Bridge.callbacks.onInfo(info);
    }

    function handleBestMove(move, ponder){
        Bridge.isSearching = false;
        Bridge.lastBestMove = move;
        if(Bridge.callbacks.onBestMove) Bridge.callbacks.onBestMove(move, ponder);
    }

    function sendCommand(cmd){
        if(Bridge.worker) Bridge.worker.postMessage(cmd);
    }

    function setPosition(fen, moves){
        let cmd = 'position fen ' + fen;
        if(moves && moves.length) cmd += ' moves ' + moves.join(' ');
        sendCommand(cmd);
    }

    function startSearch(options){
        if(Bridge.isSearching) return;
        Bridge.isSearching = true;
        let cmd = 'go';
        if(options.wtime !== undefined && options.btime !== undefined){
            cmd += ' wtime ' + options.wtime + ' btime ' + options.btime;
            if(options.winc) cmd += ' winc ' + options.winc;
            if(options.binc) cmd += ' binc ' + options.binc;
        } else if(options.depth) {
            cmd += ' depth ' + options.depth;
        } else if(options.movetime) {
            cmd += ' movetime ' + options.movetime;
        } else {
            cmd += ' movetime 2000';
        }
        sendCommand(cmd);
    }

    function stopSearch(){
        if(Bridge.isSearching){
            sendCommand('stop');
            Bridge.isSearching = false;
        }
    }

    function setOption(name, value){
        sendCommand('setoption name ' + name + ' value ' + value);
    }

    function quit(){
        if(Bridge.worker){
            sendCommand('quit');
            Bridge.worker.terminate();
            Bridge.worker = null;
        }
    }

    function setCallbacks(cbs){
        Bridge.callbacks = { ...Bridge.callbacks, ...cbs };
    }

    function getInfo(){ return Bridge.lastInfo; }
    function isSearching(){ return Bridge.isSearching; }
    function getLastBestMove(){ return Bridge.lastBestMove; }

    window.Bridge = {
        init,
        setPosition,
        startSearch,
        stopSearch,
        setOption,
        quit,
        setCallbacks,
        getInfo,
        isSearching,
        getLastBestMove,
        sendCommand,
        getEngineReady: () => Bridge.isReady
    };
})();
