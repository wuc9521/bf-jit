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

interface CompiledLoop {
    type: 'clear' | 'move' | 'add' | 'addmulti' | 'scan' | 'search';
    offset?: number;
    amount?: number;
    targets?: Array<{ offset: number, amount: number }>;
}

class JITCompiler {
    public static readonly HOT_THRESHOLD = 10;
    private readonly loopCache = new Map<string, Function>();

    constructor(private readonly cells: Uint8Array) { }

    private getLoopSignature(prog: Op[], start: number, end: number): string {
        return prog.slice(start, end).map(op => `${op.type}:${op.operand}`).join('|');
    }

    analyzeLoop(prog: Op[], startPc: number): CompiledLoop | null {
        let pc = startPc;
        const loopStart = pc + 1;
        let loopEnd = loopStart;
        let depth = 1;

        while (depth > 0 && loopEnd < prog.length) {
            if (prog[loopEnd].type === OpType.OPEN) depth++;
            else if (prog[loopEnd].type === OpType.CLOSE) depth--;
            loopEnd++;
        }
        loopEnd--;

        const body = prog.slice(loopStart, loopEnd);
        console.error(`Analyzing loop at pc=${startPc}, body length=${body.length}, operations=${body.map(op => op.type).join(',')}`);

        // 清零模式 [-] 或 [+]
        if (body.length === 1 &&
            (body[0].type === OpType.SUB || body[0].type === OpType.ADD) &&
            body[0].operand === 1) {
            console.error('Found clear pattern');
            return { type: 'clear' };
        }

        // 移动数据模式 [->+<]
        if (body.length === 4 &&
            body[0].type === OpType.SUB && body[0].operand === 1 &&
            body[1].type === OpType.RIGHT &&
            body[2].type === OpType.ADD && body[2].operand === 1 &&
            body[3].type === OpType.LEFT) {
            console.error('Found move pattern');
            return {
                type: 'move',
                offset: body[1].operand
            };
        }

        // 特殊模式 [<->-<+>]
        if (body.length === 7 &&
            body[0].type === OpType.LEFT &&
            body[1].type === OpType.SUB &&
            body[2].type === OpType.RIGHT &&
            body[3].type === OpType.SUB &&
            body[4].type === OpType.LEFT &&
            body[5].type === OpType.ADD &&
            body[6].type === OpType.RIGHT) {
            console.error('Found special pattern [<->-<+>]');
            return {
                type: 'addmulti',
                targets: [
                    { offset: -1, amount: -1 },
                    { offset: 0, amount: -1 },
                    { offset: -1, amount: 1 }
                ]
            };
        }

        // 扫描模式 [>] 或 [<]
        if (body.length === 1) {
            if (body[0].type === OpType.RIGHT) {
                console.error('Found right scan pattern');
                return { type: 'scan', offset: 1 };
            }
            if (body[0].type === OpType.LEFT) {
                console.error('Found left scan pattern');
                return { type: 'scan', offset: -1 };
            }
        }

        // 搜索模式 [>>] 或 [<<]
        if (body.length === 1 &&
            (body[0].type === OpType.RIGHT || body[0].type === OpType.LEFT) &&
            body[0].operand > 1) {
            console.error('Found search pattern');
            return {
                type: 'search',
                offset: body[0].type === OpType.RIGHT ? body[0].operand : -body[0].operand
            };
        }

        console.error('No optimization pattern found');
        return null;
    }

    public compileLoop(prog: Op[], startPc: number): CompiledLoop | null {
        return this.analyzeLoop(prog, startPc);
    }
}

class Interpreter {
    private cells: Uint8Array;
    private cc: number;
    private pc: number;
    private readonly jit: JITCompiler;
    private readonly hotCount = new Map<number, number>();

    constructor(private readonly prog: Op[]) {
        this.cells = new Uint8Array(30000);
        this.cc = 0;
        this.pc = 0;
        this.jit = new JITCompiler(this.cells);
    }

    private execCompiledLoop(loop: CompiledLoop): void {
        const maxCc = this.cells.length - 1;
        switch (loop.type) {
            case 'clear':
                this.cells[this.cc] = 0;
                break;

            case 'move': {
                const value = this.cells[this.cc];
                if (this.cc + loop.offset! >= 0 && this.cc + loop.offset! <= maxCc) {
                    this.cells[this.cc + loop.offset!] += value;
                }
                this.cells[this.cc] = 0;
                break;
            }

            case 'add': {
                const value = this.cells[this.cc];
                if (this.cc + loop.offset! >= 0 && this.cc + loop.offset! <= maxCc) {
                    this.cells[this.cc + loop.offset!] = (this.cells[this.cc + loop.offset!] + value * loop.amount!) & 0xFF;
                }
                this.cells[this.cc] = 0;
                break;
            }

            case 'addmulti': {
                const value = this.cells[this.cc];
                for (const target of loop.targets!) {
                    const targetCc = this.cc + target.offset;
                    if (targetCc >= 0 && targetCc <= maxCc) {
                        this.cells[targetCc] = (this.cells[targetCc] + value * target.amount) & 0xFF;
                    }
                }
                this.cells[this.cc] = 0;
                break;
            }

            case 'scan': {
                const offset = loop.offset!;
                let newCc = this.cc;
                const maxIterations = 30000;
                let iterations = 0;

                while (iterations < maxIterations &&
                    newCc >= 0 &&
                    newCc <= maxCc &&
                    this.cells[newCc] !== 0) {
                    newCc += offset;
                    iterations++;
                }

                if (newCc >= 0 && newCc <= maxCc) {
                    this.cc = newCc;
                } else {
                    this.cc = offset > 0 ? maxCc : 0;
                }
                break;
            }

            case 'search': {
                const offset = loop.offset!;
                let newCc = this.cc;
                const maxIterations = 30000;
                let iterations = 0;

                while (iterations < maxIterations &&
                    newCc >= 0 &&
                    newCc <= maxCc &&
                    this.cells[newCc] !== 0) {
                    newCc += offset;
                    iterations++;
                }

                if (newCc >= 0 && newCc <= maxCc) {
                    this.cc = newCc;
                } else {
                    this.cc = offset > 0 ? maxCc : 0;
                }
                break;
            }
        }
    }

    run(): void {
        while (this.pc < this.prog.length) {
            const op = this.prog[this.pc];

            if (op.type === OpType.OPEN) {
                const count = (this.hotCount.get(this.pc) || 0) + 1;
                this.hotCount.set(this.pc, count);

                if (count >= JITCompiler.HOT_THRESHOLD) {
                    console.error(`Hot loop detected at PC=${this.pc}, count=${count}`);
                    // let compiled = this.jit.getCompiledLoop(this.pc);
                    let compiled = this.jit.compileLoop(this.prog, this.pc);
                    if (compiled) {
                        console.error(`Executing compiled loop type: ${compiled.type} at cell=${this.cc} with value=${this.cells[this.cc]}`);
                        this.execCompiledLoop(compiled);
                        this.pc = this.prog[this.pc].operand + 1;
                        continue;
                    }
                }
            }

            try {
                switch (op.type) {
                    case OpType.LEFT:
                        if (this.cc > 0) this.cc--;
                        break;
                    case OpType.RIGHT:
                        if (this.cc < this.cells.length - 1) this.cc++;
                        break;
                    case OpType.ADD:
                        this.cells[this.cc] = (this.cells[this.cc] + op.operand) & 0xFF;
                        break;
                    case OpType.SUB:
                        this.cells[this.cc] = (this.cells[this.cc] - op.operand) & 0xFF;
                        break;
                    case OpType.OPEN:
                        if (this.cells[this.cc] === 0) {
                            this.pc = op.operand;
                        }
                        break;
                    case OpType.CLOSE:
                        if (this.cells[this.cc] !== 0) {
                            this.pc = op.operand;
                        }
                        break;
                    case OpType.OUTPUT:
                        process.stdout.write(String.fromCharCode(this.cells[this.cc]));
                        break;
                    case OpType.INPUT: {
                        const buf = Buffer.alloc(1);
                        fs.readSync(process.stdin.fd, buf, 0, 1, null);
                        this.cells[this.cc] = buf[0];
                        break;
                    }
                }
                this.pc++;
            } catch (e) {
                console.error(`Error at PC=${this.pc}, CC=${this.cc}, Op=${op.type}:`, e);
                throw e;
            }
        }
    }
}

const create_program = (bytes: Buffer | Uint8Array): Op[] => {
    const prog: Op[] = [];
    const bracketStack: number[] = [];
    let i = 0;

    while (i < bytes.length) {
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

        // 合并连续的相同操作
        if ([OpType.ADD, OpType.SUB, OpType.LEFT, OpType.RIGHT].includes(opType)) {
            let count = 1;
            i++;
            while (i < bytes.length) {
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
                prog.push(new Op(OpType.CLOSE));
                prog[openPos].operand = prog.length - 1;
                prog[prog.length - 1].operand = openPos;
            }
            i++;
        } else {
            prog.push(new Op(opType));
            i++;
        }
    }

    return prog;
};

export const run = (bytes: Buffer | Uint8Array): void => {
    const prog = create_program(bytes);
    const interpreter = new Interpreter(prog);
    interpreter.run();
};