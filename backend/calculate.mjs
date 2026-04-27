export function calculate(expression) {
  if (typeof expression !== 'string') throw new Error('expression must be a string');
  const normalized = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  if (!/^[\d+\-*/.() ]+$/.test(normalized)) throw new Error('Invalid expression');
  const result = Function(`"use strict"; return (${normalized})`)();
  if (!Number.isFinite(result)) throw new Error('Math error');
  return String(result);
}
