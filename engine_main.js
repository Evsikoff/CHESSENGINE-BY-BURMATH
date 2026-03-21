/**
 * engine_main.js — главный модуль движка BURCHESS, объединяющий все компоненты
 * Версия: 2.0
 * 
 * Содержит:
 * - Класс BurchessEngine, связывающий UCI, поиск, оценку, таблицы, книгу
 * - Инициализацию всех подсистем
 * - Управление позицией и поиском
 * - Интеграцию с Web Worker
 * - Обработку UCI команд
 */

(function() {
    'use strict';

    class BurchessEngine {
        constructor() {
            // Подсистемы
            this.position = null;
            this.search = null;
            this.evaluator = null;
            this.tt = null;
            this.history = null;
            this.moveGen = null;
            this.openingBook = null;
            this.endgameTable = null;
            this.uci = null;
            this.threadPool = null;
            this.options = {
                SkillLevel: 15,
                MoveTime: 1000,
                Contempt: 0,
                Threads: 1,
                Hash: 16,
                OwnBook: true,
                Ponder: false
            };
            this.isSearching = false;
        }

        // Инициализация всех компонентов
        async init() {
            // Создаём экземпляры
            this.position = new window.BurchessPosition.Position();
            this.tt = new window.BurchessTT.TTManager();
            this.tt.init(this.options.Hash);
            this.history = new window.BurchessHistory.HeuristicsManager();
            this.evaluator = new window.BurchessEval.Evaluator();
            this.moveGen = new window.BurchessMoveGen.MoveGenerator();
            this.search = new window.BurchessSearch.Search();
            this.openingBook = new window.BurchessOpening.OpeningBook();
            this.endgameTable = new window.BurchessEndgame.EndgameTable();
            this.uci = new window.BurchessUCI.UCIHandler(this);
            this.threadPool = new window.BurchessThreads.ThreadPool(this.options.Threads);
            this.threadPool.init();

            // Инициализация подсистем
            this.search.init(this.tt, this.history, this.evaluator, this.moveGen);
            this.endgameTable.init();
            this.openingBook.loadBuiltin();

            // Установка начальной позиции
            this.position.fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

            console.log('[BurchessEngine] Initialized');
        }

        // Установка позиции
        setPosition(pos) {
            this.position = pos.clone();
        }

        // Получить FEN
        getFEN() {
            return this.position.toFEN();
        }

        // Установка опции
        setOption(name, value) {
            this.options[name] = value;
            if (name === 'Hash') {
                this.tt.resize(value);
            }
            if (name === 'SkillLevel') {
                // Влияет на глубину поиска
            }
            if (name === 'OwnBook') {
                this.openingBook.setEnabled(value);
            }
        }

        // Запуск поиска
        async startSearch(params) {
            if (this.isSearching) return;
            this.isSearching = true;

            // Проверка дебютной книги
            if (this.options.OwnBook) {
                const bookMove = this.openingBook.getBestMove(this.position.hash, this.position);
                if (bookMove) {
                    const move = this.parseUCIMove(bookMove);
                    if (move) {
                        this.uci.sendBestMove(bookMove);
                        this.isSearching = false;
                        return;
                    }
                }
            }

            // Проверка эндшпильных таблиц
            const tbResult = this.endgameTable.probe(this.position);
            if (tbResult && Math.abs(tbResult.win) === 1) {
                // Можно вернуть мат
                // В реальности нужно найти ход, ведущий к мату, здесь упрощённо
                const moves = this.moveGen.generateLegalMoves(this.position);
                if (moves.length) {
                    const best = moves[0];
                    this.uci.sendBestMove(best.toString());
                    this.isSearching = false;
                    return;
                }
            }

            // Определяем лимиты времени
            const timeParams = {
                movetime: params.movetime,
                wtime: params.wtime,
                btime: params.btime,
                winc: params.winc,
                binc: params.binc,
                depth: params.depth || this.options.SkillLevel,
                infinite: params.infinite,
                ponder: params.ponder
            };
            const depth = timeParams.depth;
            const timeMs = timeParams.movetime || (timeParams.wtime ? Math.min(timeParams.wtime / 40, 1000) : 1000);

            // Запуск поиска
            const result = await this.search.search(this.position, depth, timeMs);
            if (result && result.move) {
                const moveStr = result.move.toString();
                this.uci.sendBestMove(moveStr);
            } else {
                // fallback: любой легальный ход
                const moves = this.moveGen.generateLegalMoves(this.position);
                if (moves.length) {
                    this.uci.sendBestMove(moves[0].toString());
                }
            }

            this.isSearching = false;
        }

        // Остановка поиска
        stopSearch() {
            if (this.search) {
                this.search.stop = true;
            }
            this.isSearching = false;
        }

        // Обработка UCI команды (входная точка для worker)
        handleUCI(cmd) {
            if (this.uci) {
                this.uci.handleCommand(cmd);
            }
        }

        // Вспомогательные функции
        parseUCIMove(moveStr) {
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

        // Завершение работы
        quit() {
            if (this.threadPool) this.threadPool.terminate();
            if (typeof self !== 'undefined') self.close();
        }

        // Новая игра (сброс состояния)
        newGame() {
            this.position.fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
            this.tt.clear();
            this.history.reset();
            this.openingBook.setEnabled(this.options.OwnBook);
        }
    }

    // Экспорт
    window.BurchessEngine = BurchessEngine;
})();
