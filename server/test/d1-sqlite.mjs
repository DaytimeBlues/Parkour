import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Executes the production SQL unchanged against SQLite. batch() is a real
// transaction; no JS SQL parser or canned result mocks. Not a D1 emulator.
export class SqliteD1 {
  constructor(filePath = ':memory:') {
    this.sqlite = new DatabaseSync(filePath);
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS test_applied_migrations (name TEXT PRIMARY KEY)');
    const directory = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) {
      if (this.sqlite.prepare('SELECT name FROM test_applied_migrations WHERE name=?').get(name)) continue;
      this.sqlite.exec(readFileSync(new URL(name, directory), 'utf8'));
      this.sqlite.prepare('INSERT INTO test_applied_migrations(name) VALUES(?)').run(name);
    }
    this.metrics = { statements: 0, writes: 0, rowsRead: 0, rowsWritten: 0 };
    this.failBatchStatement = -1;
  }
  prepare(sql) { return new Statement(this, sql, []); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((s, i) => {
        if (i === this.failBatchStatement) throw new Error('Injected batch failure');
        return s.execute();
      });
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}
class Statement {
  constructor(db, sql, values) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  execute() {
    this.db.metrics.statements++;
    const s = this.db.sqlite.prepare(this.sql);
    if (s.columns().length) {
      const results = s.all(...this.values).map(r => ({ ...r }));
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(this.sql)) { this.db.metrics.writes += results.length; this.db.metrics.rowsWritten += results.length; }
      else this.db.metrics.rowsRead += results.reduce((n, row) => n + 1 + (typeof row.live_players_json === 'string' ? JSON.parse(row.live_players_json).length : 0), 0);
      return { success: true, results, meta: {} };
    }
    const meta = s.run(...this.values);
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(this.sql)) { this.db.metrics.writes += Number(meta.changes); this.db.metrics.rowsWritten += Number(meta.changes); }
    return { success: true, results: [], meta: { changes: Number(meta.changes), last_row_id: Number(meta.lastInsertRowid) } };
  }
  async first(column) { const row = this.execute().results[0] ?? null; return column && row ? row[column] : row; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}
