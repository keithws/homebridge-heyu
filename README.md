# homebridge-heyu

[![NPM Downloads](https://img.shields.io/npm/dm/homebridge-heyu.svg?style=flat)](https://npmjs.org/package/homebridge-heyu)

# Support is no longer available for the plugin.  Everyone I have retired my last X10 device so I will no longer be able to work on issues with this plugin.  If you are an active user, and want to take over please let me know and we can look into transferring the plugin over.

Supports X10 devices via heyu on the HomeBridge Platform. Tested with a CM11A
Module connected via a USB Serial adapter. For device configuration, it parses
the heyu configuration file /etc/heyu/x10.conf and creates an accessory for each
alias.  The accessory name is generated from the label ( underscores removed ),
and the device type is generated by the module type.

Monitoring of changes by other remotes / devices is enabled, and updating back
to HomeKit. This is using the heyu monitor command, and watching for messages
with rcvi.

Please note that for device status to work correctly, please ensure that the heyu
engine is running.  ie have this in your x10.conf

START_ENGINE  AUTO

Also included are two macro's, "All Devices" and "All Lights", which map to the
commands allon/alloff and lightson/lightsoff.  These are sent to the housecode configured in your x10.conf.

On, off, bright and dim commands can also be sent via the CM17A FireCracker module
by setting "useFireCracker" to **true** in the configuration settings.

# Modules Types Supported

* Lamp Module ( Light Bulb ) - All lamp modules supported by heyu
     * including LM, LM12, LM465, StdLM
     * and SL1LM, SL2LM, LL1LM, and LL2LM with Pre-set dim codes
     * and LM465-1, LM-1, LM14A with Extended codes

* Appliance Module ( Outlet ) - All appliance modules supported by heyu
    * including AM, AMS, AM12, StdAM

* Wall Switch ( Switch ) - All wall switch modules support by heyu
    * including WS, WS-1, WS467, WS467-1, XPS3, StdWS
    * and WS467-1 and WS-1 with Extended codes

* Motion Sensor - MS10, MS12, MS13, MS14, MS16

* Light/Dark Sensor - MS10A, MS12A, MS13A, MS14A, MS16A ( This is +1 unit code of the motion sensor )

* Insteon Modules accepting X10 Commands - SL2LM ( 2477D )

Please note that all dimmable modules have the dimming feature. If
you have a lamp or wall switch that you do not want to be able to dim, define it as a non-dimmable wall switch or appliance module.

Motion Sensors, Reliability and Battery Life - As the motion sensor does not return
any information regarding battery status, I'm using the daylight sensor feature of the
motion sensor to determine if the sensor has stopped responding i.e. gone inactive.  If the daylight sensor
has not changed status within 18 hours, it will set the low battery alert for the Light Sensor.

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install homebridge-heyu using: npm install -g homebridge-heyu
3. Update your configuration file. See sample-config.json in this repository
for a sample.
4. Assumes heyu is installed in /usr/local/bin/heyu, and already configured and
running
5. Homebridge must run under the same id as heyu

# Configuration

```
"platforms": [{
       "platform": "Heyu",
       "name": "Heyu",
       "heyuExec": "/usr/local/bin/heyu",   //optional - defaults to /usr/local/bin/heyu
       "x10conf": "/etc/heyu/x10.conf",     //optional - defaults to /etc/heyu/x10.conf
       "useFireCracker": false              //optional - If true, issues commands via the CM17A FireCracker module
       "cputemp": "cputemp"                 //optional - If present includes cpu TemperatureSensor
   }]
```

* For the configuration of Accessories, homebridge-heyu reads your x10.conf and creates an accessory for each ALIAS. The type of accessory is based on the module type.
* For the all-on/all-off macros, HOUSECODE is used to determine which housecode to use for the functions.  You must have HOUSECODE set in x10.conf or else the plugin will not work, and homebridge will not start.

# Known Issues

* Missing HOUSECODE from x10.conf causes homebridge to crash during startup.

# cputemp

Is a shell script I have installed on all my machines to monitor CPU
temperature's.  This will showup with the name of the machine running homebridge.

I have this installed as /usr/local/bin/cputemp

```
#!/bin/bash
cpuTemp0=$(cat /sys/class/thermal/thermal_zone0/temp)
cpuTemp1=$(($cpuTemp0/1000))
cpuTemp2=$(($cpuTemp0/100))
cpuTempM=$(($cpuTemp2 % $cpuTemp1))

echo $cpuTemp1" C"
```

# ToDo

* [ ] Improve performance of the plugin and responsiveness of the Home app by removing the get function.
* [ ] Use tail rather than heyu monitor to monitor for events
* [x] Stop Missing HOUSECODE from x10.conf causing homebridge to crash during startup.
* [x] Bad x10.conf causing homebridge to crash during startup.
* [ ] analyze queued up heyu commands and consolidate where possible (same command and same housecode)
* [x] expand module type coverage to all appliance and lamp types defined in the x10config man page for heyu
* [x] rewrite Modules Types Supported section above
* [x] implement SmartHome's Implementation of Pre-Set Dim
* [x] implement xpreset dimming for LM456-1 and others

# Credits

* W7RZL - Firecracker commands and additional modules
* keithws - Command queueing and enhanced dimming
