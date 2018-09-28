const httpProxy = require('../lib/http-proxy');
const semver = require('semver');
const expect = require('expect.js');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

//
// Expose a port number generator.
// thanks to @3rd-Eden
//
let initialPort = 1024;

const gen = {};
Object.defineProperty(gen, 'port', {
  get: function get() {
    return initialPort++;
  }
});

describe('lib/http-proxy.js', () => {
  describe('HTTPS #createProxyServer', () => {
    describe('HTTPS to HTTP', () => {
      it('should proxy the request en send back the response', done => {
        const ports = { source: gen.port, proxy: gen.port };
        const source = http.createServer(({method, headers}, res) => {
          expect(method).to.eql('GET');
          expect(headers.host.split(':')[1]).to.eql(ports.proxy);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(`Hello from ${ports.source}`);
        });

        source.listen(ports.source);

        const proxy = httpProxy.createProxyServer({
          target: `http://127.0.0.1:${ports.source}`,
          ssl: {
            key: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-key.pem')),
            cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-cert.pem')),
            ciphers: 'AES128-GCM-SHA256',
          }
        }).listen(ports.proxy);

        https.request({
          host: 'localhost',
          port: ports.proxy,
          path: '/',
          method: 'GET',
          rejectUnauthorized: false
        }, res => {
          expect(res.statusCode).to.eql(200);

          res.on('data', data => {
            expect(data.toString()).to.eql(`Hello from ${ports.source}`);
          });

          res.on('end', () => {
            source.close();
            proxy.close();
            done();
          })
        }).end();
      })
    });
    describe('HTTP to HTTPS', () => {
      it('should proxy the request en send back the response', done => {
        const ports = { source: gen.port, proxy: gen.port };
        const source = https.createServer({
          key: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-key.pem')),
          cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-cert.pem')),
          ciphers: 'AES128-GCM-SHA256',
        }, ({method, headers}, res) => {
          expect(method).to.eql('GET');
          expect(headers.host.split(':')[1]).to.eql(ports.proxy);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(`Hello from ${ports.source}`);
        });

        source.listen(ports.source);

        const proxy = httpProxy.createProxyServer({
          target: `https://127.0.0.1:${ports.source}`,
          // Allow to use SSL self signed
          secure: false
        }).listen(ports.proxy);

        http.request({
          hostname: '127.0.0.1',
          port: ports.proxy,
          method: 'GET'
        }, res => {
          expect(res.statusCode).to.eql(200);

          res.on('data', data => {
            expect(data.toString()).to.eql(`Hello from ${ports.source}`);
          });

          res.on('end', () => {
            source.close();
            proxy.close();
            done();
          });
        }).end();
      })
    })
    describe('HTTPS to HTTPS', () => {
      it('should proxy the request en send back the response', done => {
        const ports = { source: gen.port, proxy: gen.port };
        const source = https.createServer({
          key: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-key.pem')),
          cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-cert.pem')),
          ciphers: 'AES128-GCM-SHA256',
        }, ({method, headers}, res) => {
          expect(method).to.eql('GET');
          expect(headers.host.split(':')[1]).to.eql(ports.proxy);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(`Hello from ${ports.source}`);
        });

        source.listen(ports.source);

        const proxy = httpProxy.createProxyServer({
          target: `https://127.0.0.1:${ports.source}`,
          ssl: {
            key: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-key.pem')),
            cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-cert.pem')),
            ciphers: 'AES128-GCM-SHA256',
          },
          secure: false
        }).listen(ports.proxy);

        https.request({
          host: 'localhost',
          port: ports.proxy,
          path: '/',
          method: 'GET',
          rejectUnauthorized: false
        }, res => {
          expect(res.statusCode).to.eql(200);

          res.on('data', data => {
            expect(data.toString()).to.eql(`Hello from ${ports.source}`);
          });

          res.on('end', () => {
            source.close();
            proxy.close();
            done();
          })
        }).end();
      })
    });
    describe('HTTPS not allow SSL self signed', () => {
      it('should fail with error', done => {
        const ports = { source: gen.port, proxy: gen.port };
        const source = https.createServer({
          key: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-key.pem')),
          cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-cert.pem')),
          ciphers: 'AES128-GCM-SHA256',
        }).listen(ports.source);

        const proxy = httpProxy.createProxyServer({
          target: `https://127.0.0.1:${ports.source}`,
          secure: true
        });

        proxy.listen(ports.proxy);

        proxy.on('error', (err, req, res) => {
          expect(err).to.be.an(Error);
          if (semver.gt(process.versions.node, '0.12.0')) {
            expect(err.toString()).to.be('Error: self signed certificate')
          } else {
            expect(err.toString()).to.be('Error: DEPTH_ZERO_SELF_SIGNED_CERT')
          }
          done();
        })

        http.request({
          hostname: '127.0.0.1',
          port: ports.proxy,
          method: 'GET'
        }).end();
      })
    })
    describe('HTTPS to HTTP using own server', () => {
      it('should proxy the request en send back the response', done => {
        const ports = { source: gen.port, proxy: gen.port };
        const source = http.createServer(({method, headers}, res) => {
          expect(method).to.eql('GET');
          expect(headers.host.split(':')[1]).to.eql(ports.proxy);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(`Hello from ${ports.source}`);
        });

        source.listen(ports.source);

        const proxy = httpProxy.createServer({
          agent: new http.Agent({ maxSockets: 2 })
        });

        const ownServer = https.createServer({
          key: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-key.pem')),
          cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'agent2-cert.pem')),
          ciphers: 'AES128-GCM-SHA256',
        }, (req, res) => {
          proxy.web(req, res, {
            target: `http://127.0.0.1:${ports.source}`
          })
        }).listen(ports.proxy);

        https.request({
          host: 'localhost',
          port: ports.proxy,
          path: '/',
          method: 'GET',
          rejectUnauthorized: false
        }, res => {
          expect(res.statusCode).to.eql(200);

          res.on('data', data => {
            expect(data.toString()).to.eql(`Hello from ${ports.source}`);
          });

          res.on('end', () => {
            source.close();
            ownServer.close();
            done();
          })
        }).end();
      })
    })
  });
});
