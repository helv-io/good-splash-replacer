#!/usr/bin/env node
// Writes the webosbrew repository manifest for a built ipk.
//   node tools/manifest.js <ipk> <download base URL>   prints the manifest JSON
'use strict';
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const [ipk, baseUrl] = process.argv.slice(2);
if (!ipk || !baseUrl) { console.error('usage: tools/manifest.js <ipk> <download base URL>'); process.exit(2); }
const info = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'appinfo.json'), 'utf8'));
const repo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'service', 'config.json'), 'utf8')).repo;
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(ipk)).digest('hex');
process.stdout.write(JSON.stringify({
  id: info.id, version: info.version, type: 'web', title: info.title,
  appDescription: 'Replace the LG power-off logo with your own image',
  iconUri: 'https://raw.githubusercontent.com/' + repo + '/master/app/icons/icon130.png',
  sourceUrl: 'https://github.com/' + repo,
  rootRequired: true,
  ipkUrl: baseUrl.replace(/\/$/, '') + '/' + path.basename(ipk),
  ipkHash: { sha256 },
}, null, 2) + '\n');
