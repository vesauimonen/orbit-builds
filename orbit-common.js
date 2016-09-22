(function() {

// Share loader properties from globalized Orbit package
var define = window.Orbit.__define__;
var requireModule = window.Orbit.__requireModule__;

define('orbit-common', ['exports', 'orbit-common/main', 'orbit-common/cache', 'orbit-common/schema', 'orbit-common/serializer', 'orbit-common/source', 'orbit-common/memory-source', 'orbit-common/transaction', 'orbit-common/operation-processors/operation-processor', 'orbit-common/operation-processors/cache-integrity-processor', 'orbit-common/operation-processors/deletion-tracking-processor', 'orbit-common/operation-processors/schema-consistency-processor', 'orbit-common/lib/exceptions'], function (exports, OC, Cache, Schema, Serializer, Source, MemorySource, Transaction, OperationProcessor, CacheIntegrityProcessor, DeletionTrackingProcessor, SchemaConsistencyProcessor, exceptions) {

	'use strict';

	OC['default'].Cache = Cache['default'];
	OC['default'].Schema = Schema['default'];
	OC['default'].Serializer = Serializer['default'];
	OC['default'].Source = Source['default'];
	OC['default'].MemorySource = MemorySource['default'];
	OC['default'].Transaction = Transaction['default'];
	// operation processors
	OC['default'].OperationProcessor = OperationProcessor['default'];
	OC['default'].CacheIntegrityProcessor = CacheIntegrityProcessor['default'];
	OC['default'].DeletionTrackingProcessor = DeletionTrackingProcessor['default'];
	OC['default'].SchemaConsistencyProcessor = SchemaConsistencyProcessor['default'];
	// exceptions
	OC['default'].OperationNotAllowed = exceptions.OperationNotAllowed;
	OC['default'].RecordNotFoundException = exceptions.RecordNotFoundException;
	OC['default'].LinkNotFoundException = exceptions.LinkNotFoundException;
	OC['default'].ModelNotRegisteredException = exceptions.ModelNotRegisteredException;
	OC['default'].LinkNotRegisteredException = exceptions.LinkNotRegisteredException;
	OC['default'].RecordAlreadyExistsException = exceptions.RecordAlreadyExistsException;

	exports['default'] = OC['default'];

});
define('orbit-common/cache', ['exports', 'orbit/document', 'orbit/operation', 'orbit/lib/objects', 'orbit-common/lib/exceptions', 'orbit/lib/eq', 'orbit/lib/operations', 'orbit-common/operation-processors/cache-integrity-processor', 'orbit-common/operation-processors/schema-consistency-processor', 'orbit/transform-result', 'orbit/lib/diffs'], function (exports, Document, Operation, objects, exceptions, eq, operations, CacheIntegrityProcessor, SchemaConsistencyProcessor, TransformResult, diffs) {

  'use strict';

  exports['default'] = objects.Class.extend({
    init: function(schema, options) {
      this.schema = schema;

      this._doc = new Document['default'](null, {arrayBasedPaths: true});

      options = options || {};
      var processors = options.processors ? options.processors : [ SchemaConsistencyProcessor['default'], CacheIntegrityProcessor['default'] ];
      this._initProcessors(processors);

      this.sparse = options.sparse === undefined ? true : options.sparse;

      // Non-sparse caches should pre-fill data for all models in a schema.
      if (!this.sparse) {
        // Pre-register all models.
        for (var model in schema.models) {
          if (schema.models.hasOwnProperty(model)) {
            this.registerModel(model);
          }
        }

        // Automatically fill data for models as they're registered.
        // TODO - clean up listener
        this.schema.on('modelRegistered', this.registerModel, this);
      }
    },

    _initProcessors: function(processors) {
      this._processors = processors.map(this._initProcessor, this);
    },

    _initProcessor: function(Processor) {
      return new Processor(this);
    },

    _fillSparsePath: function(path) {
      var p;
      for (var i = 0, l = path.length; i < l; i++) {
        p = path.slice(0, i + 1);
        if (!this.exists(p)) {
          this._doc.add(p, {});
        }
      }
    },

    registerModel: function(model) {
      this._fillSparsePath([model]);
    },

    reset: function(data) {
      this._doc.reset(data);
      this.schema.registerAllKeys(data);

      this._processors.forEach(function(processor) {
        processor.reset(data);
      });
    },

    /**
     Return data at a particular path.

     Returns `undefined` if the path does not exist in the document.

     @method retrieve
     @param path
     @returns {Object}
     */
    retrieve: function(path) {
      return this._doc.retrieve(path, true);
    },

    /**
     Return the size of data at a particular path

     @method length
     @param path
     @returns {Number}
     */
    length: function(path) {
      var data = this.retrieve(path);
      if (objects.isArray(data)) {
        return data.length;
      } else if (objects.isObject(data)) {
        return Object.keys(data).length;
      } else {
        return 0;
      }
    },

    /**
     Returns whether a path exists in the document.

     @method exists
     @param path
     @returns {Boolean}
     */
    exists: function(path) {
      return this.retrieve(path) !== undefined;
    },

    /**
     Returns whether a path has been removed from the document.

     By default, this simply returns true if the path doesn't exist.
     However, it may be overridden by an operations processor to provide more
     advanced deletion tracking.

     @method hasDeleted
     @param path
     @returns {Boolean}
     */
    hasDeleted: function(path) {
      return !this.exists(path);
    },

    /**
     Transforms the document with an RFC 6902-compliant operation.

     Currently limited to `add`, `remove` and `replace` operations.

     @method transform
     @param {Array} [ops] Array of operations
     @returns {TransformResult} The result of applying the operations.
     */
    transform: function(ops) {
      var result = new TransformResult['default']();
      ops = this._prepareOperations(ops);
      this._applyOperations(operations.normalizeOperations(ops), result);
      return result;
    },

    _prepareOperations: function(ops) {
      var result = [];

      ops.forEach(function(operation) {
        var currentValue = this.retrieve(operation.path);

        if (objects.isNone(currentValue)) {

          if (operation.op === 'remove' ||
              (operation.op === 'replace' && objects.isNone(operation.value))) {

            // Removing a null value, or replacing it with another null value, is unnecessary
            if (this.hasDeleted(operation.path)) return;
          }

        } else if (operation.op === 'add' || operation.op === 'replace') {
          if (eq.eq(currentValue, operation.value)) {
            // Replacing a value with its equivalent is unnecessary
            return;

          } else {
            var diffOps = diffs.diffs(currentValue, operation.value, { basePath: operation.path });
            Array.prototype.push.apply(result, operations.normalizeOperations(diffOps));
            return;
          }
        }

        result.push(operation);
      }, this);

      return result;
    },

    _applyOperations: function(ops, result) {
      ops.forEach(function(op) {
        this._applyOperation(op, result);
      }, this);
    },

    _applyOperation: function(operation, result) {
      var _this = this;
      var op = operation.op;
      var path = operation.path;
      var value = operation.value;
      var currentValue = this.retrieve(path);
      var relatedOps = [];

      function concatRelatedOps(ops) {
        relatedOps = relatedOps.concat(ops);
      }

      function applyRelatedOps() {
        _this._applyOperations(relatedOps, result);
        relatedOps = [];
      }

      function applyOp(op) {
        result.push(op, _this._doc.transform(op, true));
      }

      // console.log('Cache#transform', op, path.join('/'), value);

      // special case the addition of a `type` collection
      if (op === 'add' && path.length === 1) {
        applyOp(operation);
        return;
      }

      if (op === 'add' || op === 'replace') {
        if (path.length > 1) {
          var parentPath = path.slice(0, path.length - 1);
          if (!this.exists(parentPath)) {
            if (this.sparse && !objects.isNone(value)) {
              this._fillSparsePath(parentPath);
            } else {
              return;
            }
          }
        }
      }

      // console.log('Cache#transform', op, path.join('/'), value);

      if (eq.eq(currentValue, value)) return;

      // Query and perform related `before` operations
      this._processors.forEach(function(processor) {
        concatRelatedOps(processor.before(operation));
      });
      applyRelatedOps();

      // Query related `after` operations before performing
      // the requested operation
      this._processors.forEach(function(processor) {
        concatRelatedOps(processor.after(operation));
      });

      // Perform the requested operation
      applyOp(operation);

      // Perform related `after` operations after performing
      // the requested operation
      applyRelatedOps();

      // Query and perform related `finally` operations
      this._processors.forEach(function(processor) {
        concatRelatedOps(processor.finally(operation));
      });
      applyRelatedOps();
    }
  });

});
define('orbit-common/jsonapi-patch-source', function () {

	'use strict';

	// import { isArray, isObject } from 'orbit/lib/objects';
	// import JSONAPISource from './jsonapi-source';
	//
	// /**
	//  Source for accessing a JSON API compliant RESTful API with AJAX using the
	//  official patch extension
	//
	//  @class JSONAPIPatchSource
	//  @extends Source
	//  @namespace OC
	//  @param schema
	//  @param options
	//  @constructor
	//  */
	// export default JSONAPISource.extend({
	//
	//   /////////////////////////////////////////////////////////////////////////////
	//   // Internals
	//   /////////////////////////////////////////////////////////////////////////////
	//
	//   _transformAdd: function(operation) {
	//     var _this = this;
	//     var type = operation.path[0];
	//     var id = operation.path[1];
	//
	//     var remoteOp = {
	//       op: 'add',
	//       path: '/-',
	//       value: this.serializer.serializeRecord(type, operation.value)
	//     };
	//
	//     return this.ajax(this.resourceURL(type), 'PATCH', {data: [ remoteOp ]}).then(
	//       function(raw) {
	//         if (raw && isArray(raw)) {
	//           _this.deserialize(type, id, raw[0], operation);
	//         } else {
	//           _this._transformCache(operation);
	//         }
	//       }
	//     );
	//   },
	//
	//   _transformReplace: function(operation) {
	//     var _this = this;
	//     var type = operation.path[0];
	//     var id = operation.path[1];
	//     var value = operation.value;
	//
	//     var remoteOp = {
	//       op: 'replace',
	//       path: '/',
	//       value: this.serializer.serializeRecord(type, value)
	//     };
	//
	//     return this.ajax(this.resourceURL(type, id), 'PATCH', {data: [ remoteOp ]}).then(
	//       function(raw) {
	//         if (raw && isArray(raw)) {
	//           _this.deserialize(type, id, raw[0], operation);
	//         } else {
	//           _this._transformCache(operation);
	//         }
	//       }
	//     );
	//   },
	//
	//   _transformRemove: function(operation) {
	//     var _this = this;
	//     var type = operation.path[0];
	//     var id = operation.path[1];
	//
	//     var remoteOp = {
	//       op: 'remove',
	//       path: '/'
	//     };
	//
	//     return this.ajax(this.resourceURL(type, id), 'PATCH', {data: [ remoteOp ]}).then(
	//       function() {
	//         _this._transformCache(operation);
	//       }
	//     );
	//   },
	//
	//   _transformAddLink: function(operation) {
	//     var _this = this;
	//
	//     var type = operation.path[0];
	//     var id = operation.path[1];
	//     var link = operation.path[3];
	//     var relId = operation.path[4] || operation.value;
	//     var linkDef = this.schema.linkDefinition(type, link);
	//     var relType = linkDef.model;
	//     var relResourceId = this.serializer.resourceId(relType, relId);
	//     var remoteOp;
	//
	//     if (linkDef.type === 'hasMany') {
	//       remoteOp = {
	//         op: 'add',
	//         path: '/-',
	//         value: relResourceId
	//       };
	//     } else {
	//       remoteOp = {
	//         op: 'replace',
	//         path: '/',
	//         value: relResourceId
	//       };
	//     }
	//
	//     return this.ajax(this.resourceLinkURL(type, id, link), 'PATCH', {data: [ remoteOp ]}).then(
	//       function() {
	//         _this._transformCache(operation);
	//       }
	//     );
	//   },
	//
	//   _transformRemoveLink: function(operation) {
	//     var _this = this;
	//
	//     var type = operation.path[0];
	//     var id = operation.path[1];
	//     var link = operation.path[3];
	//     var linkDef = this.schema.linkDefinition(type, link);
	//     var remoteOp;
	//
	//     if (linkDef.type === 'hasMany') {
	//       var relId = operation.path[4];
	//       var relType = linkDef.model;
	//       var relResourceId = this.serializer.resourceId(relType, relId);
	//
	//       remoteOp = {
	//         op: 'remove',
	//         path: '/' + relResourceId
	//       };
	//     } else {
	//       remoteOp = {
	//         op: 'remove',
	//         path: '/'
	//       };
	//     }
	//
	//     return this.ajax(this.resourceLinkURL(type, id, link), 'PATCH', {data: [ remoteOp ]}).then(
	//       function() {
	//         _this._transformCache(operation);
	//       }
	//     );
	//   },
	//
	//   _transformReplaceLink: function(operation) {
	//     var _this = this;
	//
	//     var type = operation.path[0];
	//     var id = operation.path[1];
	//     var link = operation.path[3];
	//     var relId = operation.path[4] || operation.value;
	//
	//     // Convert a map of ids to an array
	//     if (isObject(relId)) {
	//       relId = Object.keys(relId);
	//     }
	//
	//     var linkDef = this.schema.linkDefinition(type, link);
	//     var relType = linkDef.model;
	//     var relResourceId = this.serializer.resourceId(relType, relId);
	//     var remoteOp;
	//
	//     remoteOp = {
	//       op: 'replace',
	//       path: '/',
	//       value: relResourceId
	//     };
	//
	//     return this.ajax(this.resourceLinkURL(type, id, link), 'PATCH', {data: [ remoteOp ]}).then(
	//       function() {
	//         _this._transformCache(operation);
	//       }
	//     );
	//   },
	//
	//   _transformUpdateAttribute: function(operation) {
	//     var _this = this;
	//     var type = operation.path[0];
	//     var id = operation.path[1];
	//     var attr = operation.path[2];
	//
	//     var remoteOp = {
	//       op: 'replace',
	//       path: '/' + attr,
	//       value: operation.value
	//     };
	//
	//     return this.ajax(this.resourceURL(type, id), 'PATCH', {data: [ remoteOp ]}).then(
	//       function() {
	//         _this._transformCache(operation);
	//       }
	//     );
	//   },
	//
	//   ajaxContentType: function(url, method) {
	//     return 'application/vnd.api+json; ext=jsonpatch; charset=utf-8';
	//   }
	// });

});
define('orbit-common/lib/exceptions', ['exports', 'orbit/lib/exceptions'], function (exports, exceptions) {

  'use strict';

  var OperationNotAllowed = exceptions.Exception.extend({
    name: 'OC.OperationNotAllowed',
    init: function(message, operation) {
      this.operation = operation;
      this._super(message);
    }
  });

  var ModelNotRegisteredException = exceptions.Exception.extend({
    name: 'OC.ModelNotRegisteredException',
    init: function(model) {
      this.model = model;
      this._super('model "' + model + '" not found');
    },
  });

  var LinkNotRegisteredException = exceptions.Exception.extend({
    name: 'OC.LinkNotRegisteredException',
    init: function(model, link) {
      this.model = model;
      this.link = link;
      this._super('link "' + model + "#" + link + '" not registered');
    },
  });


  var _RecordException = exceptions.Exception.extend({
    init: function(type, record, key) {
      this.type = type;
      this.record = record;
      var message = type + '/' + record;

      if (key) {
        this.key = key;
        message += '/' + key;
      }
      this._super(message);
    },
  });

  /**
   Exception thrown when a record can not be found.

   @class RecordNotFoundException
   @namespace OC
   @param {String} type
   @param {Object} record
   @constructor
   */
  var RecordNotFoundException = _RecordException.extend({
    name: 'OC.RecordNotFoundException',
  });

  /**
   Exception thrown when a record can not be found.

   @class LinkNotFoundException
   @namespace OC
   @param {String} type
   @param {Object} record
   @constructor
   */
  var LinkNotFoundException = _RecordException.extend({
    name: 'OC.LinkNotFoundException',
  });

  /**
   Exception thrown when a record already exists.

   @class RecordAlreadyExistsException
   @namespace OC
   @param {String} type
   @param {Object} record
   @constructor
   */
  var RecordAlreadyExistsException = _RecordException.extend({
    name: 'OC.RecordAlreadyExistsException',
  });

  exports.OperationNotAllowed = OperationNotAllowed;
  exports.RecordNotFoundException = RecordNotFoundException;
  exports.LinkNotFoundException = LinkNotFoundException;
  exports.RecordAlreadyExistsException = RecordAlreadyExistsException;
  exports.ModelNotRegisteredException = ModelNotRegisteredException;
  exports.LinkNotRegisteredException = LinkNotRegisteredException;

});
define('orbit-common/main', ['exports'], function (exports) {

	'use strict';

	/**
	 The Orbit Common library (namespaced `OC` by default) defines a common set of
	 compatible sources.

	 The Common library contains a base abstract class, `Source`, which supports
	 both `Transformable` and `Requestable` interfaces. The method signatures on
	 `Source` should be supported by other sources that want to be fully compatible
	 with the Common library.

	 @module orbit-common
	 @main orbit-common
	 */

	/**
	 Namespace for Orbit Common methods and classes.

	 @class OC
	 @static
	 */
	var OC = {};

	exports['default'] = OC;

});
define('orbit-common/memory-source', ['exports', 'orbit/main', 'orbit/lib/assert', 'orbit/lib/exceptions', 'orbit/lib/objects', 'orbit/lib/eq', 'orbit-common/source', 'orbit-common/operation-processors/cache-integrity-processor', 'orbit-common/operation-processors/schema-consistency-processor', 'orbit-common/lib/exceptions'], function (exports, Orbit, assert, exceptions, objects, eq, Source, CacheIntegrityProcessor, SchemaConsistencyProcessor, lib__exceptions) {

  'use strict';

  var MemorySource = Source['default'].extend({
    init: function(options) {
      assert.assert('MemorySource constructor requires `options`', options);
      assert.assert('MemorySource requires Orbit.Promise to be defined', Orbit['default'].Promise);
      options.useCache = true;
      options.cacheOptions = options.cacheOptions || {};
      options.cacheOptions.processors =  options.cacheOptions.processors || [SchemaConsistencyProcessor['default'], CacheIntegrityProcessor['default']];
      this._super.call(this, options);
    },

    /////////////////////////////////////////////////////////////////////////////
    // Transformable interface implementation
    /////////////////////////////////////////////////////////////////////////////

    _transform: function(ops) {
      return this._cache.transform(ops);
    },

    /////////////////////////////////////////////////////////////////////////////
    // Requestable interface implementation
    /////////////////////////////////////////////////////////////////////////////

    _find: function(type, id, options) {
      var _this = this;

      if (options) throw new exceptions.Exception('`MemorySource#find` does not support `options` argument');

      return new Orbit['default'].Promise(function(resolve) {
        var result;

        if (objects.isNone(id)) {
          result = _this._fetchAll(type);

        } else if (objects.isArray(id)) {
          result = _this._fetchMany(type, id);

        } else {
          result = _this._fetchOne(type, id);
        }

        resolve(result);
      });
    },

    _query: function(type, query, options) {
      var _this = this;

      if (options) throw new exceptions.Exception('`MemorySource#query` does not support `options` argument');

      return new Orbit['default'].Promise(function(resolve) {
        var result = _this._filter(type, query);

        resolve(result);
      });
    },

    _findLink: function(type, id, link, options) {
      var _this = this;

      if (options) throw new exceptions.Exception('`MemorySource#findLink` does not support `options` argument');

      return new Orbit['default'].Promise(function(resolve, reject) {
        id = _this.getId(type, id);

        var record = _this.retrieve([type, id]);

        if (record) {
          var relId;

          if (record.__rel) {
            relId = record.__rel[link];

            if (relId) {
              var linkDef = _this.schema.linkDefinition(type, link);
              if (linkDef.type === 'hasMany') {
                relId = Object.keys(relId);
              }
            }
          }

          if (relId) {
            resolve(relId);

          } else {
            reject(new lib__exceptions.LinkNotFoundException(type, id, link));
          }

        } else {
          reject(new lib__exceptions.RecordNotFoundException(type, id));
        }
      });
    },

    _findLinked: function(type, id, link, options) {
      var _this = this;

      if (options) throw new exceptions.Exception('`MemorySource#findLinked` does not support `options` argument');

      return new Orbit['default'].Promise(function(resolve) {
        var result = _this._fetchLinked(type, id, link);

        resolve(result);
      });
    },

    /////////////////////////////////////////////////////////////////////////////
    // Internals
    /////////////////////////////////////////////////////////////////////////////

    _fetchAll: function(type) {
      var records = [];
      var dataForType = this.retrieve([type]);

      if (!dataForType) throw new lib__exceptions.RecordNotFoundException(type);

      for (var i in dataForType) {
        if (dataForType.hasOwnProperty(i)) {
          records.push( dataForType[i] );
        }
      }

      return records;
    },

    _fetchMany: function(type, ids) {
      var _this = this;
      var records = [];
      var notFound = [];
      var id;
      var record;

      for (var i = 0, l = ids.length; i < l; i++) {
        id = _this.getId(type, ids[i]);
        record = this.retrieve([type, id]);

        if (record) {
          records.push(record);
        } else {
          notFound.push(id);
        }
      }

      if (notFound.length > 0) throw new lib__exceptions.RecordNotFoundException(type, notFound);

      return records;
    },

    _fetchOne: function(type, id) {
      id = this.getId(type, id);

      var record = this.retrieve([type, id]);

      if (!record) throw new lib__exceptions.RecordNotFoundException(type, id);

      return record;
    },

    _fetchLinked: function(type, id, link) {
      id = this.getId(type, id);

      var linkType = this.schema.modelDefinition(type).links[link].model;
      var linkValue = this.retrieveLink(type, id, link);

      if (linkValue === undefined) throw new lib__exceptions.LinkNotFoundException(type, id, link);
      if (linkValue === null) return null;

      return objects.isArray(linkValue)
             ? this._fetchMany(linkType, linkValue)
             : this._fetchOne(linkType, linkValue);
    },

    _filter: function(type, query) {
      var all = [],
          dataForType,
          i,
          prop,
          match,
          record;

      dataForType = this.retrieve([type]);
      if (!dataForType) throw new lib__exceptions.RecordNotFoundException(type, query);

      for (i in dataForType) {
        if (dataForType.hasOwnProperty(i)) {
          record = dataForType[i];
          match = false;
          for (prop in query) {
            if (eq.eq(record[prop], query[prop])) {
              match = true;
            } else {
              match = false;
              break;
            }
          }
          if (match) all.push(record);
        }
      }

      return all;
    }
  });

  exports['default'] = MemorySource;

});
define('orbit-common/operation-encoder', ['exports', 'orbit/lib/objects', 'orbit-common/lib/exceptions', 'orbit/operation'], function (exports, objects, exceptions, Operation) {

  'use strict';

  exports['default'] = objects.Class.extend({
    init: function(schema) {
      this._schema = schema;
    },

    identify: function(operation) {
      var op = operation.op;
      var path = operation.path;
      var value = operation.value;

      if (['add', 'replace', 'remove'].indexOf(op) === -1) throw new exceptions.OperationNotAllowed("Op must be add, replace or remove (was " + op + ")", operation);

      if (path.length < 2) throw new exceptions.OperationNotAllowed("Path must have at least 2 segments");
      if (path.length === 2) return op + "Record";
      if (path.length === 3) return op + "Attribute";

      if (path[2] === '__rel') {
        var linkType = this._schema.linkDefinition(path[0], path[3]).type;

        if (linkType === 'hasMany') {
          if (path.length === 4) {
            if (objects.isObject(value) && ['add', 'replace'].indexOf(op) !== -1) return op + 'HasMany';
            if (op === 'remove') return 'removeHasMany';
          }
          else if (path.length === 5) {
            if (op === 'add') return 'addToHasMany';
            if (op === 'remove') return 'removeFromHasMany';
          }
        }
        else if (linkType === 'hasOne') {
          return op + 'HasOne';
        }
        else {
          throw new exceptions.OperationNotAllowed("Only hasMany and hasOne links are supported (was " + linkType + ")", operation);
        }
      }

      throw new exceptions.OperationNotAllowed("Invalid operation " + operation.op + ":" + operation.path.join("/") + ":" + operation.value);
    },

    addRecordOp: function(type, id, record) {
      return new Operation['default']({op: 'add', path: [type, id], value: record});
    },

    replaceRecordOp: function(type, id, record) {
      return new Operation['default']({op: 'replace', path: [type, id], value: record});
    },

    removeRecordOp: function(type, id) {
      return new Operation['default']({op: 'remove', path: [type, id]});
    },

    replaceAttributeOp: function(type, id, attribute, value) {
      var path = [type, id, attribute];
      return new Operation['default']({op: 'replace', path: path, value: value});
    },

    linkOp: function(op, type, id, key, value) {
      return this[op + 'LinkOp'](type, id, key, value);
    },

    addLinkOp: function(type, id, key, value) {
      var linkType = this._schema.linkDefinition(type, key).type;
      var path = [type, id, '__rel', key];
      var op;

      if (linkType === 'hasMany') {
        path.push(value);
        value = true;
        op = 'add';
      } else {
        op = 'replace';
      }

      return new Operation['default']({
        op: op,
        path: path,
        value: value
      });
    },

    replaceLinkOp: function(type, id, key, value) {
      var linkType = this._schema.linkDefinition(type, key).type;
      var path = [type, id, '__rel', key];

      if (linkType === 'hasMany' &&
          objects.isArray(value)) {
        var obj = {};
        for (var i = 0, l = value.length; i < l; i++) {
          obj[value[i]] = true;
        }
        value = obj;
      }

      return new Operation['default']({
        op: 'replace',
        path: path,
        value: value
      });
    },

    removeLinkOp: function(type, id, key, value) {
      var linkType = this._schema.linkDefinition(type, key).type;
      var path = [type, id, '__rel', key];
      var op;

      if (linkType === 'hasMany') {
        path.push(value);
        op = 'remove';
      } else {
        op = 'replace';
        value = null;
      }

      return new Operation['default']({
        op: op,
        path: path,
        value: value
      });
    }
  });

});
define('orbit-common/operation-processors/cache-integrity-processor', ['exports', 'orbit/lib/objects', 'orbit/operation', 'orbit-common/operation-processors/operation-processor'], function (exports, objects, Operation, OperationProcessor) {

  'use strict';

  exports['default'] = OperationProcessor['default'].extend({
    init: function(cache) {
      this._super.apply(this, arguments);
      this._rev = {};
    },

    _rev: null,

    reset: function(data) {
      this._rev = {};

      if (data) {
        Object.keys(data).forEach(function(type) {
          var typeData = data[type];
          Object.keys(typeData).forEach(function(id) {
            this._recordAdded(type, id, typeData[id]);
          }, this);
        }, this);
      }
    },

    before: function(operation) {
      var path = operation.path;
      var type = path[0];
      var id = path[1];
      var operationType = this.cache.schema.operationEncoder.identify(operation);

      switch (operationType) {
        case 'addRecord':
          return this._beforeRecordAdded(type, id);

        default:
          return [];
      }
    },

    after: function(operation) {
      var path = operation.path;
      var type = path[0];
      var id = path[1];
      var operationType = this.cache.schema.operationEncoder.identify(operation);

      switch (operationType) {
        case 'replaceHasOne':
        case 'replaceHasMany':
        case 'removeHasOne':
        case 'removeHasMany':
          return this._linkRemoved(type, id, path[3]);

        case 'removeFromHasMany':
          return this._linkRemoved(type, id, path[3], path[4]);

        case 'removeRecord':
          return this._recordRemoved(type, id);

        default:
          return [];
      }
    },

    finally: function(operation) {
      var path = operation.path;
      var type = path[0];
      var id = path[1];
      var value = operation.value;
      var operationType = this.cache.schema.operationEncoder.identify(operation);

      switch (operationType) {
        case 'replaceHasOne':
        case 'replaceHasMany':
        case 'addHasOne':
        case 'addHasMany':
          return this._linkAdded(type, id, path[3], value);

        case 'addToHasMany':
          return this._linkAdded(type, id, path[3], path[4]);

        case 'addRecord':
          return this._recordAdded(type, id, value);

        default:
          return [];
      }
    },

    _linkAdded: function(type, id, link, value) {
      var ops = [];
      var linkDef = this.cache.schema.linkDefinition(type, link);

      if (linkDef.inverse && !objects.isNone(value)) {
        var relIds = this._idsFromValue(value);
        var relId;

        for (var i = 0; i < relIds.length; i++) {
          relId = relIds[i];
          this._addRevLink(type, id, link, relId);
        }
      }

      return ops;
    },

    _linkRemoved: function(type, id, link, value) {
      var ops = [];
      var linkDef = this.cache.schema.linkDefinition(type, link);

      if (linkDef.inverse) {
        if (value === undefined) {
          value = this.cache.retrieve([type, id, '__rel', link]);
        }

        if (!objects.isNone(value)) {
          var relIds = this._idsFromValue(value);
          var relId;

          for (var i = 0; i < relIds.length; i++) {
            relId = relIds[i];
            this._removeRevLink(type, id, link, relId);
          }
        }
      }

      return ops;
    },

    _beforeRecordAdded: function(type, id, record) {
      var ops = [];

      var modelRootPath = [type];
      if (!this.cache.retrieve(modelRootPath)) {
        ops.push(new Operation['default']({
          op: 'add',
          path: modelRootPath,
          value: {}
        }));
      }

      return ops;
    },

    _recordAdded: function(type, id, record) {
      var ops = [];
      var links = record.__rel;

      if (links) {
        var linkValue;

        Object.keys(links).forEach(function(link) {
          linkValue = links[link];
          if (linkValue) {
            var relIds = this._idsFromValue(linkValue);
            var relId;

            for (var i = 0; i < relIds.length; i++) {
              relId = relIds[i];
              this._addRevLink(type, id, link, relId);
            }
          }
        }, this);
      }

      return ops;
    },

    _recordRemoved: function(type, id) {
      var ops = [];
      var revLink = this._revLink(type, id);

      if (revLink) {
        Object.keys(revLink).forEach(function(path) {
          path = path.split('/');

          if (path.length === 4) {
            ops.push(new Operation['default']({
              op: 'replace',
              path: path,
              value: null
            }));

          } else {
            ops.push(new Operation['default']({
              op: 'remove',
              path: path
            }));
          }
        }, this);

        delete this._rev[type][id];
      }

      // when a whole record is removed, remove references corresponding to each link
      var links = this.cache.retrieve([type, id, '__rel']);
      if (links) {
        var linkValue;

        Object.keys(links).forEach(function(link) {
          linkValue = links[link];
          if (linkValue) {
            var relIds = this._idsFromValue(linkValue);
            var relId;

            for (var i = 0; i < relIds.length; i++) {
              relId = relIds[i];
              this._removeRevLink(type, id, link, relId);
            }
          }
        }, this);
      }

      return ops;
    },

    _idsFromValue: function(value) {
      if (objects.isArray(value)) {
        return value;
      } else if (objects.isObject(value)) {
        return Object.keys(value);
      } else {
        return [ value ];
      }
    },

    _revLink: function(type, id) {
      var revForType = this._rev[type];
      if (revForType === undefined) {
        revForType = this._rev[type] = {};
      }
      var rev = revForType[id];
      if (rev === undefined) {
        rev = revForType[id] = {};
      }
      return rev;
    },

    _addRevLink: function(type, id, link, value) {
      // console.log('_addRevLink', type, id, link, value);

      if (value) {
        var linkDef = this.cache.schema.linkDefinition(type, link);
        var linkPath = [type, id, '__rel', link];

        if (linkDef.type === 'hasMany') {
          linkPath.push(value);
        }
        linkPath = linkPath.join('/');

        var revLink = this._revLink(linkDef.model, value);
        revLink[linkPath] = true;
      }
    },

    _removeRevLink: function(type, id, link, value) {
      // console.log('_removeRevLink', type, id, link, value);

      if (value) {
        var linkDef = this.cache.schema.linkDefinition(type, link);
        var linkPath = [type, id, '__rel', link];

        if (linkDef.type === 'hasMany') {
          linkPath.push(value);
        }
        linkPath = linkPath.join('/');

        var revLink = this._revLink(linkDef.model, value);
        delete revLink[linkPath];
      }
    }
  });

});
define('orbit-common/operation-processors/deletion-tracking-processor', ['exports', 'orbit/lib/objects', 'orbit/operation', 'orbit-common/operation-processors/operation-processor'], function (exports, objects, Operation, OperationProcessor) {

  'use strict';

  exports['default'] = OperationProcessor['default'].extend({
    init: function(cache) {
      this._super.apply(this, arguments);
      this._del = {};
      objects.expose(cache, this, 'hasDeleted');
    },

    _del: null,

    hasDeleted: function(path) {
      if (objects.isArray(path)) path = path.join('/');
      return !!this._del[path];
    },

    reset: function(data) {
      this._del = {};
    },

    finally: function(operation) {
      if (operation.op === 'remove') {
        var serializedPath = operation.path.join('/');
        this._del[serializedPath] = true;
      }

      return [];
    }
  });

});
define('orbit-common/operation-processors/operation-processor', ['exports', 'orbit/lib/objects'], function (exports, objects) {

  'use strict';

  exports['default'] = objects.Class.extend({
    init: function(cache) {
      this.cache = cache;
    },

    cache: null,

    /**
     Called when all the `data` in a cache has been reset.

     The return value is ignored.

     @param  {Object} [data] a complete replacement set of data
     */
    reset: function(data) {},

    /**
     Called before an `operation` has been applied.

     Return an array of operations to be applied **BEFORE** the `operation` itself
     is applied.

     @param  {OC.Operation} [operation]
     @return {Array} an array of `OC.Operation` objects
     */
    before: function(operation) {
      return [];
    },

    /**
     Called before an `operation` has been applied.

     Return an array of operations to be applied **AFTER** the `operation` itself
     is applied.

     @param  {OC.Operation} [operation]
     @return {Array} an array of `OC.Operation` objects
     */
    after: function(operation) {
      return [];
    },

    /**
     Called **AFTER** an `operation` and any related operations have been
     applied.

     Return an array of operations to be applied **AFTER** `operation` itself
     is applied.

     @param  {OC.Operation} [operation]
     @return {Array} an array of `OC.Operation` objects
     */
    finally: function(operation) {
      return [];
    }
  });

});
define('orbit-common/operation-processors/schema-consistency-processor', ['exports', 'orbit/lib/objects', 'orbit/operation', 'orbit-common/operation-processors/operation-processor'], function (exports, objects, Operation, OperationProcessor) {

  'use strict';

  exports['default'] = OperationProcessor['default'].extend({
    after: function(operation) {
      var path = operation.path;
      var type = path[0];
      var id = path[1];
      var operationType = this.cache.schema.operationEncoder.identify(operation);

      switch (operationType) {
        case 'replaceHasOne':
        case 'replaceHasMany':
        case 'removeHasOne':
        case 'removeHasMany':
          return this._linkRemoved(type, id, path[3]);

        case 'removeFromHasMany':
          return this._linkRemoved(type, id, path[3], path[4]);

        case 'removeRecord':
          return this._recordRemoved(type, id);

        default:
          return [];
      }
    },

    finally: function(operation) {
      var path = operation.path;
      var type = path[0];
      var id = path[1];
      var value = operation.value;
      var operationType = this.cache.schema.operationEncoder.identify(operation);

      switch (operationType) {
        case 'replaceHasOne':
        case 'replaceHasMany':
        case 'addHasOne':
        case 'addHasMany':
          return this._linkAdded(type, id, path[3], value);

        case 'addToHasMany':
          return this._linkAdded(type, id, path[3], path[4]);

        case 'addRecord':
          return this._recordAdded(type, id, value);

        default:
          return [];
      }
    },

    _linkAdded: function(type, id, link, value) {
      var ops = [];
      var linkDef = this.cache.schema.linkDefinition(type, link);

      if (linkDef.inverse && !objects.isNone(value)) {
        var relIds = this._idsFromValue(value);
        var relId;
        var op;

        for (var i = 0; i < relIds.length; i++) {
          relId = relIds[i];
          op = this._relatedLinkOp('add', linkDef.model, relId, linkDef.inverse, id);
          if (op) ops.push(op);
        }
      }
      return ops;
    },

    _linkRemoved: function(type, id, link, value) {
      var ops = [];
      var linkDef = this.cache.schema.linkDefinition(type, link);

      if (linkDef.inverse) {
        if (value === undefined) {
          value = this.cache.retrieve([type, id, '__rel', link]);
        }

        if (!objects.isNone(value)) {
          var relIds = this._idsFromValue(value);
          var relId;
          var op;

          for (var i = 0; i < relIds.length; i++) {
            relId = relIds[i];
            op = this._relatedLinkOp('remove', linkDef.model, relId, linkDef.inverse, id);
            if (op) ops.push(op);
          }
        }
      }

      return ops;
    },

    _recordAdded: function(type, id, record) {
      var ops = [];
      var links = record.__rel;

      if (links) {
        var linkValue;

        Object.keys(links).forEach(function(link) {
          linkValue = links[link];
          if (linkValue) {
            ops = ops.concat(this._linkAdded(type, id, link, linkValue));
          }
        }, this);
      }

      return ops;
    },

    _recordRemoved: function(type, id) {
      var ops = [];
      var links = this.cache.retrieve([type, id, '__rel']);

      if (links) {
        var linkDef;
        var linkValue;

        Object.keys(links).forEach(function(link) {
          linkValue = links[link];
          if (linkValue) {
            linkDef = this.cache.schema.linkDefinition(type, link);

            if (linkDef.dependent === 'remove') {
              ops = ops.concat(this._removeDependentRecords(linkDef.model, linkValue));
            } else {
              ops = ops.concat(this._linkRemoved(type, id, link, linkValue));
            }
          }
        }, this);
      }

      return ops;
    },

    _removeDependentRecords: function(type, idOrIds) {
      var ops = [];
      var ids = this._idsFromValue(idOrIds);
      var id;
      var dependentPath;

      for (var i = 0; i < ids.length; i++) {
        id = ids[i];
        dependentPath = [type, id];
        if (this.cache.retrieve(dependentPath)) {
          ops.push({
            op: 'remove',
            path: dependentPath
          });
        }
      }

      return ops;
    },

    _idsFromValue: function(value) {
      if (objects.isArray(value)) {
        return value;
      } else if (objects.isObject(value)) {
        return Object.keys(value);
      } else {
        return [ value ];
      }
    },

    _relatedLinkOp: function(op, type, id, link, value) {
      // console.log('_relatedLinkOp', op, type, id, link, value);
      if (this.cache.retrieve([type, id])) {
        var operation = this.cache.schema.operationEncoder.linkOp(op, type, id, link, value);

        // Apply operation only if necessary
        if (this.cache.retrieve(operation.path) !== operation.value) {
          // console.log('_relatedLinkOp - necessary', op, type, id, link, value);
          return operation;
        }
      }
    }
  });

});
define('orbit-common/schema', ['exports', 'orbit/lib/objects', 'orbit/lib/uuid', 'orbit-common/lib/exceptions', 'orbit/evented', 'orbit-common/operation-encoder'], function (exports, objects, uuid, exceptions, Evented, OperationEncoder) {

  'use strict';

  var Schema = objects.Class.extend({
    init: function(options) {
      options = options || {};
      // model defaults
      if (options.modelDefaults) {
        this.modelDefaults = options.modelDefaults;
      } else {
        this.modelDefaults = {
          keys: {
            'id': {primaryKey: true, defaultValue: uuid.uuid}
          }
        };
      }
      // inflection
      if (options.pluralize) {
        this.pluralize = options.pluralize;
      }
      if (options.singularize) {
        this.singularize = options.singularize;
      }

      Evented['default'].extend(this);

      // register provided model schema
      this.models = {};
      if (options.models) {
        for (var model in options.models) {
          if (options.models.hasOwnProperty(model)) {
            this.registerModel(model, options.models[model]);
          }
        }
      }

      this.operationEncoder = new OperationEncoder['default'](this);
    },

    /**
     @property operationEncoder
     @type OperationEncoder
     */
    operationEncoder: null,

    /**
     Registers a model's schema definition.

     Emits the `modelRegistered` event upon completion.

     @param {String} model      name of the model
     @param {Object} definition model schema definition
     */
    registerModel: function(model, definition) {
      var modelSchema = this._mergeModelSchemas({}, this.modelDefaults, definition);

      // process key definitions
      for (var name in modelSchema.keys) {
        var key = modelSchema.keys[name];

        key.name = name;

        if (key.primaryKey) {
          if (modelSchema.primaryKey) {
            throw new exceptions.OperationNotAllowed('Schema can only define one primaryKey per model');
          }
          modelSchema.primaryKey = key;

        } else {
          key.primaryKey = false;

          key.secondaryToPrimaryKeyMap = {};
          key.primaryToSecondaryKeyMap = {};

          modelSchema.secondaryKeys = modelSchema.secondaryKeys || {};
          modelSchema.secondaryKeys[name] = key;
        }

        key.type = key.type || 'string';
        if (key.type !== 'string') {
          throw new exceptions.OperationNotAllowed('Model keys must be of type `"string"`');
        }
      }

      // ensure every model has a valid primary key
      if (!modelSchema.primaryKey || typeof modelSchema.primaryKey.defaultValue !== 'function') {
        throw new exceptions.OperationNotAllowed('Model schema ID defaultValue must be a function');
      }

      this.models[model] = modelSchema;

      this.emit('modelRegistered', model);
    },

    /**
     Normalizes a record according to its type and corresponding schema
     definition.

     A record's primary key, links, and meta data will all be initialized.

     A record can only be normalized once. A flag is set on the record
     (`__normalized`) to prevent "re-normalization".

     @param  {String} model   record type
     @param  {Object} data    record data
     @return {Object} normalized version of `data`
     */
    normalize: function(model, data) {
      if (data.__normalized) return data;

      var record = data;

      // set flag
      record.__normalized = true;

      // init forward links
      record.__rel = record.__rel || {};

      // init meta info
      record.__meta = record.__meta || {};

      this.initDefaults(model, record);

      return record;
    },

    /**
     A hook that can be used to define a model that's not yet defined.

     This allows for schemas to lazily define models, rather than requiring
     full definitions upfront.

     @method modelNotDefined
     @param {String} [model] name of model
     */
    modelNotDefined: null,

    /**
     Look up a model definition.

     If none can be found, `modelNotDefined` will be triggered, which provides
     an opportunity for lazily defining models.

     If still no model has been defined, a `ModelNotRegisteredException` is
     raised.

     @method modelDefinition
     @param {String} [model] name of model
     @return {Object} model definition
     */
    modelDefinition: function(model) {
      var modelDefinition = this.models[model];
      if (!modelDefinition && this.modelNotDefined) {
        this.modelNotDefined(model);
        modelDefinition = this.models[model];
      }
      if (!modelDefinition) {
        throw new exceptions.ModelNotRegisteredException(model);
      }
      return modelDefinition;
    },

    initDefaults: function(model, record) {
      if (!record.__normalized) {
        throw new exceptions.OperationNotAllowed('Schema.initDefaults requires a normalized record');
      }

      var modelSchema = this.modelDefinition(model),
          keys = modelSchema.keys,
          attributes = modelSchema.attributes,
          links = modelSchema.links;

      // init primary key - potentially setting the primary key from secondary keys if necessary
      this._initPrimaryKey(modelSchema, record);

      // init default key values
      for (var key in keys) {
        if (record[key] === undefined) {
          record[key] = this._defaultValue(record, keys[key].defaultValue, null);
        }
      }

      // init default attribute values
      if (attributes) {
        for (var attribute in attributes) {
          if (record[attribute] === undefined) {
            record[attribute] = this._defaultValue(record, attributes[attribute].defaultValue, null);
          }
        }
      }

      // init default link values
      if (links) {
        for (var link in links) {
          if (record.__rel[link] === undefined) {
            record.__rel[link] = this._defaultValue(record,
                                                    links[link].defaultValue,
                                                    links[link].type === 'hasMany' ? {} : null);
          }
        }
      }

      this._mapKeys(modelSchema, record);
    },

    primaryToSecondaryKey: function(model, secondaryKeyName, primaryKeyValue, autoGenerate) {
      var modelSchema = this.modelDefinition(model);
      var secondaryKey = modelSchema.keys[secondaryKeyName];

      var value = secondaryKey.primaryToSecondaryKeyMap[primaryKeyValue];

      // auto-generate secondary key if necessary, requested, and possible
      if (value === undefined && autoGenerate && secondaryKey.defaultValue) {
        value = secondaryKey.defaultValue();
        this._registerKeyMapping(secondaryKey, primaryKeyValue, value);
      }

      return value;
    },

    secondaryToPrimaryKey: function(model, secondaryKeyName, secondaryKeyValue, autoGenerate) {
      var modelSchema = this.modelDefinition(model);
      var secondaryKey = modelSchema.keys[secondaryKeyName];

      var value = secondaryKey.secondaryToPrimaryKeyMap[secondaryKeyValue];

      // auto-generate primary key if necessary, requested, and possible
      if (value === undefined && autoGenerate && modelSchema.primaryKey.defaultValue) {
        value = modelSchema.primaryKey.defaultValue();
        this._registerKeyMapping(secondaryKey, value, secondaryKeyValue);
      }

      return value;
    },

    /**
     Given a data object structured according to this schema, register all of its
     primary and secondary key mappings. This data object may contain any number
     of records and types.

     @param {Object} data - data structured according to this schema
     */
    registerAllKeys: function(data) {
      if (data) {
        Object.keys(data).forEach(function(type) {
          var modelSchema = this.modelDefinition(type);

          if (modelSchema && modelSchema.secondaryKeys) {
            var records = data[type];

            Object.keys(records).forEach(function(id) {
              var record = records[id];
              var altId;

              Object.keys(modelSchema.secondaryKeys).forEach(function(secondaryKey) {
                altId = record[secondaryKey];
                if (altId !== undefined && altId !== null) {
                  var secondaryKeyDef = modelSchema.secondaryKeys[secondaryKey];
                  this._registerKeyMapping(secondaryKeyDef, id, altId);
                }
              }, this);
            }, this);
          }
        }, this);
      }
    },

    /**
     A naive pluralization method.

     Override with a more robust general purpose inflector or provide an
     inflector tailored to the vocabularly of your application.

     @param  {String} word
     @return {String} plural form of `word`
     */
    pluralize: function(word) {
      return word + 's';
    },

    /**
     A naive singularization method.

     Override with a more robust general purpose inflector or provide an
     inflector tailored to the vocabularly of your application.

     @param  {String} word
     @return {String} singular form of `word`
     */
    singularize: function(word) {
      if (word.lastIndexOf('s') === word.length - 1) {
        return word.substr(0, word.length - 1);
      } else {
        return word;
      }
    },

    linkDefinition: function(type, link) {
      var model = this.modelDefinition(type);

      var linkProperties = model.links[link];
      if (!linkProperties) throw new exceptions.LinkNotRegisteredException(type, link);

      return linkProperties;
    },

    _defaultValue: function(record, value, defaultValue) {
      if (value === undefined) {
        return defaultValue;

      } else if (typeof value === 'function') {
        return value.call(record);

      } else {
        return value;
      }
    },

    _initPrimaryKey: function(modelSchema, record) {
      var pk = modelSchema.primaryKey.name;
      var id = record[pk];

      // init primary key from secondary keys
      if (!id && modelSchema.secondaryKeys) {
        var keyNames = Object.keys(modelSchema.secondaryKeys);
        for (var i = 0, l = keyNames.length; i < l ; i++) {
          var key = modelSchema.keys[keyNames[i]];
          var value = record[key.name];
          if (value) {
            id = key.secondaryToPrimaryKeyMap[value];
            if (id) {
              record[pk] = id;
              return;
            }
          }
        }
      }
    },

    _mapKeys: function(modelSchema, record) {
      var id = record[modelSchema.primaryKey.name];

      if (modelSchema.secondaryKeys) {
        Object.keys(modelSchema.secondaryKeys).forEach(function(name) {
          var value = record[name];
          if (value) {
            var key = modelSchema.secondaryKeys[name];
            this._registerKeyMapping(key, id, value);
          }
        }, this);
      }
    },

    _registerKeyMapping: function(secondaryKeyDef, primaryValue, secondaryValue) {
      secondaryKeyDef.primaryToSecondaryKeyMap[primaryValue] = secondaryValue;
      secondaryKeyDef.secondaryToPrimaryKeyMap[secondaryValue] = primaryValue;
    },

    _mergeModelSchemas: function(base) {
      var sources = Array.prototype.slice.call(arguments, 1);

      // ensure model schema has categories set
      base.keys = base.keys || {};
      base.attributes = base.attributes || {};
      base.links = base.links || {};

      sources.forEach(function(source) {
        source = objects.clone(source);
        this._mergeModelFields(base.keys, source.keys);
        this._mergeModelFields(base.attributes, source.attributes);
        this._mergeModelFields(base.links, source.links);
      }, this);

      return base;
    },

    _mergeModelFields: function(base, source) {
      if (source) {
        Object.keys(source).forEach(function(field) {
          if (source.hasOwnProperty(field)) {
            var fieldDef = source[field];
            if (fieldDef) {
              base[field] = fieldDef;
            } else {
              // fields defined as falsey should be removed
              delete base[field];
            }
          }
        });
      }
    }
  });

  exports['default'] = Schema;

});
define('orbit-common/serializer', ['exports', 'orbit/lib/objects', 'orbit/lib/stubs'], function (exports, objects, stubs) {

  'use strict';

  var Serializer = objects.Class.extend({
    init: function(schema) {
      this.schema = schema;
    },

    serialize: stubs.required,

    deserialize: stubs.required
  });

  exports['default'] = Serializer;

});
define('orbit-common/source', ['exports', 'orbit/main', 'orbit/document', 'orbit/transformable', 'orbit/requestable', 'orbit/lib/assert', 'orbit/lib/stubs', 'orbit/lib/objects', 'orbit-common/cache', 'orbit/operation', 'orbit-common/lib/exceptions', 'orbit/lib/eq', 'orbit/lib/diffs', 'orbit/lib/operations'], function (exports, Orbit, Document, Transformable, Requestable, assert, stubs, objects, Cache, Operation, exceptions, eq, diffs, operations) {

  'use strict';

  var Source = objects.Class.extend({
    init: function(options) {
      assert.assert('Source constructor requires `options`', options);
      assert.assert("Source's `schema` must be specified in `options.schema` constructor argument", options.schema);
      this.schema = options.schema;

      // Create an internal cache and expose some elements of its interface
      if (options.useCache) {
        this._cache = new Cache['default'](this.schema, options.cacheOptions);
      }

      Transformable['default'].extend(this);
      Requestable['default'].extend(this, ['find', 'query', 'add', 'update', 'patch', 'remove',
                                'findLink', 'addLink', 'removeLink', 'updateLink',
                                'findLinked']);

      Source.created(this);
    },

    /////////////////////////////////////////////////////////////////////////////
    // Transformable interface implementation
    /////////////////////////////////////////////////////////////////////////////

    /**
     Internal method that applies an array of transforms to this source.

     `_transform` must be implemented by a `Transformable` source.
     It is called by the public method `transform` in order to actually apply
     transforms.

     For synchronous transforms, `_transform` should return a TransformResult.

     For asynchronous transforms, `_transform` should return a promise that
     resolves to a TransformResult.

     @method _transform
     @param {Array} [operations] An array of Orbit.Operation objects
     @returns {Promise | TransformResult} An Orbit.TransformResult or Promise that resolves to a Orbit.TransformResult
     @private
     */
    _transform: stubs.required,

    /**
     Prepare an array of operations for `_transform`.

     This is an opportunity to coalesce operations, removing those that aren't
     needed for this source.

     @method prepareTransformOperations
     @param {Array} [operations] An array of Orbit.Operation objects
     @returns {Array} An array of Orbit.Operation objects
     @private
     */
    prepareTransformOperations: function(ops) {
      var result;
      var coalescedOps = operations.coalesceOperations(ops);

      if (this.retrieve) {
        result = [];

        coalescedOps.forEach(function(operation) {
          var currentValue = this.retrieve(operation.path);

          if (objects.isNone(currentValue)) {
            // Removing a null value, or replacing it with another null value, is unnecessary
            if ((operation.op === 'remove') ||
                (operation.op === 'replace' && objects.isNone(operation.value))) {

              if (this.hasDeleted && this.hasDeleted(operation.path)) return;
            }

          } else if (operation.op === 'add' || operation.op === 'replace') {
            if (eq.eq(currentValue, operation.value)) {
              // Replacing a value with its equivalent is unnecessary
              return;

            } else {
              var diffOps = diffs.diffs(currentValue, operation.value, { basePath: operation.path });
              Array.prototype.push.apply(result, operations.normalizeOperations(diffOps));
              return;
            }
          }

          result.push(operation);
        }, this);

      } else {
        result = coalescedOps;
      }

      return result;
    },

    /////////////////////////////////////////////////////////////////////////////
    // Requestable interface implementation
    /////////////////////////////////////////////////////////////////////////////

    _find: stubs.required,

    _query: stubs.required,

    _findLink: stubs.required,

    _findLinked: stubs.required,

    _add: function(type, data) {
      data = data || {};

      var record = this.normalize(type, data);

      var id = this.getId(type, record),
          path = [type, id],
          _this = this;

      return this.transform(this.schema.operationEncoder.addRecordOp(type, id, record)).then(function() {
        return _this.retrieve(path);
      });
    },

    _update: function(type, data) {
      var record = this.normalize(type, data);
      var id = this.getId(type, record);

      return this.transform(this.schema.operationEncoder.replaceRecordOp(type, id, record));
    },

    _patch: function(type, id, attribute, value) {
      id = this._normalizeId(type, id);
      // todo - confirm this simplification is valid (i.e. don't attempt to deserialize attribute path)
      return this.transform(this.schema.operationEncoder.replaceAttributeOp(type, id, attribute, value));
    },

    _remove: function(type, id) {
      id = this._normalizeId(type, id);
      return this.transform(this.schema.operationEncoder.removeRecordOp(type, id));
    },

    _addLink: function(type, id, key, value) {
      id = this._normalizeId(type, id);
      value = this._normalizeLink(type, key, value);

      return this.transform(this.schema.operationEncoder.addLinkOp(type, id, key, value));
    },

    _removeLink: function(type, id, key, value) {
      id = this._normalizeId(type, id);
      value = this._normalizeLink(type, key, value);

      return this.transform(this.schema.operationEncoder.removeLinkOp(type, id, key, value));
    },

    _updateLink: function(type, id, key, value) {
      var linkDef = this.schema.modelDefinition(type).links[key];

      assert.assert('hasMany links can only be replaced when flagged as `actsAsSet`',
             linkDef.type !== 'hasMany' || linkDef.actsAsSet);

      id = this._normalizeId(type, id);
      value = this._normalizeLink(type, key, value);

      var op = this.schema.operationEncoder.replaceLinkOp(type, id, key, value);
      return this.transform(op);
    },

    /////////////////////////////////////////////////////////////////////////////
    // Helpers
    /////////////////////////////////////////////////////////////////////////////

    reset: function(data) {
      assert.assert('`Source#reset` requires a cache.', this._cache);

      return this._cache.reset(data);
    },

    /**
     Return data at a particular path.

     Returns `undefined` if the path does not exist in the document.

     @method retrieve
     @param path
     @returns {Object}
     */
    retrieve: function(path) {
      assert.assert('`Source#retrieve` requires a cache.', this._cache);

      return this._cache.retrieve(path);
    },

    /**
     Retrieves a link's value.

     Returns a null value for empty links.
     For hasOne links will return a string id value of the link.
     For hasMany links will return an array of id values.

     @param {String} [type] Model type
     @param {String} [id]   Model ID
     @param {String} [link] Link key
     @returns {Array|String|null} Value of the link
     */
    retrieveLink: function(type, id, link) {
      assert.assert('`Source#retrieveLink` requires a cache.', this._cache);

      var val = this.retrieve([type, id, '__rel', link]);
      if (objects.isObject(val)) {
        val = Object.keys(val);
      }
      return val;
    },

    /**
     Return the size of data at a particular path

     @method length
     @param path
     @returns {Number}
     */
    length: function(path) {
      assert.assert('`Source#length` requires a cache.', this._cache);

      var data = this.retrieve(path);
      if (objects.isArray(data)) {
        return data.length;
      } else if (objects.isObject(data)) {
        return Object.keys(data).length;
      } else {
        return 0;
      }
    },

    /**
     Returns whether a path exists in the source's cache.

     @method exists
     @param path
     @returns {Boolean}
     */
    exists: function(path) {
      assert.assert('`Source#exists` requires a cache.', this._cache);

      return this.retrieve(path) !== undefined;
    },

    /**
     Returns whether a path has been removed from the source's cache.

     @method hasDeleted
     @param path
     @returns {Boolean}
     */
    hasDeleted: function(path) {
      assert.assert('`Source#hasDeleted` requires a cache.', this._cache);

      return this._cache.hasDeleted(path);
    },

    normalize: function(type, data) {
      return this.schema.normalize(type, data);
    },

    initDefaults: function(type, record) {
      return this.schema.initDefaults(type, record);
    },

    getId: function(type, data) {
      if (objects.isObject(data)) {
        var modelDefinition = this.schema.modelDefinition(type);

        if (data[modelDefinition.primaryKey.name]) {
          return data[modelDefinition.primaryKey.name];

        } else {
          var secondaryKeys = modelDefinition.secondaryKeys;

          for (var key in secondaryKeys) {
            var value = data[key];
            if (value) return secondaryKeys[key].secondaryToPrimaryKeyMap[value];
          }
        }
      } else {
        return data;
      }
    },

    /////////////////////////////////////////////////////////////////////////////
    // Internals
    /////////////////////////////////////////////////////////////////////////////

    _normalizeId: function(type, id) {
      if (objects.isObject(id)) {
        var record = this.normalize(type, id);
        id = this.getId(type, record);
      }
      return id;
    },

    _normalizeLink: function(type, key, value) {
      if (objects.isObject(value)) {
        var linkDef = this.schema.modelDefinition(type).links[key];
        var relatedRecord;

        if (objects.isArray(value)) {
          value = value.map(function(each) {
            if (objects.isObject(each)) {
              relatedRecord = this.normalize(linkDef.model, each);
              return this.getId(linkDef.model, relatedRecord);
            } else {
              return each;
            }
          }, this);

        } else {
          relatedRecord = this.normalize(linkDef.model, value);
          value = this.getId(linkDef.model, relatedRecord);
        }
      }
      return value;
    },

    _isLinkEmpty: function(linkType, linkValue) {
      return (linkType === 'hasMany' && linkValue && linkValue.length === 0 ||
              linkType === 'hasOne' && objects.isNone(linkValue));
    }
  });

  /**
   * A place to track the creation of any Source, is called in the Source init
   * method.  The source might not be fully configured / setup by the time you
   * receive it, but we provide this hook for potential debugging tools to monitor
   * all sources.
   *
   * @namespace OC
   * @param {OC.Source} source The newly forged Source.
   */
  Source.created = function(/* source */) {};

  exports['default'] = Source;

});
define('orbit-common/transaction', ['exports', 'orbit/main', 'orbit-common/memory-source', 'orbit/lib/assert', 'orbit/lib/operations'], function (exports, Orbit, MemorySource, assert, lib__operations) {

  'use strict';

  var Transaction = MemorySource['default'].extend({
    active: false,
    isolated: false,
    operations: null,
    inverseOperations: null,

    init: function(options) {
      assert.assert('Transaction constructor requires `options`', options);
      assert.assert('`baseSource` must be supplied as an option when constructing a Transaction.', options.baseSource);
      var baseSource = this.baseSource = options.baseSource;

      options.schema = baseSource.schema;

      this._super(options);

      if (options.isolated !== undefined) {
        this.isolated = options.isolated;
      }

      if (options.active !== false) {
        this.begin();
      }
    },

    begin: function() {
      this.operations = [];
      this.inverseOperations = [];

      this._activate();
    },

    commit: function() {
      this._deactivate();

      var operations = this.operations;

      if (operations.length > 0) {
        operations = lib__operations.coalesceOperations(operations);
        return this.baseSource.transform(operations);

      } else {
        return Orbit['default'].Promise.resolve();
      }
    },

    retrieve: function(path) {
      var result = this._super.apply(this, arguments);
      if (result === undefined && !this.isolated) {
        result = this.baseSource.retrieve(path);
        if (result !== undefined) {
          this._cloneData(path, result);
        }
      }
      return result;
    },

    _cloneData: function(path, value) {
      this._cache.transform([{
        op: 'add',
        path: path,
        value: value
      }]);
    },

    _activate: function() {
      if (!this.active) {
        this.on('didTransform', this._processTransform, this);
        this.active = true;
      }
    },

    _deactivate: function() {
      if (this.active) {
        this.off('didTransform', this._processTransform, this);
        this.active = false;
      }
    },

    _processTransform: function(transform, result) {
      Array.prototype.push.apply(this.operations, result.operations);
      Array.prototype.push.apply(this.inverseOperations, result.inverseOperations);
    }
  });

  exports['default'] = Transaction;

});
window.OC = requireModule("orbit-common")["default"];

})();
//# sourceMappingURL=orbit-common.map