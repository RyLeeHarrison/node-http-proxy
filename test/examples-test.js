/*
  examples-test.js: Test to run all the examples

  Copyright (c) 2013 - 2016 Charlie Robbins, Jarrett Cruger & the Contributors.

*/

const path = require('path');
const fs = require('fs');
const {spawn} = require('child_process');
const expect = require('expect.js');
const async = require('async');
const rootDir = path.join(__dirname, '..');
const examplesDir = path.join(rootDir, 'examples');

describe.skip('http-proxy examples', () => {
  describe('Before testing examples', function () {
    // Set a timeout to avoid this error
    this.timeout(30 * 1000);
    it('should have installed dependencies', done => {
      async.waterfall([
        //
        // 1. Read files in examples dir
        //
        async.apply(fs.readdir, examplesDir),
        //
        // 2. If node_modules exists, continue. Otherwise
        // exec `npm` to install them
        //
        function checkNodeModules(files, next) {
          if (files.includes('node_modules')) {
            return next();
          }

          console.log('Warning: installing dependencies, this operation could take a while');

          const child = spawn('npm', ['install', '-f'], {
            cwd: examplesDir
          });

          child.on('exit', code => code
            ? next(new Error('npm install exited with non-zero exit code'))
            : next());
        },
        //
        // 3. Read files in examples dir again to ensure the install
        // worked as expected.
        //
        async.apply(fs.readdir, examplesDir),
      ], done);
    })
  });

  describe('Requiring all the examples', () => {
    it('should have no errors', done => {
      async.each(['balancer', 'http', 'middleware', 'websocket'], (dir, cb) => {
        const name = `examples/${dir}`;
        const files = fs.readdirSync(path.join(rootDir, 'examples', dir));

        async.each(files, (file, callback) => {
          let example;
          expect(() => { example = require(path.join(examplesDir, dir, file)); }).to.not.throwException();
          expect(example).to.be.an('object');
          callback();
        }, cb);
      }, done);
    })
  })
})