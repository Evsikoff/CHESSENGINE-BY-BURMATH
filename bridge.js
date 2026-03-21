(function(){
    const Bridge = {
        worker: null,
        callbacks: {},
        pendingCommands: new Map(),
        commandId: 0,
        isReady: false,
        engineOptions: {
            SkillLevel: 15,
            MoveTime: 1000,
            Contempt: 0,
            Threads: 1,
            Hash: 16
        },
        currentFEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        isSearching: false,
        lastBestMove: null,
        lastInfo: null
    };

    function init(){
        if(Bridge.worker) return;
        try {
            Bridge.worker = new Worker('worker.js');
            Bridge.worker.onmessage = handleWorkerMessage;
            Bridge.worker.onerror = (e) => console.error('Worker error:', e);
            sendCommand('uci');
            setTimeout(() => {
                if(!Bridge.isReady) console.warn('Engine not ready');
            }, 2000);
        } catch(e){
            console.error('Failed to create worker:', e);
        }
    }

    function handleWorkerMessage(e){
        const msg = e.data;
        if(typeof msg === 'string'){
            parseUCIOutput(msg);
        } else if(msg && msg.type){
            switch(msg.type){
                case 'ready': Bridge.isReady = true; if(Bridge.callbacks.onReady) Bridge.callbacks.onReady(); break;
                case 'bestmove': handleBestMove(msg.move, msg.ponder); break;
                case 'info': handleInfo(msg); break;
                case 'error': console.error('Engine error:', msg.text); break;
            }
        }
    }

    function parseUCIOutput(line){
        if(line.startsWith('id name')) console.log('Engine:', line);
        else if(line.startsWith('uciok')) { Bridge.isReady = true; sendCommand('isready'); if(Bridge.callbacks.onReady) Bridge.callbacks.onReady(); }
        else if(line.startsWith('readyok')) { Bridge.isReady = true; if(Bridge.callbacks.onReady) Bridge.callbacks.onReady(); }
        else if(line.startsWith('bestmove')) {
            const parts = line.split(' ');
            const best = parts[1];
            const ponder = parts.length > 3 ? parts[3] : null;
            handleBestMove(best, ponder);
        }
        else if(line.startsWith('info')) parseInfo(line);
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

    function sendUCICommand(cmd){
        sendCommand(cmd);
    }

    function setPosition(fen, moves=[]){
        Bridge.currentFEN = fen;
        let cmd = `position fen ${fen}`;
        if(moves.length) cmd += ` moves ${moves.join(' ')}`;
        sendCommand(cmd);
    }

    function startSearch(options={}){
        if(Bridge.isSearching) return;
        Bridge.isSearching = true;
        let cmd = 'go';
        if(options.depth) cmd += ` depth ${options.depth}`;
        else if(options.movetime) cmd += ` movetime ${options.movetime}`;
        else if(options.wtime !== undefined && options.btime !== undefined){
            cmd += ` wtime ${options.wtime} btime ${options.btime}`;
            if(options.winc) cmd += ` winc ${options.winc}`;
            if(options.binc) cmd += ` binc ${options.binc}`;
        }
        else cmd += ` movetime ${Bridge.engineOptions.MoveTime}`;
        sendCommand(cmd);
    }

    function stopSearch(){
        if(Bridge.isSearching){
            sendCommand('stop');
            Bridge.isSearching = false;
        }
    }

    function setOption(name, value){
        Bridge.engineOptions[name] = value;
        sendCommand(`setoption name ${name} value ${value}`);
    }

    function initEngine(options={}){
        sendCommand('uci');
        setTimeout(() => {
            for(let [k,v] of Object.entries({...Bridge.engineOptions, ...options})){
                setOption(k, v);
            }
            sendCommand('isready');
        }, 100);
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
        initEngine,
        quit,
        setCallbacks,
        getInfo,
        isSearching,
        getLastBestMove,
        sendCommand: sendUCICommand,
        getEngineReady: () => Bridge.isReady
    };
})();
