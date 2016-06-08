var Service, Characteristic;
var request = require("request");
var pollingtoevent = require('polling-to-event');
var exec = require('child_process').execFile;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-heyu", "Heyu", HeyuAccessory);
}


function HeyuAccessory(log, config) {
    this.log = log;

    // url info
    this.device = config["device"];
    this.on_command = config["on_command"] || "on";;
    this.off_command = config["off_command"] || "off";;
    this.statusHandling = config["statusHandling"] || "yes";
    this.status_command = config["status_command"] || "onstate";
    this.brightness_command = config["getbrightness_command"] || "dimlevel";
    this.service = config["service"] || "Switch";
    this.name = config["name"];
    this.dimmable = config["dimmable"] || "no";

    //realtime polling info
    this.state = true;
    this.currentlevel = 0;
    var that = this;

}

HeyuAccessory.prototype = {


    setPowerState: function(powerOn, callback) {
        var device;
        var command;

        if (!this.on_command || !this.off_command) {
            this.log.warn("Ignoring request; No power command defined.");
            callback(new Error("No power command defined."));
            return;
        }

        if (powerOn) {
            device = this.device;
            command = this.on_command;
        } else {
            device = this.device;
            command = this.off_command;
        }

        heyuExec = '/usr/local/bin/heyu';
        exec(heyuExec, [command, device], function(error, stdout, stderr) {
            if (error !== null) {
                this.log('exec error: ' + error);
                this.log('Heyu set power function failed!');
                callback(error);
            } else {
                this.powerOn = powerOn;
                this.log("Set power state of %s to %s", device, command);
                if (this.dimmable == "yes") {
                    var that = this;
                    that.lightbulbService.getCharacteristic(Characteristic.Brightness)
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


        var device = this.device;
        var command = this.status_command;

        heyuExec = '/usr/local/bin/heyu';
        exec(heyuExec, [command, device], function(error, responseBody, stderr) {
            if (error !== null) {
                this.log('Heyu onstate function failed: ' + error);
                callback(error);
            } else {
                var binaryState = parseInt(responseBody);
                this.log("Got power state of %s %s", device, binaryState);
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
            this.log.warn("Ignoring request; device not dimmable.");
            callback(new Error("Device not dimmable."));
            return;
        }


        var device = this.device;
        var command = this.brightness_command;


        heyuExec = '/usr/local/bin/heyu';
        exec(heyuExec, [command, device], function(error, responseBody, stderr) {
            if (error !== null) {
                this.log('Heyu function failed: ' + error);
                callback(error);
            } else {
                var binaryState = parseInt(responseBody);
                this.log("Got brightness level of %s %s", device, binaryState);
                this.brightness = binaryState;
                callback(null, binaryState);
            }
        }.bind(this));

    },

    setBrightness: function(level, callback) {


        var device = this.device;

        if (isNaN(this.brightness) || !this.powerOn) {
            var current = 100;
        } else {
            var current = this.brightness;
        }

        if (level > current) {
            var command = "bright";
            var delta = parseInt((level - current) / 4.54);
        } else {
            var command = "dim";
            var delta = parseInt((current - level) / 4.54);
        }

        // Keyboard debouncing

        if (delta > 1) {
            heyuExec = '/usr/local/bin/heyu';
            exec(heyuExec, [command, device, delta], function(error, stdout, stderr) {
                if (error !== null) {
                    this.log('Heyu brightness function failed: %s', error);
                    callback(error);
                } else {
                    this.brightness = level;
                    this.powerOn = true;
                    this.log("Set Bright/Dim %s %s %s ( %s % )", command, device, delta, level);
                    var other = this;
                    other.lightbulbService.getCharacteristic(Characteristic.On)
                        .getValue();
                    other.lightbulbService.getCharacteristic(Characteristic.Brightness)
                        .getValue();
                    callback();
                }
            }.bind(this));
        } else {
            this.log('Change too small, ignored');
            callback();
        }
    },

    identify: function(callback) {
        this.log("Identify requested!");
        callback(); // success
    },

    getServices: function() {

        var that = this;

        // you can OPTIONALLY create an information service if you wish to override
        // the default values for things like serial number, model, etc.
        var informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Heyu Manufacturer")
            .setCharacteristic(Characteristic.Model, this.service)
            .setCharacteristic(Characteristic.SerialNumber, this.device);

        switch (this.service) {
            case "Switch":
                this.switchService = new Service.Switch(this.name);
                switch (this.statusHandling) {
                    case "yes":
                        this.switchService
                            .getCharacteristic(Characteristic.On)
                            .on('get', this.getPowerState.bind(this))
                            .on('set', this.setPowerState.bind(this));
                        break;
                    case "no":
                        this.switchService
                            .getCharacteristic(Characteristic.On)
                            .on('get', function(callback) {
                                callback(null, that.state)
                            })
                            .on('set', this.setPowerState.bind(this));
                        break;
                }
                return [informationService, this.switchService];
            case "Light":
                this.lightbulbService = new Service.Lightbulb(this.name);
                this.lightbulbService
                    .getCharacteristic(Characteristic.On)
                    .on('get', this.getPowerState.bind(this))
                    .on('set', this.setPowerState.bind(this));
                // Brightness Polling
                if (this.dimmable == "yes") {
                    this.lightbulbService
                        .addCharacteristic(new Characteristic.Brightness())
                        .on('get', this.getBrightness.bind(this))
                        .on('set', this.setBrightness.bind(this));
                }

                return [informationService, this.lightbulbService];
                break;
        }
    }
};
