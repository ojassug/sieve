const a = `plain ${value} text`;
const b = `outer ${`inner ${deep} \`escaped\``} done`;
const c = `${ { key: '}' }['key'] } still template`;
const d = `${await import('./in-interpolation')}`;
const e = `a ${b ? `x` : `y`} c`; import('./after-templates');
const f = `multi
line ${'with string'}
template`;
const g = `\${not-interpolation} ${'`'} end`;
import('./after-all-templates');
