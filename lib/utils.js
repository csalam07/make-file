let EventEmitter = require('events').EventEmitter
  , path = require('path')
  , tty = require('tty')
  , basename = path.basename;


function Choice(tag, desc) {
  this.tag = tag;
  this.required = ~tag.indexOf('<');
  this.optional = ~tag.indexOf('[');
  this.bool = !~tag.indexOf('-no-');
  tag = tag.split(/[ ,|]+/);
  if (tag.length > 1 && !/^[[<]/.test(tag[1])) this.short = tag.shift();
  this.long = tag.shift();
  this.desc = desc;
}

Choice.prototype.name = function(){
  return this.long
    .replace('--', '')
    .replace('no-', '');
};

Choice.prototype.is = function(arg){
  return arg == this.short
    || arg == this.long;
};


function Utils(name) {
  this.commands = [];
  this.options = [];
  this.args = [];
  this.name = name;
}

Utils.prototype.__proto__ = EventEmitter.prototype;

Utils.prototype.utils = function(name){
  let args = name.split(/ +/);
  let cmd = new Utils(args.shift());
  this.commands.push(cmd);
  cmd.parseExpectedArgs(args);
  cmd.parent = this;
  return cmd;
};

Utils.prototype.parseExpectedArgs = function(args){
  if (!args.length) return;
  let self = this;
  args.forEach(function(arg){
    switch (arg[0]) {
      case '<':
        self.args.push({ required: true, name: arg.slice(1, -1) });
        break;
      case '[':
        self.args.push({ required: false, name: arg.slice(1, -1) });
        break;
    }
  });
  return this;
};

Utils.prototype.action = function(fn){
  let self = this;
  this.parent.on(this.name, function(args, unknown){    
    unknown = unknown || [];
    let parsed = self.parseOptions(unknown);
    
    outputHelpIfNecessary(self, parsed.unknown);
  
    if (parsed.unknown.length > 0) {      
      self.unknownOption(parsed.unknown[0]);
    }
    
    self.args.forEach(function(arg, i){
      if (arg.required && null == args[i]) {
        self.missingArgument(arg.name);
      }
    });
    
    if (self.args.length) {
      args[self.args.length] = self;
    } else {
      args.push(self);
    }
    
    fn.apply(this, args);
  });
  return this;
};

Utils.prototype.option = function(tag, desc, fn, defaultValue){
  let self = this
    , option = new Choice(tag, desc)
    , oname = option.name()
    , name = camelcase(oname);

  if ('function' != typeof fn) defaultValue = fn, fn = null;

  if (false == option.bool || option.optional || option.required) {
    if (false == option.bool) defaultValue = true;
    if (undefined !== defaultValue) self[name] = defaultValue;
  }

  this.options.push(option);

  this.on(oname, function(val){
    if (null != val && fn) val = fn(val);

    if ('boolean' == typeof self[name] || 'undefined' == typeof self[name]) {
      if (null == val) {
        self[name] = option.bool
          ? defaultValue || true
          : false;
      } else {
        self[name] = val;
      }
    } else if (null !== val) {
      self[name] = val;
    }
  });

  return this;
};

Utils.prototype.parse = function(argv){
  this.rawArgs = argv;
  if (!this.name) this.name = basename(argv[1]);
  let parsed = this.parseOptions(this.normalize(argv.slice(2)));
  this.args = parsed.args;
  return this.parseArgs(this.args, parsed.unknown);
};

Utils.prototype.normalize = function(args){
  let ret = []
    , arg;

  for (let i = 0, len = args.length; i < len; ++i) {
    arg = args[i];
    if (arg.length > 1 && '-' == arg[0] && '-' != arg[1]) {
      arg.slice(1).split('').forEach(function(c){
        ret.push('-' + c);
      });
    } else {
      ret.push(arg);
    }
  }

  return ret;
};

Utils.prototype.parseArgs = function(args, unknown){
  let cmds = this.commands
    , len = cmds.length
    , name;

  if (args.length) {
    name = args[0];
    if (this.listeners(name).length) {
      this.emit(args.shift(), args, unknown);
    } else {
      this.emit('*', args);
    }
  } else {
    outputHelpIfNecessary(this, unknown);
    if (unknown.length > 0) {      
      this.unknownOption(unknown[0]);
    }
  }

  return this;
};

Utils.prototype.optionFor = function(arg){
  for (let i = 0, len = this.options.length; i < len; ++i) {
    if (this.options[i].is(arg)) {
      return this.options[i];
    }
  }
};

Utils.prototype.parseOptions = function(argv){
  let args = []
    , len = argv.length
    , literal
    , option
    , arg;

  let unknownOptions = [];

  for (let i = 0; i < len; ++i) {
    arg = argv[i];

    if ('--' == arg) {
      literal = true;
      continue;
    }

    if (literal) {
      args.push(arg);
      continue;
    }

    option = this.optionFor(arg);

    if (option) {
      if (option.required) {
        arg = argv[++i];
        if (null == arg) return this.optionMissingArgument(option);
        if ('-' == arg[0]) return this.optionMissingArgument(option, arg);
        this.emit(option.name(), arg);
      } else if (option.optional) {
        arg = argv[i+1];
        if (null == arg || '-' == arg[0]) {
          arg = null;
        } else {
          ++i;
        }
        this.emit(option.name(), arg);
      // bool
      } else {
        this.emit(option.name());
      }
      continue;
    }
    if (arg.length > 1 && '-' == arg[0]) {
      unknownOptions.push(arg);
      if (argv[i+1] && '-' != argv[i+1][0]) {
        unknownOptions.push(argv[++i]);
      }
      continue;
    }
    args.push(arg);
  }
  
  return { args: args, unknown: unknownOptions };
};

Utils.prototype.missingArgument = function(name){
  console.error();
  console.error("  error: missing required argument `%s'", name);
  console.error();
  process.exit(1);
};

Utils.prototype.optionMissingArgument = function(option, flag){
  console.error();
  if (flag) {
    console.error("  error: option `%s' argument missing, got `%s'", option.tag, flag);
  } else {
    console.error("  error: option `%s' argument missing", option.tag);
  }
  console.error();
  process.exit(1);
};

Utils.prototype.unknownOption = function(flag){
  console.error();
  console.error("  error: unknown option `%s'", flag);
  console.error();
  process.exit(1);
};

Utils.prototype.version = function(str, tag){
  if (0 == arguments.length) return this._version;
  this._version = str;
  tag = tag || '-V, --version';
  this.option(tag, 'output the version number');
  this.on('version', function(){
    console.log(str);
    process.exit(0);
  });
  return this;
};

Utils.prototype.desc = function(str){
  if (0 == arguments.length) return this._description;
  this._description = str;
  return this;
};

Utils.prototype.usage = function(str){
  let args = this.args.map(function(arg){
    return arg.required
      ? '<' + arg.name + '>'
      : '[' + arg.name + ']';
  });

  let usage = '[options'
    + (this.commands.length ? '] [utils' : '')
    + ']'
    + (this.args.length ? ' ' + args : '');
  if (0 == arguments.length) return this._usage || usage;
  this._usage = str;

  return this;
};

Utils.prototype.largestOptionLength = function(){
  return this.options.reduce(function(max, option){
    return Math.max(max, option.tag.length);
  }, 0);
};

Utils.prototype.optionHelp = function(){
  let width = this.largestOptionLength();
  
  // Prepend the help information
  return [pad('-h, --help', width) + '  ' + 'output usage information']
    .concat(this.options.map(function(option){
      return pad(option.tag, width)
        + '  ' + option.desc;
      }))
    .join('\n');
};

Utils.prototype.commandHelp = function(){
  if (!this.commands.length) return '';
  return [
      ''
    , '  Commands:'
    , ''
    , this.commands.map(function(cmd){
      let args = cmd.args.map(function(arg){
        return arg.required
          ? '<' + arg.name + '>'
          : '[' + arg.name + ']';
      }).join(' ');

      return cmd.name 
        + (cmd.options.length 
          ? ' [options]'
          : '') + ' ' + args
        + (cmd.desc()
          ? '\n' + cmd.desc()
          : '');
    }).join('\n\n').replace(/^/gm, '    ')
    , ''
  ].join('\n');
};

Utils.prototype.helpInformation = function(){
  return [
      ''
    , '  Usage: ' + this.name + ' ' + this.usage()
    , '' + this.commandHelp()
    , '  Options:'
    , ''
    , '' + this.optionHelp().replace(/^/gm, '    ')
    , ''
    , ''
  ].join('\n');
};

Utils.prototype.promptForNumber = function(str, fn){
  let self = this;
  this.promptSingleLine(str, function parseNumber(val){
    val = Number(val);
    if (isNaN(val)) return self.promptSingleLine(str + '(must be a number) ', parseNumber);
    fn(val);
  });
};

Utils.prototype.promptForDate = function(str, fn){
  let self = this;
  this.promptSingleLine(str, function parseDate(val){
    val = new Date(val);
    if (isNaN(val.getTime())) return self.promptSingleLine(str + '(must be a date) ', parseDate);
    fn(val);
  });
};

Utils.prototype.promptSingleLine = function(str, fn){
  if ('function' == typeof arguments[2]) {
    return this['promptFor' + (fn.name || fn)](str, arguments[2]);
  }

  process.stdout.write(str);
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', function(val){
    fn(val.trim());
  }).resume();
};

Utils.prototype.promptMultiLine = function(str, fn){
  let buf = [];
  console.log(str);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function(val){
    if ('\n' == val || '\r\n' == val) {
      process.stdin.removeAllListeners('data');
      fn(buf.join('\n'));
    } else {
      buf.push(val.trimRight());
    }
  }).resume();
};

Utils.prototype.prompt = function(str, fn){
  let self = this;

  if ('string' == typeof str) {
    if (/ $/.test(str)) return this.promptSingleLine.apply(this, arguments);
    this.promptMultiLine(str, fn);
  } else {
    let keys = Object.keys(str)
      , obj = {};

    function next() {
      let key = keys.shift()
        , label = str[key];

      if (!key) return fn(obj);
      self.prompt(label, function(val){
        obj[key] = val;
        next();
      });
    }

    next();
  }
};

Utils.prototype.password = function(str, mask, fn){
  let self = this
    , buf = '';

  if ('function' == typeof mask) {
    fn = mask;
    mask = '';
  }

  process.stdin.resume();
  tty.setRawMode(true);
  process.stdout.write(str);

  process.stdin.on('keypress', function(c, key){
    if (key && 'enter' == key.name) {
      console.log();
      process.stdin.removeAllListeners('keypress');
      tty.setRawMode(false);
      if (!buf.trim().length) return self.password(str, mask, fn);
      fn(buf);
      return;
    }

    if (key && key.ctrl && 'c' == key.name) {
      console.log('%s', buf);
      process.exit();
    }

    process.stdout.write(mask);
    buf += c;
  }).resume();
};

Utils.prototype.confirm = function(str, fn, verbose){
  let self = this;
  this.prompt(str, function(ok){
    if (!ok.trim()) {
      if (!verbose) str += '(yes or no) ';
      return self.confirm(str, fn, true);
    }
    fn(parseBool(ok));
  });
};


Utils.prototype.choose = function(list, index, fn){
  let self = this
    , hasDefault = 'number' == typeof index;

  if (!hasDefault) {
    fn = index;
    index = null;
  }

  list.forEach(function(item, i){
    if (hasDefault && i == index) {
      console.log('* %d) %s', i + 1, item);
    } else {
      console.log('  %d) %s', i + 1, item);
    }
  });

  function again() {
    self.prompt('  : ', function(val){
      val = parseInt(val, 10) - 1;
      if (hasDefault && isNaN(val)) val = index;

      if (null == list[val]) {
        again();
      } else {
        fn(val, list[val]);
      }
    });
  }

  again();
};

function camelcase(flag) {
  return flag.split('-').reduce(function(str, word){
    return str + word[0].toUpperCase() + word.slice(1);
  });
}

function parseBool(str) {
  return /^y|yes|ok|true$/i.test(str);
}

function pad(str, width) {
  let len = Math.max(0, width - str.length);
  return str + Array(len + 1).join(' ');
}

function outputHelpIfNecessary(cmd, options) {
  options = options || [];
  for (let i = 0; i < options.length; i++) {
    if (options[i] == '--help' || options[i] == '-h') {
      process.stdout.write(cmd.helpInformation());
      cmd.emit('--help');
      process.exit(0);
    }
  }
}

exports = module.exports = new Utils;

exports.Utils = Utils;

exports.Choice = Choice;
