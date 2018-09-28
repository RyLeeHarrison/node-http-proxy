const httpProxy = require('../lib/http-proxy');
const expect = require('expect.js');
const http = require('http');
const net = require('net');
const ws = require('ws');
const io = require('socket.io');
const SSE = require('sse');
const ioClient = require('socket.io-client');

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
  describe('#createProxyServer', () => {
    it.skip('should throw without options', () => {
      let error;
      try {
        httpProxy.createProxyServer();
      } catch(e) {
        error = e;
      }

      expect(error).to.be.an(Error);
    })

    it('should return an object otherwise', () => {
      const obj = httpProxy.createProxyServer({
        target: 'http://www.google.com:80'
      });

      expect(obj.web).to.be.a(Function);
      expect(obj.ws).to.be.a(Function);
      expect(obj.listen).to.be.a(Function);
    });
  });

  describe('#createProxyServer with forward options and using web-incoming passes', () => {
    it('should pipe the request using web-incoming#stream method', done => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
        forward: `http://127.0.0.1:${ports.source}`
      }).listen(ports.proxy);

      const source = http.createServer(({method, headers}, res) => {
        expect(method).to.eql('GET');
        expect(headers.host.split(':')[1]).to.eql(ports.proxy);
        source.close();
        proxy.close();
        done();
      });

      source.listen(ports.source);
      http.request(`http://127.0.0.1:${ports.proxy}`, () => {}).end();
    })
  });

  describe('#createProxyServer using the web-incoming passes', () => {
    it('should proxy sse', done => {
      const ports = { source: gen.port, proxy: gen.port };

      const proxy = httpProxy.createProxyServer({
        target: `http://localhost:${ports.source}`,
      });

      const proxyServer = proxy.listen(ports.proxy);
      const source = http.createServer();
      const sse = new SSE(source, {path: '/'});

      sse.on('connection', client => {
        client.send('Hello over SSE');
        client.close();
      });

      source.listen(ports.source);

      const options = {
        hostname: 'localhost',
        port: ports.proxy,
      };

      const req = http.request(options, res => {
        let streamData = '';
        res.on('data', chunk => {
          streamData += chunk.toString('utf8');
        });
        res.on('end', chunk => {
          expect(streamData).to.equal(':ok\n\ndata: Hello over SSE\n\n');
          source.close();
          proxy.close();
          done();
        });
      }).end();
    });

    it('should make the request on pipe and finish it', done => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
        target: `http://127.0.0.1:${ports.source}`
      }).listen(ports.proxy);

      const source = http.createServer(({method, headers}, res) => {
        expect(method).to.eql('POST');
        expect(headers['x-forwarded-for']).to.eql('127.0.0.1');
        expect(headers.host.split(':')[1]).to.eql(ports.proxy);
        source.close();
        proxy.close();
        done();
      });

      source.listen(ports.source);

      http.request({
        hostname: '127.0.0.1',
        port: ports.proxy,
        method: 'POST',
        headers: {
          'x-forwarded-for': '127.0.0.1'
        }
      }, () => {}).end();
    });
  });

  describe('#createProxyServer using the web-incoming passes', () => {
    it('should make the request, handle response and finish it', done => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
        target: `http://127.0.0.1:${ports.source}`,
        preserveHeaderKeyCase: true
      }).listen(ports.proxy);

      const source = http.createServer(({method, headers}, res) => {
        expect(method).to.eql('GET');
        expect(headers.host.split(':')[1]).to.eql(ports.proxy);
        res.writeHead(200, {'Content-Type': 'text/plain'})
        res.end(`Hello from ${source.address().port}`);
      });

      source.listen(ports.source);

      http.request({
        hostname: '127.0.0.1',
        port: ports.proxy,
        method: 'GET'
      }, res => {
        expect(res.statusCode).to.eql(200);
        expect(res.headers['content-type']).to.eql('text/plain');
        if (res.rawHeaders != undefined) {
          expect(res.rawHeaders.indexOf('Content-Type')).not.to.eql(-1);
          expect(res.rawHeaders.indexOf('text/plain')).not.to.eql(-1);
        }

        res.on('data', data => {
          expect(data.toString()).to.eql(`Hello from ${ports.source}`);
        });

        res.on('end', () => {
          source.close();
          proxy.close();
          done();
        });
      }).end();
    });
  });

  describe('#createProxyServer() method with error response', () => {
    it('should make the request and emit the error event', done => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
        target: `http://127.0.0.1:${ports.source}`
      });

      proxy.on('error', err => {
        expect(err).to.be.an(Error);
        expect(err.code).to.be('ECONNREFUSED');
        proxy.close();
        done();
      })

      proxy.listen(ports.proxy);

      http.request({
        hostname: '127.0.0.1',
        port: ports.proxy,
        method: 'GET',
      }, () => {}).end();
    });
  });

  describe('#createProxyServer setting the correct timeout value', () => {
    it('should hang up the socket at the timeout', function (done) {
      this.timeout(30);
      const ports = {
        source: gen.port,
        proxy: gen.port
      };
      const proxy = httpProxy.createProxyServer({
        target: `http://127.0.0.1:${ports.source}`,
        timeout: 3
      }).listen(ports.proxy);

      proxy.on('error', e => {
        expect(e).to.be.an(Error);
        expect(e.code).to.be.eql('ECONNRESET');
      });

      const source = http.createServer((req, res) => {
        setTimeout(() => {
          res.end('At this point the socket should be closed');
        }, 5)
      });

      source.listen(ports.source);

      const testReq = http.request({
        hostname: '127.0.0.1',
        port: ports.proxy,
        method: 'GET',
      }, () => {});

      testReq.on('error', e => {
        expect(e).to.be.an(Error);
        expect(e.code).to.be.eql('ECONNRESET');
        proxy.close();
        source.close();
        done();
      });

      testReq.end();
    });
  });

  describe('#createProxyServer with xfwd option', () => {
    it('should not throw on empty http host header', done => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
        forward: `http://127.0.0.1:${ports.source}`,
        xfwd: true
      }).listen(ports.proxy);

      const source = http.createServer(({method, headers}, res) => {
        expect(method).to.eql('GET');
        expect(headers.host.split(':')[1]).to.eql(ports.source);
        source.close();
        proxy.close();
        done();
      });

      source.listen(ports.source);

      const socket = net.connect({port: ports.proxy}, () => {
        socket.write('GET / HTTP/1.0\r\n\r\n');
      });

      // handle errors
      socket.on('error', () => {
        expect.fail('Unexpected socket error');
      });

      socket.on('data', data => {
        socket.end();
      });

      socket.on('end', () => {
        expect('Socket to finish').to.be.ok();
      });

//      http.request('http://127.0.0.1:' + ports.proxy, function() {}).end();
    })
  });

  // describe('#createProxyServer using the web-incoming passes', function () {
  //   it('should emit events correctly', function(done) {
  //     var proxy = httpProxy.createProxyServer({
  //       target: 'http://127.0.0.1:8080'
  //     }),

  //     proxyServer = proxy.listen('8081'),

  //     source = http.createServer(function(req, res) {
  //       expect(req.method).to.eql('GET');
  //       expect(req.headers.host.split(':')[1]).to.eql('8081');
  //       res.writeHead(200, {'Content-Type': 'text/plain'})
  //       res.end('Hello from ' + source.address().port);
  //     }),

  //     events = [];

  //     source.listen('8080');

  //     proxy.ee.on('http-proxy:**', function (uno, dos, tres) {
  //       events.push(this.event);
  //     })

  //     http.request({
  //       hostname: '127.0.0.1',
  //       port: '8081',
  //       method: 'GET',
  //     }, function(res) {
  //       expect(res.statusCode).to.eql(200);

  //       res.on('data', function (data) {
  //         expect(data.toString()).to.eql('Hello from 8080');
  //       });

  //       res.on('end', function () {
  //         expect(events).to.contain('http-proxy:outgoing:web:begin');
  //         expect(events).to.contain('http-proxy:outgoing:web:end');
  //         source.close();
  //         proxyServer.close();
  //         done();
  //       });
  //     }).end();
  //   });
  // });

  describe('#createProxyServer using the ws-incoming passes', () => {
    it('should proxy the websockets stream', done => {
      const ports = {
        source: gen.port,
        proxy: gen.port
      };

      const proxy = httpProxy.createProxyServer({
        target: `ws://127.0.0.1:${ports.source}`,
        ws: true
      });

      const proxyServer = proxy.listen(ports.proxy);

      const destiny = new ws.Server({port: ports.source}, () => {
        const client = new ws(`ws://127.0.0.1:${ports.proxy}`);

        client.on('open', () => client.send('hello there'));

        client.on('message', msg => {
          expect(msg).to.be('Hello over websockets');
          client.close();
          proxyServer.close();
          destiny.close();
          done();
        });
      });

      destiny.on('connection', socket => {
        socket.on('message', msg => {
          expect(msg).to.be('hello there');
          socket.send('Hello over websockets');
        });
      });
    });

    it('should emit error on proxy error', done => {
      const ports = { source: gen.port, proxy: gen.port };

      const proxy = httpProxy.createProxyServer({
        // note: we don't ever listen on this port
        target: `ws://127.0.0.1:${ports.source}`,
        ws: true
      });

      const proxyServer = proxy.listen(ports.proxy);
      const client = new ws(`ws://127.0.0.1:${ports.proxy}`);

      client.on('open', () => {
        client.send('hello there');
      });

      let count = 0;
      const maybe_done = () => {
        count += 1;
        if (count === 2) done();
      }

      client.on('error', err => {
        expect(err).to.be.an(Error);
        expect(err.code).to.be('ECONNRESET');
        maybe_done();
      });

      proxy.on('error', err => {
        expect(err).to.be.an(Error);
        expect(err.code).to.be('ECONNREFUSED');
        proxyServer.close();
        maybe_done();
      });
    });

    it('should close client socket if upstream is closed before upgrade', done => {
      const ports = { source: gen.port, proxy: gen.port };
      const server = http.createServer();
      server.on('upgrade', (req, socket, head) => {
        const response = [
          'HTTP/1.1 404 Not Found',
          'Content-type: text/html',
          '',
          ''
        ];
        socket.write(response.join('\r\n'));
        socket.end();
      });
      server.listen(ports.source);

      const proxy = httpProxy.createProxyServer({
        // note: we don't ever listen on this port
        target: `ws://127.0.0.1:${ports.source}`,
        ws: true
      });

      const proxyServer = proxy.listen(ports.proxy);
      const client = new ws(`ws://127.0.0.1:${ports.proxy}`);

      client.on('open', () => {
        client.send('hello there');
      });

      client.on('error', err => {
        expect(err).to.be.an(Error);
        proxyServer.close();
        done();
      });
    });

    it('should proxy a socket.io stream', done => {
      const ports = { source: gen.port, proxy: gen.port };

      const proxy = httpProxy.createProxyServer({
        target: `ws://127.0.0.1:${ports.source}`,
        ws: true
      });

      const proxyServer = proxy.listen(ports.proxy);
      const server = http.createServer();
      const destiny = io.listen(server);

      function startSocketIo() {
        const client = ioClient.connect(`ws://127.0.0.1:${ports.proxy}`);

        client.on('connect', () => {
          client.emit('incoming', 'hello there');
        });

        client.on('outgoing', data => {
          expect(data).to.be('Hello over websockets');
          proxyServer.close();
          server.close();
          done();
        });
      }
      server.listen(ports.source);
      server.on('listening', startSocketIo);

      destiny.sockets.on('connection', socket => {
        socket.on('incoming', msg => {
          expect(msg).to.be('hello there');
          socket.emit('outgoing', 'Hello over websockets');
        });
      })
    });


    it('should emit open and close events when socket.io client connects and disconnects', done => {
      const ports = { source: gen.port, proxy: gen.port };
      const proxy = httpProxy.createProxyServer({
        target: `ws://127.0.0.1:${ports.source}`,
        ws: true
      });
      const proxyServer = proxy.listen(ports.proxy);
      const server = http.createServer();
      const destiny = io.listen(server);

      function startSocketIo() {
        const client = ioClient.connect(`ws://127.0.0.1:${ports.proxy}`, {rejectUnauthorized: null});
        client.on('connect', () => {
          client.disconnect();
        });
      }
      let count = 0;

      proxyServer.on('open', () => {
        count += 1;

      });

      proxyServer.on('close', () => {
        proxyServer.close();
        server.close();
        destiny.close();
        if (count == 1) { done(); }
      });

      server.listen(ports.source);
      server.on('listening', startSocketIo);

    });

    it('should pass all set-cookie headers to client', done => {
      const ports = { source: gen.port, proxy: gen.port };

      const proxy = httpProxy.createProxyServer({
        target: `ws://127.0.0.1:${ports.source}`,
        ws: true
      });

      const proxyServer = proxy.listen(ports.proxy);

      const destiny = new ws.Server({ port: ports.source }, () => {
        const key = new Buffer(Math.random().toString()).toString('base64');

        const requestOptions = {
          port: ports.proxy,
          host: '127.0.0.1',
          headers: {
            'Connection': 'Upgrade',
            'Upgrade': 'websocket',
            'Host': 'ws://127.0.0.1',
            'Sec-WebSocket-Version': 13,
            'Sec-WebSocket-Key': key
          }
        };

        const req = http.request(requestOptions);

        req.on('upgrade', ({headers}, socket, upgradeHead) => {
          expect(headers['set-cookie'].length).to.be(2);
          done();
        });

        req.end();
      });

      destiny.on('headers', headers => {
        headers.push('Set-Cookie: test1=test1');
        headers.push('Set-Cookie: test2=test2');
      });
    });

    it('should detect a proxyReq event and modify headers', done => {
      const ports = { source: gen.port, proxy: gen.port };
      let proxy;
      let proxyServer;
      let destiny;

      proxy = httpProxy.createProxyServer({
        target: `ws://127.0.0.1:${ports.source}`,
        ws: true
      });

      proxy.on('proxyReqWs', (proxyReq, req, socket, options, head) => {
        proxyReq.setHeader('X-Special-Proxy-Header', 'foobar');
      });

      proxyServer = proxy.listen(ports.proxy);

      destiny = new ws.Server({ port: ports.source }, () => {
        const client = new ws(`ws://127.0.0.1:${ports.proxy}`);

        client.on('open', () => {
          client.send('hello there');
        });

        client.on('message', msg => {
          expect(msg).to.be('Hello over websockets');
          client.close();
          proxyServer.close();
          destiny.close();
          done();
        });
      });

      destiny.on('connection', socket => {
        expect(socket.upgradeReq.headers['x-special-proxy-header']).to.eql('foobar');

        socket.on('message', msg => {
          expect(msg).to.be('hello there');
          socket.send('Hello over websockets');
        });
      });
    });

    it('should forward frames with single frame payload (including on node 4.x)', done => {
      const payload = Array(65529).join('0');
      const ports = { source: gen.port, proxy: gen.port };

      const proxy = httpProxy.createProxyServer({
        target: `ws://127.0.0.1:${ports.source}`,
        ws: true
      });

      const proxyServer = proxy.listen(ports.proxy);

      const destiny = new ws.Server({ port: ports.source }, () => {
        const client = new ws(`ws://127.0.0.1:${ports.proxy}`);

        client.on('open', () => {
          client.send(payload);
        });

        client.on('message', msg => {
          expect(msg).to.be('Hello over websockets');
          client.close();
          proxyServer.close();
          destiny.close();
          done();
        });
      });

      destiny.on('connection', socket => {
        socket.on('message', msg => {
          expect(msg).to.be(payload);
          socket.send('Hello over websockets');
        });
      });
    });

    it('should forward continuation frames with big payload (including on node 4.x)', done => {
      const payload = Array(65530).join('0');
      const ports = { source: gen.port, proxy: gen.port };

      const proxy = httpProxy.createProxyServer({
        target: `ws://127.0.0.1:${ports.source}`,
        ws: true
      });

      const proxyServer = proxy.listen(ports.proxy);

      const destiny = new ws.Server({ port: ports.source }, () => {
        const client = new ws(`ws://127.0.0.1:${ports.proxy}`);

        client.on('open', () => {
          client.send(payload);
        });

        client.on('message', msg => {
          expect(msg).to.be('Hello over websockets');
          client.close();
          proxyServer.close();
          destiny.close();
          done();
        });
      });

      destiny.on('connection', socket => {
        socket.on('message', msg => {
          expect(msg).to.be(payload);
          socket.send('Hello over websockets');
        });
      });
    });
  });
});
