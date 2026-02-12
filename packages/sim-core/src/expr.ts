// ============================================================
// Expression DSL — AST types and evaluators
// ============================================================
// Allows world-config formulas to be expressed as JSON ASTs,
// e.g. { "op": "mul", "args": [{ "op": "lit", "value": 0.02 }, { "op": "var", "name": "creature.radius" }] }
// Plain numbers are still valid (backward compat via resolveConfigValue).

// ============================================================
// AST node types
// ============================================================

/** Literal number. */
export interface LitExpr {
  readonly op: 'lit';
  readonly value: number;
}

/** Named variable from the evaluation context. */
export interface VarExpr {
  readonly op: 'var';
  readonly name: string;
}

/** Binary/n-ary arithmetic: add, sub, mul, div, min, max. */
export interface ArithExpr {
  readonly op: 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max';
  readonly args: readonly Expr[];
}

/** Clamp: args = [value, lo, hi]. */
export interface ClampExpr {
  readonly op: 'clamp';
  readonly args: readonly [Expr, Expr, Expr];
}

/** Comparison operators — return 1 (true) or 0 (false). */
export interface CmpExpr {
  readonly op: 'lt' | 'gt' | 'lte' | 'gte' | 'eq';
  readonly args: readonly [Expr, Expr];
}

/** Conditional: if cond != 0 → then, else → else. */
export interface IfExpr {
  readonly op: 'if';
  readonly cond: Expr;
  readonly then: Expr;
  readonly else: Expr;
}

/** Unary abs / neg / floor / ceil / sqrt. */
export interface UnaryExpr {
  readonly op: 'abs' | 'neg' | 'floor' | 'ceil' | 'sqrt';
  readonly arg: Expr;
}

/** Power: args = [base, exponent]. */
export interface PowExpr {
  readonly op: 'pow';
  readonly args: readonly [Expr, Expr];
}

/** The full expression union. */
export type Expr =
  | LitExpr
  | VarExpr
  | ArithExpr
  | ClampExpr
  | CmpExpr
  | IfExpr
  | UnaryExpr
  | PowExpr;

/** A config value is either a plain number or an expression. */
export type ConfigValue = number | Expr;

// ============================================================
// Evaluation context
// ============================================================

/** Flat context: "creature.radius" → 5, "creature.energy" → 120, etc. */
export type ExprContext = Record<string, number>;

// ============================================================
// Recursive evaluator
// ============================================================

export function evalExpr(expr: Expr, ctx: ExprContext): number {
  switch (expr.op) {
    case 'lit':
      return expr.value;

    case 'var': {
      const v = ctx[expr.name];
      if (v === undefined) {
        throw new Error(`Expression variable not found: "${expr.name}"`);
      }
      return v;
    }

    case 'add':
      return expr.args.reduce((acc, a) => acc + evalExpr(a, ctx), 0);

    case 'sub': {
      if (expr.args.length === 0) return 0;
      const [first, ...rest] = expr.args;
      return rest.reduce((acc, a) => acc - evalExpr(a, ctx), evalExpr(first, ctx));
    }

    case 'mul':
      return expr.args.reduce((acc, a) => acc * evalExpr(a, ctx), 1);

    case 'div': {
      if (expr.args.length < 2) return expr.args.length === 1 ? evalExpr(expr.args[0], ctx) : 0;
      const [num, ...denoms] = expr.args;
      return denoms.reduce((acc, a) => {
        const d = evalExpr(a, ctx);
        return d === 0 ? 0 : acc / d;
      }, evalExpr(num, ctx));
    }

    case 'min':
      return Math.min(...expr.args.map(a => evalExpr(a, ctx)));

    case 'max':
      return Math.max(...expr.args.map(a => evalExpr(a, ctx)));

    case 'clamp': {
      const val = evalExpr(expr.args[0], ctx);
      const lo = evalExpr(expr.args[1], ctx);
      const hi = evalExpr(expr.args[2], ctx);
      return Math.max(lo, Math.min(hi, val));
    }

    case 'lt':
      return evalExpr(expr.args[0], ctx) < evalExpr(expr.args[1], ctx) ? 1 : 0;

    case 'gt':
      return evalExpr(expr.args[0], ctx) > evalExpr(expr.args[1], ctx) ? 1 : 0;

    case 'lte':
      return evalExpr(expr.args[0], ctx) <= evalExpr(expr.args[1], ctx) ? 1 : 0;

    case 'gte':
      return evalExpr(expr.args[0], ctx) >= evalExpr(expr.args[1], ctx) ? 1 : 0;

    case 'eq':
      return evalExpr(expr.args[0], ctx) === evalExpr(expr.args[1], ctx) ? 1 : 0;

    case 'if':
      return evalExpr(expr.cond, ctx) !== 0
        ? evalExpr(expr.then, ctx)
        : evalExpr(expr.else, ctx);

    case 'abs':
      return Math.abs(evalExpr(expr.arg, ctx));

    case 'neg':
      return -evalExpr(expr.arg, ctx);

    case 'floor':
      return Math.floor(evalExpr(expr.arg, ctx));

    case 'ceil':
      return Math.ceil(evalExpr(expr.arg, ctx));

    case 'sqrt':
      return Math.sqrt(evalExpr(expr.arg, ctx));

    case 'pow':
      return Math.pow(evalExpr(expr.args[0], ctx), evalExpr(expr.args[1], ctx));

    default: {
      // Exhaustive check
      const _never: never = expr;
      throw new Error(`Unknown expression op: ${(_never as Expr).op}`);
    }
  }
}

// ============================================================
// Compiled evaluator (closure tree — no eval/Function)
// ============================================================

export type CompiledExpr = (ctx: ExprContext) => number;

export function compileExpr(expr: Expr): CompiledExpr {
  switch (expr.op) {
    case 'lit': {
      const v = expr.value;
      return () => v;
    }

    case 'var': {
      const name = expr.name;
      return (ctx) => {
        const v = ctx[name];
        if (v === undefined) throw new Error(`Expression variable not found: "${name}"`);
        return v;
      };
    }

    case 'add': {
      const fns = expr.args.map(compileExpr);
      return (ctx) => {
        let sum = 0;
        for (let i = 0; i < fns.length; i++) sum += fns[i](ctx);
        return sum;
      };
    }

    case 'sub': {
      const fns = expr.args.map(compileExpr);
      return (ctx) => {
        if (fns.length === 0) return 0;
        let result = fns[0](ctx);
        for (let i = 1; i < fns.length; i++) result -= fns[i](ctx);
        return result;
      };
    }

    case 'mul': {
      const fns = expr.args.map(compileExpr);
      return (ctx) => {
        let product = 1;
        for (let i = 0; i < fns.length; i++) product *= fns[i](ctx);
        return product;
      };
    }

    case 'div': {
      const fns = expr.args.map(compileExpr);
      return (ctx) => {
        if (fns.length < 2) return fns.length === 1 ? fns[0](ctx) : 0;
        let result = fns[0](ctx);
        for (let i = 1; i < fns.length; i++) {
          const d = fns[i](ctx);
          result = d === 0 ? 0 : result / d;
        }
        return result;
      };
    }

    case 'min': {
      const fns = expr.args.map(compileExpr);
      return (ctx) => {
        let m = Infinity;
        for (let i = 0; i < fns.length; i++) {
          const v = fns[i](ctx);
          if (v < m) m = v;
        }
        return m;
      };
    }

    case 'max': {
      const fns = expr.args.map(compileExpr);
      return (ctx) => {
        let m = -Infinity;
        for (let i = 0; i < fns.length; i++) {
          const v = fns[i](ctx);
          if (v > m) m = v;
        }
        return m;
      };
    }

    case 'clamp': {
      const fVal = compileExpr(expr.args[0]);
      const fLo = compileExpr(expr.args[1]);
      const fHi = compileExpr(expr.args[2]);
      return (ctx) => Math.max(fLo(ctx), Math.min(fHi(ctx), fVal(ctx)));
    }

    case 'lt': {
      const fA = compileExpr(expr.args[0]);
      const fB = compileExpr(expr.args[1]);
      return (ctx) => fA(ctx) < fB(ctx) ? 1 : 0;
    }

    case 'gt': {
      const fA = compileExpr(expr.args[0]);
      const fB = compileExpr(expr.args[1]);
      return (ctx) => fA(ctx) > fB(ctx) ? 1 : 0;
    }

    case 'lte': {
      const fA = compileExpr(expr.args[0]);
      const fB = compileExpr(expr.args[1]);
      return (ctx) => fA(ctx) <= fB(ctx) ? 1 : 0;
    }

    case 'gte': {
      const fA = compileExpr(expr.args[0]);
      const fB = compileExpr(expr.args[1]);
      return (ctx) => fA(ctx) >= fB(ctx) ? 1 : 0;
    }

    case 'eq': {
      const fA = compileExpr(expr.args[0]);
      const fB = compileExpr(expr.args[1]);
      return (ctx) => fA(ctx) === fB(ctx) ? 1 : 0;
    }

    case 'if': {
      const fCond = compileExpr(expr.cond);
      const fThen = compileExpr(expr.then);
      const fElse = compileExpr(expr.else);
      return (ctx) => fCond(ctx) !== 0 ? fThen(ctx) : fElse(ctx);
    }

    case 'abs': {
      const fn = compileExpr(expr.arg);
      return (ctx) => Math.abs(fn(ctx));
    }

    case 'neg': {
      const fn = compileExpr(expr.arg);
      return (ctx) => -fn(ctx);
    }

    case 'floor': {
      const fn = compileExpr(expr.arg);
      return (ctx) => Math.floor(fn(ctx));
    }

    case 'ceil': {
      const fn = compileExpr(expr.arg);
      return (ctx) => Math.ceil(fn(ctx));
    }

    case 'sqrt': {
      const fn = compileExpr(expr.arg);
      return (ctx) => Math.sqrt(fn(ctx));
    }

    case 'pow': {
      const fBase = compileExpr(expr.args[0]);
      const fExp = compileExpr(expr.args[1]);
      return (ctx) => Math.pow(fBase(ctx), fExp(ctx));
    }

    default: {
      const _never: never = expr;
      throw new Error(`Unknown expression op: ${(_never as Expr).op}`);
    }
  }
}

// ============================================================
// Convenience: resolve a ConfigValue (number | Expr)
// ============================================================

/**
 * If `value` is a plain number, return it.
 * If it's an Expr, evaluate with the given context.
 */
export function resolveConfigValue(value: ConfigValue, ctx: ExprContext): number {
  if (typeof value === 'number') return value;
  return evalExpr(value, ctx);
}

// ============================================================
// Type guard
// ============================================================

/** Check if a value is an Expr (has an `op` field). */
export function isExpr(value: unknown): value is Expr {
  return typeof value === 'object' && value !== null && 'op' in value;
}
