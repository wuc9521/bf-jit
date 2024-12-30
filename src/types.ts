// src/types.ts
export enum OpType {
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
  ADD = 'ADD',
  SUB = 'SUB',
  OPEN = 'OPEN',
  CLOSE = 'CLOSE',
  OUTPUT = 'OUTPUT',
  INPUT = 'INPUT',
  ZERO = 'ZERO',
  MULTIPLY = 'MULTIPLY',
  COPY = 'COPY',
  SCANLEFT = 'SCANLEFT',
  SCANRIGHT = 'SCANRIGHT',
}

export interface Target {
  offset: number;
  factor: number;
}

export class Op {
  constructor(
    public type: OpType,
    public operand: number = 1,
    public targets: Target[] | null = null,
    public jitCount: number = 0  
  ) {}
}

export enum CharCode {
  LT = 60,    // '<'
  GT = 62,    // '>'
  ADD = 43,   // '+'
  COMMA = 44, // ','
  SUB = 45,   // '-'
  DOT = 46,   // '.'
  LB = 91,    // '['
  RB = 93     // ']'
}
export interface CompiledBlock {
  startPc: number;
  endPc: number;
  code: (cells: Uint8Array, cc: number) => [number, number]; 
}