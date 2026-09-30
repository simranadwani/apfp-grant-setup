'use strict';
// Loads every root-level .js file into one vm context (like Apps Script's shared global scope),
// with just enough fake Google services for the pure logic to run. No Google APIs are called.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function pad(n, width) {
  return String(n).padStart(width || 2, '0');
}

function fakeServices() {
  return {
    console,
    Utilities: {
      formatDate(date, _timeZone, pattern) {
        return pattern
          .replace('yyyy', pad(date.getFullYear(), 4)).replace('MM', pad(date.getMonth() + 1))
          .replace('dd', pad(date.getDate())).replace('HH', pad(date.getHours()))
          .replace('mm', pad(date.getMinutes())).replace('ss', pad(date.getSeconds()));
      }
    },
    // Present so that code testing `typeof X` behaves like Apps Script; individual tests stub what they need.
    Session: {
      getActiveUser: () => ({ getEmail: () => 'tester@example.org' }),
      getEffectiveUser: () => ({ getEmail: () => 'tester@example.org' })
    }
  };
}

function sourceFiles() {
  return fs.readdirSync(ROOT).filter(name => name.endsWith('.js'))
    .sort((a, b) => (a === 'Config.js' ? -1 : b === 'Config.js' ? 1 : a.localeCompare(b)));
}

function loadProject(extraGlobals) {
  const ctx = vm.createContext(Object.assign(fakeServices(), extraGlobals || {}));
  const files = sourceFiles();
  files.forEach(name => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, name), 'utf8'), ctx, { filename: name });
  });
  const run = code => vm.runInContext(code, ctx);
  return {
    ctx,
    files,
    run,
    // Look up any function/constant declared by the project, e.g. project.get('clean_').
    get: name => run(name),
    // Replace a project function (for stubbing collaborators inside a test).
    override(name, fn) {
      ctx.__override = fn;
      run(`${name} = __override;`);
      delete ctx.__override;
    },
    // Build values inside the project's realm so `instanceof Date` etc. behave as in Apps Script.
    date: (...args) => {
      ctx.__args = args;
      const d = run('new Date(...__args)');
      delete ctx.__args;
      return d;
    }
  };
}

// Cross-realm objects fail deepStrictEqual on prototypes; compare plain JSON copies instead.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Minimal in-memory sheet: enough of the Range API for the row/matrix helpers under test.
class FakeSheet {
  constructor(name, grid, options) {
    this.name = name;
    this.grid = (grid || []).map(row => row.slice());
    this.maxRows = (options && options.maxRows) || this.grid.length;
    this.writes = [];
  }
  getName() { return this.name; }
  getMaxRows() { return Math.max(this.maxRows, this.grid.length); }
  getLastRow() {
    let last = 0;
    this.grid.forEach((row, i) => { if (row.some(v => v !== '' && v != null)) last = i + 1; });
    return last;
  }
  getLastColumn() {
    let width = 0;
    this.grid.forEach(row => {
      for (let i = row.length; i > 0; i--) if (row[i - 1] !== '' && row[i - 1] != null) { width = Math.max(width, i); break; }
    });
    return width;
  }
  cell(row, col) {
    const r = this.grid[row - 1];
    const v = r ? r[col - 1] : '';
    return v == null ? '' : v;
  }
  getRange(row, col, numRows, numCols) {
    const sheet = this, rows = numRows || 1, cols = numCols || 1;
    const read = () => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => sheet.cell(row + i, col + j)));
    return {
      getValues: read,
      getDisplayValues: () => read().map(r => r.map(v => String(v))),
      getFormulas: () => read().map(r => r.map(() => '')),
      getValue: () => sheet.cell(row, col),
      getDisplayValue: () => String(sheet.cell(row, col)),
      setValues(values) {
        sheet.writes.push({ row, col, rows: values.length, cols: values[0].length, values: values.map(r => r.slice()) });
        values.forEach((vals, i) => vals.forEach((v, j) => {
          while (sheet.grid.length < row + i) sheet.grid.push([]);
          const target = sheet.grid[row + i - 1];
          while (target.length < col + j) target.push('');
          target[col + j - 1] = v;
        }));
        return this;
      },
      getRow: () => row,
      getColumn: () => col
    };
  }
  insertRowsAfter(_after, count) { this.maxRows = Math.max(this.maxRows, this.grid.length) + count; }
  getSheetId() { return this.name; }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets; }
  getSheetByName(name) { return this.sheets.find(s => s.getName() === name) || null; }
  getId() { return 'fake-spreadsheet-id'; }
}

module.exports = { loadProject, plain, FakeSheet, FakeSpreadsheet, ROOT };
