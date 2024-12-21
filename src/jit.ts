// src/jit.ts
import { Op, OpType, CompiledBlock } from './types.js';

export class JITCompiler {
    private readonly HOT_THRESHOLD = 50;  // 热点阈值
    private readonly compiledBlocks = new Map<number, CompiledBlock>();

    constructor(private readonly prog: Op[]) { }

    // 增加执行计数
    incrementCount(pc: number): boolean {
        this.prog[pc].jitCount++;
        return this.prog[pc].jitCount >= this.HOT_THRESHOLD;
    }

    // 检查是否有可用的已编译代码块
    getCompiledBlock(pc: number): CompiledBlock | undefined {
        return this.compiledBlocks.get(pc);
    }

    // 编译热点代码块
    compileHotBlock(startPc: number): CompiledBlock {
        const block = this.analyzeBlock(startPc);
        const code = this.generateOptimizedCode(block.startPc, block.endPc);
        this.compiledBlocks.set(startPc, block);
        return block;
    }

    private analyzeBlock(startPc: number): CompiledBlock {
        let endPc = startPc;
        const loopNestLevel = new Set<number>();

        // 找到完整的代码块（通常是一个循环）
        while (endPc < this.prog.length) {
            const op = this.prog[endPc];
            if (op.type === OpType.OPEN) {
                loopNestLevel.add(endPc);
            } else if (op.type === OpType.CLOSE) {
                loopNestLevel.delete(op.operand);
            }

            if (loopNestLevel.size === 0 && endPc > startPc) {
                break;
            }
            endPc++;
        }

        return {
            startPc,
            endPc,
            code: this.generateOptimizedCode(startPc, endPc)
        };
    }

    private generateOptimizedCode(startPc: number, endPc: number): (cells: Uint8Array, cc: number) => [number, number] {
        const codeLines: string[] = [];
        codeLines.push('(cells, cc) => {');

        // 局部变量优化
        codeLines.push('  let localCc = cc;');

        // 在循环开始时复制热点数据到局部变量
        codeLines.push('  const startValue = cells[localCc];');

        // 生成优化后的循环体
        codeLines.push('  while (cells[localCc] !== 0) {');

        // 分析循环体的模式并生成优化代码
        const pattern = this.analyzePattern(startPc, endPc);
        if (pattern) {
            codeLines.push('    ' + pattern);
        } else {
            // 回退到普通代码生成
            for (let pc = startPc + 1; pc < endPc; pc++) {
                const op = this.prog[pc];
                codeLines.push('    ' + this.generateOpCode(op));
            }
        }

        codeLines.push('  }');

        // 返回新的 cc 和 pc
        codeLines.push('  return [localCc, ' + (endPc + 1) + '];');
        codeLines.push('}');

        try {
            return eval(codeLines.join('\n'));
        } catch (e) {
            console.error('JIT compilation failed:', e);
            console.error('Generated code:\n', codeLines.join('\n'));
            throw e;
        }
    }

    private analyzePattern(startPc: number, endPc: number): string | null {
        const ops = this.prog.slice(startPc + 1, endPc);

        // 检测清零模式 [-]
        if (ops.length === 1 &&
            ops[0].type === OpType.SUB &&
            ops[0].operand === 1) {
            return 'cells[localCc] = 0;';
        }

        // 检测复制模式 [->+<]
        if (ops.length === 4 &&
            ops[0].type === OpType.SUB &&
            ops[1].type === OpType.RIGHT &&
            ops[2].type === OpType.ADD &&
            ops[3].type === OpType.LEFT) {
            return `
        const value = cells[localCc];
        cells[localCc + ${ops[1].operand}] += value;
        cells[localCc] = 0;
      `;
        }

        // 检测乘法模式
        if (ops[0].type === OpType.SUB && ops[0].operand === 1) {
            const memChanges = new Map<number, number>();
            let pos = 0;

            for (const op of ops.slice(1)) {
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
                        return null;
                }
            }

            if (pos === 0 && memChanges.size > 0) {
                const code = ['const value = cells[localCc];'];
                for (const [offset, factor] of memChanges) {
                    if (offset !== 0 && factor !== 0) {
                        code.push(`cells[localCc + ${offset}] += value * ${factor};`);
                    }
                }
                code.push('cells[localCc] = 0;');
                return code.join('\n');
            }
        }

        return null;
    }

    private generateOpCode(op: Op): string {
        switch (op.type) {
            case OpType.LEFT:
                return `localCc -= ${op.operand};`;
            case OpType.RIGHT:
                return `localCc += ${op.operand};`;
            case OpType.ADD:
                return `cells[localCc] = (cells[localCc] + ${op.operand}) & 0xFF;`;
            case OpType.SUB:
                return `cells[localCc] = (cells[localCc] - ${op.operand}) & 0xFF;`;
            case OpType.OUTPUT:
                return 'process.stdout.write(String.fromCharCode(cells[localCc]));';
            case OpType.INPUT:
                return 'cells[localCc] = require("fs").readSync(0, Buffer.alloc(1), 0, 1, null)[0];';
            default:
                return '';
        }
    }
}