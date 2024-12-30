import fs from "fs";
import { run } from "./interp-aot.js";

// load benchmark files
const hello = fs.readFileSync("bf/hello.bf");
const bench = fs.readFileSync("bf/bench.bf");
const hanoi = fs.readFileSync("bf/hanoi.bf");
const mandelbrot = fs.readFileSync("bf/mandelbrot.bf");

type BFInterpreter = (bytes: Buffer | Uint8Array) => void;

const benchmark = (method: BFInterpreter, iterations: number, bytes: Buffer): number => {
  let time = 0;
  const timer = (action?: "start" | "stop"): number => {
    const d = Date.now();
    if (time < 1 || action === "start") {
      time = d;
      return 0;
    } else if (action === "stop") {
      const t = d - time;
      time = 0;
      return t;
    } else {
      return d - time;
    }
  };

  let i = 0;
  timer("start");
  while (i < iterations) {
    method(bytes);
    i++;
  }

  return timer("stop");
};

interface Marks {
  [key: string]: number;
}

const marks: Marks = {};

// run benchmarks
console.log("Running benchmarks...\n");

console.log("Testing 'Hello, World!'...");
marks["hello"] = benchmark(run, 100, hello);

console.log("Testing bench...");
marks["bench"] = benchmark(run, 5, bench);

console.log("Testing Towers of Hanoi...");
marks["hanoi"] = benchmark(run, 1, hanoi);

console.log("Testing Mandelbrot...");
marks["mandelbrot"] = benchmark(run, 1, mandelbrot);

console.log("\nBenchmark results (ms):");
console.table(marks);