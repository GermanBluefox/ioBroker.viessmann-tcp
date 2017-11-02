/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */

'use strict';

var utils = require(__dirname + '/lib/utils');
var xml2js = require('xml2js');
var net = require('net');

var adapter = utils.adapter('viessmann-tcp');

var client = new net.Socket();
var ESPConnected = false;
var ViessmannConnected = false;
var WifiBusy = false;
var oLastRequest = {};
var receiveAnswer = false;
var oVito = null;
var parser = new xml2js.Parser(), fs = require('fs');

// Datei einlesen
fs.readFile(__dirname + '/vito.xml', function (err, data) {
    parser.parseString(data, function (err, result) {
        oVito = result.vito;
    });
});

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.setState('info.connection', false, true);
        if (ViessmannConnected) {
			client.close();
        }
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        if (!ESPConnected) {
            adapter.log.warn('Cannot send command to "' + id + '", because not connected');
            return;
        }
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj === 'object' && obj.message) {
        if (obj.command === 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {	
    main();
});

function calculateChecksum(v)
{
	var nChecksum = 0;
	for(var i=2;i<v.length;i=i+2)
	{
		var dec = parseInt(v.charAt(i)+v.charAt(i+1), 16);
		nChecksum = nChecksum + dec;
	}
	
	return nChecksum.toString(16);;
}

function loop()
{
	if (ESPConnected && ViessmannConnected && !WifiBusy) {
		getValue('getTempA');
	}
}

function getUnitFromObject(unit)
{
	for (var z in oVito.units[0].unit)
	{
		if(unit == oVito.units[0].unit[z]['abbrev'][0])
		{
			return oVito.units[0].unit[z];
		}
	}
	
	return false;
}

function getValue(name)
{
	for (var z in oVito.commands[0].command)
	{
		if(name == oVito.commands[0].command[z].$['name'] && oVito.commands[0].command[z].$['protocmd'] == 'getaddr')
		{
			var addr = oVito.commands[0].command[z].addr[0];
			var len  = oVito.commands[0].command[z].len[0];
			adapter.log.debug('Try to get Value from Adress ' + addr + ' (' + name + ')');
			
			oLastRequest = oVito.commands[0].command[z];
			
			var v   = "41050001" + addr + "0" + len;
			
			var hex =  v + calculateChecksum(v);
	
			sendRequest(hex);
		}
	}
}

function sendRequest(data)
{
	if(data.length > 0)
	{
		var buf = Buffer.from(data, 'hex');
		
		WifiBusy = true;
		client.write( buf );
		
		setTimeout(function() {
			//Reset WifiBusy, if there where no data incoming
			if(WifiBusy)
			{
				WifiBusy = false;
				oLastRequest = {};
				adapter.log.debug('Reset WifiBusy, because there are no Data incoming');
			}
		}, 1000);
	}
}

function handleAnswer(answer)
{
	var bytelength = answer.charAt(12) + answer.charAt(13);
	if(bytelength > 0)
	{
		var valueHex = '';
		for(var i=14;i<14+(bytelength*2);i++)
		{
			valueHex = valueHex + answer.charAt(i);
		}
		
		var unit = getUnitFromObject(oLastRequest.unit[0]);		
		var get  = unit.calc[0].$['get'];
		var valueDec = eval(new String(get.replace("V", parseInt(valueHex.charAt(0)+valueHex.charAt(1), 16))).toString());
		
		adapter.getObject(adapter.namespace + '.' + oLastRequest.$['name'] + '_' + oLastRequest.addr[0], function (err, obj) {
			if (!obj) {
				adapter.log.debug('Create new Object ' + adapter.namespace + '.' + oLastRequest.$['name'] + '_' + oLastRequest.addr[0] + ', because not found in ioBroker.');
				var object = {
					_id: adapter.namespace + '.' + oLastRequest.$['name'] + '_' + oLastRequest.addr[0],
					common: {
						name: oLastRequest.description[0],
						role: oLastRequest.$['protocmd'],
						type: 'number'
					},
					native: {},
					type: 'state'
				};

				adapter.setObject(oLastRequest.$['name'] + '_' + oLastRequest.addr[0], object, function (err, obj) {
					adapter.setState(oLastRequest.$['name'] + '_' + oLastRequest.addr[0], {val: valueDec, ack: true});
				});
			}
			else
			{
				adapter.log.debug(adapter.namespace + '.' + oLastRequest.$['name'] + '_' + oLastRequest.addr[0] + ' Object found, set Value to ' + valueDec);
				adapter.setState(oLastRequest.$['name'] + '_' + oLastRequest.addr[0], {val: valueDec, ack: true});
			}
		});
	}
}

function main() {
    adapter.config.host = adapter.config.host || '127.0.0.1';
    adapter.config.port = parseInt(adapter.config.port, 10) || 8888;
    adapter.config.refresh = parseInt(adapter.config.refresh, 10) || 60;

    adapter.log.debug('Try to connect to Viessmann at: ' + adapter.config.host + ':' + adapter.config.port);

    // in this template all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');
	
	client.connect(adapter.config.port, adapter.config.host, function() {
		if (!ESPConnected && !WifiBusy) {
            adapter.log.debug('Connected');
            ESPConnected = true;
			adapter.setState('info.connection', true, false);
			
			// Set Viessmann back to default Serial Connection
			sendRequest('04');		
        }
	});
	
	client.on('data', function (data) {
		if (ESPConnected) {
			if(receiveAnswer)
			{				
				handleAnswer(Buffer.from(data).toString('hex'));
				receiveAnswer = false;
				WifiBusy = false;
			}
			if(data == '\x05') // initialer Aufruf
			{
				adapter.log.debug('Viessmann Serial Connect');
				sendRequest('160000');
				ViessmannConnected = true;
				setInterval(loop, adapter.config.refresh * 1000);
			}
			if(data == '\x06') // Anfrage ok
			{
				receiveAnswer = true;
			}
			if(data == '\x15') // Fehler in der Anfrage
			{
				adapter.log.debug('Fehler in der Anfrage - Viessmann konnte Anfrage nicht verarbeiten.');
			}
		}
    });
	
    client.on('error', function (data) {
        adapter.log.debug('Fehler beim Verbindungsaufbau: ' + data);
    });
	
    client.on('end', function () {
        if (ESPConnected) {
            adapter.log.debug('Disconnected');
            connected = false;
            adapter.setState('info.connection', false, true);
        }
    });
	
    client.on('close', function () {
        if (ESPConnected) {
			client.write('\x04');
            adapter.log.debug('Disconnected');
            ESPConnected = false;
			ViessmannConnected = false;
            adapter.setState('info.connection', false, true);
        }
    });
}
