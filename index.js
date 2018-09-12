/* jshint node: true */
// Heyu Platform Plugin for HomeBridge
//
// Remember to add platform to config.json. Example:
//"platforms": [{
//       "platform": "Heyu",
//       "name": "Heyu",
//       "heyuExec": "/usr/local/bin/heyu",   //optional - defaults to /usr/local/bin/heyu
//       "x10conf": "/etc/heyu/x10.conf",     //optional - defaults to /etc/heyu/x10.conf
//       "useFireCracker": false,             //optional - If true, uses CM17A FireCracker module to issue on/off commands
//       "cputemp": "cputemp"                 //optional - If present includes cpu TemperatureSensor
//   }]

"use strict";

var debug = require('debug')('Heyu');
var Accessory, Characteristic, PowerConsumption, Service, uuid;
var exec = require('child_process').execFile;
var execSync = require('child_process').execFileSync;
var spawn = require('child_process').spawn;
var os = require("os");
var heyuExec, heyuQueue, cputemp, x10conf, useFireCracker;
var noMotionTimer;
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
  onstate: "onstate"
};

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;
  uuid = homebridge.hap.uuid;

  homebridge.registerPlatform("homebridge-heyu", "Heyu", HeyuPlatform);
};

heyuQueue = {
  items: [],
  isRunning: false
};

function execQueue() {

  // push these args to the end of the queue
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

  stdout = execSync(heyuExec, ["show", "aliases"], {
    "encoding": "utf8"
  });
  lines = stdout.split("\n").slice(1, -2);
  aliases = lines.map(function (line) {

    var alias, words;

    words = line.split(/\s+/);
    alias = {
      "label": words[2],
      "housecode": words[3].slice(0, 1),
      "devices": words[3].slice(1),
      "moduleType": words[4],
      "moduleOption": words[5],
    };

    return alias;

  });

  return aliases;

}

function readHousecode() {

  var housecode, matches, stdout;

  stdout = execSync(heyuExec, ["info"], { encoding: "utf8" });
  matches = stdout.match(/Housecode = ([A-P])/);
  if (matches) {
    housecode = matches[1];
  }
  debug("HOUSECODE",housecode);

  return housecode;

}

function enableFireCracker() {
  X10Commands.on = "fon";
  X10Commands.off = "foff";
  X10Commands.bright = "fbright";
  X10Commands.dim = "fdim";
  X10Commands.allon = "fallon";
  X10Commands.alloff = "falloff";
  X10Commands.lightson = "flightson";
  X10Commands.lightsoff = "flightsoff";
}

HeyuPlatform.prototype = {
  accessories: function(callback) {
    var foundAccessories = [];
    var self = this;
    //
    var aliases = heyuShowAliases();

    aliases.forEach(function (alias) {

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
    {
      var device = {};
      device.name = "All Devices";
      device.housecode = this.housecode;
      device.module = "Macro-allon";
      var accessory = new HeyuAccessory(self.log, device, null);
      foundAccessories.push(accessory);
    } {
      var device = {};
      device.name = "All Lights";
      device.housecode = this.housecode;
      device.module = "Macro-lightson";
      var accessory = new HeyuAccessory(self.log, device, null);
      foundAccessories.push(accessory);
    }

    if (cputemp != undefined) {
      var device;
      device.name = os.hostname();
      device.module = "Temperature";
      var accessory = new HeyuAccessory(self.log, device, null);
      foundAccessories.push(accessory);
    }

    // Start heyu monitor
    this.log("Starting heyu monitor");

    self.heyuMonitor = spawn(heyuExec, ["monitor"]);
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
  },
};


function HeyuAccessory(log, device, enddevice) {
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
  self.brightness_command = X10Commands.dimlevel;
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
  if (proc == "addr")
    var messageHousecode = message[8];
  else if (proc == "func")
    var messageCommand = message[4];

  if (proc == "addr" && operation == "rcvi") {
    this.log("Event occured at housecode %s", messageHousecode);
    var accessory = self.faccessories[messageHousecode];
    if (accessory != undefined) {
      self.heyuEvent(self, accessory);
    } else {
      this.log.error("Event occured at unknown device %s ignoring", messageHousecode);
    }
  }

}


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
      other.service.getCharacteristic(Characteristic.On)
        .getValue();
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
      other.service.getCharacteristic(Characteristic.Brightness)
        .getValue();
      other.service.getCharacteristic(Characteristic.On)
        .getValue();
      break;
    case "MS10":
    case "MS12":
    case "MS13":
    case "MS14":
    case "MS16":
      other.lastheard = Date.now();
      other.service.getCharacteristic(Characteristic.MotionDetected)
        .getValue();
      break;
    case "MS10A":
    case "MS12A":
    case "MS13A":
    case "MS14A":
    case "MS16A":
      //    debug(JSON.stringify(other, null, 2));
      other.lastheard = Date.now();
      other.service.getCharacteristic(Characteristic.StatusLowBattery)
        .getValue();
      other.service.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
        .getValue();
      break;
    default:
      this.log.error("No events defined for Module Type %s", other.module);
  }

}

HeyuAccessory.prototype = {

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
            callback(null, that.state)
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
            callback(null, that.state)
          })
          .on('set', this.setPowerState.bind(this));

        services.push(this.service);
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
      case "LM15A":
      case "PSM04":
      case "LM15":
        // lamp modules (dimmable outlets and dimmable switches)
        this.log("StdLM: Adding %s %s as a %s", this.name, this.housecode, this.module);
        this.service = new Service.Lightbulb(this.name);
        this.service
          .getCharacteristic(Characteristic.On)
          .on('get', this.getPowerState.bind(this))
          .on('set', this.setPowerState.bind(this));
        // Brightness Polling
        if (this.dimmable == "yes") {
          this.service
            .addCharacteristic(new Characteristic.Brightness())
            .setProps({
              minStep: 4.54
            })
            .on('get', this.getBrightness.bind(this))
            .on('set', this.setBrightness.bind(this));
        }

        services.push(this.service);
        break;
      case "SL2LM":
        this.log("SL2LM: Adding %s %s as a %s", this.name, this.housecode, this.module);
        this.service = new Service.Lightbulb(this.name);
        this.service
          .getCharacteristic(Characteristic.On)
          .on('get', this.getPowerState.bind(this))
          .on('set', this.setPowerState.bind(this));
        // Brightness Polling
        if (this.dimmable == "yes") {
          this.service
            .addCharacteristic(new Characteristic.Brightness())
            .setProps({
              minValue: 3,
              minStep: 3.125
            })
            .on('get', this.getSLBrightness.bind(this))
            .on('set', this.setSLBrightness.bind(this));
        }

        services.push(this.service);
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
+        // TODO technically the Outlet service requires a OutletInUse characterist (would always be true)
        this.service
          .getCharacteristic(Characteristic.On)
          .on('get', this.getPowerState.bind(this))
          .on('set', this.setPowerState.bind(this));
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

  //start of Heyu Functions

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

    if (this.statusHandling == "no") {
      this.log.warn("Ignoring request; No status handling not available.");
      callback(new Error("No status handling defined."));
      return;
    }

    execQueue(heyuExec, [this.status_command, this.housecode], function(error, responseBody, stderr) {
      if (error !== null) {
        this.log('Heyu onstate function failed: ' + error);
        callback(error);
      } else {
        var binaryState = (parseInt(responseBody) - 1) * -99999 + 1;
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

    debug("HeyuCommand", heyuExec, command, housecode);
    execQueue(heyuExec, [command, housecode], function(error, stdout, stderr) {
      if (error !== null) {
        this.log('exec error: ' + error);
        this.log('Heyu set power function failed!');
        callback(error);
      } else {
        this.powerOn = powerOn;
        this.log("Set power state of %s to %s", housecode, command);
        if (this.dimmable == "yes") {
          var that = this;
          that.service.getCharacteristic(Characteristic.Brightness)
            .getValue();
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

    if (this.statusHandling == "no") {
      this.log.warn("Ignoring request; No status handling not available.");
      callback(new Error("No status handling defined."));
      return;
    }


    var housecode = this.housecode;
    var command = this.status_command;


    execQueue(heyuExec, [command, housecode], function(error, responseBody, stderr) {
      if (error !== null) {
        this.log('Heyu onstate function failed: ' + error);
        callback(error);
      } else {
        var binaryState = parseInt(responseBody);
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

    if (this.dimmable == "no") {
      this.log.warn("Ignoring request; housecode not dimmable.");
      callback(new Error("Device not dimmable."));
      return;
    }

    var housecode = this.housecode;
    var command = this.brightness_command;

    execQueue(heyuExec, [command, housecode], function(error, responseBody, stderr) {
      if (error !== null) {
        this.log('Heyu function failed: ' + error);
        callback(error);
      } else {
        var binaryState = parseInt(responseBody);
        this.log("Got brightness level of %s %s", housecode, binaryState);
        this.brightness = binaryState;
        callback(null, binaryState);
      }
    }.bind(this));

  },

  getSLBrightness: function(callback) {
    if (!X10Commands.rawlevel) {
      this.log.warn("Ignoring request; No rawlevel command defined.");
      callback(new Error("No rawlevel command defined."));
      return;
    }

    if (this.dimmable == "no") {
      this.log.warn("Ignoring request; housecode not dimmable.");
      callback(new Error("Device not dimmable."));
      return;
    }

    execQueue(heyuExec, [X10Commands.rawlevel, this.housecode], function(error, responseBody, stderr) {
      if (error !== null) {
        this.log('Heyu function failed: ' + error);
        callback(error);
      } else {
        var binaryState = parseInt(responseBody * 3.125);
        this.log("Got SL brightness level of %s %s", this.housecode, binaryState);
        this.brightness = binaryState;
        callback(null, binaryState);
      }
    }.bind(this));

  },


  setSLBrightness: function(level, callback) {
    var housecode = this.housecode;

    if (isNaN(this.brightness) || !this.powerOn) {
      var current = 0;
    } else {
      var current = this.brightness;
    }

    execQueue(heyuExec, [X10Commands.preset, housecode, parseInt((level / 3.125) + .9)], function(error, stdout, stderr) {
      if (error !== null) {
        this.log('Heyu preset function failed: %s', error);
        callback(error);
      } else {
        this.brightness = level;
        this.powerOn = true;
        this.log("Set preset %s %s %s %s", housecode, level, parseInt((level / 3.125) + .9), parseInt(parseInt((level / 3.125) + .9) * 3.125));
        var other = this;
        other.service.getCharacteristic(Characteristic.On)
          .getValue();
        other.service.getCharacteristic(Characteristic.Brightness)
          .getValue();
        callback(null);
      }
    }.bind(this));
    //      } else {
    //          this.log('Change too small, ignored');
    //          callback(null);
    //      }
  },

  setBrightness: function(level, callback) {

    var housecode = this.housecode;

    if (isNaN(this.brightness) || !this.powerOn) {
      var current = 100;
    } else {
      var current = this.brightness;
    }

    if (level > current) {
      var command = X10Commands.bright;
      var delta = parseInt((level - current) / 4.54);
    } else {
      var command = X10Commands.dim;
      var delta = parseInt((current - level) / 4.54);
    }

    // Keyboard debouncing

    if (delta > 1) {

      execQueue(heyuExec, [command, housecode, delta], function(error, stdout, stderr) {
        if (error !== null) {
          this.log('Heyu brightness function failed: %s', error);
          callback(error);
        } else {
          this.brightness = level;
          this.powerOn = true;
          this.log("Set Bright/Dim %s %s %s ( %s % )", command, housecode, delta, level);
          var other = this;
          other.service.getCharacteristic(Characteristic.On)
            .getValue();
          other.service.getCharacteristic(Characteristic.Brightness)
            .getValue();
          callback();
        }
      }.bind(this));
    } else {
      this.log('Change too small, ignored');
      callback();
    }
  },

  getTemperature: function(callback) {
    exec(cputemp, function(error, responseBody, stderr) {
      if (error !== null) {
        this.log('cputemp function failed: ' + error);
        callback(error);
      } else {
        var binaryState = parseInt(responseBody);
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

function pct2preset(percent) {

  if (percent < 5) {
    return 1;
  } else if (percent <= 18) {
    return 2;
  } else if (percent <= 21) {
    return 3;
  } else if (percent <= 23) {
    return 4;
  } else if (percent <= 27) {
    return 5;
  } else if (percent <= 28) {
    return 6;
  } else if (percent <= 31) {
    return 7;
  } else if (percent <= 34) {
    return 8;
  } else if (percent <= 36) {
    return 9;
  } else if (percent <= 39) {
    return 10;
  } else if (percent <= 42) {
    return 11;
  } else if (percent <= 45) {
    return 12;
  } else if (percent <= 48) {
    return 13;
  } else if (percent <= 51) {
    return 14;
  } else if (percent <= 54) {
    return 15;
  } else if (percent <= 57) {
    return 16;
  } else if (percent <= 60) {
    return 17;
  } else if (percent <= 63) {
    return 18;
  } else if (percent <= 67) {
    return 19;
  } else if (percent <= 70) {
    return 20;
  } else if (percent <= 73) {
    return 21;
  } else if (percent <= 76) {
    return 22;
  } else if (percent <= 79) {
    return 23;
  } else if (percent <= 82) {
    return 24;
  } else if (percent <= 85) {
    return 25;
  } else if (percent <= 87) {
    return 26;
  } else if (percent <= 90) {
    return 27;
  } else if (percent <= 92) {
    return 28;
  } else if (percent <= 95) {
    return 29;
  } else if (percent <= 97) {
    return 30;
  } else if (percent <= 99) {
    return 31;
  }
  return 32;
}
