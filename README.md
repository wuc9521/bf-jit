# bf-jit

A TS implementation of a simple Brainf**k JIT compiler

This is modified from UW-Madison CS538 (2024 Fall) PA-final by

1. JS -> TS
2. Using JIT

## Usage

```bash
Usage: npm start [options] <file>

Options:
  --mode, -m     Mode: 'aot' or 'jit' [default: aot]
  --time, -t     Show execution time
  --help, -h     Show this help
```

## Example

```bash
npm start -m aot bf/mandelbrot.bf -t
```