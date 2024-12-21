import fs from "fs";
import { run } from './interp-aot.js';
import { TEST_CONFIG } from './test-config.js';

interface BenchmarkResults {
  [key: string]: number;
}

const benchmark = (
  method: (bytes: Buffer | Uint8Array) => void, 
  iterations: number, 
  bytes: Buffer | Uint8Array
): number => {
  // 预热运行
  for (let i = 0; i < TEST_CONFIG.WARMUP_ITERATIONS; i++) {
    method(bytes);
  }

  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    method(bytes);
  }
  const end = process.hrtime.bigint();

  return Number(end - start) / 1e6; // 转换为毫秒
};

const main = () => {
  // 加载测试文件
  const hanoi = fs.readFileSync("bf/hanoi.bf");
  const mandelbrot = fs.readFileSync("bf/mandelbrot.bf");
  const hello = fs.readFileSync("bf/hello.bf");

  const marks: BenchmarkResults = {};
  
  console.log("Running benchmarks (with warmup)...\n");

  // 运行基准测试
  console.log("Testing 'Hello, World!'...");
  marks["hello"] = benchmark(run, TEST_CONFIG.BENCH_ITERATIONS.hello, hello);

  console.log("Testing Towers of Hanoi...");
  marks["hanoi"] = benchmark(run, TEST_CONFIG.BENCH_ITERATIONS.hanoi, hanoi);

  console.log("Testing Mandelbrot...");
  marks["mandelbrot"] = benchmark(run, TEST_CONFIG.BENCH_ITERATIONS.mandelbrot, mandelbrot);

  // 打印结果
  console.log("\nBenchmark results (ms):");
  console.table(marks);
};

main();