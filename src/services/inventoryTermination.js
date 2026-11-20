// The ending of an inventory code (INV-CICLICO-1120-4.5). Several inventories in one week
// are numbered with decimals, so 4.5 sits between 4 and 5 and is always compared as a number.
const PATTERN = /^\d{1,4}(?:\.\d{1,2})?$/;
const MESSAGE = 'La terminación debe ser un número de 1 a 9999, con hasta 2 decimales (por ejemplo 4 o 4.5).';

// One written form per number, so 4.50 and 4.5 (or 4.0 and 4) name the same inventory.
function normalizeTermination(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim().replace(',', '.');
  const number = Number(text);
  if (!PATTERN.test(text) || !Number.isFinite(number) || number < 1 || number > 9999) throw new Error(MESSAGE);
  return String(number);
}

module.exports = { normalizeTermination, TERMINATION_MESSAGE: MESSAGE };
