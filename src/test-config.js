// src/test-config.ts
export const TEST_CONFIG = {
    CELL_SIZE: 30000,
    WARMUP_ITERATIONS: 0,  // 预热迭代次数
    BENCH_ITERATIONS: {    // 每个测试的迭代次数
      hello: 100,
      hanoi: 1,
      mandelbrot: 1
    }
  };