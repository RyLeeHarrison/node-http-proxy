const url = require('url');
const required = require('requires-port');

const upgradeHeader = /(^|,)\s*upgrade\s*($|,)/i;

/**
 * Simple Regex for testing if protocol is https
 */
const isSSL = /^https|wss/;

/**
 * Copies the right headers from `options` and `req` to
 * `outgoing` which is then used to fire the proxied
 * request.
 *
 * Examples:
 *
 *    setupOutgoing(outgoing, options, req)
 *    // => { host: ..., hostname: ...}
 *
 * @param {Object} Outgoing Base object to be filled with required properties
 * @param {Object} Options Config object passed to the proxy
 * @param {ClientRequest} Req Request Object
 * @param {String} Forward String to select forward or target
 * 
 * @return {Object} Outgoing Object with all required properties set
 *
 * @api private
 */

const setupOutgoing = (outgoing, options, req, forward) => {
  outgoing.port = options[forward || 'target'].port || (
    isSSL.test(options[forward || 'target'].protocol)
      ? 443
      : 80
  );

  [ 'host',
    'hostname',
    'socketPath',
    'pfx',
    'key',
    'passphrase',
    'cert',
    'ca',
    'ciphers',
    'secureProtocol'
  ].forEach(e => {
    outgoing[e] = options[forward || 'target'][e];
  });

  outgoing.method = options.method || req.method;
  outgoing.headers = Object.assign({}, req.headers);

  if (options.headers){
    Object.assign(outgoing.headers, options.headers);
  }

  if (options.auth) {
    outgoing.auth = options.auth;
  }
  
  if (options.ca) {
      outgoing.ca = options.ca;
  }

  if (isSSL.test(options[forward || 'target'].protocol)) {
    outgoing.rejectUnauthorized = (typeof options.secure === "undefined") ? true : options.secure;
  }


  outgoing.agent = options.agent || false;
  outgoing.localAddress = options.localAddress;

  //
  // Remark: If we are false and not upgrading, set the connection: close. This is the right thing to do
  // as node core doesn't handle this COMPLETELY properly yet.
  //
  if (!outgoing.agent) {
    outgoing.headers = outgoing.headers || {};
    if (typeof outgoing.headers.connection !== 'string'
        || !upgradeHeader.test(outgoing.headers.connection)
       ) { outgoing.headers.connection = 'close'; }
  }


  // the final path is target path + relative path requested by user:
  const target = options[forward || 'target'];
  const targetPath = target && options.prependPath !== false
    ? (target.path || '')
    : '';

  //
  // Remark: Can we somehow not use url.parse as a perf optimization?
  //
  let outgoingPath = !options.toProxy
    ? (url.parse(req.url).path || '')
    : req.url;

  //
  // Remark: ignorePath will just straight up ignore whatever the request's
  // path is. This can be labeled as FOOT-GUN material if you do not know what
  // you are doing and are using conflicting options.
  //
  outgoingPath = !options.ignorePath ? outgoingPath : '';

  outgoing.path = urlJoin(targetPath, outgoingPath);

  if (options.changeOrigin) {
    outgoing.headers.host =
      required(outgoing.port, options[forward || 'target'].protocol) && !hasPort(outgoing.host)
        ? `${outgoing.host}:${outgoing.port}`
        : outgoing.host;
  }
  return outgoing;
};

/**
 * Set the proper configuration for sockets,
 * set no delay and set keep alive, also set
 * the timeout to 0.
 *
 * Examples:
 *
 *    const setupSocket(socket)
 *    // => Socket
 *
 * @param {Socket} Socket instance to setup
 * 
 * @return {Socket} Return the configured socket.
 *
 * @api private
 */

const setupSocket = socket => {
  socket.setTimeout(0);
  socket.setNoDelay(true);

  socket.setKeepAlive(true, 0);

  return socket;
};

/**
 * Get the port number from the host. Or guess it based on the connection type.
 *
 * @param {Request} req Incoming HTTP request.
 *
 * @return {String} The port number.
 *
 * @api private
 */
const getPort = req => {
  const res = req.headers.host ? req.headers.host.match(/:(\d+)/) : '';

  return res ?
    res[1] :
    hasEncryptedConnection(req) ? '443' : '80';
};

/**
 * Check if the request has an encrypted connection.
 *
 * @param {Request} req Incoming HTTP request.
 *
 * @return {Boolean} Whether the connection is encrypted or not.
 *
 * @api private
 */
const hasEncryptedConnection = ({connection}) => Boolean(connection.encrypted || connection.pair);

/**
 * OS-agnostic join (doesn't break on URLs like path.join does on Windows)>
 *
 * @return {String} The generated path.
 *
 * @api private
 */

const urlJoin = function() {
  //
  // We do not want to mess with the query string. All we want to touch is the path.
  //
  const args = Array.prototype.slice.call(arguments);

  const lastIndex = args.length - 1;
  const last = args[lastIndex];
  const lastSegs = last.split('?');
  let retSegs;

  args[lastIndex] = lastSegs.shift();

  //
  // Join all strings, but remove empty strings so we don't get extra slashes from
  // joining e.g. ['', 'am']
  //
  retSegs = [
    args.filter(Boolean).join('/')
        .replace(/\/+/g, '/')
        .replace('http:/', 'http://')
        .replace('https:/', 'https://')
  ];

  // Only join the query string if it exists so we don't have trailing a '?'
  // on every request

  // Handle case where there could be multiple ? in the URL.
  retSegs.push(...lastSegs);

  return retSegs.join('?')
};

/**
 * Rewrites or removes the domain of a cookie header
 *
 * @param {String|Array} Header
 * @param {Object} Config, mapping of domain to rewritten domain.
 *                 '*' key to match any domain, null value to remove the domain.
 *
 * @api private
 */
const rewriteCookieProperty = (header, config, property) => {
  if (Array.isArray(header)) {
    return header.map(headerElement => rewriteCookieProperty(headerElement, config, property));
  }
  return header.replace(new RegExp(`(;\\s*${property}=)([^;]+)`, 'i'), (match, prefix, previousValue) => {
    let newValue;
    if (previousValue in config) {
      newValue = config[previousValue];
    } else if ('*' in config) {
      newValue = config['*'];
    } else {
      //no match, return previous value
      return match;
    }
    if (newValue) {
      //replace value
      return prefix + newValue;
    } else {
      //remove value
      return '';
    }
  });
};

/**
 * Check the host and see if it potentially has a port in it (keep it simple)
 *
 * @returns {Boolean} Whether we have one or not
 *
 * @api private
 */

const hasPort = (host) => !!~host.indexOf(':'); // !!new URL(host).port
module.exports = {
  isSSL,
  setupOutgoing,
  urlJoin,
  setupSocket,
  getPort,
  hasEncryptedConnection,
  rewriteCookieProperty,
}