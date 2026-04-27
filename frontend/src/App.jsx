import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';

const BUTTONS = [
  ['C', 'CE', '÷', '×'],
  ['7', '8', '9', '-'],
  ['4', '5', '6', '+'],
  ['1', '2', '3', '='],
  ['0', '.']
];

export default function App() {
  const [expression, setExpression] = useState('');
  const [display, setDisplay] = useState('0');
  const [error, setError] = useState('');

  const press = async (key) => {
    setError('');
    if (key === 'C') {
      setExpression('');
      setDisplay('0');
      return;
    }
    if (key === 'CE') {
      const next = expression.replace(/(\d+\.?\d*|[+\-×÷])\s*$/, '');
      setExpression(next);
      setDisplay(next || '0');
      return;
    }
    if (key === '=') {
      if (!expression) return;
      if (!API_URL) {
        setError('API URL not configured');
        return;
      }
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expression })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setDisplay(data.result);
        setExpression(data.result);
      } catch (e) {
        setError(e.message || 'Calc failed');
      }
      return;
    }
    const next = expression + key;
    setExpression(next);
    setDisplay(next);
  };

  return (
    <div className="calc">
      <div className="screen">
        <div className="expr">{display}</div>
        {error && <div className="error">{error}</div>}
      </div>
      <div className="pad">
        {BUTTONS.flat().map((b) => (
          <button
            key={b}
            className={`btn ${'+-×÷='.includes(b) ? 'op' : ''} ${b === '0' ? 'zero' : ''} ${b === 'C' || b === 'CE' ? 'clear' : ''}`}
            onClick={() => press(b)}
          >
            {b}
          </button>
        ))}
      </div>
      <div className="hint">{API_URL ? '' : 'Set VITE_API_URL at build time'}</div>
    </div>
  );
}
