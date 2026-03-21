/**
 * engine_bench.js — бенчмаркинг и тестирование производительности BURCHESS
 * Версия: 2.0
 * 
 * Содержит:
 * - Функции для запуска бенчмарков (фиксированные позиции, глубина)
 * - Подсчёт узлов в секунду (NPS)
 * - Тестирование генерации ходов, оценки, поиска
 * - Сравнение с эталонными результатами
 * - Логирование и экспорт результатов
 * - Автоматическое определение оптимальных настроек
 */

(function() {
    'use strict';

    // ======================== Тестовые позиции ========================
    const BENCH_POSITIONS = [
        { fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", depth: 5, expectedNodes: 4865609 },
        { fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", depth: 5, expectedNodes: 1938120 },
        { fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", depth: 5, expectedNodes: 324988 },
        { fen: "r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1", depth: 5, expectedNodes: 1883100 },
        { fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", depth: 5, expectedNodes: 1200400 },
        { fen: "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", depth: 5, expectedNodes: 1068760 }
    ];

    // ======================== Класс Benchmark ========================
    class Benchmark {
        constructor(engine) {
            this.engine = engine;      // ссылка на движок (должен содержать search метод)
            this.results = [];
        }

        // Запуск бенчмарка на одной позиции
        async runSingle(position, depth, timeLimit = 0) {
            const start = performance.now();
            let nodes = 0;
            let move = null;
            let score = 0;
            
            // Сохраняем оригинальные функции подсчёта узлов
            const originalNodes = this.engine.nodes;
            this.engine.nodes = 0;
            
            // Запускаем поиск
            const result = await this.engine.search(position, depth, timeLimit);
            nodes = this.engine.nodes;
            move = result.move;
            score = result.score;
            
            const elapsed = performance.now() - start;
            const nps = nodes / (elapsed / 1000);
            
            this.engine.nodes = originalNodes;
            
            return { depth, nodes, nps, elapsed, move, score };
        }

        // Запуск всех бенчмарков
        async runAll(depth = 5, verbose = true) {
            this.results = [];
            for (const pos of BENCH_POSITIONS) {
                const benchDepth = depth || pos.depth;
                if (verbose) console.log(`Benchmarking: ${pos.fen.substring(0, 40)}... depth ${benchDepth}`);
                const result = await this.runSingle(pos.fen, benchDepth);
                result.fen = pos.fen;
                result.expectedNodes = pos.expectedNodes;
                result.errorPercent = ((result.nodes - pos.expectedNodes) / pos.expectedNodes * 100).toFixed(2);
                this.results.push(result);
                if (verbose) {
                    console.log(`  Nodes: ${result.nodes} (${result.errorPercent}% vs expected)`);
                    console.log(`  NPS: ${Math.floor(result.nps)}`);
                    console.log(`  Time: ${result.elapsed.toFixed(2)}ms`);
                }
            }
            return this.results;
        }

        // Тест скорости генерации ходов
        testMoveGeneration(positions = BENCH_POSITIONS.slice(0, 3)) {
            const results = [];
            for (const pos of positions) {
                const start = performance.now();
                let totalMoves = 0;
                const position = new window.BurchessPosition.Position();
                position.fromFEN(pos.fen);
                const mg = new window.BurchessMoveGen.MoveGenerator();
                for (let i = 0; i < 100; i++) {
                    const moves = mg.generateLegalMoves(position);
                    totalMoves += moves.length;
                }
                const elapsed = performance.now() - start;
                results.push({
                    fen: pos.fen,
                    movesPerSec: (totalMoves * 1000 / elapsed).toFixed(0),
                    avgMoves: totalMoves / 100
                });
            }
            return results;
        }

        // Тест скорости оценки
        testEvaluation(positions = BENCH_POSITIONS.slice(0, 3), iterations = 1000) {
            const results = [];
            const evaluator = new window.BurchessEval.Evaluator();
            for (const pos of positions) {
                const position = new window.BurchessPosition.Position();
                position.fromFEN(pos.fen);
                const start = performance.now();
                let totalEval = 0;
                for (let i = 0; i < iterations; i++) {
                    totalEval += evaluator.evaluate(position);
                }
                const elapsed = performance.now() - start;
                results.push({
                    fen: pos.fen,
                    evalsPerSec: (iterations * 1000 / elapsed).toFixed(0),
                    avgEval: totalEval / iterations
                });
            }
            return results;
        }

        // Вывод отчёта
        printReport() {
            console.log("\n=== BURCHESS BENCHMARK REPORT ===");
            console.log("Positions tested:", this.results.length);
            let totalNodes = 0, totalTime = 0;
            for (const r of this.results) {
                totalNodes += r.nodes;
                totalTime += r.elapsed;
                console.log(`FEN: ${r.fen.substring(0, 30)}... | Nodes: ${r.nodes} | NPS: ${Math.floor(r.nps)} | Time: ${r.elapsed.toFixed(2)}ms`);
            }
            console.log(`\nTotal nodes: ${totalNodes}`);
            console.log(`Total time: ${totalTime.toFixed(2)}ms`);
            console.log(`Average NPS: ${Math.floor(totalNodes / (totalTime / 1000))}`);
        }

        // Автоопределение оптимальной глубины для заданного времени
        async findOptimalDepth(position, targetTimeMs = 1000) {
            let depth = 1;
            let lastTime = 0;
            while (true) {
                const start = performance.now();
                await this.engine.search(position, depth, 0);
                const elapsed = performance.now() - start;
                if (elapsed > targetTimeMs && depth > 1) {
                    return depth - 1;
                }
                if (elapsed > targetTimeMs * 2) return depth - 1;
                lastTime = elapsed;
                depth++;
                if (depth > 20) break;
            }
            return depth;
        }

        // Сравнение с эталоном
        compareWithBaseline(baselineUrl) {
            // В реальном проекте можно загрузить эталонные данные
            console.log("Comparison with baseline not implemented");
        }
    }

    // ======================== Экспорт ========================
    window.BurchessBench = {
        Benchmark,
        BENCH_POSITIONS
    };
})();
