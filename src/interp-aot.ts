// src/interp-aot.ts
import fs from 'fs';
import { Op, OpType, CharCode } from './types.js';

const opMap: Record<number, OpType> = {
    [CharCode.LT]: OpType.LEFT,
    [CharCode.GT]: OpType.RIGHT,
    [CharCode.ADD]: OpType.ADD,
    [CharCode.SUB]: OpType.SUB,
    [CharCode.LB]: OpType.OPEN,
    [CharCode.RB]: OpType.CLOSE,
    [CharCode.DOT]: OpType.OUTPUT,
    [CharCode.COMMA]: OpType.INPUT,
};

// 可以合并的操作
const repeatableOps = new Set([OpType.ADD, OpType.SUB, OpType.LEFT, OpType.RIGHT]);

const create_and_optimize_program = (bytes: Buffer | Uint8Array): Op[] => {
    const prog: Op[] = [];
    const bracketStack: number[] = [];
    let i = 0;
    const length = bytes.length;

    while (i < length) {
        const c = bytes[i] & 0xFF;
        if ([9, 10, 13, 32].includes(c)) {
            i++;
            continue;
        }

        const opType = opMap[c];
        if (!opType) {
            i++;
            continue;
        }

        if (repeatableOps.has(opType)) {
            let count = 1;
            i++;
            while (i < length) {
                const nextC = bytes[i] & 0xFF;
                if ([9, 10, 13, 32].includes(nextC)) {
                    i++;
                    continue;
                }
                if (opMap[nextC] === opType) {
                    count++;
                    i++;
                } else {
                    break;
                }
            }
            // 合并连续的相同操作
            if (prog.length > 0 && prog[prog.length - 1].type === opType) {
                prog[prog.length - 1].operand += count;
            } else {
                prog.push(new Op(opType, count));
            }
        } else if (opType === OpType.OPEN) {
            prog.push(new Op(OpType.OPEN));
            bracketStack.push(prog.length - 1);
            i++;
        } else if (opType === OpType.CLOSE) {
            if (bracketStack.length > 0) {
                const openPos = bracketStack.pop()!;
                const loopBody = prog.slice(openPos + 1);
                const optimized = tryOptimizeLoop(loopBody);
                if (optimized) {
                    prog.splice(openPos);
                    prog.push(optimized);
                } else {
                    prog.push(new Op(OpType.CLOSE));
                    prog[openPos].operand = prog.length - 1;
                    prog[prog.length - 1].operand = openPos;
                }
            }
            i++;
        } else {
            prog.push(new Op(opType));
            i++;
        }
    }

    return prog;
};

// 尝试优化循环
const tryOptimizeLoop = (body: Op[]): Op | null => {
    if (body.length === 0) return null;

    // 清零模式 [-] or [+]
    if (body.length === 1 &&
        (body[0].type === OpType.SUB || body[0].type === OpType.ADD) &&
        body[0].operand === 1) {
        return new Op(OpType.ZERO);
    }

    // 复制或乘法模式
    if (body[0].type === OpType.SUB && body[0].operand === 1) {
        const memChanges = new Map<number, number>();
        let pos = 0;
        let isValid = true;

        for (let i = 1; i < body.length && isValid; i++) {
            const op = body[i];
            switch (op.type) {
                case OpType.LEFT:
                    pos -= op.operand;
                    break;
                case OpType.RIGHT:
                    pos += op.operand;
                    break;
                case OpType.ADD:
                    memChanges.set(pos, (memChanges.get(pos) || 0) + op.operand);
                    break;
                case OpType.SUB:
                    memChanges.set(pos, (memChanges.get(pos) || 0) - op.operand);
                    break;
                default:
                    isValid = false;
            }
        }

        if (isValid && pos === 0) {
            memChanges.delete(0);
            if (memChanges.size === 0) {
                return new Op(OpType.ZERO);
            }

            const targets = Array.from(memChanges)
                .filter(([_, delta]) => delta !== 0)
                .map(([offset, delta]) => ({
                    offset,
                    factor: delta
                }));

            if (targets.length === 1 && targets[0].factor === 1) {
                return new Op(OpType.COPY, targets[0].offset);
            }
            return new Op(OpType.MULTIPLY, 0, targets);
        }
    }
    return null;
};

class AOTCompiler {
    private code: string[] = [];
    private offset = 0;
    private varCount = 0;

    constructor() {
        // 预分配代码数组以减少重新分配
        this.code = new Array(1000);
        this.code.length = 0;
    }

    private getNextVar(): string {
        return `v${this.varCount++}`;
    }

    private getMemoryAccess(offset = 0): string {
        const totalOffset = this.offset + offset;
        return totalOffset === 0 ? 'cells[cc]' : `cells[cc + ${totalOffset}]`;
    }

    private flushOffset(): void {
        if (this.offset !== 0) {
            this.code.push(`cc += ${this.offset};`);
            this.offset = 0;
        }
    }

    compile(prog: Op[]): (cells: Uint8Array) => number {
        this.code = [];
        this.code.push('(function(cells) {');
        this.code.push('  "use strict";');
        this.code.push('  let cc = 0;');

        for (const op of prog) {
            switch (op.type) {
                case OpType.ADD:
                case OpType.SUB: {
                    const value = op.type === OpType.ADD ? op.operand : -op.operand;
                    this.code.push(`  ${this.getMemoryAccess()} += ${value};`);
                    break;
                }

                case OpType.LEFT:
                    this.offset -= op.operand;
                    break;

                case OpType.RIGHT:
                    this.offset += op.operand;
                    break;

                case OpType.OUTPUT:
                    this.code.push(`  process.stdout.write(String.fromCharCode(${this.getMemoryAccess()}));`);
                    break;

                case OpType.INPUT:
                    this.flushOffset();
                    const buf = this.getNextVar();
                    this.code.push(`  const ${buf} = Buffer.alloc(1);`);
                    this.code.push(`  fs.readSync(process.stdin.fd, ${buf}, 0, 1, null);`);
                    this.code.push(`  cells[cc] = ${buf}[0];`);
                    break;

                case OpType.ZERO:
                    this.code.push(`  ${this.getMemoryAccess()} = 0;`);
                    break;

                case OpType.MULTIPLY:
                    if (op.targets) {
                        const tempVar = this.getNextVar();
                        this.code.push(`  const ${tempVar} = ${this.getMemoryAccess()};`);

                        for (const target of op.targets) {
                            const targetAccess = this.getMemoryAccess(target.offset);
                            this.code.push(`  ${targetAccess} += ${tempVar} * ${target.factor};`);
                        }

                        this.code.push(`  ${this.getMemoryAccess()} = 0;`);
                    }
                    break;

                case OpType.COPY:
                    const tempVar = this.getNextVar();
                    this.code.push(`  const ${tempVar} = ${this.getMemoryAccess()};`);
                    this.code.push(`  ${this.getMemoryAccess(op.operand)} += ${tempVar};`);
                    this.code.push(`  ${this.getMemoryAccess()} = 0;`);
                    break;

                case OpType.OPEN:
                    this.flushOffset();
                    this.code.push('  while (cells[cc] !== 0) {');
                    break;

                case OpType.CLOSE:
                    this.flushOffset();
                    this.code.push('  }');
                    break;
            }
        }

        this.flushOffset();
        this.code.push('  return cc;');
        this.code.push('})');

        try {
            return eval(this.code.join('\n'));
        } catch (e) {
            console.error('Generated code:\n', this.code.join('\n'));
            throw e;
        }
    }
}

export const run = (bytes: Buffer | Uint8Array): void => {
    const prog = create_and_optimize_program(bytes);
    const compiler = new AOTCompiler();
    const jitFn = compiler.compile(prog);
    const cells = new Uint8Array(30000);
    jitFn(cells);
};