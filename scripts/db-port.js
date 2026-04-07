#!/usr/bin/env node
/**
 * db-port.js — Deterministic port derivation for the DB daemon.
 *
 * Each KanbAgent project gets a unique port derived from its DB path.
 * The port is in range [BASE_PORT, BASE_PORT + 9999], stable across restarts.
 *
 * Collision probability: ~0.01% with 10 simultaneous projects (birthday paradox over 10000 slots).
 *
 * Shared by:
 *   - scripts/db-server.js  (daemon, listens on this port)
 *   - scripts/db-client.js  (clients, connect to this port)
 *   - src/main/db-daemon.ts (Electron, starts daemon for this port)
 */

const crypto = require('crypto')

const BASE_PORT = 27184

/**
 * Derives a deterministic port number from the absolute DB path.
 * @param {string} dbPath - Absolute path to project.db
 * @returns {number} Port in range [27184, 37183]
 */
function getPort(dbPath) {
  const hash = crypto.createHash('sha1').update(dbPath).digest('hex')
  return BASE_PORT + (parseInt(hash.slice(0, 4), 16) % 10000)
}

module.exports = { getPort, BASE_PORT }
