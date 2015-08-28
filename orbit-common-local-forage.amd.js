define('orbit-common/local-forage-source', ['exports', 'orbit/main', 'orbit/lib/assert', 'orbit/lib/objects', 'orbit-common/memory-source'], function (exports, Orbit, assert, objects, MemorySource) {

  'use strict';

  var supportsLocalStorage = function() {
    try {
      return 'localStorage' in window && window['localStorage'] !== null;
    } catch(e) {
      return false;
    }
  };

  var now = Date.now || function() {
    return new Date().getTime();
  };

  var debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = now() - timestamp;

      if (last < wait && last >= 0) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          if (!timeout) context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = now();
      var callNow = immediate && !timeout;
      if (!timeout) timeout = setTimeout(later, wait);
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  /**
   Source for storing data with local forage (https://github.com/mozilla/localForage)

   @class LocalForageSource
   @extends MemorySource
   @namespace OC
   @param {OC.Schema} schema
   @param {Object}    [options]
   @constructor
   */
  var LocalForageSource = MemorySource['default'].extend({
    init: function(schema, options) {
      assert.assert('Your browser does not support local storage!', supportsLocalStorage()); //needed as final fallback
      assert.assert('No valid local forage object given', options['localforage'] !== undefined);
      assert.assert('Local forage requires Orbit.Promise be defined', Orbit['default'].Promise);

      var _this = this;

      MemorySource['default'].prototype.init.apply(this, arguments);

      options = options || {};
      this.saveDataCallback = options['saveDataCallback'];
      this.loadDataCallback = options['loadDataCallback'];
      this.namespace = options['namespace'] || 'orbit'; // local storage key
      this._autosave = options['autosave'] !== undefined ? options['autosave'] : true;
      this.webSQLSize = options['webSQLSize'] !== undefined ? options['webSQLSize'] : 4980736;
      var autoload = options['autoload'] !== undefined ? options['autoload'] : true;
      this.localforage = options['localforage'];

      this.localforage.config({
        name        : 'orbitjs',
        version     : 1.0,
        size        : this.webSQLSize,
        storeName   : this.namespace,
        description : 'orbitjs localforage adapter'
      });

      this._isDirty = false;

      this.on('didTransform', debounce(function() {
        var promise = _this._saveData();
        if (promise) {
          promise.then(function() {
            if (options.saveDataCallback) setTimeout(_this.saveDataCallback, 0);
          });
        }
      }, 200), this);

      if (autoload) this.load().then(function() {
        if (options.loadDataCallback) setTimeout(options.callback, 0);
      });
    },

    load: function() {
      var _this = this;
      return new Orbit['default'].Promise(function(resolve, reject) {
        _this.localforage.getItem(_this.namespace).then(function(storage){
          if (storage !== null) {
            _this.reset(storage);
          }
          resolve();
        });
      });
    },

    enableAutosave: function() {
      if (!this._autosave) {
        this._autosave = true;
        if (this._isDirty) this._saveData();
      }
    },

    disableAutosave: function() {
      if (this._autosave) {
        this._autosave = false;
      }
    },

    /////////////////////////////////////////////////////////////////////////////
    // Internals
    /////////////////////////////////////////////////////////////////////////////

    _saveData: function(forceSave) {
      var _this = this; //bind not supported in older browsers
      if (!this._autosave && !forceSave) {
        this._isDirty = true;
        return;
      }
      return this.localforage.setItem(this.namespace, this.retrieve()).then(
        function() {
          _this._isDirty = false;
        }
      );

    }
  });

  exports['default'] = LocalForageSource;

});//# sourceMappingURL=orbit-common-local-forage.amd.map