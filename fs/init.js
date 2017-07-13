// See README.md for details.

// Load Mongoose OS API
load('api_gpio.js');
load('api_i2c.js');
load('api_rpc.js');
load('api_timer.js');
load('api_config.js');
load('api_aws.js');

// GPIO pin which has a on/off relay connected
let pin = 13;
GPIO.set_mode(pin, GPIO.MODE_OUTPUT);

function updateState(newSt) {
  if (newSt.on !== undefined) {
    state.on = newSt.on;
  }
}

function applyHeater() {
  GPIO.write(pin, state.on || 0);
}

// Milliseconds. How often to send temperature readings to the cloud
let freq = 20000;

// This function reads temperature from the MCP9808 temperature sensor.
// Data sheet: http://www.microchip.com/wwwproducts/en/en556182
let getTemp = function() {
  let i2c = I2C.get_default();
  let t = -1000;
  let v = I2C.readRegW(i2c, 0x1f, 5);
  if (v > 0) {
    t = ((v >> 4) & 0xff) + ((v & 0xf) / 16.0);
    if (v & 0x1000) t = -t;
  }
  return t;
};

let state = {
  on: false,
  temp: getTemp(),
};

let getStatus = function() {
  return {
    temp: getTemp(),
    on: GPIO.read(pin) === 1
  };
};

RPC.addHandler('Heater.SetState', function(args) {
  GPIO.write(pin, args.on || 0);
  AWS.Shadow.update(0, {
    desired: {
      on: !state.on,
    },
  });
  return true;
});

RPC.addHandler('Heater.GetState', function(args) {
  return getStatus();
});

// Send temperature readings to the cloud
Timer.set(freq, true, function() {
  state = getStatus();
  reportState();
}, null);

function reportState() {
  print('Reporting state:', JSON.stringify(state));
  AWS.Shadow.update(0, {
    reported: state,
  });
}

AWS.Shadow.setStateHandler(function(ud, ev, reported, desired) {
  print('Event:', ev, '('+AWS.Shadow.eventName(ev)+')');

  if (ev === AWS.Shadow.CONNECTED) {
    reportState();
    return;
  }

  print('Reported state:', JSON.stringify(reported));
  print('Desired state:', JSON.stringify(desired));

  // mOS will request state on reconnect and deltas will arrive on changes.
  if (ev !== AWS.Shadow.GET_ACCEPTED && ev !== AWS.Shadow.UPDATE_DELTA) {
    return;
  }

  // Here we extract values from previosuly reported state (if any)
  // and then override it with desired state (if present).
  updateState(reported);
  updateState(desired);

  print('New state:', JSON.stringify(state));

  applyHeater();

  if (ev === AWS.Shadow.UPDATE_DELTA) {
    // Report current state
    reportState();
  }
}, null);

applyHeater();
