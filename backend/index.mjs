import { calculate } from './calculate.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

export const handler = async (event) => {
  if (event?.httpMethod === 'OPTIONS' || event?.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  let expression;
  try {
    const body = typeof event?.body === 'string' ? JSON.parse(event.body) : (event?.body || event);
    expression = body?.expression;
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  try {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ result: calculate(expression) }) };
  } catch (e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
