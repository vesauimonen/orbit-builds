define("orbit_common",
  ["orbit_common/main","orbit_common/cache","orbit_common/schema","orbit_common/source","orbit_common/memory_source"],
  function(OC, Cache, Schema, Source, MemorySource) {
    "use strict";

    OC.Cache = Cache;
    OC.Schema = Schema;
    OC.Source = Source;
    OC.MemorySource = MemorySource;


    return OC;
  });
define("orbit_common/cache",
  ["orbit/lib/objects","orbit/document"],
  function(__dependency1__, Document) {
    "use strict";
    var expose = __dependency1__.expose;
    var isArray = __dependency1__.isArray;

    /**
     `Cache` provides a thin wrapper over an internally maintained instance of a
     `Document`.

     `Cache` prepares records to be cached according to a specified schema. The
     schema also determines the paths at which records will be stored.

     Once cached, data can be accessed at a particular path with `retrieve`. The
     size of data at a path can be accessed with `length`.

     @class Cache
     @namespace OC
     @param {OC.Schema} schema
     @constructor
     */
    var Cache = function() {
      this.init.apply(this, arguments);
    };

    Cache.prototype = {
      constructor: Cache,

      init: function(schema) {
        this._doc = new Document(null, {arrayBasedPaths: true});

        // Expose methods from the Document interface
        expose(this, this._doc, 'reset', 'transform');

        this.schema = schema;
        for (var model in schema.models) {
          if (schema.models.hasOwnProperty(model)) {
            this._doc.add([model], {});
          }
        }
      },

      /**
       Return the size of data at a particular path

       @method length
       @param path
       @returns {Number}
       */
      length: function(path) {
        var data = this.retrieve(path);
        if (data === null) {
          return null;
        } else if (isArray(data)) {
          return data.length;
        } else {
          return Object.keys(data).length;
        }
      },

      /**
       Return data at a particular path

       @method retrieve
       @param path
       @returns {Object}
       */
      retrieve: function(path) {
        try {
          return this._doc.retrieve(path);
        } catch(e) {
          return null;
        }
      }
    };

    return Cache;
  });
define("orbit_common/lib/exceptions",
  ["exports"],
  function(__exports__) {
    "use strict";
    /**
     @module orbit-common
     */

    /**
     Exception thrown when a record can not be found.

     @class RecordNotFoundException
     @namespace OC
     @param {String} type
     @param {Object} record
     @constructor
     */
    var RecordNotFoundException = function(type, record) {
      this.type = type;
      this.record = record;
    };

    RecordNotFoundException.prototype = {
      constructor: RecordNotFoundException
    };

    /**
     Exception thrown when a record already exists.

     @class RecordAlreadyExistsException
     @namespace OC
     @param {String} type
     @param {Object} record
     @constructor
     */
    var RecordAlreadyExistsException = function(type, record) {
      this.type = type;
      this.record = record;
    };

    RecordAlreadyExistsException.prototype = {
      constructor: RecordAlreadyExistsException
    };

    __exports__.RecordNotFoundException = RecordNotFoundException;
    __exports__.RecordAlreadyExistsException = RecordAlreadyExistsException;
  });
define("orbit_common/main",
  [],
  function() {
    "use strict";
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

    return OC;
  });
define("orbit_common/memory_source",
  ["orbit/lib/assert","orbit/lib/objects","orbit_common/lib/exceptions","orbit/main","orbit_common/source"],
  function(__dependency1__, __dependency2__, __dependency3__, Orbit, Source) {
    "use strict";
    var assert = __dependency1__.assert;
    var extend = __dependency2__.extend;
    var RecordNotFoundException = __dependency3__.RecordNotFoundException;

    /**
     Source for storing in-memory data

     @class MemorySource
     @namespace OC
     @extends OC.Source
     @param schema
     @param options
     @constructor
     */
    var MemorySource = function() {
      this.init.apply(this, arguments);
    };

    extend(MemorySource.prototype, Source.prototype, {
      constructor: MemorySource,

      init: function(schema, options) {
        assert('MemorySource requires Orbit.Promise to be defined', Orbit.Promise);

        Source.prototype.init.apply(this, arguments);
      },

      initRecord: function(type, record) {
        this.schema.initRecord(type, record);
      },

      /////////////////////////////////////////////////////////////////////////////
      // Transformable interface implementation
      /////////////////////////////////////////////////////////////////////////////

      _transform: function(operation) {
        var inverse = this._cache.transform(operation, true);
        this.didTransform(operation, inverse);
      },

      /////////////////////////////////////////////////////////////////////////////
      // Requestable interface implementation
      /////////////////////////////////////////////////////////////////////////////

      _find: function(type, id) {
        var _this = this;

        return new Orbit.Promise(function(resolve, reject) {
          if (id === undefined || typeof id === 'object') {
            resolve(_this._filter.call(_this, type, id));
          } else {
            var record = _this.retrieve([type, id]);
            if (record) {
              resolve(record);
            } else {
              reject(new RecordNotFoundException(type, id));
            }
          }
        });
      },

      /////////////////////////////////////////////////////////////////////////////
      // Internals
      /////////////////////////////////////////////////////////////////////////////

      _filter: function(type, query) {
        var all = [],
            dataForType,
            i,
            prop,
            match,
            record;

        dataForType = this.retrieve([type]);

        for (i in dataForType) {
          if (dataForType.hasOwnProperty(i)) {
            record = dataForType[i];
            if (query === undefined) {
              match = true;
            } else {
              match = false;
              for (prop in query) {
                if (record[prop] === query[prop]) {
                  match = true;
                } else {
                  match = false;
                  break;
                }
              }
            }
            if (match) all.push(record);
          }
        }
        return all;
      }
    });

    return MemorySource;
  });
define("orbit_common/schema",
  [],
  function() {
    "use strict";
    /**
     `Schema`

     Defines the models, attributes and relationships allowed in a source.

     A `Schema` also defines an ID field (`__id` by default) that is used across all
     Orbit sources to uniquely identify records.

     Unique IDs are specified with `generateId`. The default implementation of this
     method generates locally unique IDs ('TIMESTAMP.COUNTER'). If your server
     accepts UUIDs, you may wish to generate IDs client-side by setting `idField` to
     match your remote ID field and replace `generateID` with a UUID generator.

     Models should be keyed by their singular name, and should be defined as an
     object that optionally contains `attributes` and/or `links`.

     TODO - further specs needed for models

     @example

     ``` javascript
     var schema = new Schema({
       models: {
         planet: {
           attributes: {
             name: {type: 'string'},
             classification: {type: 'string'}
           },
           links: {
             moons: {type: 'hasMany', model: 'moon', inverse: 'planet'}
           }
         },
         moon: {
           attributes: {
             name: {type: 'string'}
           },
           links: {
             planet: {type: 'hasOne', model: 'planet', inverse: 'moons'}
           }
         }
       }
     });
     ```

     @class Schema
     @namespace OC
     @param {Object}   [options]
     @param {String}   [options.idField='__id'] Name of field that uniquely identifies records throughout Orbit
     @param {Function} [options.generateId] ID generator (the default generator ensures locally unique IDs but not UUIDs)
     @param {Object}   [options.models] schemas for individual models supported by this schema
     @constructor
     */
    var Schema = function() {
      this.init.apply(this, arguments);
    };

    Schema.prototype = {
      constructor: Schema,

      init: function(options) {
        options = options || {};
        this.idField = options.idField !== undefined ? options.idField : '__id';
        this.models = options.models !== undefined ? options.models : {};
        if (options.generateId) {
          this.generateId = options.generateId;
        }
      },

      initRecord: function(type, data) {
        if (data[this.idField] !== undefined) return;

        var modelSchema = this.models[type],
            attributes = modelSchema.attributes,
            links = modelSchema.links;

        // init id
        data[this.idField] = this.generateId();

        // init default values
        if (attributes) {
          for (var attribute in attributes) {
            if (data[attribute] === undefined && attributes[attribute].defaultValue) {
              if (typeof attributes[attribute].defaultValue === 'function') {
                data[attribute] = attributes[attribute].defaultValue.call(data);
              } else {
                data[attribute] = attributes[attribute].defaultValue;
              }
            }
          }
        }

        // init links
        if (links) {
          data.links = {};
          for (var link in links) {
            if (data.links[link] === undefined && links[link].type === 'hasMany') {
              data.links[link] = {};
            }
          }
        }
      },

      generateId: function() {
        if (this._newId === undefined) this._newId = 0;
        return new Date().getTime() + '.' + (this._newId++).toString();
      }
    };

    return Schema;
  });
define("orbit_common/source",
  ["orbit/lib/assert","orbit/lib/stubs","orbit/lib/objects","orbit/document","orbit/transformable","orbit/requestable","orbit_common/cache"],
  function(__dependency1__, __dependency2__, __dependency3__, Document, Transformable, Requestable, Cache) {
    "use strict";
    var assert = __dependency1__.assert;
    var required = __dependency2__.required;
    var expose = __dependency3__.expose;

    /**
     `Source` is an abstract base class to be extended by other sources.

     @class Source
     @namespace OC
     @param {OC.Schema} schema
     @param options
     @constructor
    */
    var Source = function() {
      this.init.apply(this, arguments);
    };

    Source.prototype = {
      constructor: Source,

      init: function(schema, options) {
        assert("Source's `schema` must be specified", schema);
        assert("Source's `schema.idField` must be specified", schema.idField);

        this.schema = schema;

        options = options || {};

        // Create an internal cache and expose some elements of its interface
        this._cache = new Cache(schema);
        expose(this, this._cache, 'length', 'reset', 'retrieve');

        Transformable.extend(this);
        Requestable.extend(this, ['find', 'add', 'update', 'patch', 'remove', 'link', 'unlink']);
      },

      initRecord: required,

      /////////////////////////////////////////////////////////////////////////////
      // Transformable interface implementation
      /////////////////////////////////////////////////////////////////////////////

      /**
       Internal method that applies a single transform to this source.

       `_transform` must be implemented by a `Transformable` source.
       It is called by the public method `transform` in order to actually apply
       transforms.

       `_transform` should return a promise if the operation is asynchronous.

       @method _transform
       @param operation JSON PATCH operation as detailed in RFC 6902
       @private
       */
      _transform: required,

      /////////////////////////////////////////////////////////////////////////////
      // Requestable interface implementation
      /////////////////////////////////////////////////////////////////////////////

      _find: required,

      _add: function(type, data) {
        this.initRecord(type, data);

        var id = data[this.schema.idField],
            path = [type, id],
            _this = this;

        return this.transform({op: 'add', path: path, value: data}).then(function() {
          return _this.retrieve(path);
        });
      },

      _update: function(type, data) {
        this.initRecord(type, data);

        var id = data[this.schema.idField],
            path = [type, id],
            _this = this;

        return this.transform({op: 'replace', path: path, value: data}).then(function() {
          return _this.retrieve(path);
        });
      },

      _patch: function(type, id, property, value) {
        if (typeof id === 'object') {
          var record = id;
          this.initRecord(type, record);
          id = record[this.schema.idField];
        }

        return this.transform({
          op: 'replace',
          path: [type, id].concat(Document.prototype.deserializePath(property)),
          value: value
        });
      },

      _remove: function(type, id) {
        if (typeof id === 'object') {
          var record = id;
          this.initRecord(type, record);
          id = record[this.schema.idField];
        }

        return this.transform({op: 'remove', path: [type, id]});
      },

      _link: function(type, id, property, value) {
        var linkOp = function(linkDef, type, id, property, value) {
          var path = [type, id, 'links', property];
          if (linkDef.type === 'hasMany') {
            path.push(value);
            value = true;
          }
          return {
            op: 'add',
            path: path,
            value: value
          };
        };

        var linkDef = this.schema.models[type].links[property],
            ops,
            _this = this;

        // Normalize ids
        if (typeof id === 'object') {
          var record = id;
          this.initRecord(type, record);
          id = record[this.schema.idField];
        }
        if (typeof value === 'object') {
          var relatedRecord = value;
          this.initRecord(linkDef.model, relatedRecord);
          value = relatedRecord[this.schema.idField];
        }

        // Add link to primary resource
        ops = [linkOp(linkDef, type, id, property, value)];

        // Add inverse link if necessary
        if (linkDef.inverse) {
          var inverseLinkDef = this.schema.models[linkDef.model].links[linkDef.inverse];
          ops.push(linkOp(inverseLinkDef, linkDef.model, value, linkDef.inverse, id));
        }

        return this.transform(ops).then(function() {
          return _this.retrieve([type, id]);
        });
      },

      _unlink: function(type, id, property, value) {
        var unlinkOp = function(linkDef, type, id, property, value) {
          var path = [type, id, 'links', property];
          if (linkDef.type === 'hasMany') path.push(value);
          return {
            op: 'remove',
            path: path
          };
        };

        var linkDef = this.schema.models[type].links[property],
            ops,
            record,
            relatedRecord,
            _this = this;

        // Normalize ids
        if (typeof id === 'object') {
          record = id;
          this.initRecord(type, record);
          id = record[this.schema.idField];
        }
        if (typeof value === 'object') {
          relatedRecord = value;
          this.initRecord(linkDef.model, relatedRecord);
          value = relatedRecord[this.schema.idField];
        }

        // Remove link from primary resource
        ops = [unlinkOp(linkDef, type, id, property, value)];

        // Remove inverse link if necessary
        if (linkDef.inverse) {
          if (value === undefined) {
            if (record === undefined) {
              record = this.retrieve(type, id);
            }
            value = record.links[property];
          }

          var inverseLinkDef = this.schema.models[linkDef.model].links[linkDef.inverse];
          ops.push(unlinkOp(inverseLinkDef, linkDef.model, value, linkDef.inverse, id));
        }

        return this.transform(ops).then(function() {
          return _this.retrieve([type, id]);
        });
      }
    };

    return Source;
  });