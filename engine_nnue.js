/**
 * engine_nnue.js — нейросетевая оценка позиции (NNUE) для BURCHESS
 * Версия: 2.0
 * 
 * Содержит:
 * - Реализацию NNUE (Efficiently Updatable Neural Network) для оценки позиций
 * - Архитектура: два входа (белые фигуры, чёрные фигуры) -> два слоя -> выход
 * - Функции для обновления нейросети при изменении позиции (incremental update)
 * - Загрузка весов из бинарного файла или встроенных
 * - Конвертация позиции в разреженное представление
 * - Нормализация выходного значения в сотые пешки
 */

(function() {
    'use strict';

    // ======================== Константы архитектуры ========================
    // Архитектура HalfKP: 64 * 64 * 6 * 2 = 49152 входных нейронов (упрощённо)
    // Для экономии памяти используем уменьшенную версию
    const NBUCKETS = 8;          // количество бакетов по фазе игры
    const INPUT_DIM = 2048;      // входное измерение (уменьшено для производительности)
    const HIDDEN_DIM = 256;      // скрытый слой
    const OUTPUT_DIM = 1;        // выход (оценка)
    
    // ======================== Класс NNUE ========================
    class NNUE {
        constructor() {
            this.inputWeights = null;      // [INPUT_DIM][HIDDEN_DIM] (веса от входов к скрытому)
            this.hiddenBiases = null;      // [HIDDEN_DIM]
            this.outputWeights = null;      // [HIDDEN_DIM][OUTPUT_DIM]
            this.outputBias = 0;
            this.accumulator = null;        // [2][HIDDEN_DIM] для белых и чёрных
            this.accumulatorWhite = null;
            this.accumulatorBlack = null;
            this.initialized = false;
            this.bucket = 0;
        }

        // Инициализация весов (встроенными или из файла)
        async init(weightsUrl = null) {
            if (weightsUrl) {
                await this.loadWeights(weightsUrl);
            } else {
                this.initRandomWeights();
            }
            this.initialized = true;
            console.log('[NNUE] Initialized with architecture', INPUT_DIM, HIDDEN_DIM);
        }

        initRandomWeights() {
            // Инициализация случайными весами (необученная сеть)
            this.inputWeights = new Array(INPUT_DIM);
            for (let i = 0; i < INPUT_DIM; i++) {
                this.inputWeights[i] = new Array(HIDDEN_DIM);
                for (let j = 0; j < HIDDEN_DIM; j++) {
                    this.inputWeights[i][j] = (Math.random() - 0.5) / Math.sqrt(INPUT_DIM);
                }
            }
            this.hiddenBiases = new Array(HIDDEN_DIM);
            for (let j = 0; j < HIDDEN_DIM; j++) {
                this.hiddenBiases[j] = 0;
            }
            this.outputWeights = new Array(HIDDEN_DIM);
            for (let j = 0; j < HIDDEN_DIM; j++) {
                this.outputWeights[j] = (Math.random() - 0.5) / Math.sqrt(HIDDEN_DIM);
            }
            this.outputBias = 0;
        }

        async loadWeights(url) {
            try {
                const response = await fetch(url);
                const buffer = await response.arrayBuffer();
                const data = new Float32Array(buffer);
                // Простой формат: сначала inputWeights, hiddenBiases, outputWeights, outputBias
                let offset = 0;
                const inputSize = INPUT_DIM * HIDDEN_DIM;
                this.inputWeights = new Array(INPUT_DIM);
                for (let i = 0; i < INPUT_DIM; i++) {
                    this.inputWeights[i] = new Array(HIDDEN_DIM);
                    for (let j = 0; j < HIDDEN_DIM; j++) {
                        this.inputWeights[i][j] = data[offset++];
                    }
                }
                this.hiddenBiases = new Array(HIDDEN_DIM);
                for (let j = 0; j < HIDDEN_DIM; j++) {
                    this.hiddenBiases[j] = data[offset++];
                }
                this.outputWeights = new Array(HIDDEN_DIM);
                for (let j = 0; j < HIDDEN_DIM; j++) {
                    this.outputWeights[j] = data[offset++];
                }
                this.outputBias = data[offset++];
                console.log('[NNUE] Weights loaded from', url);
            } catch(e) {
                console.error('[NNUE] Failed to load weights', e);
                this.initRandomWeights();
            }
        }

        // Подготовка аккумулятора для позиции
        prepare(pos) {
            this.accumulatorWhite = new Array(HIDDEN_DIM).fill(0);
            this.accumulatorBlack = new Array(HIDDEN_DIM).fill(0);
            // Заполняем biases
            for (let j = 0; j < HIDDEN_DIM; j++) {
                this.accumulatorWhite[j] = this.hiddenBiases[j];
                this.accumulatorBlack[j] = this.hiddenBiases[j];
            }
            // Добавляем веса для всех фигур
            const features = this.extractFeatures(pos);
            for (const { idx, color } of features) {
                if (color === 0) { // белые
                    for (let j = 0; j < HIDDEN_DIM; j++) {
                        this.accumulatorWhite[j] += this.inputWeights[idx][j];
                    }
                } else {
                    for (let j = 0; j < HIDDEN_DIM; j++) {
                        this.accumulatorBlack[j] += this.inputWeights[idx][j];
                    }
                }
            }
        }

        // Инкрементальное обновление при изменении позиции (можно реализовать позже)
        update(move, pos) {
            // TODO: быстрое обновление без пересчёта всей позиции
            // Для простоты пересчитываем полностью
            this.prepare(pos);
        }

        // Извлечение признаков из позиции (HalfKP: король + фигура + квадрат)
        extractFeatures(pos) {
            const features = [];
            const kingWhite = pos.pieceLists[0][6][0];   // позиция белого короля
            const kingBlack = pos.pieceLists[1][6][0];   // позиция чёрного короля
            for (let color = 0; color <= 1; color++) {
                const kingPos = (color === 0) ? kingWhite : kingBlack;
                if (kingPos === undefined) continue;
                for (let piece = 1; piece <= 5; piece++) { // все, кроме короля
                    for (const sq of pos.pieceLists[color][piece]) {
                        // Кодируем: король(0-63) + фигура(0-5) + квадрат(0-63) + цвет(0-1)
                        // Используем упрощённый индекс
                        let idx = (kingPos * 64 + sq) * 6 + (piece - 1);
                        idx %= INPUT_DIM;
                        features.push({ idx, color });
                    }
                }
            }
            return features;
        }

        // Прямой проход сети для оценки
        forward(color) {
            // color: 0 - белые, 1 - чёрные
            const accumulator = (color === 0) ? this.accumulatorWhite : this.accumulatorBlack;
            // Скрытый слой (ReLU)
            const hidden = new Array(HIDDEN_DIM);
            for (let j = 0; j < HIDDEN_DIM; j++) {
                hidden[j] = Math.max(0, accumulator[j]);
            }
            // Выходной слой
            let output = this.outputBias;
            for (let j = 0; j < HIDDEN_DIM; j++) {
                output += hidden[j] * this.outputWeights[j];
            }
            // Нормализация в диапазон сотых пешки (обычно 0-2000)
            return output * 10; // масштабирование
        }

        // Основная функция оценки позиции через NNUE
        evaluate(pos) {
            if (!this.initialized) return 0;
            this.prepare(pos);
            const scoreWhite = this.forward(0);
            const scoreBlack = this.forward(1);
            // Разница оценок (с точки зрения белых)
            let score = scoreWhite - scoreBlack;
            // Приведение к диапазону, нормализация
            score = Math.min(2000, Math.max(-2000, score));
            return score;
        }

        // Определение фазы игры (для бакетов)
        getPhase(pos) {
            let total = 0;
            total += pos.pieceLists[0][5].length * 9; // ферзи
            total += pos.pieceLists[1][5].length * 9;
            total += pos.pieceLists[0][4].length * 5; // ладьи
            total += pos.pieceLists[1][4].length * 5;
            total += pos.pieceLists[0][3].length * 3; // слоны
            total += pos.pieceLists[1][3].length * 3;
            total += pos.pieceLists[0][2].length * 3; // кони
            total += pos.pieceLists[1][2].length * 3;
            total = Math.min(24, total);
            return Math.floor(total * NBUCKETS / 24);
        }
    }

    // ======================== Экспорт ========================
    window.BurchessNNUE = {
        NNUE,
        NBUCKETS,
        INPUT_DIM,
        HIDDEN_DIM
    };
})();
