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

var Accessory, Characteristic, PowerConsumption, Service, uuid;
var exec = require('child_process').execFile;
var spawn = require('child_process').spawn;
var os = require("os");
var heyuExec, cputemp, x10conf, useFireCracker;
var noMotionTimer;
var X10Commands={
    on:"on",
    off:"off",
    bright:"bright",
    dim:"dim",
    dimlevel:"dimlevel",
    allon:"allon",
    alloff:"alloff",
    lightson:"lightson",
    lightsoff:"lightsoff",
    onstate:"onstate"
};

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    uuid = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-heyu", "Heyu", HeyuPlatform);
};

function HeyuPlatform(log, config) {
    this.log = log;
    this.log("Heyu Platform Plugin Loaded ");
    this.faccessories = {}; // an array of accessories by housecode
    // platform options
    heyuExec = config.heyuExec || "/usr/local/bin/heyu";
    x10conf = config.x10conf || "/etc/heyu/x10.conf";
    useFireCracker = config.useFireCracker || false;
    cputemp = config.cputemp;

    if (useFireCracker) {
        enableFireCracker();
    }

    this.config = config;
    this.devices = this.config.devices;
}

function readX10config() {
    var fs = require('fs');
    var x10confObject = {};

    var x10confData = fs.readFileSync(x10conf);
    var pattern = new RegExp('\nalias.*', 'ig');

    // ALIAS Front_Porch A1 StdLM

    var match = [];
    while ((match = pattern.exec(x10confData)) != null) {
        var line = match[0].split(/[ \t]+/);
        x10confObject[line[1]] = {
            'name': line[1].replace(/_/g, ' '),
            'housecode': line[2],
            'module': line[3]
        };
    }
    return x10confObject;
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
        var devices = new readX10config();

        for (var i in devices) {
            var device = devices[i];
            this.log("Found in x10.conf: %s %s %s", device.name, device.housecode, device.module);
            var accessory = new HeyuAccessory(self.log, device, null);
            foundAccessories.push(accessory);
            var housecode = device.housecode;
            self.faccessories[housecode] = accessory;
        }
        // Built-in accessories and macro's
        {
            var device;
            device.name = "All Devices";
            device.housecode = "A";
            device.module = "Macro-allon";
            var accessory = new HeyuAccessory(self.log, device, null);
            foundAccessories.push(accessory);
        } {
            var device;
            device.name = "All Lights";
            device.housecode = "A";
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
      }
        else {
          this.log.error("Event occured at unknown device %s ignoring", messageHousecode);
        }
    }

}


HeyuPlatform.prototype.heyuEvent = function(self, accessory) {

    var other = accessory;
    other.service.getCharacteristic(Characteristic.On)
        .getValue();
    if (other.dimmable == "yes")
        other.service.getCharacteristic(Characteristic.Brightness)
        .getValue();

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
            case "LM":
            case "LM12":
            case "LM465":
            case "StdLM":
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
                        .on('get', this.getBrightness.bind(this))
                        .on('set', this.setBrightness.bind(this));
                }

                services.push(this.service);
                break;
            case "AM":
            case "AMS":
            case "AM12":
            case "StdAM":
                this.log("StdAM: Adding %s %s as a %s", this.name, this.housecode, this.module);
                this.dimmable = "no"; // All Appliance modules are not dimmable
                this.service = new Service.Outlet(this.name);
                this.service
                    .getCharacteristic(Characteristic.On)
                    .on('get', this.getPowerState.bind(this))
                    .on('set', this.setPowerState.bind(this));
                services.push(this.service);
                break;
            case "WS":
            case "WS-1":
            case "WS467":
            case "WS467-1":
            case "XPS3":
            case "StdWS":
                this.log("StdWS: Adding %s %s as a %s", this.name, this.housecode, this.module);
                this.dimmable = "no"; // Technically some X10 switches are dimmable, but we're treating them as on/off
                this.service = new Service.Switch(this.name);
                this.service
                    .getCharacteristic(Characteristic.On)
                    .on('get', this.getPowerState.bind(this))
                    .on('set', this.setPowerState.bind(this));
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

        exec(heyuExec, [command, housecode], function(error, stdout, stderr) {
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


        exec(heyuExec, [command, housecode], function(error, responseBody, stderr) {
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



        exec(heyuExec, [command, housecode], function(error, responseBody, stderr) {
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

            exec(heyuExec, [command, housecode, delta], function(error, stdout, stderr) {
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
