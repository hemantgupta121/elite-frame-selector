/* Creates a self-signed certificate in ./certs so the tablet gets HTTPS (needed for the live camera preview). */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = path.join(__dirname, '..', 'certs');
fs.mkdirSync(dir, { recursive: true });
const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
const san = ['DNS:localhost', 'IP:127.0.0.1'].concat(ips.map((ip) => 'IP:' + ip)).join(',');
const candidates = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'];
let done = false;
for (const bin of candidates) {
  try {
    execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
      '-subj', '/CN=Elite Frame Finder', '-addext', 'subjectAltName=' + san], { stdio: 'inherit' });
    done = true; break;
  } catch (e) { /* try next */ }
}
if (!done) { console.error('OpenSSL not found. Install Git for Windows (ships openssl) or create certs/key.pem + certs/cert.pem another way.'); process.exit(1); }
console.log('Certificate written to certs/. Restart the server; open the https:// address on the tablet and accept the warning once.');
