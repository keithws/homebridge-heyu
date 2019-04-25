// Heyu Platform Plugin for HomeBridge
//
// Remember to add platform to config.json. Example:
// "platforms": [{
//       "platform": "Heyu",
//       "name": "Heyu",
//       "heyuExec": "/usr/local/bin/heyu",   //optional - defaults to /usr/local/bin/heyu
//       "x10conf": "/etc/heyu/x10.conf",     //optional - defaults to /etc/heyu/x10.conf
//       "useFireCracker": false,             //optional - If true, uses CM17A FireCracker module to issue on/off commands
//       "cputemp": "cputemp"                 //optional - If present includes cpu TemperatureSensor
//   }]

"use strict";

var debug = require('debug')('Heyu');
var Characteristic, Service;
var exec = require('child_process').execFile;
var execSync = require('child_process').execFileSync;
var spawn = require('child_process').spawn;
var os = require("os");
var heyuExec, heyuQueue, cputemp, x10conf, useFireCracker;
var X10Commands = {
  on: "on",
  off: "off",
  bright: "bright",
  preset: "preset",
  dim: "dim",
  dimlevel: "dimlevel",
  rawlevel: "rawlevel",
  allon: "allon",
  alloff: "alloff",
  lightson: "lightson",
  lightsoff: "lightsoff",
  onstate: "onstate",
  xon: "xon",
  xoff: "xoff",
  xpreset: "xpreset"
};

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  // Accessory = homebridge.hap.Accessory;
  // uuid = homebridge.hap.uuid;

  homebridge.registerPlatform("homebridge-heyu", "Heyu", HeyuPlatform);
};

heyuQueue = {
  items: [],
  isRunning: false
};

function execQueue() {
  // push these args to the end of the queue
  //
  /*
  debug("Queue", heyuQueue.items.length, arguments[1].join(" "));
  debug("Arguments a=%s, b=%s, c=%s", a, b, c);
  if (heyuQueue.items.length > 0) {
    var pervious = heyuQueue.items[heyuQueue.items.length - 1];
    debug("Previous", JSON.stringify(pervious));
    debug("Equal %s === %s", arguments[1][2], pervious[1][2]);
    if (arguments[1][2] === pervious[1][2] && (arguments[1][2] === 'on' || arguments[1][2] === 'off' || arguments[1][2] === 'bright' || arguments[1][2] === 'dim')) {
      pervious[1][3] = pervious[1][3] + ',' + arguments[1][3].substring(1);
    }
  }
  */
  heyuQueue.items.push(arguments);

  // run the queue
  runQueue();
}

function runQueue() {
  if (!heyuQueue.isRunning && heyuQueue.items.length > 0) {
    heyuQueue.isRunning = true;
    var args = heyuQueue.items.shift();

    if (args.length > 1) {
      // wrap callback with another function to toggle isRunning
      var callback = args[args.length - 1];
      args[args.length - 1] = function() {
        callback.apply(null, arguments);
        heyuQueue.isRunning = false;
        runQueue();
      };
    } else {
      // add callback to toggle isRunning
      args[args.length] = function() {
        heyuQueue.isRunning = false;
        runQueue();
      };
      args.length = args.length + 1;
    }
    debug("heyuCommand", args[1].join(" "));
    // debug("exec", JSON.stringify(args));
    exec.apply(null, args);
  }
}

function HeyuPlatform(log, config) {
  this.log = log;
  this.log("Heyu Platform Plugin Loaded ");
  this.faccessories = {}; // an array of accessories by housecode
  // platform options
  heyuExec = config.heyuExec || "/usr/local/bin/heyu";
  x10conf = config.x10conf || "/etc/heyu/x10.conf";
  useFireCracker = config.useFireCracker || false;
  cputemp = config.cputemp;
  this.housecode = readHousecode();

  if (useFireCracker) {
    enableFireCracker();
  }

  this.config = config;
  this.devices = this.config.devices;
}

function heyuShowAliases() {
  var aliases, lines, stdout;

  stdout = execSync(heyuExec, ["-c", x10conf, "show", "aliases"], {
    "encoding": "utf8"
  });
  lines = stdout.split("\n").slice(1, -2);
  aliases = lines.map(function(line) {
    var alias, words;

    words = line.split(/\s+/);
    alias = {
      "label": words[2],
      "housecode": words[3].slice(0, 1),
      "devices": words[3].slice(1),
      "moduleType": words[4],
      "moduleOption": words[5]
    };

    return alias;
  });
  return aliases;
}

function readHousecode() {
  var housecode, matches, stdout;

  stdout = execSync(heyuExec, ["-c", x10conf, "info"], {
    encoding: "utf8"
  });
  matches = stdout.match(/Housecode = ([A-P])/);
  if (matches) {
    housecode = matches[1];
  }
  debug("HOUSECODE", housecode);

  return housecode;
}

function enableFireCracker() {
  X10Commands.on = "fon";
  X10Commands.off = "foff";
  X10Commands.bright = "fbright";
  X10Commands.preset = null;
  X10Commands.dim = "fdim";
  X10Commands.allon = "fallon";
  X10Commands.alloff = "falloff";
  X10Commands.lightson = "flightson";
  X10Commands.lightsoff = "flightsoff";
  X10Commands.xon = "fon";
  X10Commands.xoff = "foff";
  X10Commands.xpreset = null;
}

HeyuPlatform.prototype = {
  accessories: function(callback) {
    var foundAccessories = [];
    var self = this;
    //
    var aliases = heyuShowAliases();

    aliases.forEach(function(alias) {
      var device = {
        "name": alias.label.replace(/[_.-]/g, " "),
        "housecode": alias.housecode + alias.devices,
        "module": alias.moduleType
      };

      self.log("Found in x10.conf: %s %s %s", device.name, device.housecode, device.module);
      var accessory = new HeyuAccessory(self.log, device, null);
      foundAccessories.push(accessory);
      var housecode = device.housecode;
      self.faccessories[housecode] = accessory;
    });
    // Built-in accessories and macro's
    var accessory, device;
    {
      device = {};
      device.name = "All Devices";
      device.housecode = this.housecode;
      device.module = "Macro-allon";
      accessory = new HeyuAccessory(self.log, device, null);
      foundAccessories.push(accessory);
    } {
      device = {};
      device.name = "All Lights";
      device.housecode = this.housecode;
      device.module = "Macro-lightson";
      accessory = new HeyuAccessory(self.log, device, null);
      foundAccessories.push(accessory);
    }

    if (cputemp !== undefined) {
      device = {};
      device.name = os.hostname();
      device.module = "Temperature";
      accessory = new HeyuAccessory(self.log, device, null);
      foundAccessories.push(accessory);
    }

    // Start heyu monitor
    this.log("Starting heyu monitor");

    self.start = spawn(heyuExec, ["-c", x10conf, "start"]);
    self.heyuMonitor = spawn(heyuExec, ["-c", x10conf, "monitor"]);
    self.heyuMonitor.stdout.on('data', function(data) {
      self.handleOutput(self, data);
    });
    self.heyuMonitor.stderr.on('data', function(data) {
      self.handleOutput(self, data);
    });
    self.heyuMonitor.on('close', function(code) {
      self.log('Process ended. Code: ' + code);
    });

    self.log("heyuMonitor started.");

    if (useFireCracker) {
      self.log("CM17A FireCracker module support enabled");
    }

    callback(foundAccessories);
  }
};

function HeyuAccessory(log, device) {
  // This is executed once per accessory during initialization

  var self = this;

  self.device = device;
  self.log = log;
  self.name = device.name;
  self.housecode = device.housecode;
  self.module = device.module;
  // heyu Commands

  self.on_command = X10Commands.on;
  self.off_command = X10Commands.off;
  self.status_command = X10Commands.onstate;
  self.brightness_command = X10Commands.rawlevel; // dimlevel cannot be trusted
  self.statusHandling = "yes";
  self.dimmable = "yes";
}

HeyuPlatform.prototype.handleOutput = function(self, data) {
  // 06/16 20:32:48  rcvi addr unit       5 : hu A5  (Family_room_Pot_lights)
  // 06/16 20:32:48  rcvi func          Off : hc A

  var message = data.toString().split(/[ \t]+/);
  //    this.log("Message %s %s %s %s %s %s", message[2], message[3], message[4], message[5], message[6], message[7], message[8]);
  var operation = message[2];
  var proc = message[3];
  if (proc === "addr") {
    var messageHousecode = message[8];
  } else if (proc === "func") {
    // FUTURE var messageCommand = message[4];
  }

  if (proc === "addr" && operation === "rcvi") {
    this.log("Event occured at housecode %s", messageHousecode);
    var accessory = self.faccessories[messageHousecode];
    if (accessory !== undefined) {
      self.heyuEvent(self, accessory);
    } else {
      this.log.error("Event occured at unknown device %s ignoring", messageHousecode);
    }
  }
};

HeyuPlatform.prototype.heyuEvent = function(self, accessory) {
  var other = accessory;
  switch (other.module) {
    case "AM":
    case "StdAM":
    case "AM486":
    case "AM466":
    case "PAM01":
    case "PAM02":
    case "AM12":
    case "SR227":
    case "PA011":
    case "AMS":
    case "RR501":
    case "PAT01":
    case "RAIN8II":
    case "WS":
    case "WS467":
    case "WS13A":
    case "XPS3":
    case "LM15A":
    case "PSM04":
    case "LM15":
    case "AM14A":
    case "AM15A":
    case "PAM21":
    case "PAM22":
    case "SL1AM":
    case "SL2AM":
    case "RS114":
    case "RF234":
      other.service.getCharacteristic(Characteristic.On).getValue();
      break;
    case "LM465-1":
    case "LM-1":
    case "LM":
    case "StdLM":
    case "LM465":
    case "PLM01":
    case "PLM03":
    case "LM12":
    case "LMS":
    case "WS467-1":
    case "WS-1":
    case "LW10U":
    case "WS12A":
    case "XPD3":
    case "LM14A":
    case "PLM21":
    case "SL1LM":
    case "SL2LM":
    case "SL2380W":
    case "LL1LM":
    case "LL2LM":
    case "LL2000STW":
      other.service.getCharacteristic(Characteristic.Brightness).getValue();
      other.service.getCharacteristic(Characteristic.On).getValue();
      break;
    case "MS10":
    case "MS12":
    case "MS13":
    case "MS14":
    case "MS16":
      other.lastheard = Date.now();
      other.service.getCharacteristic(Characteristic.MotionDetected).getValue();
      break;
    case "MS10A":
    case "MS12A":
    case "MS13A":
    case "MS14A":
    case "MS16A":
      //    debug(JSON.stringify(other, null, 2));
      other.lastheard = Date.now();
      other.service.getCharacteristic(Characteristic.StatusLowBattery).getValue();
      other.service.getCharacteristic(Characteristic.CurrentAmbientLightLevel).getValue();
      break;
    default:
      this.log.error("No events defined for Module Type %s", other.module);
  }
};

HeyuAccessory.prototype = {

  setupStdLM: function() {
    this.log("StdLM: Adding %s %s as a %s", this.name, this.housecode, this.module);
    this.service = new Service.Lightbulb(this.name);
    this.service
      .getCharacteristic(Characteristic.On)
      .on('get', this.getPowerState.bind(this))
      .on('set', this.setPowerState.bind(this));
    // Brightness Polling
    if (this.dimmable === "yes") {
      this.service
        .addCharacteristic(new Characteristic.Brightness())
        .setProps({
          minStep: 1
        })
        .on('get', this.getBrightness.bind(this))
        .on('set', this.setBrightness.bind(this));
    }
    return this.service;
  },
  getServices: function() {
    var services = [];
    // set up the accessory information - not sure how mandatory any of this is.
    var service = new Service.AccessoryInformation();
    service.setCharacteristic(Characteristic.Name, this.name).setCharacteristic(Characteristic.Manufacturer, "Heyu");

    service
      .setCharacteristic(Characteristic.Model, this.module + " " + this.housecode)
      .setCharacteristic(Characteristic.SerialNumber, this.housecode)
      .setCharacteristic(Characteristic.FirmwareRevision, this.device.firmwareVersion)
      .setCharacteristic(Characteristic.HardwareRevision, this.module);

    services.push(service);

    switch (this.module) {
      case "Macro-allon": // The heyu allon macro
        this.log("Macro-allon: Adding %s %s as a %s", this.name, this.housecode, this.module);
        this.on_command = X10Commands.allon;
        this.off_command = X10Commands.alloff;
        this.dimmable = "no";
        this.statusHandling = "no";
        this.service = new Service.Switch(this.name);
        this.service
          .getCharacteristic(Characteristic.On)
          .on('get', function(callback) {
            var that = this;
            callback(null, that.state);
          })
          .on('set', this.setPowerState.bind(this));

        services.push(this.service);
        break;
      case "Macro-lightson": // The heyu allon macro
        this.log("Macro-allon: Adding %s %s as a %s", this.name, this.housecode, this.module);
        this.on_command = X10Commands.lightson;
        this.off_command = X10Commands.lightsoff;
        this.dimmable = "no";
        this.statusHandling = "no";
        this.service = new Service.Switch(this.name);
        this.service
          .getCharacteristic(Characteristic.On)
          .on('get', function(callback) {
            var that = this;
            callback(null, that.state);
          })
          .on('set', this.setPowerState.bind(this));

        services.push(this.service);
        break;
      case "LM":
      case "StdLM":
      case "LM465":
      case "PLM01":
      case "PLM03":
      case "LM12":
      case "LMS":
      case "LW10U":
      case "WS12A":
      case "XPD3":
      case "PLM21":
      case "LM15A":
      case "PSM04":
      case "LM15":
        // lamp modules (standard) (dimmable outlets and dimmable switches)
        services.push(this.setupStdLM());
        break;
      case "SL1LM":
      case "SL2LM":
      case "SL2380W":
      case "LL1LM":
      case "LL2LM":
      case "LL2000STW":
        // lamp modules that support (old) preset
        if (useFireCracker) {
          // no preset command, fallback to dim/bright
          services.push(this.setupStdLM());
        } else {
          this.hasSupportForOldPreSetDim = true;
          this.log("SL2LM: Adding %s %s as a %s", this.name, this.housecode, this.module);
          this.service = new Service.Lightbulb(this.name);
          this.service
            .getCharacteristic(Characteristic.On)
            .on('get', this.getPowerState.bind(this))
            .on('set', this.setPowerState.bind(this));
          // Brightness Polling
          if (this.dimmable === "yes") {
            this.service
              .addCharacteristic(new Characteristic.Brightness())
              .setProps({
                minStep: 1
              })
              .on('get', this.getBrightness.bind(this))
              .on('set', this.setSLBrightness.bind(this));
          }
          services.push(this.service);
        }
        break;
      case "LM14A":
      case "LM465-1":
      case "LM-1":
      case "WS467-1":
      case "WS-1":
        // lamp modules that support some extended commands
        // at least xon, xoff, and xpreset
        if (useFireCracker) {
          // no preset command, fallback to dim/bright
          services.push(this.setupStdLM());
        } else {
          this.log("LM465-1: Adding %s %s as a %s", this.name, this.housecode, this.module);
          this.hasPartialSupportForExtendedCodes = true;
          this.service = new Service.Lightbulb(this.name);
          this.service
            .getCharacteristic(Characteristic.On)
            .on('get', this.getPowerState.bind(this))
            .on('set', this.setPowerState.bind(this));
          // Brightness Polling
          if (this.dimmable === "yes") {
            this.service
              .addCharacteristic(new Characteristic.Brightness())
              .setProps({
                minStep: 1
              })
              .on('get', this.getBrightness.bind(this))
              .on('set', this.setBrightnessWithXpreset.bind(this));
          }
          services.push(this.service);
        }
        break;
      case "AM":
      case "StdAM":
      case "AM486":
      case "AM466":
      case "PAM01":
      case "PAM02":
      case "AM12":
      case "SR227":
      case "PA011":
      case "AMS":
      case "RR501":
      case "PAT01":
      case "RAIN8II":
      case "AM14A":
      case "AM15A":
      case "PAM21":
      case "PAM22":
        // appliance modules with outlets (non-dimmable outlets)
        this.log("StdAM: Adding %s %s as a %s", this.name, this.housecode, this.module);
        this.dimmable = "no"; // All Appliance modules are not dimmable
        this.service = new Service.Outlet(this.name);
        // TODO technically the Outlet service requires a OutletInUse characterist (would always be true)
        this.service
          .getCharacteristic(Characteristic.On)
          .on('get', this.getPowerState.bind(this))
          .on('set', this.setPowerState.bind(this));
        this.service
          .getCharacteristic(Characteristic.OutletInUse)
          .on('get', function(callback) {
            callback(null, true);
          });
        services.push(this.service);
        break;
      case "WS":
      case "WS467":
      case "WS13A":
      case "XPS3":
      case "SL1AM":
      case "SL2AM":
      case "RS114":
      case "RF234":
        // appliance modules with switches (non-dimmable switches)
        this.log("StdWS: Adding %s %s as a %s", this.name, this.housecode, this.module);
        this.dimmable = "no"; // Technically some X10 switches are dimmable, but we're treating them as on/off
        this.service = new Service.Switch(this.name);
        this.service
          .getCharacteristic(Characteristic.On)
          .on('get', this.getPowerState.bind(this))
          .on('set', this.setPowerState.bind(this));
        services.push(this.service);
        break;
      case "MS10":
      case "MS12":
      case "MS13":
      case "MS14":
      case "MS16":
        this.log("Motion Sensor: Adding %s %s as a %s", this.name, this.housecode, this.module);
        this.lastheard = Date.now();
        this.service = new Service.MotionSensor(this.name);
        this.service
          .getCharacteristic(Characteristic.MotionDetected)
          .on('get', this.getPowerState.bind(this));
        services.push(this.service);
        break;
      case "MS10A":
      case "MS12A":
      case "MS13A":
      case "MS14A":
      case "MS16A":
        this.log("Light/Dark Sensor: Adding %s %s as a %s", this.name, this.housecode, this.module);
        this.lastheard = Date.now();
        this.service = new Service.LightSensor(this.name);
        this.service
          .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
          .on('get', this.getLightSensor.bind(this));
        this.service
          .getCharacteristic(Characteristic.StatusLowBattery)
          .on('get', this.getBattery.bind(this));
        services.push(this.service);
        break;
      case "Temperature":
        this.service = new Service.TemperatureSensor(this.name);
        this.service
          .getCharacteristic(Characteristic.CurrentTemperature)
          .on('get', this.getTemperature.bind(this));
        services.push(this.service);
        break;
      default:
        this.log.error("Unknown Module Type %s", this.module);
    }
    return services;
  },

  // start of Heyu Functions

  getBattery: function(callback) {
    debug("Battery", this.housecode, (Date.now() - this.lastheard));
    // 18 Hours = 18 Hours * 60 Minutes * 60 Seconds * 1000 milliseconds
    if ((Date.now() - this.lastheard) > 18 * 60 * 60 * 1000) {
      callback(null, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
    } else {
      callback(null, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    }
  },

  getLightSensor: function(callback) {
    if (!this.status_command) {
      this.log.warn("Ignoring request; No status command defined.");
      callback(new Error("No status command defined."));
      return;
    }

    if (this.statusHandling === "no") {
      this.log.warn("Ignoring request; No status handling not available.");
      callback(new Error("No status handling defined."));
      return;
    }

    execQueue(heyuExec, ["-c", x10conf, this.status_command, this.housecode], function(error, stdout, stderr) {
      if (error !== null) {
        this.log('exec stdout: ' + stdout);
        this.log('exec stderr: ' + stderr);
        this.log('Heyu onstate function failed: ' + error);
        callback(error);
      } else {
        var binaryState = (parseInt(stdout) - 1) * -99999 + 1;
        this.log("Light Sensor of %s %s", this.housecode, binaryState);
        callback(null, binaryState);
        this.powerOn = binaryState;
      }
    }.bind(this));
  },

  setPowerState: function(powerOn, callback) {
    var housecode;
    var command;

    if (!this.on_command || !this.off_command) {
      this.log.warn("Ignoring request; No power command defined.");
      callback(new Error("No power command defined."));
      return;
    }

    if (powerOn) {
      housecode = this.housecode;
      command = this.on_command;
    } else {
      housecode = this.housecode;
      command = this.off_command;
    }

    // debug("HeyuCommand", heyuExec, command, housecode);
    execQueue(heyuExec, ["-c", x10conf, command, housecode], function(error, stdout, stderr) {
      if (error !== null) {
        this.log('exec error: ' + error);
        this.log('exec stdout: ' + stdout);
        this.log('exec stderr: ' + stderr);
        this.log('Heyu set power function failed!');
        callback(error);
      } else {
        this.powerOn = powerOn;
        this.log("Set power state of %s to %s", housecode, command);
        if (this.dimmable === "yes") {
          var that = this;
          that.service.getCharacteristic(Characteristic.Brightness).getValue();
        }
        callback();
      }
    }.bind(this));
  },

  getPowerState: function(callback) {
    if (!this.status_command) {
      this.log.warn("Ignoring request; No status command defined.");
      callback(new Error("No status command defined."));
      return;
    }

    if (this.statusHandling === "no") {
      this.log.warn("Ignoring request; No status handling not available.");
      callback(new Error("No status handling defined."));
      return;
    }

    var housecode = this.housecode;
    var command = this.status_command;

    execQueue(heyuExec, ["-c", x10conf, command, housecode], function(error, stdout, stderr) {
      if (error !== null) {
        this.log('exec stdout: ' + stdout);
        this.log('exec stderr: ' + stderr);
        this.log('Heyu onstate function failed: ' + error);
        callback(error);
      } else {
        var binaryState = parseInt(stdout);
        this.log("Got power state of %s %s", housecode, binaryState);
        var powerOn = binaryState > 0;
        callback(null, powerOn);
        this.powerOn = powerOn;
      }
    }.bind(this));
  },

  getBrightness: function(callback) {
    if (!this.brightness_command) {
      this.log.warn("Ignoring request; No brightness command defined.");
      callback(new Error("No brightness command defined."));
      return;
    }

    if (this.dimmable === "no") {
      this.log.warn("Ignoring request; housecode not dimmable.");
      callback(new Error("Device not dimmable."));
      return;
    }

    var housecode = this.housecode;

    // NOTE dimlevel cannot be trusted
    execQueue(heyuExec, ["-c", x10conf, X10Commands.rawlevel, housecode], function(error, stdout, stderr) {
      if (error !== null) {
        this.log('exec stdout: ' + stdout);
        this.log('exec stderr: ' + stderr);
        this.log('Heyu function failed: ' + error);
        callback(error);
      } else {
        var rawlevel = parseInt(stdout);
        var percent;
        if (this.hasPartialSupportForExtendedCodes) {
          // NOTE documented limit is 63, but heyu reports 62 after setting 63
          percent = Math.round(rawlevel / 62 * 100);
          this.log("Got brightness of %s/62 ( %s%% ) from %s", rawlevel, percent, housecode);
        } else if (this.hasSupportForOldPreSetDim) {
          percent = preset2pct(parseInt(stdout));
          this.log("Got brightness of %s/32 ( %s%% ) from %s", rawlevel, percent, housecode);
        } else {
          percent = Math.round(rawlevel / 210 * 100);
          this.log("Got brightness of %s/210 ( %s%% ) from %s", rawlevel, percent, housecode);
        }
        this.brightness = percent;
        callback(null, percent);
      }
    }.bind(this));
  },

  setSLBrightness: function(level, callback) {
    var housecode = this.housecode;

    execQueue(heyuExec, ["-c", x10conf, X10Commands.preset, housecode, pct2preset(level)], function(error, stdout, stderr) {
      if (error !== null) {
        this.log('exec stdout: ' + stdout);
        this.log('exec stderr: ' + stderr);
        this.log('Heyu preset function failed: %s', error);
        callback(error);
      } else {
        this.brightness = level;
        this.powerOn = true;
        this.log("Set preset %s %s %s %s", housecode, level, pct2preset(level), preset2pct(pct2preset(level)));
        // var other = this;
        // other.service.getCharacteristic(Characteristic.On).setValue(true);
        // other.service.getCharacteristic(Characteristic.Brightness).getValue();
        callback(null);
      }
    }.bind(this));
  },

  setBrightnessWithXpreset: function(percent, callback) {
    var housecode = this.housecode;

    // NOTE documented limit is 63, but heyu reports 62 after setting 63
    execQueue(heyuExec, ["-c", x10conf, X10Commands.xpreset, housecode, Math.round(percent / 100 * 62)], function(error, stdout, stderr) {
      if (error !== null) {
        this.log('exec stdout: ' + stdout);
        this.log('exec stderr: ' + stderr);
        this.log('Heyu xpreset function failed: %s', error);
        callback(error);
      } else {
        this.brightness = Math.round(Math.round(percent / 100 * 62) * 100 / 62);
        this.powerOn = true;
        this.log("Set xpreset %s %s %s %s", housecode, percent, Math.round(percent / 100 * 62), this.brightness);
        // var other = this;
        // other.service.getCharacteristic(Characteristic.On).setValue(true);
        // other.service.getCharacteristic(Characteristic.Brightness).getValue();
        callback(null);
      }
    }.bind(this));
  },

  setBrightness: function(percent, callback) {
    var housecode = this.housecode;

    var current;
    if (isNaN(this.brightness) || !this.powerOn) {
      current = 100;
    } else {
      current = this.brightness;
    }

    // this.service.getCharacteristic(Characteristic.On).setValue(true);

    var delta = Math.abs(current - percent);
    var command;
    if (percent > current) {
      command = X10Commands.bright;
    } else if (percent < current) {
      command = X10Commands.dim;
    } else {
      // this.log("Ignoring Brightness change");
      callback();
      return;
    }

    var level = pctDelta2level(delta);

    // in theory you can dim in 1 step, but
    // in practice `heyu dim HU 1` does nothing
    if (level === 1) {
      this.log('Change too small, ignored');
      callback();
      return;
    }

    // debug("HeyuCommand", heyuExec, command, housecode, level);
    execQueue(heyuExec, ["-c", x10conf, command, housecode, level], function(error, stdout, stderr) {
      if (error !== null) {
        this.log('exec stdout: ' + stdout);
        this.log('exec stderr: ' + stderr);
        this.log('Heyu brightness function failed: %s', error);
        callback(error);
      } else {
        this.brightness = percent;
        this.powerOn = true;
        this.log("Set Bright/Dim %s %s %s ( %s % )", command, housecode, delta, percent);
        callback();
      }
    }.bind(this));
  },

  getTemperature: function(callback) {
    exec(cputemp, function(error, stdout, stderr) {
      if (error !== null) {
        this.log('exec stdout: ' + stdout);
        this.log('exec stderr: ' + stderr);
        this.log('cputemp function failed: ' + error);
        callback(error);
      } else {
        var binaryState = parseInt(stdout);
        this.log("Got Temperature of %s", binaryState);
        this.brightness = binaryState;
        callback(null, binaryState);
      }
    }.bind(this));
  },

  identify: function(callback) {
    this.log("Identify requested!");
    callback(); // success
  }
};

/*
 * SmartHome's Implmentation of Pre-Set Dim
 * @url http://kbase.x10.com/wiki/Using_Pre-Set_Dim
 */
function pct2preset(percent) {
  return Math.round(percent / (100 / 31)) + 1;
}

function preset2pct(preset) {
  return Math.round((preset - 1) * (100 / 31));
}

/*
 * helper to convert deltas in percent to heyu levels
 * for standard lamp modules with levels 1–22
 */
function pctDelta2level(delta) {
  if (delta > 96) {
    return 22;
  } else {
    return Math.round(delta / (11 / 210 * 100)) + 1;
  }
}
