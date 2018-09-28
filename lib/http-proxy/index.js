const httpProxy = module.exports;
const {extend} = require('util');
const {parse} = require('url');
const EE3 = require('eventemitter3');
const http = require('http');
const https = require('https');
const web = require('./passes/web-incoming');
const ws = require('./passes/ws-incoming');

/**
 * Returns a function that creates the loader for
 * either `ws` or `web`'s  passes.
 *
 * Examples:
 *
 *    httpProxy.createRightProxy('ws')
 *    // => [Function]
 *
 * @param {String} Type Either 'ws' or 'web'
 * 
 * @return {Function} Loader Function that when called returns an iterator for the right passes
 *
 * @api private
 */

function createRightProxy(type) {

  return options => function(req, res /*, [head], [opts] */) {
    const passes = (type === 'ws') ? this.wsPasses : this.webPasses;
    const args = [].slice.call(arguments);
    let cntr = args.length - 1;
    let head;
    let cbl;

    /* optional args parse begin */
    if(typeof args[cntr] === 'function') {
      cbl = args[cntr];

      cntr--;
    }

    let requestOptions = options;
    if(
      !(args[cntr] instanceof Buffer) &&
      args[cntr] !== res
    ) {
      //Copy global options
      requestOptions = extend({}, options);
      //Overwrite with request options
      extend(requestOptions, args[cntr]);

      cntr--;
    }

    if(args[cntr] instanceof Buffer) {
      head = args[cntr];
    }

    /* optional args parse end */

    ['target', 'forward'].forEach(e => {
      if (typeof requestOptions[e] === 'string')
        requestOptions[e] = parse(requestOptions[e]);
    });

    if (!requestOptions.target && !requestOptions.forward) {
      return this.emit('error', new Error('Must provide a proper URL as target'));
    }

    for(let i=0; i < passes.length; i++) {
      /**
       * Call of passes functions
       * pass(req, res, options, head)
       *
       * In WebSockets case the `res` variable
       * refer to the connection socket
       * pass(req, socket, options, head)
       */
      if(passes[i](req, res, requestOptions, head, this, cbl)) { // passes can return a truthy value to halt the loop
        break;
      }
    }
  };
}

httpProxy.createRightProxy = createRightProxy;

class ProxyServer extends EE3 {
  constructor(options) {
    super();

    options = options || {};
    options.prependPath = options.prependPath === false ? false : true;

    this.web = this.proxyRequest           = createRightProxy('web')(options);
    this.ws  = this.proxyWebsocketRequest  = createRightProxy('ws')(options);
    this.options = options;

    this.webPasses = Object.keys(web).map(pass => web[pass]);

    this.wsPasses = Object.keys(ws).map(pass => ws[pass]);

    this.on('error', this.onError, this);

  }

  onError(err) {
    //
    // Remark: Replicate node core behavior using EE3
    // so we force people to handle their own errors
    //
    if(this.listeners('error').length === 1) {
      throw err;
    }
  }

  listen(port, hostname) {
    const self    = this;
    const closure = (req, res) => { self.web(req, res); };

    this._server  = this.options.ssl ?
      https.createServer(this.options.ssl, closure) :
      http.createServer(closure);

    if(this.options.ws) {
      this._server.on('upgrade', (req, socket, head) => { self.ws(req, socket, head); });
    }

    this._server.listen(port, hostname);

    return this;
  }

  close(callback) {
    const self = this;
    if (this._server) {
      this._server.close(done);
    }

    // Wrap callback to nullify server after all open connections are closed.
    function done(...args) {
      self._server = null;
      if (callback) {
        callback(...args);
      }
    };
  }

  before(type, passName, callback) {
    if (type !== 'ws' && type !== 'web') {
      throw new Error('type must be `web` or `ws`');
    }
    const passes = (type === 'ws') ? this.wsPasses : this.webPasses;
    let i = false;

    passes.forEach(({name}, idx) => {
      if(name === passName) i = idx;
    })

    if(i === false) throw new Error('No such pass');

    passes.splice(i, 0, callback);
  }

  after(type, passName, callback) {
    if (type !== 'ws' && type !== 'web') {
      throw new Error('type must be `web` or `ws`');
    }
    const passes = (type === 'ws') ? this.wsPasses : this.webPasses;
    let i = false;

    passes.forEach(({name}, idx) => {
      if(name === passName) i = idx;
    })

    if(i === false) throw new Error('No such pass');

    passes.splice(i++, 0, callback);
  }
}

httpProxy.Server = ProxyServer;

module.exports = httpProxy;