/**
 * engine_uci.js — обработка UCI протокола для BURCHESS
 * Версия: 2.0
 * 
 * Содержит:
 * - Парсер UCI команд
 * - Управление позицией (position)
 * - Настройка опций (setoption)
 * - Запуск поиска (go)
 * - Генерация вывода info и bestmove
 * - Поддержка всех стандартных UCI команд
 * - Обработка команд от UI через worker
 */

(function() {
    'use strict';

    class UCIHandler {
        constructor(engine) {
            this.engine = engine;        // экземпляр движка (BurchessEngine)
            this.position = null;        // текущая позиция
            this.options = {
                SkillLevel: 15,
                MoveTime: 1000,
                Contempt: 0,
                Threads: 1,
                Hash: 16,
                OwnBook: true,
                Ponder: false
            };
            this.isReady = false;
        }

        // Обработка входящей строки
        handleCommand(line) {
            const cmd = line.trim();
            if (cmd === 'uci') {
                this.sendUCI();
            } else if (cmd === 'isready') {
                this.sendReady();
            } else if (cmd.startsWith('setoption')) {
                this.setOption(cmd);
            } else if (cmd.startsWith('position')) {
                this.setPosition(cmd);
            } else if (cmd.startsWith('go')) {
                this.go(cmd);
            } else if (cmd === 'stop') {
                this.stop();
            } else if (cmd === 'quit') {
                this.quit();
            } else if (cmd === 'ucinewgame') {
                this.newGame();
            } else {
                console.warn('Unknown UCI command:', cmd);
            }
        }

        sendUCI() {
            this.sendLine('id name BURCHESS v2.0');
            this.sendLine('id author BURCHESS Team');
            this.sendLine('option name SkillLevel type spin default 15 min 1 max 20');
            this.sendLine('option name MoveTime type spin default 1000 min 100 max 10000');
            this.sendLine('option name Contempt type spin default 0 min -100 max 100');
            this.sendLine('option name Threads type spin default 1 min 1 max 1');
            this.sendLine('option name Hash type spin default 16 min 1 max 256');
            this.sendLine('option name OwnBook type check default true');
            this.sendLine('option name Ponder type check default false');
            this.sendLine('uciok');
        }

        sendReady() {
            this.isReady = true;
            this.sendLine('readyok');
        }

        setOption(cmd) {
            const parts = cmd.split(' ');
            const nameIdx = parts.indexOf('name') + 1;
            const valueIdx = parts.indexOf('value') + 1;
            if (nameIdx > 0 && nameIdx < parts.length) {
                const name = parts[nameIdx];
                if (valueIdx > 0 && valueIdx < parts.length) {
                    const value = parts[valueIdx];
                    this.options[name] = this.parseOptionValue(value);
                } else {
                    this.options[name] = true;
                }
                // Применить опцию к движку
                if (this.engine && this.engine.setOption) {
                    this.engine.setOption(name, this.options[name]);
                }
            }
        }

        parseOptionValue(value) {
            if (value === 'true') return true;
            if (value === 'false') return false;
            const num = parseInt(value);
            return isNaN(num) ? value : num;
        }

        setPosition(cmd) {
            let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            let moves = [];
            const fenStart = cmd.indexOf('fen');
            if (fenStart !== -1) {
                const afterFen = cmd.substring(fenStart + 4);
                const movesStart = afterFen.indexOf('moves');
                if (movesStart !== -1) {
                    fen = afterFen.substring(0, movesStart).trim();
                    const movesStr = afterFen.substring(movesStart + 6).trim();
                    if (movesStr) moves = movesStr.split(' ');
                } else {
                    fen = afterFen.trim();
                }
            } else {
                const movesStart = cmd.indexOf('moves');
                if (movesStart !== -1) {
                    const movesStr = cmd.substring(movesStart + 6).trim();
                    if (movesStr) moves = movesStr.split(' ');
                }
            }
            // Создаём позицию из FEN
            this.position = new window.BurchessPosition.Position();
            this.position.fromFEN(fen);
            // Применяем ходы
            for (const moveStr of moves) {
                const move = this.parseMove(moveStr);
                if (move) {
                    const state = {};
                    this.position.makeMove(move, state);
                }
            }
            // Сохраняем в движке
            if (this.engine && this.engine.setPosition) {
                this.engine.setPosition(this.position);
            }
        }

        parseMove(moveStr) {
            if (moveStr.length < 4) return null;
            const fromFile = moveStr.charCodeAt(0) - 97;
            const fromRank = 8 - parseInt(moveStr[1]);
            const toFile = moveStr.charCodeAt(2) - 97;
            const toRank = 8 - parseInt(moveStr[3]);
            const from = fromRank * 8 + fromFile;
            const to = toRank * 8 + toFile;
            let promotion = null;
            if (moveStr.length === 5) promotion = moveStr[4];
            return { from, to, promotion, flags: promotion ? 4 : 0 };
        }

        go(cmd) {
            const params = {};
            const tokens = cmd.split(' ');
            for (let i = 1; i < tokens.length; i++) {
                const token = tokens[i];
                if (token === 'depth') {
                    params.depth = parseInt(tokens[++i]);
                } else if (token === 'movetime') {
                    params.movetime = parseInt(tokens[++i]);
                } else if (token === 'wtime') {
                    params.wtime = parseInt(tokens[++i]);
                } else if (token === 'btime') {
                    params.btime = parseInt(tokens[++i]);
                } else if (token === 'winc') {
                    params.winc = parseInt(tokens[++i]);
                } else if (token === 'binc') {
                    params.binc = parseInt(tokens[++i]);
                } else if (token === 'movestogo') {
                    params.movestogo = parseInt(tokens[++i]);
                } else if (token === 'infinite') {
                    params.infinite = true;
                } else if (token === 'ponder') {
                    params.ponder = true;
                }
            }
            if (this.engine && this.engine.startSearch) {
                this.engine.startSearch(params);
            }
        }

        stop() {
            if (this.engine && this.engine.stopSearch) {
                this.engine.stopSearch();
            }
        }

        quit() {
            if (this.engine && this.engine.quit) {
                this.engine.quit();
            }
            if (typeof self !== 'undefined') self.close();
        }

        newGame() {
            if (this.engine && this.engine.newGame) {
                this.engine.newGame();
            }
        }

        sendLine(line) {
            if (typeof postMessage !== 'undefined') {
                postMessage(line);
            } else if (typeof console !== 'undefined') {
                console.log(line);
            }
        }

        // Вывод информации из поиска
        sendInfo(info) {
            let line = 'info';
            if (info.depth) line += ` depth ${info.depth}`;
            if (info.score !== undefined) line += ` score cp ${info.score}`;
            if (info.nodes) line += ` nodes ${info.nodes}`;
            if (info.nps) line += ` nps ${info.nps}`;
            if (info.time) line += ` time ${info.time}`;
            if (info.pv) line += ` pv ${info.pv.join(' ')}`;
            this.sendLine(line);
        }

        sendBestMove(move, ponder = null) {
            let line = `bestmove ${move}`;
            if (ponder) line += ` ponder ${ponder}`;
            this.sendLine(line);
        }
    }

    window.BurchessUCI = {
        UCIHandler
    };
})();
