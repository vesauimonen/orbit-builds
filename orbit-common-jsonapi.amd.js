define('orbit-common/jsonapi-serializer', ['exports', 'orbit-common/serializer', 'orbit/lib/objects', 'orbit/lib/strings'], function (exports, Serializer, objects, strings) {

  'use strict';

  exports['default'] = Serializer['default'].extend({
    resourceKey: function(type) {
      return 'id';
    },

    resourceType: function(type) {
      return strings.dasherize( this.schema.pluralize(type) );
    },

    resourceLink: function(type, link) {
      return strings.dasherize( link );
    },

    resourceAttr: function(type, attr) {
      return strings.dasherize( attr );
    },

    typeFromResourceType: function(resourceType) {
      return strings.camelize( this.schema.singularize(resourceType) );
    },

    attrFromResourceAttr: function(type, resourceAttr) {
      return strings.camelize( resourceAttr );
    },

    linkFromResourceLink: function(type, resourceLink) {
      return strings.camelize( resourceLink );
    },

    resourceId: function(type, id) {
      if (objects.isArray(id)) {
        var ids = [];
        for (var i = 0, l = id.length; i < l; i++) {
          ids.push(this.resourceId(type, id[i]));
        }

        return ids;
      }

      var primaryKey = this.schema.modelDefinition(type).primaryKey.name;
      var resourceKey = this.resourceKey(type);

      if (objects.isObject(id)) {
        if (id[resourceKey]) {
          return id[resourceKey];
        }
        id = id[primaryKey];
      }

      if (resourceKey === primaryKey) {
        return id;
      } else {
        return this.schema.primaryToSecondaryKey(type, resourceKey, id);
      }
    },

    idFromResourceId: function(type, resourceId) {
      var primaryKey = this.schema.modelDefinition(type).primaryKey;
      var pk = primaryKey.name;
      var rk = this.resourceKey(type);

      if (resourceId !== null && typeof resourceId === 'object') {
        if (resourceId[pk]) {
          return resourceId[pk];
        }
        resourceId = resourceId[rk];
      }

      var id;

      if (rk === pk) {
        id = resourceId;
      } else {
        id = this.schema.secondaryToPrimaryKey(type, rk, resourceId, true);
      }

      return id;
    },

    serialize: function(type, records) {
      var json = {};

      if (objects.isArray(records)) {
        json.data = this.serializeRecords(type, records);
      } else {
        json.data = this.serializeRecord(type, records);
      }

      return json;
    },

    serializeRecords: function(type, records) {
      var json = [];

      records.forEach(function(record) {
        json.push(this.serializeRecord(type, record));
      }, this);

      return json;
    },

    serializeRecord: function(type, record) {
      var json = {};

      this.serializeId(type, record, json);
      this.serializeType(type, record, json);
      this.serializeAttributes(type, record, json);
      this.serializeLinks(type, record, json);

      return json;
    },

    serializeId: function(type, record, json) {
      var value = this.resourceId(type, record);
      if (value !== undefined) {
        json.id = value;
      }
    },

    serializeType: function(type, record, json) {
      json.type = this.resourceType(type);
    },

    serializeAttributes: function(type, record, json) {
      var modelDef = this.schema.modelDefinition(type);

      Object.keys(modelDef.attributes).forEach(function(attr) {
        this.serializeAttribute(type, record, attr, json);
      }, this);
    },

    serializeAttribute: function(type, record, attr, json) {
      var value = record[attr];
      if (value !== undefined) {
        if (json.attributes === undefined) {
          json.attributes = {};
        }

        json.attributes[this.resourceAttr(type, attr)] = value;
      }
    },

    serializeLinks: function(type, record, json) {
      var modelDef = this.schema.modelDefinition(type);
      var linkNames = Object.keys(modelDef.links);

      if (linkNames.length > 0 && record.__rel) {
        json.relationships = {};

        linkNames.forEach(function (link) {
          var linkDef = modelDef.links[link];
          var value = record.__rel[link];

          if (linkDef.type === 'hasMany') {
            value = Object.keys(value).map(function(id) {
              return this.serializeRelationshipIdentifier(linkDef.model, id);
            }, this);
          } else if (value) {
            value = this.serializeRelationshipIdentifier(linkDef.model, value);
          } else {
            value = null;
          }

          json.relationships[link] = {
            data: value
          };

        }, this);
      }
    },

    serializeRelationshipIdentifier: function(type, id) {
      return {
        type: this.resourceType(type),
        id: this.resourceId(type, id)
      };
    },

    deserialize: function(type, id, data) {
      var records = {};

      if (objects.isArray(data.data)) {
        records.primary = this.deserializeRecords(type, id, data.data);
      } else {
        records.primary = this.deserializeRecord(type, id, data.data);
      }

      if (data.included) {
        records.included = {};

        data.included.forEach(function(recordData) {
          var recordType = this.typeFromResourceType(recordData.type);
          if (records.included[recordType] === undefined) {
            records.included[recordType] = [];
          }
          records.included[recordType].push(this.deserializeRecord(recordType, null, recordData));
        }, this);
      }

      this.assignLinks(type, records);

      return records;
    },

    deserializeLink: function(data) {
      if (objects.isObject(data)) {
        if (objects.isArray(data)) {
          return data.map(function(linkData) {
            return this.deserializeRelationshipIdentifier(linkData);
          }, this);
        } else {
          return this.deserializeRelationshipIdentifier(data);
        }

      } else {
        return data;
      }
    },

    deserializeRelationshipIdentifier: function(data) {
      var type = this.typeFromResourceType(data.type);
      return {
        type: type,
        id: this.idFromResourceId(type, data.id)
      };
    },

    deserializeRecords: function(type, ids, data) {
      return data.map(function(recordData, i) {
        var id = ids && ids[i] ? ids[i] : null;
        return this.deserializeRecord(type, id, recordData);
      }, this);
    },

    deserializeRecord: function(type, id, data) {
      var record = {};
      var attributes;
      var relationships;
      var pk = this.schema.modelDefinition(type).primaryKey.name;

      if (id) {
        record[pk] = id;
      }

      this.deserializeKey(type, record, this.resourceKey(type), data.id);

      if (data.attributes) {
        attributes = data.attributes;
        this.deserializeAttributes(type, record, attributes);
      }

      if (data.relationships) {
        // temporarily assign relationships as __relationships
        record.__relationships = data.relationships;
      }

      return this.schema.normalize(type, record);
    },

    deserializeKey: function(type, record, key, value) {
      record[key] = value;
    },

    deserializeAttributes: function(type, record, json) {
      var modelDef = this.schema.modelDefinition(type);
      Object.keys(modelDef.attributes).forEach(function(attr) {
        var resourceAttr = this.resourceAttr(type, attr);
        var value = json[resourceAttr];
        if (value !== undefined) {
          this.deserializeAttribute(type, record, attr, value);
        }
      }, this);
    },

    deserializeAttribute: function(type, record, attr, value) {
      record[attr] = value;
    },

    assignLinks: function(type, records) {
      if (objects.isArray(records.primary)) {
        this.assignLinksToRecords(type, records.primary);
      } else {
        this.assignLinksToRecord(type, records.primary);
      }

      if (records.included) {
        Object.keys(records.included).forEach(function(includedType) {
          this.assignLinksToRecords(includedType, records.included[includedType]);
        }, this);
      }
    },

    assignLinksToRecords: function(type, records) {
      records.forEach(function(record) {
        this.assignLinksToRecord(type, record);
      }, this);
    },

    assignLinksToRecord: function(type, record) {
      if (record.__relationships) {
        var schema = this.schema;
        var linkDef;
        var linkValue;
        var id;

        Object.keys(record.__relationships).forEach(function(link) {
          linkValue = record.__relationships[link].data;
          linkDef = schema.modelDefinition(type).links[link];

          if (!linkDef) return;

          if (linkDef.type === 'hasMany' && objects.isArray(linkValue)) {
            record.__rel[link] = record.__rel[link] || [];

            var rels = record.__rel[link];
            linkValue.forEach(function(resourceId) {
              id = this.idFromResourceId(linkDef.model, resourceId.id);
              record.__rel[link][id] = true;
            }, this);

          } else if (linkDef.type === 'hasOne' && objects.isObject(linkValue)) {
            id = this.idFromResourceId(linkDef.model, linkValue.id);
            record.__rel[link] = id;

          }

        }, this);

        delete record.__relationships;
      }
    }
  });

});
define('orbit-common/jsonapi-source', ['exports', 'orbit/main', 'orbit/lib/assert', 'orbit/lib/exceptions', 'orbit/lib/objects', 'orbit/operation', 'orbit/action-queue', 'orbit-common/source', 'orbit-common/serializer', 'orbit-common/jsonapi-serializer', 'orbit-common/lib/exceptions', 'orbit/transform-result', 'orbit-common/operation-processors/cache-integrity-processor', 'orbit-common/operation-processors/deletion-tracking-processor', 'orbit-common/operation-processors/schema-consistency-processor'], function (exports, Orbit, assert, exceptions, objects, Operation, ActionQueue, Source, Serializer, JSONAPISerializer, lib__exceptions, TransformResult, CacheIntegrityProcessor, DeletionTrackingProcessor, SchemaConsistencyProcessor) {

  'use strict';

  exports['default'] = Source['default'].extend({

    init: function(options) {
      assert.assert('JSONAPISource constructor requires `options`', options);
      assert.assert('JSONAPISource requires Orbit.Promise be defined', Orbit['default'].Promise);
      assert.assert('JSONAPISource requires Orbit.ajax be defined', Orbit['default'].ajax);

      options.useCache = options.useCache !== undefined ? options.useCache : true;
      if (options.useCache) {
        options.cacheOptions = options.cacheOptions || {};
        options.cacheOptions.processors =  options.cacheOptions.processors || [SchemaConsistencyProcessor['default'], CacheIntegrityProcessor['default'], DeletionTrackingProcessor['default']];
      }

      this._super.call(this, options);

      this.namespace        = options.namespace || this.namespace;
      this.host             = options.host || this.host;
      this.headers          = options.headers || this.headers;
      this.SerializerClass  = options.SerializerClass || this.SerializerClass;

      // If `SerializerClass` is obtained through the _super chain, dereference
      // its wrapped function, which will be the constructor.
      //
      // Note: This is only necessary when retrieving a *constructor* from a
      //       class hierarchy. Otherwise, `superWrapper` "just works".
      if (this.SerializerClass && this.SerializerClass.wrappedFunction) {
        this.SerializerClass = this.SerializerClass.wrappedFunction;
      }

      this.serializer = new this.SerializerClass(this.schema);

      assert.assert('Serializer must be an instance of OC.Serializer', this.serializer instanceof Serializer['default']);
    },

    namespace: null,
    host: null,
    headers: null,
    SerializerClass: JSONAPISerializer['default'],

    /////////////////////////////////////////////////////////////////////////////
    // Transformable interface implementation
    /////////////////////////////////////////////////////////////////////////////

    _transform: function(ops) {
      var fullResult = new TransformResult['default']();
      var queue = new ActionQueue['default']({autoProcess: false});
      var operation;
      var method;
      var action;

      for (var i = 0, len = ops.length; i < len; i++) {
        operation = ops[i];

        if (action && this._mergeOperationWithAction(action, operation)) {
          // Operation merged with previous action.
        } else {
          // Not able to merge operation with previous action, so we need to
          // queue a new action.
          method = this._operationMethod(operation);
          action = this._createTransformAction(method, operation, fullResult);
          queue.push(action);
        }
      }

      return queue.process().then(function() {
        return fullResult;
      });
    },

    /////////////////////////////////////////////////////////////////////////////
    // Requestable interface implementation
    /////////////////////////////////////////////////////////////////////////////

    _find: function(type, id, options) {
      if (options) throw new exceptions.Exception('`JSONAPISource#findLink` does not support `options` argument');

      if (objects.isNone(id)) {
        return this._findAll(type);

      } else if (objects.isArray(id)) {
        return this._findMany(type, id);

      } else {
        return this._findOne(type, id);
      }
    },

    _findLink: function(type, id, link, options) {
      var _this = this;

      if (options) throw new exceptions.Exception('`JSONAPISource#findLink` does not support `options` argument');

      id = this.getId(type, id);

      return this.ajax(this.resourceLinkURL(type, id, link), 'GET').then(
        function(raw) {
          var relId = _this.serializer.deserializeLink(raw.data);
          return relId;
        }
      );
    },

   _findLinked: function(type, id, link, options) {
     var _this = this;

     if (options) throw new exceptions.Exception('`JSONAPISource#findLinked` does not support `options` argument');

     id = this.getId(type, id);

     return this.ajax(this.resourceLinkedURL(type, id, link), 'GET').then(
       function(raw) {
         var linkDef = _this.schema.linkDefinition(type, link);

         var result = _this.deserialize(linkDef.model, null, raw);

         return _this.transformed(result.result).then(function() {
           return result.data;
         });
       }
     );
   },

   _query: function(type, query, options) {
     var _this = this;

     if (options) throw new exceptions.Exception('`JSONAPISource#query` does not support `options` argument');

     return this.ajax(this.resourceURL(type), 'GET', {data: {filter: query}}).then(
       function(raw) {
         var deserialized = _this.deserialize(type, null, raw);
         return _this.transformed(deserialized.result).then(function() {
           return deserialized.data;
         });
       }
     );
   },

    /////////////////////////////////////////////////////////////////////////////
    // Internals
    /////////////////////////////////////////////////////////////////////////////

    _transformAdd: function(operation) {
      var _this = this;
      var type = operation.path[0];
      var id = operation.path[1];
      var json = this.serializer.serialize(type, operation.value);

      return this.ajax(this.resourceURL(type), 'POST', {data: json}).then(
        function(raw) {
          var result = _this._transformCache(operation);

          var deserialized = _this.deserialize(type, id, raw);
          if (!deserialized.result.isEmpty()) {
            _this.transformed(deserialized.result);
          }

          return result;
        }
      );
    },

    _transformReplace: function(ops) {
      ops = objects.toArray(ops);

      var _this = this;
      var type = ops[0].path[0];
      var id = ops[0].path[1];
      var modelDef = this.schema.modelDefinition(type);

      var record = {};

      ops.forEach(function(operation) {
        var path = operation.path;
        var value = operation.value;
        if (path[2]) {
          if (path[2] === '__rel') {
            record.__rel = record.__rel || {};
            record.__rel[path[3]] = value;
          } else {
            record[path[2]] = value;
          }
        } else {
          record = objects.merge(record, value);
        }
      });

      record[modelDef.primaryKey.name] = id;

      var json = this.serializer.serialize(type, record);

      return this.ajax(this.resourceURL(type, id), 'PATCH', {data: json}).then(
        function(raw) {
          var result = _this._transformCache(ops);

          // TODO - better 204 (no content) checking
          if (raw && Object.keys(raw).length > 0) {
            var deserialized = _this.deserialize(type, id, raw);
            if (!deserialized.result.isEmpty()) {
              _this.transformed(deserialized.result);
            }
          }

          return result;
        }
      );
    },

    _transformRemove: function(operation) {
      var _this = this;
      var type = operation.path[0];
      var id = operation.path[1];

      return this.ajax(this.resourceURL(type, id), 'DELETE').then(function() {
        return _this._transformCache({op: 'remove', path: [type, id]});
      });
    },

    _transformAddLink: function(operation) {
      var _this = this;

      var type = operation.path[0];
      var id = operation.path[1];
      var link = operation.path[3];
      var relId = operation.path[4] || operation.value;
      var relType = this.schema.linkDefinition(type, link).model;
      var method = 'POST';
      var json = {
        data: [this.serializer.serializeRelationshipIdentifier(relType, relId)]
      };

      return this.ajax(this.resourceLinkURL(type, id, link), method, {data: json}).then(
        function() {
          return _this._transformCache(operation);
        }
      );
    },

    _transformRemoveLink: function(operation) {
      var _this = this;

      var type = operation.path[0];
      var id = operation.path[1];
      var link = operation.path[3];
      var relId = operation.path[4];
      var relType = this.schema.linkDefinition(type, link).model;
      var method = 'DELETE';
      var json = {
        data: [this.serializer.serializeRelationshipIdentifier(relType, relId)]
      };

      return this.ajax(this.resourceLinkURL(type, id, link), method, {data: json}).then(
        function() {
          return _this._transformCache(operation);
        }
      );
    },

    _transformReplaceLink: function(operation) {
      var _this = this;

      var type = operation.path[0];
      var id = operation.path[1];
      var link = operation.path[3];
      var relId = operation.path[4] || operation.value;
      var linkDef = this.schema.linkDefinition(type, link);
      var relType = linkDef.model;
      var data;

      if (linkDef.type === 'hasMany') {
        // Convert a map of ids to an array
        if (objects.isObject(relId)) {
          data = Object.keys(relId).map(function(id) {
            return this.serializer.serializeRelationshipIdentifier(relType, id);
          }, this);
        } else {
          data = [this.serializer.serializeRelationshipIdentifier(relType, relId)];
        }
      } else {
        data = this.serializer.serializeRelationshipIdentifier(relType, relId);
      }

      var method = 'PATCH';
      var json = {
        data: data
      };

      return this.ajax(this.resourceLinkURL(type, id, link), method, {data: json}).then(
        function() {
          return _this._transformCache(operation);
        }
      );
    },

    _transformReplaceAttribute: function(operation) {
      var _this = this;
      var type = operation.path[0];
      var id = operation.path[1];
      var attr = operation.path[2];
      var modelDef = this.schema.modelDefinition(type);

      var record = {};
      record[attr] = operation.value;
      record[modelDef.primaryKey.name] = id;

      var json = this.serializer.serialize(type, record);

      return this.ajax(this.resourceURL(type, id), 'PATCH', {data: json}).then(
        function(raw) {
          return _this._transformCache(operation);
        }
      );
    },

    _operationMethod: function(operation) {
      var op = operation.op;
      var path = operation.path;

      if (path.length > 2) {
        if (path[2] === '__rel') {
          if (op === 'add') {
            return '_transformAddLink';
          } else if (op === 'remove') {
            return '_transformRemoveLink';
          } else if (op === 'replace') {
            return '_transformReplaceLink';
          }
        } else {
          return '_transformReplaceAttribute';
        }

      } else if (path.length > 1) {
        if (op === 'add') {
          return '_transformAdd';

        } else if (op === 'replace') {
          return '_transformReplace';

        } else if (op === 'remove') {
          return '_transformRemove';
        }
      }
    },

    _mergeOperationWithAction: function(action, operation) {
      var actionOperation = objects.toArray(action.data.operation)[0];

      // Merge replace operations with previous replace operations that update
      // the same record.
      if (actionOperation.op === 'replace' && operation.op === 'replace' &&
          actionOperation.path[0] === operation.path[0] &&
          actionOperation.path[1] === operation.path[1]) {

        action.data.method = '_transformReplace';
        action.data.operation = objects.toArray( action.data.operation ).concat([operation]);

        return true;
      }
    },

    _createTransformAction: function(method, operation, fullResult) {
      var _this = this;

      return {
        data: {
          method: method,
          operation: operation
        },
        process: function() {
          return _this[this.data.method].call(_this, this.data.operation).then(function(result) {
            if (result) {
              fullResult.concat(result);
            }
          });
        }
      };
    },

    _findAll: function(type) {
      var _this = this;
      return this.ajax(this.resourceURL(type), 'GET').then(
        function(raw) {
          var deserialized = _this.deserialize(type, null, raw);
          return _this.transformed(deserialized.result).then(function() {
            return deserialized.data;
          });
        }
      );
    },

    _findOne: function(type, id) {
      var _this = this;
      return this.ajax(this.resourceURL(type, id), 'GET').then(
        function(raw) {
          var deserialized = _this.deserialize(type, null, raw);
          return _this.transformed(deserialized.result).then(function() {
            return deserialized.data;
          });
        }
      );
    },

    _findMany: function(type, ids) {
      var _this = this;
      return this.ajax(this.resourceURL(type, ids), 'GET').then(
        function(raw) {
          var deserialized = _this.deserialize(type, null, raw);
          return _this.transformed(deserialized.result).then(function() {
            return deserialized.data;
          });
        }
      );
    },

    _addRecordsToCache: function(type, records) {
      var result = new TransformResult['default']();

      records.forEach(function(record) {
        result.concat(this._addRecordToCache(type, record));
      }, this);

      return result;
    },

    _addRecordToCache: function(type, record) {
      var operation = {
        op: 'add',
        path: [type, this.getId(type, record)],
        value: record
      };

      return this._transformCache(operation);
    },

    _transformCache: function(ops) {
      if (this._cache) {
        return this._cache.transform( objects.toArray(ops) );
      } else {
        return new TransformResult['default'](ops);
      }
    },

    _resourceIdURLSegment: function(type, id) {
      var resourceId = this.serializer.resourceId(type, id);
      if (objects.isArray(resourceId)) {
        resourceId = resourceId.join(',');
      }
      return resourceId;
    },

    /////////////////////////////////////////////////////////////////////////////
    // Publicly accessible methods particular to JSONAPISource
    /////////////////////////////////////////////////////////////////////////////

    ajax: function(url, method, hash) {
      var _this = this;

      return new Orbit['default'].Promise(function(resolve, reject) {
        hash = hash || {};
        hash.url = url;
        hash.type = method;
        hash.dataType = 'json';
        hash.context = _this;

        // console.log('ajax start', method, url);

        if (hash.data && method !== 'GET') {
          if (!hash.contentType) {
            hash.contentType = _this.ajaxContentType(hash);
          }
          hash.data = JSON.stringify(hash.data);
        }

        if (_this.ajaxHeaders) {
          var headers = _this.ajaxHeaders();
          hash.beforeSend = function (xhr) {
            for (var key in headers) {
              if (headers.hasOwnProperty(key)) {
                xhr.setRequestHeader(key, headers[key]);
              }
            }
          };
        }

        hash.success = function(json) {
          // console.log('ajax success', method, json);
          resolve(json);
        };

        hash.error = function(jqXHR, textStatus, errorThrown) {
          if (jqXHR) {
            jqXHR.then = null;
          }
          // console.log('ajax error', method, jqXHR);

          reject(jqXHR);
        };

        Orbit['default'].ajax(hash);
      });
    },

    ajaxContentType: function(url, method) {
      return 'application/vnd.api+json; charset=utf-8';
    },

    ajaxHeaders: function() {
      return this.headers;
    },

    resourceNamespace: function(type) {
      return this.namespace;
    },

    resourceHost: function(type) {
      return this.host;
    },

    resourcePath: function(type, id) {
      var path = [this.serializer.resourceType(type)];
      if (id) {
        path.push(this._resourceIdURLSegment(type, id));
      }
      return path.join('/');
    },

    resourceURL: function(type, id) {
      var host = this.resourceHost(type),
          namespace = this.resourceNamespace(type),
          url = [];

      if (host) { url.push(host); }
      if (namespace) { url.push(namespace); }
      url.push(this.resourcePath(type, id));

      url = url.join('/');
      if (!host) { url = '/' + url; }

      return url;
    },

    resourceLinkURL: function(type, id, link, relId) {
      var url = this.resourceURL(type, id);
      url += '/relationships/' + this.serializer.resourceLink(type, link);

      if (relId) {
        var linkDef = this.schema.linkDefinition(type, link);

        url += '/' + this._resourceIdURLSegment(linkDef.model, relId);
      }

      return url;
    },

    resourceLinkedURL: function(type, id, link) {
      var url = this.resourceURL(type, id);
      url += '/' + this.serializer.resourceLink(type, link);
      return url;
    },

    deserialize: function(type, id, data) {
      var records = this.serializer.deserialize(type, id, data);
      var primaryData = records.primary;

      var result;

      if (objects.isArray(primaryData)) {
        result = this._addRecordsToCache(type, primaryData);
      } else {
        result = this._addRecordToCache(type, primaryData);
      }

      if (records.included) {
        Object.keys(records.included).forEach(function(relType) {
          var relRecords = records.included[relType];
          result.concat(this._addRecordsToCache(relType, relRecords));
        }, this);
      }

      return {
        result: result,
        data: primaryData
      };
    }
  });

});//# sourceMappingURL=orbit-common-jsonapi.amd.map