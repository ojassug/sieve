const a = <string>someValue; import('./g1');
const b = foo<string>('x'); import('./g2');
const c: Array<Map<string, number>> = []; import('./g3');
const d = x < y && z > w; import('./g4');
const e = <T>(v: T) => v; import('./g5');
function f<T extends { a: 'x' }>(v: T): T { return v; } import('./g6');
