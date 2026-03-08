#!/usr/bin/env node
/**
 * dbw.test.js — Tests for dbw.js multi-statement SQL support (T1155)
 *
 * Run: node scripts/__tests__/dbw.test.js
 *
 * Uses sql.js directly to verify the exec() vs prepare() branching logic
 * without touching the real project.db.
 */

const initSqlJs = require('sql.js')
const assert = require('assert')

async function runTests() {
  const SQL = await initSqlJs()
  let passed = 0
  let failed = 0

  function test(name, fn) {
    try {
      fn(SQL)
      passed++
      console.log(`  ✓ ${name}`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${name}`)
      console.error(`    ${err.message}`)
    }
  }

  console.log('dbw.js — multi-statement support\n')

  test('db.exec() executes multiple statements separated by ;', (SQL) => {
    const db = new SQL.Database()
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    db.exec("INSERT INTO t (val) VALUES ('a'); INSERT INTO t (val) VALUES ('b');")
    const rows = db.exec('SELECT val FROM t ORDER BY id')
    assert.strictEqual(rows[0].values.length, 2, 'Expected 2 rows')
    assert.strictEqual(rows[0].values[0][0], 'a')
    assert.strictEqual(rows[0].values[1][0], 'b')
    db.close()
  })

  test('db.prepare() only executes the first statement (proves the bug)', (SQL) => {
    const db = new SQL.Database()
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    const stmt = db.prepare("INSERT INTO t (val) VALUES ('a'); INSERT INTO t (val) VALUES ('b');")
    stmt.run()
    stmt.free()
    const rows = db.exec('SELECT val FROM t ORDER BY id')
    assert.strictEqual(rows[0].values.length, 1, 'prepare() should only insert 1 row')
    assert.strictEqual(rows[0].values[0][0], 'a')
    db.close()
  })

  test('db.exec() works with a single statement (backward-compatible)', (SQL) => {
    const db = new SQL.Database()
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    db.exec("INSERT INTO t (val) VALUES ('single')")
    const rows = db.exec('SELECT val FROM t')
    assert.strictEqual(rows[0].values.length, 1)
    assert.strictEqual(rows[0].values[0][0], 'single')
    db.close()
  })

  test('db.prepare() with params still works for single statement', (SQL) => {
    const db = new SQL.Database()
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    const stmt = db.prepare('INSERT INTO t (val) VALUES (?)')
    stmt.run(['parameterized'])
    stmt.free()
    const rows = db.exec('SELECT val FROM t')
    assert.strictEqual(rows[0].values.length, 1)
    assert.strictEqual(rows[0].values[0][0], 'parameterized')
    db.close()
  })

  test('multi-statement INSERT + UPDATE in single exec()', (SQL) => {
    const db = new SQL.Database()
    db.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, status TEXT)')
    db.exec('CREATE TABLE comments (id INTEGER PRIMARY KEY, task_id INT, content TEXT)')
    db.exec("INSERT INTO tasks (id, status) VALUES (1, 'todo')")

    // Simulates the agent ticket-completing pattern
    db.exec(
      "INSERT INTO comments (task_id, content) VALUES (1, 'done comment');\n" +
      "UPDATE tasks SET status = 'done' WHERE id = 1;"
    )

    const comments = db.exec('SELECT content FROM comments WHERE task_id = 1')
    assert.strictEqual(comments[0].values.length, 1, 'Comment should be inserted')
    assert.strictEqual(comments[0].values[0][0], 'done comment')

    const tasks = db.exec('SELECT status FROM tasks WHERE id = 1')
    assert.strictEqual(tasks[0].values[0][0], 'done', 'Status should be updated to done')
    db.close()
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

runTests()
