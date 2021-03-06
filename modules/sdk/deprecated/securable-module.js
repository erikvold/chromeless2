/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Jetpack.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Atul Varma <atul@mozilla.com>
 *   Mike de Boer <mdeboer@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

(function(global) {

"use strict";

const {classes: Cc, Constructor: CC, interfaces: Ci, utils: Cu, results: Cr} = Components;

let exports = {};

const ios = Cc["@mozilla.org/network/io-service;1"]
              .getService(Ci.nsIIOService);
const systemPrincipal = Cc["@mozilla.org/systemprincipal;1"]
                          .createInstance(Ci.nsIPrincipal);

// Define some shortcuts.
const bind = Function.call.bind(Function.bind);
const getOwnPropertyNames = Object.getOwnPropertyNames;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const define = Object.defineProperties;
const prototypeOf = Object.getPrototypeOf;
const create = Object.create;
const keys = Object.keys;

// Workaround for bug 674195. Freezing objects from other compartments fail,
// so we use `Object.freeze` from the same component instead.
function freeze(object) {
  if (prototypeOf(object) === null) {
      Object.freeze(object);
  }
  else {
    prototypeOf(prototypeOf(object.isPrototypeOf)).
      constructor. // `Object` from the owner compartment.
      freeze(object);
  }
  return object;
}
exports.freeze = freeze;

// Returns map of given `object`-s own property descriptors.
const descriptor = iced(function descriptor(object) {
  let value = {};
  getOwnPropertyNames(object).forEach(function(name) {
    value[name] = getOwnPropertyDescriptor(object, name)
  });
  return value;
});
exports.descriptor = descriptor;

// Freeze important built-ins so they can't be used by untrusted code as a
// message passing channel.
freeze(Object);
freeze(Object.prototype);
freeze(Function);
freeze(Function.prototype);
freeze(Array);
freeze(Array.prototype);
freeze(String);
freeze(String.prototype);

// This function takes `f` function sets it's `prototype` to undefined and
// freezes it. We need to do this kind of deep freeze with all the exposed
// functions so that untrusted code won't be able to use them a message
// passing channel.
function iced(f) {
  f.prototype = undefined;
  return freeze(f);
}
exports.iced = iced;

// Defines own properties of given `properties` object on the given
// target object overriding any existing property with a conflicting name.
// Returns `target` object. Note we only export this function because it's
// useful during loader bootstrap when other util modules can't be used &
// thats only case where this export should be used.
const override = iced(function override(target, source) {
  let properties = descriptor(target)
  let extension = descriptor(source || {})
  getOwnPropertyNames(extension).forEach(function(name) {
    properties[name] = extension[name];
  });
  return define({}, properties);
});
exports.override = override;

function resolvePrincipal(principal, defaultPrincipal) {
  if (principal === undefined)
    return defaultPrincipal;
  if (principal == "system")
    return systemPrincipal;
  return principal;
}

// The base URI to we use when we're given relative URLs, if any.
let baseURI = null;
if (global.window)
  baseURI = ios.newURI(global.location.href, null, null);
exports.baseURI = baseURI;

// The "parent" chrome URI to use if we're loading code that
// needs chrome privileges but may not have a filename that
// matches any of SpiderMonkey's defined system filename prefixes.
// The latter is needed so that wrappers can be automatically
// made for the code. For more information on this, see
// bug 418356:
//
// https://bugzilla.mozilla.org/show_bug.cgi?id=418356
let parentChromeURIString;
if (baseURI) {
  // We're being loaded from a chrome-privileged document, so
  // use its URL as the parent string.
  parentChromeURIString = baseURI.spec;
} else {
  // We're being loaded from a chrome-privileged JS module or
  // SecurableModule, so use its filename (which may itself
  // contain a reference to a parent).
  parentChromeURIString = Components.stack.filename;
}

function maybeParentifyFilename(filename) {
  let doParentifyFilename = true;
  try {
    // TODO: Ideally we should just make
    // nsIChromeRegistry.wrappersEnabled() available from script
    // and use it here. Until that's in the platform, though,
    // we'll play it safe and parentify the filename unless
    // we're absolutely certain things will be ok if we don't.
    let filenameURI = ios.newURI(filename, null, baseURI);
    if (filenameURI.scheme == "chrome" &&
        filenameURI.path.indexOf("/content/") == 0) {
      // Content packages will always have wrappers made for them;
      // if automatic wrappers have been disabled for the
      // chrome package via a chrome manifest flag, then
      // this still works too, to the extent that the
      // content package is insecure anyways.
      doParentifyFilename = false;
    }
  } catch (e) {}
  if (doParentifyFilename)
    return parentChromeURIString + " -> " + filename;
  return filename;
}

function getRootDir(urlStr) {
  // TODO: This feels hacky, and like there will be edge cases.
  return urlStr.slice(0, urlStr.lastIndexOf("/") + 1);
}

exports.SandboxFactory = function SandboxFactory(defaultPrincipal) {
  // Unless specified otherwise, use a principal with limited privileges.
  this._defaultPrincipal = resolvePrincipal(defaultPrincipal,
                                            "http://www.mozilla.org");
};

exports.SandboxFactory.prototype = {
  createSandbox: function createSandbox(options) {
    let principal = resolvePrincipal(options.principal, this._defaultPrincipal);

    return {
      _sandbox: new Cu.Sandbox(principal),
      _principal: principal,
      get globalScope() {
        return this._sandbox;
      },
      defineProperty: function defineProperty(name, value) {
        this._sandbox[name] = value;
      },
      getProperty: function getProperty(name) {
        return this._sandbox[name];
      },
      evaluate: function evaluate(options) {
        if (typeof options == "string")
          options = {contents: options};
        options = override({}, options);
        if (typeof options.contents != "string")
          throw new Error("Expected string for options.contents");
        if (options.lineNo === undefined)
          options.lineNo = 1;
        if (options.jsVersion === undefined)
          options.jsVersion = "1.8";
        if (typeof options.filename != "string")
          options.filename = "<string>";

        if (this._principal == systemPrincipal)
          options.filename = maybeParentifyFilename(options.filename);

        return Cu.evalInSandbox(options.contents,
                                this._sandbox,
                                options.jsVersion,
                                options.filename,
                                options.lineNo);
      }
    };
  }
};

exports.Loader = function Loader(options) {
  options = override({}, options);

  if ("modules" in options)
    throw new Error("options.modules is no longer supported");

  if (options.fs === undefined) {
    if (options.paths) {
      let fses = [];
      for (let pathPrefix in options.paths)
        fses.push(new exports.LocalFileSystem(options.paths[pathPrefix], pathPrefix));
      options.fs = new exports.CompositeFileSystem(fses);
    } else
      options.fs = new exports.LocalFileSystem();
  }

  if (options.sandboxFactory === undefined) {
    options.sandboxFactory = new exports.SandboxFactory(
      options.defaultPrincipal
    );
  }

  if (options.globals === undefined)
    options.globals = {};

  this.fs = options.fs;
  this.sandboxFactory = options.sandboxFactory;
  this.sandboxes = {};
  this.modules = {};
  this.module_infos = {};
  this.globals = options.globals;
  this.resolve = options.resolve;
  this.getModuleExports = options.getModuleExports;
  this.modifyModuleSandbox = options.modifyModuleSandbox;
  this.securityPolicy = options.securityPolicy;
};

exports.Loader.prototype = {
  _makeRequire: function _makeRequire(basePath) {
    let self = this;

    return function require(module) {
      let exports;

      if (typeof self.resolve == "function")
        module = self.resolve(module, basePath);

      if (self.getModuleExports)
        exports = self.getModuleExports(basePath, module);

      let module_info = null; /* null for require("chrome") */
      if (!exports) {
        let path = self.fs.resolveModule(basePath, module);
        if (!path)
          throw new Error("Module '" + module + "' not found");
        if (path in self.modules) {
          module_info = self.module_infos[path];
        } else {
          module_info = self.fs.getFile(path);
          // module_info.filename is read by sandbox.evaluate() to generate
          // tracebacks, so the property must be named ".filename" even though
          // ".url" might be more accurate
          if (module_info.filename === undefined)
            module_info.filename = path;

          if (self.securityPolicy &&
              !self.securityPolicy.allowEval(self, basePath, module, module_info)) {
            throw new Error("access denied to execute module: " + module);
          }

          let sandbox = self.sandboxFactory.createSandbox(module_info);
          self.sandboxes[path] = sandbox;
          for (let name in self.globals)
            sandbox.defineProperty(name, self.globals[name]);
          sandbox.defineProperty("require", self._makeRequire(path));
          self.module_infos[path] = module_info;
          if (self.modifyModuleSandbox)
            self.modifyModuleSandbox(sandbox, module_info);
          sandbox.evaluate("var module = {exports: {}};var exports = module.exports;");
          self.modules[path] = sandbox.getProperty("exports");
          sandbox.evaluate(module_info);
        }
        exports = self.modules[path];
      }

      if (self.securityPolicy &&
          !self.securityPolicy.allowImport(self, basePath, module, module_info, exports)) {
        throw new Error("access denied to import module: " + module);
      }

      return exports;
    };
  },

  // This is only really used by unit tests and other development-related
  // facilities, allowing access to symbols defined in the global scope of a module.
  findSandboxForModule: function findSandboxForModule(module) {
    let path = this.fs.resolveModule(null, module);
    if (!path)
      throw new Error("Module '" + module + "' not found");
    if (!(path in this.sandboxes))
      this.require(module);
    if (!(path in this.sandboxes))
      throw new Error("Internal error: path not in sandboxes: " +
                      path);
    return this.sandboxes[path];
  },

  require: function require(module) {
    return (this._makeRequire(null))(module);
  },

  runScript: function runScript(options, extraOutput) {
    if (typeof options == "string")
      options = {contents: options};
    options = override({}, options);
    let sandbox = this.sandboxFactory.createSandbox(options);
    if (extraOutput)
      extraOutput.sandbox = sandbox;
    for (name in this.globals)
      sandbox.defineProperty(name, this.globals[name]);
    sandbox.defineProperty("require", this._makeRequire(null));
    return sandbox.evaluate(options);
  }
};

exports.CompositeFileSystem = function CompositeFileSystem(fses) {
  this.fses = fses;
  this._pathMap = {};
};

exports.CompositeFileSystem.prototype = {
  resolveModule: function resolveModule(base, path) {
    for (let fs of this.fses) {
      let absPath = fs.resolveModule(base, path);
      if (absPath) {
        this._pathMap[absPath] = fs;
        return absPath;
      }
    }
    return null;
  },
  getFile: function getFile(path) {
    return this._pathMap[path].getFile(path);
  }
};

exports.LocalFileSystem = function LocalFileSystem(root, prefix) {
  if (root === undefined) {
    if (!baseURI)
      throw new Error("Need a root path for module filesystem");
    root = baseURI;
  }
  if (typeof root == "string")
    root = ios.newURI(root, null, baseURI);
  if (root instanceof Ci.nsIFile)
    root = ios.newFileURI(root);
  if (!(root instanceof Ci.nsIURI))
    throw new Error("Expected nsIFile, nsIURI, or string for root");

  this.root = root.spec;
  this.prefix = prefix || null;
  this._rootURI = root;
  this._rootURIDir = getRootDir(root.spec);
};

exports.LocalFileSystem.prototype = {
  resolveModule: function resolveModule(base, path) {
    path = path + ".js";
    if (this.prefix) {
      if (path.indexOf(this.prefix) !== 0)
        return null;
      path = path.substr(this.prefix.length);
    }

    let baseURI;
    if (!base || path.charAt(0) != ".")
      baseURI = this._rootURI;
    else
      baseURI = ios.newURI(base, null, null);
    let newURI = ios.newURI(path, null, baseURI);
    if (newURI.spec.indexOf(this._rootURIDir) === 0) {
      let channel = ios.newChannelFromURI(newURI);
      try {
        channel.open().close();
      } catch (e if e.result == Cr.NS_ERROR_FILE_NOT_FOUND) {
        return null;
      }
      return newURI.spec;
    }
    return null;
  },

  getFile: function getFile(path) {
    let channel = ios.newChannel(path, null, null);
    let iStream = channel.open();
    let ciStream = Cc["@mozilla.org/intl/converter-input-stream;1"]
                     .createInstance(Ci.nsIConverterInputStream);
    let bufLen = 0x8000;
    ciStream.init(iStream, "UTF-8", bufLen,
                  Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
    let chunk = {};
    let data = "";
    while (ciStream.readString(bufLen, chunk) > 0)
      data += chunk.value;
    ciStream.close();
    iStream.close();
    return {contents: data};
  }
};

if (global.window) {
  // We're being loaded in a chrome window, or a web page with UniversalXPConnect
  // privileges.
  global.SecurableModule = exports;
} else if (global.exports) {
  // We're being loaded in a SecurableModule.
  for (name in exports)
    global.exports[name] = exports[name];
} else {
  // We're being loaded in a JS module.
  global.EXPORTED_SYMBOLS = [];
  for (let name in exports) {
    global.EXPORTED_SYMBOLS.push(name);
    global[name] = exports[name];
  }
}

})(this);
