/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ["Console"];

const _slice = Array.prototype.slice;

let times = {};

let console = {
  log: function() {
    log.apply(this, arguments);
  },

  warn: function() {
    log.apply(this, _slice.call(arguments).concat("error"));
  },

  exception: function() {
    log.apply(this, _slice.call(arguments).concat("fatal"));
  },

  dir: function() {
    log.apply(this, _slice.call(arguments).map(object => inspect(object)));
  },

  time: function(label) {
    times[label] = Date.now();
  },

  timeEnd: function(label) {
    let duration = Date.now() - times[label];
    this.log("%s: %dms", label, duration);
  },

  trace: function(label) {
    let msg = "Stack trace:\n";
    let frame = Components.stack.caller;
    while (frame) {
      msg += "    " + frame + "\n";
      frame = frame.caller;
    }
    this.log(err.stack);
  },

  fromEvent: function(e) {
    if (this[e.level])
      this[e.level].apply(this, e.arguments);
  }
};

const levels = {
  "info":  ["\033[90m", "\033[39m"], // grey
  "error": ["\033[31m", "\033[39m"], // red
  "fatal": ["\033[35m", "\033[39m"], // magenta
  "exit":  ["\033[36m", "\033[39m"]  // cyan
};

/**
 *  Util#log(arg1, [arg2], [type]) -> null
 *      - arg1 (mixed): messages to be printed to the standard output
 *      - type (String): type denotation of the message. Possible values:
 *          'info', 'error', 'fatal', 'exit'. Optional, defaults to 'info'.
 * 
 *  Unified logging to the console; arguments passed to this function will put logged
 *  to the standard output of the current process and properly formatted.
 *  Any non-String object will be inspected by the NodeJS util#inspect utility
 *  function.
 *  Messages will be prefixed with its type (with corresponding font color), like so:
 * 
 *      [info] informational message
 *      [error] error message
 *      [fatal] fatal error message
 *      [exit] program exit message (not an error)
 * 
 * The type of message can be defined by passing it to this function as the last/ 
 * final argument. If the type can not be found, this last/ final argument will be
 * regarded as yet another message.
 **/
function log() {
  let args = _slice.call(arguments);
  let lastArg = args[args.length - 1];

  let level, logAfter;
  try {
    if (levels[lastArg])
      level = args.pop();
  } catch(ex) {
    logAfter = ["Error (not fatal) while logging to console: " + ex.message, "error"];
  } finally {
    if (!level)
      level = "info";
  }
  if (!args.length)
    return;

  let finalArgs = [];
  while (args.length) {
    args = format.apply(this, args);
    finalArgs.push(args.shift());
  }
  let msg = finalArgs.join(" ");
  let pfx = levels[level][0] + "[" + level + "]" + levels[level][1];

  for (let line of msg.split("\n"))
    dump(pfx + " " + line + "\n");

  if (Array.isArray(logAfter) && logAfter.length)
    log.apply(this, logAfter);
}

function safeToString(s) {
  try {
    s = String(s)
  } catch(ex) {
    s = Object.prototype.toString.call(s);
  }
  return s;
}

function format(f) {
  let i = 1;
  let args = _slice.call(arguments);
  let str = String(f).replace(/%[sdj]/g, function(x) {
    switch (x) {
      case "%s":
        return safeToString(args[i++]);
      case "%d":
        return Number(args[i++]);
      case "%j": 
        let val;
        try {
          val = JSON.stringify(args[i]);
        }
        catch (ex) {
          val = safeToString(args[i]) || "[" + ex.message + "]";
        }
        let ret = typeof val == "undefined" ? safeToString(args[i]) : val;
        ++i;
        return ret;
      default:
        return x;
    }
  });
  return [str].concat(args.slice(i));
}

function inspect(obj, depth, parentsKey = "") {
  if (!obj)
    return;

  let out = [];
  let name = Object.prototype.toString.call(obj)
              .split(" ").pop().split("]").shift();
  let proto = Object.getPrototypeOf(obj);
  let depth = depth || 0;
  let indent = Array(depth + 1).join("  ");

  if (depth === 0) {
    if (typeof obj == "function")
      name = "[" + name + ": " + obj.name + "]";
    else
      name = "[" + name + "]";
    out.push(format(indent + "\033[33m%s\033[0m", name)[0]);
  } else {
    out.push(format(indent + "\033[90m.%s\033[0m \033[33m[%s]\033[0m", parentsKey, name)[0]);
  }

  for (let propName of Object.getOwnPropertyNames(obj)) {
    let desc;
    try {
      desc = Object.getOwnPropertyDescriptor(obj, propName);
    } catch (ex) {
      out.push(format(indent + "  \033[90m.%s [object WrappedNative]\033[0m", propName)[0]);
    }
    if (!desc)
      continue;
    if (!desc.value) {
      try {
        desc.value = obj[propName];
      } catch (ex) {
        desc.value = ex.message.split(/\r?\n/)[0];
      }
    }
    if (desc.get)
      out.push(format(indent + "  \033[90m.%s\033[0m", propName)[0]);
    if (desc.set)
      out.push(format(indent + "  \033[90m.%s=\033[0m", propName)[0]);
    if (typeof desc.value == "function") {
      let str = String(desc.value);
      let params = str.match(/^function *\((.*?)\)/);
      let val = params ? params[1].split(/ *, */).map(function(param){
        return "\033[0m" + param + "\033[90m";
      }).join(", ") : "";
      out.push(format(indent + "  \033[90m.%s(%s)\033[0m", propName, String(val))[0]);
    } else if (typeof desc.value == "object" && depth < 5) {
      // Recurse, unless it's a null object or our depth is > 5
      let nested = inspect(desc.value, depth + 1, propName);
      out = out.concat(nested);
    } else {
      let value = typeof desc.value != "undefined" ? desc.value : "";
      out.push(format(indent + "  \033[90m.%s %s\033[0m", propName, value)[0]);
    }
  }

  let next = inspect(proto, ++depth, "prototype");
  if (next)
    out.push(next);
  return out.join("\n");
}

// Put some aliases in place.
console.info = console.log;
console.error = console.warn;

this.Console = console;
