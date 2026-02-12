import { describe, it, expect } from 'vitest';
import {
  evalExpr,
  compileExpr,
  resolveConfigValue,
  isExpr,
  type Expr,
  type ExprContext,
  type ConfigValue,
} from './expr.js';

// ============================================================
// Helpers
// ============================================================

const lit = (value: number): Expr => ({ op: 'lit', value });
const v = (name: string): Expr => ({ op: 'var', name });

const ctx: ExprContext = {
  'creature.radius': 5,
  'creature.energy': 120,
  'creature.age': 50,
  'creature.speed': 2,
  'food.nutrition': 30,
  'distance': 15,
};

// ============================================================
// evalExpr
// ============================================================

describe('evalExpr', () => {
  it('evaluates literal', () => {
    expect(evalExpr(lit(42), {})).toBe(42);
  });

  it('evaluates variable', () => {
    expect(evalExpr(v('creature.radius'), ctx)).toBe(5);
  });

  it('throws on unknown variable', () => {
    expect(() => evalExpr(v('unknown.var'), ctx)).toThrow('Expression variable not found: "unknown.var"');
  });

  it('evaluates add', () => {
    const expr: Expr = { op: 'add', args: [lit(1), lit(2), lit(3)] };
    expect(evalExpr(expr, ctx)).toBe(6);
  });

  it('evaluates sub', () => {
    const expr: Expr = { op: 'sub', args: [lit(10), lit(3), lit(2)] };
    expect(evalExpr(expr, ctx)).toBe(5);
  });

  it('evaluates sub with empty args', () => {
    const expr: Expr = { op: 'sub', args: [] };
    expect(evalExpr(expr, ctx)).toBe(0);
  });

  it('evaluates mul', () => {
    const expr: Expr = { op: 'mul', args: [lit(2), lit(3), lit(4)] };
    expect(evalExpr(expr, ctx)).toBe(24);
  });

  it('evaluates div', () => {
    const expr: Expr = { op: 'div', args: [lit(12), lit(3)] };
    expect(evalExpr(expr, ctx)).toBe(4);
  });

  it('evaluates div by zero as 0', () => {
    const expr: Expr = { op: 'div', args: [lit(10), lit(0)] };
    expect(evalExpr(expr, ctx)).toBe(0);
  });

  it('evaluates min', () => {
    const expr: Expr = { op: 'min', args: [lit(5), lit(2), lit(8)] };
    expect(evalExpr(expr, ctx)).toBe(2);
  });

  it('evaluates max', () => {
    const expr: Expr = { op: 'max', args: [lit(5), lit(2), lit(8)] };
    expect(evalExpr(expr, ctx)).toBe(8);
  });

  it('evaluates clamp', () => {
    const expr: Expr = { op: 'clamp', args: [lit(15), lit(0), lit(10)] };
    expect(evalExpr(expr, ctx)).toBe(10);
  });

  it('evaluates clamp within range', () => {
    const expr: Expr = { op: 'clamp', args: [lit(5), lit(0), lit(10)] };
    expect(evalExpr(expr, ctx)).toBe(5);
  });

  it('evaluates lt', () => {
    expect(evalExpr({ op: 'lt', args: [lit(3), lit(5)] }, ctx)).toBe(1);
    expect(evalExpr({ op: 'lt', args: [lit(5), lit(3)] }, ctx)).toBe(0);
    expect(evalExpr({ op: 'lt', args: [lit(5), lit(5)] }, ctx)).toBe(0);
  });

  it('evaluates gt', () => {
    expect(evalExpr({ op: 'gt', args: [lit(5), lit(3)] }, ctx)).toBe(1);
    expect(evalExpr({ op: 'gt', args: [lit(3), lit(5)] }, ctx)).toBe(0);
  });

  it('evaluates lte', () => {
    expect(evalExpr({ op: 'lte', args: [lit(5), lit(5)] }, ctx)).toBe(1);
    expect(evalExpr({ op: 'lte', args: [lit(6), lit(5)] }, ctx)).toBe(0);
  });

  it('evaluates gte', () => {
    expect(evalExpr({ op: 'gte', args: [lit(5), lit(5)] }, ctx)).toBe(1);
    expect(evalExpr({ op: 'gte', args: [lit(4), lit(5)] }, ctx)).toBe(0);
  });

  it('evaluates eq', () => {
    expect(evalExpr({ op: 'eq', args: [lit(5), lit(5)] }, ctx)).toBe(1);
    expect(evalExpr({ op: 'eq', args: [lit(4), lit(5)] }, ctx)).toBe(0);
  });

  it('evaluates if-then-else (true branch)', () => {
    const expr: Expr = { op: 'if', cond: lit(1), then: lit(10), else: lit(20) };
    expect(evalExpr(expr, ctx)).toBe(10);
  });

  it('evaluates if-then-else (false branch)', () => {
    const expr: Expr = { op: 'if', cond: lit(0), then: lit(10), else: lit(20) };
    expect(evalExpr(expr, ctx)).toBe(20);
  });

  it('evaluates abs', () => {
    expect(evalExpr({ op: 'abs', arg: lit(-5) }, ctx)).toBe(5);
    expect(evalExpr({ op: 'abs', arg: lit(5) }, ctx)).toBe(5);
  });

  it('evaluates neg', () => {
    expect(evalExpr({ op: 'neg', arg: lit(5) }, ctx)).toBe(-5);
  });

  it('evaluates floor', () => {
    expect(evalExpr({ op: 'floor', arg: lit(3.7) }, ctx)).toBe(3);
  });

  it('evaluates ceil', () => {
    expect(evalExpr({ op: 'ceil', arg: lit(3.2) }, ctx)).toBe(4);
  });

  it('evaluates sqrt', () => {
    expect(evalExpr({ op: 'sqrt', arg: lit(25) }, ctx)).toBe(5);
  });

  it('evaluates pow', () => {
    const expr: Expr = { op: 'pow', args: [lit(2), lit(3)] };
    expect(evalExpr(expr, ctx)).toBe(8);
  });

  it('evaluates nested expression', () => {
    // moveCost = base * (radius / defaultRadius)^2
    // = 0.02 * (5 / 5)^2 = 0.02
    const expr: Expr = {
      op: 'mul',
      args: [
        lit(0.02),
        { op: 'pow', args: [
          { op: 'div', args: [v('creature.radius'), lit(5)] },
          lit(2),
        ] },
      ],
    };
    expect(evalExpr(expr, ctx)).toBeCloseTo(0.02);
  });

  it('evaluates complex conditional expression', () => {
    // if creature.energy > 100 then baseDamage * 1.5 else baseDamage
    const expr: Expr = {
      op: 'if',
      cond: { op: 'gt', args: [v('creature.energy'), lit(100)] },
      then: { op: 'mul', args: [lit(15), lit(1.5)] },
      else: lit(15),
    };
    expect(evalExpr(expr, ctx)).toBe(22.5); // energy=120 > 100, so 15*1.5
  });

  it('evaluates with variables from context', () => {
    const expr: Expr = {
      op: 'mul',
      args: [v('creature.speed'), v('creature.radius')],
    };
    expect(evalExpr(expr, ctx)).toBe(10); // 2 * 5
  });
});

// ============================================================
// compileExpr — should produce same results as evalExpr
// ============================================================

describe('compileExpr', () => {
  const expressions: { name: string; expr: Expr; expected: number }[] = [
    { name: 'literal', expr: lit(42), expected: 42 },
    { name: 'variable', expr: v('creature.radius'), expected: 5 },
    { name: 'add', expr: { op: 'add', args: [lit(1), lit(2), lit(3)] }, expected: 6 },
    { name: 'sub', expr: { op: 'sub', args: [lit(10), lit(3)] }, expected: 7 },
    { name: 'mul', expr: { op: 'mul', args: [lit(2), lit(3)] }, expected: 6 },
    { name: 'div', expr: { op: 'div', args: [lit(12), lit(4)] }, expected: 3 },
    { name: 'div by zero', expr: { op: 'div', args: [lit(10), lit(0)] }, expected: 0 },
    { name: 'min', expr: { op: 'min', args: [lit(5), lit(2)] }, expected: 2 },
    { name: 'max', expr: { op: 'max', args: [lit(5), lit(2)] }, expected: 5 },
    { name: 'clamp', expr: { op: 'clamp', args: [lit(15), lit(0), lit(10)] }, expected: 10 },
    { name: 'lt true', expr: { op: 'lt', args: [lit(1), lit(2)] }, expected: 1 },
    { name: 'lt false', expr: { op: 'lt', args: [lit(2), lit(1)] }, expected: 0 },
    { name: 'gt', expr: { op: 'gt', args: [lit(5), lit(3)] }, expected: 1 },
    { name: 'lte', expr: { op: 'lte', args: [lit(5), lit(5)] }, expected: 1 },
    { name: 'gte', expr: { op: 'gte', args: [lit(4), lit(5)] }, expected: 0 },
    { name: 'eq', expr: { op: 'eq', args: [lit(5), lit(5)] }, expected: 1 },
    { name: 'if true', expr: { op: 'if', cond: lit(1), then: lit(10), else: lit(20) }, expected: 10 },
    { name: 'if false', expr: { op: 'if', cond: lit(0), then: lit(10), else: lit(20) }, expected: 20 },
    { name: 'abs', expr: { op: 'abs', arg: lit(-7) }, expected: 7 },
    { name: 'neg', expr: { op: 'neg', arg: lit(3) }, expected: -3 },
    { name: 'floor', expr: { op: 'floor', arg: lit(3.9) }, expected: 3 },
    { name: 'ceil', expr: { op: 'ceil', arg: lit(3.1) }, expected: 4 },
    { name: 'sqrt', expr: { op: 'sqrt', arg: lit(16) }, expected: 4 },
    { name: 'pow', expr: { op: 'pow', args: [lit(3), lit(2)] }, expected: 9 },
  ];

  for (const { name, expr, expected } of expressions) {
    it(`compiled ${name} matches evalExpr`, () => {
      const compiled = compileExpr(expr);
      const evalResult = evalExpr(expr, ctx);
      const compiledResult = compiled(ctx);
      expect(compiledResult).toBe(evalResult);
      expect(compiledResult).toBe(expected);
    });
  }

  it('compiled throws on unknown variable', () => {
    const compiled = compileExpr(v('nonexistent'));
    expect(() => compiled(ctx)).toThrow('Expression variable not found');
  });

  it('compiled nested expression matches evalExpr', () => {
    const expr: Expr = {
      op: 'mul',
      args: [
        lit(0.02),
        { op: 'pow', args: [
          { op: 'div', args: [v('creature.radius'), lit(5)] },
          lit(2),
        ] },
      ],
    };
    const compiled = compileExpr(expr);
    expect(compiled(ctx)).toBeCloseTo(evalExpr(expr, ctx));
  });
});

// ============================================================
// resolveConfigValue
// ============================================================

describe('resolveConfigValue', () => {
  it('returns number as-is', () => {
    expect(resolveConfigValue(42, ctx)).toBe(42);
  });

  it('evaluates Expr', () => {
    const val: ConfigValue = { op: 'mul', args: [lit(2), v('creature.radius')] };
    expect(resolveConfigValue(val, ctx)).toBe(10);
  });

  it('works with zero', () => {
    expect(resolveConfigValue(0, ctx)).toBe(0);
  });
});

// ============================================================
// isExpr
// ============================================================

describe('isExpr', () => {
  it('returns true for Expr objects', () => {
    expect(isExpr(lit(5))).toBe(true);
    expect(isExpr({ op: 'add', args: [lit(1)] })).toBe(true);
  });

  it('returns false for numbers', () => {
    expect(isExpr(42)).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isExpr(null)).toBe(false);
    expect(isExpr(undefined)).toBe(false);
  });

  it('returns false for plain objects without op', () => {
    expect(isExpr({ value: 5 })).toBe(false);
  });
});
