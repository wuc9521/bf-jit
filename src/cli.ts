// src/cli.ts
import fs from 'fs';
import { run as runAOT } from './interp-aot.js';
import { run as runJIT } from './interp-jit.js';

function printUsage(): void {
    console.log(`
Brainfuck Interpreter

Usage: bf-jit [options] <file>

Options:
  --mode, -m     Mode: 'aot' or 'jit' [default: aot]
  --time, -t     Show execution time
  --help, -h     Show this help
`);
}

function main(): void {
    const args = process.argv.slice(2);
    let mode: 'aot' | 'jit' = 'aot';
    let file: string | null = null;
    let showTime = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else if (arg === '--mode' || arg === '-m') {
            i++;
            if (args[i] === 'aot' || args[i] === 'jit') {
                mode = args[i] as 'aot' | 'jit';
            } else {
                console.error('Invalid mode. Use "aot" or "jit"');
                process.exit(1);
            }
        } else if (arg === '--time' || arg === '-t') {
            showTime = true;
        } else if (!arg.startsWith('-')) {
            file = arg;
        }
    }

    if (!file) {
        console.error('No input file specified');
        printUsage();
        process.exit(1);
    }

    try {
        const content = fs.readFileSync(file);
        const start = process.hrtime.bigint();

        if (mode === 'aot') {
            runAOT(content);
        } else {
            runJIT(content);
        }

        if (showTime) {
            const end = process.hrtime.bigint();
            const timeMs = Number(end - start) / 1e6;
            console.error(`\nExecution time: ${timeMs.toFixed(2)}ms`);
        }
    } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        process.exit(1);
    }
}

main();