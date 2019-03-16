var CM11A = require("cm11a-js");
var debug = require("debug")('Test');

var cm11 = CM11A();
cm11.on('unitStatus', onUnitStatus);
cm11.on('status', onStatus);
cm11.on('close', onClose);

cm11.start('/Dev/tty.usbserial');

cm11.status();

var addr = ['A15', 'A14'];
debug("turnOn");
// cm11.turnOn(addr);
debug("dim");
// cm11.dim(addr, 11);
debug("bright");
// cm11.bright(addr, 11);
debug("turnOff");
cm11.turnOff(addr);
debug("done");

function onClose() {
  debug('CM11 Closed');
  cm11 = undefined;
  process.exit();
}

function onUnitStatus(status) {
  debug("onUnitStatus", status);
}

function onStatus(status) {
  debug("onStatus",status);
}
